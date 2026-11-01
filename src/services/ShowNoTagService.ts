import * as vscode from "vscode";
import { BuiltinCommands } from "../constants/commands";
import { ContextKeys, StateKeys } from "../constants/context";

/**
 * The "Show No-Tag Items" switch of the Notes tree. While it is on, the files and folders that are left out of automatic
 * tagging are marked "no tags", whether or not the hidden items are shown. It only changes what the tree writes next to
 * the name. The state is remembered per machine and published as a context key, which swaps the command in the `...` menu
 * between Show No-Tag Items and Hide No-Tag Items.
 */
export class ShowNoTagService implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<boolean>();
  private enabled: boolean;

  /** Fires with the new state when the switch is changed. */
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly memento: vscode.Memento) {
    this.enabled = memento.get<unknown>(StateKeys.showNoTag) === true;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Publishes the stored state as a context key. Call once at activation. */
  async initialize(): Promise<void> {
    await this.publish();
  }

  async setEnabled(value: boolean): Promise<void> {
    if (value === this.enabled) {
      return;
    }
    this.enabled = value;
    await this.memento.update(StateKeys.showNoTag, value);
    await this.publish();
    this.changeEmitter.fire(value);
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }

  private async publish(): Promise<void> {
    await vscode.commands.executeCommand(
      BuiltinCommands.setContext,
      ContextKeys.showNoTag,
      this.enabled
    );
  }
}
