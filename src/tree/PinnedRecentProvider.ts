import * as vscode from "vscode";
import { PinnedNotesService } from "../services/PinnedNotesService";
import { PinnedRecentSwitches } from "../services/PinnedRecentSwitches";
import { RecentNotesService } from "../services/RecentNotesService";
import { NoteItem } from "./NoteItem";
import type { NotesTreeProvider } from "./NotesTreeProvider";
import {
  PINNED_ITEM_CONTEXT,
  PinnedRecentGroupItem,
  RECENT_ITEM_CONTEXT,
  type NotesNode,
  type PinnedRecentGroup,
} from "./NotesNode";

/**
 * "Pinned & Recent": the notes the user pinned (in the order they were pinned) and the notes opened last (newest first), in two
 * groups at the top of the Notes tree. Both groups are always there, with their count (also 0). A group that is switched off
 * shows no notes and says "off". A click opens the note. The same note can be in both groups, so the ids of the rows carry
 * the group.
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
    return (["pinned", "recent"] as const).map(
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
