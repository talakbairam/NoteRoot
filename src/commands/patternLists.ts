import * as vscode from "vscode";
import type { SettingKey } from "../constants/settings";
import type { ExcludeMatcher } from "../services/ExcludeMatcher";
import type { SettingsService } from "../services/SettingsService";
import { showStatus } from "../util/status";

/** The texts of one list of patterns (the hidden list, the list of the files without tagging). */
export interface PatternListMessages {
  /** The items were added to the list (their path as an entry). */
  added: (name: string, count: number) => string;
  alreadyAdded: string;
  undo: string;
  /** The items were taken out of the list. */
  removed: (name: string, count: number) => string;
  /** Asks before a pattern that matches more than the one item is taken out. */
  removePattern: (pattern: string) => string;
  removePatternAction: string;
  /** The item is only inside a folder that is in the list. */
  insideFolder: (name: string, folder: string) => string;
  includeFolderAction: string;
  nothing: string;
}

export interface PatternListOptions {
  settings: SettingsService;
  /** The setting that holds the list. */
  key: SettingKey;
  /** The list now. */
  read: () => readonly string[];
  /** Tells which patterns of the list match an entry. */
  matcher: ExcludeMatcher;
  messages: PatternListMessages;
}

/** True for the entry that is exactly this path anchored to the notes folder (`/Work/drafts`), any case. */
function isEntryFor(pattern: string, relativePath: string): boolean {
  const bare = pattern.replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();
  return pattern.startsWith("/") && bare === relativePath.toLowerCase();
}

/**
 * Adds the path of each item to the list, anchored to the notes folder (`/Work/drafts`), and offers Undo. Entries that are
 * already there (any case) are skipped.
 */
export async function addToPatternList(
  paths: readonly string[],
  options: PatternListOptions
): Promise<void> {
  const { settings, key, read, messages } = options;
  const before = [...read()];
  const list = [...before];
  const known = new Set(list.map((entry) => entry.toLowerCase()));
  const added: string[] = [];
  for (const path of paths) {
    const pattern = `/${path}`;
    if (!known.has(pattern.toLowerCase())) {
      known.add(pattern.toLowerCase());
      list.push(pattern);
      added.push(pattern);
    }
  }
  if (added.length === 0) {
    showStatus(messages.alreadyAdded);
    return;
  }
  await settings.setValue(key, list);
  const name = added[0].slice(added[0].lastIndexOf("/") + 1);
  if (
    (await vscode.window.showInformationMessage(
      messages.added(name, added.length),
      messages.undo
    )) === messages.undo
  ) {
    await settings.setValue(key, before);
  }
}

/**
 * Takes out of the list what puts the items there. An entry for just this path goes at once; a pattern that matches other items too
 * (`.git`, `*.tmp`) is asked about first. An item that is only inside a folder of the list points to that folder. Offers Undo.
 */
export async function removeFromPatternList(
  items: readonly { name: string; relativePath: string }[],
  options: PatternListOptions
): Promise<void> {
  const { settings, key, read, matcher, messages } = options;
  const before = [...read()];
  let list = [...before];
  const takeOut = (pattern: string): void => {
    list = list.filter((entry) => entry.trim() !== pattern);
  };
  const done: string[] = [];
  const inside: { name: string; folder: string }[] = [];
  for (const item of items) {
    const own = matcher.matchingPatterns(item.name, item.relativePath);
    if (own.length === 0) {
      // Only because a folder above it is in the list: the first such folder is the one to take out.
      const segments = item.relativePath.split("/");
      const folder = segments
        .slice(0, -1)
        .map((_, index) => segments.slice(0, index + 1).join("/"))
        .find(
          (path) => matcher.matchingPatterns(path.slice(path.lastIndexOf("/") + 1), path).length > 0
        );
      inside.push({ name: item.name, folder: folder ?? "" });
      continue;
    }
    let removedAny = false;
    for (const pattern of own) {
      if (isEntryFor(pattern, item.relativePath)) {
        takeOut(pattern);
        removedAny = true;
      } else if (
        (await vscode.window.showWarningMessage(
          messages.removePattern(pattern),
          { modal: true },
          messages.removePatternAction
        )) === messages.removePatternAction
      ) {
        takeOut(pattern);
        removedAny = true;
      }
    }
    if (removedAny) {
      done.push(item.name);
    }
  }

  if (done.length > 0) {
    await settings.setValue(key, list);
    if (
      (await vscode.window.showInformationMessage(
        messages.removed(done[0], done.length),
        messages.undo
      )) === messages.undo
    ) {
      await settings.setValue(key, before);
    }
  } else if (inside.length > 0 && inside[0].folder !== "") {
    const { name, folder } = inside[0];
    if (
      (await vscode.window.showInformationMessage(
        messages.insideFolder(name, folder),
        messages.includeFolderAction
      )) === messages.includeFolderAction
    ) {
      const exact = matcher
        .matchingPatterns(folder.slice(folder.lastIndexOf("/") + 1), folder)
        .filter((pattern) => isEntryFor(pattern, folder));
      if (exact.length > 0) {
        await settings.setValue(
          key,
          list.filter((entry) => !exact.includes(entry.trim()))
        );
      } else {
        showStatus(messages.nothing);
      }
    }
  } else {
    showStatus(messages.nothing);
  }
}
