import * as vscode from "vscode";
import { BuiltinCommands, Commands } from "../constants/commands";
import { SettingKeys } from "../constants/settings";
import { Strings } from "../constants/strings";
import { FileOperationsService } from "../services/FileOperationsService";
import { ExcludeMatcher } from "../services/ExcludeMatcher";
import { Logger } from "../services/Logger";
import { PathGuard } from "../services/PathGuard";
import { RootFolderService } from "../services/RootFolderService";
import { isNoteFile } from "../services/AutoCategoryService";
import { QuickNoteService } from "../services/QuickNoteService";
import { RecentNotesService } from "../services/RecentNotesService";
import { SearchService } from "../services/SearchService";
import { SettingsService } from "../services/SettingsService";
import { NoteItem } from "../tree/NoteItem";
import { TreeNavigator } from "../tree/TreeNavigator";
import { OutsideRootError, RootMissingError, TrashUnavailableError } from "../util/errors";
import { uriOfTab } from "../util/tabUri";
import { parentOf } from "../util/uri";
import { confirmPermanentDelete, confirmQuickNoteChange } from "./dialogs";
import { openFile } from "./openFile";
import { addToPatternList, removeFromPatternList, type PatternListOptions } from "./patternLists";
import { registerSafeCommand } from "./safe";
import { closeTabsOf } from "./tabs";
import { showStatus } from "../util/status";

/** The destination list shows at most this many notes. */
const MAX_MOVE_TARGETS = 2000;

export interface FileCommandDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  rootService: RootFolderService;
  pathGuard: PathGuard;
  settings: SettingsService;
  fileOps: FileOperationsService;
  quickNoteService: QuickNoteService;
  searchService: SearchService;
  excludeMatcher: ExcludeMatcher;
  recentService: RecentNotesService;
  navigator: TreeNavigator;
}

