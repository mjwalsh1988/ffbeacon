/**
 * The Beacon Brief keyword pre-filter.
 *
 * The first of three gates. This one catches other sports by literal string
 * match; the AI non_football flag catches them by classification; the relevance
 * tier catches football news that carries no fantasy decision (see ./curate.ts).
 * String matching cannot express the third case, so do not grow this blocklist to
 * chase it: broad terms here produce false positives on real NFL posts.
 *
 * Before any AI call, a new post is
 * checked against an admin-editable blocklist (bb_keyword_filter). A hit diverts
 * the post to the Filtered review queue instead of Discord or an article.
 *
 * Matching is whole-word / whole-phrase and case-insensitive, so "nba" does not
 * match inside another word and a multi-word entry like "world cup" matches the
 * phrase (with any run of whitespace between the words). Boundaries are any
 * non-letter, non-number character (or start/end of text), so "f1" will not match
 * inside "f150" and a leading "@" or "#" does not block a match.
 */

/** Split the raw comma-separated blocklist into trimmed, non-empty terms. */
export function parseBlocklist(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function escapeRegExp(term: string): string {
  // Escape regex metacharacters, then let any internal whitespace match a run of
  // whitespace so "formula 1" matches "formula  1" too.
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

/**
 * Return the blocklist terms that appear in the text as whole words/phrases.
 * Case-insensitive; the returned terms keep their original blocklist casing and
 * are de-duplicated. An empty result means nothing matched.
 */
export function matchBlockedKeywords(
  text: string,
  blocklist: string[],
): string[] {
  if (!text || blocklist.length === 0) return [];
  const matched: string[] = [];
  const seen = new Set<string>();
  for (const term of blocklist) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    const escaped = escapeRegExp(term);
    if (!escaped) continue;
    // Unicode-aware boundaries: the match must not be flanked by a letter or a
    // number. Lookbehind/lookahead keep the boundary out of the match itself.
    let re: RegExp;
    try {
      re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
    } catch {
      continue;
    }
    if (re.test(text)) {
      matched.push(term);
      seen.add(key);
    }
  }
  return matched;
}
