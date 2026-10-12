import { Strings } from "../constants/strings";
import { GitHubError } from "../util/errors";
import { Logger } from "./Logger";

const API = "https://api.github.com";
const REPOSITORIES_PER_PAGE = 100;
const MAX_REPOSITORY_PAGES = 3;

export interface Repository {
  readonly owner: string;
  readonly name: string;
  readonly fullName: string;
  readonly isPrivate: boolean;
  readonly defaultBranch: string;
}

export interface TreeEntry {
  readonly path: string;
  readonly sha: string;
  /** `blob` for a file; `tree` for a folder; `commit` for a submodule. */
  readonly type: string;
  /** `100644` and `100755` are files, `120000` is a link. */
  readonly mode: string;
}

/** Who wrote a commit and when; kept when a commit is rebuilt so the history keeps its authors and dates. */
export interface GitIdentity {
  readonly name: string;
  readonly email: string;
  readonly date: string;
}

export interface GitCommit {
  readonly sha: string;
  readonly tree: string;
  readonly message: string;
  /** The first parent, or undefined for the first commit of a history. */
  readonly parent: string | undefined;
  readonly author: GitIdentity | undefined;
  readonly committer: GitIdentity | undefined;
}

export interface Head {
  readonly commit: string;
  readonly tree: string;
}

/** One change of a tree: a file with the hash of its new content, or `null` to delete it. */
export interface TreeChange {
  readonly path: string;
  readonly sha: string | null;
}

/** Gives the token of the GitHub sign-in of VS Code, or undefined when there is none. Never opens a sign-in by itself. */
export type TokenProvider = () => Promise<string | undefined>;

/**
 * A small client of the GitHub REST API: only what the sync needs, on the global `fetch` (no dependencies). The token comes
 * from the sign-in of VS Code and is never logged or kept. Every failure becomes a {@link GitHubError} whose message says
 * what the user can do. File contents travel only as the base64 body of blobs; nothing about them is logged.
 */
export class GitHubClient {
  constructor(
    private readonly getToken: TokenProvider,
    private readonly logger: Logger
  ) {}

  /** The repositories the user can write to, most recently pushed first (at most 300). */
  async listRepositories(): Promise<Repository[]> {
    const result: Repository[] = [];
    for (let page = 1; page <= MAX_REPOSITORY_PAGES; page++) {
      const data = await this.request(
        "GET",
        `/user/repos?per_page=${REPOSITORIES_PER_PAGE}&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`
      );
      if (!Array.isArray(data)) {
        throw new GitHubError(Strings.sync.github.unexpected);
      }
      for (const item of data) {
        const repository = readRepository(item);
        if (repository && readPermission(item)) {
          result.push(repository);
        }
      }
      if (data.length < REPOSITORIES_PER_PAGE) {
        break;
      }
    }
    return result;
  }

  async getRepository(owner: string, name: string): Promise<Repository> {
    const data = await this.request("GET", `${repoPath(owner, name)}`);
    const repository = readRepository(data);
    if (!repository) {
      throw new GitHubError(Strings.sync.github.unexpected);
    }
    return repository;
  }

  async createRepository(name: string): Promise<Repository> {
    const data = await this.request("POST", "/user/repos", { name, private: true });
    const repository = readRepository(data);
    if (!repository) {
      throw new GitHubError(Strings.sync.github.unexpected);
    }
    return repository;
  }

  /**
   * Only the latest commit of a branch (one small request), or undefined when the branch does not exist (an empty
   * repository). This is all the check for a new commit needs.
   */
  async getHeadCommit(owner: string, name: string, branch: string): Promise<string | undefined> {
    let ref: unknown;
    try {
      ref = await this.request(
        "GET",
        `${repoPath(owner, name)}/git/ref/heads/${encodeBranch(branch)}`
      );
    } catch (error) {
      if (error instanceof GitHubError && (error.status === 404 || error.status === 409)) {
        return undefined;
      }
      throw error;
    }
    const commit = text(record(ref)?.object, "sha");
    if (!commit) {
      throw new GitHubError(Strings.sync.github.unexpected);
    }
    return commit;
  }

