import * as vscode from "vscode";
import { ConfigFile } from "../constants/settings";
import { Strings } from "../constants/strings";
import { ConfigCorruptError, ConfigLockedError } from "../util/errors";
import { isFileExistsError, isFileNotFoundError } from "../util/fsErrors";
import { Logger } from "./Logger";

/** Technical data that applies everywhere. User preferences live in VS Code settings instead. */
export interface NoteRootConfig {
  schemaVersion: number;
  createdAt: string;
  extensionVersion: string;
  /** Reserved for future data (tags, pinned notes, ...). Unknown content must be preserved when rewriting. */
  custom: Record<string, unknown>;
  /** Unknown top-level fields written by other versions are kept in memory too. */
  [key: string]: unknown;
}

export type ConfigStatus =
  | "ok" // exists and is valid
  | "created" // was missing, written with defaults
  | "corrupt" // invalid JSON or wrong shape; file left untouched
  | "unreadable" // could not be read; file left untouched
  | "newer" // schemaVersion is newer than this extension understands; file left untouched
  | "unwritable"; // was missing but could not be created; running on in-memory defaults

export interface ConfigLoadResult {
  status: ConfigStatus;
  /** Always usable: the file content when valid, in-memory defaults otherwise. */
  config: NoteRootConfig;
}

export type ConfigIssueKind = "corrupt" | "unreadable" | "newer";

/** A problem the user should hear about. The UI layer decides how to show it. */
export interface ConfigIssue {
  kind: ConfigIssueKind;
  configUri: vscode.Uri;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

/**
 * Manages `<root>/.noteroot/config.json`.
 *
 * Principles: the extension works without the file, a missing file or folder is
 * recreated silently, and an existing file is never overwritten or deleted.
 */
export class ConfigService implements vscode.Disposable {
  private readonly issueEmitter = new vscode.EventEmitter<ConfigIssue>();
  private readonly inFlight = new Map<string, Promise<ConfigLoadResult>>();
  /** Writes of the custom data run one after the other. */
  private updateQueue: Promise<unknown> = Promise.resolve();
  /** Identifies the issue already reported, so the same problem does not pop up on every check. */
  private reportedIssueKey: string | undefined;

  readonly onDidReportIssue = this.issueEmitter.event;

  constructor(
    private readonly logger: Logger,
    private readonly extensionVersion: string
  ) {}

  getConfigUri(root: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(root, ConfigFile.dirName, ConfigFile.fileName);
  }

  /** Reads the config, creating or healing it when it is missing. Never throws for file problems. */
  ensure(root: vscode.Uri): Promise<ConfigLoadResult> {
    const key = root.toString();
    const running = this.inFlight.get(key);
    if (running) {
      return running;
    }
    const task = this.load(root).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, task);
    return task;
  }

  /**
   * Changes the `custom` part of the config file and writes it back, keeping every other field
   * (also unknown ones). The file is read again right before the change, never cached.
   *
   * It refuses to touch a file that is invalid or newer than this extension understands: such a
   * file must never be replaced without the user's say.
   * @throws ConfigLockedError when the file may not be changed.
   */
  updateCustom(
    root: vscode.Uri,
    change: (custom: Record<string, unknown>) => void
  ): Promise<NoteRootConfig> {
    const task = this.updateQueue.then(() => this.writeCustom(root, change));
    this.updateQueue = task.catch(() => undefined);
    return task;
  }

  dispose(): void {
    this.issueEmitter.dispose();
  }

  private async writeCustom(
    root: vscode.Uri,
    change: (custom: Record<string, unknown>) => void
  ): Promise<NoteRootConfig> {
    const result = await this.ensure(root);
    if (result.status !== "ok" && result.status !== "created") {
      throw new ConfigLockedError();
    }
    const config: NoteRootConfig = { ...result.config, custom: { ...result.config.custom } };
    change(config.custom);
    // Read, change, write: another VS Code window saving in the same few milliseconds could lose a change.
    // The file is small and changes rarely, so this is accepted.
    await vscode.workspace.fs.writeFile(
      this.getConfigUri(root),
      encoder.encode(`${JSON.stringify(config, null, 2)}\n`)
    );
    this.logger.info(`Updated ${ConfigFile.dirName}/${ConfigFile.fileName}.`);
    return config;
  }

