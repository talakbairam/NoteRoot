import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { isFolderOnlyKey, isFolderSettingKey, type SettingSource } from "../constants/settings";
import { Strings } from "../constants/strings";
import {
  SETTING_DEFS,
  isChanged,
  type SettingDef,
  type SettingGroup,
  type SettingValue,
  type SettingsContext,
} from "../services/SettingsCatalog";

/** Context values, used by the menus of the view in package.json. */
export const SettingContexts = {
  group: "noteRoot.settingGroup",
  /** The start of the context value of a row. `.key` follows when it is a VS Code setting, `.changed` when it was changed. */
  row: "noteRoot.setting",
} as const;

const ICONS: Record<SettingDef["kind"], string> = {
  choice: "symbol-enum",
  text: "symbol-string",
  number: "symbol-number",
  list: "list-unordered",
  action: "go-to-file",
  switch: "circle-outline",
  toggle: "circle-outline",
};

/** "Notes", "Quick Note" or "Tags & Categories": the groups of the view. */
export class SettingGroupItem extends vscode.TreeItem {
  constructor(readonly group: SettingGroup) {
    super(Strings.settingsView.groups[group], vscode.TreeItemCollapsibleState.Expanded);
    this.id = `settingsgroup:${group}`;
    this.contextValue = SettingContexts.group;
  }
}

/** One setting: its name, its value now, and a click that changes it. */
export class SettingItem extends vscode.TreeItem {
  constructor(
    readonly def: SettingDef,
    value: SettingValue,
    changed: boolean,
    /** Only for a setting that can be kept in the notes folder. */
    source?: SettingSource
  ) {
    const text = Strings.settingsView.items[def.id];
    const view = Strings.settingsView;
    super(text.label, vscode.TreeItemCollapsibleState.None);
    this.id = `setting:${def.id}`;
    this.description =
      describeValue(def, value) + (source === "folder" ? ` · ${view.thisFolder}` : "");
    const sourceText =
      source === "folder"
        ? view.sourceFolder
        : source === "user"
          ? view.sourceUser
          : source === "default"
            ? view.sourceDefault
            : undefined;
    this.tooltip = [
      text.description,
      "",
      view.defaultValue(describeValue(def, def.defaultValue)),
      ...(sourceText ? [sourceText] : []),
    ].join("\n");
    this.contextValue =
      SettingContexts.row +
      (def.key !== undefined && !isFolderOnlyKey(def.key) ? ".key" : "") +
      (changed ? ".changed" : "");
    this.iconPath = new vscode.ThemeIcon(
      (def.kind === "switch" || def.kind === "toggle") && value === true
        ? "circle-filled"
        : ICONS[def.kind]
    );
    this.command = {
      command: Commands.editSetting,
      title: Strings.settingsView.textTitle(text.label),
      arguments: [def.id],
    };
  }
}

export type SettingNode = SettingGroupItem | SettingItem;

/** The text a value is shown as: a label for a choice, "On" or "Off" for a switch, a count for a list. */
export function describeValue(def: SettingDef, value: SettingValue): string {
  const text = Strings.settingsView;
  switch (def.kind) {
    case "switch":
    case "toggle":
      return value === true ? text.on : text.off;
    case "list":
      if (def.id === "noteHeader") {
        return (value as readonly string[]).length === 0
          ? text.off
          : text.headerLines((value as readonly string[]).length);
      }
      return text.listCount((value as readonly string[]).length);
    case "number":
      switch (def.unit) {
        case "ms":
          return text.milliseconds(value as number);
        case "px":
          return text.pixels(value as number);
        case "s":
          return text.seconds(value as number);
        case "mb":
          return value === 0 ? text.thresholdOff : text.megabytes(value as number);
        default:
          return String(value);
      }
    case "choice":
      return choiceLabel(def, String(value));
    default: {
      const shown = String(value);
      if (def.id === "rootPath") {
        return shown === "" ? text.notSet : shown;
      }
      if (def.id === "quickNoteTimestampFormat" && shown === "") {
        return text.noHeading;
      }
      return shown === "" ? text.emptyValue : shown;
    }
  }
}

/** What a value of a choice is called. */
export function choiceLabel(def: SettingDef, value: string): string {
  const text = Strings.settingsView;
  if (def.id === "sortOrder") {
    return text.sortChoices[value as keyof typeof text.sortChoices] ?? value;
  }
  if (def.id === "quickNotePosition") {
    return text.positionChoices[value as keyof typeof text.positionChoices] ?? value;
  }
  // The heading level: `##` is shown as the heading it makes.
  return value === "plain"
    ? Strings.quickNote.headingPlain
    : Strings.quickNote.headingLevelLabel(value);
}

/**
 * "Settings": every NoteRoot setting with its value now, in groups. A click changes it (the editing is in
 * `settingsCommands.ts`). The view follows the settings, so a change made anywhere (the Settings editor, a command, the
 * Quick Note Options) shows up at once.
 */
export class SettingsTreeProvider
  implements vscode.TreeDataProvider<SettingNode>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly subscriptions: vscode.Disposable[];

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly context: SettingsContext) {
    const refresh = (): void => this.changeEmitter.fire();
    this.subscriptions = [
      this.changeEmitter,
      context.settings.onDidChange(refresh),
      context.advancedMode.onDidChange(refresh),
      context.autoCategories.onDidChange(refresh),
      context.autoTagPatterns.onDidChange(refresh),
    ];
  }

  getTreeItem(element: SettingNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SettingNode): SettingNode[] {
    if (!element) {
      const groups: SettingGroup[] = [];
      for (const def of SETTING_DEFS) {
        if (!groups.includes(def.group)) {
          groups.push(def.group);
        }
      }
      return groups.map((group) => new SettingGroupItem(group));
    }
    if (element instanceof SettingGroupItem) {
      return SETTING_DEFS.filter((def) => def.group === element.group).map(
        (def) =>
          new SettingItem(
            def,
            def.read(this.context),
            isChanged(this.context, def),
            def.key !== undefined && isFolderSettingKey(def.key)
              ? this.context.settings.sourceOf(def.key)
              : undefined
          )
      );
    }
    return [];
  }

  dispose(): void {
    vscode.Disposable.from(...this.subscriptions).dispose();
  }
}
