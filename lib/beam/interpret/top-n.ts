/**
 * "top 10 quarterbacks", "best 25 running backs", "top wide receivers".
 *
 * A leaderboard request: a count, and whether one was given at all. The count
 * has to be claimed here rather than left to the season parser, which reads a
 * bare two-digit number in the 15 to 49 range as a year: "top 25 running backs"
 * would otherwise be a question about the 2025 season with a stray "top" beside
 * it.
 */

/** Number words, up to the cap. People write "top ten" as often as "top 10". */
const NUMBER_WORDS: Record<string, number> = {
  three: 3,
  five: 5,
  ten: 10,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  twentyfive: 25,
  thirty: 30,
  fifty: 50,
};

const LEAD_WORDS = new Set(["top", "best", "leading", "highest"]);

/** What a reader gets when they say "top quarterbacks" with no number. */
export const DEFAULT_TOP_N = 10;

/**
 * The most rows one question can pull. A leaderboard is a browse surface, not a
 * data export, and the rankings page itself is where a full list belongs.
 */
export const MAX_TOP_N = 50;

export type TopN = {
  count: number;
  /** False when we defaulted. The answer says so rather than implying they asked. */
  stated: boolean;
  text: string;
};

export function scanTopN(tokens: string[], claimed: boolean[]): TopN | null {
  for (let i = 0; i < tokens.length; i++) {
    if (claimed[i] || !LEAD_WORDS.has(tokens[i])) continue;

    const next = i + 1;
    if (next < tokens.length && !claimed[next]) {
      const raw = /^\d{1,3}$/.test(tokens[next])
        ? Number(tokens[next])
        : (NUMBER_WORDS[tokens[next]] ?? null);
      if (raw !== null && raw >= 1) {
        claimed[i] = true;
        claimed[next] = true;
        return {
          // Clamped rather than rejected: someone asking for the top 500 wants a
          // leaderboard, and handing them 50 with a line saying so is a better
          // answer than refusing over a number.
          count: Math.min(raw, MAX_TOP_N),
          stated: true,
          text: `${tokens[i]} ${tokens[next]}`,
        };
      }
    }

    // "top quarterbacks", no number. Still a leaderboard request.
    claimed[i] = true;
    return { count: DEFAULT_TOP_N, stated: false, text: tokens[i] };
  }

  return null;
}
