import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { Strings } from "../constants/strings";
import type { AdvancedModeService } from "../services/AdvancedModeService";
import type { AutoTagPatternService } from "../services/AutoTagPatternService";
import { LabelService } from "../services/LabelService";
import { Logger } from "../services/Logger";
import { RootFolderService } from "../services/RootFolderService";
import {
  isValidPrefix,
  presetPattern,
  validateTagPattern,
  type PatternPreset,
} from "../services/TagPatterns";
import { offerSelectRoot } from "./dialogs";
import { PatternItem as PatternNode } from "../tree/LabelsTreeProvider";
import { registerSafeCommand, reportError } from "./safe";
import { showStatus } from "../util/status";

export interface TagPatternCommandDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  rootService: RootFolderService;
  labelService: LabelService;
  autoTagPatterns: AutoTagPatternService;
  advancedMode: AdvancedModeService;
}

type PatternAction = { type: "add" } | { type: "edit" | "delete"; pattern: string };

interface PatternItem extends vscode.QuickPickItem {
  pattern?: string;
  add?: boolean;
}

interface PatternButton extends vscode.QuickInputButton {
  action: "edit" | "delete";
}

const buttons: Record<"edit" | "delete", PatternButton> = {
  edit: {
    action: "edit",
    iconPath: new vscode.ThemeIcon("edit"),
    tooltip: Strings.quickNote.patternsEdit,
  },
  delete: {
    action: "delete",
    iconPath: new vscode.ThemeIcon("trash"),
    tooltip: Strings.quickNote.patternsDelete,
  },
};

