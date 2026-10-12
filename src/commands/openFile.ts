import * as vscode from "vscode";
import { BuiltinCommands, Commands } from "../constants/commands";
import { Strings } from "../constants/strings";
import { Logger } from "../services/Logger";
import { isEncryptedName } from "../services/NoteCrypto";
import { PathGuard } from "../services/PathGuard";
import { SettingsService } from "../services/SettingsService";
import { formatBytes } from "../util/format";

const BYTES_PER_MB = 1024 * 1024;

export interface OpenFileDependencies {
  logger: Logger;
  pathGuard: PathGuard;
  settings: SettingsService;
}

export interface OpenFileOptions {
  preview: boolean;
  viewColumn?: vscode.ViewColumn;
}

/** Opens a file from the tree: checks the path, asks about large files, falls back to the system app. */
export async function openFile(
  deps: OpenFileDependencies,
  uri: vscode.Uri,
  options: OpenFileOptions
): Promise<void> {
  const { logger, pathGuard, settings } = deps;
  pathGuard.assertInsideRoot(uri, { allowRoot: false });

  if (isEncryptedName(uri.path)) {
    // Encrypted text is not shown as a file: ask for the key and show the note for reading.
    await vscode.commands.executeCommand(Commands.decryptView, uri);
    return;
  }
  if (!(await confirmLargeFile(uri, settings.largeFileThresholdMB))) {
    return;
  }
  try {
    await vscode.commands.executeCommand(BuiltinCommands.vscodeOpen, uri, options);
  } catch (error) {
    // VS Code has no viewer for this file: hand it to the operating system.
    logger.warn(
      `VS Code could not open "${pathGuard.getRelativePath(uri)}", trying the system app.`
    );
    if (!(await vscode.env.openExternal(uri))) {
      throw error;
    }
  }
}

/** Asks before opening a file larger than the threshold. `0` disables the check. */
async function confirmLargeFile(uri: vscode.Uri, thresholdMB: number): Promise<boolean> {
  if (thresholdMB <= 0) {
    return true;
  }
  let size: number;
  try {
    size = (await vscode.workspace.fs.stat(uri)).size;
  } catch {
    return true; // Let the open attempt report the real problem.
  }
  if (size <= thresholdMB * BYTES_PER_MB) {
    return true;
  }
  const choice = await vscode.window.showWarningMessage(
    Strings.tree.largeFileConfirm(formatBytes(size)),
    { modal: true },
    Strings.tree.openAnyway
  );
  return choice === Strings.tree.openAnyway;
}
