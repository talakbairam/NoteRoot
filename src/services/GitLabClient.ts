import { Strings } from "../constants/strings";
import { GitLabError } from "../util/errors";
import type { GitLabAuth } from "./GitLabAuth";
import type { Logger } from "./Logger";

const PER_PAGE = 100;
/** The most pages that are read of a list (100 each): a guard against a list that never ends. */
const MAX_PAGES = 120;
const MAX_PROJECT_PAGES = 3;

export interface GitLabProject {
  readonly id: number;
  /** `group/name`. */
  readonly path: string;
  readonly isPrivate: boolean;
  /** The default branch, or undefined for an empty project. */
  readonly defaultBranch: string | undefined;
}

export interface GitLabTreeEntry {
  readonly path: string;
  /** The Git blob hash, the same as `git hash-object` gives. */
  readonly sha: string;
}

/** One change of a commit: a file with its new content, or `undefined` content to delete it. */
export interface GitLabAction {
  readonly action: "create" | "update" | "delete";
  readonly path: string;
  readonly bytes?: Uint8Array;
}

/**
 * A small client of the GitLab REST API v4 (gitlab.com or the GitLab of a company): only what the sync needs, on the global
 * `fetch`, no dependencies. The token comes from {@link GitLabAuth} and is never logged. Every failure becomes a
 * {@link GitLabError} whose message says what the user can do. File contents travel only as the base64 body of a commit.
 */
export class GitLabClient {
  constructor(
    private readonly auth: GitLabAuth,
    private readonly logger: Logger
  ) {}

  /** The projects the user can write to, most recently active first (at most 300). */
  async listProjects(): Promise<GitLabProject[]> {
    const result: GitLabProject[] = [];
    for (let page = 1; page <= MAX_PROJECT_PAGES; page++) {
      const { body } = await this.request(
        "GET",
        `/projects?membership=true&simple=true&min_access_level=30&order_by=last_activity_at&per_page=${PER_PAGE}&page=${page}`
      );
      const list = Array.isArray(body) ? body : [];
      for (const item of list) {
        const project = readProject(item);
        if (project) {
          result.push(project);
        }
      }
      if (list.length < PER_PAGE) {
        break;
      }
    }
    return result;
  }

  /** A project by its id or its `group/name`. */
  async getProject(idOrPath: string): Promise<GitLabProject> {
    const { body } = await this.request("GET", `/projects/${encodeURIComponent(idOrPath)}`);
    return this.projectOf(body);
  }

  async createProject(name: string): Promise<GitLabProject> {
    const { body } = await this.request("POST", "/projects", {
      name,
      visibility: "private",
      initialize_with_readme: false,
    });
    return this.projectOf(body);
  }

  /** The latest commit of a branch (one small request), or undefined when the branch does not exist (an empty project). */
  async getHeadCommit(project: number, branch: string): Promise<string | undefined> {
    try {
      const { body } = await this.request(
        "GET",
        `/projects/${project}/repository/branches/${encodeURIComponent(branch)}`
      );
      const id = (body as { commit?: { id?: unknown } } | null)?.commit?.id;
      return typeof id === "string" ? id : undefined;
    } catch (error) {
      if (error instanceof GitLabError && error.status === 404) {
        return undefined;
      }
      throw error;
    }
  }

  /** Every file of the tree at `ref` (a commit). Folders, links and submodules are left out. */
  async listFiles(project: number, ref: string): Promise<GitLabTreeEntry[]> {
    const files: GitLabTreeEntry[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { body, next } = await this.request(
        "GET",
        `/projects/${project}/repository/tree?ref=${encodeURIComponent(ref)}&recursive=true&per_page=${PER_PAGE}&page=${page}`
      );
      for (const item of Array.isArray(body) ? (body as Record<string, unknown>[]) : []) {
        if (
          item.type === "blob" &&
          (item.mode === "100644" || item.mode === "100755") &&
          typeof item.path === "string" &&
          typeof item.id === "string"
        ) {
          files.push({ path: item.path, sha: item.id });
        }
      }
      if (!next) {
        return files;
      }
    }
    throw new GitLabError(Strings.sync.gitlab.tooMany);
  }

  async getBlob(project: number, sha: string): Promise<Uint8Array> {
    const { bytes } = await this.request(
      "GET",
      `/projects/${project}/repository/blobs/${encodeURIComponent(sha)}/raw`,
      undefined,
      true
    );
    return bytes;
  }

