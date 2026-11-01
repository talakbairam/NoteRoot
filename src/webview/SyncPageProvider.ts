import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { Strings } from "../constants/strings";
import { Logger } from "../services/Logger";
import { countChanges, type Change } from "../services/SyncPlan";
import type { RootFolderService } from "../services/RootFolderService";
import type { GoogleClientStore } from "../services/GoogleClientStore";
import type { SavedSecretsService } from "../services/SavedSecretsService";
import type { SearchService } from "../services/SearchService";
import type { SettingsService } from "../services/SettingsService";
import type { SyncHub } from "../services/SyncHub";
import type { SyncService } from "../services/SyncService";
import {
  parseSyncPageMessage,
  type ExtensionToSyncPageMessage,
  type SyncChangeRow,
  type SyncPageAction,
  type SyncPageModel,
  type SyncProviderRow,
  type SyncPageTexts,
  type SyncPageToExtensionMessage,
} from "./syncMessages";

const PANEL_TYPE = "noteRoot.syncPage";

/** The page lists at most this many notes of the list of the files to encrypt. */
const MAX_ENCRYPTED_FILES = 200;
/** The notes are listed a moment after the last change of the files or of the list, so typing or a big pull does not walk the folder again and again. */
const FILES_DELAY_MS = 600;

/** What each button of the page runs: the same commands as the palette, so the questions and checks are the same. */
const ACTION_COMMANDS: Record<SyncPageAction, string> = {
  connect: Commands.syncConnect,
  changeTarget: Commands.syncChangeRepository,
  disconnect: Commands.syncDisconnect,
  refresh: Commands.syncRefresh,
  pull: Commands.syncPull,
  push: Commands.syncPush,
  history: Commands.syncHistory,
  hidden: Commands.syncHidden,
  autoCheckOn: Commands.enableSyncAutoCheck,
  autoCheckOff: Commands.disableSyncAutoCheck,
  encrypt: Commands.syncEncryptRepository,
  changeKey: Commands.syncChangeKey,
  forgetKey: Commands.syncForgetKey,
  openEncryptList: Commands.openSettingsPage,
  markedAction: Commands.syncMarkedAction,
  changeNames: Commands.syncChangeNames,
  autoMessage: Commands.syncAutoMessage,
  openSyncSettings: Commands.openSettingsPage,
  openOnline: Commands.syncOpenOnline,
  fixConflicts: Commands.syncPull,
  decryptRepository: Commands.syncDecryptRepository,
  refreshAll: Commands.syncRefreshAll,
  pullAll: Commands.syncPullAll,
  pushAll: Commands.syncPushAll,
};

/**
 * "NoteRoot Sync": the whole sync in a tab of the editor, with a menu of sections on the left (overview, the
 * files that changed, options, encryption). It shows what `SyncService` reports and runs the commands of the view; it
 * writes nothing itself, so the two cannot disagree, and it follows the service, so a change shows up at once.
 */
