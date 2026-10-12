import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { Strings } from "../constants/strings";
import type { SyncConnection, SyncService } from "../services/SyncService";
import type { Change } from "../services/SyncPlan";

/** Context values, used by the menus of the view in package.json. */
export const SyncContexts = {
  group: "noteRoot.syncGroup",
  info: "noteRoot.syncInfo",
  changes: "noteRoot.syncChanges",
  file: "noteRoot.syncFile",
} as const;

type Side = "local" | "remote";
type SyncNode = SyncGroupItem | SyncInfoItem | SyncChangesItem | SyncFileItem;

/** "<Service> Sync": the first section of the Actions view. Its description tells what the folder is connected to. */
export class SyncGroupItem extends vscode.TreeItem {
  constructor(connection: SyncConnection) {
    const { provider, target } = connection;
    super(Strings.sync.group(provider.label), vscode.TreeItemCollapsibleState.Expanded);
    this.id = "sync:group";
    const where = target.detail ? `${target.label} (${target.detail})` : target.label;
    const parts = [where];
    if (connection.encryption) {
      parts.push(Strings.sync.encryption.tag);
    }
    if (connection.keepLast !== undefined) {
      parts.push(Strings.sync.keepLastTag(connection.keepLast));
    }
    if (connection.includeHidden) {
      parts.push(Strings.sync.hidden.tag);
    }
    this.description = parts.join(" · ");
    if (connection.encryption) {
      this.tooltip += `\n${Strings.sync.encryption.tooltip(
        connection.encryption.names === "hidden"
          ? Strings.sync.encryption.namesHiddenShort
          : Strings.sync.encryption.namesPlainShort
      )}`;
    }
    this.tooltip = Strings.sync.targetTooltip(
      provider.label,
      target.label,
      target.detail,
      target.isPrivate
    );
    this.iconPath = new vscode.ThemeIcon(
      connection.encryption ? "shield" : target.isPrivate ? "lock" : "unlock"
    );
    this.contextValue = SyncContexts.group;
  }
}

/** The line that says where things stand: not checked yet, in sync, N to push, N to pull. */
export class SyncInfoItem extends vscode.TreeItem {
  constructor(label: string, icon: string, description?: string, tooltip?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = "sync:info";
    this.description = description;
    this.tooltip = tooltip;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = SyncContexts.info;
  }
}

/** "Local changes" or "Remote changes", with the number of files. */
export class SyncChangesItem extends vscode.TreeItem {
  constructor(
    readonly side: Side,
    readonly changes: readonly Change[],
    compared = true
  ) {
    super(
      side === "local" ? Strings.sync.localChanges : Strings.sync.remoteChanges,
      changes.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );
    this.id = `sync:${side}`;
    this.description = !compared
      ? Strings.sync.notCheckedShort
      : changes.length > 0
        ? Strings.sync.changeCount(changes.length)
        : Strings.sync.nothingNew;
    this.iconPath = new vscode.ThemeIcon(side === "local" ? "cloud-upload" : "cloud-download");
    this.contextValue = SyncContexts.changes;
  }
}

/** One file that differs between this computer and the repository. */
export class SyncFileItem extends vscode.TreeItem {
  constructor(
    readonly side: Side,
    readonly change: Change,
    isConflict: boolean
  ) {
    const slash = change.path.lastIndexOf("/");
    super(change.path.slice(slash + 1), vscode.TreeItemCollapsibleState.None);
    this.id = `sync:${side}:${change.path}`;
    const folder = slash >= 0 ? change.path.slice(0, slash) : "";
    const kind = Strings.sync.kind[change.kind];
    this.description = [folder, kind, isConflict ? Strings.sync.conflict : ""]
      .filter((part) => part.length > 0)
      .join(" · ");
    this.tooltip = `${change.path} (${kind})`;
    this.iconPath = new vscode.ThemeIcon(
      isConflict
        ? "warning"
        : change.kind === "added"
          ? "diff-added"
          : change.kind === "deleted"
            ? "diff-removed"
            : "diff-modified"
    );
    this.contextValue = SyncContexts.file;
    // A click shows what changed: the file against its online version (or the file alone when the other side has none).
    this.command = {
      command: Commands.syncShowChange,
      title: Strings.sync.diff.localTitle(change.path),
      arguments: [side, change.path, change.kind],
    };
  }
}

