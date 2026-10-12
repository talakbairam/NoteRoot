/**
 * Where the content of a note file starts: after a BOM, after a YAML front matter block (`---` ... `---`) and after the header
 * of the note, an HTML comment block (`<!-- ... -->`) that is the first thing there, each with the blank lines that follow it.
 * `prefix` is what has to be put in front of something inserted there so that a blank line separates it from the block before
 * (empty when there is none, or it is followed by a blank line already). `comment` is the text of that HTML comment block.
 * Pure on purpose, shared by the Quick Note writer, the tagging and the header.
 * @param skipComment false stops before the comment block: the header itself is inserted there.
 */
export function startOfNote(
  existing: string,
  eol: "\n" | "\r\n",
  skipComment = true
): { offset: number; prefix: string; comment?: string } {
  let offset = existing.startsWith("﻿") ? 1 : 0;
  let prefix = "";
  let comment: string | undefined;

  // Skips a block of `length` characters that starts at `offset`, and the blank lines after it.
  const skip = (length: number): void => {
    offset += length;
    const endsLine = existing[offset - 1] === "\n";
    const blankLines = /^(?:[ \t]*\r?\n)*/.exec(existing.slice(offset));
    if (blankLines && blankLines[0].length > 0) {
      offset += blankLines[0].length; // The block is already followed by a blank line.
      prefix = "";
    } else {
      prefix = endsLine ? eol : eol + eol; // Blank line after it (and its missing line end).
    }
  };

  const frontMatter = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(
    existing.slice(offset)
  );
  if (frontMatter) {
    skip(frontMatter[0].length);
  }
  if (skipComment) {
    const block = /^(?:[ \t]*\r?\n)*(<!--[\s\S]*?-->)[ \t]*(?:\r?\n|$)/.exec(
      existing.slice(offset)
    );
    if (block) {
      comment = block[1];
      skip(block[0].length);
    }
  }
  return { offset, prefix, comment };
}
