import * as vscode from "vscode";
import { BuiltinCommands } from "../constants/commands";
import { ContextKeys, StateKeys } from "../constants/context";
import { Strings } from "../constants/strings";
import { SyncRefusedError, TrashUnavailableError } from "../util/errors";
import { describeError, isFileNotFoundError } from "../util/fsErrors";
import { mapLimit } from "../util/mapLimit";
import { ExcludeMatcher } from "./ExcludeMatcher";
import type { EncryptionConfig, EncryptionSupport, TargetKind } from "./EncryptedSyncProvider";
import { Logger } from "./Logger";
import { PathGuard } from "./PathGuard";
import { RootFolderService } from "./RootFolderService";
import { SearchService } from "./SearchService";
import type { NameMode } from "./SyncCrypto";
import {
  MAX_KEEP_LAST,
  type RemoteSnapshot,
  type RemoteTarget,
  type SyncProvider,
} from "./SyncProvider";
import {
  CONFIG_PATH,
  MARKER_PATH,
  compareStates,
  copyName,
  diffStates,
  isNeverSynced,
  isSyncedRemotePath,
  planPull,
  stateAfterPull,
  stateAfterPush,
  type Change,
  type Conflict,
  type Resolution,
  type SyncStatus,
} from "./SyncPlan";

/** More files than this are not synced: every change is hashed and listed. */
export const MAX_SYNC_FILES = 10000;
/** Bigger files are left out (and counted as skipped). */
const MAX_FILE_BYTES = 25_000_000;
const TRANSFERS_AT_ONCE = 4;
const AUTO_CHECK_MS = 5 * 60_000;
/** A hash is cached only for a file that was last changed longer ago than this. */
const HASH_CACHE_MIN_AGE_MS = 2000;
/** After a change of files, the list of local changes is made again when no other change came for this long. */
const LOCAL_REFRESH_DELAY_MS = 2000;
/** With the automatic check on, the remote is compared once this long after the window opens. */
const STARTUP_REFRESH_DELAY_MS = 10_000;

/** What a notes folder is connected to: a service (the provider) and a place in it (the target). */
export interface SyncConnection {
  readonly provider: SyncProvider;
  readonly target: RemoteTarget;
  /** Set when the notes are sealed before they go online (see `EncryptedSyncProvider`). */
  readonly encryption: EncryptionConfig | undefined;
  /** The user chose to sync the files that NoteRoot hides too (see `setIncludeHidden`). */
  readonly includeHidden: boolean;
  /** The user chose to keep only the last N commits of the target (1 = a single commit); undefined keeps them all (see `setKeepLast`). */
  readonly keepLast: number | undefined;
}

/** What the Actions view shows. */
export interface SyncSnapshot {
  readonly status: SyncStatus | undefined;
  readonly checkedAt: Date | undefined;
  /** The remote has a new version that has not been pulled yet (for GitHub: a new commit). */
  readonly hasNewVersion: boolean;
  /**
   * False while only the files here were compared with the last sync (what the panel shows when the window opens: no request
   * is made until the user asks). Then `status.remote` is empty because the remote is not known, not because it is the same.
   */
  readonly remoteCompared: boolean;
  /** Files of the folder or of the remote that the sync leaves out (too big, names that do not work everywhere). */
  readonly skipped: number;
}

export interface ConflictRequest extends Conflict {
  /** "Keep both" is offered: the file can be saved twice (not the config file). */
  readonly canKeepBoth: boolean;
}

/** Asks the user what to keep. Resolves to undefined when the user cancels (then nothing is changed). */
export type ConflictResolver = (
  conflicts: readonly ConflictRequest[]
) => Promise<ReadonlyMap<string, Resolution> | undefined>;

export interface PushResult {
  readonly files: number;
}

export interface PullResult {
  readonly cancelled: boolean;
  readonly written: number;
  readonly trashed: number;
  /** The paths where "keep both" saved the online version. */
  readonly copies: readonly string[];
  readonly failed: number;
  readonly invalidConfig: boolean;
}

interface StoredConnection {
  /** The `id` of the provider. */
  provider: string;
  target: RemoteTarget;
  /** Only the last N commits are kept online (see `setKeepLast`). */
  keepLast?: number;
  /** Hidden files are synced too (see `setIncludeHidden`). */
  includeHidden?: boolean;
  /** How the notes are sealed before they go online; absent for a repository with plain notes. */
  encryption?: EncryptionConfig;
  /** The remote version whose files were seen last (by a pull, or made by a push). */
  version?: string;
  /** The state of the last sync: path to the hash the remote reports. */
  files: Record<string, string>;
}

interface Remote {
  /** Undefined while the remote has no version yet (an empty repository). */
  readonly version: string | undefined;
  /** The hash of each usable remote file by path. */
  readonly files: Map<string, string>;
  readonly skipped: number;
}

interface Local {
  readonly files: Map<string, string>;
  readonly skipped: number;
}

/**
 * Syncs the notes folder with a remote through a {@link SyncProvider} (GitHub is the first). It compares three states: the
 * files here, the files of the remote, and the **base** (what was synced last, kept per notes folder on this machine in
 * `globalState`). Push sends what changed here, pull brings what changed there, and a file that changed on both sides is a
 * conflict that the caller resolves: nothing is overwritten without a copy in the Trash. Services never show UI: the
 * questions arrive as a callback. Nothing here knows which service it talks to; that is the provider's job.
 *
 * Nothing contacts the remote until a command asks for it, except the optional check for a new version (an off switch, per
 * machine) that asks only for the current version of the target.
 */
