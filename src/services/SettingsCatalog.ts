import { Commands } from "../constants/commands";
import {
  DEFAULT_EXTENSION_PATTERN,
  HeadingLevels,
  isValidDropboxAppKey,
  isValidTagLine,
  QuickNotePositions,
  SyncMarkedActions,
  SyncRowsModes,
  isValidHeaderLine,
  NOTE_FILE_TYPE_PATTERN,
  NumberLimits,
  SettingDefaults,
  SettingKeys,
  SortOrders,
  type SettingKey,
} from "../constants/settings";
import { Strings } from "../constants/strings";
import { normalizeHttpsAddress } from "../util/address";
import type { AdvancedModeService } from "./AdvancedModeService";
import type { AutoCategoryService } from "./AutoCategoryService";
import type { AutoTagPatternService } from "./AutoTagPatternService";
import type { GoogleAuth } from "./GoogleAuth";
import {
  GoogleClientPlaces,
  validateClientField,
  type GoogleClientPlace,
  type GoogleClientStore,
} from "./GoogleClientStore";
import type { SavedSecretsService } from "./SavedSecretsService";
import type { SidebarLayoutService } from "./SidebarLayoutService";
import type { SettingsService } from "./SettingsService";

/** What the catalog reads from and writes to. */
export interface SettingsContext {
  settings: SettingsService;
  advancedMode: AdvancedModeService;
  autoCategories: AutoCategoryService;
  autoTagPatterns: AutoTagPatternService;
  /** The Google client of the user (the Google Drive sync) and its sign-in, which ends when the client changes. */
  googleClientStore: GoogleClientStore;
  googleAuth: GoogleAuth;
  /** What NoteRoot keeps in the secret storage, with a way to take each part away. */
  savedSecrets: SavedSecretsService;
  /** The order and the visibility of the rows at the top of the Notes tree. */
  sidebarLayout: SidebarLayoutService;
}

/** The groups of the Settings page, in the order it shows them (see {@link SETTING_GROUP_ORDER}). */
export type SettingGroup = "notes" | "tree" | "quickNote" | "tags" | "sync" | "advanced";

/** A heading inside a section of the page (the key of its text in `Strings.settingsView.subgroups`). */
export type SettingSubgroup = keyof typeof Strings.settingsView.subgroups;

/**
 * The order of the settings on the page, inside their group (the groups follow {@link SETTING_GROUP_ORDER}). The first ones of a
 * group are the ones people look for; limits and "at the start" switches come last. A setting that is not here goes last.
 */
export const SETTING_ORDER: readonly string[] = [
  // Notes
  "rootPath",
  "defaultExtension",
  "noteHeader",
  "noteFileTypes",
  // Tree & Display
  "sortOrder",
  "sortReversed",
  "excludePatterns",
  "syncRows",
  "doubleClickMs",
  "confirmDelete",
  "largeFileThresholdMB",
  "undoSteps",
  "maxRecentNotes",
  "statusMessageSeconds",
  // Search & Limits
  "caseSensitiveSearch",
  "minSearchLength",
  "maxSearchResults",
  "maxTextFileSizeMB",
  // Quick Note
  "quickNoteFile",
  "quickNotePosition",
  "quickNoteHeadingLevel",
  "quickNoteTimestampFormat",
  "quickNoteTagLine",
  "advancedMode",
  "startAdvancedOn",
  // Tags & Categories
  "autoCategories",
  "startAutoCategoriesOn",
  "autoTagPatterns",
  "startAutoTagPatternsOn",
  "tagOnSave",
  "noTagPatterns",
  "minKeywordLength",
  "maxLabelNameLength",
  "maxPatternTags",
  "maxAutoCategories",
  // Sync & Encryption
  "encryptPatterns",
  "syncIgnorePatterns",
  "syncMarkedAction",
  "syncAutoMessage",
  "gitlabAddress",
  "dropboxAppKey",
  "googleClientPlace",
  "googleClientId",
  "googleClientSecret",
  "savedGitlabToken",
  "savedGoogleSignIn",
  "savedDropboxSignIn",
  "savedMasterKeys",
];

/** The order of the groups on the page. Inside a group the settings keep the order of {@link SETTING_DEFS}. */
export const SETTING_GROUP_ORDER: readonly SettingGroup[] = [
  "notes",
  "tree",
  "quickNote",
  "tags",
  "sync",
  "advanced",
];