  /**
   * Makes one commit on `branch` with all the actions, and returns its id. For an empty project (no branch yet) the first file is
   * made with the Files API, which starts the repository, and the rest goes in a second commit.
   */
  async commit(
    project: number,
    branch: string,
    message: string,
    actions: readonly GitLabAction[],
    branchExists: boolean
  ): Promise<string> {
    let rest = actions;
    if (!branchExists) {
      const first = actions.find((entry) => entry.action === "create" && entry.bytes);
      if (!first?.bytes) {
        throw new GitLabError(Strings.sync.gitlab.unexpected);
      }
      await this.request(
        "POST",
        `/projects/${project}/repository/files/${encodeURIComponent(first.path)}`,
        {
          branch,
          commit_message: message,
          encoding: "base64",
          content: Buffer.from(first.bytes).toString("base64"),
        }
      );
      rest = actions.filter((entry) => entry !== first);
      if (rest.length === 0) {
        const head = await this.getHeadCommit(project, branch);
        if (!head) {
          throw new GitLabError(Strings.sync.gitlab.unexpected);
        }
        return head;
      }
    }
    const { body } = await this.request("POST", `/projects/${project}/repository/commits`, {
      branch,
      commit_message: message,
      actions: rest.map((entry) =>
        entry.bytes
          ? {
              action: entry.action,
              file_path: entry.path,
              encoding: "base64",
              content: Buffer.from(entry.bytes).toString("base64"),
            }
          : { action: entry.action, file_path: entry.path }
      ),
    });
    const id = (body as { id?: unknown } | null)?.id;
    if (typeof id !== "string") {
      throw new GitLabError(Strings.sync.gitlab.unexpected);
    }
    return id;
  }

  private projectOf(body: unknown): GitLabProject {
    const project = readProject(body);
    if (!project) {
      throw new GitLabError(Strings.sync.gitlab.unexpected);
    }
    return project;
  }

  /** One request with the token. `raw` gives the bytes of the answer instead of JSON. */
  private async request(
    method: string,
    path: string,
    json?: unknown,
    raw = false
  ): Promise<{ body: unknown; bytes: Uint8Array; next: boolean }> {
    const token = await this.auth.token();
    let answer: Response;
    try {
      answer = await fetch(`${this.auth.baseUrl}/api/v4${path}`, {
        method,
        headers: {
          "PRIVATE-TOKEN": token,
          ...(json === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: json === undefined ? undefined : JSON.stringify(json),
      });
    } catch (error) {
      throw new GitLabError(Strings.sync.gitlab.network, { cause: error });
    }
    if (!answer.ok) {
      throw await this.failure(answer);
    }
    const next = (answer.headers.get("x-next-page") ?? "") !== "";
    if (raw) {
      return { body: undefined, bytes: new Uint8Array(await answer.arrayBuffer()), next };
    }
    return { body: await answer.json().catch(() => undefined), bytes: new Uint8Array(), next };
  }

  private async failure(answer: Response): Promise<GitLabError> {
    const text = Strings.sync.gitlab;
    const status = answer.status;
    // GitLab says what was wrong in a short message; it holds no file names or contents of notes, but it is only logged.
    const detail = await answer.text().catch(() => "");
    this.logger.warn(`GitLab answered ${status} ${detail.slice(0, 200)}`.trim());
    if (status === 401) {
      await this.auth.signOut(); // The token was refused: the next Connect asks for a new one.
      return new GitLabError(text.expired, { status });
    }
    if (status === 403) {
      return new GitLabError(text.forbidden, { status });
    }
    if (status === 404) {
      return new GitLabError(text.notFound, { status });
    }
    if (status === 429) {
      return new GitLabError(text.rateLimited, { status });
    }
    if (status === 400 || status === 409 || status === 422) {
      return new GitLabError(text.conflict, { status });
    }
    return new GitLabError(text.unexpected, { status });
  }
}

function readProject(value: unknown): GitLabProject | undefined {
  const item = value as Record<string, unknown> | null;
  if (!item || typeof item.id !== "number" || typeof item.path_with_namespace !== "string") {
    return undefined;
  }
  return {
    id: item.id,
    path: item.path_with_namespace,
    isPrivate: item.visibility === "private",
    defaultBranch: typeof item.default_branch === "string" ? item.default_branch : undefined,
  };
}
