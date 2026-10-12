import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { type SortOrder } from "../constants/settings";
import { ViewIds } from "../constants/context";
import { Strings } from "../constants/strings";
import { Logger } from "../services/Logger";
import { PathGuard } from "../services/PathGuard";
import { SettingsService } from "../services/SettingsService";
import { ShowHiddenService } from "../services/ShowHiddenService";
import { DoubleClickTracker } from "../tree/DoubleClickTracker";
import { TreeNavigator, MAX_EXPAND_ALL_FOLDERS } from "../tree/TreeNavigator";
import { TreeStateController } from "../tree/TreeStateController";
import { openFile } from "./openFile";
import { registerSafeCommand } from "./safe";
import { showStatus } from "../util/status";

export interface TreeCommandDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  pathGuard: PathGuard;
  settings: SettingsService;
  navigator: TreeNavigator;
  treeState: TreeStateController;
  showHidden: ShowHiddenService;
}

export function registerTreeCommands(deps: TreeCommandDependencies): void {
  const { context, logger, pathGuard, settings, navigator, treeState, showHidden } = deps;
  const clicks = new DoubleClickTracker(() => settings.doubleClickMs);

  // One entry with two commands, because a contributed command cannot change its own title: the menu shows Show Hidden Items while the
  // hidden items are not shown, and Hide Hidden Items while they are (the context key `noteRoot.showHidden`, published by the service).
  registerSafeCommand(context, logger, Commands.showHiddenItems, async () => {
    await showHidden.setEnabled(true);
    showStatus(Strings.tree.hiddenShown);
  });
  registerSafeCommand(context, logger, Commands.hideHiddenItems, async () => {
    await showHidden.setEnabled(false);
    showStatus(Strings.tree.hiddenHidden);
  });

  registerSafeCommand(context, logger, Commands.refresh, async () => {
    // Also the fallback when the file watcher misses changes outside the workspace.
    await navigator.refresh();
  });

  registerSafeCommand(context, logger, Commands.collapseAll, async () => {
    treeState.clearExpanded();
    await vscode.commands.executeCommand(`workbench.actions.treeView.${ViewIds.tree}.collapseAll`);
  });

  registerSafeCommand(context, logger, Commands.sortBy, async () => {
    const current = settings.sortOrder;
    const choices: { order: SortOrder; label: string; detail: string }[] = [
      { order: "name", label: Strings.sort.name, detail: Strings.sort.nameDetail },
      { order: "modified", label: Strings.sort.modified, detail: Strings.sort.modifiedDetail },
    ];
    const items = choices.map((item) => ({
      ...item,
      description: item.order === current ? Strings.sort.current : undefined,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      title: Strings.sort.title,
      placeHolder: Strings.sort.title,
    });
    if (picked && picked.order !== current) {
      await settings.setSortOrder(picked.order);
    }
  });

  registerSafeCommand(context, logger, Commands.expandAll, async () => {
    const complete = await navigator.expandAll();
    if (!complete) {
      void vscode.window.showInformationMessage(
        Strings.tree.expandAllLimit(MAX_EXPAND_ALL_FOLDERS)
      );
    }
  });

  // Target of the tree item click. Single click = preview tab, double click = permanent tab.
  // Save and Open of the Quick Note box: the note was just written, so the file is opened for good (not as a preview).
  registerSafeCommand(context, logger, Commands.openNoteFile, async (target: unknown) => {
    if (target instanceof vscode.Uri) {
      await openFile({ logger, pathGuard, settings }, target, { preview: false });
    }
  });

  registerSafeCommand(context, logger, Commands.openItem, async (target: unknown) => {
    if (!(target instanceof vscode.Uri)) {
      logger.warn("openItem was called without a file.");
      return;
    }
    const preview = !clicks.registerClick(target.toString());
    await openFile({ logger, pathGuard, settings }, target, { preview });
  });
}