  /** The latest commit of a branch and its tree, or undefined when the branch does not exist (an empty repository). */
  async getHead(owner: string, name: string, branch: string): Promise<Head | undefined> {
    const commit = await this.getHeadCommit(owner, name, branch);
    if (!commit) {
      return undefined;
    }
    const data = await this.request("GET", `${repoPath(owner, name)}/git/commits/${commit}`);
    const tree = text(record(data)?.tree, "sha");
    if (!tree) {
      throw new GitHubError(Strings.sync.github.unexpected);
    }
    return { commit, tree };
  }

  /** Every entry of a tree, folders flattened. `truncated` is true when GitHub cut the list short (a huge repository). */
  async getTree(
    owner: string,
    name: string,
    treeSha: string
  ): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const data = record(
      await this.request("GET", `${repoPath(owner, name)}/git/trees/${treeSha}?recursive=1`)
    );
    const raw = data?.tree;
    if (!Array.isArray(raw)) {
      throw new GitHubError(Strings.sync.github.unexpected);
    }
    const entries: TreeEntry[] = [];
    for (const item of raw) {
      const entry = record(item);
      const path = entry?.path;
      const sha = entry?.sha;
      const type = entry?.type;
      const mode = entry?.mode;
      if (
        typeof path === "string" &&
        typeof sha === "string" &&
        typeof type === "string" &&
        typeof mode === "string"
      ) {
        entries.push({ path, sha, type, mode });
      }
    }
    return { entries, truncated: data?.truncated === true };
  }

  async getBlob(owner: string, name: string, sha: string): Promise<Uint8Array> {
    const data = record(await this.request("GET", `${repoPath(owner, name)}/git/blobs/${sha}`));
    const content = data?.content;
    if (typeof content !== "string" || data?.encoding !== "base64") {
      throw new GitHubError(Strings.sync.github.unexpected);
    }
    return Buffer.from(content.replace(/\s+/g, ""), "base64");
  }

  async createBlob(owner: string, name: string, bytes: Uint8Array): Promise<string> {
    const data = await this.request("POST", `${repoPath(owner, name)}/git/blobs`, {
      content: Buffer.from(bytes).toString("base64"),
      encoding: "base64",
    });
    return requiredSha(data);
  }

  async createTree(
    owner: string,
    name: string,
    baseTree: string,
    changes: readonly TreeChange[]
  ): Promise<string> {
    const data = await this.request("POST", `${repoPath(owner, name)}/git/trees`, {
      base_tree: baseTree,
      tree: changes.map((change) => ({
        path: change.path,
        mode: "100644",
        type: "blob",
        sha: change.sha,
      })),
    });
    return requiredSha(data);
  }

  /** One commit with its tree, message, first parent and authors. */
  async getCommit(owner: string, name: string, sha: string): Promise<GitCommit> {
    const data = record(await this.request("GET", `${repoPath(owner, name)}/git/commits/${sha}`));
    const tree = text(data?.tree, "sha");
    const message = data?.message;
    const parents = data?.parents;
    if (!tree || typeof message !== "string" || !Array.isArray(parents)) {
      throw new GitHubError(Strings.sync.github.unexpected);
    }
    return {
      sha,
      tree,
      message,
      parent: text(parents[0], "sha"),
      author: readIdentity(data?.author),
      committer: readIdentity(data?.committer),
    };
  }

  async createCommit(
    owner: string,
    name: string,
    message: string,
    tree: string,
    /** Undefined makes a commit with no parent: the start of a new history. */
    parent: string | undefined,
    /** Given when a commit is rebuilt, so that it keeps its author and its date. */
    identity?: { author?: GitIdentity; committer?: GitIdentity }
  ): Promise<string> {
    const data = await this.request("POST", `${repoPath(owner, name)}/git/commits`, {
      message,
      tree,
      parents: parent === undefined ? [] : [parent],
      ...(identity?.author ? { author: identity.author } : {}),
      ...(identity?.committer ? { committer: identity.committer } : {}),
    });
    return requiredSha(data);
  }

  /**
   * Moves the branch to a commit. Not forced unless `replaceHistory` says so: GitHub then refuses it when the branch
   * moved meanwhile. A forced move drops the commits that came before (the one-commit mode, which the user switched on).
   */
  async updateBranch(
    owner: string,
    name: string,
    branch: string,
    commit: string,
    options: { replaceHistory: boolean } = { replaceHistory: false }
  ): Promise<void> {
    await this.request("PATCH", `${repoPath(owner, name)}/git/refs/heads/${encodeBranch(branch)}`, {
      sha: commit,
      force: options.replaceHistory,
    });
  }

  /** Makes the first commit of an empty repository (the Git Data API does not work on one) with a small marker file. */
  async createFirstCommit(
    owner: string,
    name: string,
    branch: string,
    path: string,
    content: string
  ): Promise<void> {
    await this.request("PUT", `${repoPath(owner, name)}/contents/${encodeURIComponent(path)}`, {
      message: "Start the repository for NoteRoot",
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
    });
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const token = await this.getToken();
    if (!token) {
      throw new GitHubError(Strings.sync.github.notSignedIn);
    }
    let response: Response;
    try {
      response = await fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "NoteRoot",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      this.logger.warn(`GitHub ${method} ${logPath(path)}: no answer (${errorName(error)}).`);
      throw new GitHubError(Strings.sync.github.network, { cause: error });
    }
    if (response.ok) {
      return response.status === 204 ? undefined : ((await response.json()) as unknown);
    }
    this.logger.warn(`GitHub ${method} ${logPath(path)}: ${response.status}.`);
    throw failure(response);
  }
}

