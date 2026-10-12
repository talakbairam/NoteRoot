import * as vscode from "vscode";
import {
  DEFAULT_EXTENSION_PATTERN,
  FOLDER_BOOLEAN_KEYS,
  FOLDER_SETTING_KEYS,
  NumberLimits,
  SETTINGS_SECTION,
  isFolderOnlyKey,
  isFolderSettingKey,
  isValidFolderValue,
  type SettingSource,
  SettingDefaults,
  SettingKeys,
  HeadingLevels,
  isValidTagLine,
  QuickNotePositions,
  SortOrders,
  type HeadingLevel,
  type QuickNotePosition,
  type SettingKey,
  type SortOrder,
} from "../constants/settings";
import { Strings } from "../constants/strings";
import { RootMissingError } from "../util/errors";
import { Logger } from "./Logger";

/** Where the values kept in the notes folder are written. Implemented by `FolderSettingsService`. */
export interface FolderSettingsStore {
  /** True when there is a notes folder to write into. */
  canWrite(): boolean;
  /** Writes the value into the config file of the folder; `undefined` takes it away. May throw `ConfigLockedError`. */
  write(key: SettingKey, value: unknown): Promise<void>;
}

/**
 * Single, typed entry point to the `noteRoot.*` settings.
 * Every getter validates the value and falls back to the default when it is unusable.
 *
 * Some settings (`FOLDER_SETTING_KEYS`) have a second layer: the value kept in the notes folder wins over the VS Code
 * setting, which is then the default for folders that have no value.
 */
export class SettingsService implements vscode.Disposable {
  private folderValues: Partial<Record<SettingKey, unknown>> = {};
  private folderStore: FolderSettingsStore | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<vscode.ConfigurationChangeEvent>();
  private readonly subscription: vscode.Disposable;
  /** Last invalid value reported per setting, so a bad value is logged once, not on every read. */
  private readonly reportedInvalid = new Map<SettingKey, string>();

