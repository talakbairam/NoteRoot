import * as vscode from "vscode";
import { Strings } from "../constants/strings";
import type { KeyAsker } from "../services/EncryptedSyncProvider";
import { MIN_KEY_LENGTH } from "../services/NoteCrypto";

/** Asks for the master key of an encrypted repository (typed hidden). Used by the sync when it needs to open a repository. */
export function createKeyAsker(): KeyAsker {
  return {
    askExisting: (label, retry) =>
      Promise.resolve(
        vscode.window.showInputBox({
          title: Strings.sync.encryption.newKeyTitle,
          prompt: retry
            ? Strings.sync.encryption.askKeyRetry
            : Strings.sync.encryption.askKeyPrompt(label),
          placeHolder: Strings.encryption.keyPlaceholder,
          password: true,
          ignoreFocusOut: true,
        })
      ),
  };
}

/** Asks for a new master key twice. Undefined when the user cancelled. */
export async function askNewMasterKey(): Promise<string | undefined> {
  const key = await vscode.window.showInputBox({
    title: Strings.sync.encryption.newKeyTitle,
    prompt: Strings.sync.encryption.newKeyPrompt,
    placeHolder: Strings.encryption.keyPlaceholder,
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) =>
      value.length < MIN_KEY_LENGTH ? Strings.encryption.keyTooShort(MIN_KEY_LENGTH) : undefined,
  });
  if (key === undefined) {
    return undefined;
  }
  const again = await vscode.window.showInputBox({
    title: Strings.sync.encryption.newKeyTitle,
    prompt: Strings.sync.encryption.newKeyAgain,
    placeHolder: Strings.encryption.keyPlaceholder,
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value === key ? undefined : Strings.encryption.keyMismatch),
  });
  return again === undefined ? undefined : key;
}
