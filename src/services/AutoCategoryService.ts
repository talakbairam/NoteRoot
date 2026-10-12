import * as vscode from "vscode";
import { BuiltinCommands } from "../constants/commands";
import { ContextKeys, StateKeys } from "../constants/context";
import { SettingDefaults, SettingKeys } from "../constants/settings";
import type { Category } from "./LabelService";
import { Logger } from "./Logger";
import { RootFolderService } from "./RootFolderService";
import { SearchService } from "./SearchService";
import { SettingsService } from "./SettingsService";

// At most `settings.maxAutoCategories` files become categories: a dropdown with thousands of entries is of no use.
/** A longer path is left out: the page accepts names up to 200 characters. */
const MAX_AUTO_NAME_LENGTH = 150;
/** After files changed, the list is made again, but not more often than this. */
const FILES_CHANGE_DELAY_MS = 1000;

/** Files that are notes. Other files (images, documents, archives, code) are not offered as categories. The list is a setting of the notes folder. */
const DEFAULT_TEXT_EXTENSIONS: ReadonlySet<string> = new Set(SettingDefaults.noteFileTypes);

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** True for the files that become categories: notes written as text, by their extension. */
export function isNoteFile(
  name: string,
  extensions: ReadonlySet<string> = DEFAULT_TEXT_EXTENSIONS
): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && extensions.has(name.slice(dot + 1).toLowerCase());
}

/**
 * The category of each file. Its `name` is its path without the extension (`projects/ideas`), or the whole path when two
 * files would get the same name (`a.md` and `a.txt`); it identifies the category. Its `label`, what the lists show, is just
 * the file name without the extension (`ideas`), or the `name` when two files would show the same label.
 * Pure on purpose, so it can be checked without VS Code.
 * @param paths paths relative to the notes folder, `/`-separated.
 */
export function categoriesForFiles(paths: readonly string[]): Category[] {
  const withoutExtension = (path: string): string => {
    const dot = path.lastIndexOf(".");
    return dot > path.lastIndexOf("/") + 1 ? path.slice(0, dot) : path;
  };
  const uses = new Map<string, number>();
  for (const path of paths) {
    const key = withoutExtension(path).toLowerCase();
    uses.set(key, (uses.get(key) ?? 0) + 1);
  }
  const named: { name: string; file: string; label: string }[] = [];
  for (const path of paths) {
    const short = withoutExtension(path);
    const name = (uses.get(short.toLowerCase()) ?? 0) > 1 ? path : short;
    if (name.length <= MAX_AUTO_NAME_LENGTH && !CONTROL_CHARACTERS.test(name)) {
      // The file name, without the folders and, when the name is the short path, without the extension.
      const label = name.slice(name.lastIndexOf("/") + 1);
      named.push({ name, file: path, label });
    }
  }
  const labelUses = new Map<string, number>();
  for (const entry of named) {
    labelUses.set(entry.label.toLowerCase(), (labelUses.get(entry.label.toLowerCase()) ?? 0) + 1);
  }
  return named.map(({ name, file, label }) =>
    (labelUses.get(label.toLowerCase()) ?? 0) > 1 ? { name, file } : { name, file, label }
  );
}

/**
 * The "Auto create category for every file" switch. While it is on, every note file in the notes folder is
 * offered as a category that writes to that file. These categories are worked out from the files each time, so
 * they are never stored: adding, renaming or deleting a file changes them by itself, and switching the mode off
 * leaves nothing behind in the config file.
 *
 * The state is remembered per machine and published as a context key, which swaps the title bar button
 * between "turn on" and "turn off".
 */
