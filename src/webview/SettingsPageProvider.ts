import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { isFolderSettingKey } from "../constants/settings";
import { Strings } from "../constants/strings";
import { Logger } from "../services/Logger";
import {
  SETTING_DEFS,
  SETTING_GROUP_ORDER,
  SETTING_ORDER,
  subgroupIndex,
  applySettingEdit,
  choiceLabel,
  describeValue,
  findSettingDef,
  isChanged,
  resetSetting,
  type SettingDef,
  type SettingsContext,
} from "../services/SettingsCatalog";
import { reportError } from "../commands/safe";

import { showStatus } from "../util/status";
import {
  TOOL_IDS,
  parseSettingsPageMessage,
  type ExtensionToSettingsPageMessage,
  type ToolId,
  type SettingRow,
  type SettingsPageTexts,
  type SettingsPageToExtensionMessage,
} from "./settingsMessages";

const PANEL_TYPE = "noteRoot.settingsPage";

/** What each button of the "Files and logs" section runs. */
const TOOL_COMMANDS: Record<ToolId, string> = {
  openConfigFile: Commands.openConfigFile,
  showLogs: Commands.showLogs,
  openAllSettings: Commands.openAllSettings,
};

/**
 * "NoteRoot Settings": every setting in a tab of the editor, to review and change. It uses the same list
 * (`SETTING_DEFS`) and the same checks and writing (`applySettingEdit`, `resetSetting`) as the rest of NoteRoot, so the two
 * cannot disagree, and it follows the settings, so a change made anywhere shows up at once.
 */
