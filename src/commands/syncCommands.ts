import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { Strings } from "../constants/strings";
import { Logger } from "../services/Logger";
import type { OnlineViewService } from "../services/OnlineViewService";
import { PathGuard } from "../services/PathGuard";
import { RootFolderService } from "../services/RootFolderService";
import type { Resolution } from "../services/SyncPlan";
import {
  DEFAULT_KEEP_LAST,
  MAX_KEEP_LAST,
  type RemoteTarget,
  type SyncProvider,
} from "../services/SyncProvider";
import type {
  ConflictRequest,
  ConflictResolver,
  SyncConnection,
  SyncService,
} from "../services/SyncService";
import type { EncryptionConfig } from "../services/EncryptedSyncProvider";
import type { NameMode } from "../services/SyncCrypto";
import { SyncRefusedError } from "../util/errors";
import { showStatus } from "../util/status";
import { registerSafeCommand } from "./safe";
import { askNewMasterKey } from "./syncKeyPrompt";

/** A file bigger than this is not shown in the diff of the Actions panel. */
const MAX_DIFF_BYTES = 2_000_000;

/** The command that VS Code makes for every view: shows it and focuses it. */
const FOCUS_SYNC_VIEW = "noteRoot.sync.focus";

export interface SyncCommandDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  rootService: RootFolderService;
  pathGuard: PathGuard;
  syncService: SyncService;
  onlineView: OnlineViewService;
}

