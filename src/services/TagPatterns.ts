/**
 * Tag patterns: a pattern such as `ab-*` finds `ab-723126` in a note, and that text becomes the tag `#ab-723126`.
 * What changes, and where it stops, is said with wildcards: `*` is letters, digits, `-` and `_`, `#` is digits only,
 * `@` is letters only, `[0-9.]` lists the characters that are allowed and `[^?,;]` the ones that are not. The match
 * stops at the first character that does not fit its wildcard, so `ab-#` finds just `ab-12345` in `xcc-12345?abc` and in
 * `ab-12345abc`. A match can start anywhere, also inside a longer word. A wildcard never matches white space.
 * Pure on purpose (no VS Code), so the rule can be checked without it. The Quick Note page gets the regular
 * expression sources made here, so the extension and the page use one rule.
 */

/** The one-character wildcards and the characters each one stands for. A wildcard is one or more of them. */
export const WILDCARDS = "*#@";
const WORD_CLASS = "[\\p{L}\\p{N}_-]";
const WILDCARD_CLASS: Record<string, string> = { "*": WORD_CLASS, "#": "\\p{Nd}", "@": "\\p{L}" };
/** A wildcard is never more than this long: no tag is, and it keeps the search fast on a huge note. */
const MAX_WILDCARD_RUN = 100;
/** A pattern needs at least this many fixed characters besides its wildcards, or it would match almost anything. */
export const MIN_PATTERN_LITERALS = 2;
export const MAX_PATTERN_LENGTH = 50;
/** One note never gets more than this many tags from patterns. */
export const MAX_PATTERN_TAGS = 20;

const CONTROL_OR_SPACE = /[\s\u0000-\u001f\u007f]/;

/** A piece of a pattern: fixed text, or a wildcard (`*`, `#`, `@` or a `[...]` list of characters). */
interface PatternToken {
  wildcard: boolean;
  text: string;
}

