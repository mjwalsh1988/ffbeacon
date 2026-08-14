/**
 * The URL slug for a Beacon Brief article.
 *
 * Pulled out of ./worker.ts so it can be tested without importing the queue handler
 * and everything the queue handler talks to. Pure string work, no I/O.
 *
 * WHY THIS IS MORE THAN LOWERCASE-AND-HYPHENATE
 *
 * The input is a string a language model wrote, not a string this codebase built, and
 * the naive version turned every character it did not recognise into a word break. Two
 * live URLs paid for that:
 *
 *   Ja'Kobi Lane  ->  jak-bi-lane-ravens-training-camp
 *
 * The writer had returned a slug that reads as "jakobi-lane-ravens-training-camp" and
 * is not: the o in the name was U+043E, the Cyrillic small letter o. It is a different
 * character from the Latin o that happens to be drawn the same way, so a rule that
 * hyphenates everything outside a-z0-9 read it as punctuation and split the name in
 * half.
 *
 * The same class of bug is one keystroke away for every apostrophe name we cover.
 * "De'Von Achane" only reaches devon-achane because the writer strips the apostrophe
 * itself; the moment it leaves one in, the old rule produced de-von-achane. An
 * apostrophe inside a name is not a word boundary, and neither is an accent.
 *
 * So every character is folded before any hyphenating happens:
 *
 *   1. Accents fold to their base letter, so both spellings of Andre slug the same.
 *   2. Apostrophes are DELETED rather than replaced, matching how normalizeName in
 *      lib/beam/interpret/normalize.ts treats the same names on the search side.
 *   3. Cyrillic and Greek letters drawn like Latin ones map to the letter they are
 *      drawn as. A model reaching for a lookalike meant the letter it looks like;
 *      there is no reading where the reader wanted a Cyrillic o in a URL.
 *
 * Anything still outside a-z0-9 after that is a genuine separator and hyphenates.
 *
 * EVERY NON-ASCII CHARACTER HERE IS A CODEPOINT NUMBER, never a literal. A source
 * file that carries lookalike letters as literals is a file where this bug is
 * invisible in review, which is how it shipped the first time.
 */

/** Longest slug we will emit. Long enough for a headline, short enough for a URL. */
const MAX_SLUG_LENGTH = 80;

/** Used when the input folds away to nothing at all. */
const FALLBACK_SLUG = "beacon-brief";

/** Combining accent marks, left behind by the NFKD split. */
const COMBINING_FIRST = 0x0300;
const COMBINING_LAST = 0x036f;

/**
 * Every apostrophe a writer might produce: straight, both curly forms, the two
 * modifier letters Unicode prefers inside names, a backtick, and an acute accent
 * typed as one. All of them vanish rather than becoming a hyphen.
 */
const APOSTROPHES = new Set([
  0x0027, // '
  0x2018, // left single quotation mark
  0x2019, // right single quotation mark
  0x02bc, // modifier letter apostrophe
  0x02bb, // modifier letter turned comma
  0x0060, // grave accent used as an apostrophe
  0x00b4, // acute accent used as an apostrophe
]);

/** The Cyrillic and Greek blocks. Anything in here is checked against LOOKALIKES. */
const CYRILLIC_FIRST = 0x0400;
const CYRILLIC_LAST = 0x04ff;
const GREEK_FIRST = 0x0370;
const GREEK_LAST = 0x03ff;

/**
 * Non-Latin letters that are drawn like Latin ones, mapped to what they look like.
 *
 * Deliberately visual rather than phonetic. Cyrillic ve (U+0432) is a v sound and a
 * Latin b shape; a model that emitted it inside an English word was drawing a b.
 * Lowercase codepoints only, because the fold runs after toLowerCase. Anything in
 * those blocks that is not listed becomes a separator, which is the right answer for
 * text that is genuinely not Latin.
 */
const LOOKALIKES = new Map<number, string>([
  [0x0430, "a"], // Cyrillic a
  [0x0432, "b"], // Cyrillic ve
  [0x0435, "e"], // Cyrillic ie
  [0x043a, "k"], // Cyrillic ka
  [0x043c, "m"], // Cyrillic em
  [0x043d, "h"], // Cyrillic en
  [0x043e, "o"], // Cyrillic o, the one that broke Ja'Kobi Lane
  [0x0440, "p"], // Cyrillic er
  [0x0441, "c"], // Cyrillic es
  [0x0442, "t"], // Cyrillic te
  [0x0443, "y"], // Cyrillic u
  [0x0445, "x"], // Cyrillic ha
  [0x0456, "i"], // Cyrillic byelorussian-ukrainian i
  [0x0458, "j"], // Cyrillic je
  [0x0455, "s"], // Cyrillic dze
  [0x03b1, "a"], // Greek alpha
  [0x03b5, "e"], // Greek epsilon
  [0x03b9, "i"], // Greek iota
  [0x03ba, "k"], // Greek kappa
  [0x03bc, "m"], // Greek mu
  [0x03bd, "v"], // Greek nu
  [0x03bf, "o"], // Greek omicron
  [0x03c1, "p"], // Greek rho
  [0x03c4, "t"], // Greek tau
  [0x03c5, "u"], // Greek upsilon
  [0x03c7, "x"], // Greek chi
]);

/** One character in, its Latin reading out. Empty string means "not a separator". */
function foldCharacter(char: string): string {
  const cp = char.codePointAt(0) ?? 0;
  if (cp >= COMBINING_FIRST && cp <= COMBINING_LAST) return "";
  if (APOSTROPHES.has(cp)) return "";
  const lookalike = LOOKALIKES.get(cp);
  if (lookalike) return lookalike;
  const nonLatin =
    (cp >= CYRILLIC_FIRST && cp <= CYRILLIC_LAST) ||
    (cp >= GREEK_FIRST && cp <= GREEK_LAST);
  return nonLatin ? " " : char;
}

export function slugify(input: string): string {
  // NFKD splits an accented letter into its base plus a combining mark, and
  // foldCharacter drops the mark, so the base letter survives.
  const folded = Array.from(
    input.normalize("NFKD").toLowerCase(),
    foldCharacter,
  ).join("");

  const hyphenated = folded
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    // Trimmed again after the cut: slicing mid-word leaves the hyphen that preceded
    // the word we just removed sitting on the end.
    .replace(/-+$/g, "");

  return hyphenated || FALLBACK_SLUG;
}