export function registerSyncCommands(deps: SyncCommandDependencies): void {
  const { context, logger, rootService, pathGuard, syncService, onlineView } = deps;

  /** Every action that talks to a service starts here: a notes folder, and a sign-in (VS Code asks if there is none). */
  const prepare = async (provider: SyncProvider): Promise<boolean> => {
    if (!rootService.getRootUri()) {
      throw new SyncRefusedError(Strings.sync.noRoot);
    }
    if (!(await provider.signIn())) {
      void vscode.window.showWarningMessage(Strings.sync.signInFailed(provider.label));
      return false;
    }
    return true;
  };

  /** The connection of this notes folder, signed in. Undefined when the user declined the sign-in. */
  const prepareConnection = async (): Promise<SyncConnection | undefined> => {
    const connection = syncService.connection;
    if (!connection) {
      throw new SyncRefusedError(Strings.sync.notConnected);
    }
    return (await prepare(connection.provider)) ? connection : undefined;
  };

  const withProgress = <T>(title: string, task: () => Promise<T>): Thenable<T> =>
    vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title }, task);

  const refresh = async (): Promise<void> => {
    const snapshot = await withProgress(Strings.sync.checking, () => syncService.refresh());
    const status = snapshot.status;
    if (status) {
      showStatus(Strings.sync.refreshed(status.local.length, status.remote.length));
    }
  };

  /** Pulls (the questions for conflicts come first) and tells what happened. True when it finished without problems. */
  const runPull = async (): Promise<boolean> => {
    const result = await withProgress(Strings.sync.pulling, () =>
      syncService.pull(resolveConflicts)
    );
    if (result.cancelled) {
      return false;
    }
    const nothing = result.written === 0 && result.trashed === 0 && result.failed === 0;
    if (nothing) {
      void vscode.window.showInformationMessage(Strings.sync.nothingToPull);
    } else {
      showStatus(Strings.sync.pulled(result.written, result.trashed), 2);
    }
    if (result.copies.length > 0) {
      void vscode.window.showInformationMessage(Strings.sync.keptBoth(result.copies.join(", ")));
    }
    if (result.invalidConfig) {
      void vscode.window.showWarningMessage(Strings.sync.configInvalid);
    }
    if (result.failed > 0) {
      void vscode.window.showWarningMessage(Strings.sync.someFailed(result.failed));
    }
    return result.failed === 0;
  };

  /**
   * Pushes what changed here. When there are changes online that are not here yet, it offers to pull first and then push,
   * like `git pull` and `git push`: every question of the pull and of the push is still asked.
   */
  const runPush = async (options: { afterPull: boolean }): Promise<void> => {
    const connection = await prepareConnection();
    if (!connection) {
      return;
    }
    await refresh();
    const status = syncService.snapshot.status;
    if (!status) {
      return;
    }
    if (syncService.snapshot.hasNewVersion || status.remote.length > 0) {
      if (options.afterPull) {
        void vscode.window.showWarningMessage(Strings.sync.stillBehind);
        return;
      }
      const answer = await vscode.window.showWarningMessage(
        Strings.sync.pullFirst,
        Strings.sync.pullThenPush,
        Strings.sync.pullAction
      );
      if (answer === Strings.sync.pullThenPush) {
        if (await runPull()) {
          await runPush({ afterPull: true });
        }
      } else if (answer === Strings.sync.pullAction) {
        await runPull();
      }
      return;
    }
    if (status.local.length === 0) {
      void vscode.window.showInformationMessage(Strings.sync.nothingToPush);
      return;
    }
    if (!connection.target.isPrivate) {
      const answer = await vscode.window.showWarningMessage(
        Strings.sync.pushNeedsConfirm(status.local.length, connection.provider.targetNoun),
        { modal: true },
        Strings.sync.pushAction
      );
      if (answer !== Strings.sync.pushAction) {
        return;
      }
    }
    const unsaved = unsavedNotes(pathGuard);
    if (unsaved > 0) {
      const answer = await vscode.window.showWarningMessage(
        Strings.sync.unsavedWarning(unsaved),
        { modal: true },
        Strings.sync.pushSaved
      );
      if (answer !== Strings.sync.pushSaved) {
        return;
      }
    }
    const message = await vscode.window.showInputBox({
      prompt: Strings.sync.commitMessagePrompt,
      value: Strings.sync.defaultCommitMessage(
        new Date().toISOString().slice(0, 16).replace("T", " ")
      ),
      validateInput: (value) =>
        value.trim().length === 0 ? Strings.sync.commitMessageEmpty : undefined,
    });
    if (message === undefined) {
      return;
    }
    const result = await withProgress(Strings.sync.pushing, () => syncService.push(message.trim()));
    if (result.files === 0) {
      void vscode.window.showInformationMessage(Strings.sync.nothingToPush);
    } else {
      showStatus(Strings.sync.pushedStatus(result.files), 2);
      void vscode.window.showInformationMessage(
        Strings.sync.pushed(result.files, connection.target.label)
      );
    }
  };

  // ----- connecting -----

  const connect = async (): Promise<void> => {
    const provider = await pickProvider(syncService.providers);
    if (!provider || !(await prepare(provider))) {
      return;
    }
    const target = await pickTarget(provider);
    if (!target) {
      return;
    }
    if (!target.isPrivate) {
      const answer = await vscode.window.showWarningMessage(
        Strings.sync.publicWarning(target.label),
        { modal: true },
        Strings.sync.useAnyway
      );
      if (answer !== Strings.sync.useAnyway) {
        return;
      }
    }
    const current = syncService.connection;
    if (current && (current.provider.id !== provider.id || current.target.id !== target.id)) {
      const answer = await vscode.window.showWarningMessage(
        Strings.sync.switchWarning(target.label),
        { modal: true },
        Strings.sync.connectAction
      );
      if (answer !== Strings.sync.connectAction) {
        return;
      }
    }
    // Only for a service that can do it: keep every commit (the usual way), the last few, or only one.
    let keepLast: number | undefined;
    if (provider.canLimitHistory) {
      const answer = await askHistoryMode(target.label, undefined);
      if (!answer) {
        return;
      }
      keepLast = answer.keepLast;
    }
    // Encrypted notes: a repository that NoteRoot encrypted is opened as such; an empty one can be encrypted from the start.
    const encryption = await chooseEncryption(provider, target);
    if (encryption === "cancelled") {
      return;
    }
    // Hidden files stay out unless the user wants them online too.
    const includeHidden = await askHiddenMode(target.label, false);
    if (includeHidden === undefined) {
      return;
    }
    await syncService.connect(provider, target, encryption);
    if (includeHidden) {
      await syncService.setIncludeHidden(true);
    }
    if (encryption) {
      void vscode.window.showInformationMessage(
        Strings.sync.encryption.connectedEncrypted(target.label)
      );
    }
    if (keepLast !== undefined) {
      await syncService.setKeepLast(keepLast);
    }
    showStatus(Strings.sync.connected(target.label), 2);
    await vscode.commands.executeCommand(FOCUS_SYNC_VIEW);
    await refresh();
    // A repository that already has files: bring them here now. Conflicts are asked, nothing is overwritten silently.
    if ((syncService.snapshot.status?.remote.length ?? 0) > 0) {
      await runPull();
    }
  };

  /**
   * Looks at what is online. Notes that NoteRoot encrypted are used as encrypted (the master key is asked when they are
   * opened). An empty target can be encrypted from the start: how the names show, then a new master key. A target with plain
   * notes is used as it is. Returns "cancelled" when the user backed out.
   */
  const chooseEncryption = async (
    provider: SyncProvider,
    target: RemoteTarget
  ): Promise<EncryptionConfig | undefined | "cancelled"> => {
    const kind = await withProgress(Strings.sync.checking, () =>
      syncService.inspectTarget(provider, target)
    );
    if (kind.kind === "encrypted") {
      return { names: kind.names, salt: kind.salt };
    }
    if (kind.kind === "plain") {
      return undefined;
    }
    const wanted = await vscode.window.showQuickPick(
      [
        {
          label: Strings.sync.encryption.no,
          detail: Strings.sync.encryption.noDetail,
          encrypt: false,
        },
        {
          label: Strings.sync.encryption.yes,
          detail: Strings.sync.encryption.yesDetail,
          encrypt: true,
        },
      ],
      { title: Strings.sync.encryption.title, placeHolder: Strings.sync.encryption.placeholder }
    );
    if (!wanted) {
      return "cancelled";
    }
    if (!wanted.encrypt) {
      return undefined;
    }
    const names = await askNameMode();
    if (names === undefined) {
      return "cancelled";
    }
    const masterKey = await askNewMasterKey();
    if (masterKey === undefined) {
      return "cancelled";
    }
    return syncService.prepareEncryption(provider, target, names, masterKey);
  };

  registerSafeCommand(context, logger, Commands.syncConnect, connect);
  registerSafeCommand(context, logger, Commands.syncChangeRepository, connect);

  registerSafeCommand(context, logger, Commands.syncDisconnect, async () => {
    const connection = syncService.connection;
    if (!connection) {
      return;
    }
    const answer = await vscode.window.showWarningMessage(
      Strings.sync.disconnectConfirm(connection.target.label),
      { modal: true },
      Strings.sync.disconnectAction
    );
    if (answer === Strings.sync.disconnectAction) {
      await syncService.disconnect();
      showStatus(Strings.sync.disconnected);
    }
  });

  registerSafeCommand(context, logger, Commands.syncHistory, async () => {
    const connection = syncService.connection;
    if (!connection) {
      throw new SyncRefusedError(Strings.sync.notConnected);
    }
    if (!connection.provider.canLimitHistory) {
      void vscode.window.showInformationMessage(
        Strings.sync.historyUnsupported(connection.provider.label)
      );
      return;
    }
    const answer = await askHistoryMode(connection.target.label, connection.keepLast);
    if (!answer || answer.keepLast === connection.keepLast) {
      return;
    }
    await syncService.setKeepLast(answer.keepLast);
    showStatus(
      answer.keepLast === undefined
        ? Strings.sync.historyOff
        : Strings.sync.historyOn(answer.keepLast),
      2
    );
  });

  registerSafeCommand(context, logger, Commands.syncHidden, async () => {
    const connection = syncService.connection;
    if (!connection) {
      throw new SyncRefusedError(Strings.sync.notConnected);
    }
    const include = await askHiddenMode(connection.target.label, connection.includeHidden);
    if (include === undefined || include === connection.includeHidden) {
      return;
    }
    await syncService.setIncludeHidden(include);
    showStatus(include ? Strings.sync.hidden.on : Strings.sync.hidden.off, 2);
  });

  /**
   * A click on a file of the panel: shows what changed. A file on both sides opens the diff (the online version on the side
   * that is not yours), a file that only one side has opens alone. Nothing is changed here or online.
   */
  registerSafeCommand(
    context,
    logger,
    Commands.syncShowChange,
    async (side?: unknown, path?: unknown, kind?: unknown) => {
      if (
        (side !== "local" && side !== "remote") ||
        typeof path !== "string" ||
        (kind !== "added" && kind !== "modified" && kind !== "deleted")
      ) {
        return;
      }
      const localUri = pathGuard.resolveRelative(path);
      const name = path.slice(path.lastIndexOf("/") + 1);
      const hasLocal = await fileExists(localUri);
      // Only a file that is online has an online version to show.
      const hasOnline = !(
        (side === "local" && kind === "added") ||
        (side === "remote" && kind === "deleted")
      );
      let onlineUri: vscode.Uri | undefined;
      if (hasOnline) {
        const online = await readOnline(path);
        if (online === "gone") {
          void vscode.window.showInformationMessage(Strings.sync.diff.gone(path));
          return;
        }
        onlineUri = online;
      }
      const openLocal = async (): Promise<void> => {
        if (hasLocal) {
          await vscode.commands.executeCommand(Commands.openNoteFile, localUri);
        }
      };
      const openAlone = async (uri: vscode.Uri): Promise<void> => {
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document, { preview: true });
      };
      if (!onlineUri) {
        await openLocal();
        return;
      }
      if (hasLocal && kind === "modified") {
        await vscode.commands.executeCommand(
          "vscode.diff",
          side === "local" ? onlineUri : localUri,
          side === "local" ? localUri : onlineUri,
          side === "local"
            ? Strings.sync.diff.localTitle(name)
            : Strings.sync.diff.remoteTitle(name)
        );
        return;
      }
      await openAlone(onlineUri);
    }
  );

  /** The online version of a file as a read-only document, or why there is none. */
  const readOnline = async (path: string): Promise<vscode.Uri | "gone" | undefined> => {
    const bytes = await syncService.readRemoteFile(path);
    if (bytes === undefined) {
      return "gone";
    }
    if (bytes.length > MAX_DIFF_BYTES) {
      void vscode.window.showInformationMessage(Strings.sync.diff.tooBig(path));
      return undefined;
    }
    if (bytes.subarray(0, 8000).includes(0)) {
      void vscode.window.showInformationMessage(Strings.sync.diff.binary(path));
      return undefined;
    }
    return onlineView.add(path, Buffer.from(bytes).toString("utf8"));
  };

  registerSafeCommand(context, logger, Commands.syncForgetKey, async () => {
    const connection = syncService.connection;
    if (!connection) {
      throw new SyncRefusedError(Strings.sync.notConnected);
    }
    if (!connection.encryption) {
      void vscode.window.showInformationMessage(Strings.sync.encryption.notEncrypted);
      return;
    }
    await syncService.forgetKey();
    showStatus(Strings.sync.encryption.forgetDone, 2);
  });

  registerSafeCommand(context, logger, Commands.syncChangeKey, async () => {
    const connection = await prepareConnection();
    if (!connection) {
      return;
    }
    if (!connection.encryption) {
      void vscode.window.showInformationMessage(Strings.sync.encryption.notEncrypted);
      return;
    }
    const label = connection.target.label;
    const answer = await vscode.window.showWarningMessage(
      Strings.sync.encryption.changeKeyConfirm(label),
      { modal: true },
      Strings.sync.encryption.changeKeyAction
    );
    if (answer !== Strings.sync.encryption.changeKeyAction) {
      return;
    }
    const dropHistory = await askDropHistory();
    if (dropHistory === undefined) {
      return;
    }
    const masterKey = await askNewMasterKey();
    if (masterKey === undefined) {
      return;
    }
    await withProgress(Strings.sync.encryption.working, () =>
      syncService.changeMasterKey({ masterKey, dropHistory })
    );
    void vscode.window.showInformationMessage(Strings.sync.encryption.changeKeyDone(label));
  });

  registerSafeCommand(context, logger, Commands.syncEncryptRepository, async () => {
    const connection = await prepareConnection();
    if (!connection) {
      return;
    }
    if (connection.encryption) {
      void vscode.window.showInformationMessage(Strings.sync.encryption.alreadyEncrypted);
      return;
    }
    const label = connection.target.label;
    const answer = await vscode.window.showWarningMessage(
      Strings.sync.encryption.convertConfirm(label),
      { modal: true },
      Strings.sync.encryption.convertAction
    );
    if (answer !== Strings.sync.encryption.convertAction) {
      return;
    }
    const names = await askNameMode();
    if (names === undefined) {
      return;
    }
    const dropHistory = await askDropHistory();
    if (dropHistory === undefined) {
      return;
    }
    const masterKey = await askNewMasterKey();
    if (masterKey === undefined) {
      return;
    }
    await withProgress(Strings.sync.encryption.working, () =>
      syncService.encryptRepository({ names, masterKey, dropHistory })
    );
    void vscode.window.showInformationMessage(
      Strings.sync.encryption.convertDone(label, dropHistory)
    );
  });

  // ----- refresh, push, pull -----

  registerSafeCommand(context, logger, Commands.syncRefresh, async () => {
    if (await prepareConnection()) {
      await refresh();
    }
  });

  registerSafeCommand(context, logger, Commands.syncPush, () => runPush({ afterPull: false }));

  registerSafeCommand(context, logger, Commands.syncPull, async () => {
    if (await prepareConnection()) {
      await runPull();
    }
  });

  // ----- the check for a new version -----

  registerSafeCommand(context, logger, Commands.enableSyncAutoCheck, async () => {
    await syncService.setAutoCheck(true);
    void vscode.window.showInformationMessage(
      Strings.sync.autoCheckOn(syncService.connection?.provider.versionNoun ?? "version")
    );
  });
  registerSafeCommand(context, logger, Commands.disableSyncAutoCheck, async () => {
    await syncService.setAutoCheck(false);
    showStatus(Strings.sync.autoCheckOff);
  });

  context.subscriptions.push(
    syncService.onDidFindNewVersion((connection) => {
      void vscode.window
        .showInformationMessage(
          Strings.sync.newOnline(connection.target.label, connection.provider.versionNoun),
          Strings.sync.showActions
        )
        .then((choice) => {
          if (choice === Strings.sync.showActions) {
            return vscode.commands.executeCommand(FOCUS_SYNC_VIEW);
          }
          return undefined;
        });
    })
  );
}

