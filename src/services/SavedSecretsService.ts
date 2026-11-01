import * as vscode from "vscode";
import type { DropboxAuth } from "./DropboxAuth";
import type { GitLabAuth } from "./GitLabAuth";
import type { GoogleAuth } from "./GoogleAuth";
import type { Logger } from "./Logger";
import type { SecretKeyStore } from "./SecretKeyStore";

/** A saved key of an encrypted sync target, with what it belongs to (never the key itself). */
export interface SavedKeyInfo {
  /** The name it is saved under in the secret storage. */
  readonly id: string;
  /** The service (GitHub, GitLab...). */
  readonly service: string;
  /** The repository, project or folder online. */
  readonly target: string;
  /** The notes folder whose connection it belongs to (a path on this computer). */
  readonly folder: string;
}

/** What NoteRoot keeps in the secret storage of VS Code on this computer. */
export interface SavedSecrets {
  /** The personal access token of GitLab. */
  readonly gitlab: boolean;
  /** The sign-in to Google (its refresh token). */
  readonly google: boolean;
  /** The sign-in to Dropbox (its refresh token). */
  readonly dropbox: boolean;
  /** The keys of encrypted sync targets (made from a master key) that are saved, with what each belongs to. */
  readonly keys: readonly SavedKeyInfo[];
}

/**
 * Shows what NoteRoot keeps in the `SecretStorage` of VS Code (the Settings page lists it) and takes each part away again. It
 * never reads a secret out loud: only whether one is there. The master key itself is never kept, only the key made from it, so
 * removing the saved keys makes NoteRoot ask for the master key again. The state is read once and again whenever the secret
 * storage changes, so the page can show it without waiting.
 */
export class SavedSecretsService implements vscode.Disposable {
  private current: SavedSecrets = { gitlab: false, google: false, dropbox: false, keys: [] };
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly subscriptions: vscode.Disposable[];

  /** Fires when what is saved changed. */
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    secrets: vscode.SecretStorage,
    private readonly gitlab: GitLabAuth,
    private readonly google: GoogleAuth,
    private readonly dropbox: DropboxAuth,
    private readonly keyStore: SecretKeyStore,
    /** The keys that the connections of every notes folder could have saved, with what each belongs to. */
    private readonly keyInfos: () => SavedKeyInfo[],
    /** Called after the keys were removed: the services forget the keys they hold in memory too. */
    private readonly onKeysRemoved: () => void,
    private readonly logger: Logger
  ) {
    this.subscriptions = [
      this.changeEmitter,
      secrets.onDidChange(() => {
        void this.refresh();
      }),
    ];
  }

  get state(): SavedSecrets {
    return this.current;
  }

  /** Reads what is saved now. */
  async refresh(): Promise<void> {
    try {
      const keys: SavedKeyInfo[] = [];
      const seen = new Set<string>();
      for (const info of this.keyInfos()) {
        if (!seen.has(info.id) && (await this.keyStore.get(info.id)) !== undefined) {
          seen.add(info.id);
          keys.push(info);
        }
      }
      const next: SavedSecrets = {
        gitlab: await this.gitlab.hasToken(),
        google: await this.google.isSignedIn(),
        dropbox: await this.dropbox.isSignedIn(),
        keys,
      };
      if (JSON.stringify(next) !== JSON.stringify(this.current)) {
        this.current = next;
        this.changeEmitter.fire();
      }
    } catch (error) {
      this.logger.warn(
        `Could not read what is saved in the secret storage: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /** Forgets the token of GitLab: the next Connect asks for one. */
  async removeGitlab(): Promise<void> {
    await this.gitlab.signOut();
    await this.refresh();
  }

  /** Forgets the sign-in to Google: the next Connect opens the browser. */
  async removeGoogle(): Promise<void> {
    await this.google.signOut();
    await this.refresh();
  }

  /** Forgets the sign-in to Dropbox: the next Connect opens the browser. */
  async removeDropbox(): Promise<void> {
    await this.dropbox.signOut();
    await this.refresh();
  }

  /** Forgets one saved key. Only a key that is in the list is removed (the name comes from the page). */
  async removeKey(id: string): Promise<void> {
    if (this.current.keys.some((info) => info.id === id)) {
      await this.keyStore.delete(id);
      this.onKeysRemoved();
      await this.refresh();
    }
  }

  /** Forgets every saved key of an encrypted target: the master key is asked again when one is needed. */
  async removeKeys(): Promise<void> {
    for (const info of this.keyInfos()) {
      await this.keyStore.delete(info.id);
    }
    this.onKeysRemoved();
    await this.refresh();
  }

  dispose(): void {
    vscode.Disposable.from(...this.subscriptions).dispose();
  }
}
