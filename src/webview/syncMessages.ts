/** Message contract between the extension and the Sync page. Keep webview/syncPage/syncPage.js in sync. */

const MAX_PATH_LENGTH = 1000;

/** What the buttons of the page do. Each one runs the command of the same name (see `SyncPageProvider`). */
export const SYNC_PAGE_ACTIONS = [
  "connect",
  "changeTarget",
  "disconnect",
  "refresh",
  "pull",
  "push",
  "history",
  "hidden",
  "autoCheckOn",
  "autoCheckOff",
  "encrypt",
  "changeKey",
  "forgetKey",
  "openEncryptList",
  "markedAction",
  "changeNames",
  "autoMessage",
  "openSyncSettings",
  "openOnline",
  "fixConflicts",
  "decryptRepository",
  "refreshAll",
  "pullAll",
  "pushAll",
] as const;
export type SyncPageAction = (typeof SYNC_PAGE_ACTIONS)[number];

export type SyncSide = "local" | "remote";
export type SyncChangeKind = "added" | "modified" | "deleted";

export type SyncPageToExtensionMessage =
  | { type: "ready" }
  | { type: "action"; action: SyncPageAction; provider: string | undefined }
  | {
      type: "showChange";
      side: SyncSide;
      path: string;
      kind: SyncChangeKind;
      provider: string | undefined;
    }
  | { type: "diffFile"; path: string; provider: string | undefined }
  | {
      type: "chooseConflict";
      path: string;
      resolution: "mine" | "theirs" | "both" | "ask";
      provider: string | undefined;
    };

export interface SyncChangeRow {
  path: string;
  kind: SyncChangeKind;
  /** The kind in words ("new", "changed", "deleted"). */
  kindText: string;
  conflict: boolean;
  /** For a file in conflict: the version the user chose to keep, or null (the pull asks). */
  choice: "mine" | "theirs" | "both" | null;
  /** `encrypted`: it goes online sealed. `listed-plain`: it is on the list of the files to encrypt, but the target is not encrypted. */
  seal: "encrypted" | "listed-plain" | null;
}

/** One service of the list that the page starts with: its status, and what it keeps. */
export interface SyncProviderRow {
  /** `github`, `googledrive`... */
  id: string;
  label: string;
  /** For a sync service: it is the one this notes folder is connected to. */
  connected: boolean;
  /** What the status says, and its colour. */
  status: { text: string; tone: "ok" | "warn" | "info" | "busy" | "off" };
  /** One more line: the repository it is connected to, or what the service is for. */
  summary: string;
}

/** What the page shows. Everything is already in words: the page only draws it. */
export interface SyncPageModel {
  /** A message instead of the page: there is no notes folder. */
  problem: string | undefined;
  connected: boolean;
  busy: boolean;
  /** "GitHub", "repository", "commit": the words of the service. */
  service:
    | {
        id: string;
        label: string;
        targetNoun: string;
        versionNoun: string;
        canLimitHistory: boolean;
        /** The service has a web page for the target, so the page offers a link to it. */
        canOpenOnline: boolean;
      }
    | undefined;
  target: { label: string; detail: string | undefined; isPrivate: boolean } | undefined;
  /** Where things stand: a sentence and an icon name of the page (`ok`, `warn`, `info`, `busy`). */
  state: { text: string; tone: "ok" | "warn" | "info" | "busy"; detail: string | undefined };
  local: SyncChangeRow[];
  remote: SyncChangeRow[];
  /** False until the remote was compared: then the remote list is empty because it is not known, not because it is the same. */
  remoteCompared: boolean;
  /** Something was compared at all (there is a status). */
  compared: boolean;
  hasNewVersion: boolean;
  keepLast: number | undefined;
  includeHidden: boolean;
  autoCheck: boolean;
  /** Null: the target is not encrypted. */
  encryption: { names: "plain" | "hidden"; custom: boolean } | null;
  /** The entries of the list of the files to encrypt, as written (the list belongs to the Settings page). */
  encryptList: string[];
  /** The notes of the folder that the list chooses (at most `MAX_ENCRYPTED_FILES`), read a moment after the page opens. */
  encryptedFiles: string[];
  /** There are more than `encryptedFiles` shows. */
  encryptedFilesMore: boolean;
  /** What Push does with a file on the list of the files to encrypt when the target is not encrypted. */
  markedAction: "ask" | "plain" | "skip" | "encrypt";
  /** Push uses the default message without asking. */
  autoMessage: boolean;
  /** The Google client of the Google Drive sync: where it comes from, and what is missing (nothing missing: it can sign in). */
  googleClient: { source: "config" | "local" | "built-in" | "none"; missing: ("id" | "secret")[] };
  /** The entries of the list of the files and folders that the sync leaves alone, as written. */
  ignoreList: string[];
  /** The GitLab sync: whether a token is saved on this computer, and the address of the GitLab it uses. */
  gitlab: { tokenSaved: boolean; address: string };
  /** The app key of the Dropbox sync is written in the settings. */
  dropboxKeySet: boolean;
  /** The services, first the ones of the sync, then Google Drive. */
  providers: SyncProviderRow[];
}

/** The texts of the page (see `Strings.syncPage`), by name. */
export type SyncPageTexts = Record<string, string>;

export type ExtensionToSyncPageMessage =
  | { type: "init"; texts: SyncPageTexts; models: Record<string, SyncPageModel> }
  | { type: "update"; models: Record<string, SyncPageModel> }
  /** Shows a section of a service (for example the Conflicts of the changes), sent by the extension after the page opened. */
  | { type: "show"; provider: string; section: "changes" };

const MAX_PROVIDER_LENGTH = 64;

/** The id of the service a message is about (the one that is open on the page), or undefined. Anything else is dropped. */
function providerOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_PROVIDER_LENGTH
    ? value
    : undefined;
}

/** Page content is untrusted input: check type and size of everything before using it. */
export function parseSyncPageMessage(value: unknown): SyncPageToExtensionMessage | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case "ready":
      return { type: "ready" };
    case "action":
      return (SYNC_PAGE_ACTIONS as readonly unknown[]).includes(message.action)
        ? {
            type: "action",
            action: message.action as SyncPageAction,
            provider: providerOf(message.provider),
          }
        : undefined;
    case "showChange":
      return (message.side === "local" || message.side === "remote") &&
        typeof message.path === "string" &&
        message.path.length > 0 &&
        message.path.length <= MAX_PATH_LENGTH &&
        (message.kind === "added" || message.kind === "modified" || message.kind === "deleted")
        ? {
            type: "showChange",
            side: message.side,
            path: message.path,
            kind: message.kind,
            provider: providerOf(message.provider),
          }
        : undefined;
    case "diffFile":
      return typeof message.path === "string" &&
        message.path.length > 0 &&
        message.path.length <= MAX_PATH_LENGTH
        ? { type: "diffFile", path: message.path, provider: providerOf(message.provider) }
        : undefined;
    case "chooseConflict":
      return typeof message.path === "string" &&
        message.path.length > 0 &&
        message.path.length <= MAX_PATH_LENGTH &&
        (message.resolution === "mine" ||
          message.resolution === "theirs" ||
          message.resolution === "both" ||
          message.resolution === "ask")
        ? {
            type: "chooseConflict",
            path: message.path,
            resolution: message.resolution,
            provider: providerOf(message.provider),
          }
        : undefined;
    default:
      return undefined;
  }
}