// ----- questions -----

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false; // Not there.
  }
}

interface NameModeItem extends vscode.QuickPickItem {
  names: NameMode;
}

/** Asks how the file names show online: kept (`note.md.enc`) or hidden (codes). Undefined when the user cancelled. */
async function askNameMode(): Promise<NameMode | undefined> {
  const items: NameModeItem[] = [
    {
      label: Strings.sync.encryption.namesPlain,
      detail: Strings.sync.encryption.namesPlainDetail,
      names: "plain",
    },
    {
      label: Strings.sync.encryption.namesHidden,
      detail: Strings.sync.encryption.namesHiddenDetail,
      names: "hidden",
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: Strings.sync.encryption.namesTitle,
    placeHolder: Strings.sync.encryption.namesPlaceholder,
  });
  return picked?.names;
}

interface DropItem extends vscode.QuickPickItem {
  drop: boolean;
}

/** Asks whether the older commits are dropped (the branch becomes one commit). Undefined when the user cancelled. */
async function askDropHistory(): Promise<boolean | undefined> {
  const items: DropItem[] = [
    {
      label: Strings.sync.encryption.dropKeep,
      detail: Strings.sync.encryption.dropKeepDetail,
      drop: false,
    },
    {
      label: Strings.sync.encryption.dropDrop,
      detail: Strings.sync.encryption.dropDropDetail,
      drop: true,
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: Strings.sync.encryption.dropTitle,
    placeHolder: Strings.sync.encryption.dropPlaceholder,
  });
  return picked?.drop;
}

