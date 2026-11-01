import { Strings } from "../constants/strings";
import { DropboxError } from "../util/errors";
import type { DropboxAuth } from "./DropboxAuth";
import type { Logger } from "./Logger";

const API = "https://api.dropboxapi.com/2";
const CONTENT_API = "https://content.dropboxapi.com/2";
const FILES_PER_PAGE = 2000;
/** The most pages that are read of a list: a guard against a list that never ends. */
const MAX_LIST_PAGES = 50;

/** A file or a folder inside the app folder of NoteRoot in Dropbox. */
export interface DropboxEntry {
  readonly isFolder: boolean;
  /** The path as Dropbox writes it, with the capital letters of the user. */
  readonly display: string;
  /** The path in lower case: Dropbox does not tell capitals apart, so this one names the entry. */
  readonly lower: string;
  /** The content hash that Dropbox reports; undefined for a folder. */
  readonly contentHash: string | undefined;
  /** The revision of a file, which makes an update refuse when the file changed meanwhile. */
  readonly rev: string | undefined;
}

/** How a file is written: a new one (refused if it exists), or the next revision of one that exists. */
export type DropboxWriteMode =
  { readonly kind: "add" } | { readonly kind: "update"; readonly rev: string };

/**
 * A small client of the Dropbox API v2: only what the sync needs, on the global `fetch`, no dependencies. With an app that has
 * the access type "App folder", the path "" is the folder of the app. Every failure becomes a {@link DropboxError} whose message
 * says what the user can do. Nothing about a note is logged.
 */
export class DropboxClient {
  constructor(
    private readonly auth: DropboxAuth,
    private readonly logger: Logger
  ) {}

  /** What is in a folder of the app (the path "" is the folder of the app itself), with everything below it when `recursive`. */
  async listFolder(path: string, recursive: boolean): Promise<DropboxEntry[]> {
    const entries: DropboxEntry[] = [];
    let body = (await (
      await this.rpc("/files/list_folder", {
        path,
        recursive,
        include_deleted: false,
        include_non_downloadable_files: false,
        limit: FILES_PER_PAGE,
      })
    ).json()) as ListAnswer;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      for (const raw of Array.isArray(body.entries) ? body.entries : []) {
        const entry = toEntry(raw);
        if (entry) {
          entries.push(entry);
        }
      }
      if (body.has_more !== true || typeof body.cursor !== "string") {
        return entries;
      }
      body = (await (
        await this.rpc("/files/list_folder/continue", { cursor: body.cursor })
      ).json()) as ListAnswer;
    }
    throw new DropboxError(Strings.sync.dropbox.tooMany);
  }

  async createFolder(path: string): Promise<void> {
    await this.rpc("/files/create_folder_v2", { path, autorename: false });
  }

  /** Writes a file (the folders above it are made when they are missing). Returns the content hash Dropbox reports for it. */
  async upload(
    path: string,
    bytes: Uint8Array,
    mode: DropboxWriteMode
  ): Promise<string | undefined> {
    const answer = await this.content(
      "/files/upload",
      {
        path,
        mode: mode.kind === "add" ? "add" : { ".tag": "update", update: mode.rev },
        autorename: false,
        mute: true,
      },
      Buffer.from(bytes)
    );
    const hash = (
      (await answer.json().catch(() => undefined)) as { content_hash?: unknown } | undefined
    )?.content_hash;
    return typeof hash === "string" ? hash : undefined;
  }

  /** Removes a file (Dropbox keeps it for a while in its deleted files, so it can be taken back there). */
  async delete(path: string): Promise<void> {
    await this.rpc("/files/delete_v2", { path });
  }

  async download(path: string): Promise<Uint8Array> {
    const answer = await this.content("/files/download", { path });
    return new Uint8Array(await answer.arrayBuffer());
  }

  private rpc(endpoint: string, body: unknown): Promise<Response> {
    return this.request(`${API}${endpoint}`, () => ({
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  /** A call that sends or brings the content of a file: the arguments travel in a header. */
  private content(endpoint: string, argument: unknown, data?: Buffer): Promise<Response> {
    return this.request(`${CONTENT_API}${endpoint}`, () => ({
      headers: {
        "Dropbox-API-Arg": headerJson(argument),
        "Content-Type": data ? "application/octet-stream" : "text/plain",
      },
      body: data,
    }));
  }

  /** One request with the token. A 401 is tried once more with a new token. */
  private async request(
    url: string,
    init: () => { headers: Record<string, string>; body: Buffer | string | undefined }
  ): Promise<Response> {
    let token = await this.auth.token();
    for (let attempt = 0; ; attempt++) {
      const parts = init();
      let answer: Response;
      try {
        answer = await fetch(url, {
          method: "POST",
          headers: { ...parts.headers, Authorization: `Bearer ${token}` },
          body: parts.body,
        });
      } catch (error) {
        throw new DropboxError(Strings.sync.dropbox.network, { cause: error });
      }
      if (answer.status === 401 && attempt === 0) {
        token = await this.auth.renew();
        continue;
      }
      if (answer.ok) {
        return answer;
      }
      throw await this.failure(answer);
    }
  }

  private async failure(answer: Response): Promise<DropboxError> {
    const text = Strings.sync.dropbox;
    const status = answer.status;
    const raw = await answer.text().catch(() => "");
    // Dropbox says what went wrong in a short code ("path/not_found/..."); it holds no file content, and it is only logged.
    const summary = /"error_summary"\s*:\s*"([^"]{0,200})/.exec(raw)?.[1] ?? "";
    this.logger.warn(`Dropbox answered ${status} ${summary}`.trim());
    if (status === 401) {
      return new DropboxError(text.expired, { status });
    }
    if (status === 429 || summary.startsWith("too_many")) {
      return new DropboxError(text.rateLimited, { status });
    }
    if (summary.includes("insufficient_space")) {
      return new DropboxError(text.quota, { status });
    }
    if (status === 403 || summary.startsWith("missing_scope")) {
      return new DropboxError(text.forbidden, { status });
    }
    if (summary.includes("not_found")) {
      return new DropboxError(text.notFound, { status });
    }
    if (summary.includes("conflict")) {
      return new DropboxError(text.conflict, { status });
    }
    return new DropboxError(text.unexpected, { status });
  }
}

interface ListAnswer {
  readonly entries?: unknown;
  readonly cursor?: unknown;
  readonly has_more?: unknown;
}

function toEntry(raw: unknown): DropboxEntry | undefined {
  const item = raw as Record<string, unknown> | null;
  if (!item || (item[".tag"] !== "file" && item[".tag"] !== "folder")) {
    return undefined;
  }
  if (typeof item.path_display !== "string" || typeof item.path_lower !== "string") {
    return undefined;
  }
  return {
    isFolder: item[".tag"] === "folder",
    display: item.path_display,
    lower: item.path_lower,
    contentHash: typeof item.content_hash === "string" ? item.content_hash : undefined,
    rev: typeof item.rev === "string" ? item.rev : undefined,
  };
}

/** JSON for the `Dropbox-API-Arg` header: a header holds ASCII only, so every other character is written as \\uXXXX. */
function headerJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}
