import * as vscode from "vscode";
import { RootMissingError } from "../util/errors";
import { ConfigService } from "./ConfigService";
import { Logger } from "./Logger";
import { PathGuard } from "./PathGuard";
import { renameRecent } from "./RecentNotesService";
import { RootFolderService } from "./RootFolderService";

/** Where the pinned notes are stored: `custom.pinned` of `.noteroot/config.json`. */
const CONFIG_KEY = "pinned";

/** The paths in the stored value. Anything that is not a non-empty text is ignored. */
function readPaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const paths = value.filter((entry): entry is string => typeof entry === "string" && entry !== "");
  return paths.filter((path, index) => paths.indexOf(path) === index);
}

/**
 * The notes the user pinned, stored in the `custom` part of the NoteRoot config file of the notes
 * folder, so they belong to that folder and travel with it. Paths are relative to the root and
 * `/`-separated, in the order they were pinned. Only files are pinned.
 */
export class PinnedNotesService implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly subscriptions: vscode.Disposable[];

  /** Fires when the list changed. */
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private readonly rootService: RootFolderService,
    private readonly configService: ConfigService,
    private readonly pathGuard: PathGuard,
    private readonly logger: Logger
  ) {
    this.subscriptions = [
      this.changeEmitter,
      rootService.onDidChangeRoot(() => this.changeEmitter.fire()),
      vscode.workspace.onDidRenameFiles((event) => {
        for (const { oldUri, newUri } of event.files) {
          void this.applyRename(oldUri, newUri).catch((error: unknown) =>
            this.logger.warn(
              `Could not update the pinned notes after a rename: ${error instanceof Error ? error.message : String(error)}`
            )
          );
        }
      }),
    ];
  }

  /** The pinned paths, read from the config file now. Empty without a notes folder. */
  async list(): Promise<string[]> {
    const root = this.rootService.getRootUri();
    if (!root || !this.rootService.hasRoot) {
      return [];
    }
    const { config } = await this.configService.ensure(root);
    return readPaths(config.custom[CONFIG_KEY]);
  }

  /**
   * Pins notes that are not pinned yet.
   * @throws RootMissingError without a notes folder, ConfigLockedError when the config file may not be changed.
   */
  async pin(paths: readonly string[]): Promise<void> {
    await this.change((stored) => {
      const result = [...stored];
      for (const path of paths) {
        if (!readPaths(result).includes(path)) {
          result.push(path);
        }
      }
      return result;
    });
  }

  /** @throws the same errors as {@link pin}. */
  async unpin(paths: readonly string[]): Promise<void> {
    await this.change((stored) =>
      stored.filter((entry) => typeof entry !== "string" || !paths.includes(entry))
    );
  }

  dispose(): void {
    vscode.Disposable.from(...this.subscriptions).dispose();
  }

  /** A rename or move: pinned notes at or below the old path follow, and leave the list when they leave the root. */
  private async applyRename(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<void> {
    const oldPath = this.pathGuard.getRelativePath(oldUri);
    if (!oldPath) {
      return;
    }
    const newPath = this.pathGuard.getRelativePath(newUri);
    const affected = (await this.list()).some(
      (path) => path === oldPath || path.startsWith(`${oldPath}/`)
    );
    if (!affected) {
      return; // Most renames have nothing to do with a pinned note: leave the config file alone.
    }
    await this.change((stored) =>
      stored.flatMap((entry) =>
        typeof entry === "string" ? renameRecent([entry], oldPath, newPath) : [entry]
      )
    );
  }

  /** Rewrites `custom.pinned`, keeping entries that are not texts as they are. */
  private async change(update: (stored: unknown[]) => unknown[]): Promise<void> {
    const root = this.rootService.getRootUri();
    if (!root || !this.rootService.hasRoot) {
      throw new RootMissingError();
    }
    await this.configService.updateCustom(root, (custom) => {
      const stored = Array.isArray(custom[CONFIG_KEY]) ? (custom[CONFIG_KEY] as unknown[]) : [];
      custom[CONFIG_KEY] = update(stored);
    });
    this.changeEmitter.fire();
  }
}
