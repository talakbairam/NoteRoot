import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { RootStates } from "../constants/context";
import { Strings } from "../constants/strings";
import { performLabelAction } from "../commands/labelCommands";
import { reportError } from "../commands/safe";
import type { AdvancedModeService } from "../services/AdvancedModeService";
import type { AutoCategoryService } from "../services/AutoCategoryService";
import type { AutoTagPatternService } from "../services/AutoTagPatternService";
import { LabelService } from "../services/LabelService";
import { Logger } from "../services/Logger";
import { RootFolderService } from "../services/RootFolderService";
import { SettingsService } from "../services/SettingsService";
import type { TagNote } from "../services/TagIndexService";
import { LabelsTreeProvider } from "../tree/LabelsTreeProvider";
import { showStatus } from "../util/status";
import {
  parseLabelsPageMessage,
  type ExtensionToLabelsPageMessage,
  type LabelsPageModel,
  type LabelsPageTexts,
  type LabelsPageToExtensionMessage,
  type PageNote,
} from "./labelsMessages";

const PANEL_TYPE = "noteRoot.labelsPage";

/**
 * "NoteRoot Tags & Categories": everything the Tags & Categories view has, in an editor tab: the categories with their
 * files and keywords, the categories of every file, the tags with the notes that use them, the tag patterns, and the two
 * switches of the automatic features. The lists and the scan of the notes are the ones of the view (`LabelsTreeProvider`),
 * and every change is made by the same code as the view's menus (`performLabelAction`, the pattern commands), so
 * the questions and the rules are the same. The page only shows and asks; it never writes anything itself.
 */
