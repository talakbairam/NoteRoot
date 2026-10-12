import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { RootStates, ViewIds } from "../constants/context";
import { Strings } from "../constants/strings";
import { AdvancedModeService } from "../services/AdvancedModeService";
import { LabelService, type LabelKind } from "../services/LabelService";
import { Logger } from "../services/Logger";
import { QuickNoteService } from "../services/QuickNoteService";
import { RootFolderService } from "../services/RootFolderService";
import { StateService } from "../services/StateService";
import { NoteRootError, RootMissingError } from "../util/errors";
import { offerSelectRoot } from "../commands/dialogs";
import { askNewLabel } from "../commands/labelDialogs";
import { reportError } from "../commands/safe";
import {
  MAX_TEXT_LENGTH,
  parseWebviewMessage,
  type ExtensionToWebviewMessage,
  type WebviewToExtensionMessage,
} from "./messages";
import { SettingsService } from "../services/SettingsService";
import { showStatus } from "../util/status";

const RECENT_SUBMIT_IDS = 50;

/** The Quick Note box: a textarea and an OK button that append to one file in the notes root. */
export class QuickNoteViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  /** True while the current page of the webview has announced itself with `ready`. */
  private ready = false;
  private focusPending = false;
  private saving = false;
  private readonly recentSubmitIds: string[] = [];
  /** What the textarea holds right now, as last reported by the webview. */
  private currentText = "";
  /** Root key the text was last stored under ('' = no root). */
  private lastKey: string;
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly quickNoteService: QuickNoteService,
    private readonly stateService: StateService,
    private readonly rootService: RootFolderService,
    private readonly advancedMode: AdvancedModeService,
    private readonly labelService: LabelService,
    private readonly logger: Logger,
    private readonly settings: SettingsService
  ) {
    this.lastKey = this.rootKey();
    this.subscriptions = [
      rootService.onDidChangeRoot(() => this.onRootChanged()),
      // Like the Notes view: without a notes folder the box says so and offers to select one.
      rootService.onDidChangeState(() =>
        this.post({ type: "rootProblem", message: this.rootProblem() ?? null })
      ),
      // The title bar button switches the mode; the extra fields appear and disappear at once.
      advancedMode.onDidChange((enabled) => {
        this.post({ type: "advanced", enabled });
        void this.refreshTarget(); // Categories only decide the file while the mode is on.
      }),
      // A category or tag created from anywhere shows up in the dropdowns, and a category may now have another file.
      labelService.onDidChange((change) => {
        void this.pushOptions(change?.select);
        void this.refreshTarget();
      }),
      // Choosing a category changes where notes go.
      labelService.onDidChangeSelection(() => void this.refreshTarget()),
      // The header and the Save tooltip must follow the setting, the notes folder and the change command.
      quickNoteService.onDidChangeTarget(() => this.showTarget()),
    ];
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.ready = false;
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, "media");
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [mediaRoot] };
    webviewView.webview.html = this.renderHtml(webviewView.webview, mediaRoot);
    webviewView.description = this.quickNoteService.getTargetPath();

    webviewView.webview.onDidReceiveMessage((raw: unknown) => {
      const message = parseWebviewMessage(raw);
      if (!message) {
        this.logger.warn("Ignored an invalid message from the Quick Note view.");
        return;
      }
      this.handleMessage(message).catch((error: unknown) =>
        this.logger.error("Quick Note message failed.", error)
      );
    });
    // A hidden webview is destroyed (no retainContextWhenHidden) and announces itself again when shown.
    webviewView.onDidChangeVisibility(() => {
      if (!webviewView.visible) {
        this.ready = false;
      }
    });
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
        this.ready = false;
      }
    });
  }

  /** Reveals the view and puts the cursor in the textarea, also when the view does not exist yet. */
  async focus(): Promise<void> {
    this.focusPending = true;
    await vscode.commands.executeCommand(`${ViewIds.quickNote}.focus`);
    this.flushFocus();
  }

  dispose(): void {
    vscode.Disposable.from(...this.subscriptions).dispose();
  }

  private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        this.ready = true;
        this.currentText = this.stateService.getDraft(this.rootKey());
        this.lastKey = this.rootKey();
        await this.labelService.refreshActive();
        this.post({
          type: "init",
          draft: this.currentText,
          file: this.quickNoteService.getTargetPath(),
          advanced: this.advancedMode.isEnabled,
          rootProblem: this.rootProblem(),
          ...(await this.readLabels()),
        });
        this.flushFocus();
        break;
      case "draftChanged":
        this.onDraftChanged(message.text);
        break;
      case "submit":
        await this.onSubmit(message.id, message.text, message.open);
        break;
      case "selectRoot":
        await vscode.commands.executeCommand(Commands.selectRootFolder);
        break;
      case "pasteAndSave":
        await this.onPasteAndSave();
        break;
      case "createOption":
        await this.onCreateOption(message.kind, message.name);
        break;
      case "choiceChanged":
        this.labelService.setSelectedCategory(message.value);
        break;
      case "tagsChanged":
        this.labelService.setSelectedTags(message.tags);
        break;
    }
  }

  private onDraftChanged(text: string): void {
    if (this.saving) {
      return;
    }
    this.currentText = text;
    // Every window shares the stored draft. Only the one the user is typing in may write it.
    if (vscode.window.state.focused) {
      this.stateService.setDraft(this.rootKey(), text);
    }
  }

  private async onSubmit(id: string, text: string, open: boolean): Promise<void> {
    // A repeated message with the same id is a duplicate, not a second note.
    if (this.recentSubmitIds.includes(id) || this.saving) {
      return;
    }
    this.recentSubmitIds.push(id);
    if (this.recentSubmitIds.length > RECENT_SUBMIT_IDS) {
      this.recentSubmitIds.shift();
    }

    this.saving = true;
    const key = this.rootKey();
    let writtenTo: string | undefined;
    try {
      writtenTo = await this.quickNoteService.append(text);
      this.currentText = "";
      this.stateService.clearDraft(key); // Cleared only after a successful save.
      this.post({ type: "saved" });
    } catch (error) {
      this.logger.error("Could not save the Quick Note.", error);
      this.postError(error);
    } finally {
      this.saving = false;
    }
    // The note is saved by now: a file that cannot be opened is reported by the command and does not undo the save.
    const root = this.rootService.getRootUri();
    if (open && writtenTo !== undefined && root) {
      await vscode.commands.executeCommand(
        Commands.openNoteFile,
        vscode.Uri.joinPath(root, ...writtenTo.split("/"))
      );
    }
  }

  /**
   * Saves what is on the clipboard. The box and the stored draft are left alone: the user may be in
   * the middle of another note, and only the text from the clipboard is saved.
   */
  private async onPasteAndSave(): Promise<void> {
    if (this.saving) {
      return;
    }
    this.saving = true;
    try {
      await this.quickNoteService.appendClipboard();
      this.post({ type: "saved", keepText: true });
    } catch (error) {
      this.logger.error("Could not paste and save the clipboard.", error);
      this.postError(error);
    } finally {
      this.saving = false;
    }
  }

  /** What is wrong with the notes folder, in words, or undefined when it is fine. */
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

  private postError(error: unknown): void {
    this.post({
      type: "error",
      message: error instanceof NoteRootError ? error.message : Strings.quickNote.saveFailed,
      showSelectRoot: error instanceof RootMissingError,
    });
  }

  /** The lists for the dropdowns. A problem with the config file must not break the box, so it gives empty lists. */
  private async readLabels(): Promise<{
    categories: string[];
    tags: string[];
    categoryLabels: Record<string, string>;
    categoryTips: Record<string, string>;
    tagKeywords: Record<string, string>;
    categoryKeywords: Record<string, string>;
    tagPatterns: string[];
  }> {
    try {
      const { tags, tagKeywords } = await this.labelService.getLabels();
      const categories = await this.labelService.getChoosableCategories();
      const categoryLabels: Record<string, string> = {};
      const categoryTips: Record<string, string> = {};
      const categoryKeywords: Record<string, string> = {};
      const tagPatterns = await this.labelService.getTagPatternSources();
      for (const category of categories) {
        if (category.keyword !== undefined) {
          categoryKeywords[category.name] = category.keyword;
        }
        if (category.label !== undefined) {
          categoryLabels[category.name] = category.label;
        }
        if (category.file !== undefined) {
          categoryTips[category.name] = category.file;
        }
      }
      return {
        categories: categories.map((category) => category.name),
        tags,
        categoryLabels,
        categoryTips,
        tagKeywords,
        categoryKeywords,
        tagPatterns,
      };
    } catch (error) {
      this.logger.error("Could not read the categories and tags.", error);
      return {
        categories: [],
        tags: [],
        categoryLabels: {},
        categoryTips: {},
        tagKeywords: {},
        categoryKeywords: {},
        tagPatterns: [],
      };
    }
  }

  private async pushOptions(select?: { kind: LabelKind; value: string }): Promise<void> {
    this.post({ type: "options", ...(await this.readLabels()), select });
  }

  /**
   * "Create category…" or "Create tag…" was picked: ask for a name, store it in the config file
   * and show the lists again with the new entry chosen. Cancelling just shows the lists again,
   * which puts the dropdown back to what it showed before.
   */
  private async onCreateOption(kind: LabelKind, typed?: string): Promise<void> {
    const text = Strings.quickNote;
    // Only what the user made counts for a duplicate: a file with the same name does not stop a new category.
    const stored = await this.labelService.getLabels();
    const names =
      kind === "category" ? stored.categories.map((category) => category.name) : stored.tags;
    // The name, and for a category its file. Cancelling at any step shows the lists again, as they were.
    const answer = await askNewLabel(this.labelService, kind, names, typed);
    if (!answer) {
      await this.pushOptions();
      return;
    }
    const file = answer.file;
    try {
      const created = await this.labelService.create(kind, answer.name, { file });
      await this.pushOptions({ kind, value: created.created });
      showStatus(
        kind === "category"
          ? text.categoryCreated(created.created, file)
          : text.tagCreated(created.created)
      );
    } catch (error) {
      await this.pushOptions();
      if (error instanceof RootMissingError) {
        await offerSelectRoot(error.message);
      } else {
        // A locked or unreadable config file is explained to the user, with the details in the log.
        reportError(this.logger, "Creating a " + kind, error);
      }
    }
  }

  /** A new root brings its own draft. Text typed while no root was set moves along to the new root. */
  private onRootChanged(): void {
    const key = this.rootKey();
    const stored = this.stateService.getDraft(key);
    if (this.lastKey === "" && stored === "" && this.currentText !== "") {
      this.stateService.setDraft(key, this.currentText);
      this.stateService.clearDraft("");
    } else if (stored !== this.currentText) {
      this.currentText = stored;
      this.post({ type: "setDraft", text: stored });
    }
    this.lastKey = key;
    void this.pushOptions(); // Every notes folder has its own categories and tags.
    void this.refreshTarget();
  }

  /**
   * Shows where notes go. The panel header cannot have a changing tooltip (a title bar button always
   * shows its command title), so the file is its "description" next to the title, and the Save button
   * tells it on hover.
   */
  /** Looks up the file of the chosen category again, then shows where notes go. */
  private async refreshTarget(): Promise<void> {
    await this.labelService.refreshActive();
    this.showTarget();
  }

  private showTarget(): void {
    const file = this.quickNoteService.getTargetPath();
    if (this.view) {
      this.view.description = file;
    }
    this.post({ type: "target", file });
  }

  private rootKey(): string {
    return this.rootService.getRootUri()?.fsPath ?? "";
  }

  /** Messages for a page that is not ready are dropped: its `init` carries the current draft anyway. */
  private post(message: ExtensionToWebviewMessage): void {
    if (this.view && this.ready) {
      this.view.webview
        .postMessage(message)
        .then(undefined, (error: unknown) =>
          this.logger.error("Could not post to the Quick Note view.", error)
        );
    }
  }

  /** Focus is the one request that must survive until the page is ready. */
  private flushFocus(): void {
    if (this.focusPending && this.view && this.ready) {
      this.focusPending = false;
      this.post({ type: "focus" });
    }
  }

  private renderHtml(webview: vscode.Webview, mediaRoot: vscode.Uri): string {
    const nonce = randomBytes(16).toString("base64");
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "quickNote.css"));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "quickNote.js"));
    const text = Strings.quickNote;
    return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${styleUri}">
	<title>${escapeHtml(Strings.extensionName)}</title>