/** The Actions view: the sync with a remote service, with the files to push and the files to pull. */
export class SyncTreeProvider implements vscode.TreeDataProvider<SyncNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<SyncNode | undefined>();
  private readonly subscription: vscode.Disposable;
  private view: vscode.TreeView<SyncNode> | undefined;

  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly sync: SyncService) {
    this.subscription = sync.onDidChange(() => {
      this.emitter.fire(undefined);
      this.updateBadge();
    });
  }

  /** Lets the provider put the number of pending changes on the icon of the view. */
  attach(view: vscode.TreeView<SyncNode>): void {
    this.view = view;
    this.updateBadge();
  }

  getTreeItem(element: SyncNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SyncNode): SyncNode[] {
    const connection = this.sync.connection;
    if (!connection) {
      return []; // The welcome text of the view explains how to connect.
    }
    if (!element) {
      return [new SyncGroupItem(connection)];
    }
    if (element instanceof SyncGroupItem) {
      return this.groupChildren(connection);
    }
    if (element instanceof SyncChangesItem) {
      const conflicts = new Set(this.sync.snapshot.status?.conflicts ?? []);
      return element.changes.map(
        (change) => new SyncFileItem(element.side, change, conflicts.has(change.path))
      );
    }
    return [];
  }

  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
  }

  private groupChildren(connection: SyncConnection): SyncNode[] {
    const noun = connection.provider.versionNoun;
    const snapshot = this.sync.snapshot;
    const status = snapshot.status;
    if (this.sync.isBusy) {
      return [new SyncInfoItem(Strings.sync.checking, "sync~spin")];
    }
    if (!status) {
      return [
        snapshot.hasNewVersion
          ? new SyncInfoItem(
              Strings.sync.newVersion(noun),
              "bell",
              undefined,
              Strings.sync.newVersionTooltip(noun)
            )
          : new SyncInfoItem(
              Strings.sync.notChecked,
              "question",
              undefined,
              Strings.sync.notCheckedTooltip
            ),
      ];
    }
    const time = snapshot.checkedAt?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const info = !snapshot.remoteCompared
      ? new SyncInfoItem(
          Strings.sync.remoteNotChecked,
          "question",
          status.local.length > 0 ? Strings.sync.changedHere(status.local.length) : undefined,
          Strings.sync.remoteNotCheckedTooltip
        )
      : status.local.length === 0 && status.remote.length === 0 && !snapshot.hasNewVersion
        ? new SyncInfoItem(
            Strings.sync.inSync,
            "check",
            undefined,
            time ? Strings.sync.checkedAt(time) : undefined
          )
        : new SyncInfoItem(
            snapshot.hasNewVersion
              ? Strings.sync.newVersion(noun)
              : Strings.sync.refreshed(status.local.length, status.remote.length),
            snapshot.hasNewVersion ? "bell" : "sync",
            undefined,
            time ? Strings.sync.checkedAt(time) : undefined
          );
    return [
      info,
      new SyncChangesItem("local", status.local),
      new SyncChangesItem("remote", status.remote, snapshot.remoteCompared),
    ];
  }

  private updateBadge(): void {
    if (!this.view) {
      return;
    }
    const snapshot = this.sync.snapshot;
    const status = snapshot.status;
    const connection = this.sync.connection;
    const count = status
      ? status.local.length + status.remote.length
      : snapshot.hasNewVersion
        ? 1
        : 0;
    this.view.badge =
      connection && count > 0
        ? {
            value: count,
            tooltip: status
              ? Strings.sync.refreshed(status.local.length, status.remote.length)
              : Strings.sync.newVersion(connection.provider.versionNoun),
          }
        : undefined;
  }
}
