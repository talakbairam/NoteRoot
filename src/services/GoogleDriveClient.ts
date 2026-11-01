import { Strings } from "../constants/strings";
import { GoogleError } from "../util/errors";
import type { GoogleAuth } from "./GoogleAuth";
import type { Logger } from "./Logger";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_TYPE = "application/vnd.google-apps.folder";
const FILES_PER_PAGE = 1000;
/** The most pages of the list that are read (1000 files each): a guard against a list that never ends. */
const MAX_LIST_PAGES = 20;

/** A file or a folder that NoteRoot made in the Drive of the user. */
export interface DriveItem {
  readonly id: string;
  readonly name: string;
  /** The folder it is in, or undefined for the top of the Drive (or a folder that NoteRoot cannot see). */
  readonly parent: string | undefined;
  readonly isFolder: boolean;
  /** The MD5 of the content that Drive reports; undefined for a folder and for a Google document (which has no bytes). */
  readonly md5: string | undefined;
}

interface RawFile {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly mimeType?: unknown;
  readonly parents?: unknown;
  readonly md5Checksum?: unknown;
}

/**
 * A small client of the Google Drive API (v3): only what the sync needs, on the global `fetch`, no dependencies. With the
 * `drive.file` scope the API only shows the files that NoteRoot made, so a list of "everything" is the list of the notes
 * (all the folders that NoteRoot syncs, which the provider tells apart by their parents). Every failure becomes a
 * {@link GoogleError} whose message says what the user can do. Nothing about a note is logged.
 */
export class GoogleDriveClient {
  constructor(
    private readonly auth: GoogleAuth,
    private readonly logger: Logger
  ) {}

  /** Every file and folder of NoteRoot that is not in the trash. */
  async listAll(): Promise<DriveItem[]> {
    const items: DriveItem[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const query = new URLSearchParams({
        q: "trashed = false",
        fields: "nextPageToken,files(id,name,mimeType,parents,md5Checksum)",
        pageSize: String(FILES_PER_PAGE),
        spaces: "drive",
      });
      if (pageToken) {
        query.set("pageToken", pageToken);
      }
      const body = (await (await this.request(`${API}/files?${query.toString()}`)).json()) as {
        files?: unknown;
        nextPageToken?: unknown;
      };
      for (const raw of Array.isArray(body.files) ? (body.files as RawFile[]) : []) {
        const item = toItem(raw);
        if (item) {
          items.push(item);
        }
      }
      pageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : undefined;
      if (!pageToken) {
        return items;
      }
    }
    throw new GoogleError(Strings.sync.googleDrive.tooMany);
  }

  /** Makes a folder (in the top of the Drive when `parent` is undefined) and returns its id. */
  async createFolder(name: string, parent: string | undefined): Promise<string> {
    const answer = await this.request(`${API}/files?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_TYPE,
        ...(parent ? { parents: [parent] } : {}),
      }),
    });
    return idOf(await answer.json());
  }

  /** Makes a file in `parent` and returns its id and the MD5 that Drive reports for the content. */
  async createFile(
    name: string,
    parent: string,
    bytes: Uint8Array
  ): Promise<{ id: string; md5: string | undefined }> {
    // One request with two parts: the description of the file, then its content.
    const boundary = `noteroot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const head = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent] })}\r\n` +
        `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      "utf8"
    );
    const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
    const answer = await this.request(
      `${UPLOAD_API}/files?uploadType=multipart&fields=id,md5Checksum`,
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: Buffer.concat([head, Buffer.from(bytes), tail]),
      }
    );
    return fileResult(await answer.json());
  }

  /** Replaces the content of a file (Drive keeps the old content as a version) and returns the new MD5. */
  async updateFile(
    id: string,
    bytes: Uint8Array
  ): Promise<{ id: string; md5: string | undefined }> {
    const answer = await this.request(
      `${UPLOAD_API}/files/${encodeURIComponent(id)}?uploadType=media&fields=id,md5Checksum`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/octet-stream" },
        body: Buffer.from(bytes),
      }
    );
    return fileResult(await answer.json());
  }

  /** Puts a file in the Trash of the user's Drive (it can be taken back there). */
  async trash(id: string): Promise<void> {
    await this.request(`${API}/files/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
  }

  async download(id: string): Promise<Uint8Array> {
    const answer = await this.request(`${API}/files/${encodeURIComponent(id)}?alt=media`);
    return new Uint8Array(await answer.arrayBuffer());
  }

  /** One request with the token. A 401 is tried once more with a new token. */
  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    let token = await this.auth.token();
    for (let attempt = 0; ; attempt++) {
      let answer: Response;
      try {
        answer = await fetch(url, {
          ...init,
          headers: {
            ...(init.headers as Record<string, string> | undefined),
            Authorization: `Bearer ${token}`,
          },
        });
      } catch (error) {
        throw new GoogleError(Strings.sync.googleDrive.network, { cause: error });
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

  private async failure(answer: Response): Promise<GoogleError> {
    const text = Strings.sync.googleDrive;
    const body = (await answer.json().catch(() => ({}))) as {
      error?: { errors?: { reason?: unknown }[] };
    };
    const reason = String(body.error?.errors?.[0]?.reason ?? "");
    // The reason is a short code from Google; no file name or content is in it.
    this.logger.warn(`Google Drive answered ${answer.status} ${reason}`.trim());
    const status = answer.status;
    if (status === 401) {
      return new GoogleError(text.expired, { status });
    }
    if (status === 429 || reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") {
      return new GoogleError(text.rateLimited, { status });
    }
    if (reason === "storageQuotaExceeded") {
      return new GoogleError(text.quota, { status });
    }
    if (status === 403) {
      return new GoogleError(text.forbidden, { status });
    }
    if (status === 404) {
      return new GoogleError(text.notFound, { status });
    }
    return new GoogleError(text.unexpected, { status });
  }
}

function toItem(raw: RawFile): DriveItem | undefined {
  if (typeof raw.id !== "string" || typeof raw.name !== "string") {
    return undefined;
  }
  const parent =
    Array.isArray(raw.parents) && typeof raw.parents[0] === "string" ? raw.parents[0] : undefined;
  return {
    id: raw.id,
    name: raw.name,
    parent,
    isFolder: raw.mimeType === FOLDER_TYPE,
    md5: typeof raw.md5Checksum === "string" ? raw.md5Checksum : undefined,
  };
}

function idOf(body: unknown): string {
  const id = (body as { id?: unknown } | null)?.id;
  if (typeof id !== "string") {
    throw new GoogleError(Strings.sync.googleDrive.unexpected);
  }
  return id;
}

function fileResult(body: unknown): { id: string; md5: string | undefined } {
  const md5 = (body as { md5Checksum?: unknown } | null)?.md5Checksum;
  return { id: idOf(body), md5: typeof md5 === "string" ? md5 : undefined };
}
