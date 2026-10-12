import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt,
} from "node:crypto";
import { MIN_KEY_LENGTH } from "./NoteCrypto";
import { WrongKeyError } from "../util/errors";

/**
 * The pure part of the encrypted sync: keys, sealing files, the names of the files online and the two small files that
 * describe an encrypted repository. No `vscode`, no network, so it can be checked on its own.
 *
 * What an encrypted repository holds:
 * - `.noteroot-encrypted` (plain JSON, the **header**): the format, how files are named, the salt of the key and a short
 *   text sealed with the key, so a wrong key is recognised before anything is downloaded.
 * - `.noteroot-index` (sealed): for each note its path, the name of its file online and the hash of its plain content. The
 *   hash is how the sync tells what changed (every sealing gives different bytes, so the sealed files cannot be compared).
 * - one sealed file for each note.
 *
 * Every file is sealed with AES-256-GCM under a key made once from the master key with scrypt (the master key itself is
 * never stored). The path of the note is the authenticated data, so a sealed file cannot be moved to another note.
 */

export const HEADER_PATH = ".noteroot-encrypted";
export const INDEX_PATH = ".noteroot-index";

/** How the files are named online: `plain` keeps the names (`note.md.enc`), `hidden` replaces them with a code. */
export type NameMode = "plain" | "hidden";

const MAGIC = Buffer.from("NRS1");
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const CHECK_TEXT = "NoteRoot";
const INDEX_AAD = INDEX_PATH;
const CHECK_AAD = "check";

export interface EncryptionHeader {
  readonly format: 1;
  readonly names: NameMode;
  /** The salt of the key, in base64. */
  readonly salt: string;
  /** A short text sealed with the key, in base64. */
  readonly check: string;
}

export interface IndexEntry {
  /** The name of the sealed file online. */
  readonly name: string;
  /** The hash of the plain content. */
  readonly hash: string;
}

/** Path of a note to its entry. */
export type EncryptedIndex = Map<string, IndexEntry>;

export function newSalt(): Buffer {
  return randomBytes(16);
}

/** The key for a master key: scrypt (N=2^15, r=8, p=1) of the master key in Unicode NFC. Slow on purpose, so it is made once. */
export function deriveKey(masterKey: string, salt: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      masterKey.normalize("NFC"),
      salt,
      KEY_LENGTH,
      { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key))
    );
  });
}

/** Whether a master key is long enough to use. */
export function isUsableMasterKey(masterKey: string): boolean {
  return masterKey.length >= MIN_KEY_LENGTH;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Seals bytes: the magic `NRS1`, a new iv, the tag and the encrypted bytes. `aad` is authenticated, not stored. */
export function sealBytes(key: Buffer, plain: Uint8Array, aad: string): Uint8Array {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

/**
 * Opens what {@link sealBytes} made.
 * @throws WrongKeyError for a wrong key, a changed file, or a file made for another `aad`.
 */
export function openBytes(key: Buffer, sealed: Uint8Array, aad: string): Uint8Array {
  const data = Buffer.from(sealed);
  if (data.length < MAGIC.length + IV_LENGTH + TAG_LENGTH || !data.subarray(0, 4).equals(MAGIC)) {
    throw new WrongKeyError();
  }
  const iv = data.subarray(4, 4 + IV_LENGTH);
  const tag = data.subarray(4 + IV_LENGTH, 4 + IV_LENGTH + TAG_LENGTH);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(data.subarray(4 + IV_LENGTH + TAG_LENGTH)),
      decipher.final(),
    ]);
  } catch {
    throw new WrongKeyError(); // Authentication failed: the key is wrong or the file was changed.
  }
}

/** The name of the sealed file of a note: its own name with `.enc`, or a code made from the key and the path. */
export function remoteName(key: Buffer, path: string, names: NameMode): string {
  if (names === "plain") {
    return `${path}.enc`;
  }
  const code = createHmac("sha256", key).update(`noteroot-name:${path}`).digest("hex").slice(0, 40);
  return `data/${code}.enc`;
}

export function makeHeader(key: Buffer, salt: Uint8Array, names: NameMode): EncryptionHeader {
  return {
    format: 1,
    names,
    salt: Buffer.from(salt).toString("base64"),
    check: Buffer.from(sealBytes(key, Buffer.from(CHECK_TEXT, "utf8"), CHECK_AAD)).toString(
      "base64"
    ),
  };
}

export function encodeHeader(header: EncryptionHeader): Uint8Array {
  return Buffer.from(`${JSON.stringify(header, undefined, 2)}\n`, "utf8");
}

/** Reads a header; undefined when the bytes are not one (data from outside is not trusted). */
export function parseHeader(bytes: Uint8Array): EncryptionHeader | undefined {
  try {
    const value: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    const { format, names, salt, check } = value as Record<string, unknown>;
    if (
      format === 1 &&
      (names === "plain" || names === "hidden") &&
      typeof salt === "string" &&
      typeof check === "string" &&
      Buffer.from(salt, "base64").length === 16
    ) {
      return { format, names, salt, check };
    }
  } catch {
    return undefined; // Not JSON.
  }
  return undefined;
}

/** True when the key is the one that sealed the check text of the header. */
export function keyMatches(key: Buffer, header: EncryptionHeader): boolean {
  try {
    const text = openBytes(key, Buffer.from(header.check, "base64"), CHECK_AAD);
    return Buffer.from(text).toString("utf8") === CHECK_TEXT;
  } catch {
    return false;
  }
}

export function encodeIndex(key: Buffer, index: EncryptedIndex): Uint8Array {
  const files: Record<string, IndexEntry> = {};
  for (const [path, entry] of [...index].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    files[path] = entry;
  }
  return sealBytes(key, Buffer.from(JSON.stringify({ format: 1, files }), "utf8"), INDEX_AAD);
}

/**
 * Opens an index. Entries that are not well formed are left out.
 * @throws WrongKeyError for a wrong key or an index that was changed.
 */
export function decodeIndex(key: Buffer, sealed: Uint8Array): EncryptedIndex {
  const text = Buffer.from(openBytes(key, sealed, INDEX_AAD)).toString("utf8");
  const index: EncryptedIndex = new Map();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new WrongKeyError();
  }
  const files = (value as { files?: unknown } | null)?.files;
  if (typeof files !== "object" || files === null) {
    throw new WrongKeyError();
  }
  for (const [path, raw] of Object.entries(files)) {
    const entry = raw as Partial<IndexEntry> | null;
    if (entry && typeof entry.name === "string" && typeof entry.hash === "string") {
      index.set(path, { name: entry.name, hash: entry.hash });
    }
  }
  return index;
}
