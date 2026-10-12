import * as vscode from "vscode";
import { ConfigFile, SettingKeys, type SettingKey } from "../constants/settings";
import { SettingsService } from "./SettingsService";

interface Rule {
  regex: RegExp;
  /** Plain names and patterns without "/" match the entry name; the rest match the relative path. */
  target: "name" | "path";
  /** The pattern as written (trimmed). */
  pattern: string;
  /** The rule that is always there (the config folder), not one of the list. */
  builtin: boolean;
}

/**
 * Decides which entries are hidden from the tree, based on `noteRoot.excludePatterns`.
 *
 * Supported syntax: `*` (any characters except "/"), `**` (anything, including "/"),
 * `?` (one character except "/") and plain names. A leading "/" anchors a pattern to the root,
 * a trailing "/" is ignored. Matching is case-insensitive on every OS so hiding rules behave
 * the same when notes move between systems.
 */
export class ExcludeMatcher implements vscode.Disposable {
  private rules: Rule[] = [];
  private readonly always: readonly string[];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly subscription: vscode.Disposable;

  /** Fires after the patterns were reloaded because the setting changed. */
  readonly onDidChange = this.changeEmitter.event;

  /**
   * @param options which setting holds the patterns (the hidden list by default; "Don't Auto-Tag" uses the list of the
   * files without tagging) and the names that are always matched whatever the list says (the config folder, for the hidden list).
   */
  constructor(
    settings: SettingsService,
    options: { key?: SettingKey; read?: () => readonly string[]; always?: readonly string[] } = {}
  ) {
    const key = options.key ?? SettingKeys.excludePatterns;
    const read = options.read ?? (() => settings.excludePatterns);
    this.always = options.always ?? [ConfigFile.dirName];
    this.update(read());
    this.subscription = settings.onDidChange((event) => {
      if (SettingsService.affects(event, key)) {
        this.update(read());
        this.changeEmitter.fire();
      }
    });
  }

  /**
   * @param name Entry name, for example `notes.md`.
   * @param relativePath Path relative to the root with `/` separators, for example `work/notes.md`.
   */
  isExcluded(name: string, relativePath: string): boolean {
    return this.rules.some((rule) => rule.regex.test(rule.target === "name" ? name : relativePath));
  }

  /**
   * The patterns of the list that hide this entry (the always-hidden config folder is not one of them). Used by "Show in NoteRoot
   * Again" to know what to take out of the list.
   */
  matchingPatterns(name: string, relativePath: string): string[] {
    return this.rules
      .filter(
        (rule) => !rule.builtin && rule.regex.test(rule.target === "name" ? name : relativePath)
      )
      .map((rule) => rule.pattern);
  }

  /**
   * Replaces the active patterns. Empty and whitespace-only patterns are ignored. The folder of the config file is always
   * hidden, whatever the list says (a list kept in the notes folder could otherwise show and expose it).
   */
  update(patterns: readonly string[]): void {
    this.rules = [
      ...patterns.map((pattern) => ({ pattern, builtin: false })),
      ...this.always.map((pattern) => ({ pattern, builtin: true })),
    ].flatMap(({ pattern, builtin }) => {
      const rule = compilePattern(pattern, builtin);
      return rule ? [rule] : [];
    });
  }

  dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
  }
}

function compilePattern(raw: string, builtin: boolean): Rule | undefined {
  let pattern = raw.trim();
  const anchored = pattern.startsWith("/");
  pattern = pattern.replace(/^\/+/, "").replace(/\/+$/, "");
  if (pattern.length === 0) {
    return undefined;
  }
  return {
    regex: globToRegExp(pattern),
    target: anchored || pattern.includes("/") ? "path" : "name",
    pattern: raw.trim(),
    builtin,
  };
}

function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];
    if (char === "*") {
      if (glob[index + 1] === "*") {
        const atSegmentStart = index === 0 || glob[index - 1] === "/";
        if (atSegmentStart && glob[index + 2] === "/") {
          source += "(?:.*/)?"; // "**/" matches zero or more folders
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`, "i");
}
