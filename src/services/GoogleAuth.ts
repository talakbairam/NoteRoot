import { createHash, randomBytes } from "crypto";
import * as vscode from "vscode";
import { GoogleOAuth } from "../constants/google";
import { Strings } from "../constants/strings";
import { GoogleError } from "../util/errors";
import { listenForCode } from "../util/loopback";
import type { Logger } from "./Logger";
import type { GoogleClient, GoogleClientStore } from "./GoogleClientStore";

/** Where the refresh token is kept (SecretStorage: the system keychain, never a file). */
const REFRESH_TOKEN_KEY = "noteRoot.google.refreshToken";
/** A token is renewed this long before it ends, so a request never starts with one that is about to expire. */
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
 * The Google sign-in of NoteRoot: OAuth 2.0 for an installed application, with PKCE. The system browser opens the consent
 * page of Google; the answer comes back to a small server on `127.0.0.1` that lives only until it arrives. NoteRoot never
 * sees the password; it keeps the refresh token in SecretStorage and the short access token in memory. {@link token} is
 * silent; {@link signIn} opens the browser and is called by commands only.
 */
export class GoogleAuth {
  private access: AccessToken | undefined;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly clients: GoogleClientStore,
    private readonly logger: Logger
  ) {}

  /** True when a sign-in was made before (it may still have to be renewed or be refused by Google). */
  async isSignedIn(): Promise<boolean> {
    return (await this.secrets.get(REFRESH_TOKEN_KEY)) !== undefined;
  }

  /**
   * Makes sure there is a sign-in: opens the browser when there is none. False when the user said no or did not finish in time.
   * @throws GoogleError when the Google client of NoteRoot is not set up, or Google refuses.
   */
  async signIn(): Promise<boolean> {
    if (await this.isSignedIn()) {
      return true;
    }
    this.assertConfigured();
    const verifier = base64Url(randomBytes(32));
    const state = base64Url(randomBytes(16));
    // Port 0: the system picks a free one.
    const listener = await listenForCode(state, {
      done: Strings.sync.googleDrive.pageDone,
      failed: Strings.sync.googleDrive.pageFailed,
    }).catch((error: unknown) => {
      throw new GoogleError(Strings.sync.googleDrive.network, { cause: error });
    });
    try {
      const redirect = `http://127.0.0.1:${listener.port}`;
      const url = new URL(GoogleOAuth.authUrl);
      url.search = new URLSearchParams({
        client_id: this.client.id,
        redirect_uri: redirect,
        response_type: "code",
        scope: GoogleOAuth.scope,
        state,
        code_challenge: base64Url(createHash("sha256").update(verifier).digest()),
        code_challenge_method: "S256",
        // The refresh token is only given on a consent that was asked for again.
        access_type: "offline",
        prompt: "consent",
      }).toString();
      if (!(await vscode.env.openExternal(vscode.Uri.parse(url.toString())))) {
        throw new GoogleError(Strings.sync.googleDrive.browserNotOpened);
      }
      const code = await listener.code;
      if (code === undefined) {
        return false;
      }
      const response = await this.requestToken({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect,
        code_verifier: verifier,
      });
      if (typeof response.refresh_token !== "string") {
        throw new GoogleError(Strings.sync.googleDrive.noRefreshToken);
      }
      await this.secrets.store(REFRESH_TOKEN_KEY, response.refresh_token);
      this.keep(response);
      return true;
    } finally {
      listener.close();
    }
  }

  /** Forgets the sign-in on this computer (the user can also take the access away in the Google account). */
  async signOut(): Promise<void> {
    this.access = undefined;
    await this.secrets.delete(REFRESH_TOKEN_KEY);
  }

  /**
   * A token that is valid now.
   * @throws GoogleError when there is no sign-in or Google no longer accepts it (the user signs in again).
   */
  async token(): Promise<string> {
    if (this.access && this.access.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
      return this.access.value;
    }
    return this.renew();
  }

  /** Throws away the token in memory and gets a new one: for a request that Google answered with "not signed in". */
  async renew(): Promise<string> {
    this.access = undefined;
    const refresh = await this.secrets.get(REFRESH_TOKEN_KEY);
    if (!refresh) {
      throw new GoogleError(Strings.sync.googleDrive.notSignedIn);
    }
    this.assertConfigured();
    const response = await this.requestToken({
      grant_type: "refresh_token",
      refresh_token: refresh,
    });
    return this.keep(response);
  }

  /**
   * The Google client to use: the one of the user, else the one that comes with NoteRoot.
   * @throws GoogleError when there is none.
   */
  private get client(): GoogleClient {
    const client = this.clients.effective;
    if (!client) {
      throw new GoogleError(Strings.sync.googleDrive.notConfigured);
    }
    return client;
  }

  private assertConfigured(): void {
    if (!this.clients.effective) {
      throw new GoogleError(Strings.sync.googleDrive.notConfigured);
    }
  }

  private keep(response: TokenResponse): string {
    if (typeof response.access_token !== "string") {
      throw new GoogleError(Strings.sync.googleDrive.unexpected);
    }
    const seconds = typeof response.expires_in === "number" ? response.expires_in : 3000;
    this.access = { value: response.access_token, expiresAt: Date.now() + seconds * 1000 };
    return response.access_token;
  }

  private async requestToken(fields: Record<string, string>): Promise<TokenResponse> {
    let answer: Response;
    try {
      answer = await fetch(GoogleOAuth.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.client.id,
          client_secret: this.client.secret,
          ...fields,
        }).toString(),
      });
    } catch (error) {
      throw new GoogleError(Strings.sync.googleDrive.network, { cause: error });
    }
    const body = (await answer.json().catch(() => ({}))) as TokenResponse;
    if (!answer.ok) {
      // The token or the code is never logged, only what Google says went wrong.
      this.logger.warn(`Google token request refused: ${String(body.error ?? answer.status)}`);
      if (body.error === "invalid_grant" && fields.grant_type === "refresh_token") {
        // The access was taken away, or the token ended (an app in testing): the user signs in again.
        await this.signOut();
        throw new GoogleError(Strings.sync.googleDrive.expired, { status: answer.status });
      }
      throw new GoogleError(Strings.sync.googleDrive.signInRefused, { status: answer.status });
    }
    return body;
  }
}
