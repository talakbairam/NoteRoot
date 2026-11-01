import * as vscode from "vscode";
import { Strings } from "../constants/strings";
import { GitLabError } from "../util/errors";
import type { Logger } from "./Logger";
import type { SettingsService } from "./SettingsService";

/** Where the token is kept (SecretStorage: the system keychain, never a file or a setting). */
const TOKEN_KEY = "noteRoot.gitlab.token";

/**
 * The GitLab sign-in of NoteRoot: a personal access token (scope `api`) that the user makes in GitLab and pastes once. The token is
 * kept in SecretStorage on this computer and never logged. The address of the GitLab (gitlab.com or the one of a company) is the
 * setting `gitlabAddress` of the notes folder (only `https`, so the token is never sent in the clear). {@link signIn} asks and is
 * called by commands only; {@link token} is silent.
 */
export class GitLabAuth {
  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly settings: SettingsService,
    private readonly logger: Logger
  ) {}

  /** The address of the GitLab (the setting of the notes folder), without a slash at the end. */
  get baseUrl(): string {
    return this.settings.gitlabAddress;
  }

  /** The token of an existing sign-in.
   * @throws GitLabError when there is none. */
  async token(): Promise<string> {
    const token = await this.secrets.get(TOKEN_KEY);
    if (!token) {
      throw new GitLabError(Strings.sync.gitlab.notSignedIn);
    }
    return token;
  }

  /**
   * Makes sure there is a sign-in: asks for the token when there is none, and checks it (with the address of the settings) with
   * one request. False when the user said no.
   * @throws GitLabError when GitLab does not accept the token or cannot be reached.
   */
  async signIn(): Promise<boolean> {
    if (await this.secrets.get(TOKEN_KEY)) {
      return true;
    }
    const base = this.baseUrl;
    const token = await vscode.window.showInputBox({
      title: Strings.sync.gitlab.signInTitle,
      prompt: Strings.sync.gitlab.tokenPrompt(base),
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) =>
        value.trim().length > 0 && !/\s/.test(value.trim())
          ? undefined
          : Strings.sync.gitlab.tokenInvalid,
    });
    if (token === undefined) {
      return false;
    }
    await this.check(base, token.trim());
    await this.secrets.store(TOKEN_KEY, token.trim());
    return true;
  }

  /** True when a token is saved (it may still be refused by GitLab). */
  async hasToken(): Promise<boolean> {
    return (await this.secrets.get(TOKEN_KEY)) !== undefined;
  }

  /** Forgets the token (it was refused, or the user wants to change it). The address stays. */
  async signOut(): Promise<void> {
    await this.secrets.delete(TOKEN_KEY);
  }

  /** One request that proves the address and the token are good. */
  private async check(base: string, token: string): Promise<void> {
    let answer: Response;
    try {
      answer = await fetch(`${base}/api/v4/user`, { headers: { "PRIVATE-TOKEN": token } });
    } catch (error) {
      throw new GitLabError(Strings.sync.gitlab.network, { cause: error });
    }
    if (!answer.ok) {
      this.logger.warn(`GitLab did not accept the token: ${answer.status}`);
      throw new GitLabError(Strings.sync.gitlab.tokenRefused, { status: answer.status });
    }
  }
}
