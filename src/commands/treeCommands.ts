import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { type SortOrder } from "../constants/settings";
import { ViewIds } from "../constants/context";
import { Strings } from "../constants/strings";
import { Logger } from "../services/Logger";
import { PathGuard } from "../services/PathGuard";
import { SettingsService } from "../services/SettingsService";
import { ShowHiddenService } from "../services/ShowHiddenService";
import { ShowEncryptedService } from "../services/ShowEncryptedService";
import { ShowUnsyncedService } from "../services/ShowUnsyncedService";
import { ShowNoTagService } from "../services/ShowNoTagService";
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
  showNoTag: ShowNoTagService;
  showEncrypted: ShowEncryptedService;
  showUnsynced: ShowUnsyncedService;
}

export function registerTreeCommands(deps: TreeCommandDependencies): void {
  const {
    context,
    logger,
    pathGuard,
    settings,
    navigator,
    treeState,
    showHidden,
    showNoTag,
    showEncrypted,
    showUnsynced,
  } = deps;
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

  // The same two-command swap for the "no tags" marks (context key `noteRoot.showNoTag`).
  registerSafeCommand(context, logger, Commands.showNoTagItems, async () => {
    await showNoTag.setEnabled(true);
    showStatus(Strings.tree.noTagShown);
  });
  registerSafeCommand(context, logger, Commands.hideNoTagItems, async () => {
    await showNoTag.setEnabled(false);
    showStatus(Strings.tree.noTagHidden);
  });

  // And for the "encrypted" marks (context key `noteRoot.showEncrypted`).
  registerSafeCommand(context, logger, Commands.showEncryptedItems, async () => {
    await showEncrypted.setEnabled(true);
    showStatus(Strings.tree.encryptedShown);
  });
  registerSafeCommand(context, logger, Commands.hideEncryptedItems, async () => {
    await showEncrypted.setEnabled(false);
    showStatus(Strings.tree.encryptedHidden);
  });

  // And for the "not synced" marks (context key `noteRoot.showUnsynced`).
  registerSafeCommand(context, logger, Commands.showUnsyncedItems, async () => {
    await showUnsynced.setEnabled(true);
    showStatus(Strings.tree.unsyncedShown);
  });
  registerSafeCommand(context, logger, Commands.hideUnsyncedItems, async () => {
    await showUnsynced.setEnabled(false);
    showStatus(Strings.tree.unsyncedHidden);
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
