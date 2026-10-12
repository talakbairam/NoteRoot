import { Strings } from "../constants/strings";
import { SyncRefusedError, WrongKeyError } from "../util/errors";
import { mapLimit } from "../util/mapLimit";
import { Logger } from "./Logger";
import {
  HEADER_PATH,
  INDEX_PATH,
  decodeIndex,
  deriveKey,
  encodeHeader,
  encodeIndex,
  keyMatches,
  makeHeader,
  newSalt,
  openBytes,
  parseHeader,
  remoteName,
  sealBytes,
  sha256,
  type EncryptedIndex,
  type EncryptionHeader,
  type NameMode,
} from "./SyncCrypto";
import { MARKER_PATH } from "./SyncPlan";
import type {
  RemoteFile,
  RemoteSnapshot,
  RemoteTarget,
  SyncProvider,
  TargetCreator,
  TargetFinder,
  UploadChange,
  UploadOptions,
  UploadResult,
} from "./SyncProvider";

/** Where the derived keys are kept between sessions (the `SecretStorage` of VS Code). The master key itself is never stored. */
export interface KeyStore {
  get(id: string): Promise<Buffer | undefined>;
  set(id: string, key: Buffer): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Asks the user for the master key of an encrypted repository. Undefined means that the user cancelled. */
export interface KeyAsker {
  askExisting(label: string, retry: boolean): Promise<string | undefined>;
}

/** What a stored connection remembers about the encryption of its repository. */
export interface EncryptionConfig {
  readonly names: NameMode;
  /** The salt of the key, in base64. */
  readonly salt: string;
}

/** What is online in a target, as far as encryption goes. */
export type TargetKind =
  | { readonly kind: "empty" }
  | { readonly kind: "plain" }
  | ({ readonly kind: "encrypted" } & EncryptionConfig);

const WRONG_KEY_TRIES = 3;
const TRANSFERS_AT_ONCE = 4;

function keyId(providerId: string, target: RemoteTarget, salt: string): string {
  return `noteRoot.sync.key:${providerId}:${target.id}:${salt}`;
}

/** Everything needed to seal a whole repository again: with a new key (change of the master key) or for the first time. */
export interface SealedRewrite {
  readonly target: RemoteTarget;
  readonly names: NameMode;
  readonly masterKey: string;
  /** The plain content of every note. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** Names online that go away (the plain notes, or the old sealed files). Names that are used again are kept. */
  readonly remove: readonly string[];
  readonly expectedVersion: string | undefined;
  readonly message: string;
  readonly options?: UploadOptions;
}

/** Looks at a target and sets up the encryption of a new one. Holds the key store and the way to ask for a key. */
export class EncryptionSupport {
  constructor(
    private readonly keys: KeyStore,
    private readonly asker: KeyAsker,
    private readonly logger: Logger
  ) {}

  /** Is the target empty, full of plain notes, or already encrypted by NoteRoot (and how)? */
  async inspect(provider: SyncProvider, target: RemoteTarget): Promise<TargetKind> {
    const snapshot = await provider.snapshot(target);
    if (!snapshot) {
      return { kind: "empty" };
    }
    const header = snapshot.files.find((file) => file.path === HEADER_PATH);
    if (header) {
      const parsed = parseHeader(await provider.download(target, header));
      if (!parsed) {
        throw new SyncRefusedError(Strings.sync.encryption.headerUnreadable);
      }
      return { kind: "encrypted", names: parsed.names, salt: parsed.salt };
    }
    return snapshot.files.some((file) => file.path !== MARKER_PATH)
      ? { kind: "plain" }
      : { kind: "empty" };
  }

  /** Makes the key of a new encrypted target and keeps it for this computer. Returns what the connection remembers. */
  async create(
    provider: SyncProvider,
    target: RemoteTarget,
    names: NameMode,
    masterKey: string
  ): Promise<EncryptionConfig> {
    const salt = newSalt();
    const key = await deriveKey(masterKey, salt);
    const config = { names, salt: salt.toString("base64") };
    await this.keys.set(keyId(provider.id, target, config.salt), key);
    return config;
  }