/** The regular expression class of a wildcard: what one character of it may be. */
function wildcardClass(text: string): string {
  if (text.startsWith("[")) {
    const inner = text.slice(1, -1);
    const negated = inner.startsWith("^");
    const body = (negated ? inner.slice(1) : inner).replace(/[\\^[]/g, "\\$&");
    // A tag has no white space, so a list of characters that are not allowed always excludes it too.
    return negated ? `[^${body}\\s]` : `[${body}]`;
  }
  return WILDCARD_CLASS[text];
}

/**
 * Cuts a pattern into fixed text and wildcards. Undefined when a `[` or `]` is left over, a `[...]` is empty (`[]`, `[^]`)
 * or cannot be a list of characters (a range from high to low, `[z-a]`).
 */
function tokenizePattern(pattern: string): PatternToken[] | undefined {
  const parts = pattern.split(/(\[[^\]\s]*\]|[*#@])/);
  const tokens: PatternToken[] = [];
  for (let index = 0; index < parts.length; index++) {
    const text = parts[index];
    if (text === "") {
      continue;
    }
    const wildcard = index % 2 === 1;
    if (!wildcard && /[[\]]/.test(text)) {
      return undefined;
    }
    if (wildcard && text.startsWith("[")) {
      const inner = text.slice(1, -1);
      if (inner === "" || inner === "^") {
        return undefined;
      }
      try {
        new RegExp(wildcardClass(text), "u");
      } catch {
        return undefined;
      }
    }
    tokens.push({ wildcard, text });
  }
  return tokens;
}

/** @returns a message for `validateInput`, or undefined when the pattern is fine. */
export function validateTagPattern(
  pattern: string,
  existing: readonly string[],
  messages: {
    empty: string;
    tooLong: (max: number) => string;
    invalid: string;
    badList: string;
    noWildcard: string;
    tooFewLiterals: (min: number) => string;
    alreadyThere: (pattern: string) => string;
  }
): string | undefined {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) {
    return messages.empty;
  }
  if (trimmed.length > MAX_PATTERN_LENGTH) {
    return messages.tooLong(MAX_PATTERN_LENGTH);
  }
  if (CONTROL_OR_SPACE.test(trimmed)) {
    return messages.invalid;
  }
  const tokens = tokenizePattern(trimmed);
  if (!tokens) {
    return messages.badList;
  }
  if (tokens.some((token, index) => token.wildcard && tokens[index + 1]?.wildcard)) {
    return messages.invalid;
  }
  if (!tokens.some((token) => token.wildcard)) {
    return messages.noWildcard;
  }
  if (
    tokens.filter((token) => !token.wildcard).reduce((sum, token) => sum + token.text.length, 0) <
    MIN_PATTERN_LITERALS
  ) {
    return messages.tooFewLiterals(MIN_PATTERN_LITERALS);
  }
  const wanted = trimmed.toLowerCase();
  return existing.some((entry) => entry.trim().toLowerCase() === wanted)
    ? messages.alreadyThere(trimmed)
    : undefined;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * The source of the regular expression for a pattern (use it with the flags `giu`). It finds the fixed text of the
 * pattern anywhere, and each wildcard takes as many of its characters as there are (see {@link WILDCARDS}), so
 * `ab-*` finds `ab-723126` in "see ab-723126." and in "xcc-723126?abc", and `ab-#` stops at the last digit in
 * "ab-12345abc". When a pattern starts with a wildcard, the match must start where its characters begin: otherwise
 * every position of a long word would be tried. Undefined for a pattern that is not usable.
 */
export function patternToRegExpSource(pattern: string): string | undefined {
  const trimmed = pattern.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_PATTERN_LENGTH ||
    CONTROL_OR_SPACE.test(trimmed)
  ) {
    return undefined;
  }
  const tokens = tokenizePattern(trimmed);
  if (
    !tokens ||
    !tokens.some((token) => token.wildcard) ||
    tokens.some((token, index) => token.wildcard && tokens[index + 1]?.wildcard) ||
    tokens.filter((token) => !token.wildcard).reduce((sum, token) => sum + token.text.length, 0) <
      MIN_PATTERN_LITERALS
  ) {
    return undefined;
  }
  const body = tokens
    .map((token) =>
      token.wildcard
        ? `${wildcardClass(token.text)}{1,${MAX_WILDCARD_RUN}}`
        : escapeRegExp(token.text)
    )
    .join("");
  return tokens[0].wildcard ? `(?<!${wildcardClass(tokens[0].text)})${body}` : body;
}

/**
 * What one pattern finds in the text: the matched text as written, each once (any case), with the position of its
 * first appearance, in the order they appear. A `-` or `_` right at the end of a match belongs to the sentence
 * (`ab-12-`), not to the tag.
 */
export function findPatternMatches(
  text: string,
  pattern: string
): { name: string; index: number }[] {
  const source = patternToRegExpSource(pattern);
  if (source === undefined) {
    return [];
  }
  const whole = new RegExp(`^${source}$`, "iu");
  const seen = new Set<string>();
  const found: { name: string; index: number }[] = [];
  for (const match of text.matchAll(new RegExp(source, "giu"))) {
    const name = match[0].replace(/[-_]+$/, "");
    const key = name.toLowerCase();
    if (name !== "" && whole.test(name) && !seen.has(key)) {
      seen.add(key);
      found.push({ name, index: match.index ?? 0 });
    }
  }
  return found;
}

/**
 * The tags the patterns find in the note: the matched text itself, as written, each once (any case), in the order
 * they appear, at most `max` (the setting `maxPatternTags`, by default {@link MAX_PATTERN_TAGS}).
 */
export function findPatternTags(
  text: string,
  patterns: readonly string[],
  max: number = MAX_PATTERN_TAGS
): string[] {
  const found: { name: string; at: number }[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    for (const { name, index } of findPatternMatches(text, pattern)) {
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        found.push({ name, at: index });
      }
    }
  }
  return found
    .sort((a, b) => a.at - b.at)
    .slice(0, max)
    .map((entry) => entry.name);
}

/** The ready-made kinds of pattern of "Add Tag Pattern": a prefix that the user types, then digits, letters or anything. */
export type PatternPreset = "number" | "letters" | "anything";

const PRESET_WILDCARD: Record<PatternPreset, string> = { number: "#", letters: "@", anything: "*" };

/** The pattern of a preset: `ab-` and "number" give `ab-#`. */
export function presetPattern(preset: PatternPreset, prefix: string): string {
  return prefix.trim() + PRESET_WILDCARD[preset];
}

/** The prefix of a preset is plain text: letters, digits, `-` and `_`, no wildcard of the pattern syntax. */
export function isValidPrefix(prefix: string): boolean {
  return /^[\p{L}\p{N}_-]+$/u.test(prefix.trim());
}
