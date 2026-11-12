/** Message contract between the extension and the Settings page. Keep webview/settingsPage/settingsPage.js in sync. */

const MAX_ID_LENGTH = 100;
/** Longest text or list entry accepted: the page is not trusted. */
const MAX_VALUE_LENGTH = 1000;
const MAX_LIST_ENTRIES = 200;

import { SyncRowsModes, type SyncRowsMode } from "../constants/settings";
import { isGapItem, isSidebarItemId, type SidebarItemId } from "../services/SidebarLayout";

/** What the page edits with: a text, a switch or the entries of a list. */
export type SettingEditValue = string | boolean | string[];

/** The buttons of the "Files and logs" section, Open Config File and Show Logs, and the VS Code Settings editor. */
export const TOOL_IDS = ["openConfigFile", "showLogs", "openAllSettings"] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export type SettingsPageToExtensionMessage =
  | { type: "ready" }
  | { type: "tool"; id: ToolId }
  | { type: "edit"; id: string; value: SettingEditValue }
  | { type: "reset"; id: string }
  | { type: "action"; id: string }
  /** Takes one item of a list under a setting away (a saved key): `item` is the name the extension gave it. */
  | { type: "forget"; id: string; item: string }
  /** The Sidebar section: a row one place up or down, shown or hidden, or the default again. */
  | { type: "sidebarMove"; id: SidebarItemId; direction: "up" | "down" }
  | { type: "sidebarShow"; id: SidebarItemId; visible: boolean }
  /** Which sync services get a row (the setting `syncRows`; `none` hides the sync rows). */
  | { type: "sidebarSyncRows"; value: SyncRowsMode }
  /** Adds a blank row at the end, or removes one (only a blank row can be removed). */
  | { type: "sidebarAddGap" }
  | { type: "sidebarRemoveGap"; id: SidebarItemId }
  | { type: "sidebarReset" };

/** One row at the top of the Notes tree as the Sidebar section shows it (a line to arrange and a line of the preview). */
export interface SidebarItemModel {
  id: SidebarItemId;
  label: string;
  description: string;
  /** A small mark in front of the name. */
  glyph: string;
  visible: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Example lines shown under the row in the preview. */
  sample: string[];
  /** True for a blank row (it has no name of its own, only a place in the list). */
  isGap?: boolean;
  /** Only for the sync row: which services get a row. Its visibility is this setting, not a switch of its own. */
  syncMode?: SyncRowsMode;
}

/** The Sidebar section: the rows in the order they have now, hidden ones included. */
export interface SidebarModel {
  items: SidebarItemModel[];
  /** False when the most blank rows are there already. */
  canAddGap: boolean;
  /** The choices of the sync row (Every service, Only the connected service, None). */
  syncChoices: { value: SyncRowsMode; label: string }[];
}

/** One setting as the page shows it. */
export interface SettingRow {
  id: string;
  group: string;
  groupLabel: string;
  /** The heading it is under inside its section, when it has one. */
  subgroup?: string;
  kind: "choice" | "text" | "number" | "list" | "action" | "switch" | "toggle" | "status";
  label: string;
  description: string;
  /** Extra words the search box finds this setting by. */
  tags: string[];
  /** The value now: a text, a number written as text, a switch, or the entries of a list. */
  value: SettingEditValue;
  /** The value as the page shows it (a label for a choice, a count for a list). */
  valueText: string;
  defaultText: string;
  changed: boolean;
  /** Only for a setting that can be kept in the notes folder. */
  source?: "folder" | "user" | "default";
  choices?: { value: string; label: string }[];
  /** What a number counts (MB, ms...), or empty. */
  unit: string;
  resettable: boolean;
  /** A password: the page hides what is typed and is never given the value. */
  secret?: boolean;
  /** For a status that is a list (the saved keys): what is saved, each with what it belongs to and a Forget button. */
  items?: { id: string; text: string; detail: string }[];
}

export interface SettingsPageTool {
  id: ToolId;
  label: string;
  description: string;
  button: string;
}

