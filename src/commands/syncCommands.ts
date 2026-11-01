import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { SettingKeys, type SyncMarkedAction } from "../constants/settings";
import { Strings } from "../constants/strings";
import { Logger } from "../services/Logger";
import type { OnlineViewService } from "../services/OnlineViewService";
import { PathGuard } from "../services/PathGuard";
import type { SettingsService } from "../services/SettingsService";
import { RootFolderService } from "../services/RootFolderService";
import type { SyncHub } from "../services/SyncHub";
import { countChanges, type Resolution } from "../services/SyncPlan";
import {
  DEFAULT_KEEP_LAST,
  MAX_KEEP_LAST,
  type RemoteTarget,
  type SyncProvider,
} from "../services/SyncProvider";
import type { ConflictRequest, SyncConnection, SyncService } from "../services/SyncService";
import type { EncryptionConfig } from "../services/EncryptedSyncProvider";
import type { NameMode } from "../services/SyncCrypto";
import { NoteRootError, SyncRefusedError } from "../util/errors";
import { showStatus } from "../util/status";
import { SyncStatusItem } from "../tree/NotesNode";
import type { SyncPageProvider } from "../webview/SyncPageProvider";
import { registerSafeCommand } from "./safe";
import { askNewMasterKey } from "./syncKeyPrompt";

/** A file bigger than this is not shown in the diff of the Actions panel. */
const MAX_DIFF_BYTES = 2_000_000;

export interface SyncCommandDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  rootService: RootFolderService;
  pathGuard: PathGuard;
  syncService: SyncHub;
  onlineView: OnlineViewService;
  syncPage: SyncPageProvider;
  settings: SettingsService;
}

