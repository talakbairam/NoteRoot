import * as vscode from "vscode";

/** The scope that lets NoteRoot read and write the user's repositories, private ones included. */
const SCOPES = ["repo"];

/**
 * The GitHub sign-in of VS Code (the browser opens once, NoteRoot never sees a password). {@link token} is silent and is
 * what the client uses; {@link signIn} may open the sign-in of VS Code and is called by commands only.
 */
export class GitHubAuth {
  /** The token of an existing sign-in, or undefined. Never opens anything. */
  async token(): Promise<string | undefined> {
    const session = await vscode.authentication.getSession("github", SCOPES, { silent: true });
    return session?.accessToken;
  }

  /** Signs in when needed (VS Code asks the user). Returns false when the user said no. */
  async signIn(): Promise<boolean> {
    try {
      const session = await vscode.authentication.getSession("github", SCOPES, {
        createIfNone: true,
      });
      return session !== undefined;
    } catch {
      return false; // The user closed the sign-in.
    }
  }

  /** Fires when the user signs in or out of GitHub in VS Code. */
  get onDidChange(): vscode.Event<unknown> {
    return vscode.authentication.onDidChangeSessions;
  }
}
