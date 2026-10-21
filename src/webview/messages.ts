/** Message contract between the extension and the Quick Note webview. Keep webview/quickNote/quickNote.js in sync. */

/** Longest note or draft accepted. The textarea enforces the same limit with `maxlength`. */
export const MAX_TEXT_LENGTH = 1_000_000;
const MAX_ID_LENGTH = 100;
/** Longest name of a category or tag, with some room: the webview is not trusted. */
const MAX_CHOICE_LENGTH = 200;
/** Most tags accepted with one note: the webview is not trusted. */
const MAX_CHOSEN_TAGS = 50;

/** The two dropdowns of the Advanced mode. */
export type LabelKindName = "category" | "tag";

export type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "draftChanged"; text: string }
  | { type: "submit"; id: string; text: string; open: boolean }
  | { type: "selectRoot" }
  | { type: "pasteAndSave" }
  /** The user picked "Create category…" or "Create tag…" in one of the Advanced dropdowns. */
  /** `name` is what the user typed before choosing "Create…", so the question can start with it. */
  | { type: "createOption"; kind: LabelKindName; name?: string }
  /** What a dropdown shows as chosen (empty text: nothing chosen). The extension needs the category to pick the file. */
  | { type: "choiceChanged"; kind: "category"; value: string }
  /** The tags the box shows as chosen (any number, possibly none). */
  | { type: "tagsChanged"; tags: string[] };

export type ExtensionToWebviewMessage =
  | {
      type: "init";
      draft: string;
      file: string;
      advanced: boolean;
      categories: string[];
      /** What to show instead of a category's name (a category made from a file shows its file name). */
      categoryLabels?: Record<string, string>;
      /** The text of the tooltip of a category: the path of its file. */
      categoryTips?: Record<string, string>;
      /** Notes that start with these texts get the tag by itself, or go to the category. */
      tagKeywords?: Record<string, string>;
      categoryKeywords?: Record<string, string>;
      /** Regular expression sources (flags `giu`) of the tag patterns: text that matches becomes a tag. */
      tagPatterns?: string[];
      tags: string[];
      /** Why the box cannot be used (no notes folder, or it is gone), or nothing. The box is replaced by this text and a button. */
      rootProblem?: string;
    }
  /** New lists for the dropdowns. `select` names the entry to show as chosen (the one just created). */
  | {
      type: "options";
      categories: string[];
      /** What to show instead of a category's name (a category made from a file shows its file name). */
      categoryLabels?: Record<string, string>;
      /** The text of the tooltip of a category: the path of its file. */
      categoryTips?: Record<string, string>;
      /** Notes that start with these texts get the tag by itself, or go to the category. */
      tagKeywords?: Record<string, string>;
      categoryKeywords?: Record<string, string>;
      /** Regular expression sources (flags `giu`) of the tag patterns: text that matches becomes a tag. */
      tagPatterns?: string[];
      tags: string[];
      select?: { kind: LabelKindName; value: string };
    }
  | { type: "advanced"; enabled: boolean }
  /** The state of the notes folder changed: `message` is why the box cannot be used, or null when it can. */
  | { type: "rootProblem"; message: string | null }
  | { type: "target"; file: string }
  /** `keepText`: the note came from the clipboard, so the box and the draft stay as they are. */
  | { type: "saved"; keepText?: boolean }
  | { type: "error"; message: string; showSelectRoot?: boolean }
  | { type: "focus" }
  | { type: "setDraft"; text: string };

/** Webview content is untrusted input: check type and size of everything before using it. */
export function parseWebviewMessage(value: unknown): WebviewToExtensionMessage | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const message = value as Record<string, unknown>;
  const isText = (field: unknown): field is string =>
    typeof field === "string" && field.length <= MAX_TEXT_LENGTH;

  switch (message.type) {
    case "ready":
      return { type: "ready" };
    case "selectRoot":
      return { type: "selectRoot" };
    case "pasteAndSave":
      return { type: "pasteAndSave" };
    case "choiceChanged":
      return message.kind === "category" &&
        typeof message.value === "string" &&
        message.value.length <= MAX_CHOICE_LENGTH
        ? { type: "choiceChanged", kind: "category", value: message.value }
        : undefined;
    case "tagsChanged":
      return Array.isArray(message.tags) &&
        message.tags.length <= MAX_CHOSEN_TAGS &&
        message.tags.every((tag) => typeof tag === "string" && tag.length <= MAX_CHOICE_LENGTH)
        ? { type: "tagsChanged", tags: [...(message.tags as string[])] }
        : undefined;
    case "createOption":
      if (message.kind !== "category" && message.kind !== "tag") {
        return undefined;
      }
      if (message.name === undefined) {
        return { type: "createOption", kind: message.kind };
      }
      return typeof message.name === "string" && message.name.length <= MAX_CHOICE_LENGTH
        ? { type: "createOption", kind: message.kind, name: message.name }
        : undefined;
    case "draftChanged":
      return isText(message.text) ? { type: "draftChanged", text: message.text } : undefined;
    case "submit":
      return typeof message.id === "string" &&
        message.id.length > 0 &&
        message.id.length <= MAX_ID_LENGTH &&
        isText(message.text) &&
        (message.open === undefined || typeof message.open === "boolean")
        ? { type: "submit", id: message.id, text: message.text, open: message.open === true }
        : undefined;
    default:
      return undefined;
  }
}
