import * as vscode from "vscode";
import { Strings } from "../constants/strings";
import { describeError } from "../util/fsErrors";

/**
 * Thin wrapper around a log-level output channel.
 * Rule: never pass note contents to the logger, only paths relative to the root and metadata.
 */
export class Logger implements vscode.Disposable {
  private readonly channel = vscode.window.createOutputChannel(Strings.extensionName, {
    log: true,
  });

  info(message: string): void {
    this.channel.info(message);
  }

  warn(message: string): void {
    this.channel.warn(message);
  }

  debug(message: string): void {
    this.channel.debug(message);
  }

  /** Logs a context message plus the full error (with stack when available). */
  error(message: string, error?: unknown): void {
    this.channel.error(error === undefined ? message : `${message}\n${describeError(error)}`);
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
