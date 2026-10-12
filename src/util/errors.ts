import { Strings } from "../constants/strings";

/** Base class: the message of a NoteRoot error is always safe to show to the user. */
export class NoteRootError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class OutsideRootError extends NoteRootError {
  constructor(readonly path: string) {
    super(Strings.errors.outsideRoot);
  }
}

export class NameConflictError extends NoteRootError {
  constructor(readonly conflictingName: string) {
    super(Strings.nameValidation.alreadyExists(conflictingName));
  }
}

export class InvalidNameError extends NoteRootError {
  constructor(
    readonly invalidName: string,
    reason: string
  ) {
    super(reason);
  }
}

/** A move that makes no sense, for example a folder into itself. */
export class InvalidMoveError extends NoteRootError {
  constructor(readonly itemName: string) {
    super(Strings.errors.invalidMove(itemName));
  }
}

/** "Paste and Save" was used while the clipboard holds no text. */
export class EmptyClipboardError extends NoteRootError {
  constructor() {
    super(Strings.errors.clipboardEmpty);
  }
}

export class RootMissingError extends NoteRootError {
  constructor(message: string = Strings.errors.rootMissing) {
    super(message);
  }
}

export class TrashUnavailableError extends NoteRootError {
  constructor(cause?: unknown) {
    super(Strings.errors.trashUnavailable, { cause });
  }
}

export class ConfigCorruptError extends NoteRootError {
  constructor(reason: string = Strings.errors.configCorrupt, cause?: unknown) {
    super(reason, { cause });
  }
}

/** The config file must not be changed: it is invalid or was created by a newer version. */
export class ConfigLockedError extends NoteRootError {
  constructor() {
    super(Strings.errors.configLocked);
  }
}

/** The file linked to a category is not inside the notes folder (for example edited by hand). */
export class CategoryFileError extends NoteRootError {
  constructor(readonly categoryName: string) {
    super(Strings.errors.categoryFileOutside(categoryName));
  }
}

/** The master key is wrong, or the encrypted note was changed. */
export class WrongKeyError extends NoteRootError {
  constructor() {
    super(Strings.encryption.wrongKey);
  }
}

/** The file is not an encrypted note (or it is cut short). */
export class NotEncryptedError extends NoteRootError {
  constructor(name: string) {
    super(Strings.encryption.notEncrypted(name));
  }
}

/** Encrypting or decrypting is refused: unsaved changes, the Quick Note file, a name that is taken... The message says why. */
export class EncryptionRefusedError extends NoteRootError {}

/** GitHub refused a request or could not be reached. The message says what the user can do about it. */
export class GitHubError extends NoteRootError {
  /** The HTTP status of the answer, when there was one. */
  readonly status: number | undefined;

  constructor(message: string, options?: { status?: number; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.status = options?.status;
  }
}

/** A sync action is refused: no repository chosen, another sync running, new commits to pull first... The message says why. */
export class SyncRefusedError extends NoteRootError {}
