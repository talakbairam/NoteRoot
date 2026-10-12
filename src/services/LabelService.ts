import * as vscode from "vscode";
import { SettingDefaults } from "../constants/settings";
import { Strings } from "../constants/strings";
import { NameConflictError, RootMissingError } from "../util/errors";
import { AdvancedModeService } from "./AdvancedModeService";
import type { AutoCategoryService } from "./AutoCategoryService";
import type { AutoTagPatternService } from "./AutoTagPatternService";
import { findPatternTags, patternToRegExpSource } from "./TagPatterns";
import { ConfigService } from "./ConfigService";
import type { SettingsService } from "./SettingsService";
import { RootFolderService } from "./RootFolderService";

/** The two kinds of labels a note can get. */
export type LabelKind = "category" | "tag";

export interface Category {
  /** The identity of the category: what is stored and reported. Not always what is shown, see `label`. */
  name: string;
  /** What the lists show instead of `name`. Only for a category made from a file: its file name. */
  label?: string;
  /** A note that starts with this text is saved to this category (unless the user chose another one). */
  keyword?: string;
  /** Path relative to the notes folder, `/`-separated. Without it the category uses the Quick Note file. */
  file?: string;
}

export interface Labels {
  categories: Category[];
  tags: string[];
  /** The keyword of each tag that has one: a note that starts with it gets the tag. */
  tagKeywords: Record<string, string>;
}

/** What changed in the lists. `select` names the entry that must stay chosen, for example after a rename. */
export interface LabelChange {
  select?: { kind: LabelKind; value: string };
}

export interface CreatedLabel extends Labels {
  /** The name that was added, as stored. */
  created: string;
}

// A keyword needs at least `minKeywordLength` characters (3 at first), or ordinary words would trigger it.
export const MAX_KEYWORD_LENGTH = 50;

/**
 * Where the keyword is in the note: the position of its first appearance anywhere in the text, any case, or -1.
 * A keyword that is empty (after trimming) is nowhere.
 */
export function keywordPosition(text: string, keyword: string): number {
  const wanted = keyword.trim().toLowerCase();
  return wanted.length > 0 ? text.toLowerCase().indexOf(wanted) : -1;
}

/** True when the note contains the keyword anywhere, in any case. */
export function containsKeyword(text: string, keyword: string): boolean {
  return keywordPosition(text, keyword) >= 0;
}

// The longest name of a category or tag is the setting `maxLabelNameLength` (50 at first).

// Control characters have no place in a name, and they keep one special value free in the webview.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Where each kind is stored inside `custom` of `.noteroot/config.json`. */
const CONFIG_KEYS: Record<LabelKind, string> = { category: "categories", tag: "tags" };
/** Where the tag patterns are stored inside `custom`. */
const TAG_PATTERNS_KEY = "tagPatterns";

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/**
 * The categories and tags the user created, stored in the `custom` part of the NoteRoot config file
 * of the notes folder (so they belong to that folder, and travel with it).
 *
 * A category can be linked to a file: while the Advanced mode is on and that category is chosen,
 * notes go to its file instead of the Quick Note file.
 */
