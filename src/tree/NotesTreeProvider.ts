import * as vscode from "vscode";
import { RootStates } from "../constants/context";
import { ConfigFile, SettingKeys } from "../constants/settings";
import { Strings } from "../constants/strings";
import { ExcludeMatcher } from "../services/ExcludeMatcher";
import { Logger } from "../services/Logger";
import { PathGuard } from "../services/PathGuard";
import { RootFolderService } from "../services/RootFolderService";
import { SettingsService } from "../services/SettingsService";
import { ShowHiddenService } from "../services/ShowHiddenService";
import { formatBytes } from "../util/format";
import { kindFromFileType, NoteItem } from "./NoteItem";

// Natural, case-insensitive order: "note2" before "note10", "a" next to "A".
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/**
 * Explorer-like view of the notes root. Folders are read only when expanded,
 * and `getChildren` makes a single `readDirectory` call without any `stat`
 * (only the "modified" sort order needs the time of every entry, so it stats them).
 */
export class NotesTreeProvider implements vscode.TreeDataProvider<NoteItem>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<NoteItem | undefined>();
  private readonly subscriptions: vscode.Disposable[] = [];

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly rootService: RootFolderService,
    private readonly pathGuard: PathGuard,
    private readonly excludeMatcher: ExcludeMatcher,
    private readonly settings: SettingsService,
    private readonly logger: Logger,
    private readonly showHidden: ShowHiddenService,
    private readonly noTagMatcher: ExcludeMatcher
  ) {
    this.subscriptions.push(
      this.changeEmitter,
      // Ids are stable relative paths, so a full refresh keeps expanded folders expanded.
      rootService.onDidChangeFiles(() => this.refresh()),
      rootService.onDidChangeRoot(() => this.refresh()),
      rootService.onDidChangeState(() => this.refresh()),
      excludeMatcher.onDidChange(() => this.refresh()),
      showHidden.onDidChange(() => this.refresh()),
      noTagMatcher.onDidChange(() => this.refresh()),
      settings.onDidChange((event) => {
        // The Quick Note file gets its own context value.
        if (
          SettingsService.affects(event, SettingKeys.quickNoteFile) ||
          SettingsService.affects(event, SettingKeys.sortOrder) ||
          SettingsService.affects(event, SettingKeys.sortReversed)
        ) {
          this.refresh();
        }
      })
    );
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element: NoteItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: NoteItem): Promise<NoteItem[]> {
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
          showHidden
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

  getParent(element: NoteItem): NoteItem | undefined {
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
  async resolveTreeItem(item: vscode.TreeItem, element: NoteItem): Promise<vscode.TreeItem> {
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
    markNoTag: boolean
  ): NoteItem {
    const relativePath = joinPath(parentPath, name);
    return new NoteItem(
      vscode.Uri.joinPath(folderUri, name),
      relativePath,
      kindFromFileType(type),
      this.isQuickNoteFile(relativePath),
      hidden,
      noTag,
      markNoTag
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
