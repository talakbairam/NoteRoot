import { createHash, randomBytes } from "crypto";
import * as vscode from "vscode";
import { Strings } from "../constants/strings";
import { DropboxError } from "../util/errors";
import { listenForCode } from "../util/loopback";
import type { Logger } from "./Logger";
import type { SettingsService } from "./SettingsService";

const AUTH_URL = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
/** Where the refresh token is kept (SecretStorage: the system keychain, never a file or a setting). */
const REFRESH_TOKEN_KEY = "noteRoot.dropbox.refreshToken";
/**
 * The port of the address the browser comes back to. Dropbox wants the address of the app registered in advance, so it is a fixed
 * one (the user writes `http://localhost:53682/` in the Redirect URIs of the app).
 */
export const DROPBOX_REDIRECT_PORT = 53682;
/** A token is renewed this long before it ends. */
const EXPIRY_MARGIN_MS = 60_000;

interface AccessToken {
  readonly value: string;
  readonly expiresAt: number;
}

interface TokenResponse {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly expires_in?: unknown;
  readonly error?: unknown;
}

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

/**
 * The Dropbox sign-in of NoteRoot: OAuth 2.0 with PKCE (no app secret). The system browser opens the page of Dropbox; the answer
 * comes back to a small server on `localhost:53682` that lives only until it arrives. NoteRoot never sees the password; it keeps
 * the refresh token in SecretStorage and the short access token in memory. {@link token} is silent; {@link signIn} opens the
 * browser and is called by commands only. The **app key** of the user's own Dropbox app is the setting `dropboxAppKey`.
 */
export class DropboxAuth {
  private access: AccessToken | undefined;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly settings: SettingsService,
    private readonly logger: Logger
  ) {}

  /** True when a sign-in was made before (it may still have to be renewed or be refused by Dropbox). */
  async isSignedIn(): Promise<boolean> {
    return (await this.secrets.get(REFRESH_TOKEN_KEY)) !== undefined;
  }

  /** The redirect address that has to be in the Redirect URIs of the Dropbox app. */
  get redirectUri(): string {
    return `http://localhost:${DROPBOX_REDIRECT_PORT}/`;
  }

  /**
   * Makes sure there is a sign-in: opens the browser when there is none. False when the user said no or did not finish in time.
   * @throws DropboxError when there is no app key, the port is taken, or Dropbox refuses.
   */
  async signIn(): Promise<boolean> {
    if (await this.isSignedIn()) {
      return true;
    }
    const appKey = this.appKey();
    const verifier = base64Url(randomBytes(32));
    const state = base64Url(randomBytes(16));
    const listener = await listenForCode(
      state,
      { done: Strings.sync.dropbox.pageDone, failed: Strings.sync.dropbox.pageFailed },
      DROPBOX_REDIRECT_PORT
    ).catch((error: unknown) => {
      throw new DropboxError(Strings.sync.dropbox.portBusy(DROPBOX_REDIRECT_PORT), {
        cause: error,
      });
    });
    try {
      const url = new URL(AUTH_URL);
      url.search = new URLSearchParams({
        client_id: appKey,
        response_type: "code",
        redirect_uri: this.redirectUri,
        state,
        code_challenge: base64Url(createHash("sha256").update(verifier).digest()),
        code_challenge_method: "S256",
        // Without this Dropbox gives only a token that ends in a few hours.
        token_access_type: "offline",
      }).toString();
      if (!(await vscode.env.openExternal(vscode.Uri.parse(url.toString())))) {
        throw new DropboxError(Strings.sync.dropbox.browserNotOpened);
      }
      const code = await listener.code;
      if (code === undefined) {
        return false;
      }
      const response = await this.requestToken({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.redirectUri,
        code_verifier: verifier,
      });
      if (typeof response.refresh_token !== "string") {
        throw new DropboxError(Strings.sync.dropbox.noRefreshToken);
      }
      await this.secrets.store(REFRESH_TOKEN_KEY, response.refresh_token);
      this.keep(response);
      return true;
    } finally {
      listener.close();
    }
  }

  /** Forgets the sign-in on this computer (the user can also take the access away in the Dropbox account). */
  async signOut(): Promise<void> {
    this.access = undefined;
    await this.secrets.delete(REFRESH_TOKEN_KEY);
  }

  /**
   * A token that is valid now.
   * @throws DropboxError when there is no sign-in or Dropbox no longer accepts it (the user signs in again).
   */
  async token(): Promise<string> {
    if (this.access && this.access.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
      return this.access.value;
    }
    return this.renew();
  }

  /** Throws away the token in memory and gets a new one: for a request that Dropbox answered with "not signed in". */
  async renew(): Promise<string> {
    this.access = undefined;
    const refresh = await this.secrets.get(REFRESH_TOKEN_KEY);
    if (!refresh) {
      throw new DropboxError(Strings.sync.dropbox.notSignedIn);
    }
    this.appKey();
    return this.keep(
      await this.requestToken({ grant_type: "refresh_token", refresh_token: refresh })
    );
  }

  /** @throws DropboxError when the setting with the app key is empty. */
  private appKey(): string {
    const key = this.settings.dropboxAppKey;
    if (key === "") {
      throw new DropboxError(Strings.sync.dropbox.notConfigured);
    }
    return key;
  }

  private keep(response: TokenResponse): string {
    if (typeof response.access_token !== "string") {
      throw new DropboxError(Strings.sync.dropbox.unexpected);
    }
    const seconds = typeof response.expires_in === "number" ? response.expires_in : 3600;
    this.access = { value: response.access_token, expiresAt: Date.now() + seconds * 1000 };
    return response.access_token;
  }

  private async requestToken(fields: Record<string, string>): Promise<TokenResponse> {
    let answer: Response;
    try {
      answer = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.appKey(), ...fields }).toString(),
      });
    } catch (error) {
      throw new DropboxError(Strings.sync.dropbox.network, { cause: error });
    }
    const body = (await answer.json().catch(() => ({}))) as TokenResponse;
    if (!answer.ok) {
      // The token or the code is never logged, only what Dropbox says went wrong.
      this.logger.warn(`Dropbox token request refused: ${String(body.error ?? answer.status)}`);
      if (body.error === "invalid_grant" && fields.grant_type === "refresh_token") {
        // The access was taken away: the user signs in again.
        await this.signOut();
        throw new DropboxError(Strings.sync.dropbox.expired, { status: answer.status });
      }
      throw new DropboxError(Strings.sync.dropbox.signInRefused, { status: answer.status });
    }
    return body;
  }
}
