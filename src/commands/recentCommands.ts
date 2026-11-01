import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { Logger } from "../services/Logger";
import { Strings } from "../constants/strings";
import { PinnedRecentSwitches } from "../services/PinnedRecentSwitches";
import { RecentNotesService } from "../services/RecentNotesService";
import { showStatus } from "../util/status";
import { NoteItem } from "../tree/NoteItem";
import { TreeNavigator } from "../tree/TreeNavigator";
import { registerSafeCommand } from "./safe";

export interface RecentCommandDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  recentService: RecentNotesService;
  pinnedRecentSwitches: PinnedRecentSwitches;
  navigator: TreeNavigator;
}

export function registerRecentCommands(deps: RecentCommandDependencies): void {
  const { context, logger, recentService, pinnedRecentSwitches, navigator } = deps;

  // The buttons of the Pinned and Recent rows: two commands for each group that swap, because a contributed command cannot
  // change its own title (the context keys `noteRoot.pinnedOn` and `noteRoot.recentOn` decide which one is shown).
  const text = Strings.pinnedRecent;
  registerSafeCommand(context, logger, Commands.enablePinned, async () => {
    await pinnedRecentSwitches.setEnabled("pinned", true);
    showStatus(text.pinnedOn);
  });
  registerSafeCommand(context, logger, Commands.disablePinned, async () => {
    await pinnedRecentSwitches.setEnabled("pinned", false);
    showStatus(text.pinnedOff);
  });
  registerSafeCommand(context, logger, Commands.enableRecent, async () => {
    await pinnedRecentSwitches.setEnabled("recent", true);
    recentService.setRecording(true);
    showStatus(text.recentOn);
  });
  registerSafeCommand(context, logger, Commands.disableRecent, async () => {
    await pinnedRecentSwitches.setEnabled("recent", false);
    recentService.setRecording(false);
    showStatus(text.recentOff);
  });

  registerSafeCommand(context, logger, Commands.clearRecent, () => {
    recentService.clear();
  });

  registerSafeCommand(context, logger, Commands.removeFromRecent, (item?: unknown) => {
    if (item instanceof NoteItem) {
      recentService.remove(item.relativePath);
    }
  });

  registerSafeCommand(context, logger, Commands.revealInTree, async (item?: unknown) => {
    if (item instanceof NoteItem) {
      await navigator.reveal(item.uri, { focus: true });
    }
  });
}
