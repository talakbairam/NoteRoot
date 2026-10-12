/** Setting keys (relative to the `noteRoot` section) and their defaults. */

export const SETTINGS_SECTION = "noteRoot";

export const SettingKeys = {
  rootPath: "rootPath",
  defaultExtension: "defaultExtension",
  quickNoteFile: "quickNoteFile",
  quickNoteTimestampFormat: "quickNoteTimestampFormat",
  excludePatterns: "excludePatterns",
  largeFileThresholdMB: "largeFileThresholdMB",
  sortOrder: "sortOrder",
  quickNotePosition: "quickNotePosition",
  quickNoteHeadingLevel: "quickNoteHeadingLevel",
  quickNoteTagLine: "quickNoteTagLine",
  tagOnSave: "tagOnSave",
  // The settings below are kept only in the notes folder (`custom.folderSettings`): no VS Code setting exists for them.
  noteFileTypes: "noteFileTypes",
  maxRecentNotes: "maxRecentNotes",
  maxTextFileSizeMB: "maxTextFileSizeMB",
  maxSearchResults: "maxSearchResults",
  undoSteps: "undoSteps",
  maxAutoCategories: "maxAutoCategories",
  maxPatternTags: "maxPatternTags",
  doubleClickMs: "doubleClickMs",
  statusMessageSeconds: "statusMessageSeconds",
  minSearchLength: "minSearchLength",
  minKeywordLength: "minKeywordLength",
  maxLabelNameLength: "maxLabelNameLength",
  sortReversed: "sortReversed",
  confirmDelete: "confirmDelete",
  caseSensitiveSearch: "caseSensitiveSearch",
  startAdvancedOn: "startAdvancedOn",
  startAutoCategoriesOn: "startAutoCategoriesOn",
  startAutoTagPatternsOn: "startAutoTagPatternsOn",
  noteHeader: "noteHeader",
  noTagPatterns: "noTagPatterns",
} as const;

/** Where a new Quick Note goes in its file. */
export const QuickNotePositions = ["end", "start"] as const;
export type QuickNotePosition = (typeof QuickNotePositions)[number];

/** How the timestamp above a Quick Note is written: a Markdown heading of that level, or plain text. */
export const HeadingLevels = ["#", "##", "###", "####", "plain"] as const;
export type HeadingLevel = (typeof HeadingLevels)[number];

/** How the tree orders the items inside a folder (folders always come first). */
export const SortOrders = ["name", "modified"] as const;
export type SortOrder = (typeof SortOrders)[number];

export type SettingKey = (typeof SettingKeys)[keyof typeof SettingKeys];

/** Keep in sync with the defaults declared in package.json. */
export const SettingDefaults = {
  rootPath: "",
  defaultExtension: ".md",
  quickNoteFile: "quick-notes.md",
  quickNoteTimestampFormat: "YYYY-MM-DD HH:mm",
  excludePatterns: [
    ".DS_Store",
    "Thumbs.db",
    ".git",
    ".noteroot",
    ".claude",
    ".vscode",
  ] as readonly string[],
  largeFileThresholdMB: 5,
  sortOrder: "name" as SortOrder,
  quickNotePosition: "end" as QuickNotePosition,
  quickNoteHeadingLevel: "##" as HeadingLevel,
  /** `{tags}` is replaced by the tags (`#one #two`). */
  quickNoteTagLine: "**Tags:** {tags}",
  /** Whether saving a note runs the tagging on the entries that were changed. */
  tagOnSave: false,
  /** File extensions (no dot) that count as notes for "Category for every file". */
  noteFileTypes: [
    "md",
    "markdown",
    "mdx",
    "txt",
    "text",
    "rst",
    "adoc",
    "asciidoc",
    "org",
    "tex",
    "log",
  ] as readonly string[],
  maxRecentNotes: 10,
  /** Bigger files are not read by the search, the tag scan and Tag when saving. */
  maxTextFileSizeMB: 1,
  maxSearchResults: 200,
  undoSteps: 20,
  /** At most this many files become categories. */
  maxAutoCategories: 500,
  /** At most this many tags come from the patterns in one note. */
  maxPatternTags: 20,
  doubleClickMs: 400,
  /** How long the messages in the status bar stay. */
  statusMessageSeconds: 3,
  minSearchLength: 2,
  minKeywordLength: 3,
  maxLabelNameLength: 50,
  sortReversed: false,
  confirmDelete: true,
  caseSensitiveSearch: false,
  /** The state of the switches on a computer where they were never set. */
  startAdvancedOn: false,
  startAutoCategoriesOn: false,
  startAutoTagPatternsOn: false,
  /** The lines written at the start of a new note (and by Insert Header): an HTML comment with fields to fill in. An empty list means no header. */
  noteHeader: ["<!--", "  **Summary:** ", "  **Comment:** ", "-->"] as readonly string[],
  /** Patterns (like the hidden list) of the files and folders that automatic tagging leaves alone. */
  noTagPatterns: [] as readonly string[],
} as const;

