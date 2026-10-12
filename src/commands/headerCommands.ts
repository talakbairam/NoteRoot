import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { Strings } from "../constants/strings";
import { Logger } from "../services/Logger";
import { type HeaderResult, NoteHeaderService } from "../services/NoteHeaderService";
import { PathGuard } from "../services/PathGuard";
import { planEntryInsertion } from "../services/NoteHeader";
import { buildEntryHead } from "../services/QuickNoteService";
import { SettingsService } from "../services/SettingsService";
import { TimestampFormatter } from "../services/TimestampFormatter";
import { NoteItem } from "../tree/NoteItem";
import { TreeNavigator } from "../tree/TreeNavigator";
import { showStatus } from "../util/status";
import { registerSafeCommand } from "./safe";

export interface HeaderCommandDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  pathGuard: PathGuard;
  headerService: NoteHeaderService;
  settings: SettingsService;
  navigator: TreeNavigator;
}

/** "Insert Header" on notes of the tree and on the note that is open in the editor, and "Add > Date and Tags" in the editor. */
export function registerHeaderCommands(deps: HeaderCommandDependencies): void {
  const { context, logger, pathGuard, headerService, settings, navigator } = deps;
  const formatter = new TimestampFormatter();
  const text = Strings.header;

  const report = (uris: readonly vscode.Uri[], results: readonly HeaderResult[]): void => {
    if (results.length > 0 && results.every((result) => result === "off")) {
      void vscode.window.showInformationMessage(text.noTemplate);
      return;
    }
    if (results.length === 1) {
      const file = pathGuard.getRelativePath(uris[0]) ?? uris[0].path;
      showStatus(
        results[0] === "added"
          ? text.added(file)
          : results[0] === "present"
            ? text.present(file)
            : text.skipped(file)
      );
      return;
    }
    const count = (status: HeaderResult): number =>
      results.filter((result) => result === status).length;
    void vscode.window.showInformationMessage(
      text.summary(count("added"), count("present"), count("skipped"))
    );
  };

  const run = async (uris: readonly vscode.Uri[]): Promise<void> => {
    const results: HeaderResult[] = [];
    for (const uri of uris) {
      results.push(await headerService.insertHeader(uri));
    }
    report(uris, results);
  };

  /** From a context menu VS Code passes the clicked item and all selected items of the view. */
  registerSafeCommand(
    context,
    logger,
    Commands.insertHeader,
    async (clicked?: unknown, selected?: unknown) => {
      const fromArgs = Array.isArray(selected)
        ? selected.filter((item) => item instanceof NoteItem)
        : [];
      const items =
        fromArgs.length > 0
          ? fromArgs
          : clicked instanceof NoteItem
            ? [clicked]
            : [...navigator.selection];
      const files = items.filter((item) => item.kind === "file");
      if (files.length > 0) {
        await run(files.map((item) => item.uri));
      }
    }
  );

  registerSafeCommand(context, logger, Commands.insertHeaderCurrentNote, async () => {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri) {
      void vscode.window.showInformationMessage(text.noEditor);
      return;
    }
    if (!pathGuard.isInsideRoot(uri, { allowRoot: false })) {
      void vscode.window.showInformationMessage(text.notInNotesFolder);
      return;
    }
    await run([uri]);
  });

  /**
   * "Add > Date and Tags" (editor menu): writes what a Quick Note starts with, the heading with the date and time and the tag
   * line (empty, for Run Tagging or the user to fill), where the cursor is, so the note can be written under it. On an empty
   * line it goes there; on a line with text it goes below that line, after a blank line. The cursor ends below the block.
   */
  registerSafeCommand(context, logger, Commands.addDateAndTags, async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showInformationMessage(text.noEditor);
      return;
    }
    const document = editor.document;
    if (!pathGuard.isInsideRoot(document.uri, { allowRoot: false })) {
      void vscode.window.showInformationMessage(text.notInNotesFolder);
      return;
    }
    const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const head = buildEntryHead({
      eol,
      heading: formatter.format(new Date(), settings.quickNoteTimestampFormat),
      headingLevel: settings.quickNoteHeadingLevel,
      tags: [],
      tagLine: settings.quickNoteTagLine,
    });
    if (head === "") {
      void vscode.window.showInformationMessage(text.nothingToAdd);
      return;
    }
    const line = document.lineAt(editor.selection.active.line);
    const lastLine = line.lineNumber === document.lineCount - 1;
    const plan = planEntryInsertion(line.isEmptyOrWhitespace, lastLine, head, eol);
    const at = plan.at === "lineStart" ? line.range.start : line.range.end;
    const insert = plan.text;
    const offset = document.offsetAt(at) + insert.length;
    if (!(await editor.edit((builder) => builder.insert(at, insert)))) {
      throw new Error("The editor did not accept the edit.");
    }
    const cursor = editor.document.positionAt(offset);
    editor.selection = new vscode.Selection(cursor, cursor);
    editor.revealRange(new vscode.Range(cursor, cursor));
  });
}