/** A {@link GitHubError} that remembers the HTTP status, so callers can tell "not found" from the rest. */
function failure(response: Response): GitHubError {
  const status = response.status;
  let message: string;
  if (status === 401) {
    message = Strings.sync.github.expired;
  } else if (status === 403 || status === 429) {
    message =
      response.headers.get("x-ratelimit-remaining") === "0" || status === 429
        ? Strings.sync.github.rateLimited
        : Strings.sync.github.forbidden;
  } else if (status === 404) {
    message = Strings.sync.github.notFound;
  } else if (status === 409) {
    message = Strings.sync.github.conflict;
  } else if (status === 422) {
    message = Strings.sync.github.unprocessable;
  } else {
    message = Strings.sync.github.unexpected;
  }
  return new GitHubError(message, { status });
}

function repoPath(owner: string, name: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

/** A branch name may contain `/`; every other part is encoded. */
function encodeBranch(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}

/** The path without the query, for the log (names of repositories are metadata, contents never get here). */
function logPath(path: string): string {
  const query = path.indexOf("?");
  return query >= 0 ? path.slice(0, query) : path;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "error";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown, key: string): string | undefined {
  const field = record(value)?.[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

function readIdentity(value: unknown): GitIdentity | undefined {
  const name = text(value, "name");
  const email = text(value, "email");
  const date = text(value, "date");
  return name && email && date ? { name, email, date } : undefined;
}

function requiredSha(data: unknown): string {
  const sha = text(data, "sha");
  if (!sha) {
    throw new GitHubError(Strings.sync.github.unexpected);
  }
  return sha;
}

function readRepository(value: unknown): Repository | undefined {
  const data = record(value);
  const owner = text(data?.owner, "login");
  const name = text(data, "name");
  const defaultBranch = text(data, "default_branch");
  if (!data || !owner || !name) {
    return undefined;
  }
  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    isPrivate: data.private === true,
    defaultBranch: defaultBranch ?? "main",
  };
}

/** The list of repositories holds some the user can only read; those are no use for a sync that writes. */
function readPermission(value: unknown): boolean {
  const permissions = record(record(value)?.permissions);
  return permissions === undefined || permissions.push === true || permissions.admin === true;
}