export class LabelsPageProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  /** True while the current page has announced itself with `ready`. */
  private ready = false;
  /** The notes and files of the model last sent: the page names them by id or path and is not trusted with a path. */
  private notes = new Map<string, TagNote>();
  private files = new Set<string>();
  /** Makes a newer model win over an older one that was still scanning. */
  private generation = 0;
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly labelService: LabelService,
    private readonly labelsProvider: LabelsTreeProvider,
    private readonly rootService: RootFolderService,
    private readonly autoCategories: AutoCategoryService,
    private readonly autoTagPatterns: AutoTagPatternService,
    private readonly advancedMode: AdvancedModeService,
    private readonly settings: SettingsService,
    private readonly logger: Logger
  ) {
    // The view refreshes itself on every change of the lists, the notes folder, the files and the two switches.
    this.subscriptions = [
      labelsProvider.onDidChangeTreeData(() => void this.push("update")),
      advancedMode.onDidChange(() => void this.push("update")),
    ];
  }

  /** Opens the page in a new tab, or shows the one that is open. */
  open(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const pagesRoot = vscode.Uri.joinPath(this.extensionUri, "webview");
    const panel = vscode.window.createWebviewPanel(
      PANEL_TYPE,
      Strings.labelsPage.title,
      vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [pagesRoot] }
    );
    this.panel = panel;
    this.ready = false;
    panel.webview.html = this.renderHtml(panel.webview, pagesRoot);
    panel.webview.onDidReceiveMessage((raw: unknown) => {
      const message = parseLabelsPageMessage(raw);
      if (!message) {
        this.logger.warn("Ignored an invalid message from the Tags & Categories page.");
        return;
      }
      this.handleMessage(message).catch((error: unknown) =>
        reportError(this.logger, "Tags & Categories page", error)
      );
    });
    panel.onDidDispose(() => {
      if (this.panel === panel) {
        this.panel = undefined;
        this.ready = false;
      }
    });
  }

  dispose(): void {
    this.panel?.dispose();
    vscode.Disposable.from(...this.subscriptions).dispose();
  }

  private async handleMessage(message: LabelsPageToExtensionMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        return this.push("init");
      case "refresh":
        this.labelsProvider.refresh();
        return;
      case "selectRoot":
        await vscode.commands.executeCommand(Commands.selectRootFolder);
        return;
      case "create":
        await performLabelAction(this.labelService, { type: "create", kind: message.kind });
        return;
      case "entry":
        return this.entryAction(message);
      case "pattern":
        if (message.action === "add") {
          await vscode.commands.executeCommand(Commands.addTagPattern);
        } else {
          await vscode.commands.executeCommand(
            message.action === "edit" ? Commands.editTagPattern : Commands.deleteTagPattern,
            message.pattern
          );
        }
        return;
      case "switch":
        await vscode.commands.executeCommand(
          message.id === "autoCategories"
            ? message.on
              ? Commands.enableAutoCategories
              : Commands.disableAutoCategories
            : message.on
              ? Commands.enableAutoTagPatterns
              : Commands.disableAutoTagPatterns
        );
        return;
      case "openNote": {
        const note = this.notes.get(message.id);
        if (note) {
          await vscode.commands.executeCommand(
            Commands.openAtLine,
            note.uri,
            note.line,
            note.column,
            note.length
          );
        }
        return;
      }
      case "openFile": {
        const root = this.rootService.getRootUri();
        if (root && this.files.has(message.path)) {
          await vscode.commands.executeCommand(
            Commands.openItem,
            vscode.Uri.joinPath(root, ...message.path.split("/"))
          );
        }
        return;
      }
    }
  }

  /** One action on a category or tag. The entry must exist now: the page may be a little behind. */
  private async entryAction(
    message: Extract<LabelsPageToExtensionMessage, { type: "entry" }>
  ): Promise<void> {
    const labels = await this.labelService.getLabels();
    const { kind, name } = message;
    const category = labels.categories.find((entry) => entry.name === name);
    if (kind === "category" ? !category : !labels.tags.includes(name)) {
      return;
    }
    const text = Strings.quickNote;
    if (message.action === "removeFile") {
      await this.labelService.setCategoryFile(name, undefined);
      showStatus(text.categoryFileCleared(name));
    } else if (message.action === "removeKeyword") {
      await this.labelService.setKeyword(kind, name, undefined);
      showStatus(text.keywordCleared(kind, name));
    } else {
      await performLabelAction(
        this.labelService,
        { type: message.action, kind, name, file: category?.file },
        labels
      );
    }
  }

  /** Messages for a page that is not ready are dropped: its `init` carries the current model anyway. */
  private post(message: ExtensionToLabelsPageMessage): void {
    if (this.panel && this.ready) {
      this.panel.webview
        .postMessage(message)
        .then(undefined, (error: unknown) =>
          this.logger.error("Could not post to the Tags & Categories page.", error)
        );
    }
  }

  /**
   * Sends the model. The lists come first, at once; the notes of the tags need a scan of the notes folder, so a second model
   * with them follows when it is done (the view keeps the scan until something changes, so a later look is quick).
   */
  private async push(type: "init" | "update"): Promise<void> {
    if (type === "init") {
      this.ready = true;
    }
    if (!this.panel || !this.ready) {
      return;
    }
    const generation = ++this.generation;
    try {
      const quick = await this.buildModel(false);
      if (generation !== this.generation) {
        return;
      }
      this.send(type, quick);
      if (quick.problem !== undefined) {
        return;
      }
      const full = await this.buildModel(true);
      if (generation === this.generation) {
        this.send("update", full);
      }
    } catch (error) {
      this.logger.warn(
        `Could not read the tags and categories: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private send(type: "init" | "update", model: LabelsPageModel): void {
    this.post(type === "init" ? { type, texts: this.texts(), model } : { type, model });
  }

  private rootProblem(): string | undefined {
    switch (this.rootService.state) {
      case RootStates.noRoot:
        return Strings.root.noRootSelected;
      case RootStates.missing:
        return Strings.root.notFound;
      default:
        return undefined;
    }
  }

  private async exists(relativePath: string): Promise<boolean> {
    const root = this.rootService.getRootUri();
    if (!root) {
      return false;
    }
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, ...relativePath.split("/")));
      return true;
    } catch {
      return false; // Not there (yet): the first note of a category creates its file.
    }
  }

  private async buildModel(withNotes: boolean): Promise<LabelsPageModel> {
    const quickNoteFile = this.settings.quickNoteFile.replace(/\\/g, "/").replace(/^(\.?\/)+/, "");
    const base: LabelsPageModel = {
      problem: this.rootProblem(),
      advanced: this.advancedMode.isEnabled,
      autoCategories: this.autoCategories.isEnabled,
      autoTagPatterns: this.autoTagPatterns.isEnabled,
      scanning: !withNotes,
      quickNoteFile,
      quickNoteFileExists: false,
      categories: [],
      everyFile: [],
      everyFileTruncated: false,
      tags: [],
      patterns: [],
    };
    if (!this.rootService.hasRoot) {
      return base;
    }
    const { categories, tags, tagKeywords } = await this.labelService.getLabels();
    const patterns = await this.labelService.getTagPatterns();
    const tagNotes = withNotes ? await this.labelsProvider.tagNotes() : undefined;
    const patternMatches = withNotes ? await this.labelsProvider.patternMatches() : undefined;

    // The ids are made again with every model that has notes; the page is given only the ones of the model it shows.
    const notes = new Map<string, TagNote>();
    const files = new Set<string>();
    const pageNote = (note: TagNote): PageNote => {
      const id = `n${notes.size}`;
      notes.set(id, note);
      return { id, path: note.relativePath, line: note.line + 1 };
    };

    const stored = categories.map((category) => {
      if (category.file) {
        files.add(category.file);
      }
      return category;
    });
    const fromFiles = (await this.labelService.getChoosableCategories()).slice(categories.length);
    for (const category of fromFiles) {
      if (category.file) {
        files.add(category.file);
      }
    }
    files.add(quickNoteFile);

    const model: LabelsPageModel = {
      ...base,
      quickNoteFileExists: await this.exists(quickNoteFile),
      categories: await Promise.all(
        stored.map(async (category) => ({
          name: category.name,
          file: category.file,
          keyword: category.keyword,
          fileExists: category.file ? await this.exists(category.file) : false,
        }))
      ),
      everyFile: fromFiles.flatMap((category) =>
        category.file ? [{ label: category.label ?? category.name, path: category.file }] : []
      ),
      everyFileTruncated: this.autoCategories.truncated,
      tags: tags.map((name) => ({
        name,
        keyword: tagKeywords[name],
        notes: tagNotes ? (tagNotes.get(name) ?? []).map(pageNote) : undefined,
      })),
      patterns: patterns.map((pattern) => ({
        pattern,
        tags: patternMatches
          ? (patternMatches.get(pattern) ?? []).map((found) => ({
              name: found.name,
              notes: found.notes.map(pageNote),
            }))
          : undefined,
      })),
    };
    // Only a model with notes replaces the notes, so a click on a note of the page before it still finds it.
    if (withNotes) {
      this.notes = notes;
    }
    this.files = files;
    return model;
  }

  private texts(): LabelsPageTexts {
    const text = Strings.labelsPage;
    return { ...text, selectFolder: Strings.root.selectFolderAction };
  }

  private renderHtml(webview: vscode.Webview, pagesRoot: vscode.Uri): string {
    const nonce = randomBytes(16).toString("base64");
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(pagesRoot, "labelsPage", "labelsPage.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(pagesRoot, "labelsPage", "labelsPage.js")
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${styleUri}">
	<title>${escapeHtml(Strings.labelsPage.title)}</title>
</head>
<body>
	<main id="page"></main>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
