import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { Strings } from "../constants/strings";
import type { AutoCategoryService } from "../services/AutoCategoryService";
import type { AutoTagPatternService } from "../services/AutoTagPatternService";
import { LabelService, type Category, type LabelKind } from "../services/LabelService";
import { Logger } from "../services/Logger";
import { RootFolderService } from "../services/RootFolderService";
import { SettingsService } from "../services/SettingsService";
import { TagIndexService, type PatternTagFound, type TagNote } from "../services/TagIndexService";
import { NotesTreeProvider } from "./NotesTreeProvider";

/** Context values, used by the menus of the view in package.json. */
export const LabelContexts = {
  categoryGroup: "noteRoot.labelGroup.category",
  tagGroup: "noteRoot.labelGroup.tag",
  category: "noteRoot.label.category",
  tag: "noteRoot.label.tag",
  categoryFile: "noteRoot.categoryFile",
  /** Added to the context value of a category that has a file / of an entry that has a keyword, in this order. */
  hasFile: ".hasFile",
  hasKeyword: ".hasKeyword",
  autoGroup: "noteRoot.autoGroup",
  patternGroup: "noteRoot.patternGroup",
  tagPattern: "noteRoot.tagPattern",
  patternTag: "noteRoot.patternTag",
  patternEmpty: "noteRoot.patternEmpty",
  autoCategory: "noteRoot.autoCategory",
  tagNote: "noteRoot.tagNote",
} as const;

/** After a change of files the tag scan runs again, but not more often than this. */
const FILES_REFRESH_DELAY_MS = 1500;

/** "Categories" or "Tags": the two groups at the top of the view. */
export class LabelGroupItem extends vscode.TreeItem {
  constructor(
    readonly kind: LabelKind,
    count: number
  ) {
    super(
      kind === "category" ? Strings.labelsView.categories : Strings.labelsView.tags,
      // Categories are cheap, so they start open. Tags need a scan of the notes, which waits until asked.
      kind === "category"
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.id = `group:${kind}`;
    this.description = String(count);
    this.contextValue = kind === "category" ? LabelContexts.categoryGroup : LabelContexts.tagGroup;
  }
}

/**
 * One category or one tag. A category opens to its file, a tag to the notes that use it. Every category
 * is collapsible, like the tags: a row without a twistie is drawn further left than one with it.
 */
export class LabelEntryItem extends vscode.TreeItem {
  /** For a category: the file stored with it (relative to the notes folder), if it has one. */
  readonly file: string | undefined;

