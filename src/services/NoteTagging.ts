import { formatTag, startOfNote } from "./QuickNoteService";

export interface TagEdit {
  /** Where the replacement starts, how many characters it replaces (0 for an insertion) and what it puts there. */
  offset: number;
  deleteLength: number;
  insert: string;
}

/** What to do to a note so that its tag line has the wanted tags. One replacement of a piece of text. */
export interface TagLinePlan extends TagEdit {
  /**
   * - `none`: no tag line, and nothing to add.
   * - `unchanged`: the tag line has all the wanted tags already.
   * - `updated`: the tag line at the top gets the tags it lacks.
   * - `added`: there was no tag line at the top, a new one goes to the start of the note.
   */
  kind: "none" | "unchanged" | "updated" | "added";
  /** The tags that were not in the tag line and are written now. */
  added: string[];
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PLACEHOLDER = "{tags}";

/**
 * Finds the line that carries the tags and reads its tags (`#a #b`). The line is the tag line template with the tags in
 * place of `{tags}` (so `**Tags:** #a #b` for the default template); white space at the end is allowed. A line with
 * no tags yet (`**Tags:**`, with or without the space after it) is a tag line as well, when the template has some text
 * of its own to recognise it by: it is the place the tags go. With the template `{tags}` alone an empty line is just an
 * empty line. The tags are in the first group, which is missing for a line without tags.
 */
function tagLineMatcher(template: string): RegExp {
  const at = template.indexOf(PLACEHOLDER);
  const before = template.slice(0, at);
  const after = template.slice(at + PLACEHOLDER.length);
  const tags = "#\\S+(?: +#\\S+)*";
  const canBeEmpty = before.trim() !== "" || after.trim() !== "";
  // A space (or more) between the text before and the tags, when the template has one; none for `[{tags}]`.
  const separator = /\s$/.test(before) ? "[ \\t]+" : "";
  // Without tags that space is not needed (an editor may have removed it).
  const body = canBeEmpty
    ? `${escapeRegExp(before.trimEnd())}(?:${separator}(${tags}))?${escapeRegExp(after)}`
    : `${escapeRegExp(before)}(${tags})${escapeRegExp(after)}`;
  return new RegExp(`^${body}[ \\t]*$`);
}

/**
 * Plans the tag line of a note, the way the "Run Tagging" action needs it: the tag line is the first line of the note
 * (after a BOM, a front matter block and blank lines). When it is there it is updated with the wanted tags it lacks
 * (the tags already in it stay as they are, and in their place); when it is not, a new tag line is added at the start of
 * the note. A note whose first line is a heading, such as the `## date` of a Quick Note, has no tag line at the top.
 * Pure, so it can be checked without VS Code.
 * @param wanted tag names without `#`.
 */
export function planTagLine(
  existing: string,
  wanted: readonly string[],
  template: string,
  eol: "\n" | "\r\n"
): TagLinePlan {
  const none = (kind: TagLinePlan["kind"]): TagLinePlan => ({
    kind,
    offset: 0,
    deleteLength: 0,
    insert: "",
    added: [],
  });
  const { offset: start, prefix } = startOfNote(existing, eol);

  // The first line with something in it, after the blank lines at the start.
  const blank = /^(?:[ \t]*\r?\n)*/.exec(existing.slice(start));
  const lineStart = start + (blank ? blank[0].length : 0);
  const lineEnd = (() => {
    const newline = existing.indexOf("\n", lineStart);
    return newline < 0 ? existing.length : newline;
  })();
  const line = existing.slice(lineStart, lineEnd).replace(/\r$/, "");
  const found = tagLineMatcher(template).exec(line);

  const unique = (names: readonly string[]): string[] => {
    const seen = new Set<string>();
    return names.filter((name) =>
      seen.has(name.toLowerCase()) ? false : (seen.add(name.toLowerCase()), true)
    );
  };
  const wantedNames = unique(wanted.filter((name) => formatTag(name) !== ""));

  if (found) {
    const present = (found[1] ?? "").split(/ +/).filter(Boolean);
    const presentKeys = new Set(present.map((tag) => tag.slice(1).toLowerCase()));
    const missing = wantedNames.filter(
      (name) => !presentKeys.has(formatTag(name).slice(1).toLowerCase())
    );
    if (missing.length === 0) {
      return none("unchanged");
    }
    const all = [...present, ...missing.map((name) => formatTag(name))];
    return {
      kind: "updated",
      offset: lineStart,
      deleteLength: line.length,
      insert: template.replace(PLACEHOLDER, () => all.join(" ")),
      added: missing,
    };
  }

  if (wantedNames.length === 0) {
    return none("none");
  }
  const text = template.replace(PLACEHOLDER, () =>
    wantedNames.map((name) => formatTag(name)).join(" ")
  );
  const rest = existing.slice(start);
  return {
    kind: "added",
    offset: start,
    deleteLength: 0,
    insert: prefix + text + eol + (rest.length > 0 ? eol : ""),
    added: wantedNames,
  };
}

/** The tag line at the top of a text (see {@link planTagLine}), with where it is, or undefined. */
function findTopTagLine(
  text: string,
  template: string
): { lineStart: number; lineEnd: number; start: number } | undefined {
  const { offset: start } = startOfNote(text, "\n");
  const blank = /^(?:[ \t]*\r?\n)*/.exec(text.slice(start));
  const lineStart = start + (blank ? blank[0].length : 0);
  const newline = text.indexOf("\n", lineStart);
  const lineEnd = newline < 0 ? text.length : newline;
  const line = text.slice(lineStart, lineEnd).replace(/\r$/, "");
  return tagLineMatcher(template).test(line)
    ? { lineStart, lineEnd: lineStart + line.length, start }
    : undefined;
}

/** The text without its tag line at the top, so that the tags already written do not decide which tags the text gets. */
function withoutTopTagLine(text: string, template: string): string {
  const found = findTopTagLine(text, template);
  return found ? text.slice(0, found.lineStart) + text.slice(found.lineEnd) : text;
}

const escapeForPattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The regular expression for the heading of a Quick Note entry: a line with the date and time in the format of the
 * `quickNoteTimestampFormat` setting (`YYYY MM DD HH mm ss` stand for digits), with or without `#` marks in front. It is
 * what tells the notes of a Quick Note file apart. Undefined when the format is empty or has no digit token, because then
 * the entries cannot be told apart.
 */
export function entryHeadingMatcher(format: string): RegExp | undefined {
  if (!/YYYY|MM|DD|HH|mm|ss/.test(format)) {
    return undefined;
  }
  const body = format
    .split(/(YYYY|MM|DD|HH|mm|ss)/)
    .map((part) =>
      part === "YYYY"
        ? "\\d{4}"
        : /^(MM|DD|HH|mm|ss)$/.test(part)
          ? "\\d{2}"
          : escapeForPattern(part)
    )
    .join("");
  return new RegExp(`^(?:#{1,6}[ \\t]+)?${body}[ \\t]*$`);
}

/** A stretch of the text, as offsets: where a change starts and ends in the new text. */
export interface TagRegion {
  start: number;
  end: number;
}

/**
 * Where a text was changed: from the first character that differs to the last one, found from both ends. Several changes
 * far apart give one stretch that covers them all. Undefined when nothing changed. A deletion has a region of no length.
 */
export function changedRegion(before: string, after: string): TagRegion | undefined {
  if (before === after) {
    return undefined;
  }
  const shortest = Math.min(before.length, after.length);
  let start = 0;
  while (start < shortest && before[start] === after[start]) {
    start++;
  }
  let suffix = 0;
  while (
    suffix < shortest - start &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }
  return { start, end: after.length - suffix };
}

/** True when the region reaches the stretch `[start, end]`, the ends included (a change right at an edge belongs to it). */
const touches = (region: TagRegion, start: number, end: number): boolean =>
  region.start <= end && region.end >= start;

/** True when the whole region is inside the stretch: the user only changed that line. */
const insideOf = (region: TagRegion, start: number, end: number): boolean =>
  region.start >= start && region.end <= end;

export interface NoteTagPlan {
  /** The replacements, to apply from the last to the first (or all at once, they never overlap). */
  edits: TagEdit[];
  /** How many notes the text has (a text without Quick Note entries is one note) and how many of them change. */
  notes: number;
  changed: number;
  /** The tags that are written, once each (any case). */
  added: string[];
  /** `entries`: a Quick Note file, every entry on its own. */
  kind: "none" | "unchanged" | "updated" | "added" | "entries";
}

/**
 * Plans Run Tagging for a whole file. A file whose notes are Quick Note entries (lines with the date heading, see
 * {@link entryHeadingMatcher}) is tagged entry by entry: the tag line below each heading gets the tags that entry's own text
 * earns and lacks, an entry without a tag line gets one below its heading (as the Quick Note writes it), and the text before
 * the first heading is one more note, tagged like a file without entries. Any other file is one note: see {@link planTagLine}.
 * Pure, so it can be checked without VS Code.
 * @param tagger gives the tags for a text (see `LabelService.getAutoTagger`).
 * @param region when given, only the notes that this region of the text reaches are tagged (tagging a file when it is
 *   saved: the entries that were changed), and a note is left alone when the region is only inside its own tag line, so
 *   a tag the user took away by hand does not come back. Without it every note is tagged.
 */
export function planNoteTags(
  existing: string,
  tagger: (text: string) => string[],
  template: string,
  eol: "\n" | "\r\n",
  heading: RegExp | undefined,
  region?: TagRegion
): NoteTagPlan {
  // Where each line starts, to find the heading lines.
  const headings: { start: number; end: number; next: number }[] = [];
  if (heading) {
    let position = 0;
    while (position < existing.length) {
      const newline = existing.indexOf("\n", position);
      const next = newline < 0 ? existing.length : newline + 1;
      const end = newline < 0 ? existing.length : newline;
      if (heading.test(existing.slice(position, end).replace(/\r$/, ""))) {
        headings.push({ start: position, end, next });
      }
      position = next;
    }
  }

  const addedTags: string[] = [];
  const remember = (names: readonly string[]): void => {
    for (const name of names) {
      if (!addedTags.some((tag) => tag.toLowerCase() === name.toLowerCase())) {
        addedTags.push(name);
      }
    }
  };

  if (headings.length === 0) {
    const topLine = findTopTagLine(existing, template);
    if (region && topLine && insideOf(region, topLine.lineStart, topLine.lineEnd)) {
      return { edits: [], notes: 1, changed: 0, added: [], kind: "unchanged" };
    }
    const plan = planTagLine(
      existing,
      tagger(withoutTopTagLine(existing, template)),
      template,
      eol
    );
    const changed = plan.kind === "updated" || plan.kind === "added";
    return {
      edits: changed ? [plan] : [],
      notes: 1,
      changed: changed ? 1 : 0,
      added: plan.added,
      kind: plan.kind,
    };
  }

  const edits: TagEdit[] = [];
  // The text before the first entry is a note of its own.
  const preamble = existing.slice(0, headings[0].start);
  const preambleLine = findTopTagLine(preamble, template);
  const preambleChanged =
    !region ||
    (touches(region, 0, headings[0].start) &&
      !(preambleLine && insideOf(region, preambleLine.lineStart, preambleLine.lineEnd)));
  const preamblePlan = preambleChanged
    ? planTagLine(preamble, tagger(withoutTopTagLine(preamble, template)), template, eol)
    : { kind: "unchanged" as const, added: [] as string[], offset: 0, deleteLength: 0, insert: "" };
  if (preamblePlan.kind === "updated" || preamblePlan.kind === "added") {
    edits.push(preamblePlan);
    remember(preamblePlan.added);
  }

  headings.forEach((entry, index) => {
    const bodyStart = entry.next;
    const bodyEnd = index + 1 < headings.length ? headings[index + 1].start : existing.length;
    if (region && !touches(region, entry.start, bodyEnd)) {
      return; // The entry was not changed.
    }
    const body = existing.slice(bodyStart, bodyEnd);
    const blank = /^(?:[ \t]*\r?\n)*/.exec(body);
    const blankLength = blank ? blank[0].length : 0;
    const contentStart = bodyStart + blankLength;
    if (body.slice(blankLength).trim() === "") {
      return; // An entry with nothing in it has nothing to tag.
    }
    const newline = existing.indexOf("\n", contentStart);
    const lineEnd = newline < 0 || newline > bodyEnd ? bodyEnd : newline;
    const line = existing.slice(contentStart, lineEnd).replace(/\r$/, "");
    const found = tagLineMatcher(template).exec(line);
    if (found && region && insideOf(region, contentStart, contentStart + line.length)) {
      return; // Only the tag line was changed, by hand: it is left as the user wrote it.
    }
    const textOfEntry = found
      ? existing.slice(bodyStart, contentStart) +
        existing.slice(contentStart + line.length, bodyEnd)
      : body;
    const wanted = tagger(textOfEntry);
    if (found) {
      const sub = planTagLine(line, wanted, template, eol);
      if (sub.kind === "updated") {
        edits.push({
          offset: contentStart + sub.offset,
          deleteLength: sub.deleteLength,
          insert: sub.insert,
        });
        remember(sub.added);
      }
      return;
    }
    const names = wanted.filter((name) => formatTag(name) !== "");
    if (names.length === 0) {
      return;
    }
    const unique = names.filter(
      (name, at) => names.findIndex((other) => other.toLowerCase() === name.toLowerCase()) === at
    );
    const text = template.replace(PLACEHOLDER, () =>
      unique.map((name) => formatTag(name)).join(" ")
    );
    // As the Quick Note writes it: the heading, a blank line, the tag line, a blank line, the text.
    edits.push({
      offset: contentStart,
      deleteLength: 0,
      insert: (blankLength === 0 ? eol : "") + text + eol + eol,
    });
    remember(unique);
  });

  return {
    edits,
    // The text before the first entry is a note only when it has something besides its own tag line.
    notes: headings.length + (withoutTopTagLine(preamble, template).trim() === "" ? 0 : 1),
    changed: edits.length,
    added: addedTags,
    kind: edits.length > 0 ? "entries" : "unchanged",
  };
}

/** The text with the edits applied. They never overlap, so the order does not matter; the last one is done first. */
export function applyTagEdits(text: string, edits: readonly TagEdit[]): string {
  return [...edits]
    .sort((a, b) => b.offset - a.offset)
    .reduce(
      (result, edit) =>
        result.slice(0, edit.offset) + edit.insert + result.slice(edit.offset + edit.deleteLength),
      text
    );
}