/** The order of the headings inside a section. A setting with none comes first. */
const SUBGROUP_ORDER: readonly SettingSubgroup[] = [
  "accounts",
  "saved",
  "synced",
  "limits",
  "tuning",
  "startup",
];

/**
 * - `choice`: one of a few values. `text` and `number`: typed in a box. `list`: a list of texts.
 * - `action`: changed with a command of its own (a folder or a file is chosen with a dialog).
 * - `switch`: on or off, kept by a service and not a VS Code setting. `toggle`: on or off, a VS Code setting of `true` or `false`.
 */
export type SettingKind =
  "choice" | "text" | "number" | "list" | "action" | "switch" | "toggle" | "status";

export type SettingValue = string | number | boolean | readonly string[];

export interface SettingDef {
  /** Also the key of its texts in `Strings.settingsView.items`. */
  id: keyof typeof Strings.settingsView.items;
  group: SettingGroup;
  /** The heading it is under inside its section (see {@link PLACEMENT}). */
  subgroup?: SettingSubgroup;
  kind: SettingKind;
  /** The `noteRoot.*` setting, for everything except the switches. */
  key?: SettingKey;
  /** The command that changes it, for `action`. */
  command?: string;
  /** The values of a `choice`. */
  choices?: readonly string[];
  /** For `text`: an empty text is a valid value. */
  allowEmpty?: boolean;
  /** For `text` and `number`: a message when the typed text is not a valid value. */
  validate?: (typed: string) => string | undefined;
  /** For `list`: a message when a typed entry is not valid. */
  validateEntry?: (typed: string) => string | undefined;
  /** For `list`: the same entry may be there more than once (the lines of a header). */
  allowDuplicates?: boolean;
  /** For `list`: how a typed entry is stored (for example without a leading dot). */
  normalizeEntry?: (typed: string) => string;
  /** For `number`: what the value counts, which decides how it is shown. */
  unit?: "count" | "mb" | "ms" | "px" | "s";
  /** For `number`: how the typed text becomes the value. */
  parse?: (typed: string) => number;
  /** For a text that is a password: the page hides it and never receives it. */
  secret?: boolean;
  /** For a setting that is not a VS Code setting: how a new value is kept (a choice or a text). */
  write?: (context: SettingsContext, value: string) => Promise<void>;
  /** For a setting that is not a VS Code setting: whether it was changed from its default. */
  isSet?: (context: SettingsContext) => boolean;
  /** For a setting that is not a VS Code setting: how it goes back to its default. */
  reset?: (context: SettingsContext) => Promise<void>;
  /** False for a setting that cannot be taken back to a default without harm (the notes folder). */
  resettable: boolean;
  /** The value now (a setting that is unusable gives its default). */
  read(context: SettingsContext): SettingValue;
  /** The value of a setting that was never changed. */
  defaultValue: SettingValue;
}

/** One validation for the typed text of a number: a number of 0 or more. */
const validateNumber = (typed: string): string | undefined => {
  const value = Number(typed.trim());
  return typed.trim() !== "" && Number.isFinite(value) && value >= 0
    ? undefined
    : Strings.settingsView.invalidNumber;
};

/** One line that is not too long. A date format with a space at its start or end is allowed, so the text is not trimmed. */
const validateFormat = (typed: string): string | undefined =>
  typed.length <= 60 && !/[\r\n]/.test(typed) ? undefined : Strings.settingsView.invalidFormat;

/** A number between the limits. */
const validateRange =
  (limits: { min: number; max: number; integer: boolean }) =>
  (typed: string): string | undefined => {
    const value = Number(typed.trim());
    return typed.trim() !== "" &&
      Number.isFinite(value) &&
      value >= limits.min &&
      value <= limits.max &&
      (!limits.integer || Number.isInteger(value))
      ? undefined
      : Strings.settingsView.invalidRange(limits.min, limits.max, limits.integer);
  };

/** A number that is kept only in the notes folder, in the group More. */
function numberDef(
  id: SettingDef["id"],
  key: keyof typeof NumberLimits,
  unit: NonNullable<SettingDef["unit"]>,
  group: SettingGroup,
  read: (settings: SettingsService) => number
): SettingDef {
  return {
    id,
    group,
    kind: "number",
    key,
    unit,
    resettable: true,
    validate: validateRange(NumberLimits[key]),
    parse: (typed) => Number(typed.trim()),
    read: ({ settings }) => read(settings),
    defaultValue: SettingDefaults[key],
  };
}

