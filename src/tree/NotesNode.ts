import * as vscode from "vscode";
import { Strings } from "../constants/strings";
import type { SidebarGapId } from "../services/SidebarLayout";
import { NoteItem } from "./NoteItem";

export type PinnedRecentGroup = "favorites" | "pinned" | "recent";

/** Context values of the "Favorites", "Pinned" and "Recent" group rows (the menus test them) and of the items inside them. */
export const GROUP_CONTEXT = {
  favorites: "noteRoot.pinnedRecentGroup.favorites",
  pinned: "noteRoot.pinnedRecentGroup.pinned",
  recent: "noteRoot.pinnedRecentGroup.recent",
} as const;
export const RECENT_ITEM_CONTEXT = "noteRoot.recentItem";
export const PINNED_ITEM_CONTEXT = "noteRoot.pinnedItem";
export const FAVORITE_ITEM_CONTEXT = "noteRoot.favoriteItem";

const GROUP_LABELS: Record<PinnedRecentGroup, string> = {
  favorites: Strings.pinnedRecent.favorites,
  pinned: Strings.pinnedRecent.pinned,
  recent: Strings.pinnedRecent.recent,
};
const GROUP_ICONS: Record<PinnedRecentGroup, string> = {
  favorites: "star-full",
  pinned: "pinned",
  recent: "history",
};

/** "Favorites", "Pinned" or "Recent": the group rows at the top of the Notes tree, above the folders and files. */
export class PinnedRecentGroupItem extends vscode.TreeItem {
  constructor(
    readonly group: PinnedRecentGroup,
    count: number,
    enabled: boolean
  ) {
    super(GROUP_LABELS[group], vscode.TreeItemCollapsibleState.Expanded);
    this.id = `pinnedrecent:${group}`;
    // The count is always there, also when it is 0; a group that is off says so, like the Tag Patterns of the other view.
    this.description = enabled ? String(count) : `${count} · ${Strings.pinnedRecent.off}`;
    this.iconPath = new vscode.ThemeIcon(GROUP_ICONS[group]);
    this.contextValue = GROUP_CONTEXT[group] + (enabled ? ".on" : ".off");
  }
}

/** Where the sync stands: what the row at the top of the Notes tree shows. */
export type SyncRowState = "off" | "clean" | "dirty";

/**
 * The first row of the Notes tree: the sync at a glance. A GitHub mark in the colour of the state (grey: not connected, green:
 * in sync, yellow: something to send or bring) and, as its description, what that means. The actions (Push, Pull, Check now, Connect...)
 * are in its right click menu; a click does nothing. The icons are SVG files, because a theme icon cannot have these exact colours.
 */
export class SyncStatusItem extends vscode.TreeItem {
  constructor(
    /** The sync service this row is about (its right click menu acts on that one). */
    readonly providerId: string,
    readonly state: SyncRowState,
    label: string,
    description: string,
    tooltip: string,
    icons: Record<SyncRowState, vscode.Uri>
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `sync:status:${providerId}`;
    this.description = description;
    this.tooltip = tooltip;
    this.iconPath = { light: icons[state], dark: icons[state] };
    // The menu of the row (right click) depends on the state; a click does nothing, so a push is never one click away.
    this.contextValue = `noteRoot.syncStatus.${state}`;
  }
}

/**
 * An empty row between the sync rows and the two groups, and between the groups and the folders. A tree has no way to add
 * space, so a row with a blank name is the separator. It has no icon, no children and no menu. Each one has its own `name`,
 * because the id of a row of a tree must be unique.
 */
export class GroupSpacerItem extends vscode.TreeItem {
  constructor(name: SidebarGapId) {
    super(" ", vscode.TreeItemCollapsibleState.None);
    this.id = `pinnedrecent:spacer:${name}`;
    this.contextValue = "noteRoot.spacer";
    this.accessibilityInformation = { label: Strings.pinnedRecent.separator };
  }
}

/** What the Notes tree shows: the two groups at the top, a blank row, and the folders and files of the notes folder. */
export type NotesNode = NoteItem | PinnedRecentGroupItem | GroupSpacerItem | SyncStatusItem;
