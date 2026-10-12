import * as vscode from "vscode";

/** True when a `workspace.fs` call failed because the entry does not exist. */
export function isFileNotFoundError(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === "FileNotFound";
}

/** True when a `workspace.fs` call failed because the entry already exists. */
export function isFileExistsError(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === "FileExists";
}

/** Turns anything thrown into a loggable message without losing the stack. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  return String(error);
}
