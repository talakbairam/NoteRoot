import * as vscode from "vscode";
import { BuiltinCommands, Commands } from "../constants/commands";
import { SETTINGS_SECTION } from "../constants/settings";
import { Strings } from "../constants/strings";
import { Logger } from "../services/Logger";
import {
  findSettingDef,
  isChanged,
  resetSetting,
  typedValue,
  writeSwitch,
  type SettingDef,
  type SettingsContext,
} from "../services/SettingsCatalog";
import { SettingItem, choiceLabel } from "../tree/SettingsTreeProvider";
import type { SettingsPageProvider } from "../webview/SettingsPageProvider";
import { registerSafeCommand, reportError } from "./safe";
import { showStatus } from "../util/status";

export interface SettingsCommandDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  settingsContext: SettingsContext;
  settingsPage: SettingsPageProvider;
}

/** What the user asked for in the list of a setting. */
type ListAction = { type: "add" | "reset" } | { type: "edit" | "delete"; index: number };

interface ListItem extends vscode.QuickPickItem {
  index?: number;
  add?: boolean;
  reset?: boolean;
}

interface ListButton extends vscode.QuickInputButton {
  action: "edit" | "delete";
}

const listButtons: Record<"edit" | "delete", ListButton> = {
  edit: {
    action: "edit",
    iconPath: new vscode.ThemeIcon("edit"),
    tooltip: Strings.settingsView.listEdit,
  },
  delete: {
    action: "delete",
    iconPath: new vscode.ThemeIcon("trash"),
    tooltip: Strings.settingsView.listDelete,
  },
};

/** The commands of the Settings view: change a setting, take it back to its default, show it in the Settings editor. */
export function registerSettingsCommands(deps: SettingsCommandDependencies): void {
  const { context, logger, settingsContext, settingsPage } = deps;
  const { settings } = settingsContext;
  const text = Strings.settingsView;

  /** A command from the menu gets the row, a click on a row gets the id of the setting. */
  const defOf = (argument: unknown): SettingDef | undefined =>
    typeof argument === "string"
      ? findSettingDef(argument)
      : argument instanceof SettingItem
        ? argument.def
        : undefined;

  const say = (message: string): void => {
    showStatus(message);
  };

  async function editChoice(def: SettingDef): Promise<void> {
    const current = String(def.read(settingsContext));
    const picked = await vscode.window.showQuickPick(
      (def.choices ?? []).map((value) => ({
        value,
        label: choiceLabel(def, value),
        description: value === current ? text.choiceCurrent : undefined,
      })),
      {
        title: text.choiceTitle(text.items[def.id].label),
        placeHolder: text.items[def.id].description,
      }
    );
    if (picked && picked.value !== current && def.key !== undefined) {
      await settings.setValue(def.key, picked.value);
      say(text.updated(text.items[def.id].label));
    }
  }

  async function editTyped(def: SettingDef): Promise<void> {
    const current = String(def.read(settingsContext));
    const typed = await vscode.window.showInputBox({
      title: text.textTitle(text.items[def.id].label),
      prompt: text.items[def.id].description,
      value: current,
      validateInput: (value) =>
        value === "" && !def.allowEmpty ? text.emptyNotAllowed : def.validate?.(value),
    });
    if (typed === undefined || def.key === undefined) {
      return;
    }
    const next = typedValue(def, typed);
    if (next !== def.read(settingsContext)) {
      await settings.setValue(def.key, next);
      say(text.updated(text.items[def.id].label));
    }
  }

  /** A list of texts: the entries with buttons to change and delete them, add one, or go back to the default list. */
  async function editList(def: SettingDef): Promise<void> {
    const label = text.items[def.id].label;
    const normalize = (typed: string): string => def.normalizeEntry?.(typed) ?? typed.trim();
    for (;;) {
      const entries = [...(def.read(settingsContext) as readonly string[])];
      const action = await showList(def, entries);
      if (!action) {
        return;
      }
      try {
        const key = def.key;
        if (key === undefined) {
          return;
        }
        if (action.type === "reset") {
          await settings.resetValue(key);
          say(text.resetDone(label));
        } else if (action.type === "delete") {
          await settings.setValue(
            key,
            entries.filter((_, index) => index !== action.index)
          );
          say(text.updated(label));
        } else {
          const others =
            action.type === "edit" ? entries.filter((_, index) => index !== action.index) : entries;
          const typed = await vscode.window.showInputBox({
            title:
              action.type === "edit"
                ? text.listEditTitle(entries[action.index])
                : text.listAddTitle(label),
            prompt: text.listEntryPrompt,
            value: action.type === "edit" ? entries[action.index] : undefined,
            validateInput: (value) =>
              value.trim() === ""
                ? text.listEntryEmpty
                : (def.validateEntry?.(value) ??
                  (!def.allowDuplicates && others.includes(normalize(value))
                    ? text.listEntryDuplicate(normalize(value))
                    : undefined)),
          });
          if (typed !== undefined) {
            const next =
              action.type === "edit"
                ? entries.map((entry, index) => (index === action.index ? normalize(typed) : entry))
                : [...entries, normalize(typed)];
            await settings.setValue(key, next);
            say(text.updated(label));
          }
        }
      } catch (error) {
        // A settings file that cannot be written: tell the user and stop, instead of looping on the error.
        reportError(logger, "Changing a setting", error);
        return;
      }
    }
  }

  async function toggle(def: SettingDef): Promise<void> {
    const on = def.read(settingsContext) !== true;
    await writeSwitch(settingsContext, def.id, on);
    const label = text.items[def.id].label;
    say(on ? text.switchedOn(label) : text.switchedOff(label));
  }

  /** A setting of true or false: a click turns it the other way. */
  async function toggleSetting(def: SettingDef): Promise<void> {
    if (def.key === undefined) {
      return;
    }
    const on = def.read(settingsContext) !== true;
    await settings.setValue(def.key, on);
    const label = text.items[def.id].label;
    say(on ? text.switchedOn(label) : text.switchedOff(label));
  }

  registerSafeCommand(context, logger, Commands.editSetting, async (argument?: unknown) => {
    const def = defOf(argument);
    if (!def) {
      return;
    }
    switch (def.kind) {
      case "choice":
        return editChoice(def);
      case "text":
      case "number":
        return editTyped(def);
      case "list":
        return editList(def);
      case "switch":
        return toggle(def);
      case "toggle":
        return toggleSetting(def);
      case "action":
        if (def.command !== undefined) {
          await vscode.commands.executeCommand(def.command);
        }
        return;
    }
  });

  registerSafeCommand(context, logger, Commands.resetSetting, async (argument?: unknown) => {
    const def = defOf(argument);
    if (def && isChanged(settingsContext, def)) {
      await resetSetting(settingsContext, def);
      say(text.resetDone(text.items[def.id].label));
    }
  });

  registerSafeCommand(context, logger, Commands.showSettingInEditor, async (argument?: unknown) => {
    const def = defOf(argument);
    if (def?.key !== undefined) {
      await vscode.commands.executeCommand(
        BuiltinCommands.openSettings,
        `@id:${SETTINGS_SECTION}.${def.key}`
      );
    }
  });

  registerSafeCommand(context, logger, Commands.openSettingsPage, () => {
    settingsPage.open();
  });

  registerSafeCommand(context, logger, Commands.openAllSettings, async () => {
    await vscode.commands.executeCommand(BuiltinCommands.openSettings, SETTINGS_SECTION);
  });
}