  constructor(
    readonly kind: LabelKind,
    readonly name: string,
    options: { file?: string; noteCount?: number; keyword?: string }
  ) {
    super(
      kind === "tag" ? `#${name}` : name,
      kind === "category" || (options.noteCount ?? 0) > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );
    this.file = options.file;
    this.id = `${kind}:${name}`;
    // The menu shows "Remove File" and "Remove Keyword" only for an entry that has one: the context value says so.
    this.contextValue =
      (kind === "category" ? LabelContexts.category : LabelContexts.tag) +
      (kind === "category" && options.file ? LabelContexts.hasFile : "") +
      (options.keyword ? LabelContexts.hasKeyword : "");
    if (kind === "category") {
      this.iconPath = new vscode.ThemeIcon("notebook");
      const where = options.file ?? Strings.labelsView.usesQuickNoteFile;
      this.description = options.keyword
        ? Strings.quickNote.withKeyword(where, options.keyword)
        : where;
      this.tooltip = options.file
        ? Strings.labelsView.categoryFileTooltip(name, options.file)
        : Strings.labelsView.usesQuickNoteFileTooltip(name);
      if (options.keyword) {
        this.tooltip += `\n${Strings.labelsView.keywordTooltip(options.keyword)}`;
      }
    } else {
      this.iconPath = new vscode.ThemeIcon("tag");
      const count = Strings.labelsView.noteCount(options.noteCount ?? 0);
      this.description = options.keyword
        ? Strings.quickNote.withKeyword(count, options.keyword)
        : count;
      if (options.keyword) {
        this.tooltip = Strings.labelsView.keywordTooltip(options.keyword);
      }
    }
  }
}

/** "Tag Patterns": under the Tags. The patterns whose text in a note becomes a tag, with a + to add one. */
export class PatternGroupItem extends vscode.TreeItem {
  constructor(count: number, enabled: boolean) {
    // Counting what the patterns made needs a scan of the notes, so it waits until asked, like the Tags.
    super(Strings.labelsView.patterns, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = "group:patterns";
    this.description = enabled
      ? String(count)
      : `${count} \u00b7 ${Strings.labelsView.patternsOff}`;
    this.tooltip = Strings.labelsView.patternsGroupTooltip(enabled);
    this.contextValue = LabelContexts.patternGroup;
  }
}

/**
 * One tag pattern such as `ab-*`, in the same format as a category or a tag: a collapsible row with a count, that
 * opens to what it found. It is always collapsible, like the others, so that the rows line up.
 */
export class PatternItem extends vscode.TreeItem {
  constructor(
    readonly pattern: string,
    tagCount: number
  ) {
    super(pattern, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `pattern:${pattern}`;
    this.iconPath = new vscode.ThemeIcon("regex");
    this.description = Strings.labelsView.patternTagCount(tagCount);
    this.tooltip = Strings.labelsView.patternTooltip(pattern);
    this.contextValue = LabelContexts.tagPattern;
  }
}

/** A tag a pattern made in notes, like a tag of the Tags group: its notes are below it. */
export class PatternTagItem extends vscode.TreeItem {
  constructor(
    readonly pattern: string,
    readonly found: PatternTagFound
  ) {
    super(`#${found.name}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `pattag:${pattern}:${found.name.toLowerCase()}`;
    this.iconPath = new vscode.ThemeIcon("tag");
    this.description = Strings.labelsView.noteCount(found.notes.length);
    this.contextValue = LabelContexts.patternTag;
  }
}

/** Shown under a pattern that has not matched anything yet, so the row can still be opened. */
export class PatternEmptyItem extends vscode.TreeItem {
  constructor(pattern: string) {
    super(Strings.labelsView.noMatchesYet, vscode.TreeItemCollapsibleState.None);
    this.id = `patempty:${pattern}`;
    this.iconPath = new vscode.ThemeIcon("circle-slash");
    this.tooltip = Strings.labelsView.noMatchesYetTooltip;
    this.contextValue = LabelContexts.patternEmpty;
  }
}

/** "Every file": the categories made from the note files, while that mode is on. */
export class AutoGroupItem extends vscode.TreeItem {
  constructor(count: number, truncated: boolean) {
    super(Strings.labelsView.autoGroup, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = "group:auto";
    this.description = `${count}${truncated ? "+" : ""}`;
    this.iconPath = new vscode.ThemeIcon("files");
    this.tooltip = Strings.labelsView.autoGroupTooltip(count, truncated);
    this.contextValue = LabelContexts.autoGroup;
  }
}

/** A category made from a file. A click opens the file. */
export class AutoCategoryItem extends vscode.TreeItem {
  constructor(category: Category, uri: vscode.Uri | undefined) {
    super(category.label ?? category.name, vscode.TreeItemCollapsibleState.None);
    this.id = `auto:${category.name}`;
    this.contextValue = LabelContexts.autoCategory;
    if (uri) {
      // The file icon theme picks the icon, like in the notes tree.
      this.resourceUri = uri;
      this.command = { command: Commands.openItem, title: Strings.tree.open, arguments: [uri] };
    }
    // The row shows the file name only; the tooltip has the whole path.
    this.tooltip = category.file ?? category.name;
  }
}

/** The file a category writes to, under the category. A click opens it. It may not exist yet. */
export class CategoryFileItem extends vscode.TreeItem {
  constructor(
    readonly category: string,
    readonly relativePath: string,
    uri: vscode.Uri | undefined
  ) {
    super(
      relativePath.slice(relativePath.lastIndexOf("/") + 1),
      vscode.TreeItemCollapsibleState.None
    );
    this.id = `categoryfile:${category}`;
    this.contextValue = LabelContexts.categoryFile;
    const slash = relativePath.lastIndexOf("/");
    const folder = slash > 0 ? relativePath.slice(0, slash) : undefined;
    if (uri) {
      // The file icon theme picks the icon, like in the notes tree.
      this.resourceUri = uri;
      this.description = folder;
      this.command = { command: Commands.openItem, title: Strings.tree.open, arguments: [uri] };
    } else {
      // The first note of the category creates it.
      this.iconPath = new vscode.ThemeIcon("new-file");
      this.description = Strings.labelsView.notCreatedYetShort;
    }
    this.tooltip = Strings.labelsView.categoryFileTooltip(category, relativePath);
  }
}

/** A note that uses a tag. A click opens it at the tag. */
export class TagNoteItem extends vscode.TreeItem {
  constructor(
    readonly tag: string,
    readonly note: TagNote,
    /** Tells the notes of a tag from the notes of a tag a pattern made: both can have the same name. */
    idPrefix = "tagnote"
  ) {
    super(note.uri, vscode.TreeItemCollapsibleState.None);
    this.id = `${idPrefix}:${tag}:${note.relativePath}`;
    const slash = note.relativePath.lastIndexOf("/");
    this.description = slash > 0 ? note.relativePath.slice(0, slash) : undefined;
    this.tooltip = Strings.labelsView.tagNoteTooltip(note.relativePath, note.line + 1);
    this.contextValue = LabelContexts.tagNote;
    this.command = {
      command: Commands.openAtLine,
      title: Strings.tree.open,
      arguments: [note.uri, note.line, note.column, note.length],
    };
  }
}

export type LabelNode =
  | LabelGroupItem
  | LabelEntryItem
  | CategoryFileItem
  | TagNoteItem
  | AutoGroupItem
  | AutoCategoryItem
  | PatternGroupItem
  | PatternItem
  | PatternTagItem
  | PatternEmptyItem;

/**
 * "Tags & Categories": the categories (each opens to the file its notes go to) and the tags (each opens to
 * the notes that use it). The lists come from the config file, the notes of a tag from a scan that runs
 * when the Tags group is opened and is kept until the files or the lists change.
 */
export class LabelsTreeProvider implements vscode.TreeDataProvider<LabelNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly subscriptions: vscode.Disposable[];
  private scan: Promise<Map<string, TagNote[]>> | undefined;
  private patternScan: Promise<Map<string, PatternTagFound[]>> | undefined;
  private filesTimer: NodeJS.Timeout | undefined;

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly labelService: LabelService,
    private readonly tagIndex: TagIndexService,
    private readonly treeProvider: NotesTreeProvider,
    private readonly rootService: RootFolderService,
    private readonly settings: SettingsService,
    private readonly autoCategories: AutoCategoryService,
    private readonly autoTagPatterns: AutoTagPatternService,
    private readonly logger: Logger
  ) {
    this.subscriptions = [
      this.changeEmitter,
      labelService.onDidChange(() => this.refresh()),
      rootService.onDidChangeRoot(() => this.refresh()),
      rootService.onDidChangeState(() => this.refresh()),
      // The notes of a tag change when files change, but only worth a new scan when the scan was used.
      // The file of a category appears when its first note is written, so that is a change too.
      rootService.onDidChangeFiles(() => {
        clearTimeout(this.filesTimer);
        this.filesTimer = setTimeout(() => this.refresh(), FILES_REFRESH_DELAY_MS);
      }),
    ];
  }

  /** Forgets the last scan and shows everything again. */
  refresh(): void {
    clearTimeout(this.filesTimer);
    this.scan = undefined;
    this.patternScan = undefined;
    this.changeEmitter.fire();
  }

  getTreeItem(element: LabelNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: LabelNode): Promise<LabelNode[]> {
    if (!this.rootService.hasRoot) {
      return [];
    }
    try {
      if (!element) {
        const { categories, tags } = await this.labelService.getLabels();
        const patterns = await this.labelService.getTagPatterns();
        return [
          new LabelGroupItem("category", categories.length),
          new LabelGroupItem("tag", tags.length),
          new PatternGroupItem(patterns.length, this.autoTagPatterns.isEnabled),
        ];
      }
      if (element instanceof PatternGroupItem) {
        const patterns = await this.labelService.getTagPatterns();
        const found = await this.currentPatternScan(patterns);
        return patterns.map((pattern) => new PatternItem(pattern, found.get(pattern)?.length ?? 0));
      }
      if (element instanceof PatternItem) {
        const found = (await this.currentPatternScan()).get(element.pattern) ?? [];
        return found.length === 0
          ? [new PatternEmptyItem(element.pattern)]
          : found.map((entry) => new PatternTagItem(element.pattern, entry));
      }
      if (element instanceof PatternTagItem) {
        return element.found.notes.map(
          (note) => new TagNoteItem(element.found.name, note, `patnote:${element.pattern}`)
        );
      }
      if (element instanceof LabelGroupItem) {
        return element.kind === "category" ? await this.categoryItems() : await this.tagItems();
      }
      if (element instanceof AutoGroupItem) {
        return await this.autoCategoryItems();
      }
      if (element instanceof LabelEntryItem && element.kind === "category") {
        return [await this.categoryFileItem(element)];
      }
      if (element instanceof LabelEntryItem && element.kind === "tag") {
        const notes = (await this.currentScan()).get(element.name) ?? [];
        return notes.map((note) => new TagNoteItem(element.name, note));
      }
    } catch (error) {
      this.logger.warn(
        `Could not read the tags and categories: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return [];
  }

  private async categoryItems(): Promise<LabelNode[]> {
    const { categories } = await this.labelService.getLabels();
    const items: LabelNode[] = categories.map(
      (category) =>
        new LabelEntryItem("category", category.name, {
          file: category.file,
          keyword: category.keyword,
        })
    );
    // While every file is a category, they are listed after the ones the user made, in a group of their own.
    const fromFiles = await this.categoriesFromFiles(categories.length);
    if (fromFiles.length > 0) {
      items.push(new AutoGroupItem(fromFiles.length, this.autoCategories.truncated));
    }
    return items;
  }

  /** The categories made from files that can really be chosen: a stored category with the same name hides the file. */
  private async categoriesFromFiles(storedCount?: number): Promise<Category[]> {
    const stored = storedCount ?? (await this.labelService.getLabels()).categories.length;
    return (await this.labelService.getChoosableCategories()).slice(stored);
  }

  private async autoCategoryItems(): Promise<AutoCategoryItem[]> {
    const root = this.rootService.getRootUri();
    return (await this.categoriesFromFiles()).map(
      (category) =>
        new AutoCategoryItem(
          category,
          root && category.file ? vscode.Uri.joinPath(root, ...category.file.split("/")) : undefined
        )
    );
  }

  /** Its own file, or the Quick Note file when it has none: that is where its notes go. */
  private async categoryFileItem(category: LabelEntryItem): Promise<CategoryFileItem> {
    const relativePath =
      category.file ?? this.settings.quickNoteFile.replace(/\\/g, "/").replace(/^(\.?\/)+/, "");
    const file = await this.treeProvider.resolveItem(relativePath);
    return new CategoryFileItem(
      category.name,
      relativePath,
      file?.kind === "file" ? file.uri : undefined
    );
  }

  private async tagItems(): Promise<LabelEntryItem[]> {
    const { tags, tagKeywords } = await this.labelService.getLabels();
    const notes = await this.currentScan(tags);
    return tags.map(
      (name) =>
        new LabelEntryItem("tag", name, {
          noteCount: notes.get(name)?.length ?? 0,
          keyword: tagKeywords[name],
        })
    );
  }

  /** What the patterns made in the notes, kept until the next refresh like the scan of the tags. */
  private async currentPatternScan(
    known?: readonly string[]
  ): Promise<Map<string, PatternTagFound[]>> {
    if (!this.patternScan) {
      const patterns = known ?? (await this.labelService.getTagPatterns());
      const running = this.tagIndex.scanPatterns(patterns);
      this.patternScan = running;
      running.catch(() => {
        if (this.patternScan === running) {
          this.patternScan = undefined;
        }
      });
    }
    return this.patternScan;
  }

  private async currentScan(known?: readonly string[]): Promise<Map<string, TagNote[]>> {
    if (!this.scan) {
      const names = known ?? (await this.labelService.getLabels()).tags;
      const running = this.tagIndex.scan(names);
      this.scan = running;
      // A failed scan is not kept, so the next look tries again.
      running.catch(() => {
        if (this.scan === running) {
          this.scan = undefined;
        }
      });
    }
    return this.scan;
  }

  dispose(): void {
    clearTimeout(this.filesTimer);
    vscode.Disposable.from(...this.subscriptions).dispose();
  }
}
