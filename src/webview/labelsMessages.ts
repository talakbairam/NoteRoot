/** Message contract between the extension and the Tags & Categories page. Keep webview/labelsPage/labelsPage.js in sync. */

const MAX_ID_LENGTH = 100;
/** Longest name or pattern accepted: the page is not trusted. */
const MAX_NAME_LENGTH = 300;

export type LabelsPageKind = "category" | "tag";

export type LabelsPageToExtensionMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "selectRoot" }
  | { type: "create"; kind: LabelsPageKind }
  | {
      type: "entry";
      action: "rename" | "delete" | "file" | "removeFile" | "keyword" | "removeKeyword";
      kind: LabelsPageKind;
      name: string;
    }
  | { type: "pattern"; action: "add" }
  | { type: "pattern"; action: "edit" | "delete"; pattern: string }
  | { type: "switch"; id: "autoCategories" | "autoTagPatterns"; on: boolean }
  /** `id` is one of the ids of the notes in the model: the page never sends a path. */
  | { type: "openNote"; id: string }
  /** `path` must be one of the files in the model. */
  | { type: "openFile"; path: string };

/** A note that uses a tag, as the page lists it. */
export interface PageNote {
  id: string;
  path: string;
  /** 1-based. */
  line: number;
}

export interface PageCategory {
  name: string;
  /** The file of the category; without it the category uses the Quick Note file. */
  file?: string;
  keyword?: string;
  /** False while the file does not exist yet (the first note creates it). */
  fileExists: boolean;
}

export interface PageTag {
  name: string;
  keyword?: string;
  /** Not known while the notes are still being scanned. */
  notes?: PageNote[];
}

export interface PagePattern {
  pattern: string;
  /** The tags the pattern made in notes. Not known while the notes are still being scanned. */
  tags?: { name: string; notes: PageNote[] }[];
}

export interface LabelsPageModel {
  /** Why there is nothing to show (no notes folder, or it is gone), or nothing. */
  problem?: string;
  /** The Advanced options of the Quick Note panel: categories and the automatic features only work while they are on. */
  advanced: boolean;
  autoCategories: boolean;
  autoTagPatterns: boolean;
  /** True while the notes are scanned for the tags: the counts and the notes come with the next model. */
  scanning: boolean;
  quickNoteFile: string;
  quickNoteFileExists: boolean;
  categories: PageCategory[];
  /** The categories made from files while "every file" is on. */
  everyFile: { label: string; path: string }[];
  everyFileTruncated: boolean;
  tags: PageTag[];
  patterns: PagePattern[];
}

export interface LabelsPageTexts {
  title: string;
  intro: string;
  refresh: string;
  searchLabel: string;
  searchPlaceholder: string;
  noMatches: string;
  selectFolder: string;
  needsAdvanced: string;
  counting: string;
  categories: string;
  newCategory: string;
  noCategories: string;
  usesQuickNoteFile: string;
  notCreated: string;
  everyFile: string;
  everyFileSwitch: string;
  everyFileHint: string;
  everyFileNone: string;
  everyFileMore: string;
  tags: string;
  newTag: string;
  noTags: string;
  patterns: string;
  patternsSwitch: string;
  patternsHint: string;
  newPattern: string;
  noPatterns: string;
  noMatchesYet: string;
  keyword: string;
  changeFile: string;
  removeFile: string;
  setKeyword: string;
  removeKeyword: string;
  rename: string;
  delete: string;
  edit: string;
  noteOne: string;
  noteMany: string;
  tagOne: string;
  tagMany: string;
  on: string;
  off: string;
}

export type ExtensionToLabelsPageMessage =
  | { type: "init"; texts: LabelsPageTexts; model: LabelsPageModel }
  | { type: "update"; model: LabelsPageModel };

/** Page content is untrusted input: check type and size of everything before using it. */
export function parseLabelsPageMessage(value: unknown): LabelsPageToExtensionMessage | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const message = value as Record<string, unknown>;
  const isName = (field: unknown): field is string =>
    typeof field === "string" && field.length > 0 && field.length <= MAX_NAME_LENGTH;
  const isKind = (field: unknown): field is LabelsPageKind =>
    field === "category" || field === "tag";

  switch (message.type) {
    case "ready":
      return { type: "ready" };
    case "refresh":
      return { type: "refresh" };
    case "selectRoot":
      return { type: "selectRoot" };
    case "create":
      return isKind(message.kind) ? { type: "create", kind: message.kind } : undefined;
    case "entry": {
      const actions = ["rename", "delete", "file", "removeFile", "keyword", "removeKeyword"];
      return typeof message.action === "string" &&
        actions.includes(message.action) &&
        isKind(message.kind) &&
        isName(message.name)
        ? {
            type: "entry",
            action: message.action as Extract<
              LabelsPageToExtensionMessage,
              { type: "entry" }
            >["action"],
            kind: message.kind,
            name: message.name,
          }
        : undefined;
    }
    case "pattern":
      if (message.action === "add") {
        return { type: "pattern", action: "add" };
      }
      return (message.action === "edit" || message.action === "delete") && isName(message.pattern)
        ? { type: "pattern", action: message.action, pattern: message.pattern }
        : undefined;
    case "switch":
      return (message.id === "autoCategories" || message.id === "autoTagPatterns") &&
        typeof message.on === "boolean"
        ? { type: "switch", id: message.id, on: message.on }
        : undefined;
    case "openNote":
      return typeof message.id === "string" &&
        message.id.length > 0 &&
        message.id.length <= MAX_ID_LENGTH
        ? { type: "openNote", id: message.id }
        : undefined;
    case "openFile":
      return isName(message.path) ? { type: "openFile", path: message.path } : undefined;
    default:
      return undefined;
  }
}
