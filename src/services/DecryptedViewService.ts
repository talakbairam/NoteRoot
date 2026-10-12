import * as vscode from "vscode";

/** The scheme of the read-only documents that show a decrypted note. */
export const DECRYPTED_SCHEME = "noteroot-decrypted";

/**
 * Shows a decrypted note for reading: a read-only document that lives only in memory. It is not a file, so nothing is written to
 * the disk, and when the editor tab is closed the text is forgotten.
 */
export class DecryptedViewService implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly texts = new Map<string, string>();
  private readonly subscription: vscode.Disposable;
  private counter = 0;

  constructor() {
    this.subscription = vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.scheme === DECRYPTED_SCHEME) {
        this.texts.delete(document.uri.query);
      }
    });
  }

  /** Keeps the text and gives the address of the document that shows it (its name carries the original extension). */
  add(name: string, text: string): vscode.Uri {
    const id = String(++this.counter);
    this.texts.set(id, text);
    return vscode.Uri.from({ scheme: DECRYPTED_SCHEME, path: `/${name}`, query: id });
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.texts.get(uri.query) ?? "";
  }

  dispose(): void {
    this.subscription.dispose();
    this.texts.clear();
  }
}
