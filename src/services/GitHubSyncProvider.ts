import { Strings } from "../constants/strings";
import { GitHubError } from "../util/errors";
import { mapLimit } from "../util/mapLimit";
import { gitBlobSha } from "./GitHash";
import { GitHubAuth } from "./GitHubAuth";
import { GitHubClient, type GitCommit, type Repository, type TreeChange } from "./GitHubClient";
import { MARKER_PATH } from "./SyncPlan";
import type {
  RemoteFile,
  RemoteSnapshot,
  RemoteTarget,
  SyncProvider,
  TargetCreator,
  TargetFinder,
  UploadChange,
  UploadOptions,
  UploadResult,
} from "./SyncProvider";

const TRANSFERS_AT_ONCE = 4;
const REPOSITORY_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const REPOSITORY_FULL_NAME = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/;
/** The id of a target: `owner/name@branch`. */
const TARGET_ID = /^([^/@]+)\/([^/@]+)@(.+)$/;
const MARKER_TEXT =
  "Started by NoteRoot. Keep this file: it makes the repository ready for syncing.\n";

/**
 * Syncs with a GitHub repository (its default branch) through the REST API: one commit per push, no git needed. The
 * version is the commit, the hash of a file is its Git blob hash. The sign-in is the GitHub account of VS Code.
 */
export class GitHubSyncProvider implements SyncProvider {
  readonly id = "github";
  readonly label = "GitHub";
  readonly targetNoun = "repository";
  readonly versionNoun = "commit";
  readonly canLimitHistory = true;
  readonly description = Strings.sync.github.description;
  readonly pickTitle = Strings.sync.github.pickTitle;
  readonly pickPlaceholder = Strings.sync.github.pickPlaceholder;
  readonly loading = Strings.sync.github.loading;

  readonly creator: TargetCreator = {
    item: Strings.sync.github.createItem,
    detail: Strings.sync.github.createDetail,
    prompt: Strings.sync.github.createPrompt,
    value: Strings.sync.github.createValue,
    validate: (name) =>
      REPOSITORY_NAME.test(name) && name !== "." && name !== ".."
        ? undefined
        : Strings.sync.github.createInvalid,
    create: async (name) => {
      try {
        return toTarget(await this.client.createRepository(name));
      } catch (error) {
        if (error instanceof GitHubError && error.status === 422) {
          throw new GitHubError(Strings.sync.github.createExists, { cause: error });
        }
        throw error;
      }
    },
  };

  readonly finder: TargetFinder = {
    item: Strings.sync.github.typeItem,
    detail: Strings.sync.github.typeDetail,
    prompt: Strings.sync.github.typePrompt,
    validate: (typed) =>
      REPOSITORY_FULL_NAME.test(typed.trim()) ? undefined : Strings.sync.github.typeInvalid,
    find: async (typed) => {
      const match = REPOSITORY_FULL_NAME.exec(typed.trim());
      if (!match) {
        throw new GitHubError(Strings.sync.github.typeInvalid);
      }
      return toTarget(await this.client.getRepository(match[1], match[2]));
    },
  };

  constructor(
    private readonly client: GitHubClient,
    private readonly auth: GitHubAuth
  ) {}

  hash(bytes: Uint8Array): string {
    return gitBlobSha(bytes);
  }

  signIn(): Promise<boolean> {
    return this.auth.signIn();
  }

  async listTargets(): Promise<RemoteTarget[]> {
    return (await this.client.listRepositories()).map(toTarget);
  }

  currentVersion(target: RemoteTarget): Promise<string | undefined> {
    const { owner, name, branch } = parse(target);
    return this.client.getHeadCommit(owner, name, branch);
  }

  async snapshot(target: RemoteTarget): Promise<RemoteSnapshot | undefined> {
    const { owner, name, branch } = parse(target);
    const head = await this.client.getHead(owner, name, branch);
    if (!head) {
      return undefined;
    }
    const { entries, truncated } = await this.client.getTree(owner, name, head.tree);
    return {
      version: head.commit,
      // Folders are implied by the files; links and submodules are not synced.
      files: entries
        .filter(
          (entry) => entry.type === "blob" && (entry.mode === "100644" || entry.mode === "100755")
        )
        .map((entry) => ({ path: entry.path, hash: entry.sha })),
      truncated,
    };
  }