export class LabelService implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<LabelChange | undefined>();
  private readonly selectionEmitter = new vscode.EventEmitter<void>();
  private chosenCategory = "";
  /** The tags the box shows as chosen, in the order they were chosen. */
  private chosenTags: string[] = [];
  /** The file of the chosen category, kept for places that cannot wait (labels, tooltips). */
  private cachedActiveFile: string | undefined;

  /** Fires after a category or tag was created, renamed or deleted, or a category was linked to another file. */
  readonly onDidChange = this.changeEmitter.event;
  /** Fires when the chosen category or tag changed. */
  readonly onDidChangeSelection = this.selectionEmitter.event;

  constructor(
    private readonly rootService: RootFolderService,
    private readonly configService: ConfigService,
    private readonly advancedMode: AdvancedModeService,
    private readonly autoCategories?: AutoCategoryService,
    private readonly autoTagPatterns?: AutoTagPatternService,
    private readonly settings?: SettingsService
  ) {
    // The categories made from files are part of what can be chosen, so a change of files is a change of lists.
    autoCategories?.onDidChange(() => this.changeEmitter.fire(undefined));
    // The page previews the tags the patterns will make, so switching them on or off must reach it.
    autoTagPatterns?.onDidChange(() => this.changeEmitter.fire(undefined));
  }

  /** A first guess for the file of a new category: its name, without characters a file name cannot have. */
  static suggestFileName(name: string): string {
    const cleaned = name
      .replace(/[<>:"|?*\\/\u0000-\u001f\u007f]/g, "-")
      .trim()
      .replace(/[. ]+$/, "");
    return `${cleaned.length > 0 ? cleaned : "notes"}.md`;
  }

  /** The stored lists, sorted for display. Empty while there is no notes folder or no list yet. */
  async getLabels(): Promise<Labels> {
    const root = this.rootService.getRootUri();
    if (!root || !this.rootService.hasRoot) {
      return { categories: [], tags: [], tagKeywords: {} };
    }
    const { config } = await this.configService.ensure(root);
    return labelsOf(config.custom);
  }

  /**
   * The categories that can be chosen: the stored ones, then one per note file while "Auto create category for
   * every file" is on. A stored category wins over a file with the same name (case-insensitive).
   */
  async getChoosableCategories(): Promise<Category[]> {
    const { categories } = await this.getLabels();
    const fromFiles = (await this.autoCategories?.list()) ?? [];
    const taken = new Set(categories.map((category) => category.name.toLowerCase()));
    // A label that two entries would share is replaced by the whole name, so every row can be told apart.
    const labels = new Set(taken);
    const extra: Category[] = [];
    for (const category of fromFiles) {
      const key = category.name.toLowerCase();
      if (taken.has(key)) {
        continue;
      }
      taken.add(key);
      const label = (category.label ?? category.name).toLowerCase();
      if (category.label !== undefined && labels.has(label)) {
        extra.push({ name: category.name, file: category.file });
        labels.add(key);
      } else {
        extra.push(category);
        labels.add(label);
      }
    }
    return [...categories, ...extra];
  }

  /**
   * Checks a name typed by the user. Case-insensitive, so "Work" and "work" are the same category.
   * @returns a message for `validateInput`, or undefined when the name is fine.
   */
  validateName(name: string, existing: readonly string[]): string | undefined {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return Strings.quickNote.labelNameEmpty;
    }
    const longest = this.settings?.maxLabelNameLength ?? SettingDefaults.maxLabelNameLength;
    if (trimmed.length > longest) {
      return Strings.quickNote.labelNameTooLong(longest);
    }
    if (CONTROL_CHARACTERS.test(trimmed)) {
      return Strings.quickNote.labelNameInvalid;
    }
    const wanted = trimmed.toLowerCase();
    if (existing.some((entry) => entry.toLowerCase() === wanted)) {
      return Strings.quickNote.labelAlreadyExists(trimmed);
    }
    return undefined;
  }

  /**
   * Adds a category or tag to the config file. A category may come with the file its notes go to.
   * @throws RootMissingError without a notes folder, ConfigLockedError when the config file may not be changed.
   */
  async create(
    kind: LabelKind,
    name: string,
    options: { file?: string } = {}
  ): Promise<CreatedLabel> {
    const root = this.requireRoot();
    const trimmed = name.trim();
    const key = CONFIG_KEYS[kind];
    // Checked again against what is stored now: another window may have added the same name.
    let alreadyThere = false;
    const config = await this.configService.updateCustom(root, (custom) => {
      const raw = Array.isArray(custom[key]) ? [...(custom[key] as unknown[])] : [];
      if (nameOf(raw, trimmed) !== undefined) {
        alreadyThere = true;
        return;
      }
      raw.push(
        kind === "category" && options.file
          ? { name: trimmed, file: options.file }
          : kind === "category"
            ? { name: trimmed }
            : trimmed
      );
      custom[key] = raw;
    });
    if (!alreadyThere) {
      this.changeEmitter.fire(undefined);
    }
    return { ...labelsOf(config.custom), created: trimmed };
  }

  /**
   * Links a category to another file, or (without `file`) back to the Quick Note file.
   * Everything else stored with the category is kept.
   * @throws RootMissingError without a notes folder, ConfigLockedError when the config file may not be changed.
   */
  async setCategoryFile(name: string, file: string | undefined): Promise<void> {
    const root = this.requireRoot();
    const key = CONFIG_KEYS.category;
    await this.configService.updateCustom(root, (custom) => {
      const raw = Array.isArray(custom[key]) ? [...(custom[key] as unknown[])] : [];
      const index = nameOf(raw, name);
      if (index === undefined) {
        return;
      }
      const entry = raw[index];
      const base: Record<string, unknown> =
        typeof entry === "object" && entry !== null
          ? { ...(entry as Record<string, unknown>) }
          : { name };
      if (file) {
        base.file = file;
      } else {
        delete base.file;
      }
      raw[index] = base;
      custom[key] = raw;
    });
    this.changeEmitter.fire(undefined);
  }

  /**
   * Checks a keyword typed by the user. An empty keyword is fine: it removes the keyword.
   * @param others the other entries of the same kind with their keywords, for the duplicate check.
   */
  validateKeyword(
    keyword: string,
    others: readonly { name: string; keyword: string }[]
  ): string | undefined {
    const trimmed = keyword.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const shortest = this.settings?.minKeywordLength ?? SettingDefaults.minKeywordLength;
    if (trimmed.length < shortest) {
      return Strings.quickNote.keywordTooShort(shortest);
    }
    if (trimmed.length > MAX_KEYWORD_LENGTH) {
      return Strings.quickNote.keywordTooLong(MAX_KEYWORD_LENGTH);
    }
    if (CONTROL_CHARACTERS.test(trimmed)) {
      return Strings.quickNote.keywordInvalid;
    }
    const clash = others.find(
      (entry) => entry.keyword.trim().toLowerCase() === trimmed.toLowerCase()
    );
    return clash ? Strings.quickNote.keywordAlreadyUsed(trimmed, clash.name) : undefined;
  }

  /**
   * Gives a category or tag a keyword, or (without `keyword`) takes it away. A tag stays a plain text in the config
   * file while it has no keyword; everything else stored with an entry is kept.
   * @throws RootMissingError without a notes folder, ConfigLockedError when the config file may not be changed.
   */
  async setKeyword(kind: LabelKind, name: string, keyword: string | undefined): Promise<void> {
    const root = this.requireRoot();
    const key = CONFIG_KEYS[kind];
    const clean = keyword?.trim();
    await this.configService.updateCustom(root, (custom) => {
      const raw = Array.isArray(custom[key]) ? [...(custom[key] as unknown[])] : [];
      const index = nameOf(raw, name);
      if (index === undefined) {
        return;
      }
      const entry = raw[index];
      const base: Record<string, unknown> =
        typeof entry === "object" && entry !== null
          ? { ...(entry as Record<string, unknown>) }
          : { name: entryName(entry) ?? name };
      if (clean) {
        base.keyword = clean;
      } else {
        delete base.keyword;
      }
      const onlyName = Object.keys(base).length === 1 && typeof base.name === "string";
      raw[index] = kind === "tag" && onlyName ? (base.name as string) : base;
      custom[key] = raw;
    });
    this.changeEmitter.fire(undefined);
  }

  /**
   * The tags a note gets by itself, while the Advanced mode is on: the tags whose keyword the note contains anywhere,
   * then (while "Auto create tag from pattern" is on) the text of the note that matches a tag pattern, each once.
   */
  async autoTagsFor(
    text: string,
    options: { ignoreAdvanced?: boolean; ignorePatternMode?: boolean } = {}
  ): Promise<string[]> {
    return (await this.getAutoTagger(options))(text);
  }

  /**
   * The lists read once, as a function that gives the tags for any text (the same rule as {@link autoTagsFor}). Run Tagging
   * uses it for every note of a file without reading the config file again each time.
   * @param options.ignoreAdvanced Run Tagging is asked for by the user, so it does not need the Advanced mode.
   * @param options.ignorePatternMode ... and it uses the tag patterns even while the button for them (which is about
   *   what happens by itself when a note is saved) is off.
   */
  async getAutoTagger(
    options: { ignoreAdvanced?: boolean; ignorePatternMode?: boolean } = {}
  ): Promise<(text: string) => string[]> {
    if (!options.ignoreAdvanced && !this.advancedMode.isEnabled) {
      return () => [];
    }
    const { tags, tagKeywords } = await this.getLabels();
    const withKeyword = tags.filter((tag) => tagKeywords[tag] !== undefined);
    const patterns =
      options.ignorePatternMode || this.autoTagPatterns?.isEnabled
        ? await this.getTagPatterns()
        : [];
    return (text: string): string[] => {
      const result = withKeyword.filter((tag) => containsKeyword(text, tagKeywords[tag]));
      if (patterns.length > 0) {
        const known = new Set(result.map((tag) => tag.toLowerCase()));
        for (const tag of findPatternTags(text, patterns, this.settings?.maxPatternTags)) {
          if (!known.has(tag.toLowerCase())) {
            known.add(tag.toLowerCase());
            result.push(tag);
          }
        }
      }
      return result;
    };
  }

  // ----- tag patterns -----

  /** The patterns stored in the config file (`custom.tagPatterns`), in the order they were added. */
  async getTagPatterns(): Promise<string[]> {
    const root = this.rootService.getRootUri();
    if (!root || !this.rootService.hasRoot) {
      return [];
    }
    const { config } = await this.configService.ensure(root);
    return readPatterns(config.custom[TAG_PATTERNS_KEY]);
  }

  /**
   * The regular expression sources of the patterns the page must preview: none while the mode is off. The page and the
   * extension use the same sources, so what is previewed is what is saved.
   */
  async getTagPatternSources(): Promise<string[]> {
    if (!this.autoTagPatterns?.isEnabled) {
      return [];
    }
    return (await this.getTagPatterns()).flatMap((pattern) => patternToRegExpSource(pattern) ?? []);
  }

  /**
   * Adds a tag pattern, or (with `replace`) gives an existing one another text. The pattern must be valid (see
   * `validateTagPattern`).
   * @throws RootMissingError without a notes folder, ConfigLockedError when the config file may not be changed.
   */
  async saveTagPattern(pattern: string, replace?: string): Promise<void> {
    const root = this.requireRoot();
    const clean = pattern.trim();
    await this.configService.updateCustom(root, (custom) => {
      const raw = Array.isArray(custom[TAG_PATTERNS_KEY])
        ? [...(custom[TAG_PATTERNS_KEY] as unknown[])]
        : [];
      const index =
        replace === undefined
          ? -1
          : raw.findIndex((entry) => typeof entry === "string" && entry.trim() === replace.trim());
      if (index >= 0) {
        raw[index] = clean;
      } else {
        raw.push(clean);
      }
      custom[TAG_PATTERNS_KEY] = raw;
    });
    this.changeEmitter.fire(undefined);
  }

  /** @throws the same errors as {@link saveTagPattern}. */
  async removeTagPattern(pattern: string): Promise<void> {
    const root = this.requireRoot();
    await this.configService.updateCustom(root, (custom) => {
      const raw = Array.isArray(custom[TAG_PATTERNS_KEY])
        ? (custom[TAG_PATTERNS_KEY] as unknown[])
        : [];
      custom[TAG_PATTERNS_KEY] = raw.filter(
        (entry) => !(typeof entry === "string" && entry.trim() === pattern.trim())
      );
    });
    this.changeEmitter.fire(undefined);
  }

  /**
   * Where a note goes: the category the user chose, or (when none is chosen) the category whose keyword the note
   * contains. When several keywords are in the note, the one that appears first in the text wins (the longer one when
   * they start at the same place). Only while the Advanced mode is on. `file` is undefined when the category has no
   * file of its own, or when there is no category: the Quick Note file is used then.
   */
  async getDestinationFor(text: string): Promise<{ category: string; file: string | undefined }> {
    if (!this.advancedMode.isEnabled) {
      return { category: "", file: undefined };
    }
    if (this.chosenCategory !== "") {
      return { category: this.chosenCategory, file: await this.getActiveCategoryFile() };
    }
    const { categories } = await this.getLabels();
    const found = categories
      .map((category) => ({
        category,
        at: category.keyword === undefined ? -1 : keywordPosition(text, category.keyword),
      }))
      .filter((entry) => entry.at >= 0)
      .sort(
        (a, b) =>
          a.at - b.at || (b.category.keyword?.length ?? 0) - (a.category.keyword?.length ?? 0)
      );
    return found.length > 0
      ? { category: found[0].category.name, file: found[0].category.file }
      : { category: "", file: undefined };
  }

  /**
   * Gives a category or tag another name. Everything else stored with it is kept, and when it is the
   * chosen one it stays chosen under the new name. The category keeps its file.
   * @throws NameConflictError when another entry already has the new name.
   * @throws RootMissingError without a notes folder, ConfigLockedError when the config file may not be changed.
   */
  async rename(kind: LabelKind, from: string, to: string): Promise<void> {
    const root = this.requireRoot();
    const key = CONFIG_KEYS[kind];
    const target = to.trim();
    let found = false;
    await this.configService.updateCustom(root, (custom) => {
      const raw = Array.isArray(custom[key]) ? [...(custom[key] as unknown[])] : [];
      const index = nameOf(raw, from);
      if (index === undefined) {
        return;
      }
      const clash = nameOf(raw, target);
      if (clash !== undefined && clash !== index) {
        throw new NameConflictError(target);
      }
      found = true;
      const entry = raw[index];
      raw[index] =
        typeof entry === "object" && entry !== null
          ? { ...(entry as Record<string, unknown>), name: target }
          : target;
      custom[key] = raw;
    });
    if (!found) {
      return;
    }
    const wasChosen =
      kind === "category" ? this.chosenCategory === from : this.chosenTags.includes(from);
    if (wasChosen) {
      if (kind === "category") {
        this.chosenCategory = target;
      } else {
        this.chosenTags = this.chosenTags.map((tag) => (tag === from ? target : tag));
      }
    }
    this.changeEmitter.fire(wasChosen ? { select: { kind, value: target } } : undefined);
    if (wasChosen) {
      this.selectionEmitter.fire();
    }
  }

  /**
   * Removes a category or tag from the list. Only the name goes: the file linked to a category is never
   * deleted. When it was the chosen one, nothing is chosen afterwards.
   * @throws RootMissingError without a notes folder, ConfigLockedError when the config file may not be changed.
   */
  async remove(kind: LabelKind, name: string): Promise<void> {
    const root = this.requireRoot();
    const key = CONFIG_KEYS[kind];
    let found = false;
    await this.configService.updateCustom(root, (custom) => {
      const raw = Array.isArray(custom[key]) ? [...(custom[key] as unknown[])] : [];
      const index = nameOf(raw, name);
      if (index === undefined) {
        return;
      }
      found = true;
      raw.splice(index, 1);
      custom[key] = raw;
    });
    if (!found) {
      return;
    }
    if (kind === "category" && this.chosenCategory === name) {
      this.chosenCategory = "";
      this.selectionEmitter.fire();
    } else if (kind === "tag" && this.chosenTags.includes(name)) {
      this.chosenTags = this.chosenTags.filter((tag) => tag !== name);
      this.selectionEmitter.fire();
    }
    this.changeEmitter.fire(undefined);
  }

  // ----- the chosen category and tag -----

  get selectedCategory(): string {
    return this.chosenCategory;
  }

  /** The chosen tags, none while the Advanced mode is off (then the box does not show them). */
  get activeTags(): readonly string[] {
    return this.advancedMode.isEnabled ? this.chosenTags : [];
  }

  /** Remembers the category the Quick Note box shows as chosen. Empty text means "nothing chosen". */
  setSelectedCategory(value: string): void {
    if (this.chosenCategory !== value) {
      this.chosenCategory = value;
      this.selectionEmitter.fire();
    }
  }

  /** Remembers the tags the box shows as chosen. Empty names and repeated names are dropped. */
  setSelectedTags(tags: readonly string[]): void {
    const clean = tags.filter((tag, index) => tag.trim() !== "" && tags.indexOf(tag) === index);
    if (clean.join("\n") !== this.chosenTags.join("\n")) {
      this.chosenTags = clean;
      this.selectionEmitter.fire();
    }
  }

  /**
   * The file notes must go to because of the chosen category, read from the config file now.
   * Undefined when the Advanced mode is off, no category is chosen, or the category has no file.
   */
  async getActiveCategoryFile(): Promise<string | undefined> {
    if (!this.advancedMode.isEnabled || this.chosenCategory === "") {
      return undefined;
    }
    const categories = await this.getChoosableCategories();
    return categories.find((category) => category.name === this.chosenCategory)?.file;
  }

  /** The same answer as {@link getActiveCategoryFile}, from the last time it was refreshed. */
  get activeCategoryFile(): string | undefined {
    return this.cachedActiveFile;
  }

  /** Reads the active category file again. Call after anything that can change it. */
  async refreshActive(): Promise<void> {
    try {
      this.cachedActiveFile = await this.getActiveCategoryFile();
    } catch {
      this.cachedActiveFile = undefined;
    }
  }

  dispose(): void {
    this.changeEmitter.dispose();
    this.selectionEmitter.dispose();
  }

  private requireRoot(): vscode.Uri {
    const root = this.rootService.getRootUri();
    if (!root || !this.rootService.hasRoot) {
      throw new RootMissingError();
    }
    return root;
  }
}

