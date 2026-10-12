import * as vscode from "vscode";
import { Strings } from "../constants/strings";
import { PinnedNotesService } from "../services/PinnedNotesService";
import { RecentNotesService } from "../services/RecentNotesService";
import { NoteItem } from "./NoteItem";
import { NotesTreeProvider } from "./NotesTreeProvider";

/** Context values of the notes in the view, used by its context menu. */
export const RECENT_ITEM_CONTEXT = "noteRoot.recentItem";
export const PINNED_ITEM_CONTEXT = "noteRoot.pinnedItem";

export type PinnedRecentGroup = "pinned" | "recent";

/** "Pinned" or "Recent": the two groups of the view. */
export class PinnedRecentGroupItem extends vscode.TreeItem {
  constructor(
    readonly group: PinnedRecentGroup,
    count: number
  ) {
    super(
      group === "pinned" ? Strings.pinnedRecent.pinned : Strings.pinnedRecent.recent,
      vscode.TreeItemCollapsibleState.Expanded
    );
    this.id = `pinnedrecent:${group}`;
    this.description = String(count);
    this.iconPath = new vscode.ThemeIcon(group === "pinned" ? "pinned" : "history");
    this.contextValue = "noteRoot.pinnedRecentGroup";
  }
}

export type PinnedRecentNode = NoteItem | PinnedRecentGroupItem;

/**
 * "Pinned & Recent": the notes the user pinned (in the order they were pinned) and the notes opened last (newest first), in two
 * groups. A group that has no notes is not shown, and a view with nothing in it shows the welcome text. A click opens the note.
 * The same note can be in both groups, so the ids of the rows carry the group.
 */
export class PinnedRecentProvider
  implements vscode.TreeDataProvider<PinnedRecentNode>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly subscriptions: vscode.Disposable[];
  /** The notes of both groups, read when the view asks for the groups and kept until something changes. */
  private cache: Promise<Record<PinnedRecentGroup, NoteItem[]>> | undefined;

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly recentService: RecentNotesService,
    private readonly pinnedService: PinnedNotesService,
    private readonly treeProvider: NotesTreeProvider
  ) {
    const changed = (): void => {
      this.cache = undefined;
      this.changeEmitter.fire();
    };
    this.subscriptions = [
      this.changeEmitter,
      recentService.onDidChange(changed),
      pinnedService.onDidChange(changed),
    ];
  }

  getTreeItem(element: PinnedRecentNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PinnedRecentNode): Promise<PinnedRecentNode[]> {
    if (element instanceof NoteItem) {
      return [];
    }
    if (element) {
      return (await this.read())[element.group];
    }
    this.cache = undefined; // The view asks for the top again when it is refreshed: read the notes again.
    const notes = await this.read();
    return [
      ...(notes.pinned.length > 0
        ? [new PinnedRecentGroupItem("pinned", notes.pinned.length)]
        : []),
      ...(notes.recent.length > 0
        ? [new PinnedRecentGroupItem("recent", notes.recent.length)]
        : []),
    ];
  }

  dispose(): void {
    vscode.Disposable.from(...this.subscriptions).dispose();
  }

  private read(): Promise<Record<PinnedRecentGroup, NoteItem[]>> {
    this.cache ??= this.load();
    return this.cache;
  }

  private async load(): Promise<Record<PinnedRecentGroup, NoteItem[]>> {
    const pinned: NoteItem[] = [];
    // A pinned note that is gone (or hidden) is not shown, but it stays in the config file: it is the user's file and a drive
    // that comes back should bring the pin back too.
    for (const path of await this.pinnedService.list()) {
      const item = await this.toItem(path, "pinned", PINNED_ITEM_CONTEXT);
      if (item) {
        pinned.push(item);
      }
    }
    const recent: NoteItem[] = [];
    for (const path of this.recentService.list()) {
      const item = await this.toItem(path, "recent", RECENT_ITEM_CONTEXT);
      if (item) {
        recent.push(item);
      } else {
        // Deleted, moved away or hidden since: forget it quietly (no refresh while reading).
        this.recentService.remove(path, { silent: true });
      }
    }
    return { pinned, recent };
  }

  private async toItem(
    path: string,
    group: PinnedRecentGroup,
    contextValue: string
  ): Promise<NoteItem | undefined> {
    const item = await this.treeProvider.resolveItem(path);
    if (item?.kind !== "file") {
      return undefined;
    }
    // The folder next to the name tells apart notes with the same name.
    const slash = path.lastIndexOf("/");
    item.description = slash > 0 ? path.slice(0, slash) : undefined;
    item.contextValue = contextValue;
    item.id = `${group}:${path}`;
    return item;
  }
}
