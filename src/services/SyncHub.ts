import * as vscode from "vscode";
import { BuiltinCommands } from "../constants/commands";
import { ContextKeys } from "../constants/context";
import type { EncryptionSupport } from "./EncryptedSyncProvider";
import type { ExcludeMatcher } from "./ExcludeMatcher";
import type { Logger } from "./Logger";
import type { SavedKeyInfo } from "./SavedSecretsService";
import type { PathGuard } from "./PathGuard";
import type { RootFolderService } from "./RootFolderService";
import type { SearchService } from "./SearchService";
import type { SyncProvider } from "./SyncProvider";
import { SyncService, type SyncConnection, type SyncLock } from "./SyncService";

/** What the context keys of the menus say, for all the services together. */
interface PublishedKeys {
  connected: boolean;
  encrypted: boolean;
  custom: boolean;
  autoCheck: boolean;
}

/**
 * All the sync services of the notes folder: one {@link SyncService} for each {@link SyncProvider} (GitHub, Google Drive...),
 * so the folder can be connected to several of them at once, each with its own connection, state and options. The hub has no
 * logic of its own: it makes the services, shares the lock that lets only one sync action run at a time, joins their events and
 * publishes the context keys (a key is true when ANY service is, for example connected).
 */
export class SyncHub implements vscode.Disposable {
  /** One service for each provider, in the order of the providers. */
  readonly services: readonly SyncService[];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly newVersionEmitter = new vscode.EventEmitter<SyncConnection>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private published: PublishedKeys | undefined;

  /** Fires when anything changed in any of the services. */
  readonly onDidChange = this.changeEmitter.event;
  /** Fires once for each new version that the automatic check of any service finds. */
  readonly onDidFindNewVersion = this.newVersionEmitter.event;

  constructor(
    memento: vscode.Memento,
    rootService: RootFolderService,
    pathGuard: PathGuard,
    searchService: SearchService,
    excludeMatcher: ExcludeMatcher,
    providers: readonly SyncProvider[],
    encryption: EncryptionSupport,
    logger: Logger,
    encryptMatcher: ExcludeMatcher,
    ignoreMatcher: ExcludeMatcher
  ) {
    const lock: SyncLock = { running: false };
    this.services = providers.map(
      (provider) =>
        new SyncService(
          memento,
          rootService,
          pathGuard,
          searchService,
          excludeMatcher,
          [provider],
          encryption,
          logger,
          encryptMatcher,
          ignoreMatcher,
          lock
        )
    );
    for (const service of this.services) {
      this.subscriptions.push(
        service.onDidChange(() => {
          this.changeEmitter.fire();
          void this.publish();
        }),
        service.onDidFindNewVersion((connection) => this.newVersionEmitter.fire(connection))
      );
    }
    this.subscriptions.push(this.changeEmitter, this.newVersionEmitter);
  }

  /** The providers, in order. */
  get providers(): readonly SyncProvider[] {
    return this.services.map((service) => service.provider);
  }

  /** The service that syncs with the provider `id`, or undefined. */
  service(id: string): SyncService | undefined {
    return this.services.find((service) => service.provider.id === id);
  }

  /** The services that the current notes folder is connected to. */
  get connected(): SyncService[] {
    return this.services.filter((service) => service.connection !== undefined);
  }

  /** The ids of the keys that any connection of any service could have saved (see `SavedSecretsService`). */
  savedKeyInfos(): SavedKeyInfo[] {
    return this.services.flatMap((service) => service.savedKeyInfos());
  }

  /** Forgets the keys that the services hold in memory. */
  dropSealedCaches(): void {
    for (const service of this.services) {
      service.dropSealedCache();
    }
  }

  /** True while a sync action runs in any service (only one runs at a time). */
  get isBusy(): boolean {
    return this.services.some((service) => service.isBusy);
  }

  get isAutoCheckOn(): boolean {
    return this.services[0]?.isAutoCheckOn ?? false;
  }

  /** Whether the list of the files to encrypt chooses this note (the rule does not depend on the service). */
  isSealedPath(path: string): boolean {
    return this.services.some((service) => service.isSealedPath(path));
  }

  /** Turns the automatic check on or off for all the services (one switch, per machine). */
  async setAutoCheck(value: boolean): Promise<void> {
    for (const service of this.services) {
      await service.setAutoCheck(value);
    }
    await this.publish();
  }

  /** Publishes the context keys and starts every service. Call once at activation. */
  async initialize(): Promise<void> {
    for (const service of this.services) {
      await service.initialize();
    }
    await this.publish();
  }

  dispose(): void {
    vscode.Disposable.from(...this.subscriptions, ...this.services).dispose();
  }

  /** Sets the context keys, and only the ones that changed. */
  private async publish(): Promise<void> {
    const states = this.services.map((service) => service.connectionState);
    const next: PublishedKeys = {
      connected: states.some((state) => state.connected),
      encrypted: states.some((state) => state.encrypted),
      custom: states.some((state) => state.custom),
      autoCheck: this.isAutoCheckOn,
    };
    const before = this.published;
    this.published = next;
    const set = (key: string, value: boolean): Thenable<unknown> =>
      vscode.commands.executeCommand(BuiltinCommands.setContext, key, value);
    if (before?.connected !== next.connected) {
      await set(ContextKeys.syncConnected, next.connected);
    }
    if (before?.encrypted !== next.encrypted) {
      await set(ContextKeys.syncEncrypted, next.encrypted);
    }
    if (before?.custom !== next.custom) {
      await set(ContextKeys.syncCustom, next.custom);
    }
    if (before?.autoCheck !== next.autoCheck) {
      await set(ContextKeys.syncAutoCheck, next.autoCheck);
    }
  }
}
