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
  favoritesService: PinnedNotesService;
}

export function registerPinnedCommands(deps: PinnedCommandDependencies): void {
  const { context, logger, pinnedService, favoritesService } = deps;

  /** From a context menu VS Code passes the clicked item and all selected items of that view. */
  const filesOf = (clicked: unknown, selected: unknown): NoteItem[] => {
    const fromArgs = Array.isArray(selected)
      ? selected.filter((item) => item instanceof NoteItem)
      : [];
    const items = fromArgs.length > 0 ? fromArgs : clicked instanceof NoteItem ? [clicked] : [];
    return items.filter((item) => item.kind === "file");
  };

  /** Files and folders for the favorites; a link to a folder is not offered, like for a move. */
  const favoritesOf = (clicked: unknown, selected: unknown): NoteItem[] => {
    const fromArgs = Array.isArray(selected)
      ? selected.filter((item) => item instanceof NoteItem)
      : [];
    const items = fromArgs.length > 0 ? fromArgs : clicked instanceof NoteItem ? [clicked] : [];
    return items.filter((item) => item.kind === "file" || item.kind === "folder");
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

  registerSafeCommand(
    context,
    logger,
    Commands.addToFavorites,
    async (clicked?: unknown, selected?: unknown) => {
      const items = favoritesOf(clicked, selected);
      if (items.length > 0) {
        await favoritesService.pin(items.map((item) => item.relativePath));
      }
    }
  );

  registerSafeCommand(
    context,
    logger,
    Commands.removeFromFavorites,
    async (clicked?: unknown, selected?: unknown) => {
      const items = favoritesOf(clicked, selected);
      if (items.length > 0) {
        await favoritesService.unpin(items.map((item) => item.relativePath));
      }
    }
  );
}
