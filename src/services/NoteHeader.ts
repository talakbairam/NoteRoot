import { startOfNote } from "./NoteStart";

/**
 * The header of a note: a template of lines (a setting of the notes folder), usually an HTML comment with fields to fill in,
 * for example `<!--`, `  **Summary:** `, `  **Jira:** `, `  **Comment:** `, `-->`. It sits at the very start of a file, after a
 * BOM and a YAML front matter block. The functions are pure, so the rules live in one place.
 */

/** The block as written into a file: every line, each closed by a line ending. Empty when there is no template. */
export function headerBlock(lines: readonly string[], eol: "\n" | "\r\n"): string {
  return lines.length === 0 ? "" : lines.join(eol) + eol;
}

/**
 * The names of the fields of a template: the text before the first colon of a line, without `*` and spaces, in lower case
 * (`**Summary:** ` gives `summary`). Lines that only open or close the comment have none.
 */
export function headerFields(lines: readonly string[]): string[] {
  const fields: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "<!--" || trimmed === "-->") {
      continue;
    }
    const match = /^[*_\s]*([^:*]+?)[*_\s]*:/.exec(trimmed);
    if (match) {
      fields.push(match[1].trim().toLowerCase());
    }
  }
  return fields;
}

/**
 * True when the text already starts with the header: after the BOM and the front matter there is an HTML comment that has every
 * field of the template (what is written after the fields does not matter). A template without fields is compared line by line.
 */
export function hasHeader(existing: string, lines: readonly string[]): boolean {
  if (lines.length === 0) {
    return false;
  }
  const { comment } = startOfNote(existing, "\n");
  if (comment === undefined) {
    return false;
  }
  const fields = headerFields(lines);
  if (fields.length === 0) {
    const normalize = (text: readonly string[]): string =>
      text.map((line) => line.trim()).join("\n");
    return normalize(comment.split(/\r?\n/)) === normalize(lines);
  }
  const lower = comment.toLowerCase();
  return fields.every((field) =>
    new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(field)}[*_\\s]*:`, "u").test(lower)
  );
}

/**
 * Where and what to insert to put the header at the start of a note, or undefined when there is no template or the text has the
 * header already. An empty file just gets the block. Otherwise the block goes in front of the old content with one blank line
 * between them, after a BOM and a front matter block (and not after another HTML comment: the header comes first).
 */
export function planHeader(
  existing: string,
  lines: readonly string[],
  eol: "\n" | "\r\n"
): { offset: number; text: string } | undefined {
  if (lines.length === 0 || hasHeader(existing, lines)) {
    return undefined;
  }
  const { offset, prefix } = startOfNote(existing, eol, false);
  const rest = existing.slice(offset);
  return { offset, text: prefix + headerBlock(lines, eol) + (rest.trim().length > 0 ? eol : "") };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Where the date and tags block (`head`, from `buildEntryHead`) goes relative to the line the cursor is on. On an empty line it
 * goes at the start of that line. On a line with text it goes at the end of that line, after a blank line; before more text the
 * block loses its last line ending, because the line that follows already supplies it, so there is one blank line after it.
 */
export function planEntryInsertion(
  lineIsBlank: boolean,
  isLastLine: boolean,
  head: string,
  eol: "\n" | "\r\n"
): { at: "lineStart" | "lineEnd"; text: string } {
  if (lineIsBlank) {
    return { at: "lineStart", text: head };
  }
  return {
    at: "lineEnd",
    text: eol + eol + (isLastLine ? head : head.slice(0, head.length - eol.length)),
  };
}
