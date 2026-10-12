import * as vscode from "vscode";

/** The line ending for a file that does not exist yet: the setting `files.eol` when it names one, otherwise `\n`. */
export function defaultLineEnding(root: vscode.Uri): "\n" | "\r\n" {
  return vscode.workspace.getConfiguration("files", root).get<string>("eol") === "\r\n"
    ? "\r\n"
    : "\n";
}
