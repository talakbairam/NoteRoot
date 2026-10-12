import * as vscode from "vscode";

/** The file behind an editor tab, or undefined for tabs that are not a single file (diffs, terminals...). */
export function uriOfTab(tab: vscode.Tab): vscode.Uri | undefined {
  const input = tab.input;
  if (
    input instanceof vscode.TabInputText ||
    input instanceof vscode.TabInputCustom ||
    input instanceof vscode.TabInputNotebook
  ) {
    return input.uri;
  }
  return undefined;
}
