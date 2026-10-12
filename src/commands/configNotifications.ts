import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { Strings } from "../constants/strings";
import { ConfigIssue, ConfigService } from "../services/ConfigService";
import { Logger } from "../services/Logger";

/** Shows a warning with an "Open Config File" action whenever ConfigService reports a problem. */
export function registerConfigNotifications(
  context: vscode.ExtensionContext,
  configService: ConfigService,
  logger: Logger
): void {
  context.subscriptions.push(
    configService.onDidReportIssue((issue) => {
      showIssue(issue).catch((error: unknown) =>
        logger.error("Could not show the config warning.", error)
      );
    })
  );
}

async function showIssue(issue: ConfigIssue): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    Strings.config[issue.kind],
    Strings.config.openConfigAction
  );
  if (choice === Strings.config.openConfigAction) {
    await vscode.commands.executeCommand(Commands.openConfigFile);
  }
}
