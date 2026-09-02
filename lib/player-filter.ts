/**
 * Matching a typed fragment against a player's name.
 *
 * Pulled out of components/player-picker.tsx so it can be tested without a DOM.
 * Everything here is pure: strings in, booleans out, no React and no clock.
 *
 * This is a CLIENT-SIDE filter over a list the page already holds. It is not
 * lib/player-search.ts, which asks the database which players exist; by the time
 * anything here runs the candidates are already decided and the only question is
 * which of them answer to what somebody typed.
 */

/**
 * Punctuation that lives INSIDE a name rather than between two of them.
 *
 * Apostrophe (straight and curly, because a name arrives from Sleeper however
 * Sleeper stores it), full stop, and hyphen. Written as escapes so this file
 * stays plain ASCII.
 */
const INTRA_WORD_PUNCTUATION = /['\u2018\u2019.\-]+/g;

/**
 * One name, in the two forms a search has to be able to hit.
 *
 * THIS IS THE BUG THIS COMPONENT SHIPPED WITH, and it is worth naming precisely
 * because the file's own header claimed the opposite. There was one normalized
 * form and it turned every punctuation mark into a SPACE, so "Ja'Marr Chase"
 * was stored as "ja marr chase". A reader typing the name the way it sounds,
 * "jamarr", produced the term "jamarr", which appears nowhere in "ja marr", and
 * the list came back empty for a player sitting two rows down. The same failure
 * hit D'Andre Swift, De'Von Achane, Amon-Ra St. Brown and every hyphenated
 * surname in the league, which is a large share of the names anybody actually
 * searches for.
 *
 * A space is right for a mark BETWEEN two words ("(WR, CIN)" has to become "wr
 * cin") and wrong for one INSIDE one. There is no single answer, so both are
 * kept:
 *
 *   loose  every mark becomes a space.  "ja marr chase wr cin"
 *   tight  intra-word marks vanish.     "jamarr chase wr cin"
 *
 * A term matches if it is in either. "ja marr" finds him through the first,
 * "jamarr" through the second, and neither reading is preferred over the other,
 * because both are how a real person types a real name.
 */
export type Haystack = { loose: string; tight: string };

function tidy(text: string): string {
  return text
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeParts(text: string): Haystack {
  const base = text
    .toLowerCase()
    .normalize("NFD")
    // The combining marks NFD just split off. Escaped rather than written
    // literally so this file stays plain ASCII, and stripped BEFORE the general
    // cleanup below, which would otherwise turn each mark into a space and cut
    // an accented name in half.
    .replace(/\p{M}/gu, "");
  return {
    loose: tidy(base),
    tight: tidy(base.replace(INTRA_WORD_PUNCTUATION, "")),
  };
}

/** The two readings of what the reader typed, as word lists. */
export function queryTerms(query: string): { loose: string[]; tight: string[] } {
  const parts = normalizeParts(query);
  return {
    loose: parts.loose.split(" ").filter(Boolean),
    tight: parts.tight.split(" ").filter(Boolean),
  };
}

/** Does this name answer to what was typed, read either way? */
export function matches(hay: Haystack, terms: { loose: string[]; tight: string[] }): boolean {
  if (terms.loose.length === 0) return true;
  if (terms.loose.every((term) => hay.loose.includes(term))) return true;
  return (
    terms.tight.length > 0 && terms.tight.every((term) => hay.tight.includes(term))
  );
}
