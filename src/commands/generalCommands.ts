import * as vscode from "vscode";
import { BuiltinCommands, Commands } from "../constants/commands";
import { Logger } from "../services/Logger";
import { registerSafeCommand } from "./safe";

export function registerGeneralCommands(context: vscode.ExtensionContext, logger: Logger): void {
  registerSafeCommand(context, logger, Commands.focus, async () => {
    await vscode.commands.executeCommand(BuiltinCommands.openSidebar);
  });

  registerSafeCommand(context, logger, Commands.showLogs, () => {
    logger.show();
  });
}
