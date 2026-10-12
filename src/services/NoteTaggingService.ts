import * as vscode from "vscode";
import { LabelService } from "./LabelService";
import { Logger } from "./Logger";
import { ExcludeMatcher } from "./ExcludeMatcher";
import { InternalSaves } from "./InternalSaves";
import { applyTagEdits, changedRegion, entryHeadingMatcher, planNoteTags } from "./NoteTagging";
import { isEncryptedName } from "./NoteCrypto";
import { PathGuard } from "./PathGuard";
import { SearchService } from "./SearchService";
import { SettingsService } from "./SettingsService";

const encoder = new TextEncoder();

/** What was written into a note when it was saved. */
export interface TagOnSaveResult {
  /** Path relative to the notes folder. */
  file: string;
  /** The tags that were written, once each. */
  added: string[];
  /** How many notes of the file were changed. */
  changed: number;
}

export interface TaggingResult {
  /**
   * `excluded` is a file in the list of the files without tagging. `skipped` is a file that is not a text note (binary, unreadable or bigger than 1 MB). `entries` is a Quick Note file whose
   * entries were tagged one by one.
   */
  status: "none" | "unchanged" | "updated" | "added" | "entries" | "skipped" | "excluded";
  /** The tags that were written, once each. */
  added: string[];
  /** How many notes the file has (every Quick Note entry is one) and how many of them were changed. */
  notes: number;
  changed: number;
}

/**
 * "Run Tagging" for notes that already exist, for example after something was changed or added in the editor: the tags
 * the note gets by itself (the tags whose keyword it contains, and the text that matches a tag pattern) are written in
 * its tag line at the top. A tag line that is there is updated with the tags it lacks, otherwise one is added at the start
 * of the note. See `planTagLine`.
 *
 * A note that is open in an editor is changed in the editor (undo works, nothing the user typed is lost), and saved only
 * if it had no unsaved changes. Other notes are read and written with `workspace.fs`. Note contents are never logged.
 */
export class NoteTaggingService implements vscode.Disposable {
  private readonly tagOnSaveEmitter = new vscode.EventEmitter<TagOnSaveResult>();
  private saveSubscription: vscode.Disposable | undefined;

  /** Fires when saving a note wrote tags into it. The commands layer tells the user. */
  readonly onDidTagOnSave = this.tagOnSaveEmitter.event;

  constructor(
    private readonly labels: LabelService,
    private readonly searchService: SearchService,
    private readonly pathGuard: PathGuard,
    private readonly settings: SettingsService,
    private readonly excludeMatcher: ExcludeMatcher,
    private readonly internalSaves: InternalSaves,
    private readonly logger: Logger,
    /** The files and folders that automatic tagging leaves alone (a list of the notes folder). */
    private readonly noTagMatcher: ExcludeMatcher
  ) {}

  /**
   * Starts the tagging that runs when the user saves a note (setting `noteRoot.tagOnSave`, off by default). It joins the
   * save: the tags are part of what is written, so there is no second save, and undo takes them away. It runs only for a
   * save the user asked for (not the automatic save, which would write tags while typing), and not for the saves NoteRoot
   * makes itself.
   */
  start(): void {
    this.saveSubscription ??= vscode.workspace.onWillSaveTextDocument((event) => {
      if (
        !this.settings.tagOnSave ||
        event.reason !== vscode.TextDocumentSaveReason.Manual ||
        this.internalSaves.isActive(event.document.uri)
      ) {
        return;
      }
      event.waitUntil(this.editsForSave(event.document));
    });
  }

