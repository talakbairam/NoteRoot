import { defaultLineEnding } from "../util/lineEnding";
import { headerBlock } from "./NoteHeader";
import * as vscode from "vscode";
import { ConfigFile, SettingDefaults } from "../constants/settings";
import { InvalidMoveError, NameConflictError, TrashUnavailableError } from "../util/errors";
import { isFileNotFoundError } from "../util/fsErrors";
import { basename, parentOf } from "../util/uri";
import { Logger } from "./Logger";
import { NameValidator } from "./NameValidator";
import { PathGuard } from "./PathGuard";
import { SettingsService } from "./SettingsService";

export type ConflictDecision = "replace" | "skip" | "cancel";

/** Questions the service cannot answer itself. The UI layer supplies the answers. */
export interface MoveCallbacks {
  /** An item with the same name (compared case-insensitively) is already in the destination. */
  onConflict(name: string): Promise<ConflictDecision>;
  /** The Trash failed while clearing the way for a replacement: may the old item be deleted permanently? */
  confirmPermanentDelete(name: string): Promise<boolean>;
}

export interface MoveResult {
  /** New locations of the items that were moved. */
  moved: vscode.Uri[];
  skipped: number;
  failed: { name: string; error: unknown }[];
  /** The user chose to stop; the remaining items were left where they are. */
  cancelled: boolean;
}

/** One rename or move that can be undone: every pair is where an item was and where it went. */
interface UndoStep {
  moves: { from: vscode.Uri; to: vscode.Uri }[];
}

export interface UndoResult {
  /** Where the items are now, back at their old place. */
  restored: vscode.Uri[];
  failed: { name: string; error: unknown }[];
}

export interface ImportResult {
  /** Locations of the copies inside the notes folder. */
  imported: vscode.Uri[];
  skipped: number;
  failed: { name: string; error: unknown }[];
  /** The user chose to stop; the remaining items were not copied. */
  cancelled: boolean;
}

/**
 * The name of a copy: `note.md` becomes `note copy.md`, then `note copy 2.md`, and so on; a folder
 * becomes `Folder copy`. The first name that no sibling has (compared case-insensitively) is used.
 * A leading dot is not an extension (`.env` becomes `.env copy`).
 */
