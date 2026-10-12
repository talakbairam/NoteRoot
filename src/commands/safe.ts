import * as vscode from "vscode";
import { Strings } from "../constants/strings";
import { Logger } from "../services/Logger";
import { NoteRootError } from "../util/errors";

type CommandHandler = (...args: unknown[]) => unknown;

/**
 * Logs the details of an error and shows the user one short, friendly message.
 * Typed NoteRoot errors carry a message that is safe to show; anything else gets a generic one.
 */
export function reportError(logger: Logger, what: string, error: unknown): void {
  logger.error(`${what} failed.`, error);
  const message = error instanceof NoteRootError ? error.message : Strings.common.genericFailure;
  // Not awaited on purpose: the message may stay open as long as it likes.
  void vscode.window.showErrorMessage(message, Strings.common.showLogs).then((choice) => {
    if (choice === Strings.common.showLogs) {
      logger.show();
    }
  });
}

/** Registers a command whose errors never escape: details go to the log, the user gets one short message. */
export function registerSafeCommand(
  context: vscode.ExtensionContext,
  logger: Logger,
  commandId: string,
  handler: CommandHandler
): void {
  const disposable = vscode.commands.registerCommand(commandId, async (...args: unknown[]) => {
    try {
      // The result is returned, so commands that answer a question (an internal pick, for example) work.
      return await handler(...args);
    } catch (error) {
      reportError(logger, `Command ${commandId}`, error);
      return undefined;
    }
  });
  context.subscriptions.push(disposable);
}