export class AutoCategoryService implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly subscriptions: vscode.Disposable[];
  /** What the user chose on this machine; undefined until then (the setting of the notes folder gives the start state). */
  private stored: boolean | undefined;
  private cache: Promise<Category[]> | undefined;
  /** The names of the last list, to tell a real change from a notification about files that do not matter. */
  private lastNames = "";
  private timer: NodeJS.Timeout | undefined;
  private wasTruncated = false;

  /** Fires when the mode is switched, and when the list changed because of files or another notes folder. */
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private readonly memento: vscode.Memento,
    rootService: RootFolderService,
    private readonly searchService: SearchService,
    private readonly logger: Logger,
    private readonly settings: SettingsService
  ) {
    const value = memento.get<unknown>(StateKeys.autoCategories);
    this.stored = typeof value === "boolean" ? value : undefined;
    this.subscriptions = [
      this.changeEmitter,
      rootService.onDidChangeRoot(() => this.listChanged(0)),
      rootService.onDidChangeFiles(() => this.listChanged(FILES_CHANGE_DELAY_MS)),
      settings.onDidChange((event) => {
        if (
          SettingsService.affects(event, SettingKeys.noteFileTypes) ||
          SettingsService.affects(event, SettingKeys.maxAutoCategories)
        ) {
          this.listChanged(0);
        }
        if (
          this.stored === undefined &&
          SettingsService.affects(event, SettingKeys.startAutoCategoriesOn)
        ) {
          this.cache = undefined;
          this.lastNames = "";
          void this.publish().then(() => this.changeEmitter.fire());
        }
      }),
    ];
  }

  get isEnabled(): boolean {
    return this.stored ?? this.settings.startAutoCategoriesOn;
  }

  /** True when there were more files than `maxAutoCategories`, so some have no category. */
  get truncated(): boolean {
    return this.wasTruncated;
  }

  /** Publishes the stored state as a context key. Call once at activation. */
  async initialize(): Promise<void> {
    await this.publish();
  }

  async setEnabled(value: boolean): Promise<void> {
    const changed = value !== this.isEnabled;
    this.stored = value;
    await this.memento.update(StateKeys.autoCategories, value);
    if (changed) {
      this.cache = undefined;
      this.lastNames = "";
      await this.publish();
      this.changeEmitter.fire();
    }
  }

  /** One category per note file, sorted by path. Empty while the mode is off or there is no notes folder. */
  list(): Promise<Category[]> {
    if (!this.isEnabled) {
      return Promise.resolve([]);
    }
    this.cache ??= this.compute();
    return this.cache;
  }

  dispose(): void {
    clearTimeout(this.timer);
    vscode.Disposable.from(...this.subscriptions).dispose();
  }

  private async compute(): Promise<Category[]> {
    const paths: string[] = [];
    const extensions = new Set(this.settings.noteFileTypes);
    try {
      for await (const file of this.searchService.walkFiles()) {
        if (isNoteFile(file.name, extensions)) {
          paths.push(file.relativePath);
        }
      }
    } catch (error) {
      // No notes folder, or it vanished: there is nothing to offer.
      this.logger.debug(
        `No categories from files: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
    paths.sort((a, b) => collator.compare(a, b));
    const limit = this.settings.maxAutoCategories;
    this.wasTruncated = paths.length > limit;
    const categories = categoriesForFiles(paths.slice(0, limit));
    this.lastNames = categories.map((category) => `${category.name}\n${category.file}`).join("\n");
    return categories;
  }

  /** Files or the notes folder changed: make the list again, and tell the others only if it is different. */
  private listChanged(delayMs: number): void {
    if (!this.isEnabled) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const before = this.lastNames;
      this.cache = undefined;
      this.list()
        .then((categories) => {
          const after = categories
            .map((category) => `${category.name}\n${category.file}`)
            .join("\n");
          if (after !== before) {
            this.changeEmitter.fire();
          }
        })
        .catch((error: unknown) =>
          this.logger.warn(`Could not update the categories from files: ${String(error)}`)
        );
    }, delayMs);
  }

  private async publish(): Promise<void> {
    await vscode.commands.executeCommand(
      BuiltinCommands.setContext,
      ContextKeys.autoCategories,
      this.isEnabled
    );
  }
}