/** A true or false setting that is kept only in the notes folder. */
function flagDef(
  id: SettingDef["id"],
  key: SettingKey,
  group: SettingGroup,
  read: (settings: SettingsService) => boolean
): SettingDef {
  return {
    id,
    group,
    kind: "toggle",
    key,
    resettable: true,
    read: ({ settings }) => read(settings),
    defaultValue: (SettingDefaults as Record<string, unknown>)[key] === true,
  };
}

/** Small limits and behaviours, all kept only in the notes folder; each is in the group of what it changes. */
const MORE_SETTINGS: readonly SettingDef[] = [
  flagDef("sortReversed", SettingKeys.sortReversed, "tree", (s) => s.sortReversed),
  flagDef("syncAutoMessage", SettingKeys.syncAutoMessage, "sync", (s) => s.syncAutoMessage),
  flagDef("confirmDelete", SettingKeys.confirmDelete, "tree", (s) => s.confirmDelete),
  flagDef(
    "caseSensitiveSearch",
    SettingKeys.caseSensitiveSearch,
    "tree",
    (s) => s.caseSensitiveSearch
  ),
  numberDef(
    "minSearchLength",
    SettingKeys.minSearchLength,
    "count",
    "tree",
    (s) => s.minSearchLength
  ),
  numberDef("undoSteps", SettingKeys.undoSteps, "count", "tree", (s) => s.undoSteps),
  numberDef("doubleClickMs", SettingKeys.doubleClickMs, "ms", "tree", (s) => s.doubleClickMs),
  numberDef(
    "statusMessageSeconds",
    SettingKeys.statusMessageSeconds,
    "s",
    "tree",
    (s) => s.statusMessageMs / 1000
  ),
  numberDef(
    "minKeywordLength",
    SettingKeys.minKeywordLength,
    "count",
    "tags",
    (s) => s.minKeywordLength
  ),
  numberDef(
    "maxLabelNameLength",
    SettingKeys.maxLabelNameLength,
    "count",
    "tags",
    (s) => s.maxLabelNameLength
  ),
  numberDef("maxPatternTags", SettingKeys.maxPatternTags, "count", "tags", (s) => s.maxPatternTags),
  numberDef(
    "maxAutoCategories",
    SettingKeys.maxAutoCategories,
    "count",
    "tags",
    (s) => s.maxAutoCategories
  ),
  flagDef("startAdvancedOn", SettingKeys.startAdvancedOn, "quickNote", (s) => s.startAdvancedOn),
  flagDef(
    "startAutoCategoriesOn",
    SettingKeys.startAutoCategoriesOn,
    "tags",
    (s) => s.startAutoCategoriesOn
  ),
  flagDef(
    "startAutoTagPatternsOn",
    SettingKeys.startAutoTagPatternsOn,
    "tags",
    (s) => s.startAutoTagPatternsOn
  ),
];