  /** The provider that seals what it sends and opens what it brings. */
  wrap(provider: SyncProvider, config: EncryptionConfig): SyncProvider {
    return new EncryptedSyncProvider(provider, config, this.keys, this.asker, this.logger);
  }

  /** Removes the key of an encrypted target from this computer. The master key is asked the next time it is needed. */
  async forgetKey(
    provider: SyncProvider,
    target: RemoteTarget,
    config: EncryptionConfig
  ): Promise<void> {
    await this.keys.delete(keyId(provider.id, target, config.salt));
  }

  /**
   * Reads and opens every note of an encrypted target (the master key is asked when the saved key does not open it).
   * `sealedNames` are the names of the sealed files online.
   */
  async readEverything(
    provider: SyncProvider,
    config: EncryptionConfig,
    target: RemoteTarget
  ): Promise<{
    version: string | undefined;
    files: Map<string, Uint8Array>;
    sealedNames: string[];
  }> {
    const opened = new EncryptedSyncProvider(provider, config, this.keys, this.asker, this.logger);
    const snapshot = await opened.snapshot(target);
    const files = new Map<string, Uint8Array>();
    const sealedNames: string[] = [];
    if (!snapshot) {
      return { version: undefined, files, sealedNames };
    }
    await mapLimit(snapshot.files, TRANSFERS_AT_ONCE, async (file) => {
      files.set(file.path, await opened.download(target, file));
      const name = opened.sealedNameOf(file.path);
      if (name) {
        sealedNames.push(name);
      }
    });
    return { version: snapshot.version, files, sealedNames };
  }

  /**
   * Seals every note again under a new key (a new salt and the key of the new master key) and sends it all as one new
   * version: the sealed notes, the header and the index, and the removal of the files that are no longer used. The new key is
   * kept for this computer only after the upload worked. Returns what the connection must remember, the new version and the
   * hash of every plain note.
   * @throws NoteRootError (from the provider) when the upload is refused, for example because the target changed meanwhile.
   */
  async rewrite(
    provider: SyncProvider,
    job: SealedRewrite
  ): Promise<{ config: EncryptionConfig; version: string; hashes: Map<string, string> }> {
    const salt = newSalt();
    const key = await deriveKey(job.masterKey, salt);
    const config: EncryptionConfig = { names: job.names, salt: salt.toString("base64") };
    const index: EncryptedIndex = new Map();
    const hashes = new Map<string, string>();
    const keep = new Set<string>();
    const changes: UploadChange[] = [];
    for (const [path, plain] of job.files) {
      const name = remoteName(key, path, job.names);
      const hash = sha256(plain);
      const sealed = sealBytes(key, plain, path);
      index.set(path, { name, hash });
      hashes.set(path, hash);
      keep.add(name);
      changes.push({ path: name, read: async () => sealed });
    }
    for (const name of job.remove) {
      if (!keep.has(name) && name !== HEADER_PATH && name !== INDEX_PATH) {
        changes.push({ path: name, read: undefined });
      }
    }
    const header = encodeHeader(makeHeader(key, salt, job.names));
    const indexBytes = encodeIndex(key, index);
    changes.push({ path: HEADER_PATH, read: async () => header });
    changes.push({ path: INDEX_PATH, read: async () => indexBytes });
    const result = await provider.upload(
      job.target,
      job.expectedVersion,
      changes,
      job.message,
      job.options
    );
    await this.keys.set(keyId(provider.id, job.target, config.salt), key);
    return { config, version: result.version, hashes };
  }
}

interface Session {
  readonly version: string;
  readonly key: Buffer;
  readonly header: EncryptionHeader | undefined;
  readonly index: EncryptedIndex;
  /** The files online by name, to find the one of a note. */
  readonly byName: ReadonlyMap<string, RemoteFile>;
}

/**
 * Wraps another provider so that notes are sealed before they go online and opened when they come back. The sync (compare,
 * push, pull, conflicts) does not know about it: it sees plain paths and the hash of the plain content. The hashes of the
 * sealed files online cannot be compared (every sealing differs), so the sealed index keeps the hash of each note.
 */
class EncryptedSyncProvider implements SyncProvider {
  readonly id: string;
  readonly label: string;
  readonly targetNoun: string;
  readonly versionNoun: string;
  readonly description: string;
  readonly canLimitHistory: boolean;
  readonly pickTitle: string;
  readonly pickPlaceholder: string;
  readonly loading: string;
  readonly creator: TargetCreator | undefined;
  readonly finder: TargetFinder | undefined;