interface HiddenItem extends vscode.QuickPickItem {
  include: boolean;
}

/**
 * Asks whether the files that NoteRoot hides are synced too. Including them needs a confirmation, because files such as
 * .vscode or .claude may not be meant for a repository. Returns true to include, false to leave them out, undefined when the
 * user cancelled.
 */
async function askHiddenMode(label: string, current: boolean): Promise<boolean | undefined> {
  const mark = ` (${Strings.sync.hidden.current})`;
  const items: HiddenItem[] = [
    {
      label: Strings.sync.hidden.skip + (current ? "" : mark),
      detail: Strings.sync.hidden.skipDetail,
      include: false,
    },
    {
      label: Strings.sync.hidden.include + (current ? mark : ""),
      detail: Strings.sync.hidden.includeDetail,
      include: true,
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: Strings.sync.hidden.title,
    placeHolder: Strings.sync.hidden.placeholder,
  });
  if (!picked) {
    return undefined;
  }
  if (picked.include && !current) {
    const answer = await vscode.window.showWarningMessage(
      Strings.sync.hidden.confirm(label),
      { modal: true },
      Strings.sync.hidden.confirmAction
    );
    if (answer !== Strings.sync.hidden.confirmAction) {
      return undefined;
    }
  }
  return picked.include;
}