  download(target: RemoteTarget, file: RemoteFile): Promise<Uint8Array> {
    const { owner, name } = parse(target);
    return this.client.getBlob(owner, name, file.hash);
  }

  async upload(
    target: RemoteTarget,
    expectedVersion: string | undefined,
    changes: readonly UploadChange[],
    message: string,
    options: UploadOptions = { keepLast: undefined }
  ): Promise<UploadResult> {
    const { owner, name, branch } = parse(target);
    let head = await this.client.getHead(owner, name, branch);
    if (head?.commit !== expectedVersion) {
      throw new GitHubError(Strings.sync.github.conflict);
    }
    if (!head) {
      // The Git Data API does not work on an empty repository: a first commit with a small marker file starts it.
      await this.client.createFirstCommit(owner, name, branch, MARKER_PATH, MARKER_TEXT);
      head = await this.client.getHead(owner, name, branch);
      if (!head) {
        throw new GitHubError(Strings.sync.github.unexpected);
      }
    }
    const hashes = new Map<string, string>();
    const treeChanges = await mapLimit(
      changes,
      TRANSFERS_AT_ONCE,
      async (change): Promise<TreeChange> => {
        if (!change.read) {
          return { path: change.path, sha: null };
        }
        const sha = await this.client.createBlob(owner, name, await change.read());
        hashes.set(change.path, sha);
        return { path: change.path, sha };
      }
    );
    const tree = await this.client.createTree(owner, name, head.tree, treeChanges);
    const keepLast = options.keepLast;
    if (keepLast === undefined) {
      const commit = await this.client.createCommit(owner, name, message, tree, head.commit);
      await this.client.updateBranch(owner, name, branch, commit);
      return { version: commit, hashes };
    }
    const commit = await this.limitHistory(
      owner,
      name,
      branch,
      head.commit,
      tree,
      message,
      keepLast
    );
    return { version: commit, hashes };
  }

  /**
   * Builds a history of at most `keepLast` commits that ends with the new commit and moves the branch onto it by force.
   * Git commits cannot be cut off from their parents, so the newest `keepLast - 1` commits are made again, one on top of
   * the other, with the same tree, message, author and date; the oldest of them has no parent. A history that is already
   * short enough just gets the new commit on top, without force.
   */
  private async limitHistory(
    owner: string,
    name: string,
    branch: string,
    headCommit: string,
    tree: string,
    message: string,
    keepLast: number
  ): Promise<string> {
    const kept: GitCommit[] = [];
    let next: string | undefined = headCommit;
    while (next !== undefined && kept.length < keepLast - 1) {
      const commit: GitCommit = await this.client.getCommit(owner, name, next);
      kept.push(commit);
      next = commit.parent;
    }
    if (next === undefined && keepLast > 1) {
      // The whole history fits: nothing to drop.
      const commit = await this.client.createCommit(owner, name, message, tree, headCommit);
      await this.client.updateBranch(owner, name, branch, commit);
      return commit;
    }
    let parent: string | undefined;
    for (const old of kept.reverse()) {
      parent = await this.client.createCommit(owner, name, old.message, old.tree, parent, {
        author: old.author,
        committer: old.committer,
      });
    }
    const commit = await this.client.createCommit(owner, name, message, tree, parent);
    await this.client.updateBranch(owner, name, branch, commit, { replaceHistory: true });
    return commit;
  }
}

function toTarget(repository: Repository): RemoteTarget {
  return {
    id: `${repository.fullName}@${repository.defaultBranch}`,
    label: repository.fullName,
    detail: repository.defaultBranch,
    isPrivate: repository.isPrivate,
  };
}

function parse(target: RemoteTarget): { owner: string; name: string; branch: string } {
  const match = TARGET_ID.exec(target.id);
  if (!match) {
    throw new GitHubError(Strings.sync.github.unexpected);
  }
  return { owner: match[1], name: match[2], branch: match[3] };
}
