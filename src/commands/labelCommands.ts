import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { Strings } from "../constants/strings";
import { LabelService, type Labels, type LabelKind } from "../services/LabelService";
import { Logger } from "../services/Logger";
import { RootFolderService } from "../services/RootFolderService";
import { askCategoryFile, askNewLabel, askNewName } from "./labelDialogs";
import { offerSelectRoot } from "./dialogs";
import { reportError, registerSafeCommand } from "./safe";
import { showStatus } from "../util/status";

export interface LabelCommandDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  rootService: RootFolderService;
  labelService: LabelService;
}

/** What the user asked for in the manager. `menu` means "show the actions of this entry". */
interface EntryAction {
  type: "menu" | "rename" | "delete" | "file" | "keyword";
  kind: LabelKind;
  name: string;
  file?: string;
}

export type ManagerAction = { type: "create"; kind: LabelKind } | EntryAction;

interface ManagerItem extends vscode.QuickPickItem {
  create?: LabelKind;
  entry?: { kind: LabelKind; name: string; file?: string };
}

interface ManagerButton extends vscode.QuickInputButton {
  action: "rename" | "delete" | "file" | "keyword";
}

const buttons = {
  file: makeButton("file", "file-symlink-file", Strings.quickNote.manageChangeFile),
  keyword: makeButton("keyword", "quote", Strings.quickNote.manageKeyword),
  rename: makeButton("rename", "edit", Strings.quickNote.manageRename),
  delete: makeButton("delete", "trash", Strings.quickNote.manageDelete),
};

function makeButton(action: ManagerButton["action"], icon: string, tooltip: string): ManagerButton {
  return { action, iconPath: new vscode.ThemeIcon(icon), tooltip };
}

/**
 * "Manage Categories and Tags": one list of everything, each entry with buttons to rename, delete and
 * (for a category) change its file. After every change the list opens again with the new state,
 * until the user closes it.
 */
export function registerLabelCommands(deps: LabelCommandDependencies): void {
  const { context, logger, rootService, labelService } = deps;

  registerSafeCommand(context, logger, Commands.manageLabels, async () => {
    const root = rootService.getRootUri();
    if (!root || !rootService.hasRoot) {
      await offerSelectRoot(root ? Strings.root.notFound : Strings.root.noRootSelected);
      return;
    }
    for (;;) {
      const labels = await labelService.getLabels();
      const action = await showManager(labels);
      if (!action) {
        return;
      }
      try {
        await performLabelAction(labelService, action, labels);
      } catch (error) {
        // A damaged config file or a vanished notes folder: tell the user and stop, instead of looping on the error.
        reportError(logger, "Managing categories and tags", error);
        return;
      }
    }
  });
}

/**
 * One action of the manager or of the Tags & Categories view: create, rename, delete or change the file of an
 * entry. It asks what it needs, writes through the label service and tells the user with a status bar message.
 */
export async function performLabelAction(
  labelService: LabelService,
  action: ManagerAction,
  knownLabels?: Labels
): Promise<void> {
  const labels = knownLabels ?? (await labelService.getLabels());
  const text = Strings.quickNote;
  if (action.type === "create") {
    const names = action.kind === "category" ? labels.categories.map((c) => c.name) : labels.tags;
    const answer = await askNewLabel(labelService, action.kind, names);
    if (answer) {
      await labelService.create(action.kind, answer.name, { file: answer.file });
      const message =
        action.kind === "category"
          ? text.categoryCreated(answer.name.trim(), answer.file)
          : text.tagCreated(answer.name.trim());
      showStatus(message);
    }
    return;
  }

  if (action.type === "menu") {
    const next = await pickFromMenu(action);
    if (next) {
      await performLabelAction(labelService, next, labels);
    }
    return;
  }

  if (action.type === "rename") {
    const names = action.kind === "category" ? labels.categories.map((c) => c.name) : labels.tags;
    const newName = await askNewName(labelService, action.kind, action.name, names);
    if (newName) {
      await labelService.rename(action.kind, action.name, newName);
      showStatus(text.labelRenamed(action.kind, action.name, newName));
    }
    return;
  }

  if (action.type === "delete") {
    const choice = await vscode.window.showWarningMessage(
      text.deleteConfirm(action.kind, action.name),
      { modal: true, detail: action.file ? text.deleteCategoryFileDetail(action.file) : undefined },
      text.deleteAction
    );
    if (choice === text.deleteAction) {
      await labelService.remove(action.kind, action.name);
      showStatus(text.labelDeleted(action.kind, action.name));
    }
    return;
  }

  if (action.type === "keyword") {
    const kindOfEntry = action.kind;
    const current =
      kindOfEntry === "category"
        ? labels.categories.find((c) => c.name === action.name)?.keyword
        : labels.tagKeywords[action.name];
    const others =
      kindOfEntry === "category"
        ? labels.categories.flatMap((c) =>
            c.name !== action.name && c.keyword ? [{ name: c.name, keyword: c.keyword }] : []
          )
        : labels.tags.flatMap((t) =>
            t !== action.name && labels.tagKeywords[t]
              ? [{ name: t, keyword: labels.tagKeywords[t] }]
              : []
          );
    const typed = await vscode.window.showInputBox({
      title: text.keywordTitle(kindOfEntry, action.name),
      prompt: text.keywordPrompt(kindOfEntry),
      value: current,
      validateInput: (value) => labelService.validateKeyword(value, others),
    });
    if (typed === undefined) {
      return;
    }
    const keyword = typed.trim();
    await labelService.setKeyword(kindOfEntry, action.name, keyword === "" ? undefined : keyword);
    showStatus(
      keyword === ""
        ? text.keywordCleared(kindOfEntry, action.name)
        : text.keywordSet(kindOfEntry, action.name, keyword)
    );
    return;
  }

  // action.type === "file"
  const chosen = await askCategoryFile(
    text.categoryFileTitle(action.name),
    action.file ?? LabelService.suggestFileName(action.name)
  );
  if (chosen === undefined) {
    return;
  }
  await labelService.setCategoryFile(action.name, chosen ?? undefined);
  showStatus(
    chosen === null
      ? text.categoryFileCleared(action.name)
      : text.categoryFileSet(action.name, chosen)
  );
}