</head>
<body>
	<div class="note">
		<div id="root-problem" class="root-problem" role="status" hidden>
			<p id="root-problem-text"></p>
			<button id="select-root-problem" type="button" class="secondary">${escapeHtml(Strings.root.selectFolderAction)}</button>
		</div>
		<textarea id="note-text" maxlength="${MAX_TEXT_LENGTH}"
			aria-label="${escapeHtml(text.textAreaLabel)}"
			placeholder="${escapeHtml(text.placeholder)}"></textarea>
		<div id="advanced" class="advanced" role="group" aria-label="${escapeHtml(text.advancedTitle)}" hidden>
			<div id="category-combo" class="combo" data-create-label="${escapeHtml(text.createCategoryOption)}" data-create-named="${escapeHtml(text.createCategoryNamed)}" data-auto-template="${escapeHtml(text.autoCategoryPlaceholder)}">
				<input type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="category-list" autocomplete="off" spellcheck="false"
					aria-label="${escapeHtml(text.categoryLabel)}" placeholder="${escapeHtml(text.categoryPlaceholder)}">
				<button type="button" class="combo-clear" tabindex="-1" hidden title="${escapeHtml(text.clearCategoryLabel)}" aria-label="${escapeHtml(text.clearCategoryLabel)}">\u00d7</button>
				<button type="button" class="combo-toggle" tabindex="-1" title="${escapeHtml(text.showCategoriesLabel)}" aria-label="${escapeHtml(text.showCategoriesLabel)}"></button>
				<ul id="category-list" class="combo-list" role="listbox" aria-label="${escapeHtml(text.categoryLabel)}" hidden></ul>
			</div>
			<div id="tag-combo" class="combo" data-create-label="${escapeHtml(text.createTagOption)}" data-create-named="${escapeHtml(text.createTagNamed)}">
				<input type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="tag-list" autocomplete="off" spellcheck="false"
					aria-label="${escapeHtml(text.tagLabel)}" placeholder="${escapeHtml(text.tagPlaceholder)}">
				<button type="button" class="combo-toggle" tabindex="-1" title="${escapeHtml(text.showTagsLabel)}" aria-label="${escapeHtml(text.showTagsLabel)}"></button>
				<ul id="tag-list" class="combo-list" role="listbox" aria-label="${escapeHtml(text.tagLabel)}" hidden></ul>
			</div>
			<div id="tag-chips" class="chips" role="list" aria-label="${escapeHtml(text.chosenTagsLabel)}"
				data-empty="${escapeHtml(text.noTagsYet)}" data-max-pattern-tags="${this.settings.maxPatternTags}" data-remove-template="${escapeHtml(text.removeTagLabel)}" data-auto-title="${escapeHtml(text.autoTagTooltip)}"></div>
		</div>
		<div class="footer">
			<button id="paste" type="button" class="secondary" aria-label="${escapeHtml(text.pasteAndSaveAriaLabel)}" title="${escapeHtml(text.pasteAndSaveTooltip)}">${escapeHtml(text.pasteAndSaveLabel)}</button>
			<div class="save-group">
				<button id="save-open" type="button" class="secondary icon" disabled aria-label="${escapeHtml(text.saveAndOpenAriaLabel)}" data-title-template="${escapeHtml(text.saveAndOpenTooltip)}"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M2 2h5v1.5H3.5v9h9V9H14v5H2V2zm7 0h5v5h-1.5V4.56L7.78 9.28 6.72 8.22 11.44 3.5H9V2z"/></svg></button>
			<button id="save" type="button" disabled aria-label="${escapeHtml(text.okAriaLabel)}" data-title-template="${escapeHtml(text.saveTooltip)}">${escapeHtml(text.okLabel)}</button>
			</div>
		</div>
		<div class="message">
			<span id="status" role="status" aria-live="polite"></span>
		</div>
		<div id="root-action" hidden>
			<button id="select-root" type="button" class="secondary">${escapeHtml(Strings.root.selectFolderAction)}</button>
		</div>
	</div>
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
