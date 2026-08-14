/**
 * "over the last 3 years", "past two seasons", "since 2023".
 *
 * A span of seasons, as opposed to the single season the season lexicon reads.
 * It exists because reliability is a multi-season measurement: one season of a
 * beat rate is fourteen or twenty weeks, and the question people actually ask is
 * whether someone has beaten his projection FOR A WHILE.
 *
 * RUNS BEFORE THE SEASON SCAN, for the same reason the week scanner does. "last
 * 3 years" contains a bare "3", "since 2023" contains a year, and the season
 * lexicon would claim "last year" out of "last 3 years" and leave "3 years"
 * behind as a candidate player name.
 */

/** Number words people write instead of digits. Two through six covers it. */
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

const SPAN_LEAD = new Set(["last", "past", "previous", "recent"]);
const SEASON_NOUNS = new Set(["year", "years", "season", "seasons"]);

/** Nobody means more than this, and it bounds what we will ever query. */
const MAX_SPAN = 10;

export type SeasonSpan =
  | { kind: "lastN"; count: number; text: string }
  | { kind: "since"; season: number; text: string };

export function scanSeasonSpan(tokens: string[], claimed: boolean[]): SeasonSpan | null {
  for (let i = 0; i < tokens.length; i++) {
    if (claimed[i]) continue;

    // "since 2023"
    if (tokens[i] === "since") {
      const next = i + 1;
      if (next < tokens.length && !claimed[next] && /^(19|20)\d{2}$/.test(tokens[next])) {
        claimed[i] = true;
        claimed[next] = true;
        return {
          kind: "since",
          season: Number(tokens[next]),
          text: `${tokens[i]} ${tokens[next]}`,
        };
      }
      continue;
    }

    // "last 3 years", "past two seasons"
    if (!SPAN_LEAD.has(tokens[i])) continue;
    const countIndex = i + 1;
    const nounIndex = i + 2;
    if (nounIndex >= tokens.length) continue;
    if (claimed[countIndex] || claimed[nounIndex]) continue;
    if (!SEASON_NOUNS.has(tokens[nounIndex])) continue;

    const count = /^\d{1,2}$/.test(tokens[countIndex])
      ? Number(tokens[countIndex])
      : (NUMBER_WORDS[tokens[countIndex]] ?? null);
    if (count === null || count < 1 || count > MAX_SPAN) continue;

    // A span of one is just "last season", which the season lexicon already
    // reads as a relative season. Leaving it alone keeps one meaning in one
    // place.
    if (count === 1) continue;

    claimed[i] = true;
    claimed[countIndex] = true;
    claimed[nounIndex] = true;
    return {
      kind: "lastN",
      count,
      text: `${tokens[i]} ${tokens[countIndex]} ${tokens[nounIndex]}`,
    };
  }

  return null;
}

/**
 * Turn a span into the seasons to query, newest season first in the range.
 *
 * `latestSeason` is the newest season we hold graded rows for, not the calendar
 * season: in August the current season has no results, and a beat rate over "the
 * last three years" that included a season nobody has played would be answered
 * with two thirds of the evidence and no mention of it.
 */
export function seasonsForSpan(span: SeasonSpan, latestSeason: number): number[] {
  if (span.kind === "since") {
    const out: number[] = [];
    for (let s = span.season; s <= latestSeason; s++) out.push(s);
    return out;
  }
  const out: number[] = [];
  for (let s = latestSeason - span.count + 1; s <= latestSeason; s++) {
    if (s > 0) out.push(s);
  }
  return out;
}

/** How the answer names the span it was asked for. */
export function spanLabel(span: SeasonSpan): string {
  if (span.kind === "since") return `since ${span.season}`;
  return `the last ${span.count} seasons`;
}