const BASE_DEFS: readonly SettingDef[] = [
  {
    id: "rootPath",
    group: "notes",
    kind: "action",
    key: SettingKeys.rootPath,
    command: Commands.changeRootFolder,
    resettable: false,
    read: ({ settings }) => settings.rootPath,
    defaultValue: SettingDefaults.rootPath,
  },
  {
    id: "sortOrder",
    group: "tree",
    kind: "choice",
    key: SettingKeys.sortOrder,
    choices: SortOrders,
    resettable: true,
    read: ({ settings }) => settings.sortOrder,
    defaultValue: SettingDefaults.sortOrder,
  },
  {
    id: "defaultExtension",
    group: "notes",
    kind: "text",
    key: SettingKeys.defaultExtension,
    resettable: true,
    validate: (typed) =>
      DEFAULT_EXTENSION_PATTERN.test(typed.trim())
        ? undefined
        : Strings.settingsView.invalidExtension,
    read: ({ settings }) => settings.defaultExtension,
    defaultValue: SettingDefaults.defaultExtension,
  },
  {
    id: "excludePatterns",
    group: "tree",
    kind: "list",
    key: SettingKeys.excludePatterns,
    resettable: true,
    read: ({ settings }) => settings.excludePatterns,
    defaultValue: SettingDefaults.excludePatterns,
  },
  {
    id: "largeFileThresholdMB",
    group: "tree",
    kind: "number",
    key: SettingKeys.largeFileThresholdMB,
    unit: "mb",
    resettable: true,
    validate: validateNumber,
    parse: (typed) => Number(typed.trim()),
    read: ({ settings }) => settings.largeFileThresholdMB,
    defaultValue: SettingDefaults.largeFileThresholdMB,
  },
  {
    id: "noteFileTypes",
    group: "notes",
    kind: "list",
    key: SettingKeys.noteFileTypes,
    resettable: true,
    validateEntry: (typed) =>
      NOTE_FILE_TYPE_PATTERN.test(typed.trim().replace(/^./, ""))
        ? undefined
        : Strings.settingsView.invalidFileType,
    normalizeEntry: (typed) => typed.trim().replace(/^./, "").toLowerCase(),
    read: ({ settings }) => settings.noteFileTypes,
    defaultValue: SettingDefaults.noteFileTypes,
  },
  {
    id: "noteHeader",
    group: "notes",
    kind: "list",
    key: SettingKeys.noteHeader,
    resettable: true,
    allowDuplicates: true,
    // The spaces matter (the lines of a comment are indented), so what is typed is kept as it is.
    validateEntry: (typed) =>
      isValidHeaderLine(typed) ? undefined : Strings.settingsView.invalidHeaderLine,
    normalizeEntry: (typed) => typed,
    read: ({ settings }) => settings.noteHeader,
    defaultValue: SettingDefaults.noteHeader,
  },
  {
    id: "maxRecentNotes",
    group: "tree",
    kind: "number",
    key: SettingKeys.maxRecentNotes,
    unit: "count",
    resettable: true,
    validate: validateRange(NumberLimits.maxRecentNotes),
    parse: (typed) => Number(typed.trim()),
    read: ({ settings }) => settings.maxRecentNotes,
    defaultValue: SettingDefaults.maxRecentNotes,
  },
  {
    id: "maxTextFileSizeMB",
    group: "tree",
    kind: "number",
    key: SettingKeys.maxTextFileSizeMB,
    unit: "mb",
    resettable: true,
    validate: validateRange(NumberLimits.maxTextFileSizeMB),
    parse: (typed) => Number(typed.trim()),
    read: ({ settings }) => settings.maxTextFileBytes / 1_000_000,
    defaultValue: SettingDefaults.maxTextFileSizeMB,
  },
  {
    id: "maxSearchResults",
    group: "tree",
    kind: "number",
    key: SettingKeys.maxSearchResults,
    unit: "count",
    resettable: true,
    validate: validateRange(NumberLimits.maxSearchResults),
    parse: (typed) => Number(typed.trim()),
    read: ({ settings }) => settings.maxSearchResults,
    defaultValue: SettingDefaults.maxSearchResults,
  },
  {
    id: "quickNoteFile",
    group: "quickNote",
    kind: "action",
    key: SettingKeys.quickNoteFile,
    command: Commands.changeQuickNoteFile,
    resettable: true,
    read: ({ settings }) => settings.quickNoteFile,
    defaultValue: SettingDefaults.quickNoteFile,
  },
  {
    id: "quickNotePosition",
    group: "quickNote",
    kind: "choice",
    key: SettingKeys.quickNotePosition,
    choices: QuickNotePositions,
    resettable: true,
    read: ({ settings }) => settings.quickNotePosition,
    defaultValue: SettingDefaults.quickNotePosition,
  },
  {
    id: "quickNoteHeadingLevel",
    group: "quickNote",
    kind: "choice",
    key: SettingKeys.quickNoteHeadingLevel,
    choices: HeadingLevels,
    resettable: true,
    read: ({ settings }) => settings.quickNoteHeadingLevel,
    defaultValue: SettingDefaults.quickNoteHeadingLevel,
  },
  {
    id: "quickNoteTimestampFormat",
    group: "quickNote",
    kind: "text",
    key: SettingKeys.quickNoteTimestampFormat,
    allowEmpty: true,
    resettable: true,
    validate: validateFormat,
    read: ({ settings }) => settings.quickNoteTimestampFormat,
    defaultValue: SettingDefaults.quickNoteTimestampFormat,
  },
  {
    id: "quickNoteTagLine",
    group: "quickNote",
    kind: "text",
    key: SettingKeys.quickNoteTagLine,
    resettable: true,
    validate: (typed) => (isValidTagLine(typed) ? undefined : Strings.quickNote.tagLineInvalid),
    read: ({ settings }) => settings.quickNoteTagLine,
    defaultValue: SettingDefaults.quickNoteTagLine,
  },
  {
    id: "noTagPatterns",
    group: "tags",
    kind: "list",
    key: SettingKeys.noTagPatterns,
    resettable: true,
    read: ({ settings }) => settings.noTagPatterns,
    defaultValue: SettingDefaults.noTagPatterns,
  },
  {
    id: "encryptPatterns",
    group: "sync",
    kind: "list",
    key: SettingKeys.encryptPatterns,
    resettable: true,
    read: ({ settings }) => settings.encryptPatterns,
    defaultValue: SettingDefaults.encryptPatterns,
  },
  {
    id: "syncIgnorePatterns",
    group: "sync",
    kind: "list",
    key: SettingKeys.syncIgnorePatterns,
    resettable: true,
    read: ({ settings }) => settings.syncIgnorePatterns,
    defaultValue: SettingDefaults.syncIgnorePatterns,
  },
  {
    id: "dropboxAppKey",
    group: "sync",
    kind: "text",
    key: SettingKeys.dropboxAppKey,
    allowEmpty: true,
    resettable: true,
    validate: (typed) =>
      isValidDropboxAppKey(typed) ? undefined : Strings.settingsView.invalidDropboxAppKey,
    read: ({ settings }) => settings.dropboxAppKey,
    defaultValue: SettingDefaults.dropboxAppKey,
  },
  {
    id: "gitlabAddress",
    group: "sync",
    kind: "text",
    key: SettingKeys.gitlabAddress,
    resettable: true,
    validate: (typed) =>
      normalizeHttpsAddress(typed) ? undefined : Strings.settingsView.invalidHttpsAddress,
    read: ({ settings }) => settings.gitlabAddress,
    defaultValue: SettingDefaults.gitlabAddress,
  },
  {
    id: "googleClientPlace",
    group: "sync",
    kind: "choice",
    choices: GoogleClientPlaces,
    resettable: true,
    write: async ({ googleClientStore }, value) => {
      await googleClientStore.setPlace(value as GoogleClientPlace);
    },
    isSet: ({ googleClientStore }) => googleClientStore.place !== "config",
    reset: async ({ googleClientStore }) => {
      await googleClientStore.setPlace("config");
    },
    read: ({ googleClientStore }) => googleClientStore.place,
    defaultValue: "config",
  },
  {
    id: "googleClientId",
    group: "sync",
    kind: "text",
    allowEmpty: true,
    resettable: true,
    validate: (typed) => (typed.trim() === "" ? undefined : validateClientField(typed)),
    write: async (context, value) => {
      await context.googleClientStore.update({ id: value });
      // A sign-in made with another client does not work with this one.
      await context.googleAuth.signOut();
    },
    isSet: ({ googleClientStore }) => googleClientStore.ownId !== "",
    reset: async (context) => {
      await context.googleClientStore.update({ id: "" });
      await context.googleAuth.signOut();
    },
    read: ({ googleClientStore }) => googleClientStore.ownId,
    defaultValue: "",
  },
  {
    id: "googleClientSecret",
    group: "sync",
    kind: "text",
    secret: true,
    allowEmpty: true,
    resettable: true,
    validate: (typed) => (typed.trim() === "" ? undefined : validateClientField(typed)),
    write: async (context, value) => {
      await context.googleClientStore.update({ secret: value });
      await context.googleAuth.signOut();
    },
    isSet: ({ googleClientStore }) => googleClientStore.ownSecret !== "",
    reset: async (context) => {
      await context.googleClientStore.update({ secret: "" });
      await context.googleAuth.signOut();
    },
    read: ({ googleClientStore }) => googleClientStore.ownSecret,
    defaultValue: "",
  },
  {
    id: "savedGitlabToken",
    group: "sync",
    kind: "status",
    resettable: true,
    isSet: ({ savedSecrets }) => savedSecrets.state.gitlab,
    reset: ({ savedSecrets }) => savedSecrets.removeGitlab(),
    read: ({ savedSecrets }) => savedSecrets.state.gitlab,
    defaultValue: false,
  },
  {
    id: "savedGoogleSignIn",
    group: "sync",
    kind: "status",
    resettable: true,
    isSet: ({ savedSecrets }) => savedSecrets.state.google,
    reset: ({ savedSecrets }) => savedSecrets.removeGoogle(),
    read: ({ savedSecrets }) => savedSecrets.state.google,
    defaultValue: false,
  },
  {
    id: "savedDropboxSignIn",
    group: "sync",
    kind: "status",
    resettable: true,
    isSet: ({ savedSecrets }) => savedSecrets.state.dropbox,
    reset: ({ savedSecrets }) => savedSecrets.removeDropbox(),
    read: ({ savedSecrets }) => savedSecrets.state.dropbox,
    defaultValue: false,
  },
  {
    id: "savedMasterKeys",
    group: "sync",
    kind: "status",
    resettable: true,
    isSet: ({ savedSecrets }) => savedSecrets.state.keys.length > 0,
    reset: ({ savedSecrets }) => savedSecrets.removeKeys(),
    read: ({ savedSecrets }) => savedSecrets.state.keys.length,
    defaultValue: 0,
  },
  {
    id: "syncRows",
    group: "tree",
    kind: "choice",
    key: SettingKeys.syncRows,
    choices: SyncRowsModes,
    resettable: true,
    read: ({ settings }) => settings.syncRows,
    defaultValue: SettingDefaults.syncRows,
  },
  {
    id: "syncMarkedAction",
    group: "sync",
    kind: "choice",
    key: SettingKeys.syncMarkedAction,
    choices: SyncMarkedActions,
    resettable: true,
    read: ({ settings }) => settings.syncMarkedAction,
    defaultValue: SettingDefaults.syncMarkedAction,
  },
  {
    id: "tagOnSave",
    group: "tags",
    kind: "toggle",
    key: SettingKeys.tagOnSave,
    resettable: true,
    read: ({ settings }) => settings.tagOnSave,
    defaultValue: SettingDefaults.tagOnSave,
  },
  ...MORE_SETTINGS,
  {
    id: "advancedMode",
    group: "quickNote",
    kind: "switch",
    resettable: true,
    read: ({ advancedMode }) => advancedMode.isEnabled,
    defaultValue: false,
  },
  {
    id: "autoCategories",
    group: "tags",
    kind: "switch",
    resettable: true,
    read: ({ autoCategories }) => autoCategories.isEnabled,
    defaultValue: false,
  },
  {
    id: "autoTagPatterns",
    group: "tags",
    kind: "switch",
    resettable: true,
    read: ({ autoTagPatterns }) => autoTagPatterns.isEnabled,
    defaultValue: false,
  },
];

