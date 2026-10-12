import * as vscode from "vscode";
import { Strings } from "../constants/strings";
import { EncryptionRefusedError } from "../util/errors";
import { basename, parentOf } from "../util/uri";
import { FileOperationsService } from "./FileOperationsService";
import { Logger } from "./Logger";
import {
  decryptedName,
  decryptToBytes,
  encryptBytes,
  encryptedName,
  isEncryptedName,
  looksEncrypted,
} from "./NoteCrypto";
import { PathGuard } from "./PathGuard";

/** A note bigger than this is not encrypted here: the whole file is held in memory. */
const MAX_ENCRYPTED_BYTES = 10 * 1024 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

/**
 * Encrypts and decrypts notes of the notes folder with the master key the user gives (it is never stored). An encrypted note is
 * the same file with the text of {@link encryptBytes} in it and `.enc` added to its name (`ideas.md` becomes `ideas.md.enc`),
 * renamed with the editors, pins and recent entries following. The service shows no UI: the commands ask for the key.
 *
 * Nothing is overwritten before it is sure: the result is decrypted again and compared, the file keeps its old name until the
 * new content is on disk, and a file with unsaved changes is refused.
 */
export class NoteEncryptionService {
  constructor(
    private readonly pathGuard: PathGuard,
    private readonly fileOps: FileOperationsService,
    private readonly logger: Logger
  ) {}

  /**
   * Encrypts a note in place. @returns the note under its new name (`.enc` added).
   * @throws EncryptionRefusedError for unsaved changes, the Quick Note file, a file that is not text, one that is encrypted
   * already or a name that is taken.
   */
  async encrypt(uri: vscode.Uri, key: string): Promise<vscode.Uri> {
    this.pathGuard.assertInsideRoot(uri, { allowRoot: false });
    const name = basename(uri);
    if (isEncryptedName(name)) {
      throw new EncryptionRefusedError(Strings.encryption.alreadyEncrypted(name));
    }
    if (this.fileOps.involvesQuickNoteFile(uri)) {
      throw new EncryptionRefusedError(Strings.encryption.quickNoteFile);
    }
    this.assertSaved(uri, name);
    const target = vscode.Uri.joinPath(parentOf(uri), encryptedName(name));
    await this.assertFree(target);

    const stat = await vscode.workspace.fs.stat(uri);
    this.assertNotLink(stat, name);
    if (stat.size > MAX_ENCRYPTED_BYTES) {
      throw new EncryptionRefusedError(Strings.encryption.tooBig(name));
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.subarray(0, 8000).includes(0)) {
      throw new EncryptionRefusedError(Strings.encryption.notText(name));
    }
    if (looksEncrypted(decoder.decode(bytes.subarray(0, 64)))) {
      throw new EncryptionRefusedError(Strings.encryption.alreadyEncrypted(name));
    }

    const encrypted = await encryptBytes(bytes, key);
    // The result has to open again with the same key and give the same bytes, before anything is written.
    const check = await decryptToBytes(encrypted, key, name);
    if (check.length !== bytes.length || !check.every((byte, index) => byte === bytes[index])) {
      throw new Error("The encrypted text did not decrypt to the original.");
    }
    await vscode.workspace.fs.writeFile(uri, encoder.encode(encrypted));
    // Written and read back before the file gets its new name: if something stops here the note is still there, encrypted.
    if (decoder.decode(await vscode.workspace.fs.readFile(uri)) !== encrypted) {
      throw new Error("The encrypted note was not written completely.");
    }
    await this.fileOps.renameKeepingEditors(uri, target);
    this.logger.info(`Encrypted ${this.pathGuard.getRelativePath(target) ?? name}.`);
    return target;
  }

  /**
   * Decrypts a note for good: it gets its old name back (`.enc` taken off) and its text.
   * @throws NotEncryptedError / WrongKeyError / EncryptionRefusedError (unsaved changes, a name that is taken).
   */
  async decryptPermanently(uri: vscode.Uri, key: string): Promise<vscode.Uri> {
    this.pathGuard.assertInsideRoot(uri, { allowRoot: false });
    const name = basename(uri);
    this.assertSaved(uri, name);
    this.assertNotLink(await vscode.workspace.fs.stat(uri), name);
    const plain = await this.decryptFile(uri, key, name);
    const target = vscode.Uri.joinPath(parentOf(uri), decryptedName(name));
    if (target.path !== uri.path) {
      await this.assertFree(target);
      // Renamed first: the pins and recent entries follow, and if something stops here the file is still the encrypted one.
      await this.fileOps.renameKeepingEditors(uri, target);
    }
    try {
      await vscode.workspace.fs.writeFile(target, plain);
    } catch (error) {
      // The file must not stay under the plain name with encrypted text in it: give it its encrypted name back.
      if (target.path !== uri.path) {
        await this.fileOps.renameKeepingEditors(target, uri).catch(() => undefined);
      }
      throw error;
    }
    this.logger.info(`Decrypted ${this.pathGuard.getRelativePath(target) ?? name}.`);
    return target;
  }

  /**
   * The text of an encrypted note, for reading. The file is not changed.
   * @throws NotEncryptedError / WrongKeyError.
   */
  async decryptForViewing(uri: vscode.Uri, key: string): Promise<{ name: string; text: string }> {
    this.pathGuard.assertInsideRoot(uri, { allowRoot: false });
    const name = basename(uri);
    const plain = await this.decryptFile(uri, key, name);
    return { name: decryptedName(name), text: decoder.decode(plain) };
  }

  private async decryptFile(uri: vscode.Uri, key: string, name: string): Promise<Uint8Array> {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_ENCRYPTED_BYTES * 2) {
      throw new EncryptionRefusedError(Strings.encryption.tooBig(name));
    }
    return decryptToBytes(decoder.decode(await vscode.workspace.fs.readFile(uri)), key, name);
  }

  /** A write goes through a link to the file it points to, which may be outside the notes folder. */
  private assertNotLink(stat: vscode.FileStat, name: string): void {
    if (PathGuard.isSymbolicLink(stat.type)) {
      throw new EncryptionRefusedError(Strings.encryption.isLink(name));
    }
  }

  private assertSaved(uri: vscode.Uri, name: string): void {
    const open = vscode.workspace.textDocuments.find((doc) => this.pathGuard.isSame(doc.uri, uri));
    if (open?.isDirty) {
      throw new EncryptionRefusedError(Strings.encryption.unsaved(name));
    }
  }

  private async assertFree(target: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.stat(target);
    } catch {
      return; // Not there: free.
    }
    throw new EncryptionRefusedError(Strings.encryption.targetExists(basename(target)));
  }
}
