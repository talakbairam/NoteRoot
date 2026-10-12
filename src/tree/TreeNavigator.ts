import * as vscode from "vscode";
import { Logger } from "../services/Logger";
import { PathGuard } from "../services/PathGuard";
import { RootFolderService } from "../services/RootFolderService";
import { NoteItem } from "./NoteItem";
import { NotesTreeProvider } from "./NotesTreeProvider";

const REVEAL_RETRY_DELAY_MS = 300;
/** Expand All stops here, so a huge notes folder cannot freeze the window. */
export const MAX_EXPAND_ALL_FOLDERS = 300;

/**
 * Refreshes the tree and reveals items after create, rename, move and delete.
 * The tree view is attached after creation, because the view needs the drag and drop
 * controller, which in turn needs this navigator.
 */
export class TreeNavigator {
  private treeView: vscode.TreeView<NoteItem> | undefined;

  constructor(
    private readonly provider: NotesTreeProvider,
    private readonly rootService: RootFolderService,
    private readonly pathGuard: PathGuard,
    private readonly logger: Logger
  ) {}

  attach(treeView: vscode.TreeView<NoteItem>): void {
    this.treeView = treeView;
  }

  get selection(): readonly NoteItem[] {
    return this.treeView?.selection ?? [];
  }

  /** Re-reads the folder state (for example `empty` to `ready`) and the tree. */
  async refresh(): Promise<void> {
    await this.rootService.refresh();
    this.provider.refresh();
  }

  /** Selects an existing item in the tree and expands its parent folders, without refreshing. */
  async reveal(uri: vscode.Uri, options: { focus: boolean }): Promise<void> {
    const treeView = this.treeView;
    const relativePath = this.pathGuard.getRelativePath(uri);
    const item = relativePath ? await this.provider.resolveItem(relativePath) : undefined;
    if (treeView && item) {
      await this.tryReveal(treeView, item, options.focus);
    }
  }

  /**
   * Expands every folder, breadth first, up to `MAX_EXPAND_ALL_FOLDERS`. Symbolic links to folders
   * are not folders for the tree, so they are skipped. Returns false when it stopped at the limit.
   */
  async expandAll(): Promise<boolean> {
    const treeView = this.treeView;
    if (!treeView) {
      return true;
    }
    const queue: (NoteItem | undefined)[] = [undefined];
    let expanded = 0;
    while (queue.length > 0) {
      const parent = queue.shift();
      for (const child of await this.provider.getChildren(parent)) {
        if (child.kind !== "folder") {
          continue;
        }
        if (expanded >= MAX_EXPAND_ALL_FOLDERS) {
          return false;
        }
        expanded++;
        try {
          await treeView.reveal(child, { select: false, focus: false, expand: true });
        } catch (error) {
          this.logger.debug(
            `Could not expand "${child.relativePath}": ${error instanceof Error ? error.message : String(error)}`
          );
          continue;
        }
        queue.push(child);
      }
    }
    return true;
  }

  /** Refreshes, then selects the first of the given items and expands its parent folders. */
  async refreshAndReveal(uris: readonly vscode.Uri[], options: { focus: boolean }): Promise<void> {
    await this.refresh();
    const treeView = this.treeView;
    if (!treeView || uris.length === 0) {
      return;
    }
    for (const uri of uris) {
      const relativePath = this.pathGuard.getRelativePath(uri);
      const item = relativePath ? await this.provider.resolveItem(relativePath) : undefined;
      if (item && (await this.tryReveal(treeView, item, options.focus))) {
        return;
      }
    }
  }

  private async tryReveal(
    treeView: vscode.TreeView<NoteItem>,
    item: NoteItem,
    focus: boolean
  ): Promise<boolean> {
    // The first attempt can run before the refreshed tree has loaded, so one retry is allowed.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await treeView.reveal(item, { select: true, focus, expand: false });
        return true;
      } catch (error) {
        if (attempt === 1) {
          this.logger.debug(
            `Could not reveal "${item.relativePath}": ${error instanceof Error ? error.message : String(error)}`
          );
        } else {
          await new Promise((resolve) => setTimeout(resolve, REVEAL_RETRY_DELAY_MS));
        }
      }
    }
    return false;
  }
}