/** Stored data may have been edited by hand, so only texts are accepted, once each (any case). */
function readPatterns(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const patterns: string[] = [];
  for (const entry of value) {
    const pattern = typeof entry === "string" ? entry.trim() : "";
    if (pattern !== "" && !seen.has(pattern.toLowerCase())) {
      seen.add(pattern.toLowerCase());
      patterns.push(pattern);
    }
  }
  return patterns;
}

function labelsOf(custom: Record<string, unknown>): Labels {
  return {
    categories: readCategories(custom[CONFIG_KEYS.category]),
    tags: readNames(custom[CONFIG_KEYS.tag]),
    tagKeywords: readTagKeywords(custom[CONFIG_KEYS.tag]),
  };
}

/** The keyword stored with an entry, when it is a usable text. */
function keywordOf(entry: unknown): string | undefined {
  const value =
    typeof entry === "object" && entry !== null
      ? (entry as { keyword?: unknown }).keyword
      : undefined;
  const keyword = typeof value === "string" ? value.trim() : "";
  return keyword.length > 0 ? keyword : undefined;
}

function readTagKeywords(value: unknown): Record<string, string> {
  const keywords: Record<string, string> = {};
  if (Array.isArray(value)) {
    for (const entry of value) {
      const name = entryName(entry);
      const keyword = keywordOf(entry);
      if (name !== undefined && keyword !== undefined && keywords[name] === undefined) {
        keywords[name] = keyword;
      }
    }
  }
  return keywords;
}

