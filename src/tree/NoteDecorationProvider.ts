import * as vscode from "vscode";
import { MarkQuery } from "./NoteItem";

/**
 * Colours the name of the Notes tree rows that are marked "hidden" or "no tags". The mark travels in the query of the row's
 * `resourceUri` (see `NoteItem`), so only NoteRoot rows are coloured: the same file in the Explorer has no query and is left alone.
 * The decoration depends only on the URI, so no change event is needed when a switch is toggled (the rows get a new URI).
 */
export class NoteDecorationProvider implements vscode.FileDecorationProvider {
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.query === MarkQuery.marked) {
      return { color: new vscode.ThemeColor("list.warningForeground") };
    }
    if (uri.query === MarkQuery.encrypted) {
      return { color: new vscode.ThemeColor("gitDecoration.addedResourceForeground") };
    }
    return undefined;
  }
}