/**
 * Where a setting sits on the page, besides its own group: a heading inside its section, and for the ones that most people never
 * change (limits, fine tuning, "on at the start" switches) the section **Advanced**, at the end.
 */
const PLACEMENT: Readonly<Record<string, { group?: SettingGroup; subgroup: SettingSubgroup }>> = {
  syncIgnorePatterns: { subgroup: "synced" },
  encryptPatterns: { subgroup: "synced" },
  syncMarkedAction: { subgroup: "synced" },
  syncAutoMessage: { subgroup: "synced" },
  gitlabAddress: { subgroup: "accounts" },
  dropboxAppKey: { subgroup: "accounts" },
  googleClientPlace: { subgroup: "accounts" },
  googleClientId: { subgroup: "accounts" },
  googleClientSecret: { subgroup: "accounts" },
  savedGitlabToken: { subgroup: "saved" },
  savedGoogleSignIn: { subgroup: "saved" },
  savedDropboxSignIn: { subgroup: "saved" },
  savedMasterKeys: { subgroup: "saved" },
  maxRecentNotes: { group: "advanced", subgroup: "limits" },
  undoSteps: { group: "advanced", subgroup: "limits" },
  largeFileThresholdMB: { group: "advanced", subgroup: "limits" },
  maxTextFileSizeMB: { group: "advanced", subgroup: "limits" },
  maxSearchResults: { group: "advanced", subgroup: "limits" },
  minSearchLength: { group: "advanced", subgroup: "limits" },
  minKeywordLength: { group: "advanced", subgroup: "limits" },
  maxLabelNameLength: { group: "advanced", subgroup: "limits" },
  maxPatternTags: { group: "advanced", subgroup: "limits" },
  maxAutoCategories: { group: "advanced", subgroup: "limits" },
  doubleClickMs: { group: "advanced", subgroup: "tuning" },
  statusMessageSeconds: { group: "advanced", subgroup: "tuning" },
  startAdvancedOn: { group: "advanced", subgroup: "startup" },
  startAutoCategoriesOn: { group: "advanced", subgroup: "startup" },
  startAutoTagPatternsOn: { group: "advanced", subgroup: "startup" },
};