export interface SettingsPageTexts {
  title: string;
  toolsTitle: string;
  tools: SettingsPageTool[];
  intro: string;
  searchLabel: string;
  /** The label of the tag icon next to a setting's name. */
  tagsLabel: string;
  searchPlaceholder: string;
  onlyChanged: string;
  noMatches: string;
  changed: string;
  sourceFolder: string;
  sourceUser: string;
  reset: string;
  /** The button that forgets one saved key. */
  forgetKey: string;
  /** The note under the title of the Advanced section. */
  advancedNote: string;
  sidebarTitle: string;
  sidebarIntro: string;
  sidebarPreview: string;
  sidebarRows: string;
  sidebarShow: string;
  sidebarSyncShow: string;
  sidebarAddGap: string;
  sidebarRemoveGap: string;
  sidebarUp: string;
  sidebarDown: string;
  sidebarReset: string;
  sidebarFolders: string;
  sidebarEmpty: string;
  change: string;
  apply: string;
  listHint: string;
  on: string;
  off: string;
  saved: string;
  defaultLabel: string;
}

export type ExtensionToSettingsPageMessage =
  | {
      type: "init";
      texts: SettingsPageTexts;
      rows: SettingRow[];
      sidebar: SidebarModel;
      section?: string;
    }
  /** The order or the visibility of the sidebar rows changed. */
  | { type: "sidebar"; sidebar: SidebarModel }
  /** A page that is open shows this section (a group of the settings, or `tools`). */
  | { type: "show"; section: string }
  /** The settings changed (anywhere): the same rows again, with the new values. */
  | { type: "update"; rows: SettingRow[] }
  /** The answer to an edit: `error` is why the value was not saved. */
  | { type: "result"; id: string; error?: string };

/** Page content is untrusted input: check type and size of everything before using it. */
export function parseSettingsPageMessage(
  value: unknown
): SettingsPageToExtensionMessage | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const message = value as Record<string, unknown>;
  const hasId =
    typeof message.id === "string" && message.id.length > 0 && message.id.length <= MAX_ID_LENGTH;
  switch (message.type) {
    case "ready":
      return { type: "ready" };
    case "sidebarReset":
      return { type: "sidebarReset" };
    case "sidebarMove":
      return isSidebarItemId(message.id) &&
        (message.direction === "up" || message.direction === "down")
        ? { type: "sidebarMove", id: message.id, direction: message.direction }
        : undefined;
    case "sidebarAddGap":
      return { type: "sidebarAddGap" };
    case "sidebarRemoveGap":
      return isSidebarItemId(message.id) && isGapItem(message.id)
        ? { type: "sidebarRemoveGap", id: message.id }
        : undefined;
    case "sidebarSyncRows":
      return SyncRowsModes.some((mode) => mode === message.value)
        ? { type: "sidebarSyncRows", value: message.value as SyncRowsMode }
        : undefined;
    case "sidebarShow":
      return isSidebarItemId(message.id) && typeof message.visible === "boolean"
        ? { type: "sidebarShow", id: message.id, visible: message.visible }
        : undefined;
    case "tool":
      return TOOL_IDS.includes(message.id as ToolId)
        ? { type: "tool", id: message.id as ToolId }
        : undefined;
    case "reset":
      return hasId ? { type: "reset", id: message.id as string } : undefined;
    case "forget":
      return hasId &&
        typeof message.item === "string" &&
        message.item.length > 0 &&
        message.item.length <= 1000
        ? { type: "forget", id: message.id as string, item: message.item }
        : undefined;
    case "action":
      return hasId ? { type: "action", id: message.id as string } : undefined;
    case "edit": {
      if (!hasId) {
        return undefined;
      }
      const edited = message.value;
      const id = message.id as string;
      if (typeof edited === "boolean") {
        return { type: "edit", id, value: edited };
      }
      if (typeof edited === "string" && edited.length <= MAX_VALUE_LENGTH) {
        return { type: "edit", id, value: edited };
      }
      if (
        Array.isArray(edited) &&
        edited.length <= MAX_LIST_ENTRIES &&
        edited.every((entry) => typeof entry === "string" && entry.length <= MAX_VALUE_LENGTH)
      ) {
        return { type: "edit", id, value: [...(edited as string[])] };
      }
      return undefined;
    }
    default:
      return undefined;
  }
}