  private async editsForSave(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
    try {
      const plan = await this.planOnSave(document);
      if (!plan) {
        return [];
      }
      this.tagOnSaveEmitter.fire({ file: plan.file, added: plan.added, changed: plan.changed });
      return plan.edits;
    } catch (error) {
      // A save must never fail because of the tagging: the note is saved as the user wrote it.
      this.logger.warn(
        `Tagging on save was skipped: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }

  /**
   * What to write into a note that is being saved: the tags of the notes the user changed since the last save (a Quick Note
   * file: only the entries that were changed; any other file is one note). What is on disk is the text of the last save, so
   * the changed stretch is found by comparing the two. Undefined when there is nothing to do: not a note of the notes folder,
   * hidden by the exclude patterns, too big, unchanged, or nothing to tag.
   */
  async planOnSave(
    document: vscode.TextDocument
  ): Promise<
    { edits: vscode.TextEdit[]; added: string[]; changed: number; file: string } | undefined
  > {
    const uri = document.uri;
    if (uri.scheme !== "file" || !this.pathGuard.isInsideRoot(uri, { allowRoot: false })) {
      return undefined;
    }
    const file = this.pathGuard.getRelativePath(uri);
    if (!file || isEncryptedName(file) || this.isHidden(file) || this.isExcludedFromTagging(file)) {
      return undefined;
    }
    const text = document.getText();
    if (text.length > this.settings.maxTextFileBytes) {
      return undefined;
    }
    // A file that is not on disk yet is all new. A BOM is not in the text of an editor, so it is left out of the old text too.
    const saved = (await this.searchService.readText(uri))?.replace(/^\uFEFF/, "");
    const region =
      saved === undefined ? { start: 0, end: text.length } : changedRegion(saved, text);
    if (!region) {
      return undefined;
    }
    const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const tagger = await this.labels.getAutoTagger({
      ignoreAdvanced: true,
      ignorePatternMode: true,
    });
    const plan = planNoteTags(
      text,
      tagger,
      this.settings.quickNoteTagLine,
      eol,
      entryHeadingMatcher(this.settings.quickNoteTimestampFormat),
      region
    );
    if (plan.edits.length === 0) {
      return undefined;
    }
    return {
      edits: plan.edits.map((part) =>
        vscode.TextEdit.replace(
          new vscode.Range(
            document.positionAt(part.offset),
            document.positionAt(part.offset + part.deleteLength)
          ),
          part.insert
        )
      ),
      added: plan.added,
      changed: plan.changed,
      file,
    };
  }

  /** The note, or a folder above it, is in the list of the files without tagging ("Don't Auto-Tag"). */
  isExcludedFromTagging(relativePath: string): boolean {
    const segments = relativePath.split("/");
    return segments.some((segment, index) =>
      this.noTagMatcher.isExcluded(segment, segments.slice(0, index + 1).join("/"))
    );
  }

  /** A file the tree hides (`.noteroot`, `.git`, ...) is not a note: it, or a folder above it, is excluded. */
  private isHidden(relativePath: string): boolean {
    const segments = relativePath.split("/");
    return segments.some((segment, index) =>
      this.excludeMatcher.isExcluded(segment, segments.slice(0, index + 1).join("/"))
    );
  }

  dispose(): void {
    this.saveSubscription?.dispose();
    this.tagOnSaveEmitter.dispose();
  }

  /**
   * @throws OutsideRootError when the note is not inside the notes folder.
   */
  async tagNote(uri: vscode.Uri): Promise<TaggingResult> {
    this.pathGuard.assertInsideRoot(uri, { allowRoot: false });
    const relativePath = this.pathGuard.getRelativePath(uri) ?? uri.path;
    if (isEncryptedName(relativePath)) {
      return { status: "skipped", added: [], notes: 0, changed: 0 };
    }
    if (this.isExcludedFromTagging(relativePath)) {
      this.logger.info(`Run Tagging skipped ${relativePath} (excluded from tagging).`);
      return { status: "excluded", added: [], notes: 0, changed: 0 };
    }
    const open = vscode.workspace.textDocuments.find((doc) => this.pathGuard.isSame(doc.uri, uri));
    const text = open ? open.getText() : await this.searchService.readText(uri);
    if (text === undefined) {
      this.logger.info(`Run Tagging skipped ${relativePath} (not a text note).`);
      return { status: "skipped", added: [], notes: 0, changed: 0 };
    }
    const eol = open
      ? open.eol === vscode.EndOfLine.CRLF
        ? "\r\n"
        : "\n"
      : text.includes("\r\n")
        ? "\r\n"
        : "\n";

    // The user asked for it, so neither the Advanced mode nor the button for the patterns matters: every keyword and every
    // pattern is used. The lists are read once, for all the notes of the file.
    const tagger = await this.labels.getAutoTagger({
      ignoreAdvanced: true,
      ignorePatternMode: true,
    });
    const plan = planNoteTags(
      text,
      tagger,
      this.settings.quickNoteTagLine,
      eol,
      entryHeadingMatcher(this.settings.quickNoteTimestampFormat)
    );
    if (plan.kind === "none" || plan.kind === "unchanged") {
      return { status: plan.kind, added: [], notes: plan.notes, changed: 0 };
    }

    if (open) {
      const wasDirty = open.isDirty;
      const edit = new vscode.WorkspaceEdit();
      // Every replacement is in the coordinates of the text as it is now, so they can all go in one edit.
      for (const part of plan.edits) {
        edit.replace(
          uri,
          new vscode.Range(
            open.positionAt(part.offset),
            open.positionAt(part.offset + part.deleteLength)
          ),
          part.insert
        );
      }
      if (!(await vscode.workspace.applyEdit(edit))) {
        throw new Error("The editor did not accept the edit.");
      }
      // Unsaved changes of the user stay unsaved. A clean file is saved again, as if nothing happened.
      if (!wasDirty && !(await this.internalSaves.during(uri, () => open.save()))) {
        this.logger.warn(
          `The tags were added to ${relativePath} in the editor but the file could not be saved.`
        );
      }
    } else {
      const updated = applyTagEdits(text, plan.edits);
      // Read, change, write: a change made between the read and the write is lost, as with Quick Notes.
      await vscode.workspace.fs.writeFile(uri, encoder.encode(updated));
    }
    this.logger.info(
      `Run Tagging changed ${plan.changed} of ${plan.notes} note(s) in ${relativePath}.`
    );
    return { status: plan.kind, added: plan.added, notes: plan.notes, changed: plan.changed };
  }
}