/** Every setting the Settings page shows, with the place it has on the page. */
export const SETTING_DEFS: readonly SettingDef[] = BASE_DEFS.map((def) => {
  const placement = PLACEMENT[def.id];
  return placement
    ? { ...def, group: placement.group ?? def.group, subgroup: placement.subgroup }
    : def;
});

/** The position of a heading among the headings of a section (a setting without one comes first). */
export function subgroupIndex(subgroup: SettingSubgroup | undefined): number {
  return subgroup === undefined ? -1 : SUBGROUP_ORDER.indexOf(subgroup);
}

export function findSettingDef(id: string): SettingDef | undefined {
  return SETTING_DEFS.find((def) => def.id === id);
}

/**
 * The value a typed text stands for. A date format may have spaces in it on purpose; everything else is taken as it
 * is typed, without the spaces around it.
 */
export function typedValue(def: SettingDef, typed: string): string | number {
  if (def.kind === "number") {
    return def.parse?.(typed) ?? Number(typed);
  }
  return def.id === "quickNoteTimestampFormat" ? typed : typed.trim();
}

/** The entries of a list as they are stored, or a message about the first one that is not valid. */
function checkEntries(def: SettingDef, entries: readonly string[]): string[] | string {
  const text = Strings.settingsView;
  const normalized: string[] = [];
  for (const entry of entries) {
    if (entry.trim() === "") {
      return text.listEntryEmpty;
    }
    const message = def.validateEntry?.(entry);
    if (message !== undefined) {
      return message;
    }
    const next = def.normalizeEntry?.(entry) ?? entry.trim();
    if (!def.allowDuplicates && normalized.includes(next)) {
      return text.listEntryDuplicate(next);
    }
    normalized.push(next);
  }
  return normalized;
}

