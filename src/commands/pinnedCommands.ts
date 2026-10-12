import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { Logger } from "../services/Logger";
import { PinnedNotesService } from "../services/PinnedNotesService";
import { NoteItem } from "../tree/NoteItem";
import { registerSafeCommand } from "./safe";

export interface PinnedCommandDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  pinnedService: PinnedNotesService;
}

export function registerPinnedCommands(deps: PinnedCommandDependencies): void {
  const { context, logger, pinnedService } = deps;

  /** From a context menu VS Code passes the clicked item and all selected items of that view. */
  const filesOf = (clicked: unknown, selected: unknown): NoteItem[] => {
    const fromArgs = Array.isArray(selected)
      ? selected.filter((item) => item instanceof NoteItem)
      : [];
    const items = fromArgs.length > 0 ? fromArgs : clicked instanceof NoteItem ? [clicked] : [];
    return items.filter((item) => item.kind === "file");
  };

  registerSafeCommand(
    context,
    logger,
    Commands.pinNote,
    async (clicked?: unknown, selected?: unknown) => {
      const files = filesOf(clicked, selected);
      if (files.length > 0) {
        await pinnedService.pin(files.map((item) => item.relativePath));
      }
    }
  );

  registerSafeCommand(
    context,
    logger,
    Commands.unpinNote,
    async (clicked?: unknown, selected?: unknown) => {
      const files = filesOf(clicked, selected);
      if (files.length > 0) {
        await pinnedService.unpin(files.map((item) => item.relativePath));
      }
    }
  );
}