export class SyncService implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly newVersionEmitter = new vscode.EventEmitter<SyncConnection>();
  private readonly subscriptions: vscode.Disposable[] = [];
  /** Hashes of files by path, valid while the modification time and the size are the same. */
  private readonly hashCache = new Map<string, { mtime: number; size: number; sha: string }>();
  private snapshotValue: SyncSnapshot = emptySnapshot();
  private knownRemoteVersion: string | undefined;
  private remoteChecked = false;
  private notifiedVersion: string | undefined;
  private remoteCache: { version: string; remote: Remote } | undefined;
  /** The remote as it was read last (also when it is empty): what the local changes are compared with between two checks. */
  private lastRemote: Remote | undefined;
  /** The providers that seal and open, one for each connection (they keep the key and the index of the last read). */
  private readonly sealed = new Map<string, SyncProvider>();
  private localTimer: NodeJS.Timeout | undefined;
  private rescanning = false;
  private running = false;
  private autoCheck: boolean;
  private timer: NodeJS.Timeout | undefined;

  /** Fires when the connection, the changes or the state of the sync changed. */
  readonly onDidChange = this.changeEmitter.event;
  /** Fires once for each new version that the automatic check finds. */
  readonly onDidFindNewVersion = this.newVersionEmitter.event;

  constructor(
    private readonly memento: vscode.Memento,
    private readonly rootService: RootFolderService,
    private readonly pathGuard: PathGuard,
    private readonly searchService: SearchService,
    private readonly excludeMatcher: ExcludeMatcher,
    /** The services the notes folder can be synced with. */
    readonly providers: readonly SyncProvider[],
    private readonly encryption: EncryptionSupport,
    private readonly logger: Logger
  ) {
    this.autoCheck = memento.get<unknown>(StateKeys.syncAutoCheck) === true;
    this.subscriptions.push(
      rootService.onDidChangeRoot(() => this.onRootChanged()),
      rootService.onDidChangeState(
        () => void this.publishConnected().then(() => this.showLocalChanges())
      ),
      rootService.onDidChangeFiles(() => this.scheduleLocalRefresh()),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          void this.autoCheckNow();
        }
      })
    );
  }

  get snapshot(): SyncSnapshot {
    return this.snapshotValue;
  }

  get isBusy(): boolean {
    return this.running;
  }

  get isAutoCheckOn(): boolean {
    return this.autoCheck;
  }

  /** What the current notes folder is connected to, if anything (and the service is still available). */
  get connection(): SyncConnection | undefined {
    const stored = this.readStored();
    const provider = stored ? this.providerOf(stored) : undefined;
    return stored && provider
      ? {
          provider,
          target: stored.target,
          keepLast: stored.keepLast,
          encryption: stored.encryption,
          includeHidden: stored.includeHidden === true,
        }
      : undefined;
  }

  /** Publishes the context keys and starts the automatic check when it is on. Call once at activation. */
  async initialize(): Promise<void> {
    await vscode.commands.executeCommand(
      BuiltinCommands.setContext,
      ContextKeys.syncAutoCheck,
      this.autoCheck
    );
    await this.publishConnected();
    this.restartTimer();
    void this.showLocalChanges();
    if (this.autoCheck) {
      // The user turned the automatic check on, so asking the remote at the start is what they want.
      setTimeout(() => void this.autoRefreshNow(), STARTUP_REFRESH_DELAY_MS);
    }
  }

  /** What is online in a target: nothing yet, plain notes, or notes that NoteRoot encrypted (and how). */
  inspectTarget(provider: SyncProvider, target: RemoteTarget): Promise<TargetKind> {
    return this.encryption.inspect(provider, target);
  }

  /** Makes the key of a new encrypted target from a master key and keeps it for this computer. */
  prepareEncryption(
    provider: SyncProvider,
    target: RemoteTarget,
    names: NameMode,
    masterKey: string
  ): Promise<EncryptionConfig> {
    return this.encryption.create(provider, target, names, masterKey);
  }

  /**
   * Connects the current notes folder to a target. The files of both are compared again from scratch. `encryption` is
   * what `prepareEncryption` returned, or what `inspectTarget` found in an encrypted target.
   */
  async connect(
    provider: SyncProvider,
    target: RemoteTarget,
    encryption?: EncryptionConfig
  ): Promise<void> {
    const key = this.requireRootKey();
    const all = this.readAll();
    all[key] = { provider: provider.id, target, encryption, files: {} };
    await this.memento.update(StateKeys.sync, all);
    this.resetRuntime();
    await this.publishConnected();
    this.changeEmitter.fire();
  }

  /** Forgets what this notes folder is connected to. Neither the notes nor the remote are touched. */
  async disconnect(): Promise<void> {
    const key = this.rootKey();
    if (!key) {
      return;
    }
    const all = this.readAll();
    delete all[key];
    await this.memento.update(StateKeys.sync, all);
    this.resetRuntime();
    await this.publishConnected();
    this.changeEmitter.fire();
  }

  /**
   * Limits the history of the target to its last `count` commits (1 = a single commit that holds all the files), or
   * keeps every commit again with undefined. While a limit is set, a push that makes the history longer rebuilds it: the
   * older commits are dropped. It is off by default and never changes by itself.
   * @throws SyncRefusedError when nothing is connected or the service cannot do it.
   */
  async setKeepLast(count: number | undefined): Promise<void> {
    const { stored, provider } = this.requireConnection();
    if (count !== undefined && !provider.canLimitHistory) {
      throw new SyncRefusedError(Strings.sync.historyUnsupported(provider.label));
    }
    await this.store({ ...stored, keepLast: count });
    this.changeEmitter.fire();
  }

  /**
   * Switches whether the files that NoteRoot hides (the exclude patterns, the items hidden by the user) are synced too. It
   * is off by default. Turning it on lets them be pushed and pulled. Turning it off forgets them in the state of the last
   * sync, so they are left alone online and not deleted there. The next Refresh compares again.
   * @throws SyncRefusedError when nothing is connected.
   */
  async setIncludeHidden(value: boolean): Promise<void> {
    const { stored } = this.requireConnection();
    const files = value
      ? stored.files
      : Object.fromEntries(
          Object.entries(stored.files).filter(
            ([path]) => path === CONFIG_PATH || !this.isHidden(path)
          )
        );
    await this.store({ ...stored, includeHidden: value, files });
    this.remoteCache = undefined;
    this.lastRemote = undefined;
    this.snapshotValue = emptySnapshot();
    this.changeEmitter.fire();
  }

  /**
   * The content of a file as it was online at the last comparison, or undefined when it is not there. This is what the diff of
   * the Actions panel shows; for an encrypted repository it is the plain content. Nothing is changed here or online.
   * @throws SyncRefusedError when nothing is connected or another action is running.
   * @throws NoteRootError (from the provider) when the service refuses or cannot be reached.
   */
  async readRemoteFile(path: string): Promise<Uint8Array | undefined> {
    const { stored, provider } = this.requireConnection();
    const hash = this.lastRemote?.files.get(path);
    if (hash === undefined) {
      return undefined;
    }
    if (this.running) {
      throw new SyncRefusedError(Strings.sync.busy);
    }
    return provider.download(stored.target, { path, hash });
  }

  /**
   * Forgets the key kept on this computer for the encrypted target. The master key is asked the next time it is needed.
   * @throws SyncRefusedError when nothing is connected or the target is not encrypted.
   */
  async forgetKey(): Promise<void> {
    const { stored } = this.requireConnection();
    const base = this.baseProviderOf(stored);
    if (!stored.encryption || !base) {
      throw new SyncRefusedError(Strings.sync.encryption.notEncrypted);
    }
    await this.encryption.forgetKey(base, stored.target, stored.encryption);
    this.sealed.clear();
  }

  /**
   * Changes the master key of an encrypted target: every note is read (the old key is asked if it is not kept here), sealed
   * again under the new key and sent as one new version. Other computers must connect again and type the new key. The older
   * commits stay sealed with the old key unless `dropHistory` rewrites the branch as one commit.
   * @throws SyncRefusedError when nothing is connected, the target is not encrypted or empty, or another action runs.
   * @throws NoteRootError (from the provider) when the upload is refused or the old key is wrong.
   */
  async changeMasterKey(options: { masterKey: string; dropHistory: boolean }): Promise<void> {
    await this.exclusive(async () => {
      const { stored } = this.requireConnection();
      const base = this.baseProviderOf(stored);
      if (!stored.encryption || !base) {
        throw new SyncRefusedError(Strings.sync.encryption.notEncrypted);
      }
      const all = await this.encryption.readEverything(base, stored.encryption, stored.target);
      if (all.version === undefined) {
        throw new SyncRefusedError(Strings.sync.encryption.nothingToEncrypt);
      }
      const result = await this.encryption.rewrite(base, {
        target: stored.target,
        names: stored.encryption.names,
        masterKey: options.masterKey,
        files: all.files,
        remove: all.sealedNames,
        expectedVersion: all.version,
        message: Strings.sync.encryption.rekeyMessage,
        options: options.dropHistory ? { keepLast: 1 } : undefined,
      });
      await this.encryption.forgetKey(base, stored.target, stored.encryption);
      this.logger.info(`Changed the master key of ${stored.target.label}.`);
      await this.adoptEncryption(stored, result);
    });
  }

  /**
   * Encrypts the notes of a target that has plain ones: each note online is replaced by a sealed copy in one new version.
   * Files that NoteRoot does not sync stay as they are. The older commits keep the plain notes unless `dropHistory`
   * rewrites the branch as one commit.
   * @throws SyncRefusedError when nothing is connected, the target is already encrypted or has nothing to encrypt, or another
   *   action runs.
   * @throws NoteRootError (from the provider) when the upload is refused.
   */
  async encryptRepository(options: {
    names: NameMode;
    masterKey: string;
    dropHistory: boolean;
  }): Promise<void> {
    await this.exclusive(async () => {
      const { stored, provider } = this.requireConnection();
      if (stored.encryption) {
        throw new SyncRefusedError(Strings.sync.encryption.alreadyEncrypted);
      }
      const remote = await this.loadRemote(provider, stored.target, true, hiddenOf(stored));
      if (remote.version === undefined || remote.files.size === 0) {
        throw new SyncRefusedError(Strings.sync.encryption.nothingToEncrypt);
      }
      const files = new Map<string, Uint8Array>();
      await mapLimit([...remote.files], TRANSFERS_AT_ONCE, async ([path, hash]) => {
        files.set(path, await provider.download(stored.target, { path, hash }));
      });
      const result = await this.encryption.rewrite(provider, {
        target: stored.target,
        names: options.names,
        masterKey: options.masterKey,
        files,
        remove: [...files.keys()],
        expectedVersion: remote.version,
        message: Strings.sync.encryption.convertMessage,
        options: options.dropHistory ? { keepLast: 1 } : undefined,
      });
      this.logger.info(`Encrypted ${files.size} notes of ${stored.target.label}.`);
      await this.adoptEncryption(stored, result);
    });
  }

  /** The connection starts to use a new encryption: the state of the last sync is what was just sent. */
  private async adoptEncryption(
    stored: StoredConnection,
    result: { config: EncryptionConfig; version: string; hashes: ReadonlyMap<string, string> }
  ): Promise<void> {
    const usable = this.usableRemote(
      {
        version: result.version,
        files: [...result.hashes].map(([path, hash]) => ({ path, hash })),
        truncated: false,
      },
      hiddenOf(stored)
    );
    await this.store({
      ...stored,
      encryption: result.config,
      version: result.version,
      files: Object.fromEntries(usable.files),
    });
    this.remoteCache = undefined;
    this.lastRemote = undefined;
    this.knownRemoteVersion = result.version;
    this.sealed.clear();
    this.snapshotValue = emptySnapshot();
    await this.publishConnected();
    await this.compare();
  }

  /** The provider without the sealing, whatever the connection uses. */
  private baseProviderOf(stored: StoredConnection): SyncProvider | undefined {
    return this.providers.find((provider) => provider.id === stored.provider);
  }

  async setAutoCheck(value: boolean): Promise<void> {
    this.autoCheck = value;
    await this.memento.update(StateKeys.syncAutoCheck, value);
    await vscode.commands.executeCommand(
      BuiltinCommands.setContext,
      ContextKeys.syncAutoCheck,
      value
    );
    this.restartTimer();
    if (value) {
      void this.autoCheckNow();
    }
  }

  /** Compares the folder with the remote: the files here, its version, and its files when the version is new. */
  async refresh(): Promise<SyncSnapshot> {
    return this.exclusive(() => this.compare());
  }

  /**
   * Sends the changes made here as one new version (one commit). Refused when the remote has versions that were not
   * pulled: the pull comes first, like in git.
   * @throws SyncRefusedError when nothing is connected, another action runs, or a pull is needed first.
   * @throws NoteRootError (from the provider) when the service refuses or cannot be reached.
   */
  async push(message: string): Promise<PushResult> {
    return this.exclusive(async () => {
      const { stored, provider } = this.requireConnection();
      const remote = await this.loadRemote(provider, stored.target, true, hiddenOf(stored));
      if (remote.version !== stored.version) {
        throw new SyncRefusedError(Strings.sync.pullFirst);
      }
      const base = baseOf(stored);
      const local = await this.scanLocal(provider, hiddenOf(stored));
      const changes = diffStates(base, local.files);
      if (changes.length === 0) {
        await this.compare();
        return { files: 0 };
      }

      const result = await provider.upload(
        stored.target,
        remote.version,
        changes.map((change) => ({
          path: change.path,
          read:
            change.kind === "deleted"
              ? undefined
              : () => vscode.workspace.fs.readFile(this.pathGuard.resolveRelative(change.path)),
        })),
        message,
        { keepLast: provider.canLimitHistory ? stored.keepLast : undefined }
      );

      // The hashes the remote answers are the ones stored, in case a file changed after the scan.
      const sent = new Map(local.files);
      for (const [path, hash] of result.hashes) {
        sent.set(path, hash);
      }
      await this.store({
        ...stored,
        version: result.version,
        files: Object.fromEntries(stateAfterPush(base, changes, sent)),
      });
      this.logger.info(`Pushed ${changes.length} files to ${stored.target.label}.`);
      this.remoteCache = undefined;
      this.knownRemoteVersion = result.version;
      await this.compare();
      return { files: changes.length };
    });
  }

  /**
   * Brings the changes of the remote here. Conflicts are put to `resolve` before anything is written; if it returns
   * undefined nothing is changed. A file that is replaced or deleted here goes to the Trash first.
   * @throws SyncRefusedError when nothing is connected or another action runs.
   * @throws NoteRootError (from the provider) when the service refuses or cannot be reached.
   */
  async pull(resolve: ConflictResolver): Promise<PullResult> {
    return this.exclusive(async () => {
      const { stored, provider } = this.requireConnection();
      const remote = await this.loadRemote(provider, stored.target, true, hiddenOf(stored));
      const base = baseOf(stored);
      const local = await this.scanLocal(provider, hiddenOf(stored));
      const plan = planPull(base, local.files, remote.files);

      // A file with unsaved changes in an editor is not safe to replace, whatever the disk says.
      const apply: Change[] = [];
      const conflicts: Conflict[] = [...plan.conflicts];
      for (const change of plan.apply) {
        if (this.hasUnsavedChanges(change.path)) {
          conflicts.push({
            path: change.path,
            kind: change.kind === "deleted" ? "remote-deleted" : "both-changed",
          });
        } else {
          apply.push(change);
        }
      }

      let decisions: ReadonlyMap<string, Resolution> = new Map();
      if (conflicts.length > 0) {
        const answer = await resolve(
          conflicts.map((conflict) => ({
            ...conflict,
            canKeepBoth: conflict.kind === "both-changed" && conflict.path !== CONFIG_PATH,
          }))
        );
        if (!answer) {
          return emptyPull(true);
        }
        decisions = answer;
      }

      const writes: { path: string; hash: string; to: string }[] = [];
      const trashes: string[] = [];
      const copies: string[] = [];
      const taken = (candidate: string): boolean =>
        local.files.has(candidate) ||
        remote.files.has(candidate) ||
        writes.some((write) => write.to === candidate);
      for (const change of apply) {
        const hash = remote.files.get(change.path);
        if (change.kind === "deleted" || hash === undefined) {
          trashes.push(change.path);
        } else {
          writes.push({ path: change.path, hash, to: change.path });
        }
      }
      for (const conflict of conflicts) {
        const choice = decisions.get(conflict.path) ?? "mine";
        const hash = remote.files.get(conflict.path);
        if (choice === "theirs") {
          if (hash === undefined) {
            trashes.push(conflict.path);
          } else {
            if (local.files.has(conflict.path)) {
              trashes.push(conflict.path);
            }
            writes.push({ path: conflict.path, hash, to: conflict.path });
          }
        } else if (choice === "both" && hash !== undefined && conflict.path !== CONFIG_PATH) {
          const copy = copyName(conflict.path, taken);
          copies.push(copy);
          writes.push({ path: conflict.path, hash, to: copy });
        }
      }

      // Download everything first, so a network failure leaves the folder as it was.
      const downloaded = await mapLimit(writes, TRANSFERS_AT_ONCE, async (write) => ({
        write,
        bytes: await provider.download(stored.target, { path: write.path, hash: write.hash }),
      }));

      let written = 0;
      let trashed = 0;
      let invalidConfig = false;
      const failed = new Set<string>();
      for (const path of trashes) {
        try {
          await this.trash(path);
          trashed++;
        } catch (error) {
          this.logger.warn(`Could not move "${path}" to the Trash: ${describeError(error)}`);
          failed.add(path);
        }
      }
      for (const { write, bytes } of downloaded) {
        if (write.to === CONFIG_PATH && !isConfigObject(bytes)) {
          invalidConfig = true;
          failed.add(write.path);
          continue;
        }
        try {
          await this.writeLocal(write.to, bytes);
          written++;
        } catch (error) {
          this.logger.warn(`Could not write "${write.to}": ${describeError(error)}`);
          failed.add(write.path);
        }
      }

      // The remote has been seen. A path that could not be applied stays pending: it keeps its old base.
      const next = stateAfterPull(remote.files);
      for (const path of failed) {
        const before = base.get(path);
        if (before === undefined) {
          next.delete(path);
        } else {
          next.set(path, before);
        }
      }
      await this.store({
        ...stored,
        version: failed.size === 0 ? remote.version : stored.version,
        files: Object.fromEntries(next),
      });
      this.logger.info(
        `Pulled from ${stored.target.label}: ${written} written, ${trashed} to the Trash, ${failed.size} failed.`
      );
      await this.compare();
      return { cancelled: false, written, trashed, copies, failed: failed.size, invalidConfig };
    });
  }

  /**
   * Asks the provider only for the current version of the target and tells whether it is one that was not pulled yet.
   * Nothing is downloaded. Does nothing while another sync action runs.
   */
  async checkForNewVersion(): Promise<boolean> {
    const stored = this.readStored();
    const provider = stored ? this.providerOf(stored) : undefined;
    if (!stored || !provider || this.running) {
      return false;
    }
    this.knownRemoteVersion = await provider.currentVersion(stored.target);
    this.remoteChecked = true;
    this.update({ hasNewVersion: this.hasNewVersion(stored) });
    return this.hasNewVersion(stored);
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    if (this.localTimer) {
      clearTimeout(this.localTimer);
    }
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.changeEmitter.dispose();
    this.newVersionEmitter.dispose();
  }

  // ----- comparing -----

  /** Compares the folder with the remote and keeps the result for the view. Call it inside {@link exclusive}. */
  private async compare(): Promise<SyncSnapshot> {
    const connection = this.connection;
    const stored = this.readStored();
    if (!connection || !stored) {
      this.snapshotValue = emptySnapshot();
      this.changeEmitter.fire();
      return this.snapshotValue;
    }
    const remote = await this.loadRemote(
      connection.provider,
      stored.target,
      false,
      hiddenOf(stored)
    );
    const local = await this.scanLocal(connection.provider, hiddenOf(stored));
    this.knownRemoteVersion = remote.version;
    this.remoteChecked = true;
    this.snapshotValue = {
      status: compareStates(baseOf(stored), local.files, remote.files),
      checkedAt: new Date(),
      hasNewVersion: this.hasNewVersion(stored),
      remoteCompared: true,
      skipped: local.skipped + remote.skipped,
    };
    this.changeEmitter.fire();
    return this.snapshotValue;
  }

  /**
   * The version and the files of the remote. The list of files is downloaded again only when the version is new (or when
   * `fresh` asks for it, before a push or a pull). Paths from the remote are untrusted: only the ones that are safe on
   * every system, not hidden here and not clashing in case are kept.
   */
  private async loadRemote(
    provider: SyncProvider,
    target: RemoteTarget,
    fresh: boolean,
    includeHidden: boolean
  ): Promise<Remote> {
    if (!fresh) {
      const version = await provider.currentVersion(target);
      if (version !== undefined && this.remoteCache?.version === version) {
        this.lastRemote = this.remoteCache.remote;
        return this.remoteCache.remote;
      }
    }
    const snapshot = await provider.snapshot(target);
    if (!snapshot) {
      this.lastRemote = { version: undefined, files: new Map(), skipped: 0 };
      return this.lastRemote;
    }
    if (snapshot.truncated) {
      throw new SyncRefusedError(Strings.sync.truncatedTree);
    }
    const remote = this.usableRemote(snapshot, includeHidden);
    this.remoteCache = { version: snapshot.version, remote };
    this.lastRemote = remote;
    return remote;
  }

  private usableRemote(snapshot: RemoteSnapshot, includeHidden: boolean): Remote {
    const files = new Map<string, string>();
    const seen = new Set<string>();
    let skipped = 0;
    for (const entry of snapshot.files) {
      if (!isSyncedRemotePath(entry.path)) {
        if (entry.path !== MARKER_PATH && !entry.path.split("/").some(isNeverSynced)) {
          skipped++;
          this.logger.warn(`Skipped "${entry.path}": the name cannot be used on every system.`);
        }
        continue;
      }
      if (entry.path !== CONFIG_PATH && !includeHidden && this.isHidden(entry.path)) {
        continue; // Hidden by the exclude patterns of this folder, like the search and the tags do.
      }
      const lower = entry.path.toLowerCase();
      if (seen.has(lower)) {
        skipped++;
        this.logger.warn(`Skipped "${entry.path}": another file differs from it only in case.`);
        continue;
      }
      seen.add(lower);
      files.set(entry.path, entry.hash);
    }
    return { version: snapshot.version, files, skipped };
  }

  /** The files of the notes folder (and its config file) with their hashes. */
  private async scanLocal(provider: SyncProvider, includeHidden: boolean): Promise<Local> {
    const files = new Map<string, string>();
    let skipped = 0;
    let count = 0;
    // Hidden files are left out unless the user chose to sync them; the names that are never synced stay out either way.
    const walk = includeHidden
      ? this.searchService.walkFiles(undefined, { isSkipped: (name) => isNeverSynced(name) })
      : this.searchService.walkFiles();
    for await (const file of walk) {
      if (!isSyncedRemotePath(file.relativePath)) {
        if (file.relativePath !== MARKER_PATH) {
          skipped++;
        }
        continue;
      }
      if (++count > MAX_SYNC_FILES) {
        throw new SyncRefusedError(Strings.sync.tooManyFiles(MAX_SYNC_FILES));
      }
      const hash = await this.hashFile(provider, file.uri, file.relativePath);
      if (hash === undefined) {
        skipped++;
      } else {
        files.set(file.relativePath, hash);
      }
    }
    const config = this.pathGuard.resolveRelative(CONFIG_PATH);
    const configHash = await this.hashFile(provider, config, CONFIG_PATH);
    if (configHash !== undefined) {
      files.set(CONFIG_PATH, configHash);
    }
    return { files, skipped };
  }

  /** The hash of a file, or undefined when it is missing, unreadable or too big. */
  private async hashFile(
    provider: SyncProvider,
    uri: vscode.Uri,
    path: string
  ): Promise<string | undefined> {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > MAX_FILE_BYTES) {
        this.logger.warn(`Skipped "${path}": bigger than ${MAX_FILE_BYTES / 1_000_000} MB.`);
        return undefined;
      }
      const cached = this.hashCache.get(path);
      if (cached && cached.mtime === stat.mtime && cached.size === stat.size) {
        return cached.sha;
      }
      const sha = provider.hash(await vscode.workspace.fs.readFile(uri));
      // A file changed a moment ago could be changed again with the same size and the same time stamp, so only a file that
      // has been still for a while is remembered (the same care Git takes with its index).
      if (Date.now() - stat.mtime > HASH_CACHE_MIN_AGE_MS) {
        this.hashCache.set(path, { mtime: stat.mtime, size: stat.size, sha });
      }
      return sha;
    } catch {
      return undefined; // Missing or unreadable: not part of the sync.
    }
  }

  // ----- writing here -----

  private async writeLocal(path: string, bytes: Uint8Array): Promise<void> {
    const uri = this.pathGuard.resolveRelative(path);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
    await vscode.workspace.fs.writeFile(uri, bytes);
  }

  private async trash(path: string): Promise<void> {
    const uri = this.pathGuard.resolveRelative(path);
    try {
      await vscode.workspace.fs.delete(uri, { useTrash: true });
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return; // Already gone.
      }
      throw new TrashUnavailableError(error);
    }
  }

  private hasUnsavedChanges(path: string): boolean {
    try {
      const target = this.pathGuard.resolveRelative(path).toString();
      return vscode.workspace.textDocuments.some(
        (document) => document.isDirty && document.uri.toString() === target
      );
    } catch {
      return false;
    }
  }

  /** Whether one of the parts of the path is hidden by the exclude patterns of the folder. */
  private isHidden(path: string): boolean {
    const parts = path.split("/");
    return parts.some((name, index) =>
      this.excludeMatcher.isExcluded(name, parts.slice(0, index + 1).join("/"))
    );
  }

  // ----- state -----

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.running) {
      throw new SyncRefusedError(Strings.sync.busy);
    }
    this.running = true;
    this.changeEmitter.fire();
    try {
      return await action();
    } finally {
      this.running = false;
      this.changeEmitter.fire();
    }
  }

  private hasNewVersion(stored: StoredConnection): boolean {
    return (
      this.remoteChecked &&
      this.knownRemoteVersion !== undefined &&
      this.knownRemoteVersion !== stored.version
    );
  }

  /** Changes the parts of the snapshot that a quick check knows, and tells the view. */
  private update(parts: Partial<SyncSnapshot>): void {
    this.snapshotValue = { ...this.snapshotValue, ...parts };
    this.changeEmitter.fire();
  }

  private rootKey(): string | undefined {
    return this.rootService.getRootUri()?.toString();
  }

  private requireRootKey(): string {
    const key = this.rootKey();
    if (!key) {
      throw new SyncRefusedError(Strings.sync.noRoot);
    }
    return key;
  }

  private readStored(): StoredConnection | undefined {
    const key = this.rootKey();
    return key ? this.readAll()[key] : undefined;
  }

  /** The stored connection and its provider. @throws SyncRefusedError when there is none or the service is gone. */
  private requireConnection(): { stored: StoredConnection; provider: SyncProvider } {
    this.requireRootKey();
    const stored = this.readStored();
    if (!stored) {
      throw new SyncRefusedError(Strings.sync.notConnected);
    }
    const provider = this.providerOf(stored);
    if (!provider) {
      throw new SyncRefusedError(Strings.sync.unknownProvider);
    }
    return { stored, provider };
  }

  private providerOf(stored: StoredConnection): SyncProvider | undefined {
    const base = this.providers.find((provider) => provider.id === stored.provider);
    if (!base || !stored.encryption) {
      return base;
    }
    const id = `${stored.provider}|${stored.target.id}|${stored.encryption.salt}`;
    let wrapped = this.sealed.get(id);
    if (!wrapped) {
      wrapped = this.encryption.wrap(base, stored.encryption);
      this.sealed.set(id, wrapped);
    }
    return wrapped;
  }

  private readAll(): Record<string, StoredConnection> {
    return sanitize(this.memento.get<unknown>(StateKeys.sync));
  }

  private async store(connection: StoredConnection): Promise<void> {
    const all = this.readAll();
    all[this.requireRootKey()] = connection;
    await this.memento.update(StateKeys.sync, all);
  }

  /** Forgets what was learned from the remote and from the files, for a new folder or a new target. */
  private resetRuntime(): void {
    this.snapshotValue = emptySnapshot();
    this.knownRemoteVersion = undefined;
    this.remoteChecked = false;
    this.notifiedVersion = undefined;
    this.remoteCache = undefined;
    this.lastRemote = undefined;
    this.sealed.clear();
    this.hashCache.clear();
  }

  private onRootChanged(): void {
    this.resetRuntime();
    void this.publishConnected().then(() => this.showLocalChanges());
    this.changeEmitter.fire();
  }

  private async publishConnected(): Promise<void> {
    const stored = this.readStored();
    await vscode.commands.executeCommand(
      BuiltinCommands.setContext,
      ContextKeys.syncConnected,
      stored !== undefined
    );
    await vscode.commands.executeCommand(
      BuiltinCommands.setContext,
      ContextKeys.syncEncrypted,
      stored?.encryption !== undefined
    );
  }

  // ----- the local changes follow the files -----

  /**
   * Files of the notes folder changed (a save, a new or deleted note, a pull): after a short quiet time the list of local
   * changes is made again. This only reads the files here, nothing is sent anywhere. It waits until the folder has been
   * compared once with the remote (Refresh, Push, Pull), because before that there is nothing to compare with.
   */
  private scheduleLocalRefresh(): void {
    if (!this.snapshotValue.status) {
      return;
    }
    if (this.localTimer) {
      clearTimeout(this.localTimer);
    }
    this.localTimer = setTimeout(() => void this.recompareLocal(), LOCAL_REFRESH_DELAY_MS);
  }

  /** Compares the files here again with the remote as it was read last. Skipped while a sync action runs. */
  private async recompareLocal(): Promise<void> {
    const connection = this.connection;
    const stored = this.readStored();
    const remote = this.lastRemote;
    if (!connection || !stored || !this.snapshotValue.status) {
      return;
    }
    if (this.running || this.rescanning) {
      this.scheduleLocalRefresh(); // Try again when it is free.
      return;
    }
    this.rescanning = true;
    try {
      const local = await this.scanLocal(connection.provider, hiddenOf(stored));
      if (this.running || this.lastRemote !== remote) {
        return; // An action started meanwhile: it makes its own comparison.
      }
      this.update({
        // Without a remote that was read, only the files here are compared with the last sync.
        status: remote
          ? compareStates(baseOf(stored), local.files, remote.files)
          : localOnly(baseOf(stored), local.files),
        skipped: local.skipped + (remote?.skipped ?? 0),
      });
    } catch (error) {
      this.logger.debug(`The local changes could not be refreshed: ${describeError(error)}`);
    } finally {
      this.rescanning = false;
    }
  }

  /**
   * Compares only the files here with the last sync, with no request: what the panel shows when the window opens. The
   * remote is read when the user presses Refresh, Push or Pull (or at the start, with the automatic check on). Does nothing
   * when there is a comparison already, when no folder is connected, or while an action runs.
   */
  private async showLocalChanges(): Promise<void> {
    const connection = this.connection;
    const stored = this.readStored();
    if (!connection || !stored || this.snapshotValue.status || this.running || this.rescanning) {
      return;
    }
    this.rescanning = true;
    try {
      const local = await this.scanLocal(connection.provider, hiddenOf(stored));
      if (this.snapshotValue.status || this.running) {
        return; // A real comparison came meanwhile.
      }
      this.update({ status: localOnly(baseOf(stored), local.files), skipped: local.skipped });
    } catch (error) {
      this.logger.debug(`The local changes could not be shown: ${describeError(error)}`);
    } finally {
      this.rescanning = false;
    }
  }

  /** The comparison with the remote at the start (automatic check on): quiet on failure, one notice for a new version. */
  private async autoRefreshNow(): Promise<void> {
    const connection = this.connection;
    if (!this.autoCheck || !connection || this.running) {
      return;
    }
    try {
      const snapshot = await this.exclusive(() => this.compare());
      if (snapshot.hasNewVersion && this.knownRemoteVersion !== this.notifiedVersion) {
        this.notifiedVersion = this.knownRemoteVersion;
        this.newVersionEmitter.fire(connection);
      }
    } catch (error) {
      this.logger.debug(`The comparison at the start failed: ${describeError(error)}`);
    }
  }

  // ----- the automatic check -----

  private restartTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.autoCheck) {
      this.timer = setInterval(() => void this.autoCheckNow(), AUTO_CHECK_MS);
    }
  }

  /** The background check: quiet on failure (no sign-in, no network), and one notice per new version. */
  private async autoCheckNow(): Promise<void> {
    const connection = this.connection;
    if (!this.autoCheck || !connection || this.running || !vscode.window.state.focused) {
      return;
    }
    try {
      const isNew = await this.checkForNewVersion();
      if (isNew && this.knownRemoteVersion !== this.notifiedVersion) {
        this.notifiedVersion = this.knownRemoteVersion;
        this.newVersionEmitter.fire(connection);
      }
    } catch (error) {
      this.logger.debug(`The check for a new version failed: ${describeError(error)}`);
    }
  }
}