/** The name of a stored entry: a plain text (older files) or an object with a `name`. */
function entryName(entry: unknown): string | undefined {
  const value = typeof entry === "string" ? entry : (entry as { name?: unknown } | null)?.name;
  const name = typeof value === "string" ? value.trim() : "";
  return name.length > 0 ? name : undefined;
}

/** Position of the entry with this name (any case) in a stored list, or undefined. */
function nameOf(raw: readonly unknown[], name: string): number | undefined {
  const wanted = name.toLowerCase();
  const index = raw.findIndex((entry) => entryName(entry)?.toLowerCase() === wanted);
  return index >= 0 ? index : undefined;
}

/** Stored data may have been edited by hand, so only entries with a text name are accepted, once each. */
function readCategories(value: unknown): Category[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const categories: Category[] = [];
  for (const entry of value) {
    const name = entryName(entry);
    if (name === undefined || seen.has(name)) {
      continue;
    }
    seen.add(name);
    const file =
      typeof entry === "object" && entry !== null ? (entry as { file?: unknown }).file : undefined;
    const trimmed = typeof file === "string" ? file.trim() : "";
    const keyword = keywordOf(entry);
    categories.push({
      name,
      ...(trimmed.length > 0 ? { file: trimmed } : {}),
      ...(keyword !== undefined ? { keyword } : {}),
    });
  }
  return categories.sort((a, b) => collator.compare(a.name, b.name));
}

function readNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  // A tag is a plain text, or an object with a `name` when it has a keyword.
  return value
    .map((entry) => entryName(entry))
    .filter((entry): entry is string => entry !== undefined)
    .filter((entry, index, all) => all.indexOf(entry) === index)
    .sort((a, b) => collator.compare(a, b));
}
