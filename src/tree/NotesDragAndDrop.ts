import * as vscode from "vscode";
import {
  askMoveConflict,
  confirmPermanentDelete,
  confirmQuickNoteChange,
} from "../commands/dialogs";
import { reportError } from "../commands/safe";
import { Strings } from "../constants/strings";
import { FileOperationsService } from "../services/FileOperationsService";
import { Logger } from "../services/Logger";
import { PathGuard } from "../services/PathGuard";
import { RootFolderService } from "../services/RootFolderService";
import { RootMissingError } from "../util/errors";
import { parentOf } from "../util/uri";
import { NoteItem } from "./NoteItem";
import { TreeNavigator } from "./TreeNavigator";

/** The mime type is the tree view id in lower case, prefixed by VS Code. */
export const TREE_MIME_TYPE = "application/vnd.code.tree.noteroot.tree";

/** Mime types of drops from outside VS Code: files from the file manager, and lists of URIs. */
const FILES_MIME_TYPE = "files";
const URI_LIST_MIME_TYPE = "text/uri-list";

/**
 * Moves items inside the tree, and copies files and folders dropped from the operating system into it.
 * Dragging items out of the tree is not supported.
 */
export class NotesDragAndDrop implements vscode.TreeDragAndDropController<NoteItem> {
  readonly dragMimeTypes = [TREE_MIME_TYPE];
  readonly dropMimeTypes = [TREE_MIME_TYPE, FILES_MIME_TYPE, URI_LIST_MIME_TYPE];

  constructor(
    private readonly fileOps: FileOperationsService,
    private readonly pathGuard: PathGuard,
    private readonly rootService: RootFolderService,
    private readonly navigator: TreeNavigator,
    private readonly logger: Logger
  ) {}

  handleDrag(source: readonly NoteItem[], dataTransfer: vscode.DataTransfer): void {
    // URIs travel as strings: they are validated again on drop, as the data is not trusted.
    dataTransfer.set(
      TREE_MIME_TYPE,
      new vscode.DataTransferItem(source.map((item) => item.uri.toString()))
    );
  }

  async handleDrop(target: NoteItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    try {
      const sources = this.readSources(dataTransfer);
      if (sources.length > 0) {
        await this.moveInto(sources, this.targetFolder(target));
        return;
      }
      const external = await this.readExternalSources(dataTransfer);
      if (external.length > 0) {
        await this.importInto(external, this.targetFolder(target));
      }
    } catch (error) {
      reportError(this.logger, "Moving items", error);
    }
  }

  private async moveInto(dragged: vscode.Uri[], targetFolder: vscode.Uri): Promise<void> {
    // Throws for a folder dropped into itself, before anything is asked or moved.
    const planned = this.fileOps.planMove(dragged, targetFolder);
    if (planned.length === 0) {
      return; // Everything is already in that folder.
    }
    const affectsQuickNote = planned.find((uri) => this.fileOps.involvesQuickNoteFile(uri));
    if (affectsQuickNote) {
      const isFolder = !this.fileOps.isQuickNoteFile(affectsQuickNote);
      if (!(await confirmQuickNoteChange("move", isFolder, this.fileOps.quickNoteFilePath))) {
        return;
      }
    }

    const result = await this.fileOps.moveItems(planned, targetFolder, {
      onConflict: (name) => askMoveConflict(name, planned.length > 1),
      confirmPermanentDelete: () => confirmPermanentDelete(1),
    });
    await this.navigator.refreshAndReveal(result.moved, { focus: false });
    if (result.failed.length > 0) {
      void vscode.window.showErrorMessage(
        Strings.fileOps.someFailed(result.failed.length, "moved")
      );
    }
  }

  private async importInto(dropped: vscode.Uri[], targetFolder: vscode.Uri): Promise<void> {
    const result = await this.fileOps.importItems(dropped, targetFolder, {
      onConflict: (name) => askMoveConflict(name, dropped.length > 1),
      confirmPermanentDelete: () => confirmPermanentDelete(1),
    });
    await this.navigator.refreshAndReveal(result.imported, { focus: false });
    if (result.failed.length > 0) {
      void vscode.window.showErrorMessage(
        Strings.fileOps.someFailed(result.failed.length, "imported")
      );
    }
  }

  /** Drop on a folder = into it, on a file = beside it, on empty space = into the root. */
  private targetFolder(target: NoteItem | undefined): vscode.Uri {
    if (!target) {
      const root = this.rootService.getRootUri();
      if (!root) {
        throw new RootMissingError();
      }
      return root;
    }
    // Links to folders are never entered, so they count like files.
    return target.kind === "folder" ? target.uri : parentOf(target.uri);
  }

  /**
   * Files and folders dropped from outside VS Code. The data is not trusted: only `file:` locations
   * are accepted, and every one is checked again by the service. Nothing is read from them here.
   */
  private async readExternalSources(dataTransfer: vscode.DataTransfer): Promise<vscode.Uri[]> {
    const found = new Map<string, vscode.Uri>();
    const add = (uri: vscode.Uri | undefined): void => {
      if (uri && uri.scheme === "file") {
        found.set(uri.toString(), uri);
      }
    };
    dataTransfer.forEach((item) => add(item.asFile()?.uri));
    const list = dataTransfer.get(URI_LIST_MIME_TYPE);
    if (list) {
      for (const line of (await list.asString()).split(/\r?\n/)) {
        if (line.trim() !== "" && !line.startsWith("#")) {
          try {
            add(vscode.Uri.parse(line.trim(), true));
          } catch {
            // Not a valid URI: ignored.
          }
        }
      }
    }
    return [...found.values()];
  }

  private readSources(dataTransfer: vscode.DataTransfer): vscode.Uri[] {
    const value: unknown = dataTransfer.get(TREE_MIME_TYPE)?.value;
    if (
      !Array.isArray(value) ||
      !value.every((entry): entry is string => typeof entry === "string")
    ) {
      return [];
    }
    const uris = value.map((entry) => vscode.Uri.parse(entry));
    for (const uri of uris) {
      this.pathGuard.assertInsideRoot(uri, { allowRoot: false });
    }
    return uris;
  }
}