  private async load(root: vscode.Uri, isRetry = false): Promise<ConfigLoadResult> {
    const configUri = this.getConfigUri(root);

    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(configUri);
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return this.create(root, configUri, isRetry);
      }
      this.logger.error("Could not read the config file.", error);
      return this.report("unreadable", configUri);
    }

    let config: NoteRootConfig;
    try {
      config = parseConfig(decoder.decode(bytes));
    } catch (error) {
      this.logger.warn(
        `The config file is invalid: ${error instanceof Error ? error.message : String(error)}`
      );
      return this.report("corrupt", configUri);
    }

    if (config.schemaVersion > ConfigFile.schemaVersion) {
      this.logger.warn(
        `The config file has schemaVersion ${config.schemaVersion}, newer than the supported ${ConfigFile.schemaVersion}. Leaving it untouched.`
      );
      return this.report("newer", configUri, config);
    }
    if (config.schemaVersion < ConfigFile.schemaVersion) {
      config = this.migrate(config, config.schemaVersion, ConfigFile.schemaVersion);
    }
    this.reportedIssueKey = undefined;
    return { status: "ok", config };
  }

  private async create(
    root: vscode.Uri,
    configUri: vscode.Uri,
    isRetry: boolean
  ): Promise<ConfigLoadResult> {
    const config = this.createDefaultConfig();
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, ConfigFile.dirName));
      // workspace.fs.writeFile cannot refuse to overwrite. Two windows creating the file at the
      // same moment would both write the same defaults, which is harmless.
      await vscode.workspace.fs.writeFile(
        configUri,
        encoder.encode(`${JSON.stringify(config, null, 2)}\n`)
      );
    } catch (error) {
      // Another process may have created the folder or file in the meantime: read what is there.
      if (isFileExistsError(error) && !isRetry) {
        return this.load(root, true);
      }
      // Working without a config file is fine, so this is only logged.
      this.logger.warn(
        `Could not create the config file: ${error instanceof Error ? error.message : String(error)}`
      );
      return { status: "unwritable", config };
    }
    this.logger.info(`Created ${ConfigFile.dirName}/${ConfigFile.fileName} with default values.`);
    this.reportedIssueKey = undefined;
    return { status: "created", config };
  }

  private report(
    kind: ConfigIssueKind,
    configUri: vscode.Uri,
    parsed?: NoteRootConfig
  ): ConfigLoadResult {
    const key = `${configUri.toString()}|${kind}`;
    if (key !== this.reportedIssueKey) {
      this.reportedIssueKey = key;
      this.issueEmitter.fire({ kind, configUri });
    }
    return { status: kind, config: parsed ?? this.createDefaultConfig() };
  }

  /** Hook for future schema changes. Version 1 is the first, so there is nothing to migrate yet. */
  private migrate(config: NoteRootConfig, from: number, to: number): NoteRootConfig {
    this.logger.info(
      `Config schemaVersion ${from} is older than ${to}; no migration steps exist yet.`
    );
    return config;
  }

  private createDefaultConfig(): NoteRootConfig {
    return {
      schemaVersion: ConfigFile.schemaVersion,
      createdAt: new Date().toISOString(),
      extensionVersion: this.extensionVersion,
      custom: {},
    };
  }
}

/** @throws ConfigCorruptError when the text is not JSON or does not have the expected shape. */
function parseConfig(text: string): NoteRootConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigCorruptError(Strings.config.invalidJson, error);
  }
  if (!isRecord(raw) || !Number.isInteger(raw.schemaVersion) || (raw.schemaVersion as number) < 1) {
    throw new ConfigCorruptError(Strings.config.invalidShape);
  }
  const { createdAt, extensionVersion, custom } = raw;
  const optionalFieldsValid =
    (createdAt === undefined || typeof createdAt === "string") &&
    (extensionVersion === undefined || typeof extensionVersion === "string") &&
    (custom === undefined || isRecord(custom));
  if (!optionalFieldsValid) {
    throw new ConfigCorruptError(Strings.config.invalidShape);
  }
  return {
    ...raw,
    schemaVersion: raw.schemaVersion as number,
    createdAt: (createdAt as string | undefined) ?? "",
    extensionVersion: (extensionVersion as string | undefined) ?? "",
    custom: (custom as Record<string, unknown> | undefined) ?? {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
