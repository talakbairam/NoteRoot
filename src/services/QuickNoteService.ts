import * as vscode from "vscode";
import {
  SettingDefaults,
  SettingKeys,
  type HeadingLevel,
  type QuickNotePosition,
} from "../constants/settings";
import { Strings } from "../constants/strings";
import {
  CategoryFileError,
  EmptyClipboardError,
  EncryptionRefusedError,
  RootMissingError,
} from "../util/errors";
import { parentOf } from "../util/uri";
import { InternalSaves } from "./InternalSaves";
import { LabelService } from "./LabelService";
import { Logger } from "./Logger";
import { NameValidator } from "./NameValidator";
import { PathGuard } from "./PathGuard";
import { RootFolderService } from "./RootFolderService";
import { SettingsService } from "./SettingsService";
import { TimestampFormatter } from "./TimestampFormatter";
import { defaultLineEnding } from "../util/lineEnding";
import { headerBlock } from "./NoteHeader";
import { isEncryptedName } from "./NoteCrypto";
import { startOfNote } from "./NoteStart";

// The note files share this function (it moved to NoteStart.ts to keep the files free of cycles).
export { startOfNote };

// A BOM in an existing file is kept as part of the text, so rewriting the file does not drop it.
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const encoder = new TextEncoder();

/**
 * What comes before the text of a note: the heading (when there is one) and the tag line, each closed by a blank line. Pure, and
 * shared with "Add > Date and Tags" of the editor menu, which writes just this part.
 */
export function buildEntryHead({
  eol,
  heading,
  tags = [],
  headingLevel = "##",
  tagLine = "{tags}",
}: Pick<AdditionOptions, "eol" | "heading" | "tags" | "headingLevel" | "tagLine">): string {
  let block = "";
  if (heading.length > 0) {
    block += `${headingLevel === "plain" ? "" : `${headingLevel} `}${heading}${eol}${eol}`;
  }
  const names = formatTags(tags);
  // Without tags the line is still written, empty, when the template has text of its own (`**Tags:** `): Run Tagging
  // and Tag when saving fill it later. A template that is only `{tags}` would give an empty line, so nothing is written.
  if (names.length > 0 || tagLine.replace("{tags}", "").trim().length > 0) {
    // Replaced with a function, so a `$` in a tag is not taken for a replacement pattern.
    block += `${tagLine.replace("{tags}", () => names)}${eol}${eol}`;
  }
  return block;
}

/** The note without any separator to what is around it: heading, tag line, then the text. */
function buildBlock({
  text,
  eol,
  ...head
}: Pick<
  AdditionOptions,
  "text" | "eol" | "heading" | "tags" | "headingLevel" | "tagLine"
>): string {
  const body = text.replace(/\s+$/, "").replace(/\r\n|\r|\n/g, eol);
  return `${buildEntryHead({ eol, ...head })}${body}${eol}`;
}

export interface AdditionOptions {
  /** Current content of the file ('' when new or empty). */
  existing: string;
  /** The note, as typed. */
  text: string;
  eol: "\n" | "\r\n";
  /** Already formatted heading text; '' means no heading. */
  heading: string;
  /** The chosen tags as the user named them; none gives an empty tag line when the template has text of its own. */
  tags?: readonly string[];
  /** How the heading is written. Default `##`. */
  headingLevel?: HeadingLevel;
  /** The line the tags are written in; `{tags}` is replaced by `#one #two`. Default: only the tags. */
  tagLine?: string;
}

/** The names once each, in order; `Work` and `work` are the same tag. */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.toLowerCase();
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

/** The tag line of a note: `#one #two`, in the order given. Empty when there is no usable tag. */
export function formatTags(names: readonly string[]): string {
  return names
    .map(formatTag)
    .filter((tag) => tag !== "")
    .join(" ");
}

/** `#tag` for a name: white space becomes `-`, because a tag cannot contain spaces. */
export function formatTag(name: string): string {
  const clean = name.trim().replace(/\s+/g, "-");
  return clean.length > 0 ? `#${clean}` : "";
}

/**
 * The exact text to append. Pure on purpose, so the format lives in one place:
 * separator blank line (only when the file has content), optional `## heading` plus blank line,
 * optional line of `#tag`s (in the template of the setting) plus blank line, then the note with the file's line endings, closed by one line ending.
 */
export function buildAddition({ existing, ...note }: AdditionOptions): string {
  let addition = "";
  if (existing.length > 0) {
    if (!existing.endsWith("\n")) {
      addition += note.eol; // Never glue the note to the previous text.
    }
    addition += note.eol; // One blank line between notes.
  }
  return addition + buildBlock(note);
}

