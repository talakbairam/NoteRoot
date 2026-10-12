import * as vscode from "vscode";
import { InternalSaves } from "./InternalSaves";
import { Logger } from "./Logger";
import { planHeader } from "./NoteHeader";
import { PathGuard } from "./PathGuard";
import { SearchService } from "./SearchService";
import { SettingsService } from "./SettingsService";

const encoder = new TextEncoder();

/**
 * `off`: the notes folder has no header template. `present`: the note has the header already. `skipped`: not a text note
 * (binary, unreadable or too big).
 */
export type HeaderResult = "added" | "present" | "skipped" | "off";

/** Puts the header of the notes folder (a setting) at the start of notes that were created without it. */
export class NoteHeaderService {
  constructor(
    private readonly pathGuard: PathGuard,
    private readonly searchService: SearchService,
    private readonly settings: SettingsService,
    private readonly internalSaves: InternalSaves,
    private readonly logger: Logger
  ) {}

  /** True when there is a header template. */
  get hasTemplate(): boolean {
    return this.settings.noteHeader.length > 0;
  }

  /**
   * @throws OutsideRootError when the note is not inside the notes folder.
   */
  async insertHeader(uri: vscode.Uri): Promise<HeaderResult> {
    const lines = this.settings.noteHeader;
    if (lines.length === 0) {
      return "off";
    }
    this.pathGuard.assertInsideRoot(uri, { allowRoot: false });
    const relativePath = this.pathGuard.getRelativePath(uri) ?? uri.path;
    const open = vscode.workspace.textDocuments.find((doc) => this.pathGuard.isSame(doc.uri, uri));
    const text = open ? open.getText() : await this.searchService.readText(uri);
    if (text === undefined) {
      this.logger.info(`Insert Header skipped ${relativePath} (not a text note).`);
      return "skipped";
    }
    const eol = open
      ? open.eol === vscode.EndOfLine.CRLF
        ? "\r\n"
        : "\n"
      : text.includes("\r\n")
        ? "\r\n"
        : "\n";
    const plan = planHeader(text, lines, eol);
    if (!plan) {
      return "present";
    }

    if (open) {
      const wasDirty = open.isDirty;
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, open.positionAt(plan.offset), plan.text);
      if (!(await vscode.workspace.applyEdit(edit))) {
        throw new Error("The editor did not accept the edit.");
      }
      // Unsaved changes of the user stay unsaved. A clean file is saved again, as if nothing happened.
      if (!wasDirty && !(await this.internalSaves.during(uri, () => open.save()))) {
        this.logger.warn(
          `The header was added to ${relativePath} in the editor but the file could not be saved.`
        );
      }
    } else {
      // Read, change, write: a change made between the read and the write is lost, as with the tagging.
      await vscode.workspace.fs.writeFile(
        uri,
        encoder.encode(text.slice(0, plan.offset) + plan.text + text.slice(plan.offset))
      );
    }
    this.logger.info(`Added the header to ${relativePath}.`);
    return "added";
  }
}
