/**
 * The pure part of the sync: comparing three states and planning a pull. No `vscode`, no files, no network, so it can be
 * checked on its own, and it does not depend on which service is synced with.
 *
 * A state is a map from a path (relative to the notes folder, `/`-separated) to the hash that the remote reports for the
 * file content (see `SyncProvider`). Three states take part: the **base** (what was synced last), the **local** files and
 * the **remote**.
 */

export type FileState = ReadonlyMap<string, string>;

export type ChangeKind = "added" | "modified" | "deleted";

export interface Change {
  readonly path: string;
  readonly kind: ChangeKind;
}

/** The file of the folder settings, the only file of `.noteroot` that is synced. */
export const CONFIG_PATH = ".noteroot/config.json";

/** A file a provider may keep on the remote for itself (GitHub: to start an empty repository). Never copied here, never pushed. */
export const MARKER_PATH = ".noteroot-sync";

/** What changed from `from` to `to`, in path order. */
export function diffStates(from: FileState, to: FileState): Change[] {
  const changes: Change[] = [];
  for (const [path, sha] of to) {
    const before = from.get(path);
    if (before === undefined) {
      changes.push({ path, kind: "added" });
    } else if (before !== sha) {
      changes.push({ path, kind: "modified" });
    }
  }
  for (const path of from.keys()) {
    if (!to.has(path)) {
      changes.push({ path, kind: "deleted" });
    }
  }
  return changes.sort((a, b) => compareText(a.path, b.path));
}

export type ConflictKind =
  /** Changed on this computer and in the repository, to different contents. */
  | "both-changed"
  /** Deleted in the repository, changed on this computer. */
  | "remote-deleted"
  /** Deleted on this computer, changed in the repository. */
  | "local-deleted";

export interface Conflict {
  readonly path: string;
  readonly kind: ConflictKind;
}

/** What to keep when a path has a conflict. */
export type Resolution = "mine" | "theirs" | "both";

export interface PullPlan {
  /** Remote changes that touch nothing changed here: they are applied without a question. */
  readonly apply: readonly Change[];
  readonly conflicts: readonly Conflict[];
}

/**
 * What a pull does. A path that is the same on both sides needs nothing. A path that changed only in the repository is
 * applied. A path that changed in the repository and differs here (changed or deleted) is a conflict.
 */
export function planPull(base: FileState, local: FileState, remote: FileState): PullPlan {
  const apply: Change[] = [];
  const conflicts: Conflict[] = [];
  for (const change of diffStates(base, remote)) {
    const localSha = local.get(change.path);
    const remoteSha = remote.get(change.path);
    if (localSha === remoteSha) {
      continue; // The same on both sides, whatever the base says.
    }
    if (localSha === base.get(change.path)) {
      apply.push(change);
    } else if (remoteSha === undefined) {
      conflicts.push({ path: change.path, kind: "remote-deleted" });
    } else if (localSha === undefined) {
      conflicts.push({ path: change.path, kind: "local-deleted" });
    } else {
      conflicts.push({ path: change.path, kind: "both-changed" });
    }
  }
  return { apply, conflicts };
}

export interface SyncStatus {
  /** Changes made here since the last sync: what a push sends. */
  readonly local: readonly Change[];
  /** Changes in the repository since the last sync: what a pull brings. */
  readonly remote: readonly Change[];
  /** Paths that a pull cannot apply by itself. */
  readonly conflicts: readonly string[];
}

/** The two lists of the Actions view. A path that ended up identical on both sides is not a change for anyone. */
export function compareStates(base: FileState, local: FileState, remote: FileState): SyncStatus {
  const identical = (path: string): boolean => local.get(path) === remote.get(path);
  const plan = planPull(base, local, remote);
  return {
    local: diffStates(base, local).filter((change) => !identical(change.path)),
    remote: diffStates(base, remote).filter((change) => !identical(change.path)),
    conflicts: plan.conflicts.map((conflict) => conflict.path),
  };
}

/**
 * The state after a pull: everything in the repository has been seen, so the base becomes the remote state. Paths that
 * were kept here as they are show up as local changes, to be pushed.
 */
export function stateAfterPull(remote: FileState): Map<string, string> {
  return new Map(remote);
}

/** The state after a push: the pushed paths now have the contents that were sent. */
export function stateAfterPush(
  base: FileState,
  pushed: readonly Change[],
  local: FileState
): Map<string, string> {
  const next = new Map(base);
  for (const change of pushed) {
    const sha = local.get(change.path);
    if (change.kind === "deleted" || sha === undefined) {
      next.delete(change.path);
    } else {
      next.set(change.path, sha);
    }
  }
  return next;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const BAD_CHARACTERS = /[<>:"|?*\\\u0000-\u001f\u007f]/;

/**
 * A path from the repository is data from outside, so it is checked before it is ever turned into a file: no empty,
 * `.` or `..` part, no characters or names that Windows refuses, no trailing dot or space. Returns false for a path
 * that cannot be used safely on every system. (The caller also checks that it stays inside the notes folder.)
 */
export function isSafeRemotePath(path: string): boolean {
  if (path.length === 0 || path.length > 500 || path.startsWith("/")) {
    return false;
  }
  return path.split("/").every(isSafeSegment);
}

function isSafeSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment.length <= 255 &&
    segment !== "." &&
    segment !== ".." &&
    !BAD_CHARACTERS.test(segment) &&
    !WINDOWS_RESERVED.test(segment) &&
    !/[. ]$/.test(segment)
  );
}

const NEVER_SYNCED = new Set([".git", ".noteroot", ".ds_store", "thumbs.db", "desktop.ini"]);

/**
 * Names the sync never touches, even when the user chose to sync hidden files: the folder of Git (GitHub refuses it, and a
 * repository inside a repository is no use), the config folder of NoteRoot (only its `config.json` is synced, by its own
 * rule), and the junk files of the operating systems.
 */
export function isNeverSynced(name: string): boolean {
  return NEVER_SYNCED.has(name.toLowerCase());
}

/** Whether a path of the repository is one that the sync handles: a note (or any file) of the folder, or its config. */
export function isSyncedRemotePath(path: string): boolean {
  if (path === MARKER_PATH) {
    return false;
  }
  if (path === CONFIG_PATH) {
    return true;
  }
  return isSafeRemotePath(path) && !path.split("/").some(isNeverSynced);
}

/** `note.md` becomes `note (online).md`, `note (online 2).md`, ... The first name that `taken` does not know. */
export function copyName(path: string, taken: (candidate: string) => boolean): string {
  const slash = path.lastIndexOf("/");
  const folder = slash >= 0 ? path.slice(0, slash + 1) : "";
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let n = 1; ; n++) {
    const label = n === 1 ? "online" : `online ${n}`;
    const candidate = `${folder}${stem} (${label})${extension}`;
    if (!taken(candidate)) {
      return candidate;
    }
  }
}

/** Natural, case-insensitive order, the same everywhere. */
function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
