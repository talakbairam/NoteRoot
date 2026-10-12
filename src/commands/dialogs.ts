import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { Strings } from "../constants/strings";
import type { ConflictDecision } from "../services/FileOperationsService";

/** Modal questions shared by the commands and drag and drop. Each returns what the user decided. */

/** Warns that a rename or move affects the Quick Note file (or the folder holding it). */
export async function confirmQuickNoteChange(
  action: "rename" | "move",
  isFolder: boolean,
  quickNoteFile: string
): Promise<boolean> {
  const texts = Strings.fileOps;
  const message =
    action === "rename"
      ? isFolder
        ? texts.quickNoteFolderRename(quickNoteFile)
        : texts.quickNoteFileRename(quickNoteFile)
      : isFolder
        ? texts.quickNoteFolderMove(quickNoteFile)
        : texts.quickNoteFileMove(quickNoteFile);
  const label = action === "rename" ? texts.renameAnywayAction : texts.moveAnywayAction;
  const choice = await vscode.window.showWarningMessage(
    message,
    { modal: true, detail: texts.quickNoteSettingHint },
    label
  );
  return choice === label;
}

/** Shows a warning with a "Select Notes Folder" button that starts the folder selection. */
export async function offerSelectRoot(message: string): Promise<void> {
  const choice = await vscode.window.showWarningMessage(message, Strings.root.selectFolderAction);
  if (choice === Strings.root.selectFolderAction) {
    await vscode.commands.executeCommand(Commands.selectRootFolder);
  }
}

/** Second, separate question after the Trash failed. Never skipped. */
export async function confirmPermanentDelete(count: number): Promise<boolean> {
  const action = Strings.fileOps.deletePermanentlyAction;
  const choice = await vscode.window.showWarningMessage(
    Strings.fileOps.trashUnavailable(count),
    { modal: true },
    action
  );
  return choice === action;
}

/** Replace / Skip / Cancel. With a single item "Skip" would equal "Cancel", so it is not offered. */
export async function askMoveConflict(
  name: string,
  multipleItems: boolean
): Promise<ConflictDecision> {
  const { replaceAction, skipAction, moveConflict, moveConflictDetail } = Strings.fileOps;
  const buttons = multipleItems ? [replaceAction, skipAction] : [replaceAction];
  const choice = await vscode.window.showWarningMessage(
    moveConflict(name),
    { modal: true, detail: moveConflictDetail },
    ...buttons
  );
  if (choice === replaceAction) {
    return "replace";
  }
  return choice === skipAction ? "skip" : "cancel";
}
