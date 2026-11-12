import * as vscode from "vscode";
import { ConfigFile } from "../constants/settings";
import { RootMissingError } from "../util/errors";
import { ConfigService } from "./ConfigService";
import { Logger } from "./Logger";
import type { RootFolderService } from "./RootFolderService";
import {
  MAX_SIDEBAR_GAPS,
  addGap,
  countGaps,
  defaultLayout,
  isGapItem,
  moveItem,
  normalizeLayout,
  type SidebarItemId,
  type SidebarLayout,
} from "./SidebarLayout";

/** Where the layout is stored: `custom.sidebar` of `.noteroot/config.json`. */
const CONFIG_KEY = "sidebar";
const WATCH_DEBOUNCE_MS = 200;

/**
 * The order of the rows at the top of the Notes tree (the sync rows, Favorites, Pinned and Recent, and the blank rows) and
 * which of them are shown. A hidden row is not in the tree at all; its contents are not touched (the pins, the favorites and
 * the recent list stay). It is stored in the `custom` part of the config file of the notes folder, so it belongs to that
 * folder and travels with it (and with the Sync), and it is not stored while it is the default. A config file that is damaged
 * or newer than this version is not trusted: the default applies and nothing is written. The Settings page is where it is
 * changed; the service shows no UI (a write that cannot be done throws, and the page reports it).
 */
export class SidebarLayoutService implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[];
  private layout: SidebarLayout = defaultLayout();
  private watcher: vscode.Disposable | undefined;
  private watchedRoot: string | undefined;
  private timer: NodeJS.Timeout | undefined;
  private loadCounter = 0;

  /** Fires when the order or the visibility changed. */
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private readonly rootService: RootFolderService,
    private readonly configService: ConfigService,
    private readonly logger: Logger
  ) {
    this.disposables = [
      this.changeEmitter,
      rootService.onDidChangeRoot(() => void this.reload()),
      rootService.onDidChangeState(() => void this.reload()),
    ];
    void this.reload();
  }

  /** All the rows in the order the user chose, the hidden ones too. */
  order(): readonly SidebarItemId[] {
    return this.layout.order;
  }

  isVisible(id: SidebarItemId): boolean {
    return !this.layout.hidden.includes(id);
  }

  /** True while another blank row can be added. */
  canAddGap(): boolean {
    return countGaps(this.layout.order) < MAX_SIDEBAR_GAPS;
  }

  /** @throws RootMissingError without a notes folder, ConfigLockedError when the config file may not be changed. */
  async move(id: SidebarItemId, direction: -1 | 1): Promise<void> {
    await this.save({ ...this.layout, order: moveItem(this.layout.order, id, direction) });
  }

  /** @throws the same errors as {@link move}. */
  async setVisible(id: SidebarItemId, visible: boolean): Promise<void> {
    const rest = this.layout.hidden.filter((hidden) => hidden !== id);
    await this.save({ ...this.layout, hidden: visible ? rest : [...rest, id] });
  }

  /** Adds a blank row at the end of the list. @throws the same errors as {@link move}. */
  async addGap(): Promise<void> {
    await this.save({ ...this.layout, order: addGap(this.layout.order) });
  }

  /** Takes a blank row away (a row that always exists is not removed). @throws the same errors as {@link move}. */
  async removeGap(id: SidebarItemId): Promise<void> {
    if (!isGapItem(id)) {
      return;
    }
    await this.save({
      order: this.layout.order.filter((item) => item !== id),
      hidden: this.layout.hidden.filter((item) => item !== id),
    });
  }

  /** Back to the default order with every row shown. @throws the same errors as {@link move}. */
  async reset(): Promise<void> {
    await this.save(defaultLayout());
  }

  /** Reads the layout of the notes folder again (root or state changed, or the config file changed on disk). */
  async reload(): Promise<void> {
    const ticket = ++this.loadCounter;
    const root = this.rootService.hasRoot ? this.rootService.getRootUri() : undefined;
    this.watch(root);
    let layout = defaultLayout();
    if (root) {
      try {
        const result = await this.configService.ensure(root);
        if (ticket !== this.loadCounter) {
          return;
        }
        // A file that is damaged or newer than this version is not trusted: the default applies.
        if (result.status === "ok" || result.status === "created") {
          layout = normalizeLayout(result.config.custom[CONFIG_KEY]);
        }
      } catch (error) {
        this.logger.error("Could not read the sidebar layout of the notes folder.", error);
        return;
      }
    }
    this.apply(layout);
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.watcher?.dispose();
    vscode.Disposable.from(...this.disposables).dispose();
  }

  private apply(layout: SidebarLayout): void {
    const changed = JSON.stringify(layout) !== JSON.stringify(this.layout);
    this.layout = layout;
    if (changed) {
      this.changeEmitter.fire();
    }
  }

  /** The layout is written first and only then shown, so a refused write changes nothing. */
  private async save(layout: SidebarLayout): Promise<void> {
    const root = this.rootService.hasRoot ? this.rootService.getRootUri() : undefined;
    if (!root) {
      throw new RootMissingError();
    }
    const isDefault = JSON.stringify(layout) === JSON.stringify(defaultLayout());
    await this.configService.updateCustom(root, (custom) => {
      if (isDefault) {
        delete custom[CONFIG_KEY];
      } else {
        custom[CONFIG_KEY] = { order: layout.order, hidden: layout.hidden };
      }
    });
    this.apply(layout);
  }

  /** Watches the config file, so a change made by hand or by another window is picked up. */
  private watch(root: vscode.Uri | undefined): void {
    const key = root?.toString();
    if (key === this.watchedRoot) {
      return;
    }
    this.watcher?.dispose();
    this.watcher = undefined;
    this.watchedRoot = key;
    if (!root) {
      return;
    }
    const fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, `${ConfigFile.dirName}/${ConfigFile.fileName}`)
    );
    const onEvent = (): void => {
      if (this.timer) {
        clearTimeout(this.timer);
      }
      this.timer = setTimeout(() => void this.reload(), WATCH_DEBOUNCE_MS);
    };
    this.watcher = vscode.Disposable.from(
      fileWatcher,
      fileWatcher.onDidChange(onEvent),
      fileWatcher.onDidCreate(onEvent),
      fileWatcher.onDidDelete(onEvent)
    );
  }
}