/**
 * Settings that may also be kept in the notes folder (`custom.folderSettings` of `.noteroot/config.json`), so they travel with the
 * notes. The value of the folder wins, the VS Code setting is the default for folders that have none.
 */
export const FOLDER_SETTING_KEYS: readonly SettingKey[] = [
  SettingKeys.defaultExtension,
  SettingKeys.excludePatterns,
  SettingKeys.sortOrder,
  SettingKeys.quickNoteFile,
  SettingKeys.quickNoteTimestampFormat,
  SettingKeys.quickNotePosition,
  SettingKeys.quickNoteHeadingLevel,
  SettingKeys.quickNoteTagLine,
  SettingKeys.tagOnSave,
  SettingKeys.noteFileTypes,
  SettingKeys.maxRecentNotes,
  SettingKeys.maxTextFileSizeMB,
  SettingKeys.maxSearchResults,
  SettingKeys.undoSteps,
  SettingKeys.maxAutoCategories,
  SettingKeys.maxPatternTags,
  SettingKeys.doubleClickMs,
  SettingKeys.statusMessageSeconds,
  SettingKeys.minSearchLength,
  SettingKeys.minKeywordLength,
  SettingKeys.maxLabelNameLength,
  SettingKeys.sortReversed,
  SettingKeys.confirmDelete,
  SettingKeys.caseSensitiveSearch,
  SettingKeys.startAdvancedOn,
  SettingKeys.startAutoCategoriesOn,
  SettingKeys.startAutoTagPatternsOn,
  SettingKeys.noteHeader,
  SettingKeys.noTagPatterns,
];

/**
 * The folder settings that have **no** VS Code setting: they live only in the notes folder, with the default of
 * `SettingDefaults`. This keeps the list of NoteRoot settings in VS Code short.
 */
export const FOLDER_ONLY_KEYS: readonly SettingKey[] = [
  SettingKeys.noteFileTypes,
  SettingKeys.maxRecentNotes,
  SettingKeys.maxTextFileSizeMB,
  SettingKeys.maxSearchResults,
  SettingKeys.undoSteps,
  SettingKeys.maxAutoCategories,
  SettingKeys.maxPatternTags,
  SettingKeys.doubleClickMs,
  SettingKeys.statusMessageSeconds,
  SettingKeys.minSearchLength,
  SettingKeys.minKeywordLength,
  SettingKeys.maxLabelNameLength,
  SettingKeys.sortReversed,
  SettingKeys.confirmDelete,
  SettingKeys.caseSensitiveSearch,
  SettingKeys.startAdvancedOn,
  SettingKeys.startAutoCategoriesOn,
  SettingKeys.startAutoTagPatternsOn,
  SettingKeys.noteHeader,
  SettingKeys.noTagPatterns,
];

/** The field of `custom` in the config file that holds the settings of the folder. */
export const FOLDER_SETTINGS_FIELD = "folderSettings";

export type SettingSource = "folder" | "user" | "default";

export function isFolderSettingKey(key: SettingKey): boolean {
  return FOLDER_SETTING_KEYS.includes(key);
}

export function isFolderOnlyKey(key: SettingKey): boolean {
  return FOLDER_ONLY_KEYS.includes(key);
}

/** Limits of the numbers kept in the notes folder. */
export const NumberLimits = {
  maxRecentNotes: { min: 1, max: 100, integer: true },
  maxTextFileSizeMB: { min: 0.1, max: 50, integer: false },
  maxSearchResults: { min: 10, max: 1000, integer: true },
  undoSteps: { min: 1, max: 100, integer: true },
  maxAutoCategories: { min: 10, max: 2000, integer: true },
  maxPatternTags: { min: 1, max: 100, integer: true },
  doubleClickMs: { min: 150, max: 1000, integer: true },
  statusMessageSeconds: { min: 1, max: 30, integer: true },
  minSearchLength: { min: 1, max: 10, integer: true },
  minKeywordLength: { min: 1, max: 20, integer: true },
  maxLabelNameLength: { min: 10, max: 200, integer: true },
} as const;