export function registerSyncCommands(deps: SyncCommandDependencies): void {
  const {
    context,
    logger,
    rootService,
    pathGuard,
    syncService: hub,
    onlineView,
    syncPage,
    settings,
  } = deps;

  /** The id of a provider from a command argument: the id itself (the Sync page), or a row of the sync in the Notes tree. */
  const providerIdOf = (argument: unknown): string | undefined =>
    typeof argument === "string"
      ? argument
      : argument instanceof SyncStatusItem
        ? argument.providerId
        : undefined;

  /**
   * The service a command acts on: the one named by the argument; else the only one that is connected; else the user picks one of
   * the connected ones. Undefined when the user cancelled. Throws when nothing is connected.
   */
  const serviceFor = async (argument?: unknown): Promise<SyncService | undefined> => {
    const id = providerIdOf(argument);
    const named = id === undefined ? undefined : hub.service(id);
    if (named) {
      return named;
    }
    const connected = hub.connected;
    if (connected.length === 0) {
      throw new SyncRefusedError(Strings.sync.notConnected);
    }
    if (connected.length === 1) {
      return connected[0];
    }
    const picked = await vscode.window.showQuickPick(
      connected.map((service) => ({
        label: service.provider.label,
        description: service.connection?.target.label,
        service,
      })),
      { title: Strings.sync.chooseServiceTitle, placeHolder: Strings.sync.chooseServicePlaceholder }
    );
    return picked?.service;
  };

  // The page of the repository or the folder in the browser. The address comes from the provider, never from the page.
  registerSafeCommand(context, logger, Commands.syncOpenOnline, async (argument?: unknown) => {
    const service = await serviceFor(argument);
    if (!service) {
      return;
    }
    const connection = service.connection;
    if (!connection) {
      throw new SyncRefusedError(Strings.sync.notConnected);
    }
    const address = connection.provider.webUrl?.(connection.target);
    if (!address || !address.startsWith("https://")) {
      void vscode.window.showInformationMessage(Strings.sync.noWebPage(connection.provider.label));
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(address));
  });

  // A choice of the Conflicts of the Sync page: which version to keep for a file, used at the next pull. Nothing is changed now.
  registerSafeCommand(
    context,
    logger,
    Commands.syncChooseConflict,
    async (path?: unknown, resolution?: unknown, provider?: unknown) => {
      const service = await serviceFor(provider);
      if (
        !service ||
        typeof path !== "string" ||
        (resolution !== "mine" &&
          resolution !== "theirs" &&
          resolution !== "both" &&
          resolution !== "ask")
      ) {
        return;
      }
      service.setConflictChoice(path, resolution === "ask" ? undefined : resolution);
    }
  );

  // Push without the question about the message: the button of the Options of the Sync page turns it on and off.
  registerSafeCommand(context, logger, Commands.syncAutoMessage, async () => {
    await settings.setValue(SettingKeys.syncAutoMessage, !settings.syncAutoMessage);
  });

  // What Push does with a file on the list of the files to encrypt when the repository is not encrypted.
  registerSafeCommand(context, logger, Commands.syncMarkedAction, async () => {
    const text = Strings.sync;
    const items: (vscode.QuickPickItem & { action: SyncMarkedAction })[] = [
      { label: text.markedPickAsk, detail: text.markedPickAskDetail, action: "ask" },
      { label: text.markedPickPlain, detail: text.markedPickPlainDetail, action: "plain" },
      { label: text.markedPickSkip, detail: text.markedPickSkipDetail, action: "skip" },
      { label: text.markedPickEncrypt, detail: text.markedPickEncryptDetail, action: "encrypt" },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: text.markedPickTitle,
      placeHolder: text.markedPickPlaceholder,
    });
    if (picked) {
      await settings.setValue(SettingKeys.syncMarkedAction, picked.action);
    }
  });

  registerSafeCommand(context, logger, Commands.openSyncPage, () => {
    syncPage.open();
  });

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
  const prepareConnection = async (service: SyncService): Promise<SyncConnection | undefined> => {
    const connection = service.connection;
    if (!connection) {
      throw new SyncRefusedError(Strings.sync.notConnected);
    }
    return (await prepare(connection.provider)) ? connection : undefined;
  };

  const withProgress = <T>(title: string, task: () => Promise<T>): Thenable<T> =>
    vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title }, task);

  const refresh = async (service: SyncService): Promise<void> => {
    const snapshot = await withProgress(Strings.sync.checking, () => service.refresh());
    const status = snapshot.status;
    if (status) {
      const counts = countChanges(status);
      showStatus(Strings.sync.refreshed(counts.push, counts.pull, counts.conflicts));
    }
  };

  /**
   * A pull stopped because of files without a choice: nothing is asked in a pop-up, the user is sent to the Conflicts of the Sync
   * page. The files are compared again first, so the page has them. A file that is in the list only because of unsaved changes in
   * an editor is not a conflict of the page: the message then says to save it.
   */
  const sendToConflicts = async (service: SyncService, blocked: string[]): Promise<void> => {
    // Only so that the page shows the conflicts: a failure here is not the point of the message.
    await service.refresh().then(undefined, () => undefined);
    const listed = new Set(service.snapshot.status?.conflicts);
    if (!blocked.some((path) => listed.has(path))) {
      void vscode.window.showWarningMessage(Strings.sync.unsavedBlocks(blocked.length));
      return;
    }
    void vscode.window
      .showInformationMessage(
        Strings.sync.fixConflictsFirst(blocked.length),
        Strings.sync.openConflicts
      )
      .then((answer) => {
        if (answer === Strings.sync.openConflicts) {
          syncPage.open({ provider: service.provider.id, section: "changes" });
        }
        return undefined;
      });
  };

  /** Pulls (the files in conflict need a choice first) and tells what happened. True when it finished without problems. */
  const runPull = async (service: SyncService): Promise<boolean> => {
    let blocked: string[] = [];
    const result = await withProgress(Strings.sync.pulling, () =>
      service.pull((conflicts) =>
        resolveConflicts(conflicts, service.conflictChoices, (paths) => {
          blocked = paths;
        })
      )
    );
    if (result.cancelled) {
      if (blocked.length > 0) {
        await sendToConflicts(service, blocked);
      }
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
  const runPush = async (
    service: SyncService,
    options: { afterPull: boolean; message?: string }
  ): Promise<void> => {
    const connection = await prepareConnection(service);
    if (!connection) {
      return;
    }
    await refresh(service);
    const status = service.snapshot.status;
    if (!status) {
      return;
    }
    if (service.snapshot.hasNewVersion || status.remote.length > 0) {
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
        if (await runPull(service)) {
          await runPush(service, { afterPull: true });
        }
      } else if (answer === Strings.sync.pullAction) {
        await runPull(service);
      }
      return;
    }
    if (status.local.length === 0) {
      void vscode.window.showInformationMessage(Strings.sync.nothingToPush);
      return;
    }
    // Files on the list of the files to encrypt go online as plain text when the repository is not encrypted: ask first.
    let skip: string[] = [];
    if (!connection.encryption) {
      const marked = status.local
        .filter((change) => change.kind !== "deleted" && service.isSealedPath(change.path))
        .map((change) => change.path);
      if (marked.length > 0) {
        // The setting can answer for the user; "ask" shows the question.
        const policy = settings.syncMarkedAction;
        const answer =
          policy === "plain"
            ? Strings.sync.pushPlainAction
            : policy === "skip"
              ? Strings.sync.skipMarkedAction
              : policy === "encrypt"
                ? Strings.sync.encryptMarkedAction
                : await vscode.window.showWarningMessage(
                    Strings.sync.markedNotEncrypted(marked.length, connection.provider.targetNoun),
                    { modal: true, detail: Strings.sync.markedNotEncryptedDetail(marked) },
                    Strings.sync.pushPlainAction,
                    Strings.sync.encryptMarkedAction,
                    Strings.sync.skipMarkedAction
                  );
        if (answer === Strings.sync.encryptMarkedAction) {
          // Only the marked files are sealed from now on; then the push starts again, now with an encrypted target.
          if (await encryptRepositoryFlow(service, connection, "chosen")) {
            await runPush(service, options);
          }
          return;
        }
        if (answer === Strings.sync.skipMarkedAction) {
          skip = marked;
        } else if (answer !== Strings.sync.pushPlainAction) {
          return;
        }
        if (skip.length > 0 && status.local.every((change) => skip.includes(change.path))) {
          void vscode.window.showInformationMessage(Strings.sync.nothingToPush);
          return;
        }
      }
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
    // The default message, or the one the user types (or confirms) when the setting asks for it.
    const defaultMessage = Strings.sync.defaultCommitMessage(
      new Date().toISOString().slice(0, 16).replace("T", " ")
    );
    const message =
      options.message ??
      (settings.syncAutoMessage
        ? defaultMessage
        : await vscode.window.showInputBox({
            prompt: Strings.sync.commitMessagePrompt,
            value: defaultMessage,
            validateInput: (value) =>
              value.trim().length === 0 ? Strings.sync.commitMessageEmpty : undefined,
          }));
    if (message === undefined) {
      return;
    }
    const result = await withProgress(Strings.sync.pushing, () =>
      service.push(message.trim(), { skip })
    );
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

  const connect = async (argument?: unknown): Promise<void> => {
    // The Sync page and the rows of the Notes tree name the service; the Command Palette asks.
    const requested = hub.providers.find((candidate) => candidate.id === providerIdOf(argument));
    const provider = requested ?? (await pickProvider(hub.providers));
    const service = provider ? hub.service(provider.id) : undefined;
    if (!provider || !service || !(await prepare(provider))) {
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
    const current = service.connection;
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
    const encryption = await chooseEncryption(service, provider, target);
    if (encryption === "cancelled") {
      return;
    }
    // Hidden files stay out unless the user wants them online too.
    const includeHidden = await askHiddenMode(target.label, false);
    if (includeHidden === undefined) {
      return;
    }
    await service.connect(provider, target, encryption);
    if (includeHidden) {
      await service.setIncludeHidden(true);
    }
    if (encryption) {
      void vscode.window.showInformationMessage(
        Strings.sync.encryption.connectedEncrypted(target.label)
      );
    }
    if (keepLast !== undefined) {
      await service.setKeepLast(keepLast);
    }
    showStatus(Strings.sync.connected(target.label), 2);
    await refresh(service);
    // A repository that already has files: bring them here now. Conflicts are asked, nothing is overwritten silently.
    if ((service.snapshot.status?.remote.length ?? 0) > 0) {
      await runPull(service);
    }
  };

  /**
   * Looks at what is online. Notes that NoteRoot encrypted are used as encrypted (the master key is asked when they are
   * opened). An empty target can be encrypted from the start: how the names show, then a new master key. A target with plain
   * notes is used as it is. Returns "cancelled" when the user backed out.
   */
  const chooseEncryption = async (
    service: SyncService,
    provider: SyncProvider,
    target: RemoteTarget
  ): Promise<EncryptionConfig | undefined | "cancelled"> => {
    const kind = await withProgress(Strings.sync.checking, () =>
      service.inspectTarget(provider, target)
    );
    if (kind.kind === "encrypted") {
      return {
        names: kind.names,
        salt: kind.salt,
        ...(kind.custom ? { custom: true as const } : {}),
      };
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
    const custom = await askScope();
    if (custom === undefined) {
      return "cancelled";
    }
    const masterKey = await askNewMasterKey();
    if (masterKey === undefined) {
      return "cancelled";
    }
    return service.prepareEncryption(provider, target, names, masterKey, custom);
  };

  registerSafeCommand(context, logger, Commands.syncConnect, connect);
  registerSafeCommand(context, logger, Commands.syncChangeRepository, connect);

  registerSafeCommand(context, logger, Commands.syncDisconnect, async (argument?: unknown) => {
    const service = await serviceFor(argument);
    const connection = service?.connection;
    if (!service || !connection) {
      return;
    }
    const answer = await vscode.window.showWarningMessage(
      Strings.sync.disconnectConfirm(connection.target.label),
      { modal: true },
      Strings.sync.disconnectAction
    );
    if (answer === Strings.sync.disconnectAction) {
      await service.disconnect();
      showStatus(Strings.sync.disconnected);
    }
  });

  registerSafeCommand(context, logger, Commands.syncHistory, async (argument?: unknown) => {
    const service = await serviceFor(argument);
    const connection = service?.connection;
    if (!service || !connection) {
      return;
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
    await service.setKeepLast(answer.keepLast);
    showStatus(
      answer.keepLast === undefined
        ? Strings.sync.historyOff
        : Strings.sync.historyOn(answer.keepLast),
      2
    );
  });

  registerSafeCommand(context, logger, Commands.syncHidden, async (argument?: unknown) => {
    const service = await serviceFor(argument);
    const connection = service?.connection;
    if (!service || !connection) {
      return;
    }
    const include = await askHiddenMode(connection.target.label, connection.includeHidden);
    if (include === undefined || include === connection.includeHidden) {
      return;
    }
    await service.setIncludeHidden(include);
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
    async (side?: unknown, path?: unknown, kind?: unknown, provider?: unknown) => {
      const service = await serviceFor(provider);
      if (
        !service ||
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
        const online = await readOnline(service, path);
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

  // The Diff button of the Sync page: the difference between this file and the online one, whatever the kind of change.
  // With only one of the two it opens that one and says that there is nothing to compare it with.
  registerSafeCommand(
    context,
    logger,
    Commands.syncDiffFile,
    async (path?: unknown, provider?: unknown) => {
      const service = await serviceFor(provider);
      if (!service || typeof path !== "string" || path.length === 0) {
        return;
      }
      const localUri = pathGuard.resolveRelative(path);
      const name = path.slice(path.lastIndexOf("/") + 1);
      const hasLocal = await fileExists(localUri);
      // "gone" (a file that is not online, such as a new one) is not a problem here: it only means there is no second side.
      const online = await readOnline(service, path);
      if (online === undefined) {
        return; // Binary or too big: readOnline said so.
      }
      if (hasLocal && online !== "gone") {
        await vscode.commands.executeCommand(
          "vscode.diff",
          online,
          localUri,
          Strings.sync.diff.localTitle(name)
        );
      } else if (hasLocal) {
        void vscode.window.showInformationMessage(Strings.sync.diff.notOnline(path));
        await vscode.commands.executeCommand(Commands.openNoteFile, localUri);
      } else if (online !== "gone") {
        void vscode.window.showInformationMessage(Strings.sync.diff.notHere(path));
        const document = await vscode.workspace.openTextDocument(online);
        await vscode.window.showTextDocument(document, { preview: true });
      } else {
        void vscode.window.showInformationMessage(Strings.sync.diff.neither(path));
      }
    }
  );

  /** The online version of a file as a read-only document, or why there is none. */
  const readOnline = async (
    service: SyncService,
    path: string
  ): Promise<vscode.Uri | "gone" | undefined> => {
    const bytes = await service.readRemoteFile(path);
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

  registerSafeCommand(context, logger, Commands.syncForgetKey, async (argument?: unknown) => {
    const service = await serviceFor(argument);
    const connection = service?.connection;
    if (!service || !connection) {
      return;
    }
    if (!connection.encryption) {
      void vscode.window.showInformationMessage(Strings.sync.encryption.notEncrypted);
      return;
    }
    await service.forgetKey();
    showStatus(Strings.sync.encryption.forgetDone, 2);
  });

  // How the encrypted files are named online: kept (note.md.enc) or hidden. The files are sealed again, so the master key is asked.
  registerSafeCommand(context, logger, Commands.syncChangeNames, async (argument?: unknown) => {
    const service = await serviceFor(argument);
    const connection = service ? await prepareConnection(service) : undefined;
    if (!service) {
      return;
    }
    if (!connection) {
      return;
    }
    if (!connection.encryption) {
      void vscode.window.showInformationMessage(Strings.sync.encryption.notEncrypted);
      return;
    }
    const names = await askNameMode();
    if (names === undefined) {
      return;
    }
    if (names === connection.encryption.names) {
      void vscode.window.showInformationMessage(Strings.sync.encryption.changeNamesSame);
      return;
    }
    const label = connection.target.label;
    const answer = await vscode.window.showWarningMessage(
      Strings.sync.encryption.changeNamesConfirm(label),
      { modal: true },
      Strings.sync.encryption.changeNamesAction
    );
    if (answer !== Strings.sync.encryption.changeNamesAction) {
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
      service.changeMasterKey({ masterKey, dropHistory, names })
    );
    void vscode.window.showInformationMessage(Strings.sync.encryption.changeNamesDone(label));
  });

  // Turns the encryption of the target off: every note goes online as plain text and the sealed files, the header and the index are removed.
  registerSafeCommand(
    context,
    logger,
    Commands.syncDecryptRepository,
    async (argument?: unknown) => {
      const service = await serviceFor(argument);
      const connection = service ? await prepareConnection(service) : undefined;
      if (!service || !connection) {
        return;
      }
      if (!connection.encryption) {
        void vscode.window.showInformationMessage(Strings.sync.encryption.notEncrypted);
        return;
      }
      const label = connection.target.label;
      const answer = await vscode.window.showWarningMessage(
        Strings.sync.encryption.decryptConfirm(label),
        { modal: true, detail: Strings.sync.encryption.decryptDetail },
        Strings.sync.encryption.decryptAction
      );
      if (answer !== Strings.sync.encryption.decryptAction) {
        return;
      }
      // Only a service that can rewrite its history asks about it.
      const dropHistory = connection.provider.canLimitHistory ? await askDropHistory() : false;
      if (dropHistory === undefined) {
        return;
      }
      await withProgress(Strings.sync.encryption.working, () =>
        service.decryptRepository({ dropHistory })
      );
      void vscode.window.showInformationMessage(Strings.sync.encryption.decryptDone(label));
    }
  );

  registerSafeCommand(context, logger, Commands.syncChangeKey, async (argument?: unknown) => {
    const service = await serviceFor(argument);
    const connection = service ? await prepareConnection(service) : undefined;
    if (!service) {
      return;
    }
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
      service.changeMasterKey({ masterKey, dropHistory })
    );
    void vscode.window.showInformationMessage(Strings.sync.encryption.changeKeyDone(label));
  });

  /**
   * Encrypts the notes of the connected target: the questions of the command (confirm, names, which notes, the older versions,
   * the master key), then the work. With `scope` "chosen" only the files and folders of the list are sealed and the
   * question about which notes is not asked. An empty target has nothing to convert, so it is just set up for encryption.
   * Returns false when the user backed out.
   */
  const encryptRepositoryFlow = async (
    service: SyncService,
    connection: SyncConnection,
    scope: "ask" | "chosen"
  ): Promise<boolean> => {
    const label = connection.target.label;
    const answer = await vscode.window.showWarningMessage(
      Strings.sync.encryption.convertConfirm(label),
      { modal: true },
      Strings.sync.encryption.convertAction
    );
    if (answer !== Strings.sync.encryption.convertAction) {
      return false;
    }
    const names = await askNameMode();
    if (names === undefined) {
      return false;
    }
    const custom = scope === "chosen" ? true : await askScope();
    if (custom === undefined) {
      return false;
    }
    const kind = await withProgress(Strings.sync.checking, () =>
      service.inspectTarget(connection.provider, connection.target)
    );
    if (kind.kind === "empty") {
      // Nothing online yet: no older versions to drop. The first push writes the sealed notes.
      const masterKey = await askNewMasterKey();
      if (masterKey === undefined) {
        return false;
      }
      const config = await service.prepareEncryption(
        connection.provider,
        connection.target,
        names,
        masterKey,
        custom
      );
      await service.connect(connection.provider, connection.target, config);
      return true;
    }
    const dropHistory = await askDropHistory();
    if (dropHistory === undefined) {
      return false;
    }
    const masterKey = await askNewMasterKey();
    if (masterKey === undefined) {
      return false;
    }
    await withProgress(Strings.sync.encryption.working, () =>
      service.encryptRepository({ names, custom, masterKey, dropHistory })
    );
    void vscode.window.showInformationMessage(
      Strings.sync.encryption.convertDone(label, dropHistory)
    );
    return true;
  };

  registerSafeCommand(
    context,
    logger,
    Commands.syncEncryptRepository,
    async (argument?: unknown) => {
      const service = await serviceFor(argument);
      const connection = service ? await prepareConnection(service) : undefined;
      if (!service) {
        return;
      }
      if (!connection) {
        return;
      }
      if (connection.encryption) {
        void vscode.window.showInformationMessage(Strings.sync.encryption.alreadyEncrypted);
        return;
      }
      await encryptRepositoryFlow(service, connection, "ask");
    }
  );

  // ----- refresh, push, pull -----

  registerSafeCommand(context, logger, Commands.syncRefresh, async (argument?: unknown) => {
    const service = await serviceFor(argument);
    if (service && (await prepareConnection(service))) {
      await refresh(service);
    }
  });

  registerSafeCommand(context, logger, Commands.syncPush, async (argument?: unknown) => {
    const service = await serviceFor(argument);
    if (service) {
      await runPush(service, { afterPull: false });
    }
  });

  registerSafeCommand(context, logger, Commands.syncPull, async (argument?: unknown) => {
    const service = await serviceFor(argument);
    if (service && (await prepareConnection(service))) {
      await runPull(service);
    }
  });

  // ----- the same action for every connected service, one after the other -----

  /**
   * Runs `action` for each connected service, one after the other (only one sync action runs at a time). A service that fails
   * does not stop the others: its error is shown with its name. Nothing happens when no service is connected.
   */
  const forEachConnected = async (
    action: (service: SyncService) => Promise<void>
  ): Promise<void> => {
    const services = hub.connected;
    if (services.length === 0) {
      throw new SyncRefusedError(Strings.sync.notConnected);
    }
    for (const service of services) {
      try {
        await action(service);
      } catch (error) {
        logger.error(`Sync action failed for ${service.provider.id}.`, error);
        void vscode.window.showErrorMessage(
          Strings.sync.allFailed(
            service.provider.label,
            error instanceof NoteRootError ? error.message : Strings.sync.allFailedUnknown
          )
        );
      }
    }
  };

  registerSafeCommand(context, logger, Commands.syncRefreshAll, () =>
    forEachConnected(async (service) => {
      if (await prepareConnection(service)) {
        await refresh(service);
      }
    })
  );

  registerSafeCommand(context, logger, Commands.syncPullAll, () =>
    forEachConnected(async (service) => {
      if (await prepareConnection(service)) {
        await runPull(service);
      }
    })
  );

  // One message for every push (asked once, unless the setting uses the default one).
  registerSafeCommand(context, logger, Commands.syncPushAll, async () => {
    const defaultMessage = Strings.sync.defaultCommitMessage(
      new Date().toISOString().slice(0, 16).replace("T", " ")
    );
    const message = settings.syncAutoMessage
      ? defaultMessage
      : await vscode.window.showInputBox({
          prompt: Strings.sync.commitMessagePrompt,
          value: defaultMessage,
          validateInput: (value) =>
            value.trim().length === 0 ? Strings.sync.commitMessageEmpty : undefined,
        });
    if (message === undefined) {
      return;
    }
    await forEachConnected((service) =>
      runPush(service, { afterPull: false, message: message.trim() })
    );
  });

  // ----- the check for a new version -----

  registerSafeCommand(context, logger, Commands.enableSyncAutoCheck, async () => {
    await hub.setAutoCheck(true);
    void vscode.window.showInformationMessage(
      Strings.sync.autoCheckOn(hub.connected[0]?.provider.versionNoun ?? "version")
    );
  });
  registerSafeCommand(context, logger, Commands.disableSyncAutoCheck, async () => {
    await hub.setAutoCheck(false);
    showStatus(Strings.sync.autoCheckOff);
  });

  context.subscriptions.push(
    hub.onDidFindNewVersion((connection) => {
      void vscode.window
        .showInformationMessage(
          Strings.sync.newOnline(connection.target.label, connection.provider.versionNoun),
          Strings.sync.showActions
        )
        .then((choice) => {
          if (choice === Strings.sync.showActions) {
            syncPage.open();
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

interface ScopeItem extends vscode.QuickPickItem {
  custom: boolean;
}

/** Asks what is encrypted: every file, or only the files and folders of the list. Undefined when the user cancelled. */
async function askScope(): Promise<boolean | undefined> {
  const items: ScopeItem[] = [
    {
      label: Strings.sync.encryption.scopeAll,
      detail: Strings.sync.encryption.scopeAllDetail,
      custom: false,
    },
    {
      label: Strings.sync.encryption.scopeCustom,
      detail: Strings.sync.encryption.scopeCustomDetail,
      custom: true,
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: Strings.sync.encryption.scopeTitle,
    placeHolder: Strings.sync.encryption.scopePlaceholder,
  });
  return picked?.custom;
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

/**
 * Puts in effect what the user chose for the files that changed here and online (in the Conflicts of the Sync page). A file with
 * no choice is **not asked about in a pop-up**: the pull stops (undefined) and `onBlocked` gets those paths, so the command can
 * send the user to the Conflicts.
 */
async function resolveConflicts(
  conflicts: readonly ConflictRequest[],
  chosen: ReadonlyMap<string, Resolution>,
  onBlocked: (paths: string[]) => void
): Promise<ReadonlyMap<string, Resolution> | undefined> {
  const decisions = new Map<string, Resolution>();
  const open: string[] = [];
  for (const conflict of conflicts) {
    const choice = chosen.get(conflict.path);
    if (choice && (choice !== "both" || conflict.canKeepBoth)) {
      decisions.set(conflict.path, choice);
    } else {
      open.push(conflict.path);
    }
  }
  if (open.length > 0) {
    onBlocked(open);
    return undefined;
  }
  return decisions;
}