export class SettingsPageProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  /** True while the current page has announced itself with `ready`. */
  private ready = false;
  /** The section the next `init` asks the page to show (set by `open`). */
  private sectionToShow: string | undefined;
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: SettingsContext,
    private readonly logger: Logger
  ) {
    const refresh = (): void => this.post({ type: "update", rows: this.rows() });
    this.subscriptions = [
      context.settings.onDidChange(refresh),
      context.advancedMode.onDidChange(refresh),
      context.autoCategories.onDidChange(refresh),
      context.autoTagPatterns.onDidChange(refresh),
      context.googleClientStore.onDidChange(refresh),
      context.savedSecrets.onDidChange(refresh),
    ];
  }

  /**
   * Opens the page in a new tab, or shows the one that is open. `section` (a group of the settings) is the one to show: without
   * it the page shows the section it showed last.
   */
  open(section?: string): void {
    this.sectionToShow = section;
    if (this.panel) {
      this.panel.reveal();
      if (section) {
        this.post({ type: "show", section });
      }
      return;
    }
    const pagesRoot = vscode.Uri.joinPath(this.extensionUri, "webview");
    const panel = vscode.window.createWebviewPanel(
      PANEL_TYPE,
      Strings.settingsPage.title,
      vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [pagesRoot] }
    );
    this.panel = panel;
    this.ready = false;
    panel.webview.html = this.renderHtml(panel.webview, pagesRoot);
    panel.webview.onDidReceiveMessage((raw: unknown) => {
      const message = parseSettingsPageMessage(raw);
      if (!message) {
        this.logger.warn("Ignored an invalid message from the Settings page.");
        return;
      }
      this.handleMessage(message).catch((error: unknown) =>
        this.logger.error("Settings page message failed.", error)
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

  private async handleMessage(message: SettingsPageToExtensionMessage): Promise<void> {
    if (message.type === "ready") {
      this.ready = true;
      this.post({
        type: "init",
        texts: this.texts(),
        rows: this.rows(),
        section: this.sectionToShow,
      });
      return;
    }
    if (message.type === "tool") {
      // The commands that open the config file, the logs and the VS Code Settings editor.
      const command = TOOL_COMMANDS[message.id];
      await vscode.commands.executeCommand(command);
      return;
    }
    const def = findSettingDef(message.id);
    if (!def) {
      return;
    }
    if (message.type === "forget") {
      // Only the saved keys have a list; the key is looked up in what is saved, the name from the page is never used as a path.
      if (def.id === "savedMasterKeys") {
        await this.context.savedSecrets.removeKey(message.item);
      }
      return;
    }
    const label = Strings.settingsView.items[def.id].label;
    try {
      if (message.type === "edit") {
        const error = await applySettingEdit(this.context, def, message.value);
        this.post({ type: "result", id: def.id, error });
        if (error === undefined) {
          showStatus(Strings.settingsView.updated(label));
        }
      } else if (message.type === "reset") {
        if (isChanged(this.context, def)) {
          await resetSetting(this.context, def);
          showStatus(Strings.settingsView.resetDone(label));
        }
      } else if (def.kind === "action" && def.command !== undefined) {
        await vscode.commands.executeCommand(def.command);
      }
    } catch (error) {
      // A settings file that cannot be written: tell the user, and show the real values again.
      reportError(this.logger, "Changing a setting", error);
      this.post({ type: "update", rows: this.rows() });
    }
  }

  /** Messages for a page that is not ready are dropped: its `init` carries the current rows anyway. */
  private post(message: ExtensionToSettingsPageMessage): void {
    if (this.panel && this.ready) {
      this.panel.webview
        .postMessage(message)
        .then(undefined, (error: unknown) =>
          this.logger.error("Could not post to the Settings page.", error)
        );
    }
  }

  private texts(): SettingsPageTexts {
    const text = Strings.settingsPage;
    return {
      title: text.title,
      intro: text.intro,
      searchLabel: text.searchLabel,
      searchPlaceholder: text.searchPlaceholder,
      onlyChanged: text.onlyChanged,
      noMatches: text.noMatches,
      changed: text.changed,
      sourceFolder: text.sourceFolder,
      sourceUser: text.sourceUser,
      reset: text.reset,
      forgetKey: text.forgetKey,
      advancedNote: text.advancedNote,
      change: text.change,
      apply: text.apply,
      listHint: text.listHint,
      on: text.on,
      off: text.off,
      saved: text.saved,
      defaultLabel: text.defaultLabel,
      toolsTitle: text.toolsTitle,
      tools: TOOL_IDS.map((id) => ({ id, ...text.tools[id] })),
    };
  }

  private rows(): SettingRow[] {
    // By group (SETTING_GROUP_ORDER), then in the order of SETTING_ORDER; a setting that is not listed there goes last.
    const place = (def: SettingDef): number => {
      const index = SETTING_ORDER.indexOf(def.id);
      return index < 0 ? SETTING_ORDER.length : index;
    };
    return [...SETTING_DEFS]
      .sort(
        (a, b) =>
          SETTING_GROUP_ORDER.indexOf(a.group) - SETTING_GROUP_ORDER.indexOf(b.group) ||
          subgroupIndex(a.subgroup) - subgroupIndex(b.subgroup) ||
          place(a) - place(b)
      )
      .map((def) => this.rowOf(def));
  }

  private rowOf(def: SettingDef): SettingRow {
    const text = Strings.settingsView.items[def.id];
    const value = def.read(this.context);
    const source =
      def.key !== undefined && isFolderSettingKey(def.key)
        ? this.context.settings.sourceOf(def.key)
        : undefined;
    return {
      id: def.id,
      group: def.group,
      groupLabel: Strings.settingsView.groups[def.group],
      ...(def.subgroup ? { subgroup: Strings.settingsView.subgroups[def.subgroup] } : {}),
      kind: def.kind,
      label: text.label,
      description: text.description,
      // A password never goes to the page: it shows that one is set (valueText) and takes a new one.
      value: def.secret
        ? ""
        : typeof value === "number"
          ? String(value)
          : typeof value === "object"
            ? [...value]
            : value,
      valueText: describeValue(def, value),
      defaultText: this.defaultText(def),
      changed: isChanged(this.context, def),
      source,
      choices:
        def.kind === "choice"
          ? (def.choices ?? []).map((choice) => ({
              value: choice,
              label: choiceLabel(def, choice),
            }))
          : undefined,
      unit: def.unit ? Strings.settingsPage.units[def.unit] : "",
      resettable: def.resettable,
      ...(def.secret ? { secret: true } : {}),
      ...(def.id === "savedMasterKeys"
        ? {
            items: this.context.savedSecrets.state.keys.map((key) => ({
              id: key.id,
              text: `${key.service} · ${key.target}`,
              detail: key.folder,
            })),
          }
        : {}),
    };
  }

  /** The default as the page shows it: the entries of a list, one after the other, instead of a count. */
  private defaultText(def: SettingDef): string {
    if (def.kind === "list") {
      const entries = def.defaultValue as readonly string[];
      return entries.length === 0 ? Strings.settingsPage.defaultNone : entries.join(" | ");
    }
    return describeValue(def, def.defaultValue);
  }

  private renderHtml(webview: vscode.Webview, pagesRoot: vscode.Uri): string {
    const nonce = randomBytes(16).toString("base64");
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(pagesRoot, "settingsPage", "settingsPage.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(pagesRoot, "settingsPage", "settingsPage.js")
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${styleUri}">
	<title>${escapeHtml(Strings.settingsPage.title)}</title>
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