/**
 * Where and what to insert to put a note at the start of a file. A leading BOM stays first, and so does a
 * YAML front matter block (`---` ... `---`), so the note goes right after it. The block is followed by
 * one blank line before the old content. Pure, like {@link buildAddition}.
 */
export function buildStartInsertion({ existing, ...note }: AdditionOptions): {
  offset: number;
  text: string;
} {
  const eol = note.eol;
  const { offset, prefix } = startOfNote(existing, eol);
  const rest = existing.slice(offset);
  return { offset, text: prefix + buildBlock(note) + (rest.length > 0 ? eol : "") };
}

/** What `write` hands to the two ways of writing a note. */
interface NoteToWrite {
  text: string;
  heading: string;
  tags: readonly string[];
  headingLevel: HeadingLevel;
  tagLine: string;
  position: QuickNotePosition;
}

/**
 * Adds Quick Notes to one file in the notes root.
 *
 * Every write goes through a single promise queue, so quick successive saves (button, shortcut,
 * "Add Selection") run one after the other and never interleave. A failed write does not block the queue.
 */
export class QuickNoteService implements vscode.Disposable {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly formatter = new TimestampFormatter();
  /** The last invalid setting value that was logged, to log it once instead of for every note. */
  private reportedInvalidFile: string | undefined;
  private readonly targetEmitter = new vscode.EventEmitter<void>();
  private readonly subscriptions: vscode.Disposable[];

  /** Fires when the file that receives the notes may have changed (setting or notes folder). */
  readonly onDidChangeTarget = this.targetEmitter.event;

  constructor(
    private readonly rootService: RootFolderService,
    private readonly pathGuard: PathGuard,
    private readonly settings: SettingsService,
    private readonly nameValidator: NameValidator,
    private readonly labels: LabelService,
    private readonly logger: Logger,
    private readonly internalSaves: InternalSaves
  ) {
    this.subscriptions = [
      this.targetEmitter,
      settings.onDidChange((event) => {
        if (SettingsService.affects(event, SettingKeys.quickNoteFile)) {
          this.targetEmitter.fire();
        }
      }),
      rootService.onDidChangeRoot(() => this.targetEmitter.fire()),
    ];
  }

  dispose(): void {
    vscode.Disposable.from(...this.subscriptions).dispose();
  }

  /**
   * Saves the text on the clipboard as a note, through the same queue as every other note.
   * @returns the file the note was added to, relative to the notes folder.
   * @throws EmptyClipboardError when the clipboard holds no text.
   */
  async appendClipboard(): Promise<string> {
    const text = await vscode.env.clipboard.readText();
    if (text.trim().length === 0) {
      throw new EmptyClipboardError();
    }
    return this.append(text);
  }

  /**
   * The file notes go to, as a path relative to the notes folder (what the user should see): the file of
   * the chosen category while the Advanced mode is on, otherwise the Quick Note file.
   */
  getTargetPath(): string {
    const categoryFile = this.labels.activeCategoryFile;
    try {
      const target =
        categoryFile === undefined
          ? this.resolveTarget()
          : this.pathGuard.resolveRelative(categoryFile);
      return this.pathGuard.getRelativePath(target) ?? this.settings.quickNoteFile;
    } catch {
      return categoryFile ?? this.settings.quickNoteFile; // No notes folder yet, or a file outside it.
    }
  }

  /**
   * Checks a path typed by the user for a new Quick Note file: inside the notes folder (relative,
   * `/` or `\` separators) and every part a valid name. The file may already exist.
   * @returns a message for `validateInput`, or undefined when the path is fine.
   */
  validateTargetPath(input: string): string | undefined {
    if (input.trim().length === 0) {
      return Strings.nameValidation.empty;
    }
    if (/^([\\/]|[A-Za-z]:)/.test(input)) {
      return Strings.quickNote.pathMustBeRelative;
    }
    const parts = input.split(/[\\/]/);
    if (isEncryptedName(parts[parts.length - 1])) {
      return Strings.encryption.cannotWriteInto;
    }
    for (const part of parts) {
      const problem = this.nameValidator.validate(part);
      if (problem) {
        return problem;
      }
    }
    return undefined;
  }

  /** Cleans a path that passed {@link validateTargetPath}: `/` separators and the default extension. */
  normalizeTargetPath(input: string): string {
    const parts = input.split(/[\\/]/);
    const last = parts.length - 1;
    if (!parts[last].includes(".")) {
      parts[last] += this.settings.defaultExtension;
    }
    return parts.join("/");
  }

