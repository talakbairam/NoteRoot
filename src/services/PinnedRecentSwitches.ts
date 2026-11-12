import * as vscode from "vscode";
import { BuiltinCommands } from "../constants/commands";
import { ContextKeys, StateKeys } from "../constants/context";
import type { PinnedRecentGroup } from "../tree/NotesNode";

const STATE_KEYS: Record<PinnedRecentGroup, string> = {
  pinned: StateKeys.pinnedOn,
  recent: StateKeys.recentOn,
  favorites: StateKeys.favoritesOn,
};
const CONTEXT_KEYS: Record<PinnedRecentGroup, string> = {
  pinned: ContextKeys.pinnedOn,
  recent: ContextKeys.recentOn,
  favorites: ContextKeys.favoritesOn,
};

/**
 * The on/off switch of each of the "Favorites", "Pinned" and "Recent" groups of the Notes tree. While a group is off it shows no
 * notes (its row stays, marked "off") and Recent stops remembering new notes. Nothing is deleted: a favorite or a pin stays in
 * the config file and the recent list stays as it was. All are on at first. The state is remembered per machine and published as context keys, which
 * swap the turn on and turn off buttons of the group rows.
 */
export class PinnedRecentSwitches implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<PinnedRecentGroup>();
  private readonly enabled: Record<PinnedRecentGroup, boolean>;

  /** Fires with the group whose switch was changed. */
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly memento: vscode.Memento) {
    this.enabled = {
      pinned: memento.get<unknown>(STATE_KEYS.pinned) !== false,
      recent: memento.get<unknown>(STATE_KEYS.recent) !== false,
      favorites: memento.get<unknown>(STATE_KEYS.favorites) !== false,
    };
  }

  isEnabled(group: PinnedRecentGroup): boolean {
    return this.enabled[group];
  }

  /** Publishes the stored states as context keys. Call once at activation. */
  async initialize(): Promise<void> {
    await this.publish("pinned");
    await this.publish("recent");
    await this.publish("favorites");
  }

  async setEnabled(group: PinnedRecentGroup, value: boolean): Promise<void> {
    if (value === this.enabled[group]) {
      return;
    }
    this.enabled[group] = value;
    await this.memento.update(STATE_KEYS[group], value);
    await this.publish(group);
    this.changeEmitter.fire(group);
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }

  private async publish(group: PinnedRecentGroup): Promise<void> {
    await vscode.commands.executeCommand(
      BuiltinCommands.setContext,
      CONTEXT_KEYS[group],
      this.enabled[group]
    );
  }
}
