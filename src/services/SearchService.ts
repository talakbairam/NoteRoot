import * as vscode from "vscode";
import { Strings } from "../constants/strings";
import { RootMissingError } from "../util/errors";
import { ExcludeMatcher } from "./ExcludeMatcher";
import { Logger } from "./Logger";
import { isEncryptedName } from "./NoteCrypto";
import { PathGuard } from "./PathGuard";
import { RootFolderService } from "./RootFolderService";
import { SettingsService } from "./SettingsService";

// At most `settings.maxSearchResults` results are returned: past that the user should narrow the search down.
// Files larger than `settings.maxTextFileBytes` are matched by name only: reading them would be slow and rarely useful.
/** Files are read in small groups, so a big notes folder neither stalls nor floods the disk. */
const READ_BATCH_SIZE = 8;
/** A zero byte in the first bytes is the usual sign of a binary file. */
const BINARY_SNIFF_BYTES = 8000;
const SNIPPET_CONTEXT_BEFORE = 40;
const SNIPPET_MAX_LENGTH = 140;

const decoder = new TextDecoder("utf-8");

export interface TextMatch {
  /** 0-based line number. */
  line: number;
  /** 0-based column of the match in that line. */
  column: number;
  /** Length of the matched text. */
  length: number;
  /** A short piece of the line around the match, safe to show in a list. */
  snippet: string;
}

export interface SearchResult {
  uri: vscode.Uri;
  /** Path relative to the root with `/` separators. */
  relativePath: string;
  name: string;
  isFolder: boolean;
  /** The name contains the query. */
  nameMatch: boolean;
  /** The first line of the content that contains the query, when there is one. */
  textMatch?: TextMatch;
}

/**
 * Finds the first line of `text` that contains `needle` (already lower case). Case-insensitive.
 * Pure on purpose, so it can be checked without VS Code.
 */
export function findFirstMatch(
  text: string,
  needle: string,
  caseSensitive = false
): TextMatch | undefined {
  if (needle.length === 0) {
    return undefined;
  }
  const lines = text.split(/\r\n|\r|\n/);
  for (let line = 0; line < lines.length; line++) {
    const column = (caseSensitive ? lines[line] : lines[line].toLowerCase()).indexOf(needle);
    if (column >= 0) {
      const start = Math.max(0, column - SNIPPET_CONTEXT_BEFORE);
      const piece = lines[line].slice(start, start + SNIPPET_MAX_LENGTH).trim();
      return { line, column, length: needle.length, snippet: `${start > 0 ? "…" : ""}${piece}` };
    }
  }
  return undefined;
}

/**
 * Searches file and folder names and the text of notes inside the notes root.
 *
 * It walks the folders on demand (nothing is indexed or cached) with `workspace.fs`, hides what the
 * exclude patterns hide, and never follows symbolic links: a link is matched by its name only.
 * Note contents are never logged.
 */
export class SearchService {
  constructor(
    private readonly rootService: RootFolderService,
    private readonly pathGuard: PathGuard,
    private readonly excludeMatcher: ExcludeMatcher,
    private readonly logger: Logger,
    private readonly settings: SettingsService
  ) {}

  /** The shortest text that starts a search (a setting of the notes folder). */
  get minQueryLength(): number {
    return this.settings.minSearchLength;
  }

  /** The most results one search returns (a setting of the notes folder). */
  get resultLimit(): number {
    return this.settings.maxSearchResults;
  }

