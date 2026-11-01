import { createHash } from "crypto";
import { Strings } from "../constants/strings";
import { dropboxContentHash } from "../util/dropboxHash";
import { DropboxError } from "../util/errors";
import type { DropboxAuth } from "./DropboxAuth";
import type { DropboxClient, DropboxEntry } from "./DropboxClient";
import type { Logger } from "./Logger";
import type {
  RemoteFile,
  RemoteSnapshot,
  RemoteTarget,
  SyncProvider,
  TargetCreator,
  UploadChange,
  UploadResult,
} from "./SyncProvider";

const FOLDER_NAME_LENGTH = 100;
/** Characters that Dropbox does not accept in a name (and the slash, which would make a path). */
const BAD_NAME = /[\\/<>:"|?*\u0000-\u001f]/;

/** What the folder of a target holds now: each file by its path inside the folder, with what is needed to read or change it. */
interface Remote {
  readonly version: string;
  readonly files: Map<string, { lower: string; hash: string; rev: string | undefined }>;
}

/** The version of a folder: Dropbox has none for a whole folder, so it is the hash of every path and its content hash. */
function versionOf(files: ReadonlyMap<string, { hash: string }>): string {
  const lines = [...files].map(([path, file]) => `${path}\t${file.hash}`).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

/**
 * Syncs with a folder of the Dropbox of the user, through the Dropbox API and the sign-in of {@link DropboxAuth}. The notes are
 * ordinary files in a folder inside the app folder of NoteRoot (`Apps/<the app>/<the folder>`); the app can see nothing else
 * of the Dropbox. Dropbox reports a content hash for every file ({@link dropboxContentHash}), so that is the hash the sync
 * compares; it has no version of a whole folder, so the version is the hash of the list of paths and content hashes. A push is
 * a series of writes, one at a time (Dropbox asks for that), not one commit: the folder is read again right before it, and a
 * file that changed meanwhile is refused (each update names the revision it replaces). Deleted files stay in the deleted files
 * of Dropbox for a while.
 */
export class DropboxSyncProvider implements SyncProvider {
  readonly id = "dropbox";
  readonly label = "Dropbox";
  readonly targetNoun = "folder";
  readonly versionNoun = "version";
  readonly canLimitHistory = false;
  readonly description = Strings.sync.dropbox.description;
  readonly pickTitle = Strings.sync.dropbox.pickTitle;
  readonly pickPlaceholder = Strings.sync.dropbox.pickPlaceholder;
  readonly loading = Strings.sync.dropbox.loading;

  readonly creator: TargetCreator = {
    item: Strings.sync.dropbox.createItem,
    detail: Strings.sync.dropbox.createDetail,
    prompt: Strings.sync.dropbox.createPrompt,
    value: Strings.sync.dropbox.createValue,
    validate: (name) => validateFolderName(name),
    create: async (name) => {
      const label = name.trim();
      await this.client.createFolder(`/${label}`);
      return { id: `/${label}`.toLowerCase(), label, isPrivate: true };
    },
  };

  constructor(
    private readonly auth: DropboxAuth,
    private readonly client: DropboxClient,
    private readonly logger: Logger
  ) {}

  hash(bytes: Uint8Array): string {
    return dropboxContentHash(bytes);
  }

  /**
   * The page of the apps of the user in Dropbox. The folder of the app is named after the app, which the API does not tell (with
   * the access type App folder every path is inside it), so the page of the folder itself cannot be built; the user picks the app
   * and then the folder.
   */
  webUrl(): string {
    return "https://www.dropbox.com/home/Apps";
  }

  signIn(): Promise<boolean> {
    return this.auth.signIn();
  }

  /** The folders that are directly in the app folder. */
  async listTargets(): Promise<RemoteTarget[]> {
    const entries = await this.client.listFolder("", false);
    return entries
      .filter((entry) => entry.isFolder)
      .map((entry) => ({
        id: entry.lower,
        label: entry.display.slice(entry.display.lastIndexOf("/") + 1),
        isPrivate: true,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  async currentVersion(target: RemoteTarget): Promise<string | undefined> {
    return (await this.read(target)).version;
  }

  async snapshot(target: RemoteTarget): Promise<RemoteSnapshot | undefined> {
    const remote = await this.read(target);
    return {
      version: remote.version,
      files: [...remote.files].map(([path, file]) => ({ path, hash: file.hash })),
      truncated: false,
    };
  }

  async download(target: RemoteTarget, file: RemoteFile): Promise<Uint8Array> {
    const entry = (await this.read(target)).files.get(file.path);
    if (entry?.hash !== file.hash) {
      throw new DropboxError(Strings.sync.dropbox.conflict);
    }
    const bytes = await this.client.download(entry.lower);
    if (dropboxContentHash(bytes) !== file.hash) {
      throw new DropboxError(Strings.sync.dropbox.conflict);
    }
    return bytes;
  }

  async upload(
    target: RemoteTarget,
    expectedVersion: string | undefined,
    changes: readonly UploadChange[]
  ): Promise<UploadResult> {
    // The folder is read again right now: a push on top of an older state would erase what another computer sent.
    const remote = await this.read(target);
    // No version expected means a folder that was empty when it was last seen: anything in it now is news.
    if (
      expectedVersion === undefined ? remote.files.size > 0 : remote.version !== expectedVersion
    ) {
      throw new DropboxError(Strings.sync.dropbox.conflict);
    }
    const files = new Map(remote.files);
    const hashes = new Map<string, string>();
    // One write after the other: Dropbox slows down or refuses writes to one folder that come at the same moment.
    for (const change of changes) {
      const existing = files.get(change.path);
      if (!change.read) {
        if (existing) {
          await this.client.delete(existing.lower);
          files.delete(change.path);
        }
        continue;
      }
      const bytes = await change.read();
      const path = existing?.lower ?? `${target.id}/${change.path}`;
      const reported = await this.client.upload(
        path,
        bytes,
        existing?.rev ? { kind: "update", rev: existing.rev } : { kind: "add" }
      );
      const hash = reported ?? dropboxContentHash(bytes);
      files.set(change.path, { lower: path.toLowerCase(), hash, rev: undefined });
      hashes.set(change.path, hash);
    }
    return { version: versionOf(files), hashes };
  }

  /**
   * What the folder of the target holds now.
   * @throws DropboxError when the folder is not there any more.
   */
  private async read(target: RemoteTarget): Promise<Remote> {
    const entries = await this.client.listFolder(target.id, true);
    const depth = target.id.split("/").filter(Boolean).length;
    const files = new Map<string, { lower: string; hash: string; rev: string | undefined }>();
    let skipped = 0;
    for (const entry of entries) {
      const relative = relativePath(entry, depth);
      if (entry.isFolder || entry.contentHash === undefined || relative === undefined) {
        skipped += entry.isFolder ? 0 : 1;
        continue;
      }
      files.set(relative, { lower: entry.lower, hash: entry.contentHash, rev: entry.rev });
    }
    if (skipped > 0) {
      this.logger.info(`Dropbox: ${skipped} item(s) of the folder are not synced.`);
    }
    return { version: versionOf(files), files };
  }
}

/** The path of a file inside the folder of the target, with the capitals of the user. */
function relativePath(entry: DropboxEntry, depth: number): string | undefined {
  const parts = entry.display.split("/").filter(Boolean).slice(depth);
  return parts.length > 0 ? parts.join("/") : undefined;
}

/** A message for a folder name that cannot be used, or undefined. */
function validateFolderName(name: string): string | undefined {
  const trimmed = name.trim();
  return trimmed.length > 0 &&
    trimmed.length <= FOLDER_NAME_LENGTH &&
    !BAD_NAME.test(trimmed) &&
    !/[. ]$/.test(trimmed)
    ? undefined
    : Strings.sync.dropbox.createInvalid;
}