/** The folder settings that are true or false and have no VS Code setting. */
export const FOLDER_BOOLEAN_KEYS: readonly SettingKey[] = [
  SettingKeys.sortReversed,
  SettingKeys.confirmDelete,
  SettingKeys.caseSensitiveSearch,
  SettingKeys.startAdvancedOn,
  SettingKeys.startAutoCategoriesOn,
  SettingKeys.startAutoTagPatternsOn,
];

/** One extension of a note file: letters, digits, `-` or `_`, without the dot. */
export const NOTE_FILE_TYPE_PATTERN = /^[A-Za-z0-9_-]{1,10}$/;

export function isInLimits(
  value: unknown,
  limits: { min: number; max: number; integer: boolean }
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= limits.min &&
    value <= limits.max &&
    (!limits.integer || Number.isInteger(value))
  );
}

/** True when `value` is usable for a folder setting. A value that is not is ignored (the VS Code setting applies). */
export function isValidFolderValue(key: SettingKey, value: unknown): boolean {
  switch (key) {
    case SettingKeys.defaultExtension:
      return typeof value === "string" && DEFAULT_EXTENSION_PATTERN.test(value);
    case SettingKeys.excludePatterns:
      return Array.isArray(value) && value.every((item) => typeof item === "string");
    case SettingKeys.sortOrder:
      return SortOrders.some((order) => order === value);
    case SettingKeys.quickNoteFile:
      return typeof value === "string" && value.trim().length > 0;
    case SettingKeys.quickNoteTimestampFormat:
      return typeof value === "string";
    case SettingKeys.quickNotePosition:
      return QuickNotePositions.some((position) => position === value);
    case SettingKeys.quickNoteHeadingLevel:
      return HeadingLevels.some((level) => level === value);
    case SettingKeys.quickNoteTagLine:
      return typeof value === "string" && isValidTagLine(value);
    case SettingKeys.tagOnSave:
      return typeof value === "boolean";
    case SettingKeys.noteFileTypes:
      return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((item) => typeof item === "string" && NOTE_FILE_TYPE_PATTERN.test(item))
      );
    case SettingKeys.noteHeader:
      return isValidHeader(value);
    case SettingKeys.noTagPatterns:
      return Array.isArray(value) && value.every((item) => typeof item === "string");
    case SettingKeys.maxRecentNotes:
      return isInLimits(value, NumberLimits.maxRecentNotes);
    case SettingKeys.maxTextFileSizeMB:
      return isInLimits(value, NumberLimits.maxTextFileSizeMB);
    case SettingKeys.maxSearchResults:
      return isInLimits(value, NumberLimits.maxSearchResults);
    default:
      if (key in NumberLimits) {
        return isInLimits(value, NumberLimits[key as keyof typeof NumberLimits]);
      }
      return FOLDER_BOOLEAN_KEYS.includes(key) && typeof value === "boolean";
  }
}

/** A header has at most this many lines, each at most this long and on one line. */
export const MAX_HEADER_LINES = 20;
export const MAX_HEADER_LINE_LENGTH = 200;

export function isValidHeaderLine(line: unknown): line is string {
  return typeof line === "string" && line.length <= MAX_HEADER_LINE_LENGTH && !/[\r\n]/.test(line);
}

/** A list of lines for the header of a note. An empty list is valid and means no header. */
export function isValidHeader(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= MAX_HEADER_LINES && value.every(isValidHeaderLine);
}

/** The placeholder of the tag line template. */
export const TAG_LINE_PLACEHOLDER = "{tags}";
export const MAX_TAG_LINE_LENGTH = 100;

/** A tag line is one line, not too long, and says where the tags go. */
export function isValidTagLine(template: string): boolean {
  return (
    template.includes(TAG_LINE_PLACEHOLDER) &&
    template.length <= MAX_TAG_LINE_LENGTH &&
    !/[\r\n]/.test(template) &&
    template.trim() === template
  );
}

/** Must match the `pattern` of `noteRoot.defaultExtension` in package.json. */
export const DEFAULT_EXTENSION_PATTERN = /^\.[A-Za-z0-9_-]+$/;

/** Location and schema of `<root>/.noteroot/config.json`. */
export const ConfigFile = {
  dirName: ".noteroot",
  fileName: "config.json",
  /** Highest schemaVersion this extension understands. */
  schemaVersion: 1,
} as const;