interface HistoryItem extends vscode.QuickPickItem {
  mode: "all" | "last" | "one";
}

/**
 * Asks how much of the history stays online: every commit (the usual way), the last few (the user types how many, 5 to
 * start with) or only one. Dropping commits needs a confirmation, because they are lost for good. `current` is how many
 * are kept now (undefined: all). Returns the new number (undefined for all), or undefined when the user cancelled.
 */
async function askHistoryMode(
  label: string,
  current: number | undefined
): Promise<{ keepLast: number | undefined } | undefined> {
  const mark = ` (${Strings.sync.historyCurrent})`;
  const items: HistoryItem[] = [
    {
      label: Strings.sync.historyKeep + (current === undefined ? mark : ""),
      detail: Strings.sync.historyKeepDetail,
      mode: "all",
    },
    {
      label: Strings.sync.historyLast + (current !== undefined && current > 1 ? mark : ""),
      detail: Strings.sync.historyLastDetail,
      mode: "last",
    },
    {
      label: Strings.sync.historySingle + (current === 1 ? mark : ""),
      detail: Strings.sync.historySingleDetail,
      mode: "one",
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: Strings.sync.historyTitle,
    placeHolder: Strings.sync.historyPlaceholder,
  });
  if (!picked) {
    return undefined;
  }
  let keepLast: number | undefined;
  if (picked.mode === "one") {
    keepLast = 1;
  } else if (picked.mode === "last") {
    const typed = await vscode.window.showInputBox({
      prompt: Strings.sync.historyCountPrompt,
      value: String(current !== undefined && current > 1 ? current : DEFAULT_KEEP_LAST),
      validateInput: (value) => {
        const count = Number(value.trim());
        return Number.isInteger(count) && count >= 1 && count <= MAX_KEEP_LAST
          ? undefined
          : Strings.sync.historyCountInvalid(MAX_KEEP_LAST);
      },
    });
    if (typed === undefined) {
      return undefined;
    }
    keepLast = Number(typed.trim());
  }
  // Only a change that can drop commits needs the confirmation (asking to keep more drops nothing).
  if (keepLast !== undefined && (current === undefined || keepLast < current)) {
    const answer = await vscode.window.showWarningMessage(
      Strings.sync.historyConfirm(label, keepLast),
      { modal: true },
      Strings.sync.historyConfirmAction
    );
    if (answer !== Strings.sync.historyConfirmAction) {
      return undefined;
    }
  }
  return { keepLast };
}

