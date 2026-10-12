import * as vscode from "vscode";

/** The scheme of the read-only documents that show a file as it is online. */
export const ONLINE_SCHEME = "noteroot-online";

/**
 * Shows a file as it is online (in the repository), for reading and for the diff of the Actions panel: a read-only document that
 * lives only in memory. It is not a file, so nothing is written to the disk, and when the editor tab is closed the text is
 * forgotten.
 */
export class OnlineViewService implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly texts = new Map<string, string>();
  private readonly subscription: vscode.Disposable;
  private counter = 0;

  constructor() {
    this.subscription = vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.scheme === ONLINE_SCHEME) {
        this.texts.delete(document.uri.query);
      }
    });
  }

  /** Keeps the text and gives the address of the document that shows it (its path ends with the real name, so the language is found). */
  add(path: string, text: string): vscode.Uri {
    const id = String(++this.counter);
    this.texts.set(id, text);
    return vscode.Uri.from({ scheme: ONLINE_SCHEME, path: `/${path}`, query: id });
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.texts.get(uri.query) ?? "";
  }

  dispose(): void {
    this.subscription.dispose();
    this.texts.clear();
  }
}