export function duplicateName(name: string, isFile: boolean, siblings: readonly string[]): string {
  const dot = isFile ? name.lastIndexOf(".") : -1;
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  const taken = new Set(siblings.map((sibling) => sibling.toLowerCase()));
  for (let number = 1; ; number++) {
    const candidate = `${base} copy${number === 1 ? "" : ` ${number}`}${extension}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}

/**
 * Creates, duplicates, renames, deletes and moves files and folders inside the notes root.
 * Everything goes through `workspace.fs` and PathGuard. It never shows UI:
 * problems are thrown as typed errors and questions are passed in as callbacks.
 */
export class FileOperationsService {
  /** The latest step is last. Kept in memory only: it is gone when VS Code closes. */
  private readonly undoSteps: UndoStep[] = [];

  constructor(
    private readonly pathGuard: PathGuard,
    private readonly validator: NameValidator,
    private readonly settings: SettingsService,
    private readonly logger: Logger
  ) {}

  // ----- names -----

  /** Names of the entries in a folder, for duplicate checks. */
  async listChildNames(folder: vscode.Uri): Promise<string[]> {
    this.pathGuard.assertInsideRoot(folder);
    const entries = await vscode.workspace.fs.readDirectory(folder);
    return entries.map(([name]) => name);
  }

  /** Adds the default extension when the name has none. `.env` and `todo.txt` are kept as they are. */
  finalFileName(name: string): string {
    return name.includes(".") ? name : `${name}${this.settings.defaultExtension}`;
  }

  /** Message for `validateInput`, or undefined when the name is fine. */
  validateNewFileName(name: string, siblings: readonly string[]): string | undefined {
    // An empty name must stay empty, otherwise the default extension would make it look valid.
    const candidate = name.trim().length === 0 ? name : this.finalFileName(name);
    return this.validator.validate(candidate, { siblings });
  }

  validateNewFolderName(name: string, siblings: readonly string[]): string | undefined {
    return this.validator.validate(name, { siblings });
  }

  validateRename(
    name: string,
    siblings: readonly string[],
    currentName: string
  ): string | undefined {
    return this.validator.validate(name, { siblings, currentName });
  }

  // ----- create -----

  /** Creates a file: empty, or with the header of the notes folder when there is one. @returns the URI of the new file. */
  async createFile(folder: vscode.Uri, name: string): Promise<vscode.Uri> {
    const fileName = this.finalFileName(name);
    const target = await this.prepareNewEntry(folder, fileName);
    // Not atomic: writeFile has no "fail if exists" mode, so the check above is the best available guard.
    const header = headerBlock(this.settings.noteHeader, defaultLineEnding(target));
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(header));
    this.logger.info(`Created file ${this.relative(target)}`);
    return target;
  }

  async createFolder(folder: vscode.Uri, name: string): Promise<vscode.Uri> {
    const target = await this.prepareNewEntry(folder, name);
    await vscode.workspace.fs.createDirectory(target);
    this.logger.info(`Created folder ${this.relative(target)}`);
    return target;
  }

  // ----- duplicate -----

  /**
   * Copies a file, or a folder with everything inside it, next to the original under a new name
   * (see {@link duplicateName}). Nothing is ever overwritten.
   * @returns the URI of the copy.
   */
  async duplicate(uri: vscode.Uri): Promise<vscode.Uri> {
    this.pathGuard.assertInsideRoot(uri, { allowRoot: false });
    const parent = parentOf(uri);
    const stat = await vscode.workspace.fs.stat(uri);
    const isFile = (stat.type & vscode.FileType.Directory) === 0;
    const siblings = await this.listChildNames(parent);
    const name = duplicateName(basename(uri), isFile, siblings);
    const target = await this.prepareNewEntry(parent, name);
    try {
      await vscode.workspace.fs.copy(uri, target, { overwrite: false });
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileExists") {
        throw new NameConflictError(name);
      }
      throw error;
    }
    this.logger.info(`Duplicated ${this.relative(uri)} as ${name}`);
    return target;
  }

  // ----- rename -----

  /** @returns the new URI. A case-only change such as `note.md` to `Note.md` is allowed. */
  async rename(uri: vscode.Uri, newName: string): Promise<vscode.Uri> {
    this.pathGuard.assertInsideRoot(uri, { allowRoot: false });
    const currentName = basename(uri);
    const parent = parentOf(uri);
    this.validator.assertValid(newName, {
      siblings: await this.listChildNames(parent),
      currentName,
    });
    if (newName === currentName) {
      return uri;
    }
    const target = vscode.Uri.joinPath(parent, newName);
    this.pathGuard.assertInsideRoot(target, { allowRoot: false });
    await this.renameKeepingEditors(uri, target);
    this.recordUndo([{ from: uri, to: target }]);
    this.logger.info(`Renamed ${this.relative(uri)} to ${newName}`);
    return target;
  }

  // ----- undo -----

  get canUndo(): boolean {
    return this.undoSteps.length > 0;
  }

  /** Forgets everything that could be undone, for example when another notes folder is chosen. */
  clearUndoHistory(): void {
    this.undoSteps.length = 0;
  }

  /**
   * Undoes the latest rename or move (all items of a drag together). Nothing is overwritten: an item
   * whose old name is taken now, whose old folder is gone, or that is no longer where it was left,
   * stays and is reported in `failed`. The step is removed in every case, so a step that cannot
   * be undone never blocks the ones before it.
   * @returns undefined when there is nothing to undo.
   */
  async undoLast(): Promise<UndoResult | undefined> {
    const step = this.undoSteps.pop();
    if (!step) {
      return undefined;
    }
    const result: UndoResult = { restored: [], failed: [] };
    // Last item first, the reverse of how the step was made.
    for (const { from, to } of [...step.moves].reverse()) {
      const name = basename(to);
      try {
        this.pathGuard.assertInsideRoot(from, { allowRoot: false });
        this.pathGuard.assertInsideRoot(to, { allowRoot: false });
        await vscode.workspace.fs.stat(to); // Throws when the item is not there any more.
        const folder = parentOf(from);
        const wanted = basename(from).toLowerCase();
        const sameFolder = this.pathGuard.isSame(folder, parentOf(to));
        const taken = (await this.listChildNames(folder)).some(
          // In the same folder the item itself may match: a rename that only changed the case.
          (entry) => entry.toLowerCase() === wanted && !(sameFolder && entry === basename(to))
        );
        if (taken) {
          throw new NameConflictError(basename(from));
        }
        await this.renameKeepingEditors(to, from);
        this.logger.info(`Undid: ${this.relative(to)} back to ${this.relative(from)}`);
        result.restored.push(from);
      } catch (error) {
        this.logger.warn(`Could not undo for ${name}.`);
        result.failed.push({ name, error });
      }
    }
    return result;
  }

  private recordUndo(moves: UndoStep["moves"]): void {
    if (moves.length > 0) {
      this.undoSteps.push({ moves });
      if (this.undoSteps.length > this.settings.undoSteps) {
        this.undoSteps.shift();
      }
    }
  }

  // ----- delete -----

  /** @throws TrashUnavailableError when the Trash cannot be used. Nothing is deleted then. */
  async deleteToTrash(uri: vscode.Uri): Promise<void> {
    this.pathGuard.assertInsideRoot(uri, { allowRoot: false });
    const recursive = !(await this.isSymbolicLink(uri));
    try {
      await vscode.workspace.fs.delete(uri, { recursive, useTrash: true });
    } catch (error) {
      if (isFileNotFoundError(error)) {
        throw error;
      }
      throw new TrashUnavailableError(error);
    }
    this.logger.info(`Moved ${this.relative(uri)} to the Trash`);
  }

  /** Only call this after the user explicitly agreed. */
  async deletePermanently(uri: vscode.Uri): Promise<void> {
    this.pathGuard.assertInsideRoot(uri, { allowRoot: false });
    const recursive = !(await this.isSymbolicLink(uri));
    await vscode.workspace.fs.delete(uri, { recursive, useTrash: false });
    this.logger.info(`Deleted ${this.relative(uri)} permanently`);
  }

  // ----- move -----

  /**
   * Checks a planned move and returns the items that really have to move:
   * nested items are dropped (the parent carries them) and so are items already in the destination.
   * @throws InvalidMoveError for a folder moved into itself or one of its descendants.
   */
  planMove(sources: readonly vscode.Uri[], targetFolder: vscode.Uri): vscode.Uri[] {
    this.pathGuard.assertInsideRoot(targetFolder);
    for (const source of sources) {
      this.pathGuard.assertInsideRoot(source, { allowRoot: false });
      if (this.pathGuard.isSameOrInside(source, targetFolder)) {
        throw new InvalidMoveError(basename(source));
      }
    }
    return this.pathGuard
      .removeNested(sources)
      .filter((source) => !this.pathGuard.isSame(parentOf(source), targetFolder));
  }

  /** Moves items one by one. Failures of single items do not stop the others. */
  async moveItems(
    sources: readonly vscode.Uri[],
    targetFolder: vscode.Uri,
    callbacks: MoveCallbacks
  ): Promise<MoveResult> {
    const planned = this.planMove(sources, targetFolder);
    const result: MoveResult = {
      moved: [],
      skipped: sources.length - planned.length,
      failed: [],
      cancelled: false,
    };

    const done: UndoStep["moves"] = [];
    for (const source of planned) {
      const name = basename(source);
      try {
        // Listed again for every item, so two dragged items with the same name also conflict.
        const existing = (await this.listChildNames(targetFolder)).find(
          (entry) => entry.toLowerCase() === name.toLowerCase()
        );
        if (existing !== undefined) {
          const decision = await callbacks.onConflict(name);
          if (decision === "cancel") {
            result.cancelled = true;
            break;
          }
          if (
            decision === "skip" ||
            !(await this.clearForReplacement(
              vscode.Uri.joinPath(targetFolder, existing),
              source,
              callbacks
            ))
          ) {
            result.skipped++;
            continue;
          }
        }
        const target = vscode.Uri.joinPath(targetFolder, name);
        await this.renameKeepingEditors(source, target);
        this.logger.info(`Moved ${this.relative(source)} to ${this.relative(target)}`);
        result.moved.push(target);
        done.push({ from: source, to: target });
      } catch (error) {
        this.logger.error(`Could not move ${this.relative(source)}.`, error);
        result.failed.push({ name, error });
      }
    }
    this.recordUndo(done);
    return result;
  }

  // ----- import -----

  /**
   * Copies files and folders from outside the notes folder into `targetFolder` (a drop from the
   * operating system). The originals stay where they are. Items that are already inside the notes
   * folder are skipped (they are moved by dragging inside the tree), and so is a folder that
   * contains the destination, which would be copied into itself.
   * Conflicts and failures work like in {@link moveItems}.
   */
  async importItems(
    sources: readonly vscode.Uri[],
    targetFolder: vscode.Uri,
    callbacks: MoveCallbacks
  ): Promise<ImportResult> {
    this.pathGuard.assertInsideRoot(targetFolder);
    const result: ImportResult = { imported: [], skipped: 0, failed: [], cancelled: false };

    for (const source of this.pathGuard.removeNested(sources)) {
      const name = basename(source);
      try {
        if (
          this.pathGuard.isInsideRoot(source) ||
          this.pathGuard.isSameOrInside(source, targetFolder)
        ) {
          result.skipped++;
          continue;
        }
        if (this.isConfigFolder(targetFolder, name)) {
          throw new InvalidMoveError(name);
        }
        this.validator.assertValid(name);
        const existing = (await this.listChildNames(targetFolder)).find(
          (entry) => entry.toLowerCase() === name.toLowerCase()
        );
        if (existing !== undefined) {
          const decision = await callbacks.onConflict(name);
          if (decision === "cancel") {
            result.cancelled = true;
            break;
          }
          if (
            decision === "skip" ||
            !(await this.clearForReplacement(
              vscode.Uri.joinPath(targetFolder, existing),
              source,
              callbacks
            ))
          ) {
            result.skipped++;
            continue;
          }
        }
        const target = vscode.Uri.joinPath(targetFolder, name);
        this.pathGuard.assertInsideRoot(target, { allowRoot: false });
        await vscode.workspace.fs.copy(source, target, { overwrite: false });
        this.logger.info(`Imported ${name} into ${this.relative(targetFolder) || "."}`);
        result.imported.push(target);
      } catch (error) {
        this.logger.error(`Could not import ${name}.`, error);
        result.failed.push({ name, error });
      }
    }
    return result;
  }

  // ----- Quick Note file -----

  /** The Quick Note file as configured; an unusable setting falls back to the default file. */
  getQuickNoteUri(): vscode.Uri | undefined {
    try {
      return this.pathGuard.resolveRelative(this.settings.quickNoteFile);
    } catch {
      try {
        return this.pathGuard.resolveRelative(SettingDefaults.quickNoteFile);
      } catch {
        return undefined; // No root.
      }
    }
  }

  get quickNoteFilePath(): string {
    return this.settings.quickNoteFile;
  }

  isQuickNoteFile(uri: vscode.Uri): boolean {
    const quickNote = this.getQuickNoteUri();
    return quickNote !== undefined && this.pathGuard.isSame(quickNote, uri);
  }

  /** True for the Quick Note file itself and for any folder that contains it. */
  involvesQuickNoteFile(uri: vscode.Uri): boolean {
    const quickNote = this.getQuickNoteUri();
    return quickNote !== undefined && this.pathGuard.isSameOrInside(uri, quickNote);
  }

  // ----- internals -----

  private async prepareNewEntry(folder: vscode.Uri, name: string): Promise<vscode.Uri> {
    this.pathGuard.assertInsideRoot(folder);
    // Checked against a fresh listing, because the user may have typed the name a while ago.
    this.validator.assertValid(name, { siblings: await this.listChildNames(folder) });
    const target = vscode.Uri.joinPath(folder, name);
    this.pathGuard.assertInsideRoot(target, { allowRoot: false });
    return target;
  }

  /** Moves the item that is in the way to the Trash. Returns false when the user refused a permanent delete. */
  private async clearForReplacement(
    existing: vscode.Uri,
    source: vscode.Uri,
    callbacks: MoveCallbacks
  ): Promise<boolean> {
    // Replacing a folder that contains the moved item would delete the item itself.
    if (this.pathGuard.isSameOrInside(existing, source)) {
      throw new InvalidMoveError(basename(source));
    }
    try {
      await this.deleteToTrash(existing);
      return true;
    } catch (error) {
      if (!(error instanceof TrashUnavailableError)) {
        throw error;
      }
    }
    if (!(await callbacks.confirmPermanentDelete(basename(existing)))) {
      return false;
    }
    await this.deletePermanently(existing);
    return true;
  }

  /** Uses a WorkspaceEdit so that open editors follow the new name; falls back to a plain rename. */
  async renameKeepingEditors(from: vscode.Uri, to: vscode.Uri): Promise<void> {
    this.pathGuard.assertInsideRoot(from, { allowRoot: false });
    this.pathGuard.assertInsideRoot(to, { allowRoot: false });
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(from, to, { overwrite: false });
    if (await vscode.workspace.applyEdit(edit)) {
      return;
    }
    try {
      await vscode.workspace.fs.rename(from, to, { overwrite: false });
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileExists") {
        throw new NameConflictError(basename(to));
      }
      throw error;
    }
  }

  /** The technical `.noteroot` folder of the root must not be replaced by an imported item. */
  private isConfigFolder(folder: vscode.Uri, name: string): boolean {
    return (
      this.pathGuard.getRelativePath(folder) === "" && name.toLowerCase() === ConfigFile.dirName
    );
  }

  private async isSymbolicLink(uri: vscode.Uri): Promise<boolean> {
    try {
      return PathGuard.isSymbolicLink((await vscode.workspace.fs.stat(uri)).type);
    } catch {
      return false;
    }
  }

  private relative(uri: vscode.Uri): string {
    return this.pathGuard.getRelativePath(uri) ?? basename(uri);
  }
}
