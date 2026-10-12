/**
 * What a place to sync the notes folder with must be able to do. GitHub is the first one (`GitHubSyncProvider`); another
 * service (GitLab, a cloud drive, a server) is one more class that implements {@link SyncProvider}, plus one line in
 * `extension.ts`. Nothing else changes: `SyncService` (comparing, push, pull, conflicts) and the Actions view only talk
 * to this interface. No `vscode` here, so the types can be read and checked on their own.
 *
 * The sync compares files by a **hash that the remote reports for the content** (the blob hash of Git, the MD5 of a drive,
 * ...). A provider whose remote does not report such a hash cannot be used as it is: {@link SyncProvider.hash} must give
 * the same value for the same bytes as the remote lists for them.
 */

/** A place to sync with: a repository, a folder of a drive... The sync keeps `id` and gives it back to the provider. */
export interface RemoteTarget {
  /** Text only the provider understands (GitHub: `owner/name@branch`). Stored with the connection. */
  readonly id: string;
  /** What the user sees (GitHub: `owner/name`). */
  readonly label: string;
  /** Shown after the label (GitHub: the branch). */
  readonly detail?: string;
  /** False when other people can read it: the user is asked before notes are pushed there. */
  readonly isPrivate: boolean;
}

/** A regular file of the remote: its path (relative, `/`-separated) and the hash the remote reports for its content. */
export interface RemoteFile {
  readonly path: string;
  readonly hash: string;
}

export interface RemoteSnapshot {
  /** Names this state of the remote (GitHub: the commit). Equal versions mean that nothing changed. */
  readonly version: string;
  readonly files: readonly RemoteFile[];
  /** The remote cut the list short, so the sync cannot trust it. */
  readonly truncated: boolean;
}

/**
 * One change to send: `read` gives the new content of a file (called when it is needed, so that thousands of files are not
 * in memory at once), or it is `undefined` to delete the file.
 */
export interface UploadChange {
  readonly path: string;
  readonly read: (() => PromiseLike<Uint8Array>) | undefined;
}

export interface UploadResult {
  /** The version of the remote after the upload. */
  readonly version: string;
  /** The hash the remote reports for each file that was sent. */
  readonly hashes: ReadonlyMap<string, string>;
}

/** The most commits a history can be limited to, and what the question starts with. */
export const MAX_KEEP_LAST = 100;
export const DEFAULT_KEEP_LAST = 5;

export interface UploadOptions {
  /**
   * Keep only the last N commits of the history (1 to `MAX_KEEP_LAST`): the older ones are dropped, the oldest kept one
   * becomes the start of the history. N = 1 keeps one commit that holds all the files. Undefined adds a commit and keeps
   * all of them. The user chose this knowing that the older versions are lost. Only for a provider with
   * `canLimitHistory`.
   */
  readonly keepLast: number | undefined;
}

/** The questions that make a new target: a name for a new one (a new private repository). */
export interface TargetCreator {
  readonly item: string;
  readonly detail: string;
  readonly prompt: string;
  /** What the box starts with. */
  readonly value: string;
  /** A message for a name that cannot be used, or undefined. */
  validate(name: string): string | undefined;
  create(name: string): Promise<RemoteTarget>;
}

/** The questions that find a target by a typed name (`owner/name`). */
export interface TargetFinder {
  readonly item: string;
  readonly detail: string;
  readonly prompt: string;
  validate(typed: string): string | undefined;
  find(typed: string): Promise<RemoteTarget>;
}

/**
 * A service the notes folder can be synced with. A provider never shows UI except that {@link signIn} may open the sign-in
 * of VS Code, and it is called by commands only. Every failure is thrown as a typed `NoteRootError` whose message is safe
 * to show. Paths from the remote are untrusted: the sync checks them, the provider only reports them.
 */
export interface SyncProvider {
  /** Stored with each connection, so it never changes (`github`). */
  readonly id: string;
  /** Shown to the user (`GitHub`). */
  readonly label: string;
  /** What a target is called (`repository`). */
  readonly targetNoun: string;
  /** What a version is called (`commit`). */
  readonly versionNoun: string;
  /** One line for the list of services. */
  readonly description: string;
  /** True when the provider can limit the history of the target to its last commits (see {@link UploadOptions}). */
  readonly canLimitHistory: boolean;
  readonly pickTitle: string;
  readonly pickPlaceholder: string;
  readonly loading: string;
  /** Present when the provider can make a new target. */
  readonly creator?: TargetCreator;
  /** Present when the provider can find a target by a typed name. */
  readonly finder?: TargetFinder;

  /** The hash the remote reports for these bytes. */
  hash(bytes: Uint8Array): string;
  /** Signs in when needed. Returns false when the user said no. */
  signIn(): Promise<boolean>;
  /** The targets the user can sync with, most useful first. */
  listTargets(): Promise<RemoteTarget[]>;
  /** The current version of the target (one small request), or undefined when it has none yet (an empty repository). */
  currentVersion(target: RemoteTarget): Promise<string | undefined>;
  /** Every file of the target, or undefined when it has none yet. */
  snapshot(target: RemoteTarget): Promise<RemoteSnapshot | undefined>;
  download(target: RemoteTarget, file: RemoteFile): Promise<Uint8Array>;
  /**
   * Sends the changes as one new version. It must refuse (throw) when the remote is no longer at `expectedVersion`,
   * and it must never overwrite a newer version. `expectedVersion` is undefined for a target that has no version yet.
   */
  upload(
    target: RemoteTarget,
    expectedVersion: string | undefined,
    changes: readonly UploadChange[],
    message: string,
    options?: UploadOptions
  ): Promise<UploadResult>;
}
