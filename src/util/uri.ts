import * as vscode from "vscode";

/** Last segment of the path: the file or folder name. */
export function basename(uri: vscode.Uri): string {
  return uri.path.slice(uri.path.lastIndexOf("/") + 1);
}

/** The folder that contains `uri`. */
export function parentOf(uri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(uri, "..");
}
