import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { Strings } from "../constants/strings";
import { DecryptedViewService } from "../services/DecryptedViewService";
import { Logger } from "../services/Logger";
import { MIN_KEY_LENGTH, isEncryptedName } from "../services/NoteCrypto";
import { NoteEncryptionService } from "../services/NoteEncryptionService";
import { PathGuard } from "../services/PathGuard";
import { NoteItem } from "../tree/NoteItem";
import { TreeNavigator } from "../tree/TreeNavigator";
import { NoteRootError } from "../util/errors";
import { showStatus } from "../util/status";
import { registerSafeCommand, reportError } from "./safe";
import { closeTabsOf } from "./tabs";

export interface EncryptionCommandDependencies {
  context: vscode.ExtensionContext;
  logger: Logger;
  pathGuard: PathGuard;
  encryptionService: NoteEncryptionService;
  decryptedView: DecryptedViewService;
  navigator: TreeNavigator;
}

/** Encrypt, decrypt for viewing and decrypt for good: the right-click entries of a note, and a click on an encrypted note. */
export function registerEncryptionCommands(deps: EncryptionCommandDependencies): void {
  const { context, logger, pathGuard, encryptionService, decryptedView, navigator } = deps;
  const text = Strings.encryption;

  /** The master key to open a note, typed in a box that hides it. Undefined when cancelled. */
  function askKey(title: string): Thenable<string | undefined> {
    return vscode.window.showInputBox({
      title,
      prompt: text.decryptKeyPrompt,
      placeHolder: text.keyPlaceholder,
      password: true,
      ignoreFocusOut: true,
    });
  }

  /** A new master key, asked twice so a typing mistake cannot lock the note. Undefined when cancelled. */
  async function askNewKey(title: string): Promise<string | undefined> {
    const key = await vscode.window.showInputBox({
      title,
      prompt: text.keyPrompt,
      placeHolder: text.keyPlaceholder,
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) =>
        value.length < MIN_KEY_LENGTH ? text.keyTooShort(MIN_KEY_LENGTH) : undefined,
    });
    if (key === undefined) {
      return undefined;
    }
    const again = await vscode.window.showInputBox({
      title,
      prompt: text.keyConfirmPrompt,
      placeHolder: text.keyPlaceholder,
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => (value === key ? undefined : text.keyMismatch),
    });
    return again === undefined ? undefined : key;
  }

  /** From a context menu VS Code passes the clicked item and all selected items of the view. */
  const filesOf = (clicked?: unknown, selected?: unknown): NoteItem[] => {
    const fromArgs = Array.isArray(selected)
      ? selected.filter((item) => item instanceof NoteItem)
      : [];
    const items =
      fromArgs.length > 0
        ? fromArgs
        : clicked instanceof NoteItem
          ? [clicked]
          : [...navigator.selection];
    return items.filter((item) => item.kind === "file");
  };

  /** Runs one action on every note: failures do not stop the others. */
  async function forEach(
    uris: readonly vscode.Uri[],
    action: (uri: vscode.Uri) => Promise<vscode.Uri>
  ): Promise<{ done: vscode.Uri[]; failed: { name: string; message: string }[] }> {
    const done: vscode.Uri[] = [];
    const failed: { name: string; message: string }[] = [];
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: text.working },
      async () => {
        for (const uri of uris) {
          try {
            done.push(await action(uri));
          } catch (error) {
            logger.error("Encryption failed for a note.", error);
            failed.push({
              name: pathGuard.getRelativePath(uri) ?? uri.path,
              message:
                error instanceof NoteRootError ? error.message : Strings.common.genericFailure,
            });
          }
        }
      }
    );
    return { done, failed };
  }

  const report = async (
    done: readonly vscode.Uri[],
    failed: readonly { name: string; message: string }[],
    message: (name: string, count: number) => string
  ): Promise<void> => {
    if (done.length > 0) {
      await navigator.refreshAndReveal(done, { focus: false });
      showStatus(message(done[0].path.slice(done[0].path.lastIndexOf("/") + 1), done.length));
    }
    if (failed.length > 0) {
      void vscode.window.showWarningMessage(
        failed.map((entry) => `${entry.name}: ${entry.message}`).join("\n")
      );
    }
  };

  registerSafeCommand(
    context,
    logger,
    Commands.encryptNote,
    async (clicked?: unknown, selected?: unknown) => {
      const uris = filesOf(clicked, selected)
        .filter((item) => !isEncryptedName(item.name))
        .map((item) => item.uri);
      if (uris.length === 0) {
        return;
      }
      const key = await askNewKey(text.encryptTitle(uris.length));
      if (key === undefined) {
        return;
      }
      const { done, failed } = await forEach(uris, async (uri) => {
        await closeTabsOf([uri], pathGuard); // Tabs with unsaved changes stay open, and the service refuses those notes.
        return encryptionService.encrypt(uri, key);
      });
      await report(done, failed, text.encrypted);
    }
  );

  registerSafeCommand(
    context,
    logger,
    Commands.decryptNote,
    async (clicked?: unknown, selected?: unknown) => {
      const uris = filesOf(clicked, selected)
        .filter((item) => isEncryptedName(item.name))
        .map((item) => item.uri);
      if (uris.length === 0) {
        return;
      }
      const key = await askKey(text.decryptTitle(uris.length));
      if (key === undefined) {
        return;
      }
      const { done, failed } = await forEach(uris, async (uri) => {
        await closeTabsOf([uri], pathGuard);
        return encryptionService.decryptPermanently(uri, key);
      });
      await report(done, failed, text.decrypted);
    }
  );

  // A click on an encrypted note in the tree runs this too (the argument is then the address of the file).
  registerSafeCommand(context, logger, Commands.decryptView, async (target?: unknown) => {
    const uri =
      target instanceof NoteItem ? target.uri : target instanceof vscode.Uri ? target : undefined;
    if (!uri) {
      return;
    }
    const key = await askKey(text.decryptTitle(1));
    if (key === undefined) {
      return;
    }
    try {
      const { name, text: plain } = await encryptionService.decryptForViewing(uri, key);
      const document = await vscode.workspace.openTextDocument(decryptedView.add(name, plain));
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) {
      reportError(logger, "Decrypt for viewing", error);
    }
  });
}
