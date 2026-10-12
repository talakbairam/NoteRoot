import * as vscode from "vscode";
import { BuiltinCommands } from "../constants/commands";
import { RootStates, StateKeys, WALKTHROUGH_ID } from "../constants/context";
import { RootFolderService } from "../services/RootFolderService";

/**
 * Opens the Get Started walkthrough once, on the first start with no notes folder.
 * Never repeated afterwards; the user can always reopen it from the Welcome page.
 */
export async function showWalkthroughOnFirstRun(
  context: vscode.ExtensionContext,
  rootService: RootFolderService
): Promise<void> {
  if (
    context.globalState.get<boolean>(StateKeys.walkthroughShown) ||
    rootService.state !== RootStates.noRoot
  ) {
    return;
  }
  // Marked first: if opening fails or is interrupted, the user is still not nagged again.
  await context.globalState.update(StateKeys.walkthroughShown, true);
  await vscode.commands.executeCommand(
    BuiltinCommands.openWalkthrough,
    `${context.extension.id}#${WALKTHROUGH_ID}`,
    false
  );
}
