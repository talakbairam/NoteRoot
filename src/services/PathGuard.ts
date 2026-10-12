import * as vscode from "vscode";
import { OutsideRootError, RootMissingError } from "../util/errors";

/** Anything that can tell where the notes root currently is. */
export interface RootProvider {
  getRootUri(): vscode.Uri | undefined;
}

export interface GuardOptions {
  /** Whether the root folder itself counts as "inside". Default: true. Use false for rename/delete/move. */
  allowRoot?: boolean;
}

/** Windows and macOS file systems are case-insensitive by default; Linux is not. */
const CASE_INSENSITIVE = process.platform === "win32" || process.platform === "darwin";

/**
 * Decides whether a URI is inside the notes root.
 *
 * Symlink policy: the guard compares normalized paths only and never resolves links.
 * The tree does not expand directory symlinks, and file operations act on the link
 * itself, so a link can never be used to reach something outside the root.
 */
export class PathGuard {
  constructor(private readonly rootProvider: RootProvider) {}

  /** True for symbolic links (the flag can be combined with File or Directory). */
  static isSymbolicLink(type: vscode.FileType): boolean {
    return (type & vscode.FileType.SymbolicLink) !== 0;
  }

  isInsideRoot(uri: vscode.Uri, options: GuardOptions = {}): boolean {
    const root = this.rootProvider.getRootUri();
    return root !== undefined && this.compare(root, uri, options.allowRoot ?? true);
  }

  /** @throws RootMissingError when no root is set, OutsideRootError when `uri` is not inside it. */
  assertInsideRoot(uri: vscode.Uri, options: GuardOptions = {}): void {
    const root = this.rootProvider.getRootUri();
    if (!root) {
      throw new RootMissingError();
    }
    if (!this.compare(root, uri, options.allowRoot ?? true)) {
      throw new OutsideRootError(uri.fsPath);
    }
  }

  /** True when both URIs point to the same location (compared like the root: segment-wise, OS case rules). */
  isSame(a: vscode.Uri, b: vscode.Uri): boolean {
    const first = normalizeSegments(a.path);
    const second = normalizeSegments(b.path);
    return (
      this.isSameLocation(a, b) &&
      !!first &&
      !!second &&
      first.length === second.length &&
      startsWith(second, first)
    );
  }

  /** True when `uri` equals `ancestor` or lies anywhere below it. Does not need a root. */
  isSameOrInside(ancestor: vscode.Uri, uri: vscode.Uri): boolean {
    const ancestorSegments = normalizeSegments(ancestor.path);
    const segments = normalizeSegments(uri.path);
    return (
      this.isSameLocation(ancestor, uri) &&
      !!ancestorSegments &&
      !!segments &&
      startsWith(segments, ancestorSegments)
    );
  }

  /** Drops duplicates and every URI that lies inside another one of the list (moving the parent moves it too). */
  removeNested(uris: readonly vscode.Uri[]): vscode.Uri[] {
    const unique = uris.filter(
      (uri, index) => uris.findIndex((other) => this.isSame(other, uri)) === index
    );
    return unique.filter(
      (uri) => !unique.some((other) => other !== uri && this.isSameOrInside(other, uri))
    );
  }

  /** Path relative to the root with `/` separators ('' for the root itself), or undefined when outside. */
  getRelativePath(uri: vscode.Uri): string | undefined {
    const root = this.rootProvider.getRootUri();
    if (!root) {
      return undefined;
    }
    const rootSegments = normalizeSegments(root.path);
    const segments = normalizeSegments(uri.path);
    if (
      !rootSegments ||
      !segments ||
      !this.isSameLocation(root, uri) ||
      !startsWith(segments, rootSegments)
    ) {
      return undefined;
    }
    return segments.slice(rootSegments.length).join("/");
  }

  /**
   * Resolves a root-relative path (either separator) to a URI.
   * @throws OutsideRootError for absolute paths or paths that climb out of the root.
   */
  resolveRelative(relativePath: string): vscode.Uri {
    const root = this.rootProvider.getRootUri();
    if (!root) {
      throw new RootMissingError();
    }
    if (/^([\\/]|[A-Za-z]:)/.test(relativePath)) {
      throw new OutsideRootError(relativePath);
    }
    const target = vscode.Uri.joinPath(root, ...relativePath.split(/[\\/]/));
    this.assertInsideRoot(target);
    return target;
  }

  private compare(root: vscode.Uri, uri: vscode.Uri, allowRoot: boolean): boolean {
    if (!this.isSameLocation(root, uri)) {
      return false;
    }
    const rootSegments = normalizeSegments(root.path);
    const segments = normalizeSegments(uri.path);
    if (!rootSegments || !segments) {
      return false;
    }
    // Segment-wise on purpose: "/notes-evil" must not count as inside "/notes".
    if (!startsWith(segments, rootSegments)) {
      return false;
    }
    return allowRoot || segments.length > rootSegments.length;
  }

  private isSameLocation(a: vscode.Uri, b: vscode.Uri): boolean {
    return a.scheme === b.scheme && a.authority.toLowerCase() === b.authority.toLowerCase();
  }
}

/**
 * Splits a URI path into segments, resolving `.` and `..`.
 * Returns undefined when `..` would climb above the file system root.
 */
function normalizeSegments(path: string): string[] | undefined {
  const result: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (result.pop() === undefined) {
        return undefined;
      }
      continue;
    }
    result.push(segment);
  }
  return result;
}

/** Segment-wise prefix test. Case is folded only for comparing, never in returned paths. */
function startsWith(segments: readonly string[], prefix: readonly string[]): boolean {
  const fold = (value: string): string => (CASE_INSENSITIVE ? value.toLowerCase() : value);
  return (
    prefix.length <= segments.length &&
    prefix.every((segment, index) => fold(segments[index]) === fold(segment))
  );
}
