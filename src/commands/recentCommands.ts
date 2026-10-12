import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { Logger } from "../services/Logger";
import { RecentNotesService } from "../services/RecentNotesService";
import { NoteItem } from "../tree/NoteItem";
import { TreeNavigator } from "../tree/TreeNavigator";
import { registerSafeCommand } from "./safe";

export interface RecentCommandDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  recentService: RecentNotesService;
  navigator: TreeNavigator;
}

export function registerRecentCommands(deps: RecentCommandDependencies): void {
  const { context, logger, recentService, navigator } = deps;

  registerSafeCommand(context, logger, Commands.clearRecent, () => {
    recentService.clear();
  });

  registerSafeCommand(context, logger, Commands.removeFromRecent, (item?: unknown) => {
    if (item instanceof NoteItem) {
      recentService.remove(item.relativePath);
    }
  });

  registerSafeCommand(context, logger, Commands.revealInTree, async (item?: unknown) => {
    if (item instanceof NoteItem) {
      await navigator.reveal(item.uri, { focus: true });
    }
  });
}
