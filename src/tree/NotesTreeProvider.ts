import * as vscode from "vscode";
import { RootStates } from "../constants/context";
import { ConfigFile, SettingKeys } from "../constants/settings";
import { Strings } from "../constants/strings";
import { ExcludeMatcher } from "../services/ExcludeMatcher";
import { Logger } from "../services/Logger";
import { PathGuard } from "../services/PathGuard";
import { RootFolderService } from "../services/RootFolderService";
import { SettingsService } from "../services/SettingsService";
import type { SyncHub } from "../services/SyncHub";
import type { SyncConnection, SyncService } from "../services/SyncService";
import { ShowHiddenService } from "../services/ShowHiddenService";
import { ShowEncryptedService } from "../services/ShowEncryptedService";
import { ShowUnsyncedService } from "../services/ShowUnsyncedService";
import { ShowNoTagService } from "../services/ShowNoTagService";
import { countChanges } from "../services/SyncPlan";
import { formatBytes } from "../util/format";
import { kindFromFileType, NoteItem } from "./NoteItem";
import {
  GroupSpacerItem,
  PinnedRecentGroupItem,
  SyncStatusItem,
  type NotesNode,
  type SyncRowState,
} from "./NotesNode";
import type { PinnedRecentProvider } from "./PinnedRecentProvider";

// Natural, case-insensitive order: "note2" before "note10", "a" next to "A".
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/**
 * Explorer-like view of the notes root. Folders are read only when expanded,
 * and `getChildren` makes a single `readDirectory` call without any `stat`
 * (only the "modified" sort order needs the time of every entry, so it stats them).
 */