  private session: Session | undefined;

  constructor(
    private readonly inner: SyncProvider,
    private readonly config: EncryptionConfig,
    private readonly keys: KeyStore,
    private readonly asker: KeyAsker,
    private readonly logger: Logger
  ) {
    this.id = inner.id;
    this.label = inner.label;
    this.targetNoun = inner.targetNoun;
    this.versionNoun = inner.versionNoun;
    this.description = inner.description;
    this.canLimitHistory = inner.canLimitHistory;
    this.pickTitle = inner.pickTitle;
    this.pickPlaceholder = inner.pickPlaceholder;
    this.loading = inner.loading;
    this.creator = inner.creator;
    this.finder = inner.finder;
  }

  /** The hash of the plain content: what the sync compares. */
  hash(bytes: Uint8Array): string {
    return sha256(bytes);
  }

  signIn(): Promise<boolean> {
    return this.inner.signIn();
  }

  listTargets(): Promise<RemoteTarget[]> {
    return this.inner.listTargets();
  }

  currentVersion(target: RemoteTarget): Promise<string | undefined> {
    return this.inner.currentVersion(target);
  }

  async snapshot(target: RemoteTarget): Promise<RemoteSnapshot | undefined> {
    this.session = undefined;
    const raw = await this.inner.snapshot(target);
    if (!raw) {
      return undefined;
    }
    const byName = new Map(raw.files.map((file) => [file.path, file]));
    const headerFile = byName.get(HEADER_PATH);
    if (!headerFile) {
      if (raw.files.some((file) => file.path !== MARKER_PATH)) {
        throw new SyncRefusedError(Strings.sync.encryption.notEncryptedRepo);
      }
      // Nothing there yet: the first push writes the header. The key was made when the connection was set up.
      const key = await this.savedKey(target);
      this.session = { version: raw.version, key, header: undefined, index: new Map(), byName };
      return { version: raw.version, files: [], truncated: raw.truncated };
    }
    const header = parseHeader(await this.inner.download(target, headerFile));
    if (!header) {
      throw new SyncRefusedError(Strings.sync.encryption.headerUnreadable);
    }
    if (header.salt !== this.config.salt) {
      throw new SyncRefusedError(Strings.sync.encryption.otherSetup);
    }
    const key = await this.unlock(target, header);
    const indexFile = byName.get(INDEX_PATH);
    const index = indexFile
      ? decodeIndex(key, await this.inner.download(target, indexFile))
      : new Map();
    const files: RemoteFile[] = [];
    for (const [path, entry] of index) {
      if (byName.has(entry.name)) {
        files.push({ path, hash: entry.hash });
      } else {
        this.logger.warn(`Skipped "${path}": its encrypted file is missing online.`);
      }
    }
    this.session = { version: raw.version, key, header, index, byName };
    return { version: raw.version, files, truncated: raw.truncated };
  }

  /** The name online of the sealed file of a note, from the last read. */
  sealedNameOf(path: string): string | undefined {
    return this.session?.index.get(path)?.name;
  }