interface ProviderItem extends vscode.QuickPickItem {
  provider: SyncProvider;
}

/** Asks which service to sync with. With only one available there is nothing to ask. */
async function pickProvider(providers: readonly SyncProvider[]): Promise<SyncProvider | undefined> {
  if (providers.length === 1) {
    return providers[0];
  }
  const items: ProviderItem[] = providers.map((provider) => ({
    label: provider.label,
    description: provider.description,
    provider,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: Strings.sync.chooseProviderTitle,
    placeHolder: Strings.sync.chooseProviderPlaceholder,
  });
  return picked?.provider;
}

interface TargetItem extends vscode.QuickPickItem {
  action?: "create" | "find";
  target?: RemoteTarget;
}

/** Asks which target to use: one from the list of the service, a new one, or one found by a typed name. */
async function pickTarget(provider: SyncProvider): Promise<RemoteTarget | undefined> {
  const targets = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: provider.loading },
    () => provider.listTargets()
  );
  const items: TargetItem[] = [];
  if (provider.creator) {
    items.push({
      label: `$(add) ${provider.creator.item}`,
      detail: provider.creator.detail,
      action: "create",
    });
  }
  if (provider.finder) {
    items.push({
      label: `$(edit) ${provider.finder.item}`,
      detail: provider.finder.detail,
      action: "find",
    });
  }
  if (items.length > 0) {
    items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
  }
  items.push(
    ...targets.map((target): TargetItem => ({
      label: `$(${target.isPrivate ? "lock" : "unlock"}) ${target.label}`,
      description: target.isPrivate ? Strings.sync.privateDetail : Strings.sync.publicDetail,
      detail: target.detail,
      target,
    }))
  );
  const picked = await vscode.window.showQuickPick(items, {
    title: provider.pickTitle,
    placeHolder: provider.pickPlaceholder,
    matchOnDescription: true,
  });
  if (!picked) {
    return undefined;
  }
  if (picked.target) {
    return picked.target;
  }
  if (picked.action === "create" && provider.creator) {
    const creator = provider.creator;
    const name = await vscode.window.showInputBox({
      prompt: creator.prompt,
      value: creator.value,
      validateInput: (value) => creator.validate(value),
    });
    return name === undefined ? undefined : creator.create(name);
  }
  if (picked.action === "find" && provider.finder) {
    const finder = provider.finder;
    const typed = await vscode.window.showInputBox({
      prompt: finder.prompt,
      validateInput: (value) => finder.validate(value),
    });
    return typed === undefined ? undefined : finder.find(typed);
  }
  return undefined;
}