function baseOf(stored: StoredConnection): Map<string, string> {
  return new Map(Object.entries(stored.files));
}

/** The status when the remote is not known: what changed here since the last sync, and nothing to say about the remote. */
function localOnly(
  base: ReadonlyMap<string, string>,
  local: ReadonlyMap<string, string>
): SyncStatus {
  return { local: diffStates(base, local), remote: [], conflicts: [] };
}

function emptySnapshot(): SyncSnapshot {
  return {
    status: undefined,
    checkedAt: undefined,
    hasNewVersion: false,
    remoteCompared: false,
    skipped: 0,
  };
}

function emptyPull(cancelled: boolean): PullResult {
  return { cancelled, written: 0, trashed: 0, copies: [], failed: 0, invalidConfig: false };
}

/** The config file is replaced only by something that is a JSON object, so a broken online copy cannot ruin it. */
function isConfigObject(bytes: Uint8Array): boolean {
  try {
    const value: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

function hiddenOf(stored: StoredConnection): boolean {
  return stored.includeHidden === true;
}

function readEncryption(value: unknown): EncryptionConfig | undefined {
  const item = value as Partial<EncryptionConfig> | null | undefined;
  return item &&
    (item.names === "plain" || item.names === "hidden") &&
    typeof item.salt === "string"
    ? { names: item.names, salt: item.salt }
    : undefined;
}

function isKeepLast(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_KEEP_LAST
  );
}

/** Stored data survives updates and manual edits, so its shape is never trusted. */
function sanitize(value: unknown): Record<string, StoredConnection> {
  const result: Record<string, StoredConnection> = {};
  if (typeof value !== "object" || value === null) {
    return result;
  }
  for (const [key, raw] of Object.entries(value)) {
    const item = raw as Partial<StoredConnection> | null;
    const target = item?.target as Partial<RemoteTarget> | undefined;
    if (
      item &&
      typeof item.provider === "string" &&
      target &&
      typeof target.id === "string" &&
      typeof target.label === "string" &&
      typeof item.files === "object" &&
      item.files !== null
    ) {
      const files: Record<string, string> = {};
      for (const [path, hash] of Object.entries(item.files)) {
        if (typeof hash === "string") {
          files[path] = hash;
        }
      }
      result[key] = {
        provider: item.provider,
        keepLast: isKeepLast(item.keepLast) ? item.keepLast : undefined,
        includeHidden: item.includeHidden === true,
        encryption: readEncryption(item.encryption),
        target: {
          id: target.id,
          label: target.label,
          detail: typeof target.detail === "string" ? target.detail : undefined,
          isPrivate: target.isPrivate === true,
        },
        version: typeof item.version === "string" ? item.version : undefined,
        files,
      };
    }
  }
  return result;
}