export function registerFileCommands(deps: FileCommandDependencies): void {
  const {
    context,
    logger,
    rootService,
    pathGuard,
    settings,
    fileOps,
    quickNoteService,
    searchService,
    recentService,
    excludeMatcher,
    navigator,
  } = deps;
  const register = (id: string, handler: (...args: unknown[]) => unknown): void =>
    registerSafeCommand(context, logger, id, handler);

  /**
   * Items a command works on. From a context menu VS Code passes the clicked item and all
   * selected items; from a keybinding or the title bar it passes nothing, so the selection is used.
   */
  const targetsOf = (clicked: unknown, selected: unknown): NoteItem[] => {
    const fromArgs = Array.isArray(selected)
      ? selected.filter((item) => item instanceof NoteItem)
      : [];
    if (fromArgs.length > 0) {
      return fromArgs;
    }
    return clicked instanceof NoteItem ? [clicked] : [...navigator.selection];
  };

  /** Where new items go: the selected folder, the parent of a selected file, or the root. */
  const folderForNewItem = (clicked: unknown): vscode.Uri => {
    const item = clicked instanceof NoteItem ? clicked : navigator.selection[0];
    if (item) {
      return item.kind === "folder" ? item.uri : parentOf(item.uri);
    }
    const root = rootService.getRootUri();
    if (!root) {
      throw new RootMissingError(Strings.root.noRootSelected);
    }
    return root;
  };

  const createItem =
    (kind: "file" | "folder") =>
    async (clicked?: unknown): Promise<void> => {
      const folder = folderForNewItem(clicked);
      pathGuard.assertInsideRoot(folder);
      const siblings = await fileOps.listChildNames(folder);
      const name = await vscode.window.showInputBox({
        title: kind === "file" ? Strings.fileOps.newFileTitle : Strings.fileOps.newFolderTitle,
        placeHolder:
          kind === "file"
            ? Strings.fileOps.newFilePlaceholder
            : Strings.fileOps.newFolderPlaceholder,
        validateInput: (value) =>
          kind === "file"
            ? fileOps.validateNewFileName(value, siblings)
            : fileOps.validateNewFolderName(value, siblings),
      });
      if (name === undefined) {
        return;
      }
      const created =
        kind === "file"
          ? await fileOps.createFile(folder, name)
          : await fileOps.createFolder(folder, name);
      // For a file the editor takes the focus below, so the tree must not.
      await navigator.refreshAndReveal([created], { focus: kind === "folder" });
      if (kind === "file") {
        await openFile({ logger, pathGuard, settings }, created, { preview: false });
      }
    };
  register(Commands.newFile, createItem("file"));
  register(Commands.newFolder, createItem("folder"));

  /**
   * Shows the list and, beside it, the end of the note that is highlighted (where the text would go) in a preview tab next to the
   * editor. The preview follows the highlight, takes no focus, and is closed again at the end when this command opened it.
   */
  async function chooseWithPreview<T extends vscode.QuickPickItem & { relativePath?: string }>(
    choices: readonly T[]
  ): Promise<T | undefined> {
    const quickPick = vscode.window.createQuickPick<T>();
    quickPick.title = Strings.moveSelection.title;
    quickPick.placeholder = Strings.moveSelection.placeholder;
    quickPick.matchOnDescription = true;
    quickPick.items = choices;

    const alreadyOpen = (uri: vscode.Uri): boolean =>
      vscode.window.tabGroups.all.some((group) =>
        group.tabs.some((tab) => uriOfTab(tab)?.toString() === uri.toString())
      );
    const openedHere: vscode.Uri[] = [];
    let latest = 0;
    const preview = async (item: T | undefined): Promise<void> => {
      const ticket = ++latest;
      if (!item?.relativePath) {
        return;
      }
      try {
        const uri = pathGuard.resolveRelative(item.relativePath);
        const wasOpen = alreadyOpen(uri);
        const size = (await vscode.workspace.fs.stat(uri)).size;
        if (ticket !== latest) {
          return; // The highlight moved on while this one was being read.
        }
        let selection: vscode.Range | undefined;
        if (size <= settings.maxTextFileBytes) {
          const document = await vscode.workspace.openTextDocument(uri);
          const end = document.lineAt(Math.max(0, document.lineCount - 1)).range.end;
          selection = new vscode.Range(end, end);
        }
        if (ticket !== latest) {
          return;
        }
        await vscode.window.showTextDocument(uri, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: true,
          preserveFocus: true,
          selection,
        });
        if (!wasOpen && !openedHere.some((opened) => opened.toString() === uri.toString())) {
          openedHere.push(uri);
        }
      } catch (error) {
        logger.debug(
          `No preview of "${item.relativePath}": ${error instanceof Error ? error.message : String(error)}`
        );
      }
    };

    return new Promise<T | undefined>((resolve) => {
      let settled = false;
      const finish = (value: T | undefined): void => {
        if (settled) {
          return;
        }
        settled = true;
        latest++;
        resolve(value);
        quickPick.dispose();
        // Closes the previews this command opened. Tabs that were open before, or were changed meanwhile, stay.
        void closeTabsOf(openedHere, pathGuard);
      };
      quickPick.onDidChangeActive((active) => void preview(active[0]));
      quickPick.onDidAccept(() => finish(quickPick.selectedItems[0]));
      quickPick.onDidHide(() => finish(undefined));
      quickPick.show();
    });
  }

  /**
   * One list with all the notes of the notes folder (name and folder side by side, type to filter): "New note…" on top, then the
   * recently opened notes, then all the others.
   * No folder dialog. Returns the path relative to the notes folder, or undefined when cancelled.
   */
  async function pickDestination(source: vscode.Uri): Promise<string | undefined> {
    const extensions = new Set(settings.noteFileTypes);
    const files: { name: string; relativePath: string }[] = [];
    for await (const file of searchService.walkFiles()) {
      if (isNoteFile(file.name, extensions) && !pathGuard.isSame(file.uri, source)) {
        files.push({ name: file.name, relativePath: file.relativePath });
        if (files.length >= MAX_MOVE_TARGETS) {
          break;
        }
      }
    }
    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
    files.sort((a, b) => collator.compare(a.relativePath, b.relativePath));

    type Choice = vscode.QuickPickItem & { relativePath?: string; isNew?: boolean };
    const toChoice = (file: { name: string; relativePath: string }): Choice => {
      const folder = file.relativePath.slice(
        0,
        Math.max(0, file.relativePath.length - file.name.length - 1)
      );
      return {
        label: "$(file) " + file.name,
        description: folder,
        relativePath: file.relativePath,
      };
    };
    // The notes opened last come first, newest first (the same list as the Recent panel), then all the others.
    const byPath = new Map(files.map((file) => [file.relativePath, file]));
    const recent = recentService
      .list()
      .map((path) => byPath.get(path))
      .filter((file): file is { name: string; relativePath: string } => file !== undefined);
    const recentPaths = new Set(recent.map((file) => file.relativePath));
    const others = files.filter((file) => !recentPaths.has(file.relativePath));
    const separator = (label: string): Choice => ({
      label,
      kind: vscode.QuickPickItemKind.Separator,
    });
    const choices: Choice[] = [
      { label: "$(new-file) " + Strings.moveSelection.newNote, isNew: true, alwaysShow: true },
      ...(recent.length > 0
        ? [separator(Strings.moveSelection.recent), ...recent.map(toChoice)]
        : []),
      ...(recent.length > 0 && others.length > 0
        ? [separator(Strings.moveSelection.allNotes)]
        : []),
      ...others.map(toChoice),
    ];
    const picked = await chooseWithPreview(choices);
    if (!picked) {
      return undefined;
    }
    if (!picked.isNew) {
      return picked.relativePath;
    }
    const typed = await vscode.window.showInputBox({
      title: Strings.moveSelection.title,
      prompt: Strings.quickNote.newFilePrompt,
      validateInput: (value) => quickNoteService.validateTargetPath(value),
    });
    return typed === undefined ? undefined : quickNoteService.normalizeTargetPath(typed);
  }

  /**
   * Cuts the selected text of the active note and pastes it where `chooseDestination` says. The text is written to the
   * destination first and removed here only after that worked, so it is never lost. Several selections go together,
   * separated by a blank line.
   * @param chooseDestination asks the user (or decides) where the text goes: `write` adds the text and returns the path it
   * went to relative to the notes folder ('' when there was nothing to add). Undefined means the user cancelled.
   */
  async function cutSelectionTo(
    chooseDestination: (
      source: vscode.Uri
    ) => Promise<{ write: (text: string) => Promise<string> } | undefined>
  ): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const ranges = editor
      ? editor.selections
          .filter((selection) => !selection.isEmpty)
          .sort((a, b) => a.start.compareTo(b.start))
      : [];
    if (!editor || ranges.length === 0) {
      void vscode.window.showInformationMessage(Strings.moveSelection.noSelection);
      return;
    }
    const source = editor.document;
    if (!pathGuard.isInsideRoot(source.uri, { allowRoot: false })) {
      void vscode.window.showInformationMessage(Strings.moveSelection.notInNotes);
      return;
    }
    const eol = source.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const pieces = ranges.map((range) => source.getText(range));
    const version = source.version;

    const destination = await chooseDestination(source.uri);
    if (!destination) {
      return;
    }
    const writtenTo = await destination.write(pieces.join(eol + eol));
    if (writtenTo === "") {
      void vscode.window.showInformationMessage(Strings.moveSelection.noSelection);
      return;
    }

    // The note may have been edited while the list was open: remove the text only if it is still exactly where it was.
    const unchanged =
      source.version === version ||
      ranges.every((range, index) => source.getText(range) === pieces[index]);
    if (!unchanged) {
      void vscode.window.showWarningMessage(Strings.moveSelection.changedMeanwhile(writtenTo));
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    for (const range of ranges) {
      edit.delete(source.uri, range);
    }
    if (!(await vscode.workspace.applyEdit(edit))) {
      void vscode.window.showWarningMessage(Strings.moveSelection.changedMeanwhile(writtenTo));
      return;
    }
    showStatus(Strings.moveSelection.done(writtenTo));
  }

  /** "Move to > Choose Note…" (also the Command Palette): the text goes to the end of a note chosen from the list. */
  register(Commands.moveTo, () =>
    cutSelectionTo(async (source) => {
      const destination = await pickDestination(source);
      if (!destination) {
        return undefined;
      }
      if (pathGuard.isSame(pathGuard.resolveRelative(destination), source)) {
        void vscode.window.showInformationMessage(Strings.moveSelection.sameFile);
        return undefined;
      }
      return { write: (text) => quickNoteService.appendText(destination, text) };
    })
  );

  /** "Move to > Quick Note": the text becomes a Quick Note (heading, tags, the Quick Note file or the chosen category). */
  register(Commands.moveToQuickNote, () =>
    cutSelectionTo(async () => ({ write: (text) => quickNoteService.append(text) }))
  );

  register(Commands.undo, async () => {
    const result = await fileOps.undoLast();
    if (!result) {
      showStatus(Strings.fileOps.nothingToUndo, 2);
      return;
    }
    if (result.restored.length > 0) {
      await navigator.refreshAndReveal(result.restored, { focus: true });
      showStatus(Strings.fileOps.undone(result.restored.length), 2);
    } else {
      await navigator.refresh();
    }
    if (result.failed.length > 0) {
      void vscode.window.showWarningMessage(
        Strings.fileOps.undoFailed(result.failed.map((entry) => `'${entry.name}'`).join(", "))
      );
    }
  });
  // Another notes folder has other paths: what was done in the old one cannot be undone any more.
  context.subscriptions.push(rootService.onDidChangeRoot(() => fileOps.clearUndoHistory()));

  register(Commands.duplicate, async (clicked?: unknown, selected?: unknown) => {
    const items = targetsOf(clicked, selected).filter(
      (item) => item.kind === "file" || item.kind === "folder"
    );
    const created: vscode.Uri[] = [];
    let failed = 0;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: Strings.fileOps.duplicating },
      async () => {
        for (const item of items) {
          try {
            created.push(await fileOps.duplicate(item.uri));
          } catch (error) {
            failed++;
            logger.error(
              `Could not duplicate ${pathGuard.getRelativePath(item.uri) ?? item.name}.`,
              error
            );
          }
        }
      }
    );
    if (created.length > 0) {
      await navigator.refreshAndReveal(created, { focus: true });
    }
    if (failed > 0) {
      void vscode.window.showErrorMessage(Strings.fileOps.someFailed(failed, "duplicated"));
    }
  });

  // "Hide from NoteRoot" and "Show in NoteRoot Again": the hidden list (setting "Hidden files and folders"), see patternLists.ts.
  const hiddenList: PatternListOptions = {
    settings,
    key: SettingKeys.excludePatterns,
    read: () => settings.excludePatterns,
    matcher: excludeMatcher,
    messages: {
      added: Strings.fileOps.excluded,
      alreadyAdded: Strings.fileOps.excludedAlready,
      undo: Strings.fileOps.excludeUndo,
      removed: Strings.fileOps.included,
      removePattern: Strings.fileOps.includePattern,
      removePatternAction: Strings.fileOps.includePatternAction,
      insideFolder: Strings.fileOps.includeInsideHidden,
      includeFolderAction: Strings.fileOps.includeFolderAction,
      nothing: Strings.fileOps.includeNothing,
    },
  };

  /** Hides the files and folders from the tree (and from search, tags and categories). Nothing is deleted or moved. */
  register(Commands.excludeItem, async (clicked?: unknown, selected?: unknown) => {
    const paths = targetsOf(clicked, selected)
      .map((item) => pathGuard.getRelativePath(item.uri))
      .filter((path): path is string => path !== undefined && path !== "");
    await addToPatternList(paths, hiddenList);
  });

  /** A hidden item of the tree (shown by "Show Hidden Items"): takes out of the hidden list what hides it. */
  register(Commands.includeItem, async (clicked?: unknown, selected?: unknown) => {
    await removeFromPatternList(
      targetsOf(clicked, selected).filter((item) => item.hidden),
      hiddenList
    );
  });

  register(Commands.rename, async (clicked?: unknown, selected?: unknown) => {
    const item = targetsOf(clicked, selected)[0];
    if (!item) {
      return;
    }
    pathGuard.assertInsideRoot(item.uri, { allowRoot: false });
    const siblings = await fileOps.listChildNames(parentOf(item.uri));
    const currentName = item.name;
    // Select the name without its extension, so typing replaces only the name.
    const dot = currentName.lastIndexOf(".");
    const selectionEnd = item.kind === "file" && dot > 0 ? dot : currentName.length;
    const newName = await vscode.window.showInputBox({
      title: Strings.fileOps.renameTitle,
      value: currentName,
      valueSelection: [0, selectionEnd],
      validateInput: (value) => fileOps.validateRename(value, siblings, currentName),
    });
    if (newName === undefined || newName === currentName) {
      return;
    }
    if (fileOps.involvesQuickNoteFile(item.uri)) {
      const isFolder = !fileOps.isQuickNoteFile(item.uri);
      if (!(await confirmQuickNoteChange("rename", isFolder, fileOps.quickNoteFilePath))) {
        return;
      }
    }
    const renamed = await fileOps.rename(item.uri, newName);
    await navigator.refreshAndReveal([renamed], { focus: true });
  });

  register(Commands.delete, async (clicked?: unknown, selected?: unknown) => {
    const items = targetsOf(clicked, selected);
    // A folder and its own children: deleting the folder covers them.
    const uris = pathGuard.removeNested(items.map((item) => item.uri));
    const toDelete = items.filter((item) => uris.includes(item.uri));
    if (toDelete.length === 0) {
      return;
    }
    for (const item of toDelete) {
      pathGuard.assertInsideRoot(item.uri, { allowRoot: false }); // The root itself is never deletable.
    }

    const involvesQuickNote = toDelete.some((item) => fileOps.involvesQuickNoteFile(item.uri));
    const first = toDelete[0];
    const message =
      toDelete.length > 1
        ? Strings.fileOps.deleteMany(toDelete.length)
        : first.kind === "folder"
          ? Strings.fileOps.deleteFolder(first.name)
          : Strings.fileOps.deleteOne(first.name);
    // The question can be turned off (the items still go to the Trash), but never for the Quick Note file.
    if (settings.confirmDelete || involvesQuickNote) {
      const choice = await vscode.window.showWarningMessage(
        message,
        {
          modal: true,
          detail: involvesQuickNote
            ? Strings.fileOps.quickNoteDeleteDetail(fileOps.quickNoteFilePath)
            : undefined,
        },
        Strings.fileOps.moveToTrashAction
      );
      if (choice !== Strings.fileOps.moveToTrashAction) {
        return;
      }
    }

    const deleted: vscode.Uri[] = [];
    let failed = 0;
    let permanentApproved = false;
    for (const [index, item] of toDelete.entries()) {
      try {
        if (!permanentApproved) {
          try {
            await fileOps.deleteToTrash(item.uri);
            deleted.push(item.uri);
            continue;
          } catch (error) {
            if (!(error instanceof TrashUnavailableError)) {
              throw error;
            }
          }
          // Never delete permanently without this separate, explicit question. Asked once for all remaining items.
          permanentApproved = await confirmPermanentDelete(toDelete.length - index);
          if (!permanentApproved) {
            break;
          }
        }
        await fileOps.deletePermanently(item.uri);
        deleted.push(item.uri);
      } catch (error) {
        failed++;
        logger.error(
          `Could not delete ${pathGuard.getRelativePath(item.uri) ?? item.name}.`,
          error
        );
      }
    }

    await closeTabsOf(deleted, pathGuard);
    await navigator.refresh();
    if (failed > 0) {
      void vscode.window.showErrorMessage(Strings.fileOps.someFailed(failed, "deleted"));
    }
  });

  register(Commands.revealInOS, async (clicked?: unknown, selected?: unknown) => {
    const item = targetsOf(clicked, selected)[0];
    if (item) {
      pathGuard.assertInsideRoot(item.uri, { allowRoot: false });
      await vscode.commands.executeCommand(BuiltinCommands.revealFileInOS, item.uri);
    }
  });

  register(Commands.copyPath, async (clicked?: unknown, selected?: unknown) => {
    const items = targetsOf(clicked, selected);
    if (items.length > 0) {
      await vscode.env.clipboard.writeText(items.map((item) => item.uri.fsPath).join("\n"));
      showStatus(Strings.fileOps.pathCopied);
    }
  });

  register(Commands.copyRelativePath, async (clicked?: unknown, selected?: unknown) => {
    const items = targetsOf(clicked, selected);
    const paths = items.map((item) => {
      const relative = pathGuard.getRelativePath(item.uri);
      if (relative === undefined) {
        throw new OutsideRootError(item.uri.fsPath);
      }
      return relative; // Always "/"-separated, on every OS.
    });
    if (paths.length > 0) {
      await vscode.env.clipboard.writeText(paths.join("\n"));
      showStatus(Strings.fileOps.pathCopied);
    }
  });

  register(Commands.openToSide, async (clicked?: unknown, selected?: unknown) => {
    for (const item of targetsOf(clicked, selected).filter(
      (candidate) => candidate.kind === "file"
    )) {
      await openFile({ logger, pathGuard, settings }, item.uri, {
        preview: false,
        viewColumn: vscode.ViewColumn.Beside,
      });
    }
  });

  register(Commands.openPreviewToSide, async (clicked?: unknown, selected?: unknown) => {
    const item = targetsOf(clicked, selected).find((candidate) => candidate.kind === "file");
    if (item) {
      pathGuard.assertInsideRoot(item.uri, { allowRoot: false });
      await vscode.commands.executeCommand(BuiltinCommands.markdownPreviewToSide, item.uri);
    }
  });
}