/** How many open notes of the notes folder have changes that are not saved (a push sends what is on disk). */
function unsavedNotes(pathGuard: PathGuard): number {
  return vscode.workspace.textDocuments.filter(
    (document) =>
      document.isDirty && document.uri.scheme === "file" && pathGuard.isInsideRoot(document.uri)
  ).length;
}

interface ResolutionItem extends vscode.QuickPickItem {
  resolution: Resolution;
}

/** Asks what to keep for the files that changed here and online. Undefined cancels the pull. */
const resolveConflicts: ConflictResolver = async (conflicts) => {
  const decisions = new Map<string, Resolution>();
  if (conflicts.length > 1) {
    const answer = await vscode.window.showWarningMessage(
      Strings.sync.conflictsFound(conflicts.length),
      { modal: true, detail: Strings.sync.conflictDetail },
      Strings.sync.reviewOneByOne,
      Strings.sync.keepAllMine,
      Strings.sync.keepAllTheirs
    );
    if (answer === undefined) {
      return undefined;
    }
    if (answer === Strings.sync.keepAllMine || answer === Strings.sync.keepAllTheirs) {
      const resolution: Resolution = answer === Strings.sync.keepAllMine ? "mine" : "theirs";
      for (const conflict of conflicts) {
        decisions.set(conflict.path, resolution);
      }
      return decisions;
    }
  }
  for (const conflict of conflicts) {
    const picked = await vscode.window.showQuickPick(optionsFor(conflict), {
      title: Strings.sync.conflictTitle(conflict.path, conflict.kind),
      placeHolder: Strings.sync.conflictDetail,
    });
    if (!picked) {
      return undefined;
    }
    decisions.set(conflict.path, picked.resolution);
  }
  return decisions;
};

function optionsFor(conflict: ConflictRequest): ResolutionItem[] {
  if (conflict.kind === "remote-deleted") {
    return [
      { label: Strings.sync.keepMine, detail: Strings.sync.keepMineDetail, resolution: "mine" },
      {
        label: Strings.sync.deleteMine,
        detail: Strings.sync.deleteMineDetail,
        resolution: "theirs",
      },
    ];
  }
  if (conflict.kind === "local-deleted") {
    return [
      {
        label: Strings.sync.keepDeleted,
        detail: Strings.sync.keepDeletedDetail,
        resolution: "mine",
      },
      { label: Strings.sync.restore, detail: Strings.sync.restoreDetail, resolution: "theirs" },
    ];
  }
  const options: ResolutionItem[] = [
    { label: Strings.sync.keepMine, detail: Strings.sync.keepMineDetail, resolution: "mine" },
    { label: Strings.sync.keepTheirs, detail: Strings.sync.keepTheirsDetail, resolution: "theirs" },
  ];
  if (conflict.canKeepBoth) {
    options.push({
      label: Strings.sync.keepBoth,
      detail: Strings.sync.keepBothDetail,
      resolution: "both",
    });
  }
  return options;
}
