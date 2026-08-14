/**
 * Turn what a person typed into a canonical string BEAM can reason about.
 *
 * The output has to match players.search_name exactly (migration 0194) for the
 * resolver's exact-match tiers to fire, so the rules here mirror that generated
 * column: lower-case, drop everything that is not a letter, digit, or space,
 * collapse whitespace. Anything that diverges from the column breaks tier 2
 * silently, which is the worst kind of bug because the fuzzy tier quietly covers
 * for it at lower confidence.
 *
 * Two things happen BEFORE that, and only here:
 *   - Accents fold, so an accented "e" and a plain "e" are the same letter.
 *   - Possessives collapse, so "purdys" and "purdy's" both become "purdy". This
 *     runs before punctuation is stripped, because after stripping there is no
 *     apostrophe left to tell "purdys" (possessive) from "chases" (a real name
 *     ending in s). We only strip a trailing "'s", never a bare "s".
 */

/**
 * Combining diacritical marks (U+0300 to U+036F): what NFKD splits an accented
 * letter into. Written as escapes, not literals, so this file stays pure ASCII.
 */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Curly apostrophe, modifier letter apostrophe, backtick, and acute accent, all
 * of which people's keyboards and phones produce in place of a straight quote.
 *
 * Escapes rather than literals on purpose. This project bans typographic
 * characters from source, and a regex that has to MATCH them is exactly the case
 * where an escape says what is meant without putting one in the file.
 */
const APOSTROPHES = /[\u2019\u02bc`\u00b4]/g;

const CONTRACTIONS: ReadonlyArray<[RegExp, string]> = [
  [/\bwhat's\b/g, "what is"],
  [/\bwho's\b/g, "who is"],
  [/\bhow's\b/g, "how is"],
  [/\bwhere's\b/g, "where is"],
  // The same contractions with the apostrophe left out, which is how they are
  // typed on a phone more often than not. Without these, "whats ppr" has no
  // question head at all and "whats" glues itself to "ppr", so BEAM went looking
  // for a glossary entry called "whats ppr". None of these four is a name or a
  // word in any other vocabulary, so expanding them can only help.
  [/\bwhats\b/g, "what is"],
  [/\bwhos\b/g, "who is"],
  [/\bhows\b/g, "how is"],
  [/\bwheres\b/g, "where is"],
  [/\bthat's\b/g, "that is"],
  [/\bit's\b/g, "it is"],
  [/\bdoesn't\b/g, "does not"],
  [/\bdidn't\b/g, "did not"],
  [/\bisn't\b/g, "is not"],
  [/\bwasn't\b/g, "was not"],
  [/\bi'm\b/g, "i am"],
  [/\bi've\b/g, "i have"],
  [/\bshould've\b/g, "should have"],
  [/\bwould've\b/g, "would have"],
];

/**
 * Normalize a whole question. Also used on a single name span before it reaches
 * the resolver, so both sides of an exact-match comparison went through the same
 * function.
 */
export function normalizeText(input: string): string {
  // NFKD splits an accented letter into base + combining mark; dropping the
  // marks leaves the base letter.
  let s = input.normalize("NFKD").replace(COMBINING_MARKS, "");
  s = s.replace(APOSTROPHES, "'");
  s = s.toLowerCase();

  for (const [pattern, replacement] of CONTRACTIONS) {
    s = s.replace(pattern, replacement);
  }

  // Possessive, while the apostrophe still exists to identify it.
  s = s.replace(/'s\b/g, "");

  // A hyphen BETWEEN DIGITS is a range, so it becomes a space before the rule
  // below deletes it. "weeks 2-8" would otherwise normalize to "weeks 28", a
  // week that does not exist, and the question would quietly lose its range. No
  // stored player name contains a digit, so this cannot affect a name.
  s = s.replace(/(\d)\s*-\s*(\d)/g, "$1 $2");

  // Intra-word punctuation is DELETED, not spaced, because players.search_name
  // deletes it: the generated column strips [^a-zA-Z0-9 ] to nothing, so
  // "A.J. Brown" is stored as "aj brown". Spacing these instead would produce
  // "a j brown", which exact-matches nothing and silently demotes every
  // initials-name player to the fuzzy tier.
  s = s.replace(/['.\-]/g, "");

  // Everything else that is not a letter, digit, or space becomes a space, so
  // "purdy/lamb" and "purdy, lamb" split into two words rather than fusing.
  // Those characters never appear in a stored name, so the two rules cannot
  // disagree about a real player.
  s = s.replace(/[^a-z0-9 ]+/g, " ");

  return s.replace(/\s+/g, " ").trim();
}

/**
 * Normalize a candidate player name to the exact shape players.search_name
 * holds. Deliberately a separate export from normalizeText even though the body
 * is the same call: the two have different contracts, and if search_name's
 * definition ever changes this is the one that has to follow it.
 */
export function normalizeName(input: string): string {
  return normalizeText(input);
}
