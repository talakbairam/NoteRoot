import { Commands } from "../constants/commands";
import {
  DEFAULT_EXTENSION_PATTERN,
  HeadingLevels,
  isValidTagLine,
  QuickNotePositions,
  isValidHeaderLine,
  NOTE_FILE_TYPE_PATTERN,
  NumberLimits,
  SettingDefaults,
  SettingKeys,
  SortOrders,
  type SettingKey,
} from "../constants/settings";
import { Strings } from "../constants/strings";
import type { AdvancedModeService } from "./AdvancedModeService";
import type { AutoCategoryService } from "./AutoCategoryService";
import type { AutoTagPatternService } from "./AutoTagPatternService";
import type { SettingsService } from "./SettingsService";

/** What the catalog reads from and writes to. */
export interface SettingsContext {
  settings: SettingsService;
  advancedMode: AdvancedModeService;
  autoCategories: AutoCategoryService;
  autoTagPatterns: AutoTagPatternService;
}

export type SettingGroup = "notes" | "quickNote" | "tags" | "more";

/**
 * - `choice`: one of a few values. `text` and `number`: typed in a box. `list`: a list of texts.
 * - `action`: changed with a command of its own (a folder or a file is chosen with a dialog).
 * - `switch`: on or off, kept by a service and not a VS Code setting. `toggle`: on or off, a VS Code setting of `true` or `false`.
 */
export type SettingKind = "choice" | "text" | "number" | "list" | "action" | "switch" | "toggle";

export type SettingValue = string | number | boolean | readonly string[];

export interface SettingDef {
  /** Also the key of its texts in `Strings.settingsView.items`. */
  id: keyof typeof Strings.settingsView.items;
  group: SettingGroup;
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

/** The settings of the group More: small limits and behaviours, all kept only in the notes folder. */
const MORE_SETTINGS: readonly SettingDef[] = [
  flagDef("sortReversed", SettingKeys.sortReversed, "more", (s) => s.sortReversed),
  flagDef("confirmDelete", SettingKeys.confirmDelete, "more", (s) => s.confirmDelete),
  flagDef(
    "caseSensitiveSearch",
    SettingKeys.caseSensitiveSearch,
    "more",
    (s) => s.caseSensitiveSearch
  ),
  numberDef(
    "minSearchLength",
    SettingKeys.minSearchLength,
    "count",
    "more",
    (s) => s.minSearchLength
  ),
  numberDef("undoSteps", SettingKeys.undoSteps, "count", "more", (s) => s.undoSteps),
  numberDef("doubleClickMs", SettingKeys.doubleClickMs, "ms", "more", (s) => s.doubleClickMs),
  numberDef(
    "statusMessageSeconds",
    SettingKeys.statusMessageSeconds,
    "s",
    "more",
    (s) => s.statusMessageMs / 1000
  ),
  numberDef(
    "minKeywordLength",
    SettingKeys.minKeywordLength,
    "count",
    "more",
    (s) => s.minKeywordLength
  ),
  numberDef(
    "maxLabelNameLength",
    SettingKeys.maxLabelNameLength,
    "count",
    "more",
    (s) => s.maxLabelNameLength
  ),
  numberDef("maxPatternTags", SettingKeys.maxPatternTags, "count", "more", (s) => s.maxPatternTags),
  numberDef(
    "maxAutoCategories",
    SettingKeys.maxAutoCategories,
    "count",
    "more",
    (s) => s.maxAutoCategories
  ),
  flagDef("startAdvancedOn", SettingKeys.startAdvancedOn, "more", (s) => s.startAdvancedOn),
  flagDef(
    "startAutoCategoriesOn",
    SettingKeys.startAutoCategoriesOn,
    "more",
    (s) => s.startAutoCategoriesOn
  ),
  flagDef(
    "startAutoTagPatternsOn",
    SettingKeys.startAutoTagPatternsOn,
    "more",
    (s) => s.startAutoTagPatternsOn
  ),
];

/** Every setting the Settings view shows, in the order it shows them. */
export const SETTING_DEFS: readonly SettingDef[] = [
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
    group: "notes",
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
    group: "notes",
    kind: "list",
    key: SettingKeys.excludePatterns,
    resettable: true,
    read: ({ settings }) => settings.excludePatterns,
    defaultValue: SettingDefaults.excludePatterns,
  },
  {
    id: "largeFileThresholdMB",
    group: "notes",
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
    group: "notes",
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
    group: "notes",
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
    group: "notes",
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
 * Checks `value` (from a page, so not trusted) for the setting and saves it with the same rules as the Settings view.
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
          await context.settings.setValue(def.key, value);
        }
      }
      return undefined;
    }
    case "choice": {
      if (typeof value !== "string" || !(def.choices ?? []).includes(value)) {
        return text.invalidChoice;
      }
      if (value !== String(def.read(context)) && def.key !== undefined) {
        await context.settings.setValue(def.key, value);
      }
      return undefined;
    }
    case "text":
    case "number": {
      if (typeof value !== "string" || def.key === undefined) {
        return text.invalidChoice;
      }
      const message =
        value === "" && !def.allowEmpty ? text.emptyNotAllowed : def.validate?.(value);
      if (message !== undefined) {
        return message;
      }
      const next = typedValue(def, value);
      if (next !== def.read(context)) {
        await context.settings.setValue(def.key, next);
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
        await context.settings.setValue(def.key, entries);
      }
      return undefined;
    }
    case "action":
      return text.invalidChoice;
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
  return def.kind === "switch"
    ? def.read(context) === true
    : def.key !== undefined && context.settings.hasExplicitValue(def.key);
}

/** Takes a setting back to its default (a switch is turned off). */
export async function resetSetting(context: SettingsContext, def: SettingDef): Promise<void> {
  if (!def.resettable) {
    return;
  }
  if (def.kind === "switch") {
    await writeSwitch(context, def.id, false);
  } else if (def.key !== undefined) {
    await context.settings.resetValue(def.key);
  }
}
