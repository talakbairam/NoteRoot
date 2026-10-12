import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { Strings } from "../constants/strings";
import { Logger } from "../services/Logger";
import { PathGuard } from "../services/PathGuard";
import { SearchResult, SearchService } from "../services/SearchService";
import { SettingsService } from "../services/SettingsService";
import { TreeNavigator } from "../tree/TreeNavigator";
import { RootMissingError } from "../util/errors";
import { offerSelectRoot } from "./dialogs";
import { openFile } from "./openFile";
import { registerSafeCommand } from "./safe";

export interface SearchCommandDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  pathGuard: PathGuard;
  settings: SettingsService;
  navigator: TreeNavigator;
  searchService: SearchService;
}

const SEARCH_DEBOUNCE_MS = 250;
const LIST_UPDATE_MS = 100;

/** One row of the result list. Rows without a result (messages) do nothing when chosen. */
interface ResultItem extends vscode.QuickPickItem {
  result?: SearchResult;
}

export function registerSearchCommands(deps: SearchCommandDependencies): void {
  const { context, logger } = deps;

  registerSafeCommand(context, logger, Commands.search, async () => {
    try {
      // Fails early, with the usual "select a folder" offer, when there is nothing to search.
      await deps.searchService.requireExistingRoot();
    } catch (error) {
      if (error instanceof RootMissingError) {
        await offerSelectRoot(error.message);
        return;
      }
      throw error;
    }
    showSearch(deps);
  });
}

/** Live search: results appear while typing and are replaced when the text changes. */
function showSearch(deps: SearchCommandDependencies): void {
  const { context, logger, searchService } = deps;
  const quickPick = vscode.window.createQuickPick<ResultItem>();
  quickPick.title = Strings.search.title;
  quickPick.placeholder = Strings.search.placeholder;
  // The list is built by the search, not by VS Code filtering labels, so every row must stay visible.
  quickPick.matchOnDescription = false;
  quickPick.matchOnDetail = false;

  let debounceTimer: NodeJS.Timeout | undefined;
  let running: vscode.CancellationTokenSource | undefined;

  const stop = (): void => {
    running?.cancel();
    running?.dispose();
    running = undefined;
    quickPick.busy = false;
  };

  const run = async (query: string): Promise<void> => {
    stop();
    const trimmed = query.trim();
    if (trimmed.length < searchService.minQueryLength) {
      quickPick.items = [];
      return;
    }
    const source = new vscode.CancellationTokenSource();
    running = source;
    quickPick.busy = true;

    const items: ResultItem[] = [];
    let lastUpdate = 0;
    const publish = (): void => {
      quickPick.items = [...items];
      lastUpdate = Date.now();
    };
    try {
      for await (const result of searchService.search(trimmed, source.token)) {
        items.push(toItem(result));
        if (Date.now() - lastUpdate >= LIST_UPDATE_MS) {
          publish();
        }
      }
      if (source.token.isCancellationRequested) {
        return; // A newer search already took over the list.
      }
      if (items.length === 0) {
        items.push(message(Strings.search.noResults(trimmed)));
      } else if (items.length >= searchService.resultLimit) {
        items.push(message(Strings.search.limited(searchService.resultLimit)));
      }
      publish();
    } catch (error) {
      logger.error("Search failed.", error);
      if (!source.token.isCancellationRequested) {
        quickPick.items = [message(Strings.common.genericFailure)];
      }
    } finally {
      if (running === source) {
        quickPick.busy = false;
      }
    }
  };

  quickPick.onDidChangeValue((value) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void run(value), SEARCH_DEBOUNCE_MS);
  });

  quickPick.onDidAccept(() => {
    const result = quickPick.selectedItems[0]?.result;
    if (!result) {
      return;
    }
    quickPick.hide();
    open(deps, result).catch((error: unknown) => {
      logger.error("Could not open the search result.", error);
      void vscode.window.showErrorMessage(Strings.common.genericFailure);
    });
  });

  quickPick.onDidHide(() => {
    clearTimeout(debounceTimer);
    stop();
    quickPick.dispose();
  });
  context.subscriptions.push(quickPick);
  quickPick.show();
}

/** Opens a result: at the matching line for text matches, as a normal open otherwise. */
async function open(deps: SearchCommandDependencies, result: SearchResult): Promise<void> {
  const { logger, pathGuard, settings, navigator } = deps;
  pathGuard.assertInsideRoot(result.uri, { allowRoot: false });
  // Show it in the tree first. The editor then takes the focus.
  await navigator.reveal(result.uri, { focus: result.isFolder });
  if (result.isFolder) {
    return;
  }
  const match = result.textMatch;
  if (match) {
    const range = new vscode.Range(
      match.line,
      match.column,
      match.line,
      match.column + match.length
    );
    await vscode.window.showTextDocument(result.uri, { selection: range, preview: false });
    return;
  }
  await openFile({ logger, pathGuard, settings }, result.uri, { preview: false });
}

function toItem(result: SearchResult): ResultItem {
  const parent = result.relativePath.slice(
    0,
    Math.max(0, result.relativePath.length - result.name.length - 1)
  );
  return {
    label: `${result.isFolder ? "$(folder)" : "$(file)"} ${result.name}`,
    description: parent,
    detail: result.textMatch
      ? Strings.search.lineDetail(result.textMatch.line + 1, result.textMatch.snippet)
      : undefined,
    alwaysShow: true,
    result,
  };
}

function message(text: string): ResultItem {
  return { label: text, alwaysShow: true };
}
