import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { Strings } from "../constants/strings";
import type { AdvancedModeService } from "../services/AdvancedModeService";
import type { AutoCategoryService } from "../services/AutoCategoryService";
import { LabelService } from "../services/LabelService";
import { Logger } from "../services/Logger";
import { PathGuard } from "../services/PathGuard";
import { LabelEntryItem, LabelsTreeProvider } from "../tree/LabelsTreeProvider";
import type { LabelsPageProvider } from "../webview/LabelsPageProvider";
import { askCategoryFile } from "./labelDialogs";
import { performLabelAction } from "./labelCommands";
import { registerSafeCommand } from "./safe";
import { showStatus } from "../util/status";

export interface LabelViewCommandDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  pathGuard: PathGuard;
  labelService: LabelService;
  labelsProvider: LabelsTreeProvider;
  labelsPage: LabelsPageProvider;
  autoCategories: AutoCategoryService;
  advancedMode: AdvancedModeService;
}

/** The commands of the Tags & Categories view. They share their questions with the Manage list. */
export function registerLabelViewCommands(deps: LabelViewCommandDependencies): void {
  const {
    context,
    logger,
    pathGuard,
    labelService,
    labelsProvider,
    labelsPage,
    autoCategories,
    advancedMode,
  } = deps;
  const register = (id: string, handler: (...args: unknown[]) => unknown): void =>
    registerSafeCommand(context, logger, id, handler);

  register(Commands.createCategory, () =>
    performLabelAction(labelService, { type: "create", kind: "category" })
  );
  register(Commands.createTag, () =>
    performLabelAction(labelService, { type: "create", kind: "tag" })
  );

  register(Commands.renameLabel, async (item?: unknown) => {
    if (item instanceof LabelEntryItem) {
      await performLabelAction(labelService, { type: "rename", kind: item.kind, name: item.name });
    }
  });

  /** From a context menu VS Code passes the clicked row and all selected rows: the entries (categories and tags) among them. */
  const entriesOf = (clicked?: unknown, selected?: unknown): LabelEntryItem[] => {
    const fromSelection = Array.isArray(selected)
      ? selected.filter((item) => item instanceof LabelEntryItem)
      : [];
    return fromSelection.length > 0
      ? fromSelection
      : clicked instanceof LabelEntryItem
        ? [clicked]
        : [];
  };

  // Several selected: one question for all of them. The files of categories are never deleted.
  register(Commands.deleteLabel, async (clicked?: unknown, selected?: unknown) => {
    const items = entriesOf(clicked, selected);
    if (items.length > 1) {
      const choice = await vscode.window.showWarningMessage(
        Strings.quickNote.deleteManyConfirm(items.length),
        { modal: true, detail: Strings.quickNote.deleteManyDetail(items.map((item) => item.name)) },
        Strings.quickNote.deleteAction
      );
      if (choice === Strings.quickNote.deleteAction) {
        for (const item of items) {
          await labelService.remove(item.kind, item.name);
        }
        showStatus(Strings.quickNote.deletedMany(items.length));
      }
      return;
    }
    const item = items[0];
    if (item) {
      const file = item.kind === "category" ? await fileOf(labelService, item.name) : undefined;
      await performLabelAction(labelService, {
        type: "delete",
        kind: item.kind,
        name: item.name,
        file,
      });
    }
  });

  register(Commands.setLabelKeyword, async (item?: unknown) => {
    if (item instanceof LabelEntryItem) {
      await performLabelAction(labelService, { type: "keyword", kind: item.kind, name: item.name });
    }
  });

  // Takes the file of a category away: its notes go to the Quick Note file again. The file itself is never deleted.
  register(Commands.removeLabelFile, async (clicked?: unknown, selected?: unknown) => {
    const categories = entriesOf(clicked, selected).filter((item) => item.kind === "category");
    for (const item of categories) {
      await labelService.setCategoryFile(item.name, undefined);
    }
    if (categories.length === 1) {
      showStatus(Strings.quickNote.categoryFileCleared(categories[0].name));
    } else if (categories.length > 1) {
      showStatus(Strings.quickNote.fileClearedMany(categories.length));
    }
  });

  register(Commands.removeLabelKeyword, async (clicked?: unknown, selected?: unknown) => {
    const items = entriesOf(clicked, selected);
    for (const item of items) {
      await labelService.setKeyword(item.kind, item.name, undefined);
    }
    if (items.length === 1) {
      showStatus(Strings.quickNote.keywordCleared(items[0].kind, items[0].name));
    } else if (items.length > 1) {
      showStatus(Strings.quickNote.keywordClearedMany(items.length));
    }
  });

  // Several categories selected: one file is chosen for all of them.
  register(Commands.changeLabelFile, async (clicked?: unknown, selected?: unknown) => {
    const categories = entriesOf(clicked, selected).filter((item) => item.kind === "category");
    if (categories.length > 1) {
      const chosen = await askCategoryFile(
        Strings.quickNote.categoryFileTitleMany(categories.length),
        LabelService.suggestFileName(categories[0].name)
      );
      if (chosen === undefined) {
        return;
      }
      for (const item of categories) {
        await labelService.setCategoryFile(item.name, chosen ?? undefined);
      }
      showStatus(
        chosen === null
          ? Strings.quickNote.fileClearedMany(categories.length)
          : Strings.quickNote.fileSetMany(categories.length, chosen)
      );
      return;
    }
    const item = categories[0];
    if (item) {
      const file = await fileOf(labelService, item.name);
      await performLabelAction(labelService, {
        type: "file",
        kind: "category",
        name: item.name,
        file,
      });
    }
  });

  // One button with two commands, because a contributed command cannot change its own tooltip.
  register(Commands.enableAutoCategories, async () => {
    await autoCategories.setEnabled(true);
    showStatus(
      advancedMode.isEnabled ? Strings.labelsView.autoOn : Strings.labelsView.autoOnNeedsAdvanced
    );
  });
  register(Commands.disableAutoCategories, async () => {
    await autoCategories.setEnabled(false);
    showStatus(Strings.labelsView.autoOff);
  });

  register(Commands.refreshLabels, () => labelsProvider.refresh());
  register(Commands.openLabelsPage, () => labelsPage.open());

  // A click on a note of a tag: open it with the tag selected.
  register(
    Commands.openAtLine,
    async (uri?: unknown, line?: unknown, column?: unknown, length?: unknown) => {
      if (
        !(uri instanceof vscode.Uri) ||
        ![line, column, length].every((n) => typeof n === "number" && n >= 0)
      ) {
        logger.warn("openAtLine was called with something else than a note and a position.");
        return;
      }
      pathGuard.assertInsideRoot(uri, { allowRoot: false });
      const start = new vscode.Position(line as number, column as number);
      const end = new vscode.Position(line as number, (column as number) + (length as number));
      await vscode.window.showTextDocument(uri, {
        selection: new vscode.Range(start, end),
        preview: true,
      });
    }
  );
}

/** The file of a category as it is stored now (the item of the view may be a little behind). */
async function fileOf(labelService: LabelService, name: string): Promise<string | undefined> {
  return (await labelService.getLabels()).categories.find((category) => category.name === name)
    ?.file;
}
