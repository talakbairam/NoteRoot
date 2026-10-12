import * as vscode from "vscode";
import { ConfigFile, FOLDER_SETTINGS_FIELD, type SettingKey } from "../constants/settings";
import { ConfigService, type NoteRootConfig } from "./ConfigService";
import { Logger } from "./Logger";
import type { RootFolderService } from "./RootFolderService";
import type { FolderSettingsStore, SettingsService } from "./SettingsService";

const WATCH_DEBOUNCE_MS = 200;

/**
 * Keeps the settings that belong to the notes folder (`custom.folderSettings` of `.noteroot/config.json`) and hands them to
 * `SettingsService`, where they win over the VS Code settings. Shows no UI: a config file that may not be changed makes
 * `write` throw `ConfigLockedError`, and the command that asked reports it.
 */
export class FolderSettingsService implements FolderSettingsStore, vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private watcher: vscode.Disposable | undefined;
  private watchedRoot: string | undefined;
  private timer: NodeJS.Timeout | undefined;
  private loadCounter = 0;

  constructor(
    private readonly rootService: RootFolderService,
    private readonly configService: ConfigService,
    private readonly settings: SettingsService,
    private readonly logger: Logger
  ) {
    settings.attachFolderStore(this);
    this.disposables.push(
      rootService.onDidChangeRoot(() => void this.reload()),
      rootService.onDidChangeState(() => void this.reload())
    );
  }

  canWrite(): boolean {
    return this.rootService.hasRoot && this.rootService.getRootUri() !== undefined;
  }

  async write(key: SettingKey, value: unknown): Promise<void> {
    const root = this.rootService.getRootUri();
    if (!root) {
      return;
    }
    const config = await this.configService.updateCustom(root, (custom) => {
      const current = custom[FOLDER_SETTINGS_FIELD];
      const next: Record<string, unknown> = isRecord(current) ? { ...current } : {};
      if (value === undefined) {
        delete next[key];
      } else {
        next[key] = value;
      }
      if (Object.keys(next).length === 0) {
        delete custom[FOLDER_SETTINGS_FIELD];
      } else {
        custom[FOLDER_SETTINGS_FIELD] = next;
      }
    });
    this.settings.setFolderValues(valuesOf(config));
  }

  /** Reads the settings of the folder again (root or state changed, or the config file changed on disk). */
  async reload(): Promise<void> {
    const ticket = ++this.loadCounter;
    const root = this.rootService.hasRoot ? this.rootService.getRootUri() : undefined;
    this.watch(root);
    if (!root) {
      this.settings.setFolderValues({});
      return;
    }
    try {
      const result = await this.configService.ensure(root);
      if (ticket !== this.loadCounter) {
        return;
      }
      // A file that is damaged or newer than this version is not trusted: the VS Code settings apply.
      this.settings.setFolderValues(
        result.status === "ok" || result.status === "created" ? valuesOf(result.config) : {}
      );
    } catch (error) {
      this.logger.error("Could not read the settings of the notes folder.", error);
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.watcher?.dispose();
    vscode.Disposable.from(...this.disposables).dispose();
  }

  /** Watches the config file, so a change made by hand or by another window is picked up. */
  private watch(root: vscode.Uri | undefined): void {
    const key = root?.toString();
    if (key === this.watchedRoot) {
      return;
    }
    this.watcher?.dispose();
    this.watcher = undefined;
    this.watchedRoot = key;
    if (!root) {
      return;
    }
    const fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, `${ConfigFile.dirName}/${ConfigFile.fileName}`)
    );
    const onEvent = (): void => {
      if (this.timer) {
        clearTimeout(this.timer);
      }
      this.timer = setTimeout(() => void this.reload(), WATCH_DEBOUNCE_MS);
    };
    this.watcher = vscode.Disposable.from(
      fileWatcher,
      fileWatcher.onDidChange(onEvent),
      fileWatcher.onDidCreate(onEvent),
      fileWatcher.onDidDelete(onEvent)
    );
  }
}

function valuesOf(config: NoteRootConfig): Record<string, unknown> {
  const value = config.custom[FOLDER_SETTINGS_FIELD];
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
