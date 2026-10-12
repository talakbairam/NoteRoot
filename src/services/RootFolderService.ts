import * as vscode from "vscode";
import { BuiltinCommands } from "../constants/commands";
import { ConfigFile, SettingKeys } from "../constants/settings";
import { ContextKeys, RootStates, type RootState } from "../constants/context";
import { Strings } from "../constants/strings";
import { RootMissingError } from "../util/errors";
import { isFileNotFoundError } from "../util/fsErrors";
import { ConfigService } from "./ConfigService";
import { ExcludeMatcher } from "./ExcludeMatcher";
import { Logger } from "./Logger";
import type { RootProvider } from "./PathGuard";
import { SettingsService } from "./SettingsService";

const WATCHER_DEBOUNCE_MS = 250;
const ABSOLUTE_PATH = /^([A-Za-z]:[\\/]|[\\/])/;

export interface RefreshOptions {
  /** Also read (and heal) `.noteroot/config.json`. Default: true. */
  checkConfig?: boolean;
}

/**
 * Knows where the notes root is and in which state it is:
 * `noRoot`, `missing`, `empty` or `ready`. It publishes the state as context keys
 * (for the welcome views) and keeps a debounced watcher on the root.
 *
 * It shows no UI: choosing a folder and asking for confirmations live in the commands.
 */
