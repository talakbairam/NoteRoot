import { Strings } from "../constants/strings";
import { InvalidNameError, NameConflictError } from "../util/errors";

export interface NameValidationOptions {
  /** Names of the entries already in the target folder. */
  siblings?: readonly string[];
  /**
   * When renaming: the item's current name. It is not a conflict with itself,
   * which is what allows a case-only rename such as `note.md` to `Note.md`.
   */
  currentName?: string;
}

export interface NameProblem {
  kind: "invalid" | "conflict";
  message: string;
}

const MAX_NAME_LENGTH = 255;
const ILLEGAL_CHARACTERS = /[<>:"|?*]/;
// Rejected on every OS so notes can be synced between systems safely.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Cross-OS validation of a single file or folder name (not a path). */
export class NameValidator {
  /** Returns a short message for the first problem found, or undefined when the name is fine. Suits `validateInput`. */
  validate(name: string, options: NameValidationOptions = {}): string | undefined {
    return this.check(name, options)?.message;
  }

  /** @throws InvalidNameError or NameConflictError */
  assertValid(name: string, options: NameValidationOptions = {}): void {
    const problem = this.check(name, options);
    if (!problem) {
      return;
    }
    throw problem.kind === "conflict"
      ? new NameConflictError(name)
      : new InvalidNameError(name, problem.message);
  }

  check(name: string, options: NameValidationOptions = {}): NameProblem | undefined {
    const invalid = this.findInvalidReason(name);
    if (invalid) {
      return { kind: "invalid", message: invalid };
    }
    if (this.conflictsWithSibling(name, options)) {
      return { kind: "conflict", message: Strings.nameValidation.alreadyExists(name) };
    }
    return undefined;
  }

  private findInvalidReason(name: string): string | undefined {
    const messages = Strings.nameValidation;
    if (name.trim().length === 0) {
      return messages.empty;
    }
    if (name.includes("/") || name.includes("\\")) {
      return messages.separators;
    }
    if (ILLEGAL_CHARACTERS.test(name)) {
      return messages.illegalCharacters;
    }
    if (CONTROL_CHARACTERS.test(name)) {
      return messages.controlCharacters;
    }
    if (name === "." || name === "..") {
      return messages.dotName;
    }
    if (name.endsWith(".") || name.endsWith(" ")) {
      return messages.trailingDotOrSpace;
    }
    // Windows treats "con.txt" like "con", so only the part before the first dot counts.
    const baseName = name.split(".")[0].trimEnd();
    if (WINDOWS_RESERVED.test(baseName)) {
      return messages.reserved(baseName.toUpperCase());
    }
    if (name.length > MAX_NAME_LENGTH || Buffer.byteLength(name, "utf8") > MAX_NAME_LENGTH) {
      return messages.tooLong;
    }
    return undefined;
  }

  private conflictsWithSibling(name: string, options: NameValidationOptions): boolean {
    const siblings = [...(options.siblings ?? [])];
    if (options.currentName !== undefined) {
      const ownIndex = siblings.indexOf(options.currentName);
      if (ownIndex >= 0) {
        siblings.splice(ownIndex, 1);
      }
    }
    // Case-insensitive on every OS, so "Note.md" and "note.md" never coexist.
    const wanted = name.toLowerCase();
    return siblings.some((sibling) => sibling.toLowerCase() === wanted);
  }
}
