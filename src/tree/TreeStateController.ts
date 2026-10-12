import * as vscode from "vscode";
import { Logger } from "../services/Logger";
import { RootFolderService } from "../services/RootFolderService";
import { StateService, type TreeState } from "../services/StateService";
import { NoteItem } from "./NoteItem";
import { NotesTreeProvider } from "./NotesTreeProvider";

/**
 * Remembers which folders are expanded and which item is selected (per root, per machine)
 * and restores that when the tree is shown. Paths that no longer exist are dropped silently.
 */
export class TreeStateController implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];
  private expanded = new Set<string>();
  private selected: string | undefined;
  /** Root whose saved state is currently loaded into memory. */
  private loadedKey: string | undefined;
  private restorePending = false;
  private restoring = false;

  constructor(
    private readonly treeView: vscode.TreeView<NoteItem>,
    private readonly provider: NotesTreeProvider,
    private readonly rootService: RootFolderService,
    private readonly stateService: StateService,
    private readonly logger: Logger
  ) {
    this.subscriptions.push(
      treeView.onDidExpandElement((event) => this.onExpanded(event.element, true)),
      treeView.onDidCollapseElement((event) => this.onExpanded(event.element, false)),
      treeView.onDidChangeSelection((event) => this.onSelection(event.selection[0])),
      // reveal() would force the view open, so restoring waits until the user can see the tree.
      treeView.onDidChangeVisibility(() => this.sync()),
      rootService.onDidChangeState(() => this.sync()),
      rootService.onDidChangeRoot(() => this.sync())
    );
    this.sync();
  }

  /** Forget all expanded folders, for the Collapse All button. */
  clearExpanded(): void {
    this.expanded.clear();
    this.save();
  }

  dispose(): void {
    vscode.Disposable.from(...this.subscriptions).dispose();
  }

  private currentKey(): string | undefined {
    return this.rootService.getRootUri()?.fsPath;
  }

  /** Loads saved state when the root changed and starts a restore as soon as that is possible. */
  private sync(): void {
    const key = this.currentKey();
    if (key !== this.loadedKey) {
      this.loadedKey = key;
      const saved: TreeState = key ? this.stateService.getTreeState(key) : { expanded: [] };
      this.expanded = new Set(saved.expanded);
      this.selected = saved.selected;
      this.restorePending = key !== undefined;
    }
    if (
      this.restorePending &&
      !this.restoring &&
      this.treeView.visible &&
      this.rootService.hasRoot
    ) {
      this.restorePending = false;
      this.restore().catch((error: unknown) =>
        this.logger.error("Could not restore the tree state.", error)
      );
    }
  }

  private async restore(): Promise<void> {
    const key = this.loadedKey;
    if (!key) {
      return;
    }
    this.restoring = true;
    const keptExpanded: string[] = [];
    let keptSelected: string | undefined;
    try {
      // Parents before children, so every reveal finds its parent already loaded.
      const paths = [...this.expanded].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
      for (const path of paths) {
        if (this.currentKey() !== key) {
          return;
        }
        const item = await this.provider.resolveItem(path);
        if (item?.kind !== "folder") {
          continue; // Gone, hidden or no longer a folder: drop it.
        }
        try {
          await this.treeView.reveal(item, { expand: true, select: false, focus: false });
          keptExpanded.push(path);
        } catch (error) {
          this.logger.debug(
            `Could not restore folder "${path}": ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
      if (this.selected && this.currentKey() === key) {
        const item = await this.provider.resolveItem(this.selected);
        if (item) {
          try {
            await this.treeView.reveal(item, { select: true, focus: false, expand: false });
            keptSelected = this.selected;
          } catch (error) {
            this.logger.debug(
              `Could not restore the selection: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }
      if (this.currentKey() === key) {
        this.expanded = new Set(keptExpanded);
        this.selected = keptSelected;
        this.save();
      }
    } finally {
      this.restoring = false;
      this.sync(); // The root may have changed while restoring.
    }
  }

  private onExpanded(item: NoteItem, isExpanded: boolean): void {
    if (this.restoring) {
      return;
    }
    if (isExpanded) {
      this.expanded.add(item.relativePath);
    } else {
      this.expanded.delete(item.relativePath);
    }
    this.save();
  }

  private onSelection(item: NoteItem | undefined): void {
    if (this.restoring) {
      return;
    }
    this.selected = item?.relativePath;
    this.save();
  }

  private save(): void {
    const key = this.loadedKey;
    if (key) {
      this.stateService.setTreeState(key, {
        expanded: [...this.expanded],
        selected: this.selected,
      });
    }
  }
}

function depth(path: string): number {
  return path.split("/").length;
}
