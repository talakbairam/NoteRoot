import { createHash } from "crypto";
import { Strings } from "../constants/strings";
import { GoogleError } from "../util/errors";
import { mapLimit } from "../util/mapLimit";
import type { GoogleAuth } from "./GoogleAuth";
import type { DriveItem, GoogleDriveClient } from "./GoogleDriveClient";
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

const TRANSFERS_AT_ONCE = 4;
const FOLDER_NAME_LENGTH = 100;

/** What the folder of a target holds now: the files (id and MD5 by path), the folders (id by path, `""` is the folder itself). */
interface Remote {
  readonly version: string;
  readonly files: Map<string, { id: string; md5: string }>;
  readonly folders: Map<string, string>;
}

function md5(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("hex");
}

/** The version of a folder: Drive has none of its own, so it is the hash of what the folder holds (every path and its MD5). */
function versionOf(files: ReadonlyMap<string, { md5: string }>): string {
  const lines = [...files].map(([path, file]) => `${path}\t${file.md5}`).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

/**
 * Syncs with a folder of the Google Drive of the user, through the Drive API and the sign-in of {@link GoogleAuth}. The
 * folder holds the notes as they are (the same paths, one Drive file for each note). Drive reports the MD5 of every file, so
 * that is the hash that the sync compares; it has no versions of the whole folder, so the version is the hash of the list of
 * paths and MD5s ({@link versionOf}). With the `drive.file` scope NoteRoot only sees what it made itself, so the folder is
 * made by NoteRoot ({@link creator}) and another computer finds it in the list. A push is a series of requests, not one
 * commit: the version is checked right before it starts, and two computers that push at the very same moment can still mix
 * their files. Deleted files go to the Trash of Drive.
 */
export class GoogleDriveSyncProvider implements SyncProvider {
  readonly id = "googledrive";
  readonly label = "Google Drive";
  readonly targetNoun = "folder";
  readonly versionNoun = "version";
  readonly canLimitHistory = false;
  readonly description = Strings.sync.googleDrive.description;
  readonly pickTitle = Strings.sync.googleDrive.pickTitle;
  readonly pickPlaceholder = Strings.sync.googleDrive.pickPlaceholder;
  readonly loading = Strings.sync.googleDrive.loading;

  readonly creator: TargetCreator = {
    item: Strings.sync.googleDrive.createItem,
    detail: Strings.sync.googleDrive.createDetail,
    prompt: Strings.sync.googleDrive.createPrompt,
    value: Strings.sync.googleDrive.createValue,
    validate: (name) => validateFolderName(name),
    create: async (name) => {
      const label = name.trim();
      return { id: await this.client.createFolder(label, undefined), label, isPrivate: true };
    },
  };

  /** The files of the folder that was read last, so a pull does not list them again for each file. */
  private last: { target: string; remote: Remote } | undefined;

  constructor(
    private readonly auth: GoogleAuth,
    private readonly client: GoogleDriveClient,
    private readonly logger: Logger
  ) {}

  webUrl(target: RemoteTarget): string {
    return `https://drive.google.com/drive/folders/${encodeURIComponent(target.id)}`;
  }

  hash(bytes: Uint8Array): string {
    return md5(bytes);
  }

  signIn(): Promise<boolean> {
    return this.auth.signIn();
  }

  /** The folders that NoteRoot made in the top of the Drive (not the folders inside them). */
  async listTargets(): Promise<RemoteTarget[]> {
    const items = await this.client.listAll();
    const known = new Set(items.map((item) => item.id));
    return items
      .filter((item) => item.isFolder && (item.parent === undefined || !known.has(item.parent)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => ({ id: item.id, label: item.name, isPrivate: true }));
  }

  async currentVersion(target: RemoteTarget): Promise<string | undefined> {
    return (await this.read(target)).version;
  }

  async snapshot(target: RemoteTarget): Promise<RemoteSnapshot | undefined> {
    const remote = await this.read(target);
    return {
      version: remote.version,
      files: [...remote.files].map(([path, file]) => ({ path, hash: file.md5 })),
      truncated: false,
    };
  }

  async download(target: RemoteTarget, file: RemoteFile): Promise<Uint8Array> {
    let entry = this.last?.target === target.id ? this.last.remote.files.get(file.path) : undefined;
    if (entry?.md5 !== file.hash) {
      // The list that was read last may be older than the one the sync works from.
      entry = (await this.read(target)).files.get(file.path);
    }
    if (entry?.md5 !== file.hash) {
      throw new GoogleError(Strings.sync.googleDrive.conflict);
    }
    const bytes = await this.client.download(entry.id);
    if (md5(bytes) !== file.hash) {
      throw new GoogleError(Strings.sync.googleDrive.conflict);
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
      throw new GoogleError(Strings.sync.googleDrive.conflict);
    }
    const folders = remote.folders;
    const ensureFolder = async (path: string): Promise<string> => {
      const known = folders.get(path);
      if (known !== undefined) {
        return known;
      }
      const cut = path.lastIndexOf("/");
      const parent = await ensureFolder(cut < 0 ? "" : path.slice(0, cut));
      const id = await this.client.createFolder(path.slice(cut + 1), parent);
      folders.set(path, id);
      return id;
    };
    // The folders first, one after the other, so two files of a new folder do not make it twice.
    for (const change of changes) {
      if (change.read) {
        const cut = change.path.lastIndexOf("/");
        await ensureFolder(cut < 0 ? "" : change.path.slice(0, cut));
      }
    }
    const files = new Map(remote.files);
    const hashes = new Map<string, string>();
    await mapLimit(changes, TRANSFERS_AT_ONCE, async (change) => {
      const existing = files.get(change.path);
      if (!change.read) {
        if (existing) {
          await this.client.trash(existing.id);
          files.delete(change.path);
        }
        return;
      }
      const bytes = await change.read();
      const cut = change.path.lastIndexOf("/");
      const sent = existing
        ? await this.client.updateFile(existing.id, bytes)
        : await this.client.createFile(
            change.path.slice(cut + 1),
            await ensureFolder(cut < 0 ? "" : change.path.slice(0, cut)),
            bytes
          );
      const sum = sent.md5 ?? md5(bytes);
      files.set(change.path, { id: sent.id, md5: sum });
      hashes.set(change.path, sum);
    });
    const version = versionOf(files);
    this.last = { target: target.id, remote: { version, files, folders } };
    return { version, hashes };
  }

  /**
   * What the folder of the target holds now: one list of everything NoteRoot made, then the tree under the folder.
   * @throws GoogleError when the folder is not there any more.
   */
  private async read(target: RemoteTarget): Promise<Remote> {
    const items = await this.client.listAll();
    const root = items.find((item) => item.id === target.id && item.isFolder);
    if (!root) {
      throw new GoogleError(Strings.sync.googleDrive.folderGone);
    }
    const children = new Map<string, DriveItem[]>();
    for (const item of items) {
      if (item.parent !== undefined) {
        children.set(item.parent, [...(children.get(item.parent) ?? []), item]);
      }
    }
    const files = new Map<string, { id: string; md5: string }>();
    const folders = new Map<string, string>([["", root.id]]);
    const queue: { id: string; path: string }[] = [{ id: root.id, path: "" }];
    let skipped = 0;
    for (let next = 0; next < queue.length; next++) {
      const { id, path } = queue[next];
      // Same name twice in one folder is allowed by Drive, not by the sync: the first (by id) is used, the rest is left alone.
      const inside = [...(children.get(id) ?? [])].sort((a, b) =>
        a.name === b.name ? (a.id < b.id ? -1 : 1) : a.name < b.name ? -1 : 1
      );
      for (const item of inside) {
        const here = path === "" ? item.name : `${path}/${item.name}`;
        if (item.name.includes("/") || files.has(here) || folders.has(here)) {
          skipped++;
        } else if (item.isFolder) {
          folders.set(here, item.id);
          queue.push({ id: item.id, path: here });
        } else if (item.md5 !== undefined) {
          files.set(here, { id: item.id, md5: item.md5 });
        } else {
          skipped++; // A Google document: it has no bytes to sync.
        }
      }
    }
    if (skipped > 0) {
      this.logger.info(
        `Google Drive: ${skipped} item(s) of the folder are not synced (same name twice, or not a file).`
      );
    }
    const remote: Remote = { version: versionOf(files), files, folders };
    this.last = { target: target.id, remote };
    return remote;
  }
}

/** A message for a folder name that cannot be used, or undefined. */
function validateFolderName(name: string): string | undefined {
  const trimmed = name.trim();
  return trimmed.length > 0 &&
    trimmed.length <= FOLDER_NAME_LENGTH &&
    !/[\\/\u0000-\u001f]/.test(trimmed)
    ? undefined
    : Strings.sync.googleDrive.createInvalid;
}