/** The actions of one entry, for when its row is picked instead of one of its buttons. */
async function pickFromMenu(entry: EntryAction): Promise<ManagerAction | undefined> {
  const text = Strings.quickNote;
  const items: (vscode.QuickPickItem & { action: "rename" | "delete" | "file" | "keyword" })[] = [];
  if (entry.kind === "category") {
    items.push({ label: text.manageMenuChangeFile, action: "file" });
  }
  items.push(
    { label: text.manageMenuKeyword, action: "keyword" },
    { label: text.manageMenuRename, action: "rename" },
    { label: text.manageMenuDelete, action: "delete" }
  );
  const picked = await vscode.window.showQuickPick(items, {
    title: text.manageMenuTitle(text.kindName(entry.kind), entry.name),
  });
  return picked
    ? { type: picked.action, kind: entry.kind, name: entry.name, file: entry.file }
    : undefined;
}

/** Shows the list and answers with what was chosen, or undefined when it was closed. */
function showManager(labels: Labels): Promise<ManagerAction | undefined> {
  const text = Strings.quickNote;
  const quickPick = vscode.window.createQuickPick<ManagerItem>();
  quickPick.title = text.manageTitle;
  quickPick.placeholder = text.managePlaceholder;
  // Typing also filters by the file of a category.
  quickPick.matchOnDescription = true;

  const separator = (label: string): ManagerItem => ({
    label,
    kind: vscode.QuickPickItemKind.Separator,
  });
  const info = (label: string): ManagerItem => ({ label, alwaysShow: true });
  quickPick.items = [
    separator(text.manageCategories),
    ...(labels.categories.length === 0
      ? [info(text.manageNoCategories)]
      : labels.categories.map((category): ManagerItem => ({
          label: category.name,
          description: category.keyword
            ? text.withKeyword(category.file ?? text.categoryUsesQuickNoteFile, category.keyword)
            : (category.file ?? text.categoryUsesQuickNoteFile),
          buttons: [buttons.file, buttons.keyword, buttons.rename, buttons.delete],
          entry: { kind: "category", name: category.name, file: category.file },
        }))),
    separator(text.manageTags),
    ...(labels.tags.length === 0
      ? [info(text.manageNoTags)]
      : labels.tags.map((tag): ManagerItem => ({
          label: tag,
          description: labels.tagKeywords[tag] ? `"${labels.tagKeywords[tag]}"` : undefined,
          buttons: [buttons.keyword, buttons.rename, buttons.delete],
          entry: { kind: "tag", name: tag },
        }))),
    separator(""),
    { label: text.manageCreateCategory, create: "category", alwaysShow: true },
    { label: text.manageCreateTag, create: "tag", alwaysShow: true },
  ];

  return new Promise((resolve) => {
    let settled = false;
    const finish = (action: ManagerAction | undefined): void => {
      if (!settled) {
        settled = true;
        resolve(action);
        quickPick.dispose();
      }
    };
    quickPick.onDidTriggerItemButton((event) => {
      const entry = event.item.entry;
      const button = event.button as ManagerButton;
      if (entry) {
        finish({ type: button.action, kind: entry.kind, name: entry.name, file: entry.file });
      }
    });
    quickPick.onDidAccept(() => {
      const item = quickPick.selectedItems[0];
      if (item?.create) {
        finish({ type: "create", kind: item.create });
      } else if (item?.entry) {
        finish({
          type: "menu",
          kind: item.entry.kind,
          name: item.entry.name,
          file: item.entry.file,
        });
      }
    });
    quickPick.onDidHide(() => finish(undefined));
    quickPick.show();
  });
}
