/**
 * Pull a week range out of a question.
 *
 * "between weeks 2 and 8", "from week 2 to week 8", "weeks 2 through 9",
 * "weeks 2-8", "in week 5". All the same shape: a week word, then numbers with
 * connectors between them.
 *
 * WHY THIS RUNS BEFORE THE SEASON SCAN. The season scan reads a bare two-digit
 * token in the 15 to 49 range as a year, so "between weeks 15 and 17" would
 * otherwise be read as the 2015 and 2017 seasons and the question would come out
 * of the extractor as something nobody asked. Claiming the week numbers first is
 * what stops that, and it is why this module exists rather than living in the
 * phrase matcher, which has no way to express "a number after this word".
 */

import { damerauLevenshtein } from "@/lib/beam/resolve/distance";

/** What a reader calls a week. */
const WEEK_WORDS = new Set(["week", "weeks", "wk", "wks"]);

/**
 * The same word, typed wrong.
 *
 * BEAM has always been forgiving about a player's name and unforgiving about
 * its own keywords, and that asymmetry is invisible to the person typing: one
 * dropped letter in "weeks" produced "too many players", because the misspelled
 * word became a name, the range disappeared, and a bare "17" downstream was read
 * as the 2017 season.
 *
 * Guarded three ways, so this cannot start eating real words: the token must
 * begin with "w", must be within one edit of "week" or "weeks", and the scanner
 * only ever claims it when a real week number follows. "weak 5" resolving as a
 * week is the worst thing this can do.
 */
function isWeekWord(token: string): boolean {
  if (WEEK_WORDS.has(token)) return true;
  if (token.length < 3 || token.length > 6 || token[0] !== "w") return false;
  return (
    damerauLevenshtein(token, "week", 1) <= 1 || damerauLevenshtein(token, "weeks", 1) <= 1
  );
}

/** Words that can sit between two week numbers without ending the range. */
const CONNECTORS = new Set(["to", "through", "thru", "and", "til", "till", "until", "vs"]);

/** Words that can sit in front of a week number and still be part of the range. */
const LEAD_INS = new Set(["of", "in", "the", "from", "between", "during", "over", "across"]);

/**
 * The regular season is 18 weeks. A number outside that is not a week, and
 * treating it as one would silently return an empty range.
 */
export const MAX_WEEK = 18;

export type WeekRange = {
  start: number;
  end: number;
  /** The exact words this came from, for the debug trace and the evidence log. */
  text: string;
};

/**
 * Scan for a week range, claiming every token it consumes.
 *
 * Returns the FIRST range found. A question with two ranges in it is not a
 * question BEAM can answer, and taking the first is more predictable than
 * merging them into something the reader never said.
 */
export function scanWeekRange(tokens: string[], claimed: boolean[]): WeekRange | null {
  for (let i = 0; i < tokens.length; i++) {
    if (claimed[i] || !isWeekWord(tokens[i])) continue;

    const numbers: number[] = [];
    const consumed: number[] = [i];
    let j = i + 1;

    while (j < tokens.length && !claimed[j]) {
      const token = tokens[j];
      const asNumber = /^\d{1,2}$/.test(token) ? Number(token) : null;

      if (asNumber !== null && asNumber >= 1 && asNumber <= MAX_WEEK) {
        numbers.push(asNumber);
        consumed.push(j);
        j += 1;
        continue;
      }
      // A connector or another week word only continues the range if a number
      // actually follows it. "weeks 2 and 8" is a range; "week 5 and Purdy" is a
      // week followed by a name, and swallowing "and Purdy" would eat the name.
      if (CONNECTORS.has(token) || isWeekWord(token) || LEAD_INS.has(token)) {
        const next = nextNumber(tokens, claimed, j + 1);
        if (next === null) break;
        consumed.push(j);
        j += 1;
        continue;
      }
      break;
    }

    if (numbers.length === 0) continue;

    // Trim any trailing connector we consumed on the way to a number that turned
    // out not to exist. consumed is built in order, so the tail is the only
    // place that can happen.
    while (consumed.length > 0 && !isNumberToken(tokens[consumed[consumed.length - 1]])) {
      const last = consumed[consumed.length - 1];
      if (isWeekWord(tokens[last]) && consumed.length === 1) break;
      if (last === i) break;
      consumed.pop();
    }

    for (const index of consumed) claimed[index] = true;

    const start = Math.min(...numbers);
    const end = Math.max(...numbers);
    return {
      start,
      end,
      text: consumed.map((index) => tokens[index]).join(" "),
    };
  }

  return null;
}

function isNumberToken(token: string): boolean {
  return /^\d{1,2}$/.test(token);
}

/** The next usable week number at or after `from`, skipping connectors. */
function nextNumber(tokens: string[], claimed: boolean[], from: number): number | null {
  for (let k = from; k < tokens.length && k < from + 3; k++) {
    if (claimed[k]) return null;
    if (isNumberToken(tokens[k])) {
      const value = Number(tokens[k]);
      return value >= 1 && value <= MAX_WEEK ? value : null;
    }
    if (!CONNECTORS.has(tokens[k]) && !isWeekWord(tokens[k]) && !LEAD_INS.has(tokens[k])) {
      return null;
    }
  }
  return null;
}

/** "weeks 2 to 8", or "week 5" when the range is a single week. */
export function weekRangeLabel(range: { start: number; end: number }): string {
  return range.start === range.end
    ? `week ${range.start}`
    : `weeks ${range.start} to ${range.end}`;
}

/** How many weeks the range spans, inclusive. */
export function weekRangeSpan(range: { start: number; end: number }): number {
  return range.end - range.start + 1;
}