/**
 * Checks `value` (from a page, so not trusted) for the setting and saves it with the same rules as the Settings page.
 * Returns a message when the value is not valid, and nothing when it was saved (or was the value already).
 * Throws what `SettingsService.setValue` throws (a damaged config file, no notes folder).
 */
export async function applySettingEdit(
  context: SettingsContext,
  def: SettingDef,
  value: unknown
): Promise<string | undefined> {
  const text = Strings.settingsView;
  switch (def.kind) {
    case "switch":
    case "toggle": {
      if (typeof value !== "boolean") {
        return text.invalidChoice;
      }
      if (value !== (def.read(context) === true)) {
        if (def.kind === "switch") {
          await writeSwitch(context, def.id, value);
        } else if (def.key !== undefined) {
          await keepValue(context, def, def.key, value);
        }
      }
      return undefined;
    }
    case "choice": {
      if (typeof value !== "string" || !(def.choices ?? []).includes(value)) {
        return text.invalidChoice;
      }
      if (value !== String(def.read(context))) {
        if (def.write) {
          await def.write(context, value);
        } else if (def.key !== undefined) {
          await keepValue(context, def, def.key, value);
        }
      }
      return undefined;
    }
    case "text":
    case "number": {
      if (typeof value !== "string" || (def.key === undefined && !def.write)) {
        return text.invalidChoice;
      }
      const message =
        value === "" && !def.allowEmpty ? text.emptyNotAllowed : def.validate?.(value);
      if (message !== undefined) {
        return message;
      }
      const next = def.write ? value.trim() : typedValue(def, value);
      if (next !== def.read(context)) {
        if (def.write) {
          await def.write(context, next as string);
        } else if (def.key !== undefined) {
          await keepValue(context, def, def.key, next);
        }
      }
      return undefined;
    }
    case "list": {
      if (!Array.isArray(value) || def.key === undefined) {
        return text.invalidChoice;
      }
      const entries = checkEntries(def, value as string[]);
      if (typeof entries === "string") {
        return entries;
      }
      if (JSON.stringify(entries) !== JSON.stringify(def.read(context))) {
        await keepValue(context, def, def.key, entries);
      }
      return undefined;
    }
    case "action":
    case "status":
      return text.invalidChoice; // Nothing is typed here: a status only shows, and Reset takes it away.
  }
}

/**
 * Saves the value of a setting, except that **a value that is the default is not saved**: what was saved is taken away (the same as
 * Reset), so a setting that is back to its default has no "changed" mark and nothing stored. A value that is the default but
 * differs from what the user set in VS Code is saved, because then it is an override.
 */