export class SyncPageProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  /** True while the current page has announced itself with `ready`. */
  private ready = false;
  private readonly subscriptions: vscode.Disposable[];
  /** The notes that the list chooses, read by `readEncryptedFiles`. */
  private encryptedFiles: { files: string[]; more: boolean } = { files: [], more: false };
  private filesTimer: NodeJS.Timeout | undefined;
  /** The service and section the page was asked to show; given to it when it is ready, and when it is shown again. */
  private start: { provider: string; section: "changes" } | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sync: SyncHub,
    private readonly rootService: RootFolderService,
    private readonly settings: SettingsService,
    private readonly searchService: SearchService,
    private readonly googleClients: GoogleClientStore,
    private readonly savedSecrets: SavedSecretsService,
    private readonly logger: Logger
  ) {
    const refresh = (): void => this.post({ type: "update", models: this.models() });
    const refreshFiles = (): void => this.scheduleEncryptedFiles();
    this.subscriptions = [
      sync.onDidChange(refresh),
      googleClients.onDidChange(refresh),
      savedSecrets.onDidChange(refresh),
      rootService.onDidChangeState(refresh),
      settings.onDidChange(() => {
        refresh();
        refreshFiles();
      }),
      rootService.onDidChangeFiles(refreshFiles),
      rootService.onDidChangeRoot(refreshFiles),
      { dispose: () => clearTimeout(this.filesTimer) },
    ];
  }

  /**
   * Opens the page in a new tab, or shows the one that is open. `start` is the service and the section to show (the list of
   * services otherwise).
   */
  open(start?: { provider: string; section: "changes" }): void {
    this.start = start;
    if (this.panel) {
      this.panel.reveal();
      this.showStart();
      return;
    }
    const pagesRoot = vscode.Uri.joinPath(this.extensionUri, "webview");
    const panel = vscode.window.createWebviewPanel(
      PANEL_TYPE,
      Strings.syncPage.title,
      vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [pagesRoot] }
    );
    this.panel = panel;
    this.ready = false;
    panel.webview.html = this.renderHtml(panel.webview, pagesRoot);
    panel.webview.onDidReceiveMessage((raw: unknown) => {
      const message = parseSyncPageMessage(raw);
      if (!message) {
        this.logger.warn("Ignored an invalid message from the Sync page.");
        return;
      }
      this.handleMessage(message).catch((error: unknown) =>
        this.logger.error("Sync page message failed.", error)
      );
    });
    panel.onDidDispose(() => {
      if (this.panel === panel) {
        this.panel = undefined;
        this.ready = false;
      }
    });
  }

  dispose(): void {
    this.panel?.dispose();
    vscode.Disposable.from(...this.subscriptions).dispose();
  }

  private async handleMessage(message: SyncPageToExtensionMessage): Promise<void> {
    if (message.type === "ready") {
      this.ready = true;
      this.post({ type: "init", texts: this.texts(), models: this.models() });
      this.scheduleEncryptedFiles();
      void this.checkConnected();
      this.showStart();
    } else if (message.type === "action") {
      // The commands report their own errors (registerSafeCommand), so the page only starts them.
      // The list of the files to encrypt is in the Sync & Encryption group of the Settings page: open the page there.
      // The others get the service that is open on the page, so the command acts on it and does not ask.
      const argument =
        message.action === "openEncryptList" || message.action === "openSyncSettings"
          ? "sync"
          : message.provider;
      await vscode.commands.executeCommand(ACTION_COMMANDS[message.action], argument);
    } else if (message.type === "chooseConflict") {
      await vscode.commands.executeCommand(
        Commands.syncChooseConflict,
        message.path,
        message.resolution,
        message.provider
      );
    } else if (message.type === "diffFile") {
      await vscode.commands.executeCommand(Commands.syncDiffFile, message.path, message.provider);
    } else {
      await vscode.commands.executeCommand(
        Commands.syncShowChange,
        message.side,
        message.path,
        message.kind,
        message.provider
      );
    }
  }

  /**
   * Opening the page compares each connected service with its remote, so the status is not "Remote not checked yet". It only
   * reads (nothing is sent, and no sign-in window opens: a service that is not signed in simply stays unchecked), and it is
   * quiet when it fails or when another sync action is running.
   */
  private async checkConnected(): Promise<void> {
    if (!this.rootService.hasRoot) {
      return;
    }
    for (const service of this.sync.connected) {
      try {
        await service.refresh();
      } catch (error) {
        this.logger.debug(
          `The check when the Sync page opened failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  /** Tells the page to show the service and section it was opened for (once). */
  private showStart(): void {
    if (this.start && this.ready) {
      this.post({ type: "show", provider: this.start.provider, section: this.start.section });
      this.start = undefined;
    }
  }

  /** Messages for a page that is not ready are dropped: its `init` carries the current model anyway. */
  private post(message: ExtensionToSyncPageMessage): void {
    if (this.panel && this.ready) {
      this.panel.webview
        .postMessage(message)
        .then(undefined, (error: unknown) =>
          this.logger.error("Could not post to the Sync page.", error)
        );
    }
  }

  /** Reads the notes of the list a moment later (see FILES_DELAY_MS), and sends them to the page. */
  private scheduleEncryptedFiles(): void {
    if (!this.panel) {
      return;
    }
    clearTimeout(this.filesTimer);
    this.filesTimer = setTimeout(() => {
      this.readEncryptedFiles()
        .then(() => this.post({ type: "update", models: this.models() }))
        .catch((error: unknown) => this.logger.error("Could not list the encrypted notes.", error));
    }, FILES_DELAY_MS);
  }

  /** The notes of the folder that the list of the files to encrypt chooses (hidden files are left out, like the tree). */
  private async readEncryptedFiles(): Promise<void> {
    const files: string[] = [];
    let more = false;
    if (this.rootService.hasRoot && this.settings.encryptPatterns.length > 0) {
      for await (const file of this.searchService.walkFiles()) {
        if (!this.sync.isSealedPath(file.relativePath)) {
          continue;
        }
        if (files.length >= MAX_ENCRYPTED_FILES) {
          more = true;
          break;
        }
        files.push(file.relativePath);
      }
    }
    this.encryptedFiles = { files, more };
  }

  private texts(): SyncPageTexts {
    return { ...Strings.syncPage };
  }

  /** The model of each service by its id: every service of the sync has its own connection, changes and options. */
  private models(): Record<string, SyncPageModel> {
    const each = this.sync.services.map((service) => ({ service, model: this.baseModel(service) }));
    const providers = each.map(({ service, model }) => this.providerRow(service, model));
    return Object.fromEntries(
      each.map(({ service, model }) => [service.provider.id, { ...model, providers }])
    );
  }

  /** A service of the list at the start of the page, with its status. */
  private providerRow(service: SyncService, model: SyncPageModel): SyncProviderRow {
    const text = Strings.syncPage;
    const provider = service.provider;
    const connected = model.connected;
    return {
      id: provider.id,
      label: provider.label,
      connected,
      status: connected
        ? { text: model.state.text, tone: model.state.tone }
        : { text: text.providerNotConnected, tone: "off" },
      summary:
        connected && model.target
          ? model.target.detail
            ? `${model.target.label} (${model.target.detail})`
            : model.target.label
          : provider.description,
    };
  }

  private baseModel(service: SyncService): SyncPageModel {
    const connection = service.connection;
    const snapshot = service.snapshot;
    const status = snapshot.status;
    const base: SyncPageModel = {
      problem: this.rootService.hasRoot ? undefined : Strings.sync.noRoot,
      connected: connection !== undefined,
      busy: this.sync.isBusy,
      service: undefined,
      target: undefined,
      state: { text: Strings.sync.notChecked, tone: "info", detail: undefined },
      local: [],
      remote: [],
      remoteCompared: snapshot.remoteCompared,
      compared: status !== undefined,
      hasNewVersion: snapshot.hasNewVersion,
      keepLast: undefined,
      includeHidden: false,
      autoCheck: this.sync.isAutoCheckOn,
      encryption: null,
      encryptList: [...this.settings.encryptPatterns],
      encryptedFiles: this.encryptedFiles.files,
      encryptedFilesMore: this.encryptedFiles.more,
      markedAction: this.settings.syncMarkedAction,
      autoMessage: this.settings.syncAutoMessage,
      googleClient: { source: this.googleClients.source, missing: this.googleClients.missing },
      ignoreList: [...this.settings.syncIgnorePatterns],
      gitlab: { tokenSaved: this.savedSecrets.state.gitlab, address: this.settings.gitlabAddress },
      dropboxKeySet: this.settings.dropboxAppKey !== "",
      providers: [],
    };
    if (!connection) {
      return base;
    }
    const noun = connection.provider.versionNoun;
    const conflicts = new Set(status?.conflicts ?? []);
    const rows = (changes: readonly Change[]): SyncChangeRow[] =>
      changes.map((change) => ({
        path: change.path,
        kind: change.kind,
        kindText: Strings.sync.kind[change.kind],
        conflict: conflicts.has(change.path),
        choice: service.conflictChoices.get(change.path) ?? null,
        seal: service.sealOf(change),
      }));
    const time = snapshot.checkedAt?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return {
      ...base,
      service: {
        id: connection.provider.id,
        label: connection.provider.label,
        targetNoun: connection.provider.targetNoun,
        versionNoun: noun,
        canLimitHistory: connection.provider.canLimitHistory,
        canOpenOnline: connection.provider.webUrl?.(connection.target) !== undefined,
      },
      target: {
        label: connection.target.label,
        detail: connection.target.detail,
        isPrivate: connection.target.isPrivate,
      },
      state: this.stateOf(service, noun, time),
      local: status ? rows(status.local) : [],
      remote: status ? rows(status.remote) : [],
      keepLast: connection.keepLast,
      includeHidden: connection.includeHidden,
      encryption: connection.encryption
        ? { names: connection.encryption.names, custom: connection.encryption.custom === true }
        : null,
    };
  }

  /** The sentence that says where things stand, the same words as the sync row. */
  private stateOf(
    service: SyncService,
    noun: string,
    time: string | undefined
  ): SyncPageModel["state"] {
    const snapshot = service.snapshot;
    const status = snapshot.status;
    const checked = time ? Strings.sync.checkedAt(time) : undefined;
    if (this.sync.isBusy) {
      return { text: Strings.sync.checking, tone: "busy", detail: undefined };
    }
    if (!status) {
      return snapshot.hasNewVersion
        ? { text: Strings.sync.newVersion(noun), tone: "warn", detail: undefined }
        : { text: Strings.sync.notChecked, tone: "info", detail: undefined };
    }
    if (!snapshot.remoteCompared) {
      return {
        text: Strings.sync.remoteNotChecked,
        tone: "info",
        detail: status.local.length > 0 ? Strings.sync.changedHere(status.local.length) : undefined,
      };
    }
    const counts = countChanges(status);
    if (
      counts.push === 0 &&
      counts.pull === 0 &&
      counts.conflicts === 0 &&
      !snapshot.hasNewVersion
    ) {
      return { text: Strings.sync.inSync, tone: "ok", detail: checked };
    }
    return {
      text: snapshot.hasNewVersion
        ? Strings.sync.newVersion(noun)
        : Strings.sync.refreshed(counts.push, counts.pull, counts.conflicts),
      tone: snapshot.hasNewVersion ? "warn" : "info",
      detail: checked,
    };
  }

  private renderHtml(webview: vscode.Webview, pagesRoot: vscode.Uri): string {
    const nonce = randomBytes(16).toString("base64");
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(pagesRoot, "syncPage", "syncPage.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(pagesRoot, "syncPage", "syncPage.js")
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${styleUri}">
	<title>${escapeHtml(Strings.syncPage.title)}</title>
</head>
<body>
	<main id="page"></main>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
