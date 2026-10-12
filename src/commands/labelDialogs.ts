import * as vscode from "vscode";
import { Commands } from "../constants/commands";
import { Strings } from "../constants/strings";
import { LabelService, type LabelKind } from "../services/LabelService";

/** The questions asked when a category or tag is created or renamed. Shared by the Quick Note box and the manager. */

export interface NewLabel {
  name: string;
  /** Only for a category: the file its notes go to. Without it the category uses the Quick Note file. */
  file?: string;
}

/**
 * Asks for the name of a new category or tag. A category is then linked to a file, so its notes can
 * be kept apart; cancelling at any step cancels the whole creation.
 * @param existingNames the names that exist already, for the duplicate check while typing.
 * @param initialName what the user already typed in the box, to start the question with.
 */
export async function askNewLabel(
  labelService: LabelService,
  kind: LabelKind,
  existingNames: readonly string[],
  initialName?: string
): Promise<NewLabel | undefined> {
  const text = Strings.quickNote;
  const name = await vscode.window.showInputBox({
    title: kind === "category" ? text.createCategoryTitle : text.createTagTitle,
    value: initialName,
    prompt: kind === "category" ? text.createCategoryPrompt : text.createTagPrompt,
    validateInput: (value) => labelService.validateName(value, existingNames),
  });
  if (name === undefined) {
    return undefined;
  }
  if (kind === "tag") {
    return { name };
  }
  const file = await askCategoryFile(
    text.categoryFileTitle(name.trim()),
    LabelService.suggestFileName(name)
  );
  return file === undefined ? undefined : { name, file: file ?? undefined };
}

/**
 * Asks which file a category writes to: an existing note, a new note (typed, with a suggestion) or no
 * separate file. Returns the path, null for "no separate file", and undefined when cancelled.
 */
export function askCategoryFile(
  title: string,
  suggestion: string
): Thenable<string | null | undefined> {
  return vscode.commands.executeCommand<string | null | undefined>(Commands.pickNoteFile, {
    title,
    suggestion,
    allowNone: true,
  });
}

/** Asks for another name for a category or tag. Undefined when cancelled or when the name is unchanged. */
export async function askNewName(
  labelService: LabelService,
  kind: LabelKind,
  current: string,
  existingNames: readonly string[]
): Promise<string | undefined> {
  const text = Strings.quickNote;
  const typed = await vscode.window.showInputBox({
    title: text.renameTitle(kind, current),
    prompt: text.renamePrompt,
    value: current,
    // The entry itself is not a duplicate of itself, so a change of case only is allowed.
    validateInput: (value) =>
      labelService.validateName(
        value,
        existingNames.filter((name) => name !== current)
      ),
  });
  const trimmed = typed?.trim();
  return trimmed === undefined || trimmed === current ? undefined : trimmed;
}