  /**
   * Appends a note. Resolves when it is written, rejects (with a message safe to show) when it is not.
   * The text is trimmed at the end; a note with no visible text is ignored.
   * @returns the file the note was added to, relative to the notes folder ('' for an ignored note).
   * @throws CategoryFileError when the file linked to the chosen category is not inside the notes folder.
   */
  append(text: string): Promise<string> {
    const now = new Date(); // The heading shows when the note was written, not when the queue got to it.
    const task = this.queue.then(() => this.write(text, now));
    this.queue = task.catch(() => undefined);
    return task;
  }

  /**
   * Adds text to the end of a note of the notes folder as it is (no heading, no tag line), separated from the old text by a
   * blank line. It is the paste half of "Move to…". The file is created when it does not exist.
   * @param relativePath the note, relative to the notes folder.
   * @returns the path of the note, relative to the notes folder.
   * @throws OutsideRootError when the path leaves the notes folder.
   */
  appendText(relativePath: string, text: string): Promise<string> {
    const task = this.queue.then(() => this.writeText(relativePath, text));
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async writeText(relativePath: string, text: string): Promise<string> {
    if (isEncryptedName(relativePath)) {
      throw new EncryptionRefusedError(Strings.encryption.cannotWriteInto);
    }
    if (text.trim().length === 0) {
      return "";
    }
    const root = await this.requireExistingRoot();
    const target = this.pathGuard.resolveRelative(relativePath);
    this.pathGuard.assertInsideRoot(target, { allowRoot: false });
    // No heading and a template that is only {tags}: the text goes in unchanged.
    const note: NoteToWrite = {
      text,
      heading: "",
      tags: [],
      headingLevel: "##",
      tagLine: "{tags}",
      position: "end",
    };
    const openDocument = vscode.workspace.textDocuments.find((doc) =>
      this.pathGuard.isSame(doc.uri, target)
    );
    if (openDocument) {
      await this.appendToOpenDocument(openDocument, note);
    } else {
      await this.appendToFile(root, target, note);
    }
    const written = this.pathGuard.getRelativePath(target) ?? relativePath;
    this.logger.info(`Moved text into ${written}.`);
    return written;
  }

  private async write(text: string, now: Date): Promise<string> {
    if (text.trim().length === 0) {
      return "";
    }
    const root = await this.requireExistingRoot();
    // Read now, not remembered: the category file may have been changed since the box showed it.
    // The chosen category, or the one whose keyword the note contains (only in the Advanced mode).
    const destination = await this.labels.getDestinationFor(text);
    const target =
      destination.file === undefined
        ? this.resolveTarget()
        : this.resolveCategoryTarget(destination.file, destination.category);
    const heading = this.formatter.format(now, this.settings.quickNoteTimestampFormat);
    // The chosen tags first, then the ones whose keyword the note contains, each once.
    const tags = uniqueNames([...this.labels.activeTags, ...(await this.labels.autoTagsFor(text))]);
    const headingLevel = this.settings.quickNoteHeadingLevel;
    const tagLine = this.settings.quickNoteTagLine;
    const position = this.settings.quickNotePosition;
    const note = { text, heading, tags, headingLevel, tagLine, position };
    const relativePath = this.pathGuard.getRelativePath(target) ?? "";

    const openDocument = vscode.workspace.textDocuments.find((doc) =>
      this.pathGuard.isSame(doc.uri, target)
    );
    if (openDocument) {
      await this.appendToOpenDocument(openDocument, note);
      this.logger.info(`Added a Quick Note to ${relativePath} (open in an editor).`);
    } else {
      await this.appendToFile(root, target, note);
      this.logger.info(`Added a Quick Note to ${relativePath}.`);
    }
    return relativePath;
  }

  /** Open in an editor: edit the buffer, so undo works and there is no "file is newer" conflict. */
  private async appendToOpenDocument(
    document: vscode.TextDocument,
    note: NoteToWrite
  ): Promise<void> {
    const wasDirty = document.isDirty;
    const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const existing = document.getText();
    const { position, ...content } = note;

    const edit = new vscode.WorkspaceEdit();
    if (existing.length === 0 && this.settings.noteHeader.length > 0) {
      // An empty file: the header first, then the note, in one insertion at the start.
      const header = headerBlock(this.settings.noteHeader, eol);
      const whole =
        position === "start"
          ? (() => {
              const insertion = buildStartInsertion({ existing: header, eol, ...content });
              return (
                header.slice(0, insertion.offset) + insertion.text + header.slice(insertion.offset)
              );
            })()
          : header + buildAddition({ existing: header, eol, ...content });
      edit.insert(document.uri, new vscode.Position(0, 0), whole);
    } else if (position === "start") {
      const insertion = buildStartInsertion({ existing, eol, ...content });
      edit.insert(document.uri, document.positionAt(insertion.offset), insertion.text);
    } else {
      const addition = buildAddition({ existing, eol, ...content });
      edit.insert(document.uri, document.lineAt(document.lineCount - 1).range.end, addition);
    }
    if (!(await vscode.workspace.applyEdit(edit))) {
      throw new Error("The editor did not accept the edit.");
    }
    // Unsaved changes of the user stay unsaved. A clean file is saved again, as if nothing happened.
    if (!wasDirty && !(await this.internalSaves.during(document.uri, () => document.save()))) {
      this.logger.warn(
        "The Quick Note was added to the open editor but the file could not be saved."
      );
    }
  }

  /** Not open: read, compute, write. Always re-read, never cached. */
  private async appendToFile(
    root: vscode.Uri,
    target: vscode.Uri,
    note: NoteToWrite
  ): Promise<void> {
    let existing = "";
    let isNew = false;
    try {
      existing = decoder.decode(await vscode.workspace.fs.readFile(target));
    } catch (error) {
      if (!(error instanceof vscode.FileSystemError && error.code === "FileNotFound")) {
        throw error;
      }
      isNew = true;
    }
    const eol = existing.includes("\r\n")
      ? "\r\n"
      : isNew || existing.length === 0
        ? this.defaultEol(root)
        : "\n";
    if (isNew) {
      await vscode.workspace.fs.createDirectory(parentOf(target)); // The setting may name subfolders.
    }
    // A new or empty file starts with the header of the notes folder (when there is one); the note follows below it.
    if (existing.length === 0) {
      existing = headerBlock(this.settings.noteHeader, eol);
    }
    // Read then write: another VS Code window appending in between could lose a note.
    // The window is a few milliseconds and the file is small, so this is accepted.
    const { position, ...content } = note;
    let updated: string;
    if (position === "start") {
      const insertion = buildStartInsertion({ existing, eol, ...content });
      updated =
        existing.slice(0, insertion.offset) + insertion.text + existing.slice(insertion.offset);
    } else {
      updated = existing + buildAddition({ existing, eol, ...content });
    }
    await vscode.workspace.fs.writeFile(target, encoder.encode(updated));
  }

  /** Writing into a root that vanished (unplugged drive) would silently recreate it, so check first. */
  private async requireExistingRoot(): Promise<vscode.Uri> {
    const root = this.rootService.getRootUri();
    if (!root) {
      throw new RootMissingError(Strings.root.noRootSelected);
    }
    try {
      const stat = await vscode.workspace.fs.stat(root);
      if ((stat.type & vscode.FileType.Directory) !== 0) {
        return root;
      }
    } catch {
      // Falls through to the error below.
    }
    throw new RootMissingError(Strings.root.notFound);
  }

  /**
   * The file linked to the chosen category. Unlike the Quick Note setting there is no quiet fallback:
   * writing a category's notes into another file would be a surprise, so a bad path is an error.
   */
  private resolveCategoryTarget(relativePath: string, category: string): vscode.Uri {
    try {
      const target = this.pathGuard.resolveRelative(relativePath);
      this.pathGuard.assertInsideRoot(target, { allowRoot: false });
      return target;
    } catch {
      throw new CategoryFileError(category);
    }
  }

  /** The configured file, or the default one when the setting points outside the root. */
  private resolveTarget(): vscode.Uri {
    const configured = this.settings.quickNoteFile;
    try {
      const target = this.pathGuard.resolveRelative(configured);
      this.pathGuard.assertInsideRoot(target, { allowRoot: false });
      return target;
    } catch {
      if (this.reportedInvalidFile !== configured) {
        this.reportedInvalidFile = configured;
        this.logger.warn(
          `The Quick Note file setting "${configured}" is not inside the notes folder. Using "${SettingDefaults.quickNoteFile}".`
        );
      }
      return this.pathGuard.resolveRelative(SettingDefaults.quickNoteFile);
    }
  }

  /** A new or empty file follows `files.eol`; LF unless the user asked for CRLF. */
  private defaultEol(root: vscode.Uri): "\n" | "\r\n" {
    return defaultLineEnding(root);
  }
}
