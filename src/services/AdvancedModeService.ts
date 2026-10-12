import * as vscode from "vscode";
import { BuiltinCommands } from "../constants/commands";
import { ContextKeys, StateKeys } from "../constants/context";
import { SettingKeys } from "../constants/settings";
import { SettingsService } from "./SettingsService";

/**
 * The on/off switch of the Advanced mode of the Quick Note box. The state is remembered per machine
 * and published as a context key, which swaps the title bar button between "show" and "hide".
 */
export class AdvancedModeService implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<boolean>();
  /** What the user chose on this machine; undefined until then (the setting of the notes folder gives the start state). */
  private stored: boolean | undefined;
  private readonly subscription: vscode.Disposable;

  /** Fires with the new state when the mode is switched. */
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private readonly memento: vscode.Memento,
    private readonly settings: SettingsService
  ) {
    const value = memento.get<unknown>(StateKeys.advancedMode);
    this.stored = typeof value === "boolean" ? value : undefined;
    // The start state is read from the notes folder, which is loaded after startup.
    this.subscription = settings.onDidChange((event) => {
      if (
        this.stored === undefined &&
        SettingsService.affects(event, SettingKeys.startAdvancedOn)
      ) {
        void this.publish().then(() => this.changeEmitter.fire(this.isEnabled));
      }
    });
  }

  get isEnabled(): boolean {
    return this.stored ?? this.settings.startAdvancedOn;
  }

  /** Publishes the stored state as a context key. Call once at activation. */
  async initialize(): Promise<void> {
    await this.publish();
  }

  async setEnabled(value: boolean): Promise<void> {
    const changed = value !== this.isEnabled;
    this.stored = value;
    await this.memento.update(StateKeys.advancedMode, value);
    if (changed) {
      await this.publish();
      this.changeEmitter.fire(value);
    }
  }

  dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
  }

  private async publish(): Promise<void> {
    await vscode.commands.executeCommand(
      BuiltinCommands.setContext,
      ContextKeys.advanced,
      this.isEnabled
    );
  }
}