  /**
   * Streams results, shallow folders first. Ends when everything was searched, when
   * the most results the setting allows were found, or when the token is cancelled.
   * @throws RootMissingError when no notes folder is set or it does not exist.
   */
  async *search(query: string, token: vscode.CancellationToken): AsyncGenerator<SearchResult> {
    const caseSensitive = this.settings.caseSensitiveSearch;
    // With the case-insensitive search both the text and the needle are lower case.
    const needle = caseSensitive ? query.trim() : query.trim().toLowerCase();
    if (needle.length === 0) {
      return;
    }
    const root = await this.requireExistingRoot();

    let found = 0;
    const maxResults = this.settings.maxSearchResults;
    const pending: vscode.Uri[] = [root];
    while (pending.length > 0 && !token.isCancellationRequested) {
      const folder = pending.shift() as vscode.Uri;
      const folderPath = this.pathGuard.getRelativePath(folder) ?? "";
      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(folder);
      } catch (error) {
        this.logger.warn(`Search skipped "${folderPath || "."}": ${describe(error)}`);
        continue;
      }

      const files: { uri: vscode.Uri; relativePath: string; name: string }[] = [];
      const hits: SearchResult[] = [];
      for (const [name, type] of entries) {
        const relativePath = folderPath ? `${folderPath}/${name}` : name;
        if (this.excludeMatcher.isExcluded(name, relativePath)) {
          continue;
        }
        const uri = vscode.Uri.joinPath(folder, name);
        const nameMatch = (caseSensitive ? name : name.toLowerCase()).includes(needle);
        const isLink = PathGuard.isSymbolicLink(type);
        if ((type & vscode.FileType.Directory) !== 0) {
          // A link to a folder could lead out of the notes folder or loop, so it is not entered.
          if (!isLink) {
            pending.push(uri);
          }
          if (nameMatch) {
            hits.push({ uri, relativePath, name, isFolder: true, nameMatch });
          }
        } else if (isLink) {
          if (nameMatch) {
            hits.push({ uri, relativePath, name, isFolder: false, nameMatch });
          }
        } else if ((type & vscode.FileType.File) !== 0) {
          files.push({ uri, relativePath, name });
        }
      }

      // Name matches of a folder come first, then the files in it that match by content.
      for (const hit of hits) {
        yield hit;
        if (++found >= maxResults) {
          return;
        }
      }
      for (let start = 0; start < files.length; start += READ_BATCH_SIZE) {
        if (token.isCancellationRequested) {
          return;
        }
        const batch = files.slice(start, start + READ_BATCH_SIZE);
        const results = await Promise.all(
          batch.map((file) => this.matchFile(file, needle, caseSensitive))
        );
        for (const result of results) {
          if (!result) {
            continue;
          }
          yield result;
          if (++found >= maxResults) {
            return;
          }
        }
      }
    }
  }

  /**
   * Streams the files of the notes folder, shallow folders first. It hides what the exclude patterns hide,
   * never enters symbolic links and does not yield them. An unreadable folder is skipped.
   * @param start a folder of the notes folder to walk instead of the whole of it.
   * @param options `isSkipped` replaces the exclude patterns: an entry for which it answers true is left out, every
   *   other entry (hidden ones too) is walked. The sync uses it when the user chose to sync hidden files.
   * @throws RootMissingError when no notes folder is set or it does not exist.
   * @throws OutsideRootError when `start` is not inside the notes folder.
   */
  async *walkFiles(
    start?: vscode.Uri,
    options?: { isSkipped?: (name: string, relativePath: string) => boolean }
  ): AsyncGenerator<{ uri: vscode.Uri; relativePath: string; name: string }> {
    const isSkipped =
      options?.isSkipped ??
      ((name: string, relativePath: string): boolean =>
        this.excludeMatcher.isExcluded(name, relativePath));
    const root = await this.requireExistingRoot();
    if (start) {
      this.pathGuard.assertInsideRoot(start);
    }
    const pending: vscode.Uri[] = [start ?? root];
    while (pending.length > 0) {
      const folder = pending.shift() as vscode.Uri;
      const folderPath = this.pathGuard.getRelativePath(folder) ?? "";
      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(folder);
      } catch (error) {
        this.logger.warn(`Skipped "${folderPath || "."}": ${describe(error)}`);
        continue;
      }
      for (const [name, type] of entries) {
        const relativePath = folderPath ? `${folderPath}/${name}` : name;
        if (isSkipped(name, relativePath) || PathGuard.isSymbolicLink(type)) {
          continue;
        }
        const uri = vscode.Uri.joinPath(folder, name);
        if ((type & vscode.FileType.Directory) !== 0) {
          pending.push(uri);
        } else if ((type & vscode.FileType.File) !== 0) {
          yield { uri, relativePath, name };
        }
      }
    }
  }

  private async matchFile(
    file: { uri: vscode.Uri; relativePath: string; name: string },
    needle: string,
    caseSensitive: boolean
  ): Promise<SearchResult | undefined> {
    const nameMatch = (caseSensitive ? file.name : file.name.toLowerCase()).includes(needle);
    const textMatch = await this.findInFile(file.uri, needle, caseSensitive);
    if (!nameMatch && !textMatch) {
      return undefined;
    }
    return { ...file, isFolder: false, nameMatch, textMatch };
  }

  /** Unreadable, big and binary files simply have no text match. */
  private async findInFile(
    uri: vscode.Uri,
    needle: string,
    caseSensitive: boolean
  ): Promise<TextMatch | undefined> {
    const text = await this.readText(uri);
    return text === undefined ? undefined : findFirstMatch(text, needle, caseSensitive);
  }

  /** The text of a file, or undefined when it is unreadable, bigger than 1 MB or binary. */
  async readText(uri: vscode.Uri): Promise<string | undefined> {
    if (isEncryptedName(uri.path)) {
      return undefined; // Encrypted text is not a note to search, tag or index.
    }
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > this.settings.maxTextFileBytes) {
        return undefined;
      }
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
        return undefined;
      }
      return decoder.decode(bytes);
    } catch {
      return undefined;
    }
  }

  /**
   * Searching a root that vanished (unplugged drive) must say so instead of finding nothing.
   * @throws RootMissingError when no notes folder is set or it does not exist.
   */
  async requireExistingRoot(): Promise<vscode.Uri> {
    const root = this.rootService.getRootUri();
    if (!root) {
      throw new RootMissingError(Strings.root.noRootSelected);
    }
    try {
      if (((await vscode.workspace.fs.stat(root)).type & vscode.FileType.Directory) !== 0) {
        return root;
      }
    } catch {
      // Falls through to the error below.
    }
    throw new RootMissingError(Strings.root.notFound);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
