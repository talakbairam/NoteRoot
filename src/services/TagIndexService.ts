import * as vscode from "vscode";
import { formatTag } from "./QuickNoteService";
import { SearchService } from "./SearchService";
import { findPatternMatches } from "./TagPatterns";

/** Files are read in small groups, so a big notes folder neither stalls nor floods the disk. */
const READ_BATCH_SIZE = 8;

/** Where a tag was found in a note: the first place, as a position the editor can select. */
export interface TagNote {
  uri: vscode.Uri;
  /** Path relative to the root with `/` separators. */
  relativePath: string;
  name: string;
  /** 0-based line and column of the `#`. */
  line: number;
  column: number;
  /** Length of the tag text including the `#`. */
  length: number;
}

/** A tag a pattern made in notes (the text it matched) with the notes that have it. */
export interface PatternTagFound {
  name: string;
  notes: TagNote[];
}

/** The line and column (both 0-based) of a position in a text, counting `\n`, `\r\n` and `\r` as line breaks. */
export function positionAt(text: string, index: number): { line: number; column: number } {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < index; i++) {
    const char = text[i];
    if (char === "\n" || (char === "\r" && text[i + 1] !== "\n")) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: index - lineStart };
}

export interface TagPosition {
  line: number;
  column: number;
  length: number;
}

/** The text of a tag as it is written in a note, lower case and without the `#`: spaces become `-`. */
export function tagKey(name: string): string {
  return formatTag(name).slice(1).toLowerCase();
}

// A tag starts at the beginning of a line or after white space or an opening bracket, so `C#` and a
// heading (`# Title`, the `#` is followed by a space) are not tags.
const TAG_TOKEN = /(^|[\s([{])#([^\s#]+)/g;
// Punctuation that ends a sentence or closes a bracket right after a tag is not part of it.
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/**
 * Finds where each wanted tag is first used in `text`. Case-insensitive. Pure on purpose, so it can be
 * checked without VS Code.
 * @param wanted maps the lower case text of a tag (see {@link tagKey}) to the name it was created with.
 * @returns the position of the first use of every tag that appears, by its created name.
 */
export function findTagsInText(
  text: string,
  wanted: ReadonlyMap<string, string>
): Map<string, TagPosition> {
  const found = new Map<string, TagPosition>();
  if (wanted.size === 0 || !text.includes("#")) {
    return found;
  }
  const lines = text.split(/\r\n|\r|\n/);
  for (let line = 0; line < lines.length && found.size < wanted.size; line++) {
    if (!lines[line].includes("#")) {
      continue;
    }
    for (const match of lines[line].matchAll(TAG_TOKEN)) {
      const body = match[2].replace(TRAILING_PUNCTUATION, "");
      const name = wanted.get(body.toLowerCase());
      if (name !== undefined && !found.has(name)) {
        found.set(name, {
          line,
          column: (match.index ?? 0) + match[1].length,
          length: body.length + 1,
        });
      }
    }
  }
  return found;
}

/**
 * Finds the notes that use each tag, for the "Tags" part of the Tags & Categories view.
 *
 * Like the search it walks the folders when asked (nothing is indexed on disk), hides what the exclude
 * patterns hide, never enters symbolic links, and skips big and binary files. Only the tags that were
 * created are looked for, so `#` in code or a colour never shows up. Note contents are never logged.
 */
export class TagIndexService {
  constructor(private readonly searchService: SearchService) {}

  /**
   * Finds what each tag pattern made in the notes: the distinct texts it matched (as first written, any case) with the
   * notes that have each, sorted by name and by path. Like {@link scan} it reads the text files of the notes folder
   * once (same limits). A pattern that is not usable has an empty list.
   * @throws RootMissingError when no notes folder is set or it does not exist.
   */
  async scanPatterns(patterns: readonly string[]): Promise<Map<string, PatternTagFound[]>> {
    // pattern -> lower case match -> found
    const byPattern = new Map<string, Map<string, PatternTagFound>>(
      patterns.map((pattern) => [pattern, new Map()])
    );
    if (patterns.length === 0) {
      await this.searchService.requireExistingRoot();
      return new Map(patterns.map((pattern) => [pattern, []]));
    }
    type Pending = { uri: vscode.Uri; relativePath: string; name: string };
    const readBatch = async (batch: Pending[]): Promise<void> => {
      const texts = await Promise.all(batch.map((file) => this.searchService.readText(file.uri)));
      batch.forEach((file, index) => {
        const text = texts[index];
        if (text === undefined || text === "") {
          return;
        }
        for (const pattern of patterns) {
          const found = byPattern.get(pattern);
          for (const match of findPatternMatches(text, pattern)) {
            const key = match.name.toLowerCase();
            const entry = found?.get(key) ?? { name: match.name, notes: [] };
            found?.set(key, entry);
            entry.notes.push({
              ...file,
              ...positionAt(text, match.index),
              length: match.name.length,
            });
          }
        }
      });
    };
    let batch: Pending[] = [];
    for await (const file of this.searchService.walkFiles()) {
      batch.push(file);
      if (batch.length >= READ_BATCH_SIZE) {
        await readBatch(batch);
        batch = [];
      }
    }
    await readBatch(batch);
    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
    const result = new Map<string, PatternTagFound[]>();
    for (const [pattern, found] of byPattern) {
      const list = [...found.values()].sort((a, b) => collator.compare(a.name, b.name));
      for (const entry of list) {
        entry.notes.sort((a, b) => collator.compare(a.relativePath, b.relativePath));
      }
      result.set(pattern, list);
    }
    return result;
  }

  /**
   * @returns every given name with the notes that use it, sorted by path (an empty list for an unused tag).
   * @throws RootMissingError when no notes folder is set or it does not exist.
   */
  async scan(names: readonly string[]): Promise<Map<string, TagNote[]>> {
    const result = new Map<string, TagNote[]>(names.map((name) => [name, []]));
    const wanted = new Map<string, string>();
    for (const name of names) {
      const key = tagKey(name);
      if (key !== "" && !wanted.has(key)) {
        wanted.set(key, name);
      }
    }
    if (wanted.size === 0) {
      return result;
    }

    type Pending = { uri: vscode.Uri; relativePath: string; name: string };
    const readBatch = async (batch: Pending[]): Promise<void> => {
      const texts = await Promise.all(batch.map((file) => this.searchService.readText(file.uri)));
      batch.forEach((file, index) => {
        const text = texts[index];
        if (text === undefined) {
          return;
        }
        for (const [name, position] of findTagsInText(text, wanted)) {
          result.get(name)?.push({ ...file, ...position });
        }
      });
    };

    // Files are read in small groups, so a big notes folder neither stalls nor floods the disk.
    let batch: Pending[] = [];
    for await (const file of this.searchService.walkFiles()) {
      batch.push(file);
      if (batch.length >= READ_BATCH_SIZE) {
        await readBatch(batch);
        batch = [];
      }
    }
    await readBatch(batch);
    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
    for (const notes of result.values()) {
      notes.sort((a, b) => collator.compare(a.relativePath, b.relativePath));
    }
    return result;
  }
}
