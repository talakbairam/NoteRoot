import * as vscode from "vscode";

/**
 * The saves NoteRoot makes itself (a Quick Note written into a note that is open, Run Tagging). The tagging that runs when
 * a note is saved by the user must not run for these: it would tag a file again that was just tagged or written. A save
 * made by code looks like any other save to VS Code, so the places that save mark the file while they do.
 */
export class InternalSaves {
  private readonly active = new Map<string, number>();

  /** Runs `action` (which saves `uri`) and marks the file as being saved by NoteRoot while it runs. */
  async during<T>(uri: vscode.Uri, action: () => Thenable<T>): Promise<T> {
    const key = uri.toString();
    this.active.set(key, (this.active.get(key) ?? 0) + 1);
    try {
      return await action();
    } finally {
      const left = (this.active.get(key) ?? 1) - 1;
      if (left <= 0) {
        this.active.delete(key);
      } else {
        this.active.set(key, left);
      }
    }
  }

  isActive(uri: vscode.Uri): boolean {
    return this.active.has(uri.toString());
  }
}