/** "Auto create tag from pattern": the on/off button and the list of patterns such as `ab-*`. */
export function registerTagPatternCommands(deps: TagPatternCommandDependencies): void {
  const { context, logger, rootService, labelService, autoTagPatterns, advancedMode } = deps;
  const text = Strings.quickNote;

  // One button with two commands, because a contributed command cannot change its own tooltip.
  registerSafeCommand(context, logger, Commands.enableAutoTagPatterns, async () => {
    await autoTagPatterns.setEnabled(true);
    const noPatterns = (await labelService.getTagPatterns()).length === 0;
    showStatus(
      !advancedMode.isEnabled
        ? Strings.labelsView.autoTagOnNeedsAdvanced
        : noPatterns
          ? Strings.labelsView.autoTagOnNoPatterns
          : Strings.labelsView.autoTagOn
    );
  });
  registerSafeCommand(context, logger, Commands.disableAutoTagPatterns, async () => {
    await autoTagPatterns.setEnabled(false);
    showStatus(Strings.labelsView.autoTagOff);
  });

  const validate = (value: string, others: readonly string[]): string | undefined =>
    validateTagPattern(value, others, {
      empty: text.patternsEmpty,
      tooLong: text.patternsTooLong,
      invalid: text.patternsInvalid,
      badList: text.patternsBadList,
      noWildcard: text.patternsNoWildcard,
      tooFewLiterals: text.patternsTooFewLiterals,
      alreadyThere: text.patternsAlreadyThere,
    });

  /**
   * A new pattern: a ready-made kind (a prefix and then digits, letters or anything) or, for power users, the pattern written
   * out with the whole syntax. Undefined when cancelled.
   */
  async function askNewPattern(patterns: readonly string[]): Promise<string | undefined> {
    type Choice = vscode.QuickPickItem & { preset?: PatternPreset; custom?: boolean };
    const choices: Choice[] = [
      { ...text.patternsPresetNumber, preset: "number" },
      { ...text.patternsPresetLetters, preset: "letters" },
      { ...text.patternsPresetAnything, preset: "anything" },
      { label: text.patternsPresetAdvanced, kind: vscode.QuickPickItemKind.Separator },
      { ...text.patternsPresetCustom, custom: true },
    ];
    const picked = await vscode.window.showQuickPick(choices, {
      title: text.patternsAddTitle,
      placeHolder: text.patternsPresetPlaceholder,
    });
    if (!picked) {
      return undefined;
    }
    if (picked.preset) {
      const preset = picked.preset;
      const prefix = await vscode.window.showInputBox({
        title: text.patternsPrefixTitle,
        prompt: text.patternsPrefixPrompt,
        validateInput: (value) =>
          isValidPrefix(value)
            ? validate(presetPattern(preset, value), patterns)
            : text.patternsPrefixInvalid,
      });
      return prefix === undefined ? undefined : presetPattern(preset, prefix);
    }
    return vscode.window.showInputBox({
      title: text.patternsAddTitle,
      prompt: text.patternsPrompt,
      validateInput: (value) => validate(value, patterns),
    });
  }

  /** One action of the list. The list opens again afterwards, until it is closed. */
  async function perform(action: PatternAction, patterns: readonly string[]): Promise<void> {
    if (action.type === "add") {
      const typed = await askNewPattern(patterns);
      if (typed !== undefined) {
        await labelService.saveTagPattern(typed);
        showStatus(text.patternsAdded(typed.trim()));
      }
      return;
    }
    if (action.type === "edit") {
      const typed = await vscode.window.showInputBox({
        title: text.patternsEditTitle(action.pattern),
        prompt: text.patternsPrompt,
        value: action.pattern,
        validateInput: (value) =>
          validate(
            value,
            patterns.filter((pattern) => pattern !== action.pattern)
          ),
      });
      if (typed !== undefined && typed.trim() !== action.pattern) {
        await labelService.saveTagPattern(typed, action.pattern);
        showStatus(text.patternsChanged(typed.trim()));
      }
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      text.patternsDeleteConfirm(action.pattern),
      { modal: true, detail: text.patternsDeleteDetail },
      text.deleteAction
    );
    if (choice === text.deleteAction) {
      await labelService.removeTagPattern(action.pattern);
      showStatus(text.patternsDeleted(action.pattern));
    }
  }

  // The patterns are in the Tags & Categories panel: + on its group, and Change / Delete on a pattern.
  registerSafeCommand(context, logger, Commands.addTagPattern, async () => {
    await perform({ type: "add" }, await labelService.getTagPatterns());
  });
  registerSafeCommand(context, logger, Commands.editTagPattern, async (item?: unknown) => {
    if (item instanceof PatternNode) {
      await perform({ type: "edit", pattern: item.pattern }, await labelService.getTagPatterns());
    }
  });
  registerSafeCommand(context, logger, Commands.deleteTagPattern, async (item?: unknown) => {
    if (item instanceof PatternNode) {
      await perform({ type: "delete", pattern: item.pattern }, await labelService.getTagPatterns());
    }
  });

  // The same list as a QuickPick, for the Command Palette.
  registerSafeCommand(context, logger, Commands.manageTagPatterns, async () => {
    const root = rootService.getRootUri();
    if (!root || !rootService.hasRoot) {
      await offerSelectRoot(root ? Strings.root.notFound : Strings.root.noRootSelected);
      return;
    }
    for (;;) {
      const patterns = await labelService.getTagPatterns();
      const action = await showPatterns(patterns);
      if (!action) {
        return;
      }
      try {
        await perform(action, patterns);
      } catch (error) {
        // A damaged config file or a vanished notes folder: tell the user and stop, instead of looping on the error.
        reportError(logger, "Managing tag patterns", error);
        return;
      }
    }
  });
}

/** Shows the list and answers with what was chosen, or undefined when it was closed. */
function showPatterns(patterns: readonly string[]): Promise<PatternAction | undefined> {
  const text = Strings.quickNote;
  const quickPick = vscode.window.createQuickPick<PatternItem>();
  quickPick.title = text.patternsTitle;
  quickPick.placeholder = text.patternsPlaceholder;
  quickPick.items = [
    ...(patterns.length === 0
      ? [{ label: text.patternsNone, alwaysShow: true } satisfies PatternItem]
      : patterns.map((pattern): PatternItem => ({
          label: pattern,
          detail: text.patternsRowDetail(pattern),
          buttons: [buttons.edit, buttons.delete],
          pattern,
        }))),
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    { label: text.patternsAdd, add: true, alwaysShow: true },
  ];

  return new Promise((resolve) => {
    let settled = false;
    const finish = (action: PatternAction | undefined): void => {
      if (!settled) {
        settled = true;
        resolve(action);
        quickPick.dispose();
      }
    };
    quickPick.onDidTriggerItemButton((event) => {
      const pattern = event.item.pattern;
      if (pattern) {
        finish({ type: (event.button as PatternButton).action, pattern });
      }
    });
    quickPick.onDidAccept(() => {
      const item = quickPick.selectedItems[0];
      if (item?.add) {
        finish({ type: "add" });
      } else if (item?.pattern) {
        finish({ type: "edit", pattern: item.pattern });
      }
    });
    quickPick.onDidHide(() => finish(undefined));
    quickPick.show();
  });
}
