import * as vscode from "vscode";
import { BuiltinCommands } from "../constants/commands";
import { ContextKeys } from "../constants/context";
import { uriOfTab } from "../util/tabUri";
import { ExcludeMatcher } from "./ExcludeMatcher";
import type { PathGuard } from "./PathGuard";
import { RootFolderService } from "./RootFolderService";

/**
 * Publishes the context key `noteRoot.activeInRoot`: true while the file in the active editor is a note of the notes
 * folder (inside it, and not hidden by the exclude patterns). Menus of the editor use it to offer "Move to…" only there.
 */
export class ActiveNoteService implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[];
  private current: boolean | undefined;

  constructor(
    private readonly rootService: RootFolderService,
    private readonly pathGuard: PathGuard,
    private readonly excludeMatcher: ExcludeMatcher
  ) {
    const update = (): void => void this.update();
    this.subscriptions = [
      vscode.window.onDidChangeActiveTextEditor(update),
      vscode.window.tabGroups.onDidChangeTabs(update),
      rootService.onDidChangeRoot(update),
      rootService.onDidChangeState(update),
      excludeMatcher.onDidChange(update),
    ];
  }

  /** Works out the key now. Call once at activation. */
  async initialize(): Promise<void> {
    await this.update();
  }

  dispose(): void {
    vscode.Disposable.from(...this.subscriptions).dispose();
  }

  private async update(): Promise<void> {
    const value = this.isNoteActive();
    if (value === this.current) {
      return;
    }
    this.current = value;
    await vscode.commands.executeCommand(
      BuiltinCommands.setContext,
      ContextKeys.activeInRoot,
      value
    );
  }

  private isNoteActive(): boolean {
    const uri = activeFileUri();
    if (
      !uri ||
      !this.rootService.hasRoot ||
      !this.pathGuard.isInsideRoot(uri, { allowRoot: false })
    ) {
      return false;
    }
    const relativePath = this.pathGuard.getRelativePath(uri);
    if (!relativePath) {
      return false;
    }
    const segments = relativePath.split("/");
    return !segments.some((segment, index) =>
      this.excludeMatcher.isExcluded(segment, segments.slice(0, index + 1).join("/"))
    );
  }
}

/** The file of the active editor tab (a text file, an image, a PDF...), or undefined. */
export function activeFileUri(): vscode.Uri | undefined {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const fromTab = tab ? uriOfTab(tab) : undefined;
  const uri = fromTab ?? vscode.window.activeTextEditor?.document.uri;
  return uri && uri.scheme === "file" ? uri : undefined;
}
