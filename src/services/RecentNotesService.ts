import * as vscode from "vscode";
import { SettingKeys } from "../constants/settings";
import { uriOfTab } from "../util/tabUri";
import { ExcludeMatcher } from "./ExcludeMatcher";
import { PathGuard } from "./PathGuard";
import { RootFolderService } from "./RootFolderService";
import { SettingsService } from "./SettingsService";
import { StateService } from "./StateService";

/** Puts `path` first, drops an older copy of it, and keeps at most `max` entries. */
export function pushRecent(list: readonly string[], path: string, max: number): string[] {
  return [path, ...list.filter((entry) => entry !== path)].slice(0, max);
}

/**
 * Applies a rename or move to the list. Entries at or below `oldPath` follow to `newPath`;
 * with no `newPath` (the item left the notes folder) they are dropped.
 */
export function renameRecent(
  list: readonly string[],
  oldPath: string,
  newPath: string | undefined
): string[] {
  const result: string[] = [];
  for (const entry of list) {
    if (entry === oldPath || entry.startsWith(`${oldPath}/`)) {
      if (newPath !== undefined) {
        result.push(newPath + entry.slice(oldPath.length));
      }
    } else {
      result.push(entry);
    }
  }
  return result.filter((entry, index) => result.indexOf(entry) === index);
}

/**
 * Remembers the notes the user opened last, per notes folder (stored on this machine, never in the
 * notes folder). Opening a note in any editor tab counts, including images and PDFs.
 */
export class RecentNotesService implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private entries: string[] = [];
  private loadedKey: string | undefined;

  /** Fires when the list changed. */
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private readonly rootService: RootFolderService,
    private readonly pathGuard: PathGuard,
    private readonly excludeMatcher: ExcludeMatcher,
    private readonly stateService: StateService,
    private readonly settings: SettingsService
  ) {
    this.subscriptions.push(
      this.changeEmitter,
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        for (const tab of [...event.opened, ...event.changed]) {
          if (tab.isActive) {
            this.recordTab(tab);
          }
        }
      }),
      vscode.workspace.onDidRenameFiles((event) => {
        for (const { oldUri, newUri } of event.files) {
          this.applyRename(oldUri, newUri);
        }
      }),
      rootService.onDidChangeRoot(() => this.changeEmitter.fire()),
      settings.onDidChange((event) => {
        if (SettingsService.affects(event, SettingKeys.maxRecentNotes)) {
          this.changeEmitter.fire();
        }
      })
    );
    // Whatever is open when VS Code starts counts as recent too.
    for (const group of vscode.window.tabGroups.all) {
      if (group.activeTab) {
        this.recordTab(group.activeTab);
      }
    }
  }

  /** Paths relative to the root, newest first. */
  list(): readonly string[] {
    this.sync();
    // The limit may have been lowered since the list was stored.
    return this.entries.slice(0, this.settings.maxRecentNotes);
  }

  /** @param silent do not notify listeners: for use while the list itself is being read. */
  remove(path: string, options: { silent?: boolean } = {}): void {
    this.sync();
    if (this.entries.includes(path)) {
      this.update(
        this.entries.filter((entry) => entry !== path),
        options.silent
      );
    }
  }

  clear(): void {
    this.sync();
    this.update([]);
  }

  dispose(): void {
    vscode.Disposable.from(...this.subscriptions).dispose();
  }

  private recordTab(tab: vscode.Tab): void {
    const uri = uriOfTab(tab);
    const relativePath =
      uri && this.pathGuard.isInsideRoot(uri, { allowRoot: false })
        ? this.pathGuard.getRelativePath(uri)
        : undefined;
    if (relativePath && !this.isHidden(relativePath)) {
      this.sync();
      this.update(pushRecent(this.entries, relativePath, this.settings.maxRecentNotes));
    }
  }

  private applyRename(oldUri: vscode.Uri, newUri: vscode.Uri): void {
    const oldPath = this.pathGuard.getRelativePath(oldUri);
    if (!oldPath) {
      return;
    }
    this.sync();
    const updated = renameRecent(this.entries, oldPath, this.pathGuard.getRelativePath(newUri));
    if (updated.join("\n") !== this.entries.join("\n")) {
      this.update(updated);
    }
  }

  /** Files the tree hides (`.git`, `.noteroot`, ...) never belong in the list. */
  private isHidden(relativePath: string): boolean {
    const segments = relativePath.split("/");
    return segments.some((segment, index) =>
      this.excludeMatcher.isExcluded(segment, segments.slice(0, index + 1).join("/"))
    );
  }

  private currentKey(): string {
    return this.rootService.getRootUri()?.fsPath ?? "";
  }

  /** Loads the list of the current root when the root changed. */
  private sync(): void {
    const key = this.currentKey();
    if (key !== this.loadedKey) {
      this.loadedKey = key;
      this.entries = key ? this.stateService.getRecent(key) : [];
    }
  }

  private update(entries: string[], silent = false): void {
    this.entries = entries;
    const key = this.currentKey();
    if (key) {
      this.stateService.setRecent(key, entries);
    }
    if (!silent) {
      this.changeEmitter.fire();
    }
  }
}
