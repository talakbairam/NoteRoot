import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { Strings } from "../constants/strings";
import { isEncryptedName } from "../services/NoteCrypto";

/**
 * - folder: real directory, expandable
 * - symlinkFolder: link to a directory, shown but never expanded (prevents cycles and escaping the root)
 * - file: regular file or link to a file
 * - other: anything else, for example a broken link
 */
export type NoteKind = "folder" | "symlinkFolder" | "file" | "other";

export const ContextValues = {
  folder: "noteRoot.folder",
  symlinkFolder: "noteRoot.symlinkFolder",
  file: "noteRoot.file",
  markdownFile: "noteRoot.file.md",
  other: "noteRoot.other",
  quickNoteSuffix: ".quickNote",
} as const;

export function kindFromFileType(type: vscode.FileType): NoteKind {
  const isLink = (type & vscode.FileType.SymbolicLink) !== 0;
  if ((type & vscode.FileType.Directory) !== 0) {
    return isLink ? "symlinkFolder" : "folder";
  }
  return (type & vscode.FileType.File) !== 0 ? "file" : "other";
}

export class NoteItem extends vscode.TreeItem {
  constructor(
    readonly uri: vscode.Uri,
    /** Path relative to the root, `/`-separated. Also the stable tree id. */
    readonly relativePath: string,
    readonly kind: NoteKind,
    isQuickNoteFile = false,
    /** Hidden by the exclude patterns, shown because "Show Hidden Items" is on. */
    readonly hidden = false,
    /** Left out of automatic tagging by the list of the files without tagging. */
    readonly noTag = false,
    /** Write "no tags" next to the name: only while "Show Hidden Items" is on, so a normal tree stays clean. */
    markNoTag = false
  ) {
    // Passing the URI as resourceUri (and no iconPath) lets the user's file icon theme pick the icon.
    super(
      uri,
      kind === "folder"
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );
    this.id = relativePath;
    this.label = relativePath.slice(relativePath.lastIndexOf("/") + 1);
    // A suffix like the one of the Quick Note file: the menus test the start of the value, and "Include" tests the end.
    this.contextValue =
      contextValueFor(kind, this.label, isQuickNoteFile) +
      (hidden ? ".hidden" : "") +
      (noTag ? ".notag" : "");
    const locked = kind === "file" && isEncryptedName(this.label);
    if (locked) {
      this.contextValue += ".locked";
    }
    if (hidden || (noTag && markNoTag)) {
      this.description = [
        hidden ? Strings.tree.hiddenMark : "",
        noTag && markNoTag ? Strings.tree.noTagMark : "",
      ]
        .filter(Boolean)
        .join(" · ");
    }

    if (kind === "symlinkFolder") {
      // A leaf with a folder icon, because the theme would show a file icon for a non-collapsible item.
      this.iconPath = vscode.ThemeIcon.Folder;
    }
    if (locked) {
      // An encrypted note cannot be opened as text: a click asks for the key and shows it for reading.
      this.iconPath = new vscode.ThemeIcon("lock");
      this.tooltip = Strings.encryption.lockedTooltip;
      this.command = { command: Commands.decryptView, title: Strings.tree.open, arguments: [uri] };
    } else if (kind === "file") {
      this.command = { command: Commands.openItem, title: Strings.tree.open, arguments: [uri] };
    }
  }

  get name(): string {
    return typeof this.label === "string" ? this.label : this.relativePath;
  }
}

function contextValueFor(kind: NoteKind, name: string, isQuickNoteFile: boolean): string {
  switch (kind) {
    case "folder":
      return ContextValues.folder;
    case "symlinkFolder":
      return ContextValues.symlinkFolder;
    case "other":
      return ContextValues.other;
    case "file": {
      const base = name.toLowerCase().endsWith(".md")
        ? ContextValues.markdownFile
        : ContextValues.file;
      return isQuickNoteFile ? `${base}${ContextValues.quickNoteSuffix}` : base;
    }
  }
}
