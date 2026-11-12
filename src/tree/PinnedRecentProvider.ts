import * as vscode from "vscode";
import { PinnedNotesService } from "../services/PinnedNotesService";
import { PinnedRecentSwitches } from "../services/PinnedRecentSwitches";
import { RecentNotesService } from "../services/RecentNotesService";
import { NoteItem } from "./NoteItem";
import type { NotesTreeProvider } from "./NotesTreeProvider";
import { Commands } from "../constants/commands";
import { Strings } from "../constants/strings";
import {
  FAVORITE_ITEM_CONTEXT,
  PINNED_ITEM_CONTEXT,
  PinnedRecentGroupItem,
  RECENT_ITEM_CONTEXT,
  type NotesNode,
  type PinnedRecentGroup,
} from "./NotesNode";

/**
 * "Favorites, Pinned & Recent": the files and folders the user added to the favorites, the notes pinned (both in the order they
 * were added) and the notes opened last (newest first), in three groups at the top of the Notes tree. The groups are always
 * there, with their count (also 0). A group that is switched off shows nothing and says "off". A click opens a note; a favorite
 * folder does not open or expand, a click shows it in the tree. The same note can be in several groups, so the ids of the rows
 * carry the group.
 */
export class PinnedRecentProvider implements vscode.TreeDataProvider<NotesNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly subscriptions: vscode.Disposable[];
  /** The notes of both groups, read when the view asks for the groups and kept until something changes. */
  private cache: Promise<Record<PinnedRecentGroup, NoteItem[]>> | undefined;

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly recentService: RecentNotesService,
    private readonly pinnedService: PinnedNotesService,
    private readonly favoritesService: PinnedNotesService,
    private readonly treeProvider: NotesTreeProvider,
    private readonly switches: PinnedRecentSwitches
  ) {
    const changed = (): void => {
      this.cache = undefined;
      this.changeEmitter.fire();
    };
    this.subscriptions = [
      this.changeEmitter,
      recentService.onDidChange(changed),
      pinnedService.onDidChange(changed),
      favoritesService.onDidChange(changed),
      switches.onDidChange(changed),
    ];
  }

  getTreeItem(element: NotesNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: NotesNode): Promise<NotesNode[]> {
    if (element && !(element instanceof PinnedRecentGroupItem)) {
      return []; // A note, or the blank row: no children.
    }
    if (element) {
      // A group that is off keeps its notes (the pins stay in the config file) but does not show them.
      return this.switches.isEnabled(element.group) ? (await this.read())[element.group] : [];
    }
    this.cache = undefined; // The view asks for the top again when it is refreshed: read the notes again.
    const notes = await this.read();
    return (["favorites", "pinned", "recent"] as const).map(
      (group) =>
        new PinnedRecentGroupItem(group, notes[group].length, this.switches.isEnabled(group))
    );
  }

  dispose(): void {
    vscode.Disposable.from(...this.subscriptions).dispose();
  }

  private read(): Promise<Record<PinnedRecentGroup, NoteItem[]>> {
    this.cache ??= this.load();
    return this.cache;
  }

  private async load(): Promise<Record<PinnedRecentGroup, NoteItem[]>> {
    const favorites: NoteItem[] = [];
    // A favorite that is gone (or hidden) stays in the config file for the same reason as a pin.
    for (const path of await this.favoritesService.list()) {
      const item = await this.toItem(path, "favorites", FAVORITE_ITEM_CONTEXT);
      if (item) {
        favorites.push(item);
      }
    }
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
    return { favorites, pinned, recent };
  }

  private async toItem(
    path: string,
    group: PinnedRecentGroup,
    contextValue: string
  ): Promise<NoteItem | undefined> {
    const item = await this.treeProvider.resolveItem(path);
    // Pinned and Recent hold files; Favorites also holds folders (a link to a folder is not offered, like for a move).
    if (item?.kind !== "file" && !(group === "favorites" && item?.kind === "folder")) {
      return undefined;
    }
    // The folder next to the name tells apart notes with the same name.
    const slash = path.lastIndexOf("/");
    item.description = slash > 0 ? path.slice(0, slash) : undefined;
    item.contextValue = contextValue;
    item.id = `${group}:${path}`;
    if (item.kind === "folder") {
      // The folder row of the real tree expands, and its children would repeat the ids of that tree: here a click shows it there.
      item.collapsibleState = vscode.TreeItemCollapsibleState.None;
      item.command = {
        command: Commands.revealInTree,
        title: Strings.pinnedRecent.reveal,
        arguments: [item],
      };
    }
    return item;
  }
}
