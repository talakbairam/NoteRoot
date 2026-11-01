import * as vscode from "vscode";
import { GoogleOAuth } from "../constants/google";
import { Strings } from "../constants/strings";
import { StateKeys } from "../constants/context";
import { RootMissingError } from "../util/errors";
import type { ConfigService } from "./ConfigService";
import type { Logger } from "./Logger";
import type { RootFolderService } from "./RootFolderService";

/** A Google OAuth client (type "Desktop app"): the id and the secret of a project in the Google Cloud Console. */
export interface GoogleClient {
  readonly id: string;
  readonly secret: string;
}

/** Where the client that is used comes from: the notes folder's config file, this computer, or the one that comes with NoteRoot. */
export type GoogleClientSource = "config" | "local" | "built-in" | "none";

/** Where the user's own client is kept. */
export type GoogleClientPlace = (typeof GoogleClientPlaces)[number];
export const GoogleClientPlaces = ["local", "config"] as const;

const FILE_NAME = "google-client.json";
/** Where it lives in `.noteroot/config.json`: `custom.googleClient`. */
const CONFIG_KEY = "googleClient";
const MAX_FIELD_LENGTH = 300;

/**
 * The Google client that the user made for the Google Drive sync, kept in one of two places, as the user chooses when saving it:
 * **on this computer** (`google-client.json` in the storage folder of the extension: never in a settings file that is synced or
 * shared), or **in the notes folder** (`custom.googleClient` of `.noteroot/config.json`, so it travels with the notes, and with the
 * sync, which sends that file too). Saving in one place removes it from the other. The one in the notes folder wins, then the one
 * of this computer, then the client that comes with NoteRoot (`GoogleOAuth`), if it is filled in. The secret of a desktop client is
 * not confidential, but it is never shown or logged. Reading is from memory after {@link load}; the config is read again when
 * the notes folder changes.
 */
export class GoogleClientStore implements vscode.Disposable {
  private local: GoogleClient | undefined;
  private fromConfig: GoogleClient | undefined;
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly subscriptions: vscode.Disposable[];