export class NotesTreeProvider implements vscode.TreeDataProvider<NotesNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<NotesNode | undefined>();
  private readonly subscriptions: vscode.Disposable[] = [];
  /** The sync, for the row at the top of the tree, and where the icons of the row are (see `attachSync`). */
  private sync: SyncHub | undefined;
  private syncIcons: ((providerId: string) => Record<SyncRowState, vscode.Uri>) | undefined;
  /** What the row showed last: the tree is refreshed only when it changes. */
  private syncSignature = "";
  /** Supplies the "Pinned" and "Recent" groups at the top of the tree. It needs this provider too, so it is attached afterwards. */
  private pinnedRecent: PinnedRecentProvider | undefined;

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly rootService: RootFolderService,
    private readonly pathGuard: PathGuard,
    private readonly excludeMatcher: ExcludeMatcher,
    private readonly settings: SettingsService,
    private readonly logger: Logger,
    private readonly showHidden: ShowHiddenService,
    private readonly noTagMatcher: ExcludeMatcher,
    private readonly showNoTag: ShowNoTagService,
    private readonly encryptMatcher: ExcludeMatcher,
    private readonly showEncrypted: ShowEncryptedService,
    private readonly syncIgnoreMatcher: ExcludeMatcher,
    private readonly showUnsynced: ShowUnsyncedService
  ) {
    this.subscriptions.push(
      this.changeEmitter,
      // Ids are stable relative paths, so a full refresh keeps expanded folders expanded.
      rootService.onDidChangeFiles(() => this.refresh()),
      rootService.onDidChangeRoot(() => this.refresh()),
      rootService.onDidChangeState(() => this.refresh()),
      excludeMatcher.onDidChange(() => this.refresh()),
      showHidden.onDidChange(() => this.refresh()),
      showNoTag.onDidChange(() => this.refresh()),
      noTagMatcher.onDidChange(() => this.refresh()),
      encryptMatcher.onDidChange(() => this.refresh()),
      showEncrypted.onDidChange(() => this.refresh()),
      syncIgnoreMatcher.onDidChange(() => this.refresh()),
      showUnsynced.onDidChange(() => this.refresh()),
      settings.onDidChange((event) => {
        // The Quick Note file gets its own context value.
        if (
          SettingsService.affects(event, SettingKeys.quickNoteFile) ||
          SettingsService.affects(event, SettingKeys.sortOrder) ||
          SettingsService.affects(event, SettingKeys.sortReversed) ||
          SettingsService.affects(event, SettingKeys.syncRows)
        ) {
          this.refresh();
        }
      })
    );
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  /** Shows the groups of Pinned and Recent notes above the folders; the tree is refreshed when they change. */
  attachPinnedRecent(provider: PinnedRecentProvider): void {
    this.pinnedRecent = provider;
    this.subscriptions.push(provider.onDidChangeTreeData(() => this.refresh()));
  }

  /** Shows the state of the sync as the first row of the tree; the tree is refreshed when that state changes. */
  attachSync(sync: SyncHub, extensionUri: vscode.Uri): void {
    this.sync = sync;
    const icon = (name: string): vscode.Uri =>
      vscode.Uri.joinPath(extensionUri, "media", "sync", name);
    // Every service has its own marks, `media/sync/sync-<id>-<state>.svg`.
    this.syncIcons = (providerId) => ({
      off: icon(`sync-${providerId}-off.svg`),
      clean: icon(`sync-${providerId}-ok.svg`),
      dirty: icon(`sync-${providerId}-changes.svg`),
    });
    this.syncSignature = this.syncSignatureOf(this.syncRows());
    this.subscriptions.push(
      sync.onDidChange(() => {
        const signature = this.syncSignatureOf(this.syncRows());
        if (signature !== this.syncSignature) {
          this.syncSignature = signature;
          this.refresh();
        }
      })
    );
  }

  /**
   * The rows of the sync for the setting `syncRows`: one for every service (the ones that are connected show their state, the
   * others say they are not connected), only the connected ones, or none.
   */
  private syncRows(): SyncStatusItem[] {
    if (!this.sync || !this.syncIcons) {
      return [];
    }
    const mode = this.settings.syncRows;
    if (mode === "none") {
      return [];
    }
    const text = Strings.syncRow;
    const rows: SyncStatusItem[] = [];
    for (const service of this.sync.services) {
      const provider = service.provider;
      const connection = service.connection;
      if (connection) {
        rows.push(this.connectedRow(connection, service, this.syncIcons(provider.id)));
      } else if (mode === "all") {
        rows.push(
          new SyncStatusItem(
            provider.id,
            "off",
            text.label(provider.label),
            text.notConnected,
            text.connectTip,
            this.syncIcons(provider.id)
          )
        );
      }
    }
    return rows;
  }

  /** The row of the connected service: in sync, or something to push or pull. */
  private connectedRow(
    connection: SyncConnection,
    sync: SyncService,
    icons: Record<SyncRowState, vscode.Uri>
  ): SyncStatusItem {
    const text = Strings.syncRow;
    const snapshot = sync.snapshot;
    const status = snapshot.status;
    const counts = status ? countChanges(status) : { push: 0, pull: 0, conflicts: 0 };
    const local = counts.push;
    const remote = counts.pull;
    const conflicts = counts.conflicts;
    const label = text.label(connection.provider.label);
    const id = connection.provider.id;
    if (local + remote + conflicts > 0 || snapshot.hasNewVersion) {
      return new SyncStatusItem(
        id,
        "dirty",
        label,
        snapshot.hasNewVersion && local + remote + conflicts === 0
          ? Strings.sync.newVersion(connection.provider.versionNoun)
          : Strings.sync.refreshed(local, remote, conflicts),
        text.dirtyTip,
        icons
      );
    }
    return new SyncStatusItem(id, "clean", label, Strings.sync.inSync, text.cleanTip, icons);
  }

  /** What the rows show, to refresh the tree only when it changes. */
  private syncSignatureOf(rows: readonly SyncStatusItem[]): string {
    return rows.map((row) => `${row.id}|${row.state}|${row.label}|${row.description}`).join("\n");
  }

  getTreeItem(element: NotesNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: NotesNode): Promise<NotesNode[]> {
    if (element instanceof PinnedRecentGroupItem) {
      return (await this.pinnedRecent?.getChildren(element)) ?? [];
    }
    if (element && !(element instanceof NoteItem)) {
      return []; // The blank row has no children.
    }
    const files = await this.getFolderChildren(element);
    if (element || !this.pinnedRecent || !this.rootService.hasRoot) {
      return files;
    }
    const groups = await this.pinnedRecent.getChildren();
    const rows =
      files.length > 0 ? [...groups, new GroupSpacerItem("afterGroups"), ...files] : groups;
    // A blank row between the sync rows and the groups, like the one under the groups.
    const sync = this.syncRows();
    return sync.length > 0 ? [...sync, new GroupSpacerItem("afterSync"), ...rows] : rows;
  }

  /** The folders and files inside a folder of the notes folder (or inside the notes folder itself), without the groups. */
  async getFolderChildren(element?: NoteItem): Promise<NoteItem[]> {
    const root = this.rootService.getRootUri();
    const state = this.rootService.state;
    if (!root || state === RootStates.noRoot || state === RootStates.missing) {
      return [];
    }
    // Only real folders are read. Symbolic links to folders are never expanded.
    if (element && element.kind !== "folder") {
      return [];
    }

    const folderUri = element ? element.uri : root;
    const parentPath = element ? element.relativePath : "";
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(folderUri);
    } catch (error) {
      this.logger.warn(
        `Could not read folder "${parentPath || "."}": ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
    this.logger.debug(`Read folder "${parentPath || "."}" (${entries.length} entries)`);

    // What the exclude patterns hide is left out, or, with "Show Hidden Items", shown and marked (and so is everything
    // inside a hidden folder). The config folder of NoteRoot is never shown.
    const showHidden = this.showHidden.isEnabled;
    const items = entries.flatMap(([name, type]) => {
      const excluded = this.excludeMatcher.isExcluded(name, joinPath(parentPath, name));
      if (excluded && (!showHidden || name === ConfigFile.dirName)) {
        return [];
      }
      // Left out of automatic tagging: by the list, or because the folder it is in is.
      const noTag =
        this.noTagMatcher.isExcluded(name, joinPath(parentPath, name)) || element?.noTag === true;
      return [
        this.createItem(
          folderUri,
          parentPath,
          name,
          type,
          excluded || element?.hidden === true,
          noTag,
          this.showNoTag.isEnabled,
          this.encryptMatcher.isExcluded(name, joinPath(parentPath, name)) ||
            element?.sealed === true,
          this.showEncrypted.isEnabled,
          // Left alone by the sync: by the list, or because the folder it is in is.
          this.syncIgnoreMatcher.isExcluded(name, joinPath(parentPath, name)) ||
            element?.unsynced === true,
          this.showUnsynced.isEnabled
        ),
      ];
    });
    if (this.settings.sortOrder === "modified") {
      const times = new Map<string, number>();
      await Promise.all(
        items.map(async (item) => {
          try {
            times.set(item.relativePath, (await vscode.workspace.fs.stat(item.uri)).mtime);
          } catch {
            times.set(item.relativePath, 0); // Vanished in the meantime: goes last.
          }
        })
      );
      const reversed = this.settings.sortReversed;
      return items.sort((a, b) => compareItems(a, b, reversed, times));
    }
    const reversed = this.settings.sortReversed;
    return items.sort((a, b) => compareItems(a, b, reversed));
  }

  getParent(element: NotesNode): NotesNode | undefined {
    if (!(element instanceof NoteItem)) {
      return undefined;
    }
    // A note in the Pinned or Recent group sits under its group, not under its folder.
    const group = /^(pinned|recent):/.exec(element.id ?? "")?.[1];
    if (group === "pinned" || group === "recent") {
      return new PinnedRecentGroupItem(group, 0, true);
    }
    const slash = element.relativePath.lastIndexOf("/");
    if (slash < 0) {
      return undefined;
    }
    const parentPath = element.relativePath.slice(0, slash);
    const root = this.rootService.getRootUri();
    if (!root) {
      return undefined;
    }
    return new NoteItem(vscode.Uri.joinPath(root, ...parentPath.split("/")), parentPath, "folder");
  }

  /** Stat is deferred to hover time so listing a folder never touches every child. */
  async resolveTreeItem(item: vscode.TreeItem, element: NotesNode): Promise<vscode.TreeItem> {
    if (!(element instanceof NoteItem)) {
      return item;
    }
    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(element.uri);
    } catch {
      return item; // The entry vanished: keep the default tooltip.
    }
    const tooltip = new vscode.MarkdownString();
    // appendText escapes Markdown, so odd file names cannot break the tooltip.
    tooltip.appendText(element.name);
    tooltip
      .appendMarkdown("\n\n")
      .appendText(`${Strings.tree.tooltipPath}: ${element.relativePath}`);
    if (element.kind === "symlinkFolder") {
      tooltip.appendMarkdown("\n\n").appendText(Strings.tree.tooltipSymlink);
    } else if (element.kind !== "folder") {
      tooltip
        .appendMarkdown("\n\n")
        .appendText(`${Strings.tree.tooltipSize}: ${formatBytes(stat.size)}`);
    }
    tooltip
      .appendMarkdown("\n\n")
      .appendText(`${Strings.tree.tooltipModified}: ${new Date(stat.mtime).toLocaleString()}`);
    item.tooltip = tooltip;
    return item;
  }

  /**
   * Builds the item for a root-relative path, or undefined when it no longer exists,
   * is hidden by the exclude patterns, or lies outside the root. Used to restore saved state.
   */
  async resolveItem(relativePath: string): Promise<NoteItem | undefined> {
    const root = this.rootService.getRootUri();
    const segments = relativePath.split("/");
    if (
      !root ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      return undefined;
    }
    const uri = vscode.Uri.joinPath(root, ...segments);
    if (!this.pathGuard.isInsideRoot(uri, { allowRoot: false })) {
      return undefined;
    }
    // Hidden if the item or any of its parent folders is excluded.
    for (let depth = 1; depth <= segments.length; depth++) {
      if (this.excludeMatcher.isExcluded(segments[depth - 1], segments.slice(0, depth).join("/"))) {
        return undefined;
      }
    }
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      return new NoteItem(
        uri,
        relativePath,
        kindFromFileType(stat.type),
        this.isQuickNoteFile(relativePath)
      );
    } catch {
      return undefined;
    }
  }

  dispose(): void {
    vscode.Disposable.from(...this.subscriptions).dispose();
  }

  private createItem(
    folderUri: vscode.Uri,
    parentPath: string,
    name: string,
    type: vscode.FileType,
    hidden: boolean,
    noTag: boolean,
    markNoTag: boolean,
    sealed: boolean,
    markSealed: boolean,
    unsynced: boolean,
    markUnsynced: boolean
  ): NoteItem {
    const relativePath = joinPath(parentPath, name);
    return new NoteItem(
      vscode.Uri.joinPath(folderUri, name),
      relativePath,
      kindFromFileType(type),
      this.isQuickNoteFile(relativePath),
      hidden,
      noTag,
      markNoTag,
      sealed,
      markSealed,
      unsynced,
      markUnsynced
    );
  }

  private isQuickNoteFile(relativePath: string): boolean {
    const configured = this.settings.quickNoteFile.replace(/\\/g, "/").replace(/^(\.?\/)+/, "");
    return configured.toLowerCase() === relativePath.toLowerCase();
  }
}

function joinPath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

/**
 * Folders first (links to folders count as folders), then files. Each group is alphabetical, or

 * newest first when `modified` times are given (equal times fall back to the name). `reversed` turns each group around
 * (Z to A, oldest first); the folders stay first.
 */
function compareItems(
  a: NoteItem,
  b: NoteItem,
  reversed: boolean,
  modified?: ReadonlyMap<string, number>
): number {
  const rank = (item: NoteItem): number =>
    item.kind === "folder" || item.kind === "symlinkFolder" ? 0 : 1;
  const order =
    (modified ? (modified.get(b.relativePath) ?? 0) - (modified.get(a.relativePath) ?? 0) : 0) ||
    collator.compare(a.name, b.name) ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return rank(a) - rank(b) || (reversed ? -order : order);
}
