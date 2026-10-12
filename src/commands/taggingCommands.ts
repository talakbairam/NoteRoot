import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { SettingKeys } from "../constants/settings";
import { Strings } from "../constants/strings";
import { isNoteFile } from "../services/AutoCategoryService";
import { ExcludeMatcher } from "../services/ExcludeMatcher";
import { Logger } from "../services/Logger";
import { SearchService } from "../services/SearchService";
import { SettingsService } from "../services/SettingsService";
import { NoteTaggingService, type TaggingResult } from "../services/NoteTaggingService";
import { PathGuard } from "../services/PathGuard";
import { NoteItem } from "../tree/NoteItem";
import { TreeNavigator } from "../tree/TreeNavigator";
import { addToPatternList, removeFromPatternList, type PatternListOptions } from "./patternLists";
import { registerSafeCommand } from "./safe";
import { showStatus } from "../util/status";

/** Run Tagging on a folder stops after this many notes. */
const MAX_FOLDER_NOTES = 1000;

export interface TaggingCommandDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  pathGuard: PathGuard;
  taggingService: NoteTaggingService;
  searchService: SearchService;
  settings: SettingsService;
  noTagMatcher: ExcludeMatcher;
  navigator: TreeNavigator;
}

/** "Run Tagging" on notes of the tree and on the note that is open in the editor. */
export function registerTaggingCommands(deps: TaggingCommandDependencies): void {
  const {
    context,
    logger,
    pathGuard,
    taggingService,
    searchService,
    settings,
    noTagMatcher,
    navigator,
  } = deps;
  const text = Strings.tagging;

  /** One message for the whole run: the details for one note, the numbers for several. */
  const report = (uris: readonly vscode.Uri[], results: readonly TaggingResult[]): void => {
    const name = (index: number): string =>
      pathGuard.getRelativePath(uris[index]) ?? uris[index].path;
    if (results.length === 1) {
      const [result] = results;
      const message =
        result.status === "added"
          ? text.added(name(0), result.added)
          : result.status === "updated"
            ? text.updated(name(0), result.added)
            : result.status === "entries"
              ? text.entries(name(0), result.changed, result.notes, result.added)
              : result.status === "unchanged"
                ? text.unchanged(name(0), result.notes)
                : result.status === "skipped"
                  ? text.skipped(name(0))
                  : result.status === "excluded"
                    ? text.excluded(name(0))
                    : text.none(name(0));
      showStatus(message);
      return;
    }
    const count = (status: TaggingResult["status"]): number =>
      results.filter((result) => result.status === status).length;
    void vscode.window.showInformationMessage(
      text.summary(
        count("added") + count("updated") + count("entries"),
        count("unchanged") + count("none"),
        count("skipped") + count("excluded")
      )
    );
  };

  const run = async (uris: readonly vscode.Uri[]): Promise<void> => {
    const results: TaggingResult[] = [];
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: text.running },
      async () => {
        for (const uri of uris) {
          results.push(await taggingService.tagNote(uri));
        }
      }
    );
    report(uris, results);
  };

  // A save that wrote tags: say which, in the status bar (not a message that has to be closed).
  context.subscriptions.push(
    taggingService.onDidTagOnSave((result) =>
      showStatus(text.onSave(result.file, result.changed, result.added))
    )
  );

  /** From a context menu VS Code passes the clicked item and all selected items of the view. */
  registerSafeCommand(
    context,
    logger,
    Commands.tagNote,
    async (clicked?: unknown, selected?: unknown) => {
      const fromArgs = Array.isArray(selected)
        ? selected.filter((item) => item instanceof NoteItem)
        : [];
      const items =
        fromArgs.length > 0
          ? fromArgs
          : clicked instanceof NoteItem
            ? [clicked]
            : [...navigator.selection];
      const files = items.filter((item) => item.kind === "file").map((item) => item.uri);
      const folders = items.filter((item) => item.kind === "folder").map((item) => item.uri);
      if (folders.length === 0) {
        if (files.length > 0) {
          await run(files);
        }
        return;
      }

      // Folders: every note inside them (and in their subfolders), except what is left out of tagging. Many notes are asked about.
      const extensions = new Set(settings.noteFileTypes);
      const found = new Map<string, vscode.Uri>(files.map((uri) => [uri.toString(), uri]));
      let limited = false;
      for (const folder of folders) {
        for await (const file of searchService.walkFiles(folder)) {
          if (
            isNoteFile(file.name, extensions) &&
            !taggingService.isExcludedFromTagging(file.relativePath)
          ) {
            found.set(file.uri.toString(), file.uri);
            if (found.size >= MAX_FOLDER_NOTES) {
              limited = true;
              break;
            }
          }
        }
        if (limited) {
          break;
        }
      }
      const uris = [...found.values()];
      if (uris.length === 0) {
        void vscode.window.showInformationMessage(text.folderEmpty);
        return;
      }
      const choice = await vscode.window.showWarningMessage(
        text.folderConfirm(uris.length),
        { modal: true, detail: text.folderConfirmDetail },
        text.folderAction
      );
      if (choice !== text.folderAction) {
        return;
      }
      await run(uris);
      if (limited) {
        void vscode.window.showInformationMessage(text.folderLimited(MAX_FOLDER_NOTES));
      }
    }
  );

  // "Don't Auto-Tag" and "Auto-Tag Again": the list of the files without tagging, see patternLists.ts.
  const noTagList: PatternListOptions = {
    settings,
    key: SettingKeys.noTagPatterns,
    read: () => settings.noTagPatterns,
    matcher: noTagMatcher,
    messages: {
      added: text.noTagAdded,
      alreadyAdded: text.noTagAlready,
      undo: Strings.fileOps.excludeUndo,
      removed: text.noTagRemoved,
      removePattern: text.noTagRemovePattern,
      removePatternAction: Strings.fileOps.includePatternAction,
      insideFolder: text.noTagInsideFolder,
      includeFolderAction: Strings.fileOps.includeFolderAction,
      nothing: text.noTagNothing,
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

  /** Automatic tagging (Run Tagging, Tag when saving) leaves these files and folders alone. Nothing else changes. */
  registerSafeCommand(
    context,
    logger,
    Commands.excludeFromTagging,
    async (clicked?: unknown, selected?: unknown) => {
      const paths = itemsOf(clicked, selected)
        .map((item) => pathGuard.getRelativePath(item.uri))
        .filter((path): path is string => path !== undefined && path !== "");
      await addToPatternList(paths, noTagList);
    }
  );

  registerSafeCommand(
    context,
    logger,
    Commands.includeInTagging,
    async (clicked?: unknown, selected?: unknown) => {
      await removeFromPatternList(
        itemsOf(clicked, selected).filter((item) => item.noTag),
        noTagList
      );
    }
  );

  registerSafeCommand(context, logger, Commands.tagCurrentNote, async () => {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri) {
      void vscode.window.showInformationMessage(text.noEditor);
      return;
    }
    if (!pathGuard.isInsideRoot(uri, { allowRoot: false })) {
      void vscode.window.showInformationMessage(text.notInNotesFolder);
      return;
    }
    await run([uri]);
  });
}