  /** Fires when the client of the user was saved or removed, or the notes folder brought another one. */
  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly storage: vscode.Uri,
    private readonly rootService: RootFolderService,
    private readonly configService: ConfigService,
    private readonly memento: vscode.Memento,
    private readonly logger: Logger
  ) {
    const reload = (): void => {
      this.reloadConfig().catch((error: unknown) =>
        this.logger.warn(
          `Could not read the Google client from the config file: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    };
    this.subscriptions = [
      this.emitter,
      rootService.onDidChangeRoot(reload),
      rootService.onDidChangeState(reload),
    ];
  }

  /** Reads the file of this computer and the config of the notes folder once, at the start. */
  async load(): Promise<void> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.file);
      this.local = parse(JSON.parse(Buffer.from(bytes).toString("utf8")));
      if (!this.local) {
        this.logger.warn("The Google client file is not valid: it is ignored.");
      }
    } catch {
      this.local = undefined; // Not there yet: the normal case.
    }
    await this.reloadConfig();
  }

  /** The client of the user, complete or not (the id and the secret are typed one after the other). */
  private get own(): GoogleClient | undefined {
    return this.fromConfig ?? this.local;
  }

  /** The client to use: the one of the user when it has both parts, else the one that comes with NoteRoot (if it is filled in). */
  get effective(): GoogleClient | undefined {
    if (this.own) {
      return this.own.id !== "" && this.own.secret !== "" ? this.own : undefined;
    }
    return GoogleOAuth.clientId !== "" && GoogleOAuth.clientSecret !== ""
      ? { id: GoogleOAuth.clientId, secret: GoogleOAuth.clientSecret }
      : undefined;
  }

  get source(): GoogleClientSource {
    return this.fromConfig ? "config" : this.local ? "local" : this.effective ? "built-in" : "none";
  }

  /** What is missing for a client to use: nothing (an empty list), the id, the secret, or both. */
  get missing(): ("id" | "secret")[] {
    if (this.effective) {
      return [];
    }
    return [
      ...(this.ownId === "" ? (["id"] as const) : []),
      ...(this.ownSecret === "" ? (["secret"] as const) : []),
    ];
  }

  /** The id of the client of the user, or "". */
  get ownId(): string {
    return this.own?.id ?? "";
  }

  /** The secret of the client of the user, or "". */
  get ownSecret(): string {
    return this.own?.secret ?? "";
  }

  /**
   * Where the client of the user is kept (or will be, when there is none yet): the config file of the notes folder, which is the
   * default whenever there is a notes folder, or this computer when the user chose that (or there is no notes folder).
   */
  get place(): GoogleClientPlace {
    if (this.fromConfig) {
      return "config";
    }
    if (this.local) {
      return "local";
    }
    const chosen = this.memento.get<string>(StateKeys.googleClientPlace);
    return chosen !== "local" && this.canUseConfig ? "config" : "local";
  }

  /**
   * Changes the id and/or the secret of the client of the user, in the place it is kept (see {@link place}). Both empty removes it.
   * @throws RootMissingError, ConfigLockedError as {@link save}.
   */
  async update(change: { id?: string; secret?: string }): Promise<void> {
    const next = {
      id: (change.id ?? this.ownId).trim(),
      secret: (change.secret ?? this.ownSecret).trim(),
    };
    if (next.id === "" && next.secret === "") {
      await this.clear();
    } else {
      await this.save(next, this.place);
    }
  }

  /**
   * Chooses where the client of the user is kept; a client that exists moves there. The choice is remembered on this computer.
   * @throws RootMissingError, ConfigLockedError as {@link save}.
   */
  async setPlace(place: GoogleClientPlace): Promise<void> {
    if (place === "config" && !this.canUseConfig) {
      throw new RootMissingError();
    }
    await this.memento.update(StateKeys.googleClientPlace, place);
    if (this.own && place !== this.place) {
      await this.save(this.own, place);
    } else {
      this.emitter.fire();
    }
  }

  /** True when a notes folder is open, so the config file is a possible place. */
  get canUseConfig(): boolean {
    return this.rootService.hasRoot && this.rootService.getRootUri() !== undefined;
  }

  /**
   * Saves the client of the user in `place` and removes it from the other place. The caller checks the texts with
   * {@link validateClientField}; an empty part is allowed (it is typed later).
   * @throws RootMissingError for `config` without a notes folder, ConfigLockedError when the config file may not be changed.
   */
  async save(client: GoogleClient, place: GoogleClientPlace): Promise<void> {
    const clean = { id: client.id.trim(), secret: client.secret.trim() };
    if (place === "config") {
      // The config first: if it is refused, nothing else was changed.
      await this.writeConfig(clean);
      await this.removeLocal();
    } else {
      if (this.fromConfig) {
        await this.writeConfig(undefined); // First, so a refused config leaves everything as it was.
      }
      await vscode.workspace.fs.createDirectory(this.storage);
      await vscode.workspace.fs.writeFile(
        this.file,
        Buffer.from(JSON.stringify(clean, null, 2), "utf8")
      );
      this.local = clean;
    }
    this.emitter.fire();
  }

  /** Removes the client of the user from both places: the one that comes with NoteRoot is used again (or none). */
  async clear(): Promise<void> {
    if (this.fromConfig) {
      await this.writeConfig(undefined);
    }
    await this.removeLocal();
    this.emitter.fire();
  }

  dispose(): void {
    vscode.Disposable.from(...this.subscriptions).dispose();
  }

  private get file(): vscode.Uri {
    return vscode.Uri.joinPath(this.storage, FILE_NAME);
  }

  private async removeLocal(): Promise<void> {
    await vscode.workspace.fs
      .delete(this.file, { useTrash: false })
      .then(undefined, () => undefined); // Not there: fine.
    this.local = undefined;
  }

  /** Reads `custom.googleClient` of the notes folder; a damaged or newer config file counts as none. */
  private async reloadConfig(): Promise<void> {
    const root = this.rootService.getRootUri();
    let next: GoogleClient | undefined;
    if (root && this.rootService.hasRoot) {
      const { config } = await this.configService.ensure(root);
      next = parse(config.custom[CONFIG_KEY]);
    }
    if (next?.id !== this.fromConfig?.id || next?.secret !== this.fromConfig?.secret) {
      this.fromConfig = next;
      this.emitter.fire();
    }
  }

  private async writeConfig(client: GoogleClient | undefined): Promise<void> {
    const root = this.rootService.getRootUri();
    if (!root || !this.rootService.hasRoot) {
      throw new RootMissingError();
    }
    await this.configService.updateCustom(root, (custom) => {
      if (client) {
        custom[CONFIG_KEY] = { id: client.id, secret: client.secret };
      } else {
        delete custom[CONFIG_KEY];
      }
    });
    this.fromConfig = client;
  }
}

/** A message for an id or a secret that cannot be used, or undefined. */
export function validateClientField(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_FIELD_LENGTH && !/\s/.test(trimmed)
    ? undefined
    : Strings.sync.googleDrive.clientFieldInvalid;
}

function parse(value: unknown): GoogleClient | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const { id, secret } = value as { id?: unknown; secret?: unknown };
  if (typeof id !== "string" || typeof secret !== "string") {
    return undefined;
  }
  const part = (text: string): string | undefined =>
    text.trim() === "" || !validateClientField(text) ? text.trim() : undefined;
  const cleanId = part(id);
  const cleanSecret = part(secret);
  return cleanId === undefined ||
    cleanSecret === undefined ||
    (cleanId === "" && cleanSecret === "")
    ? undefined
    : { id: cleanId, secret: cleanSecret };
}
