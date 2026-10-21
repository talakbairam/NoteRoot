/** Message contract between the extension and the Settings page. Keep webview/settingsPage/settingsPage.js in sync. */

const MAX_ID_LENGTH = 100;
/** Longest text or list entry accepted: the page is not trusted. */
const MAX_VALUE_LENGTH = 1000;
const MAX_LIST_ENTRIES = 200;

/** What the page edits with: a text, a switch or the entries of a list. */
export type SettingEditValue = string | boolean | string[];

export type SettingsPageToExtensionMessage =
  | { type: "ready" }
  | { type: "edit"; id: string; value: SettingEditValue }
  | { type: "reset"; id: string }
  | { type: "action"; id: string };

/** One setting as the page shows it. */
export interface SettingRow {
  id: string;
  group: string;
  groupLabel: string;
  kind: "choice" | "text" | "number" | "list" | "action" | "switch" | "toggle";
  label: string;
  description: string;
  /** The value now: a text, a number written as text, a switch, or the entries of a list. */
  value: SettingEditValue;
  /** The value as the Settings view writes it (a label for a choice, a count for a list). */
  valueText: string;
  defaultText: string;
  changed: boolean;
  /** Only for a setting that can be kept in the notes folder. */
  source?: "folder" | "user" | "default";
  choices?: { value: string; label: string }[];
  /** What a number counts (MB, ms...), or empty. */
  unit: string;
  resettable: boolean;
}

export interface SettingsPageTexts {
  title: string;
  intro: string;
  searchLabel: string;
  searchPlaceholder: string;
  onlyChanged: string;
  noMatches: string;
  changed: string;
  sourceFolder: string;
  sourceUser: string;
  reset: string;
  change: string;
  apply: string;
  listHint: string;
  on: string;
  off: string;
  saved: string;
  defaultLabel: string;
}

export type ExtensionToSettingsPageMessage =
  | { type: "init"; texts: SettingsPageTexts; rows: SettingRow[] }
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
    case "reset":
      return hasId ? { type: "reset", id: message.id as string } : undefined;
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