async function keepValue(
  context: SettingsContext,
  def: SettingDef,
  key: SettingKey,
  value: SettingValue
): Promise<void> {
  const isDefault = JSON.stringify(value) === JSON.stringify(def.defaultValue);
  if (isDefault && !context.settings.hasVsCodeValue(key)) {
    await context.settings.resetValue(key);
  } else {
    await context.settings.setValue(key, value);
  }
}

/** Switches the setting named `id` on or off. Only for `switch` settings. */
export async function writeSwitch(
  context: SettingsContext,
  id: SettingDef["id"],
  on: boolean
): Promise<void> {
  if (id === "advancedMode") {
    await context.advancedMode.setEnabled(on);
  } else if (id === "autoCategories") {
    await context.autoCategories.setEnabled(on);
  } else if (id === "autoTagPatterns") {
    await context.autoTagPatterns.setEnabled(on);
  }
}

/** True when the setting was changed from its default: set by the user, or a switch that is on. */
export function isChanged(context: SettingsContext, def: SettingDef): boolean {
  if (!def.resettable) {
    return false;
  }
  if (def.isSet) {
    return def.isSet(context);
  }
  if (def.kind === "switch") {
    return def.read(context) === true;
  }
  if (def.key === undefined || !context.settings.hasExplicitValue(def.key)) {
    return false;
  }
  // A value that was saved and is the default again (an older version kept it) counts as not changed.
  const isDefault = JSON.stringify(def.read(context)) === JSON.stringify(def.defaultValue);
  return !(isDefault && !context.settings.hasVsCodeValue(def.key));
}

/** Takes a setting back to its default (a switch is turned off). */
export async function resetSetting(context: SettingsContext, def: SettingDef): Promise<void> {
  if (!def.resettable) {
    return;
  }
  if (def.reset) {
    await def.reset(context);
  } else if (def.kind === "switch") {
    await writeSwitch(context, def.id, false);
  } else if (def.key !== undefined) {
    await context.settings.resetValue(def.key);
  }
}

/** The text a value is shown as: a label for a choice, "On" or "Off" for a switch, a count for a list. */
export function describeValue(def: SettingDef, value: SettingValue): string {
  const text = Strings.settingsView;
  switch (def.kind) {
    case "switch":
    case "toggle":
      return value === true ? text.on : text.off;
    case "list":
      if (def.id === "noteHeader") {
        return (value as readonly string[]).length === 0
          ? text.off
          : text.headerLines((value as readonly string[]).length);
      }
      return text.listCount((value as readonly string[]).length);
    case "number":
      switch (def.unit) {
        case "ms":
          return text.milliseconds(value as number);
        case "px":
          return text.pixels(value as number);
        case "s":
          return text.seconds(value as number);
        case "mb":
          return value === 0 ? text.thresholdOff : text.megabytes(value as number);
        default:
          return String(value);
      }
    case "choice":
      return choiceLabel(def, String(value));
    default: {
      const shown = String(value);
      if (def.id === "savedMasterKeys") {
        return value === 0 ? text.noneSaved : text.keysSaved(value as number);
      }
      if (def.kind === "status") {
        return value === true ? text.savedHere : text.notSaved;
      }
      if (def.secret) {
        return shown === "" ? text.emptyValue : text.secretSet;
      }
      if (def.id === "rootPath") {
        return shown === "" ? text.notSet : shown;
      }
      if (def.id === "quickNoteTimestampFormat" && shown === "") {
        return text.noHeading;
      }
      return shown === "" ? text.emptyValue : shown;
    }
  }
}

/** What a value of a choice is called. */
export function choiceLabel(def: SettingDef, value: string): string {
  const text = Strings.settingsView;
  if (def.id === "sortOrder") {
    return text.sortChoices[value as keyof typeof text.sortChoices] ?? value;
  }
  if (def.id === "googleClientPlace") {
    return text.googleClientPlaceChoices[value as GoogleClientPlace] ?? value;
  }
  if (def.id === "syncRows") {
    return text.syncRowsChoices[value as keyof typeof text.syncRowsChoices] ?? value;
  }
  if (def.id === "syncMarkedAction") {
    return text.syncMarkedChoices[value as keyof typeof text.syncMarkedChoices] ?? value;
  }
  if (def.id === "quickNotePosition") {
    return text.positionChoices[value as keyof typeof text.positionChoices] ?? value;
  }
  // The heading level: `##` is shown as the heading it makes.
  return value === "plain"
    ? Strings.quickNote.headingPlain
    : Strings.quickNote.headingLevelLabel(value);
}