  async download(target: RemoteTarget, file: RemoteFile): Promise<Uint8Array> {
    const session = await this.sessionFor(target);
    const entry = session.index.get(file.path);
    const sealed = entry ? session.byName.get(entry.name) : undefined;
    if (!entry || !sealed) {
      throw new SyncRefusedError(Strings.sync.encryption.damaged(file.path));
    }
    let plain: Uint8Array;
    try {
      plain = openBytes(session.key, await this.inner.download(target, sealed), file.path);
    } catch (error) {
      if (error instanceof WrongKeyError) {
        throw new SyncRefusedError(Strings.sync.encryption.damaged(file.path));
      }
      throw error;
    }
    if (sha256(plain) !== entry.hash) {
      throw new SyncRefusedError(Strings.sync.encryption.damaged(file.path));
    }
    return plain;
  }

  async upload(
    target: RemoteTarget,
    expectedVersion: string | undefined,
    changes: readonly UploadChange[],
    message: string,
    options?: UploadOptions
  ): Promise<UploadResult> {
    const session = await this.sessionFor(target, expectedVersion);
    const index: EncryptedIndex = new Map(session.index);
    const sent: UploadChange[] = [];
    const hashes = new Map<string, string>();
    for (const change of changes) {
      const old = index.get(change.path);
      if (!change.read) {
        if (old) {
          sent.push({ path: old.name, read: undefined });
          index.delete(change.path);
        }
        continue;
      }
      const plain = await change.read();
      const hash = sha256(plain);
      const name = remoteName(session.key, change.path, this.config.names);
      const sealed = sealBytes(session.key, plain, change.path);
      sent.push({ path: name, read: async () => sealed });
      index.set(change.path, { name, hash });
      hashes.set(change.path, hash);
    }
    if (!session.header) {
      const header = makeHeader(
        session.key,
        Buffer.from(this.config.salt, "base64"),
        this.config.names
      );
      sent.push({ path: HEADER_PATH, read: async () => encodeHeader(header) });
    }
    const indexBytes = encodeIndex(session.key, index);
    sent.push({ path: INDEX_PATH, read: async () => indexBytes });
    const result = await this.inner.upload(target, expectedVersion, sent, message, options);
    this.session = undefined;
    return { version: result.version, hashes };
  }

  /** The session for the version that is current, read again when it is not. */
  private async sessionFor(target: RemoteTarget, version?: string): Promise<Session> {
    if (!this.session || (version !== undefined && this.session.version !== version)) {
      await this.snapshot(target);
    }
    if (!this.session) {
      // An empty target (no version): its key comes from the store.
      this.session = {
        version: "",
        key: await this.savedKey(target),
        header: undefined,
        index: new Map(),
        byName: new Map(),
      };
    }
    return this.session;
  }

  /** The key of a target that has no header yet. It was made and kept when the connection was set up. */
  private async savedKey(target: RemoteTarget): Promise<Buffer> {
    const key = await this.keys.get(keyId(this.id, target, this.config.salt));
    if (!key) {
      throw new SyncRefusedError(Strings.sync.encryption.keyMissing);
    }
    return key;
  }

  /** The key of an encrypted target: the one kept on this computer, or the master key typed by the user. */
  private async unlock(target: RemoteTarget, header: EncryptionHeader): Promise<Buffer> {
    const id = keyId(this.id, target, this.config.salt);
    const saved = await this.keys.get(id);
    if (saved && keyMatches(saved, header)) {
      return saved;
    }
    if (saved) {
      await this.keys.delete(id); // It no longer opens this repository.
    }
    for (let attempt = 0; attempt < WRONG_KEY_TRIES; attempt++) {
      const masterKey = await this.asker.askExisting(target.label, attempt > 0);
      if (masterKey === undefined) {
        throw new SyncRefusedError(Strings.sync.encryption.keyRequired);
      }
      const key = await deriveKey(masterKey, Buffer.from(header.salt, "base64"));
      if (keyMatches(key, header)) {
        await this.keys.set(id, key);
        return key;
      }
    }
    throw new WrongKeyError();
  }
}
