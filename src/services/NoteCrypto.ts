import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { NotEncryptedError, WrongKeyError } from "../util/errors";

/**
 * Encryption of a note. AES-256-GCM (it also checks that the text was not changed and that the key is right) with a key made
 * from the master key by scrypt and a random salt for every file, so the same master key gives another key for every note.
 * Only the Node library is used: no dependency, no network. The result is plain text, safe for git and sync:
 *
 *   NOTEROOT-ENCRYPTED v1
 *   <base64 of salt (16) + iv (12) + tag (16) + the encrypted bytes, in lines of 76 characters>
 */

/** The first line of an encrypted note. */
export const ENCRYPTED_HEADER = "NOTEROOT-ENCRYPTED v1";
/** The name of an encrypted note ends with this. */
export const ENCRYPTED_SUFFIX = ".enc";
/** A shorter master key is refused. */
export const MIN_KEY_LENGTH = 8;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const LINE_LENGTH = 76;
// 2^15 (32 MB of memory): slow enough to make guessing hard, fast enough to wait for. The limit has to be above 128 * N * r.
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** True when the name says the file is an encrypted note (`ideas.md.enc`). */
export function isEncryptedName(name: string): boolean {
  return name.toLowerCase().endsWith(ENCRYPTED_SUFFIX);
}

/** The name an encrypted note has: `ideas.md` gives `ideas.md.enc`. */
export function encryptedName(name: string): string {
  return name + ENCRYPTED_SUFFIX;
}

/** The name a decrypted note gets back: `ideas.md.enc` gives `ideas.md`. */
export function decryptedName(name: string): string {
  return isEncryptedName(name) ? name.slice(0, name.length - ENCRYPTED_SUFFIX.length) : name;
}

/** True when the text is the content of an encrypted note. */
export function looksEncrypted(text: string): boolean {
  return text.startsWith(ENCRYPTED_HEADER + "\n") || text.startsWith(ENCRYPTED_HEADER + "\r\n");
}

function deriveKey(key: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(key.normalize("NFC"), salt, KEY_BYTES, SCRYPT, (error, derived) =>
      error ? reject(error) : resolve(derived)
    );
  });
}

/** Encrypts the bytes of a note. @returns the text of the encrypted note. */
export async function encryptBytes(bytes: Uint8Array, key: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", await deriveKey(key, salt), iv);
  // The header is part of what the tag protects, so the format cannot be swapped for another one.
  cipher.setAAD(Buffer.from(ENCRYPTED_HEADER));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const payload = Buffer.concat([salt, iv, cipher.getAuthTag(), encrypted]).toString("base64");
  const lines = payload.match(new RegExp(`.{1,${LINE_LENGTH}}`, "g")) ?? [];
  return `${ENCRYPTED_HEADER}\n${lines.join("\n")}\n`;
}

/**
 * Decrypts the text of an encrypted note.
 * @throws NotEncryptedError when the text is not an encrypted note (or is cut short).
 * @throws WrongKeyError when the key is wrong or the text was changed.
 */
export async function decryptToBytes(text: string, key: string, name = ""): Promise<Uint8Array> {
  if (!looksEncrypted(text)) {
    throw new NotEncryptedError(name);
  }
  const payload = Buffer.from(text.slice(ENCRYPTED_HEADER.length).replace(/\s+/g, ""), "base64");
  if (payload.length < SALT_BYTES + IV_BYTES + TAG_BYTES) {
    throw new NotEncryptedError(name);
  }
  const salt = payload.subarray(0, SALT_BYTES);
  const iv = payload.subarray(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const tag = payload.subarray(SALT_BYTES + IV_BYTES, SALT_BYTES + IV_BYTES + TAG_BYTES);
  const encrypted = payload.subarray(SALT_BYTES + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", await deriveKey(key, salt), iv);
  decipher.setAAD(Buffer.from(ENCRYPTED_HEADER));
  decipher.setAuthTag(tag);
  try {
    return new Uint8Array(Buffer.concat([decipher.update(encrypted), decipher.final()]));
  } catch {
    throw new WrongKeyError();
  }
}
