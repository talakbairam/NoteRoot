import { Strings } from "../constants/strings";
import { GitLabError } from "../util/errors";
import { mapLimit } from "../util/mapLimit";
import { gitBlobSha } from "./GitHash";
import type { GitLabAction, GitLabProject } from "./GitLabClient";
import type { GitLabAuth } from "./GitLabAuth";
import type { GitLabClient } from "./GitLabClient";
import type {
  RemoteFile,
  RemoteSnapshot,
  RemoteTarget,
  SyncProvider,
  TargetCreator,
  TargetFinder,
  UploadChange,
  UploadResult,
} from "./SyncProvider";

const TRANSFERS_AT_ONCE = 4;
const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}$/;
const PROJECT_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/;
/** The id of a target: `projectId@branch`. */
const TARGET_ID = /^(\d+)@(.+)$/;
/** The branch of a project that has none yet. */
const FIRST_BRANCH = "main";

/**
 * Syncs with a GitLab project (its default branch; gitlab.com or the GitLab of a company) through the REST API: one commit per
 * push, no git needed. Like GitHub, the version is the commit and the hash of a file is its Git blob hash, so the files compare
 * as they are. The sign-in is a personal access token (see {@link GitLabAuth}). A push is one commit with every change; for an
 * empty project the first file starts the repository and the rest follows in a second commit.
 */
export class GitLabSyncProvider implements SyncProvider {
  readonly id = "gitlab";
  readonly label = "GitLab";
  readonly targetNoun = "project";
  readonly versionNoun = "commit";
  readonly canLimitHistory = false;
  readonly description = Strings.sync.gitlab.description;
  readonly pickTitle = Strings.sync.gitlab.pickTitle;
  readonly pickPlaceholder = Strings.sync.gitlab.pickPlaceholder;
  readonly loading = Strings.sync.gitlab.loading;

  readonly creator: TargetCreator = {
    item: Strings.sync.gitlab.createItem,
    detail: Strings.sync.gitlab.createDetail,
    prompt: Strings.sync.gitlab.createPrompt,
    value: Strings.sync.gitlab.createValue,
    validate: (name) =>
      PROJECT_NAME.test(name.trim()) ? undefined : Strings.sync.gitlab.createInvalid,
    create: async (name) => toTarget(await this.client.createProject(name.trim())),
  };

  readonly finder: TargetFinder = {
    item: Strings.sync.gitlab.typeItem,
    detail: Strings.sync.gitlab.typeDetail,
    prompt: Strings.sync.gitlab.typePrompt,
    validate: (typed) =>
      PROJECT_PATH.test(typed.trim()) ? undefined : Strings.sync.gitlab.typeInvalid,
    find: async (typed) => {
      if (!PROJECT_PATH.test(typed.trim())) {
        throw new GitLabError(Strings.sync.gitlab.typeInvalid);
      }
      return toTarget(await this.client.getProject(typed.trim()));
    },
  };

  constructor(
    private readonly client: GitLabClient,
    private readonly auth: GitLabAuth
  ) {}

  hash(bytes: Uint8Array): string {
    return gitBlobSha(bytes);
  }

  webUrl(target: RemoteTarget): string {
    return `${this.auth.baseUrl}/${target.label}`;
  }

  signIn(): Promise<boolean> {
    return this.auth.signIn();
  }

  async listTargets(): Promise<RemoteTarget[]> {
    return (await this.client.listProjects()).map(toTarget);
  }

  currentVersion(target: RemoteTarget): Promise<string | undefined> {
    const { project, branch } = parse(target);
    return this.client.getHeadCommit(project, branch);
  }

  async snapshot(target: RemoteTarget): Promise<RemoteSnapshot | undefined> {
    const { project, branch } = parse(target);
    const head = await this.client.getHeadCommit(project, branch);
    if (!head) {
      return undefined;
    }
    const files = await this.client.listFiles(project, head);
    return {
      version: head,
      files: files.map((file) => ({ path: file.path, hash: file.sha })),
      truncated: false,
    };
  }

  download(target: RemoteTarget, file: RemoteFile): Promise<Uint8Array> {
    return this.client.getBlob(parse(target).project, file.hash);
  }

  async upload(
    target: RemoteTarget,
    expectedVersion: string | undefined,
    changes: readonly UploadChange[],
    message: string
  ): Promise<UploadResult> {
    const { project, branch } = parse(target);
    const head = await this.client.getHeadCommit(project, branch);
    if (head !== expectedVersion) {
      throw new GitLabError(Strings.sync.gitlab.conflict);
    }
    // A file that is in the project is updated, a new one is created: GitLab wants to be told which.
    const existing = new Set(
      head ? (await this.client.listFiles(project, head)).map((file) => file.path) : []
    );
    const hashes = new Map<string, string>();
    const actions = (
      await mapLimit(
        changes,
        TRANSFERS_AT_ONCE,
        async (change): Promise<GitLabAction | undefined> => {
          if (!change.read) {
            return existing.has(change.path) ? { action: "delete", path: change.path } : undefined;
          }
          const bytes = await change.read();
          hashes.set(change.path, gitBlobSha(bytes));
          return {
            action: existing.has(change.path) ? "update" : "create",
            path: change.path,
            bytes,
          };
        }
      )
    ).filter((action): action is GitLabAction => action !== undefined);
    if (actions.length === 0) {
      // Only deletions of files that are not there: nothing to commit.
      if (head) {
        return { version: head, hashes };
      }
      throw new GitLabError(Strings.sync.gitlab.unexpected);
    }
    const version = await this.client.commit(project, branch, message, actions, head !== undefined);
    return { version, hashes };
  }
}

function toTarget(project: GitLabProject): RemoteTarget {
  return {
    id: `${project.id}@${project.defaultBranch ?? FIRST_BRANCH}`,
    label: project.path,
    detail: project.defaultBranch ?? FIRST_BRANCH,
    isPrivate: project.isPrivate,
  };
}

function parse(target: RemoteTarget): { project: number; branch: string } {
  const match = TARGET_ID.exec(target.id);
  if (!match) {
    throw new GitLabError(Strings.sync.gitlab.unexpected);
  }
  return { project: Number(match[1]), branch: match[2] };
}
