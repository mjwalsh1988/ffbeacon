/**
 * How a draft pick is named, everywhere in League Pulse.
 *
 * THE THREE FACTS A PICK CARRIES
 *   1. WHICH PICK. "2027 R1". Says nothing on its own about what it is worth.
 *   2. WHERE IN THE ROUND. Early, mid, or late. This is most of the value: a
 *      2027 1st in dynasty superflex TEP ran 6,013 early against 4,182 late on
 *      2026-08-12, a spread wide enough to decide a verdict by itself.
 *   3. WHOSE IT WAS. The original owner, which is what DECIDES fact 2, because
 *      the pick lands wherever that team finishes. It is also the question a
 *      manager actually asks out loud: not "do you have a 2027 first", but
 *      "whose first?"
 *
 * The holder is deliberately NOT one of them. On the trade builder you have
 * already chosen the team you are trading with, so every pick on that side is
 * theirs by construction and printing it again is a word that tells the reader
 * nothing. The original owner is never redundant that way.
 *
 * WHY THIS IS ONE MODULE
 *   The builder's list, the rows in a built side, and the verdict all name the
 *   same pick, and they used to do it three different ways off two different
 *   shapes. One formatter means a pick reads identically wherever it appears,
 *   and means the accessible name and the visible text can never drift apart:
 *   the visible form is assembled from these parts, and `plainLabel` is the same
 *   parts as a sentence.
 *
 * Pure. No React, no database.
 */

export type PickSlotName = "early" | "mid" | "late" | "unknown";

/** Everything the formatter needs. Deliberately structural, so both the finder
 *  shape and the builder shape satisfy it without a conversion. */
export type PickLike = {
  season: number;
  round: number;
  pickPosition: PickSlotName;
  isOwnPick: boolean;
  originalOwnerHandle: string | null;
  originalTeamName: string | null;
  originalRosterId: number;
};

export type PickLabelParts = {
  /** "2027 R1". The pick itself and nothing else. */
  round: string;
  /** "Early" | "Mid" | "Late", or null when we cannot place it. */
  pool: string | null;
  /** Lowercase form for prose. Null when `pool` is. */
  poolWord: string | null;
  /** "via @handle", "via Team Name", or "own pick". Never null: a pick always
   *  came from somewhere, and "own pick" is a real answer rather than a gap. */
  via: string;
  /** True when the pool is our projection rather than a published draft order. */
  estimated: boolean;
  /** The whole thing as one sentence, for aria-label and plain-text contexts. */
  plainLabel: string;
};

const ROUND_WORD: Record<number, string> = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  5: "fifth",
};

const POOL_WORD: Record<Exclude<PickSlotName, "unknown">, string> = {
  early: "Early",
  mid: "Mid",
  late: "Late",
};

/** "2027 R1". Short because it sits next to a pill and a handle. */
export function pickRoundLabel(season: number, round: number): string {
  return `${season} R${round}`;
}

/**
 * Longest attribution we will print.
 *
 * Sleeper caps a username but not a team name, and a team name is free text that
 * people genuinely fill with a paragraph. Two things break on a long one: the
 * row wraps to three lines in a narrow drawer, and the saved-suggestion schema
 * in lib/trade-finder-saves.ts caps an asset label at 80 characters, so an
 * unclamped name would make a bookmark fail validation on the way in.
 */
const MAX_VIA_CHARS = 28;

/** At most MAX_VIA_CHARS out the other side, ellipsis included. */
function clampName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length <= MAX_VIA_CHARS
    ? trimmed
    : `${trimmed.slice(0, MAX_VIA_CHARS - 3).trimEnd()}...`;
}

/**
 * Who the pick came from, in the form that goes in parentheses.
 *
 * Handle first, because a Sleeper handle is what managers recognise; a custom
 * team name rotates season to season and a roster id means nothing to anybody.
 * The same preference order the team card already uses for pick attribution.
 */
export function pickViaLabel(pick: PickLike): string {
  if (pick.isOwnPick) return "own pick";
  if (pick.originalOwnerHandle) return `via @${clampName(pick.originalOwnerHandle)}`;
  if (pick.originalTeamName) return `via ${clampName(pick.originalTeamName)}`;
  return `via team ${pick.originalRosterId}`;
}

export function describePick(pick: PickLike, estimated: boolean): PickLabelParts {
  const round = pickRoundLabel(pick.season, pick.round);
  const pool = pick.pickPosition === "unknown" ? null : POOL_WORD[pick.pickPosition];
  const via = pickViaLabel(pick);

  // The spoken form spells the round out ("2027 first round") rather than
  // reading "R1" as a letter and a number, and it says the pool is a projection
  // when it is one. A screen reader user gets the caveat a sighted reader gets
  // from the word "projected" in the panel note.
  const spokenRound = ROUND_WORD[pick.round]
    ? `${pick.season} ${ROUND_WORD[pick.round]} round pick`
    : `${pick.season} round ${pick.round} pick`;
  const spokenPool = pool
    ? estimated
      ? `, projected ${pool.toLowerCase()} in the round`
      : `, ${pool.toLowerCase()} in the round`
    : "";

  return {
    round,
    pool,
    poolWord: pool ? pool.toLowerCase() : null,
    via,
    estimated,
    plainLabel: `${spokenRound}${spokenPool}, ${via}`,
  };
}

/**
 * The one-line form used where there is no room for a pill: option text, the
 * value engine's own `label` field, share copy.
 *
 * "2027 R1 Early (via @handle)". Same three facts in the same order as the
 * rendered version, so a reader who learns one has learned the other.
 */
export function formatPickLabel(pick: PickLike): string {
  const parts = describePick(pick, false);
  const pool = parts.pool ? ` ${parts.pool}` : "";
  return `${parts.round}${pool} (${parts.via})`;
}
