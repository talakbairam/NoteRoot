import * as vscode from "vscode";
import { StateKeys } from "../constants/context";
import { Logger } from "./Logger";

const WRITE_DEBOUNCE_MS = 300;

export interface TreeState {
  /** Folder paths relative to the root, `/`-separated. */
  expanded: string[];
  selected?: string;
}

type TreeStateMap = Record<string, TreeState>;
type DraftMap = Record<string, string>;
type RecentMap = Record<string, string[]>;

/**
 * Typed wrapper around `globalState` (per machine, never written into the notes folder).
 * Writes are debounced; reads see pending writes immediately.
 */
export class StateService implements vscode.Disposable {
  private treeStates: TreeStateMap;
  private treeDirty = false;
  /** Pending draft changes by root path. `undefined` means "remove the draft". */
  private readonly pendingDrafts = new Map<string, string | undefined>();
  /** Pending recent notes lists by root path. */
  private readonly pendingRecent = new Map<string, string[]>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly memento: vscode.Memento,
    private readonly logger: Logger
  ) {
    this.treeStates = sanitizeTreeStates(memento.get<unknown>(StateKeys.treeState));
  }

  // ----- tree state -----

  getTreeState(rootPath: string): TreeState {
    const state = this.treeStates[rootPath];
    return state ? { expanded: [...state.expanded], selected: state.selected } : { expanded: [] };
  }

  setTreeState(rootPath: string, state: TreeState): void {
    this.treeStates[rootPath] = { expanded: [...state.expanded], selected: state.selected };
    this.treeDirty = true;
    this.scheduleFlush();
  }

  // ----- Quick Note draft -----

  /** The draft of a root ('' when there is none). Use '' as the root path while no root is set. */
  getDraft(rootPath: string): string {
    if (this.pendingDrafts.has(rootPath)) {
      return this.pendingDrafts.get(rootPath) ?? "";
    }
    return sanitizeDrafts(this.memento.get<unknown>(StateKeys.quickNoteDraft))[rootPath] ?? "";
  }

  setDraft(rootPath: string, text: string): void {
    this.pendingDrafts.set(rootPath, text === "" ? undefined : text);
    this.scheduleFlush();
  }

  /** Removes a draft right away, so a saved note cannot come back after a reload. */
  clearDraft(rootPath: string): void {
    this.pendingDrafts.set(rootPath, undefined);
    this.flush();
  }

  // ----- recent notes -----

  /** Recently opened notes of a root, newest first, as paths relative to the root. */
  getRecent(rootPath: string): string[] {
    const pending = this.pendingRecent.get(rootPath);
    if (pending) {
      return [...pending];
    }
    return sanitizeRecent(this.memento.get<unknown>(StateKeys.recentNotes))[rootPath] ?? [];
  }

  setRecent(rootPath: string, paths: readonly string[]): void {
    this.pendingRecent.set(rootPath, [...paths]);
    this.scheduleFlush();
  }

  /** Writes pending changes now. Fire and forget: failures are logged. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.treeDirty) {
      this.treeDirty = false;
      this.write(StateKeys.treeState, this.treeStates);
    }
    if (this.pendingDrafts.size > 0) {
      // Merge into what is stored now instead of overwriting everything: another window
      // may have saved the draft of a different root since this one started.
      const drafts = sanitizeDrafts(this.memento.get<unknown>(StateKeys.quickNoteDraft));
      for (const [rootPath, text] of this.pendingDrafts) {
        if (text === undefined) {
          delete drafts[rootPath];
        } else {
          drafts[rootPath] = text;
        }
      }
      this.pendingDrafts.clear();
      this.write(StateKeys.quickNoteDraft, drafts);
    }
    if (this.pendingRecent.size > 0) {
      // Merged for the same reason as the drafts: other windows write this key too.
      const recent = sanitizeRecent(this.memento.get<unknown>(StateKeys.recentNotes));
      for (const [rootPath, paths] of this.pendingRecent) {
        if (paths.length === 0) {
          delete recent[rootPath];
        } else {
          recent[rootPath] = paths;
        }
      }
      this.pendingRecent.clear();
      this.write(StateKeys.recentNotes, recent);
    }
  }

  dispose(): void {
    this.flush();
  }

  private scheduleFlush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.flush(), WRITE_DEBOUNCE_MS);
  }

  private write(key: string, value: unknown): void {
    this.memento.update(key, value).then(undefined, (error: unknown) => {
      this.logger.error(`Could not save ${key}.`, error);
    });
  }
}

/** Stored data survives extension updates and manual edits, so never trust its shape. */
function sanitizeTreeStates(value: unknown): TreeStateMap {
  const result: TreeStateMap = {};
  if (typeof value !== "object" || value === null) {
    return result;
  }
  for (const [rootPath, raw] of Object.entries(value)) {
    const state = raw as Partial<TreeState> | null;
    if (state && Array.isArray(state.expanded)) {
      result[rootPath] = {
        expanded: state.expanded.filter((item): item is string => typeof item === "string"),
        selected: typeof state.selected === "string" ? state.selected : undefined,
      };
    }
  }
  return result;
}

function sanitizeDrafts(value: unknown): DraftMap {
  const result: DraftMap = {};
  if (typeof value === "object" && value !== null) {
    for (const [rootPath, text] of Object.entries(value)) {
      if (typeof text === "string") {
        result[rootPath] = text;
      }
    }
  }
  return result;
}

function sanitizeRecent(value: unknown): RecentMap {
  const result: RecentMap = {};
  if (typeof value === "object" && value !== null) {
    for (const [rootPath, paths] of Object.entries(value)) {
      if (Array.isArray(paths)) {
        result[rootPath] = paths.filter((item): item is string => typeof item === "string");
      }
    }
  }
  return result;
}
