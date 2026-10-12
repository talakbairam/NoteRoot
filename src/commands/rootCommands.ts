import * as vscode from "vscode";
import { BuiltinCommands, Commands } from "../constants/commands";
import { RootStates } from "../constants/context";
import { Strings } from "../constants/strings";
import { ConfigService } from "../services/ConfigService";
import { Logger } from "../services/Logger";
import { RootFolderService } from "../services/RootFolderService";
import { RootMissingError } from "../util/errors";
import { offerSelectRoot } from "./dialogs";
import { registerSafeCommand } from "./safe";

export interface RootCommandDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  rootService: RootFolderService;
  configService: ConfigService;
}

export function registerRootCommands(deps: RootCommandDependencies): void {
  const { context, logger, rootService, configService } = deps;

  // "Change" is the same flow as "Select"; two titles exist only for discoverability.
  const selectRoot = async (): Promise<void> => {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: Strings.root.openDialogTitle,
      openLabel: Strings.root.openDialogLabel,
      defaultUri: rootService.getRootUri(),
    });
    if (picked?.[0]) {
      await rootService.setRootFolder(picked[0]);
    }
  };
  registerSafeCommand(context, logger, Commands.selectRootFolder, selectRoot);
  registerSafeCommand(context, logger, Commands.changeRootFolder, selectRoot);

  registerSafeCommand(context, logger, Commands.recreateRootFolder, async () => {
    await rootService.refresh();
    if (rootService.state !== RootStates.missing) {
      void vscode.window.showInformationMessage(Strings.root.recreateNotNeeded);
      return;
    }
    const root = rootService.getRootUri();
    if (!root) {
      throw new RootMissingError(Strings.root.invalidPath(rootService.configuredPath));
    }
    // Never create silently: an unplugged external drive would otherwise be hidden by a fresh empty folder.
    const choice = await vscode.window.showWarningMessage(
      Strings.root.recreateConfirm(root.fsPath),
      { modal: true, detail: Strings.root.recreateDetail },
      Strings.root.recreateAction
    );
    if (choice !== Strings.root.recreateAction) {
      return;
    }
    await rootService.createRootFolder();
    void vscode.window.showInformationMessage(Strings.root.recreated(root.fsPath));
  });

  registerSafeCommand(context, logger, Commands.revealRootInOS, async () => {
    const root = rootService.getRootUri();
    if (!root) {
      await offerSelectRoot(Strings.root.noRootSelected);
      return;
    }
    if (!rootService.hasRoot) {
      await offerSelectRoot(Strings.root.notFound);
      return;
    }
    await vscode.commands.executeCommand(BuiltinCommands.revealFileInOS, root);
  });

  // The notes folder as the workspace of a new window, to work in it with the Explorer, search and extensions.
  registerSafeCommand(context, logger, Commands.openRootInNewWindow, async () => {
    const root = rootService.getRootUri();
    if (!root || !rootService.hasRoot) {
      await offerSelectRoot(root ? Strings.root.notFound : Strings.root.noRootSelected);
      return;
    }
    await vscode.commands.executeCommand(BuiltinCommands.openFolder, root, {
      forceNewWindow: true,
    });
  });

  registerSafeCommand(context, logger, Commands.openConfigFile, async () => {
    const root = rootService.getRootUri();
    if (!root || !rootService.hasRoot) {
      await offerSelectRoot(root ? Strings.root.notFound : Strings.root.noRootSelected);
      return;
    }
    // Heals a missing file first so the command always has something to open.
    await configService.ensure(root);
    await vscode.window.showTextDocument(configService.getConfigUri(root));
  });
}
