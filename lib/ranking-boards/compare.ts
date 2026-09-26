/**
 * "vs FF Beacon" and "vs community": where a reader placed a player against
 * where another ranking has him (plan section 6). Pure and client-safe.
 *
 * WHICH RANKS ARE COMPARED
 *   A one-position board compares its rank (which is the positional rank) with
 *   the other ranking's POSITIONAL rank. An overall board compares with the
 *   other ranking's OVERALL rank, using the reader's rank among OFFENSIVE
 *   players only: an overall board with defenders switched on interleaves
 *   linebackers that no source ranks, and counting them would push every
 *   offensive player down the board and invent a gap nobody chose.
 *
 * DEFENDERS
 *   No source ranks a defender. The figure says so in words ("Not ranked by FF
 *   Beacon"), never a zero and never a blank.
 */

import { isDefender } from "@/lib/site";

export type ComparisonRanks = {
  /** The other ranking's overall rank, when it has one. */
  overall: number | null;
  /** The other ranking's rank at this player's position. */
  position: number | null;
};

/** Everything a surface needs to draw one comparison column. */
export type RankComparison = {
  /** Short visible column label: "vs FF Beacon today". */
  label: string;
  /** The name of the ranking in a sentence: "FF Beacon". */
  subject: string;
  /** Present when the comparison uses a DIFFERENT format than the board's,
   * because the ranking does not publish the board's own (half PPR on FF
   * Beacon). Names the format used: "Redraft 1QB PPR". */
  fallbackFormatDisplay: string | null;
  /** Compare overall ranks, or positional ranks. */
  basis: "overall" | "position";
  /** Keyed by player id. A player absent here is not in the ranking. */
  ranks: Record<string, ComparisonRanks>;
  /** True for a ranking that ranks defenders in a group of their own (the
   * community rankings). A defender is then compared by his rank among the
   * board's defenders; without it he reads "Not ranked by ...". */
  ranksDefenders?: boolean;
};

export type RankGap =
  | { kind: "gap"; direction: "higher" | "lower" | "same"; spots: number; theirRank: number }
  | { kind: "defender" }
  | { kind: "unranked" };

/**
 * The reader's comparable rank for each player: positional on a one-position
 * board, rank among offensive players on an overall board.
 */
export function comparableRanks(
  ordered: readonly { playerId: string; position: string }[],
  basis: "overall" | "position",
  opts: { defendersSeparately?: boolean } = {},
): Map<string, number> {
  const out = new Map<string, number>();
  if (basis === "position") {
    const seen = new Map<string, number>();
    for (const p of ordered) {
      const n = (seen.get(p.position) ?? 0) + 1;
      seen.set(p.position, n);
      out.set(p.playerId, n);
    }
    return out;
  }
  let n = 0;
  let d = 0;
  for (const p of ordered) {
    if (isDefender(p.position)) {
      if (opts.defendersSeparately) {
        d += 1;
        out.set(p.playerId, d);
      }
      continue;
    }
    n += 1;
    out.set(p.playerId, n);
  }
  return out;
}

/** comparableRanks with the options a given comparison needs. */
export function readerRanksFor(
  ordered: readonly { playerId: string; position: string }[],
  comparison: Pick<RankComparison, "basis" | "ranksDefenders">,
): Map<string, number> {
  return comparableRanks(ordered, comparison.basis, {
    defendersSeparately: comparison.ranksDefenders === true,
  });
}

export function rankGap(
  comparison: Pick<RankComparison, "basis" | "ranks" | "ranksDefenders">,
  player: { playerId: string; position: string },
  readerRank: number | undefined,
): RankGap {
  if (isDefender(player.position) && !comparison.ranksDefenders) return { kind: "defender" };
  const theirs = comparison.ranks[player.playerId];
  const theirRank =
    comparison.basis === "overall" ? theirs?.overall ?? null : theirs?.position ?? null;
  if (theirRank == null || readerRank == null) return { kind: "unranked" };
  const diff = theirRank - readerRank;
  if (diff === 0) return { kind: "gap", direction: "same", spots: 0, theirRank };
  return {
    kind: "gap",
    direction: diff > 0 ? "higher" : "lower",
    spots: Math.abs(diff),
    theirRank,
  };
}

/** The chip's visible words: "4 higher", "2 lower", "Same". */
export function gapShortText(gap: RankGap, subject: string): string {
  if (gap.kind === "defender") return `Not ranked by ${subject}`;
  if (gap.kind === "unranked") return `Not in ${subject}'s rankings`;
  if (gap.direction === "same") return "Same";
  return `${gap.spots} ${gap.direction}`;
}

/** The full sentence for a screen reader and for the result line:
 * "You have him 4 spots higher than FF Beacon, who ranks him 18th." */
export function gapSentence(gap: RankGap, subject: string): string {
  if (gap.kind === "defender") return `Not ranked by ${subject}: no source ranks defenders.`;
  if (gap.kind === "unranked") return `Not in ${subject}'s rankings.`;
  if (gap.direction === "same") {
    return `Same spot as ${subject}, ${ordinal(gap.theirRank)}.`;
  }
  const spots = `${gap.spots} spot${gap.spots === 1 ? "" : "s"}`;
  return `${spots} ${gap.direction} than ${subject}, who has him ${ordinal(gap.theirRank)}.`;
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Agreement with a ranking: the share of compared players the reader placed
 * within `window` spots of it. Players the ranking does not rank (defenders,
 * the unranked) are left out of both halves of the ratio. Null when nothing
 * could be compared.
 */
export function agreementShare(
  gaps: readonly RankGap[],
  window = 3,
): { share: number; compared: number } | null {
  const compared = gaps.filter(
    (g): g is Extract<RankGap, { kind: "gap" }> => g.kind === "gap",
  );
  if (compared.length === 0) return null;
  const close = compared.filter((g) => g.spots <= window).length;
  return { share: close / compared.length, compared: compared.length };
}

export type Disagreement = {
  playerId: string;
  name: string;
  position: string;
  readerRank: number;
  theirRank: number;
  /** Signed: positive when the reader has him HIGHER than the ranking. */
  spots: number;
};

/**
 * The players a reader disagrees with a ranking about most: up to `n` they
 * have higher and up to `n` they have lower, biggest gap first, ties broken by
 * the reader's own rank so the list is stable.
 */
export function biggestDisagreements(
  ordered: readonly { playerId: string; name: string; position: string }[],
  comparison: Pick<RankComparison, "basis" | "ranks" | "ranksDefenders">,
  n = 5,
): { higher: Disagreement[]; lower: Disagreement[] } {
  const readerRanks = readerRanksFor(ordered, comparison);
  const all: Disagreement[] = [];
  for (const p of ordered) {
    const gap = rankGap(comparison, p, readerRanks.get(p.playerId));
    if (gap.kind !== "gap" || gap.direction === "same") continue;
    all.push({
      playerId: p.playerId,
      name: p.name,
      position: p.position,
      readerRank: readerRanks.get(p.playerId) ?? 0,
      theirRank: gap.theirRank,
      spots: gap.direction === "higher" ? gap.spots : -gap.spots,
    });
  }
  const byGap = (a: Disagreement, b: Disagreement) =>
    Math.abs(b.spots) - Math.abs(a.spots) || a.readerRank - b.readerRank;
  return {
    higher: all.filter((d) => d.spots > 0).sort(byGap).slice(0, n),
    lower: all.filter((d) => d.spots < 0).sort(byGap).slice(0, n),
  };
}
