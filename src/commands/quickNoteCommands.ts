import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import {
  HeadingLevels,
  QuickNotePositions,
  isValidTagLine,
  SettingDefaults,
  type HeadingLevel,
  type QuickNotePosition,
} from "../constants/settings";
import { Strings } from "../constants/strings";
import { LabelService } from "../services/LabelService";
import { Logger } from "../services/Logger";
import { AdvancedModeService } from "../services/AdvancedModeService";
import { PathGuard } from "../services/PathGuard";
import { QuickNoteService } from "../services/QuickNoteService";
import { RootFolderService } from "../services/RootFolderService";
import { SettingsService } from "../services/SettingsService";
import { RootMissingError } from "../util/errors";
import { QuickNoteViewProvider } from "../webview/QuickNoteViewProvider";
import { offerSelectRoot } from "./dialogs";
import { registerSafeCommand } from "./safe";
import { showStatus } from "../util/status";

export interface QuickNoteCommandDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  quickNoteService: QuickNoteService;
  quickNoteView: QuickNoteViewProvider;
  advancedMode: AdvancedModeService;
  rootService: RootFolderService;
  pathGuard: PathGuard;
  settings: SettingsService;
  labelService: LabelService;
}

export function registerQuickNoteCommands(deps: QuickNoteCommandDependencies): void {
  const {
    context,
    logger,
    quickNoteService,
    quickNoteView,
    advancedMode,
    rootService,
    pathGuard,
    settings,
    labelService,
  } = deps;

  registerSafeCommand(context, logger, Commands.focusQuickNote, async () => {
    await quickNoteView.focus();
  });

  registerSafeCommand(context, logger, Commands.addSelectionToQuickNote, async () => {
    const editor = vscode.window.activeTextEditor;
    // Several selections are joined with a blank line, in the order they were made.
    const text = editor?.selections
      .filter((selection) => !selection.isEmpty)
      .map((selection) => editor.document.getText(selection))
      .join("\n\n");
    if (!text || text.trim().length === 0) {
      void vscode.window.showInformationMessage(Strings.quickNote.nothingSelected);
      return;
    }
    let addedTo: string;
    try {
      addedTo = await quickNoteService.append(text);
    } catch (error) {
      if (error instanceof RootMissingError) {
        await offerSelectRoot(error.message);
        return;
      }
      throw error;
    }
    // A temporary message, not a permanent status bar item. It names the file, as it may be a category file.
    showStatus(Strings.quickNote.addedToQuickNote(addedTo));
  });

  // Two commands instead of one toggle: the title bar button shows the one that fits the current state.
  registerSafeCommand(context, logger, Commands.enableAdvanced, async () => {
    await advancedMode.setEnabled(true);
  });
  registerSafeCommand(context, logger, Commands.disableAdvanced, async () => {
    await advancedMode.setEnabled(false);
  });

  // The same as the "Paste and Save" button in the box, for a keyboard shortcut or the Command Palette.
  registerSafeCommand(context, logger, Commands.pasteAndSave, async () => {
    let addedTo: string;
    try {
      addedTo = await quickNoteService.appendClipboard();
    } catch (error) {
      if (error instanceof RootMissingError) {
        await offerSelectRoot(error.message);
        return;
      }
      throw error;
    }
    showStatus(Strings.quickNote.addedToQuickNote(addedTo));
  });

  /**
   * Asks for a note file inside the notes folder: an existing one, a new one (typed, with a suggestion),
   * and optionally "no separate file". Returns the path relative to the notes folder, null for "no
   * separate file", and undefined when the user cancelled.
   */
  async function pickNoteFile(args: PickNoteFileArgs): Promise<string | null | undefined> {
    const root = rootService.getRootUri();
    if (!root || !rootService.hasRoot) {
      await offerSelectRoot(root ? Strings.root.notFound : Strings.root.noRootSelected);
      return undefined;
    }
    const items: PickFileChoice[] = [
      { label: Strings.quickNote.changeFileExisting, action: "existing" },
      { label: Strings.quickNote.changeFileNew, action: "new" },
    ];
    if (args.allowNone) {
      items.push({ label: Strings.quickNote.categoryFileNone, action: "none" });
    }
    const choice = await vscode.window.showQuickPick(items, {
      title: args.title,
      placeHolder: Strings.quickNote.categoryFilePlaceholder,
    });
    if (!choice) {
      return undefined;
    }
    if (choice.action === "none") {
      return null;
    }
    if (choice.action === "existing") {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        defaultUri: root,
        title: args.title,
        openLabel: Strings.quickNote.changeFileOpenLabel,
      });
      if (!picked?.[0]) {
        return undefined;
      }
      // A file outside the notes folder is refused with the usual "outside the notes folder".
      pathGuard.assertInsideRoot(picked[0], { allowRoot: false });
      return pathGuard.getRelativePath(picked[0]);
    }
    const typed = await vscode.window.showInputBox({
      title: args.title,
      prompt: Strings.quickNote.newFilePrompt,
      value: args.suggestion,
      validateInput: (value) => quickNoteService.validateTargetPath(value),
    });
    return typed === undefined ? undefined : quickNoteService.normalizeTargetPath(typed);
  }

  // Internal: the Quick Note view calls it while creating a category, to choose the file of the category.
  registerSafeCommand(context, logger, Commands.pickNoteFile, (args: unknown) => {
    const request = args as Partial<PickNoteFileArgs> | undefined;
    return pickNoteFile({
      title: typeof request?.title === "string" ? request.title : Strings.quickNote.changeFileTitle,
      suggestion: typeof request?.suggestion === "string" ? request.suggestion : "",
      allowNone: request?.allowNone === true,
    });
  });

  registerSafeCommand(context, logger, Commands.changeCategoryFile, async () => {
    const root = rootService.getRootUri();
    if (!root || !rootService.hasRoot) {
      await offerSelectRoot(root ? Strings.root.notFound : Strings.root.noRootSelected);
      return;
    }
    const { categories } = await labelService.getLabels();
    if (categories.length === 0) {
      void vscode.window.showInformationMessage(Strings.quickNote.noCategoriesYet);
      return;
    }
    const category = await vscode.window.showQuickPick(
      categories.map((entry) => ({
        label: entry.name,
        description: entry.file ?? Strings.quickNote.categoryUsesQuickNoteFile,
      })),
      {
        title: Strings.quickNote.changeCategoryFileTitle,
        placeHolder: Strings.quickNote.changeCategoryFilePlaceholder,
      }
    );
    if (!category) {
      return;
    }
    const current = categories.find((entry) => entry.name === category.label);
    const chosen = await pickNoteFile({
      title: Strings.quickNote.categoryFileTitle(category.label),
      suggestion: current?.file ?? LabelService.suggestFileName(category.label),
      allowNone: true,
    });
    if (chosen === undefined) {
      return;
    }
    await labelService.setCategoryFile(category.label, chosen ?? undefined);
    showStatus(
      chosen === null
        ? Strings.quickNote.categoryFileCleared(category.label)
        : Strings.quickNote.categoryFileSet(category.label, chosen)
    );
  });

  // The two settings that change how a note is written, in one list. It opens again after each change.
  registerSafeCommand(context, logger, Commands.quickNoteOptions, async () => {
    const current = (value: string, active: string): string | undefined =>
      value === active ? Strings.quickNote.optionCurrent : undefined;
    for (;;) {
      const option = await vscode.window.showQuickPick<
        vscode.QuickPickItem & { id: "position" | "heading" | "tagLine" }
      >(
        [
          {
            id: "position",
            label: Strings.quickNote.optionPositionLabel,
            description:
              settings.quickNotePosition === "start"
                ? Strings.quickNote.positionStart
                : Strings.quickNote.positionEnd,
          },
          {
            id: "heading",
            label: Strings.quickNote.optionHeadingLabel,
            description:
              settings.quickNoteHeadingLevel === "plain"
                ? Strings.quickNote.headingPlain
                : Strings.quickNote.headingLevelLabel(settings.quickNoteHeadingLevel),
          },
          {
            id: "tagLine",
            label: Strings.quickNote.optionTagLineLabel,
            description: Strings.quickNote.tagLineExample(settings.quickNoteTagLine),
          },
        ],
        { title: Strings.quickNote.optionsTitle, placeHolder: Strings.quickNote.optionsPlaceholder }
      );
      if (!option) {
        return;
      }
      if (option.id === "position") {
        const labels: Record<QuickNotePosition, [string, string]> = {
          end: [Strings.quickNote.positionEnd, Strings.quickNote.positionEndDetail],
          start: [Strings.quickNote.positionStart, Strings.quickNote.positionStartDetail],
        };
        const picked = await vscode.window.showQuickPick(
          QuickNotePositions.map((value) => ({
            value,
            label: labels[value][0],
            detail: labels[value][1],
            description: current(value, settings.quickNotePosition),
          })),
          { title: Strings.quickNote.positionTitle }
        );
        if (picked && picked.value !== settings.quickNotePosition) {
          await settings.setQuickNotePosition(picked.value);
        }
      } else if (option.id === "tagLine") {
        // A few usual lines, and the user's own. The current one is marked.
        const presets = [
          "{tags}",
          "Tags: {tags}",
          "**Tags:** {tags}",
          "#### Tags: {tags}",
          "> {tags}",
        ];
        const now = settings.quickNoteTagLine;
        const items: (vscode.QuickPickItem & { template?: string })[] = [
          ...presets.map((template) => ({
            template,
            label: template,
            detail: Strings.quickNote.tagLineExample(template),
            description: current(template, now),
          })),
          {
            label: Strings.quickNote.tagLineCustom,
            detail: Strings.quickNote.tagLineCustomDetail,
            description: presets.includes(now) ? undefined : Strings.quickNote.optionCurrent,
          },
        ];
        const picked = await vscode.window.showQuickPick(items, {
          title: Strings.quickNote.tagLineTitle,
        });
        if (!picked) {
          continue;
        }
        const template =
          picked.template ??
          (await vscode.window.showInputBox({
            title: Strings.quickNote.tagLineTitle,
            prompt: Strings.quickNote.tagLineCustomPrompt,
            value: now,
            validateInput: (value) =>
              isValidTagLine(value) ? undefined : Strings.quickNote.tagLineInvalid,
          }));
        if (template !== undefined && template !== now) {
          await settings.setQuickNoteTagLine(template);
        }
      } else {
        const picked = await vscode.window.showQuickPick(
          HeadingLevels.map((value: HeadingLevel) => ({
            value,
            label:
              value === "plain"
                ? Strings.quickNote.headingPlain
                : Strings.quickNote.headingLevelLabel(value),
            detail:
              value === "plain"
                ? Strings.quickNote.headingPlainDetail
                : Strings.quickNote.headingLevelDetail(value),
            description: current(value, settings.quickNoteHeadingLevel),
          })),
          { title: Strings.quickNote.headingTitle }
        );
        if (picked && picked.value !== settings.quickNoteHeadingLevel) {
          await settings.setQuickNoteHeadingLevel(picked.value);
        }
      }
    }
  });

  registerSafeCommand(context, logger, Commands.changeQuickNoteFile, async () => {
    const root = rootService.getRootUri();
    if (!root || !rootService.hasRoot) {
      await offerSelectRoot(root ? Strings.root.notFound : Strings.root.noRootSelected);
      return;
    }
    const current = quickNoteService.getTargetPath();
    const choice = await vscode.window.showQuickPick<ChangeFileChoice>(
      [
        { label: Strings.quickNote.changeFileExisting, action: "existing" },
        { label: Strings.quickNote.changeFileNew, action: "new" },
        {
          label: Strings.quickNote.changeFileDefault(SettingDefaults.quickNoteFile),
          action: "default",
        },
      ],
      {
        title: Strings.quickNote.changeFileTitle,
        placeHolder: Strings.quickNote.changeFileCurrent(current),
      }
    );
    if (!choice) {
      return;
    }

    let target: string | undefined;
    if (choice.action === "existing") {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        defaultUri: root,
        title: Strings.quickNote.changeFileTitle,
        openLabel: Strings.quickNote.changeFileOpenLabel,
      });
      if (picked?.[0]) {
        // A file outside the notes folder is refused with the usual "outside the notes folder".
        pathGuard.assertInsideRoot(picked[0], { allowRoot: false });
        target = pathGuard.getRelativePath(picked[0]);
      }
    } else if (choice.action === "new") {
      const typed = await vscode.window.showInputBox({
        title: Strings.quickNote.changeFileTitle,
        prompt: Strings.quickNote.newFilePrompt,
        placeHolder: Strings.quickNote.newFileHint,
        validateInput: (value) => quickNoteService.validateTargetPath(value),
      });
      target = typed === undefined ? undefined : quickNoteService.normalizeTargetPath(typed);
    } else {
      target = SettingDefaults.quickNoteFile;
    }

    if (!target || target === current) {
      return;
    }
    await settings.setQuickNoteFile(target);
    showStatus(Strings.quickNote.fileChanged(target));
  });
}

interface ChangeFileChoice extends vscode.QuickPickItem {
  action: "existing" | "new" | "default";
}

interface PickNoteFileArgs {
  title: string;
  /** Text typed into the box for a new file. */
  suggestion: string;
  /** Also offer "no separate file". */
  allowNone: boolean;
}

interface PickFileChoice extends vscode.QuickPickItem {
  action: "existing" | "new" | "none";
}
