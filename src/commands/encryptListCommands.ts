import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { SettingKeys } from "../constants/settings";
import { Strings } from "../constants/strings";
import { ExcludeMatcher } from "../services/ExcludeMatcher";
import { Logger } from "../services/Logger";
import { PathGuard } from "../services/PathGuard";
import { SettingsService } from "../services/SettingsService";
import { NoteItem } from "../tree/NoteItem";
import { TreeNavigator } from "../tree/TreeNavigator";
import { addToPatternList, removeFromPatternList, type PatternListOptions } from "./patternLists";
import { registerSafeCommand } from "./safe";

export interface EncryptListCommandDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  pathGuard: PathGuard;
  settings: SettingsService;
  encryptMatcher: ExcludeMatcher;
  syncIgnoreMatcher: ExcludeMatcher;
  navigator: TreeNavigator;
}

/**
 * The two lists of the sync that the tree menus change (see patternLists.ts): "Don't Sync" and "Sync Again" (the files and folders
 * that the sync leaves alone), and "Encrypt in Sync" and "Don't Encrypt in Sync" (the ones it seals when the repository is set to
 * encrypt only the chosen files; a change takes effect at the next Push, which sends the notes whose choice changed in their new
 * form even if their content did not change).
 */
export function registerEncryptListCommands(deps: EncryptListCommandDependencies): void {
  const { context, logger, pathGuard, settings, encryptMatcher, syncIgnoreMatcher, navigator } =
    deps;
  const text = Strings.sync.encryption;
  const list: PatternListOptions = {
    settings,
    key: SettingKeys.encryptPatterns,
    read: () => settings.encryptPatterns,
    matcher: encryptMatcher,
    messages: {
      added: text.listAdded,
      alreadyAdded: text.listAlready,
      undo: Strings.fileOps.excludeUndo,
      removed: text.listRemoved,
      removePattern: text.listRemovePattern,
      removePatternAction: Strings.fileOps.includePatternAction,
      insideFolder: text.listInsideFolder,
      includeFolderAction: Strings.fileOps.includeFolderAction,
      nothing: text.listNothing,
    },
  };
  // The files and folders that the sync leaves alone: the same questions, with the texts of that list.
  const ignored = Strings.sync.ignore;
  const ignoreList: PatternListOptions = {
    settings,
    key: SettingKeys.syncIgnorePatterns,
    read: () => settings.syncIgnorePatterns,
    matcher: syncIgnoreMatcher,
    messages: {
      added: ignored.added,
      alreadyAdded: ignored.already,
      undo: Strings.fileOps.excludeUndo,
      removed: ignored.removed,
      removePattern: ignored.removePattern,
      removePatternAction: Strings.fileOps.includePatternAction,
      insideFolder: ignored.insideFolder,
      includeFolderAction: Strings.fileOps.includeFolderAction,
      nothing: ignored.nothing,
    },
  };
  const itemsOf = (clicked?: unknown, selected?: unknown): NoteItem[] => {
    const fromArgs = Array.isArray(selected)
      ? selected.filter((item) => item instanceof NoteItem)
      : [];
    return fromArgs.length > 0
      ? fromArgs
      : clicked instanceof NoteItem
        ? [clicked]
        : [...navigator.selection];
  };

  registerSafeCommand(
    context,
    logger,
    Commands.excludeFromSync,
    async (clicked?: unknown, selected?: unknown) => {
      const paths = itemsOf(clicked, selected)
        .map((item) => pathGuard.getRelativePath(item.uri))
        .filter((path): path is string => path !== undefined && path !== "");
      await addToPatternList(paths, ignoreList);
    }
  );

  registerSafeCommand(
    context,
    logger,
    Commands.includeInSync,
    async (clicked?: unknown, selected?: unknown) => {
      await removeFromPatternList(
        itemsOf(clicked, selected).filter((item) => item.unsynced),
        ignoreList
      );
    }
  );

  registerSafeCommand(
    context,
    logger,
    Commands.encryptInSync,
    async (clicked?: unknown, selected?: unknown) => {
      const paths = itemsOf(clicked, selected)
        .map((item) => pathGuard.getRelativePath(item.uri))
        .filter((path): path is string => path !== undefined && path !== "");
      await addToPatternList(paths, list);
    }
  );

  registerSafeCommand(
    context,
    logger,
    Commands.dontEncryptInSync,
    async (clicked?: unknown, selected?: unknown) => {
      await removeFromPatternList(
        itemsOf(clicked, selected).filter((item) => item.sealed),
        list
      );
    }
  );
}