export class RootFolderService implements RootProvider, vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly stateEmitter = new vscode.EventEmitter<RootState>();
  private readonly rootEmitter = new vscode.EventEmitter<vscode.Uri | undefined>();
  private readonly filesEmitter = new vscode.EventEmitter<void>();

  private currentState: RootState | undefined;
  private currentRootKey: string | undefined;
  private refreshCounter = 0;

  private watcherDisposables: vscode.Disposable[] = [];
  private flushTimer: NodeJS.Timeout | undefined;
  private pendingStateRefresh = false;
  private pendingConfigCheck = false;

  /** Fires when the state changes (for example `empty` to `ready`). */
  readonly onDidChangeState = this.stateEmitter.event;
  /** Fires when the configured root folder changes (undefined = none). */
  readonly onDidChangeRoot = this.rootEmitter.event;
  /** Fires (debounced) after something changed inside the root folder. */
  readonly onDidChangeFiles = this.filesEmitter.event;

  constructor(
    private readonly settings: SettingsService,
    private readonly configService: ConfigService,
    private readonly excludeMatcher: ExcludeMatcher,
    private readonly logger: Logger
  ) {
    this.disposables.push(
      this.stateEmitter,
      this.rootEmitter,
      this.filesEmitter,
      settings.onDidChange((event) => {
        if (SettingsService.affects(event, SettingKeys.rootPath)) {
          void this.safeRefresh();
        }
      }),
      // The visible entries (and so "empty" versus "ready") depend on the exclude patterns.
      excludeMatcher.onDidChange(() => void this.safeRefresh({ checkConfig: false })),
      // Fallback for a watcher that cannot see the root folder disappear or come back
      // (moved, unplugged or reconnected drive): look again when the user returns.
      vscode.window.onDidChangeWindowState((windowState) => {
        if (windowState.focused) {
          void this.safeRefresh();
        }
      })
    );
  }

  get state(): RootState | undefined {
    return this.currentState;
  }

  /** True when the root exists (state `empty` or `ready`). */
  get hasRoot(): boolean {
    return this.currentState === RootStates.empty || this.currentState === RootStates.ready;
  }

  /** The raw `noteRoot.rootPath` value ('' when unset). */
  get configuredPath(): string {
    return this.settings.rootPath;
  }

  /**
   * The configured root as a URI, or undefined when none is set or the setting is not
   * an absolute path. Read from the setting every time, so it is never stale.
   */
  getRootUri(): vscode.Uri | undefined {
    const rootPath = this.settings.rootPath;
    return rootPath.length > 0 && ABSOLUTE_PATH.test(rootPath)
      ? vscode.Uri.file(rootPath)
      : undefined;
  }

  /** Computes the first state. Call once at activation. */
  initialize(): Promise<RootState> {
    return this.refresh();
  }

  /** Re-evaluates the state, publishes context keys and recreates the watcher when the root changed. */
  async refresh(options: RefreshOptions = {}): Promise<RootState> {
    const ticket = ++this.refreshCounter;
    const root = this.getRootUri();
    const rootKey = root?.toString();
    const rootChanged = rootKey !== this.currentRootKey;

    const state = await this.detectState(root);
    if (root && state !== RootStates.missing && (options.checkConfig !== false || rootChanged)) {
      await this.configService.ensure(root);
    }

    // A newer refresh started while this one was reading from disk: let it publish instead.
    if (ticket !== this.refreshCounter) {
      return state;
    }

    this.currentRootKey = rootKey;
    if (rootChanged) {
      this.watch(root);
      this.logger.info(root ? `Notes folder: ${root.fsPath}` : "No notes folder is set.");
    }
    await this.applyState(state);
    // After the state, so listeners of the root change already see the matching state.
    if (rootChanged) {
      this.rootEmitter.fire(root);
    }
    return state;
  }

  /** Stores a folder as the notes root (Global setting) and refreshes. */
  async setRootFolder(folder: vscode.Uri): Promise<void> {
    if (folder.scheme !== "file") {
      throw new RootMissingError(Strings.root.unsupportedLocation);
    }
    await this.settings.setRootPath(folder.fsPath);
    await this.refresh();
  }

  /**
   * Creates the configured root folder (and missing parents).
   * Callers must ask the user first: see the `recreateRootFolder` command.
   */
  async createRootFolder(): Promise<void> {
    const root = this.getRootUri();
    if (!root) {
      const rootPath = this.settings.rootPath;
      throw new RootMissingError(
        rootPath ? Strings.root.invalidPath(rootPath) : Strings.root.noRootSelected
      );
    }
    await vscode.workspace.fs.createDirectory(root);
    this.logger.info(`Created notes folder: ${root.fsPath}`);
    await this.refresh();
  }

  dispose(): void {
    this.clearFlushTimer();
    this.disposeWatcher();
    vscode.Disposable.from(...this.disposables).dispose();
  }

  private async detectState(root: vscode.Uri | undefined): Promise<RootState> {
    const rootPath = this.settings.rootPath;
    if (rootPath.length === 0) {
      return RootStates.noRoot;
    }
    if (!root) {
      this.logger.warn(`The notes folder setting is not an absolute path: ${rootPath}`);
      return RootStates.missing;
    }
    try {
      const stat = await vscode.workspace.fs.stat(root);
      if ((stat.type & vscode.FileType.Directory) === 0) {
        this.logger.warn("The notes folder path points to a file, not a folder.");
        return RootStates.missing;
      }
      // One level only: no recursive scan, so this stays cheap even for huge folders.
      const entries = await vscode.workspace.fs.readDirectory(root);
      const hasVisibleEntry = entries.some(([name]) => !this.excludeMatcher.isExcluded(name, name));
      return hasVisibleEntry ? RootStates.ready : RootStates.empty;
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        this.logger.warn(
          `The notes folder is not accessible: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      return RootStates.missing;
    }
  }

  private async applyState(state: RootState): Promise<void> {
    const changed = state !== this.currentState;
    this.currentState = state;
    if (!changed) {
      return;
    }
    this.logger.info(`Notes folder state: ${state}`);
    await vscode.commands.executeCommand(BuiltinCommands.setContext, ContextKeys.state, state);
    await vscode.commands.executeCommand(
      BuiltinCommands.setContext,
      ContextKeys.hasRoot,
      this.hasRoot
    );
    this.stateEmitter.fire(state);
  }

  private async safeRefresh(options: RefreshOptions = {}): Promise<void> {
    try {
      await this.refresh(options);
    } catch (error) {
      this.logger.error("Could not refresh the notes folder state.", error);
    }
  }

  private watch(root: vscode.Uri | undefined): void {
    this.disposeWatcher();
    if (!root) {
      return;
    }
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, "**/*")
    );
    this.watcherDisposables = [
      watcher,
      watcher.onDidCreate((uri) => this.onFileEvent(uri, true)),
      watcher.onDidDelete((uri) => this.onFileEvent(uri, true)),
      // Content edits cannot change the state, so they only notify listeners.
      watcher.onDidChange((uri) => this.onFileEvent(uri, false)),
    ];
  }

  private onFileEvent(uri: vscode.Uri, structural: boolean): void {
    if (structural) {
      this.pendingStateRefresh = true;
    }
    // Over-matching is harmless: it only costs one extra read of the small config file.
    if (uri.path.includes(`/${ConfigFile.dirName}`)) {
      this.pendingConfigCheck = true;
    }
    this.clearFlushTimer();
    this.flushTimer = setTimeout(() => void this.flush(), WATCHER_DEBOUNCE_MS);
  }

  private async flush(): Promise<void> {
    this.flushTimer = undefined;
    const refreshState = this.pendingStateRefresh || this.pendingConfigCheck;
    const checkConfig = this.pendingConfigCheck;
    this.pendingStateRefresh = false;
    this.pendingConfigCheck = false;

    try {
      this.filesEmitter.fire();
      if (refreshState) {
        await this.safeRefresh({ checkConfig });
      }
    } catch (error) {
      // Runs from a timer, so nothing above it would catch a failing listener.
      this.logger.error("Handling file changes failed.", error);
    }
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  private disposeWatcher(): void {
    vscode.Disposable.from(...this.watcherDisposables).dispose();
    this.watcherDisposables = [];
  }
}
