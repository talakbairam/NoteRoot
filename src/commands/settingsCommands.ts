import * as vscode from "vscode";
import { BuiltinCommands, Commands } from "../constants/commands";
import { SETTINGS_SECTION } from "../constants/settings";
import { Logger } from "../services/Logger";
import type { SettingsPageProvider } from "../webview/SettingsPageProvider";
import { registerSafeCommand } from "./safe";

export interface SettingsCommandDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  settingsPage: SettingsPageProvider;
}

/** The commands that open the settings: the Settings page of NoteRoot, and the Settings editor of VS Code with the NoteRoot settings. */
export function registerSettingsCommands(deps: SettingsCommandDependencies): void {
  const { context, logger, settingsPage } = deps;

  // The argument (optional) is the group to show, for the pages and buttons that point at one setting.
  registerSafeCommand(context, logger, Commands.openSettingsPage, (section?: unknown) => {
    settingsPage.open(typeof section === "string" && section.length <= 30 ? section : undefined);
  });

  registerSafeCommand(context, logger, Commands.openAllSettings, async () => {
    await vscode.commands.executeCommand(BuiltinCommands.openSettings, SETTINGS_SECTION);
  });
}