/** Shows the entries of a list and answers with what was chosen, or undefined when it was closed. */
function showList(def: SettingDef, entries: readonly string[]): Promise<ListAction | undefined> {
  const text = Strings.settingsView;
  const quickPick = vscode.window.createQuickPick<ListItem>();
  quickPick.title = text.listTitle(text.items[def.id].label);
  quickPick.placeholder = text.listPlaceholder;
  quickPick.items = [
    ...(entries.length === 0
      ? [{ label: text.listNone, alwaysShow: true } satisfies ListItem]
      : entries.map((entry, index): ListItem => ({
          label: entry,
          buttons: [listButtons.edit, listButtons.delete],
          index,
        }))),
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    { label: text.listAdd, add: true, alwaysShow: true },
    { label: text.listReset, reset: true, alwaysShow: true },
  ];

  return new Promise((resolve) => {
    let settled = false;
    const finish = (action: ListAction | undefined): void => {
      if (!settled) {
        settled = true;
        resolve(action);
        quickPick.dispose();
      }
    };
    quickPick.onDidTriggerItemButton((event) => {
      if (event.item.index !== undefined) {
        finish({ type: (event.button as ListButton).action, index: event.item.index });
      }
    });
    quickPick.onDidAccept(() => {
      const item = quickPick.selectedItems[0];
      if (item?.add) {
        finish({ type: "add" });
      } else if (item?.reset) {
        finish({ type: "reset" });
      } else if (item?.index !== undefined) {
        finish({ type: "edit", index: item.index });
      }
    });
    quickPick.onDidHide(() => finish(undefined));
    quickPick.show();
  });
}