  /** Fires when any `noteRoot.*` setting changed. Use {@link affects} to filter. */
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly logger: Logger) {
    this.subscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(SETTINGS_SECTION)) {
        this.changeEmitter.fire(event);
      }
    });
  }

  static affects(event: vscode.ConfigurationChangeEvent, key: SettingKey): boolean {
    return event.affectsConfiguration(`${SETTINGS_SECTION}.${key}`);
  }

  /** Absolute path of the notes folder, or an empty string when none is set. */
  get rootPath(): string {
    const value = this.read<string>(SettingKeys.rootPath);
    return typeof value === "string" ? value.trim() : SettingDefaults.rootPath;
  }

  /** The root path is a user-level (Global) setting. */
  async setRootPath(path: string): Promise<void> {
    await this.configuration().update(
      SettingKeys.rootPath,
      path,
      vscode.ConfigurationTarget.Global
    );
  }

  /** Connects the place where the values of the notes folder are written. */
  attachFolderStore(store: FolderSettingsStore): void {
    this.folderStore = store;
  }

  /**
   * Replaces the values read from the notes folder and tells the listeners which settings changed.
   * Values that are not usable are dropped here, so the VS Code setting applies for them.
   */
  setFolderValues(values: Record<string, unknown>): void {
    const next: Partial<Record<SettingKey, unknown>> = {};
    for (const key of FOLDER_SETTING_KEYS) {
      if (isValidFolderValue(key, values[key])) {
        next[key] = values[key];
      }
    }
    const changed = FOLDER_SETTING_KEYS.filter(
      (key) => JSON.stringify(next[key]) !== JSON.stringify(this.folderValues[key])
    );
    this.folderValues = next;
    if (changed.length > 0) {
      // A plain object is enough: listeners only ask `affectsConfiguration`.
      const event: vscode.ConfigurationChangeEvent = {
        affectsConfiguration: (section: string) =>
          section === SETTINGS_SECTION ||
          changed.some((key) => section === `${SETTINGS_SECTION}.${key}`),
      };
      this.changeEmitter.fire(event);
    }
  }

  /** Which layer the value comes from: the notes folder, the user's (or workspace) VS Code settings, or the default. */
  sourceOf(key: SettingKey): SettingSource {
    if (this.folderValues[key] !== undefined) {
      return "folder";
    }
    return this.hasVsCodeValue(key) ? "user" : "default";
  }

  /** Stores the Quick Note file (see {@link setValue}). */
  async setQuickNoteFile(relativePath: string): Promise<void> {
    await this.setValue(SettingKeys.quickNoteFile, relativePath);
  }

  get quickNotePosition(): QuickNotePosition {
    const value = this.read<unknown>(SettingKeys.quickNotePosition);
    if (QuickNotePositions.some((position) => position === value)) {
      return value as QuickNotePosition;
    }
    this.reportInvalid(
      SettingKeys.quickNotePosition,
      value,
      `must be one of: ${QuickNotePositions.join(", ")}`,
      SettingDefaults.quickNotePosition
    );
    return SettingDefaults.quickNotePosition;
  }

  get quickNoteHeadingLevel(): HeadingLevel {
    const value = this.read<unknown>(SettingKeys.quickNoteHeadingLevel);
    if (HeadingLevels.some((level) => level === value)) {
      return value as HeadingLevel;
    }
    this.reportInvalid(
      SettingKeys.quickNoteHeadingLevel,
      value,
      `must be one of: ${HeadingLevels.join(", ")}`,
      SettingDefaults.quickNoteHeadingLevel
    );
    return SettingDefaults.quickNoteHeadingLevel;
  }

  /** Whether saving a note in the editor tags the notes that were changed. Off unless the user turned it on. */
  get tagOnSave(): boolean {
    const value = this.read<unknown>(SettingKeys.tagOnSave);
    if (typeof value === "boolean") {
      return value;
    }
    this.reportInvalid(
      SettingKeys.tagOnSave,
      value,
      "must be true or false",
      String(SettingDefaults.tagOnSave)
    );
    return SettingDefaults.tagOnSave;
  }

  /** The line that carries the tags of a note: `{tags}` stands for `#one #two`. Always contains `{tags}`. */
  get quickNoteTagLine(): string {
    const value = this.read<unknown>(SettingKeys.quickNoteTagLine);
    if (typeof value === "string" && isValidTagLine(value)) {
      return value;
    }
    this.reportInvalid(
      SettingKeys.quickNoteTagLine,
      value,
      "must be one line of at most 100 characters that contains {tags}",
      SettingDefaults.quickNoteTagLine
    );
    return SettingDefaults.quickNoteTagLine;
  }

  async setQuickNoteTagLine(template: string): Promise<void> {
    await this.setValue(SettingKeys.quickNoteTagLine, template);
  }

  async setQuickNotePosition(position: QuickNotePosition): Promise<void> {
    await this.setValue(SettingKeys.quickNotePosition, position);
  }

  async setQuickNoteHeadingLevel(level: HeadingLevel): Promise<void> {
    await this.setValue(SettingKeys.quickNoteHeadingLevel, level);
  }

  /**
   * Writes any setting. A setting of `FOLDER_SETTING_KEYS` goes into the notes folder when there is one (it can throw
   * `ConfigLockedError` when the config file may not be changed). Every other setting, and a folder setting while there is no
   * notes folder, goes where the user's value lives: Workspace when there is a value there, otherwise Global.
   */
  async setValue(key: SettingKey, value: unknown): Promise<void> {
    if (isFolderSettingKey(key) && this.folderStore?.canWrite()) {
      await this.folderStore.write(key, value);
      return;
    }
    if (isFolderOnlyKey(key)) {
      // There is no VS Code setting to fall back to: this one needs a notes folder.
      throw new RootMissingError(Strings.settingsView.needsFolder);
    }
    const configuration = this.configuration();
    const hasWorkspaceValue = configuration.inspect<unknown>(key)?.workspaceValue !== undefined;
    await configuration.update(
      key,
      value,
      hasWorkspaceValue ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global
    );
  }

  /** True when a value is set (in the notes folder, or by the user or a workspace), even one equal to the default. */
  hasExplicitValue(key: SettingKey): boolean {
    return this.folderValues[key] !== undefined || this.hasVsCodeValue(key);
  }

  private hasVsCodeValue(key: SettingKey): boolean {
    if (isFolderOnlyKey(key)) {
      return false;
    }
    const inspected = this.configuration().inspect<unknown>(key);
    return (
      inspected?.globalValue !== undefined ||
      inspected?.workspaceValue !== undefined ||
      inspected?.workspaceFolderValue !== undefined
    );
  }

  /**
   * Takes one layer of the value away. When the notes folder has a value, only that one goes, so the VS Code setting (or the
   * default) applies again. Otherwise the user's value is taken away, in every place it is set.
   */
  async resetValue(key: SettingKey): Promise<void> {
    if (this.folderValues[key] !== undefined && this.folderStore?.canWrite()) {
      await this.folderStore.write(key, undefined);
      return;
    }
    const configuration = this.configuration();
    const inspected = configuration.inspect<unknown>(key);
    if (inspected?.globalValue !== undefined) {
      await configuration.update(key, undefined, vscode.ConfigurationTarget.Global);
    }
    if (inspected?.workspaceValue !== undefined) {
      await configuration.update(key, undefined, vscode.ConfigurationTarget.Workspace);
    }
  }

  async setSortOrder(order: SortOrder): Promise<void> {
    await this.setValue(SettingKeys.sortOrder, order);
  }

  get sortOrder(): SortOrder {
    const value = this.read<unknown>(SettingKeys.sortOrder);
    if (SortOrders.some((order) => order === value)) {
      return value as SortOrder;
    }
    this.reportInvalid(
      SettingKeys.sortOrder,
      value,
      `must be one of: ${SortOrders.join(", ")}`,
      SettingDefaults.sortOrder
    );
    return SettingDefaults.sortOrder;
  }

  get defaultExtension(): string {
    const value = this.read<string>(SettingKeys.defaultExtension);
    if (typeof value === "string" && DEFAULT_EXTENSION_PATTERN.test(value)) {
      return value;
    }
    this.reportInvalid(
      SettingKeys.defaultExtension,
      value,
      'must start with a dot, for example ".md"',
      SettingDefaults.defaultExtension
    );
    return SettingDefaults.defaultExtension;
  }

  /** Path relative to the root. Whether it resolves inside the root is checked by PathGuard. */
  get quickNoteFile(): string {
    const value = this.read<string>(SettingKeys.quickNoteFile);
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    this.reportInvalid(
      SettingKeys.quickNoteFile,
      value,
      "must not be empty",
      SettingDefaults.quickNoteFile
    );
    return SettingDefaults.quickNoteFile;
  }

  /** Empty string is valid and means "no timestamp heading". */
  get quickNoteTimestampFormat(): string {
    const value = this.read<string>(SettingKeys.quickNoteTimestampFormat);
    if (typeof value === "string") {
      return value;
    }
    this.reportInvalid(
      SettingKeys.quickNoteTimestampFormat,
      value,
      "must be a string",
      SettingDefaults.quickNoteTimestampFormat
    );
    return SettingDefaults.quickNoteTimestampFormat;
  }

  get excludePatterns(): readonly string[] {
    const value = this.read<unknown>(SettingKeys.excludePatterns);
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      return value;
    }
    this.reportInvalid(
      SettingKeys.excludePatterns,
      value,
      "must be an array of strings",
      SettingDefaults.excludePatterns.join(", ")
    );
    return SettingDefaults.excludePatterns;
  }

  /** `0` disables the large file check. */
  get largeFileThresholdMB(): number {
    const value = this.read<number>(SettingKeys.largeFileThresholdMB);
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
    this.reportInvalid(
      SettingKeys.largeFileThresholdMB,
      value,
      "must be a number of 0 or more",
      String(SettingDefaults.largeFileThresholdMB)
    );
    return SettingDefaults.largeFileThresholdMB;
  }

  /** The patterns of the files and folders that automatic tagging leaves alone. */
  get noTagPatterns(): readonly string[] {
    return this.read<readonly string[]>(SettingKeys.noTagPatterns) ?? SettingDefaults.noTagPatterns;
  }

  /** The lines of the header of a note (empty: no header). */
  get noteHeader(): readonly string[] {
    return this.read<readonly string[]>(SettingKeys.noteHeader) ?? SettingDefaults.noteHeader;
  }

  /** The extensions (lower case, no dot) of the files that count as notes. */
  get noteFileTypes(): readonly string[] {
    const value = this.read<readonly string[]>(SettingKeys.noteFileTypes);
    return value !== undefined
      ? value.map((type) => type.toLowerCase())
      : SettingDefaults.noteFileTypes;
  }

  /** How many notes the Recent list keeps. */
  get maxRecentNotes(): number {
    return this.read<number>(SettingKeys.maxRecentNotes) ?? SettingDefaults.maxRecentNotes;
  }

  /** The size, in bytes, above which a file is not read by the search, the tag scan and Tag when saving. */
  get maxTextFileBytes(): number {
    return Math.round(
      (this.read<number>(SettingKeys.maxTextFileSizeMB) ?? SettingDefaults.maxTextFileSizeMB) *
        1_000_000
    );
  }

  get maxSearchResults(): number {
    return this.read<number>(SettingKeys.maxSearchResults) ?? SettingDefaults.maxSearchResults;
  }

  /** How many renames and moves Undo remembers. */
  get undoSteps(): number {
    return this.folderNumber(SettingKeys.undoSteps);
  }

  /** How many files at most become categories. */
  get maxAutoCategories(): number {
    return this.folderNumber(SettingKeys.maxAutoCategories);
  }

  /** How many tags at most come from the patterns in one note. */
  get maxPatternTags(): number {
    return this.folderNumber(SettingKeys.maxPatternTags);
  }

  get doubleClickMs(): number {
    return this.folderNumber(SettingKeys.doubleClickMs);
  }

  /** How long a message in the status bar stays, in milliseconds. */
  get statusMessageMs(): number {
    return this.folderNumber(SettingKeys.statusMessageSeconds) * 1000;
  }

  get minSearchLength(): number {
    return this.folderNumber(SettingKeys.minSearchLength);
  }

  get minKeywordLength(): number {
    return this.folderNumber(SettingKeys.minKeywordLength);
  }

  get maxLabelNameLength(): number {
    return this.folderNumber(SettingKeys.maxLabelNameLength);
  }

  /** The tree order is turned around: Z to A, or oldest first. */
  get sortReversed(): boolean {
    return this.folderFlag(SettingKeys.sortReversed);
  }

  /** Whether deleting asks first (the items still go to the Trash). */
  get confirmDelete(): boolean {
    return this.folderFlag(SettingKeys.confirmDelete);
  }

  get caseSensitiveSearch(): boolean {
    return this.folderFlag(SettingKeys.caseSensitiveSearch);
  }

  get startAdvancedOn(): boolean {
    return this.folderFlag(SettingKeys.startAdvancedOn);
  }

  get startAutoCategoriesOn(): boolean {
    return this.folderFlag(SettingKeys.startAutoCategoriesOn);
  }

  get startAutoTagPatternsOn(): boolean {
    return this.folderFlag(SettingKeys.startAutoTagPatternsOn);
  }

  /** A number that lives only in the notes folder: its value there, or the default. */
  private folderNumber(key: keyof typeof NumberLimits): number {
    return this.read<number>(key) ?? SettingDefaults[key];
  }

  private folderFlag(key: (typeof FOLDER_BOOLEAN_KEYS)[number]): boolean {
    return this.read<boolean>(key) ?? (SettingDefaults as Record<string, unknown>)[key] === true;
  }

  dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
  }

  private configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(SETTINGS_SECTION);
  }

  /** The value of the notes folder when it has a usable one, otherwise the VS Code setting. */
  private read<T>(key: SettingKey): T | undefined {
    const fromFolder = this.folderValues[key];
    if (fromFolder !== undefined) {
      return fromFolder as T;
    }
    return isFolderOnlyKey(key) ? undefined : this.configuration().get<T>(key);
  }

  private reportInvalid(key: SettingKey, value: unknown, rule: string, fallback: string): void {
    const printable = JSON.stringify(value) ?? String(value);
    if (this.reportedInvalid.get(key) === printable) {
      return;
    }
    this.reportedInvalid.set(key, printable);
    this.logger.warn(
      `Setting ${SETTINGS_SECTION}.${key} has an invalid value ${printable} (${rule}). Using "${fallback}".`
    );
  }
}
