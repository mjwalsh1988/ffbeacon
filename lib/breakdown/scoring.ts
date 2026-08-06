/**
 * The pairwise scoring primitives behind every Beacon Breakdown row.
 *
 * Every comparison reduces to the same thing: player A's share of the pair, on a
 * 0..1 scale where 0.5 is dead even. Sharing one scale is what lets the headline
 * verdict be an honest weighted average of the rows underneath it rather than a
 * separate calculation that happens to sit above them.
 *
 * Two rules keep the shares comparable:
 *   - A missing input on either side returns null, never 0.5. "We do not know"
 *     and "they are even" are different answers, and a metric we cannot measure
 *     must drop out of the average instead of dragging it toward the middle.
 *   - Ratio metrics with an unbounded scale (rank, finish) are inverted before
 *     sharing, so a rank of 1 versus 200 does not read as 0.005.
 *
 * Pure. No imports beyond the shared types.
 */

import type { BreakdownPlayer, EdgeWinner } from "./types";

/** Pairwise share for a "higher is better" metric. Returns a's share of the
 * pair in 0..1, or null when either input is missing. */
export function shareHigh(aVal: number | null, bVal: number | null): number | null {
  if (aVal == null || bVal == null) return null;
  const total = aVal + bVal;
  if (total <= 0) return 0.5;
  return aVal / total;
}

/** Pairwise share for a "lower is better" metric (ranks, finishes). */
export function shareLow(aVal: number | null, bVal: number | null): number | null {
  if (aVal == null || bVal == null) return null;
  const ia = 1 / Math.max(aVal, 0.5);
  const ib = 1 / Math.max(bVal, 0.5);
  const total = ia + ib;
  if (total <= 0) return 0.5;
  return ia / total;
}

/**
 * Pairwise share for a metric that can be zero or negative on either side, such
 * as a percentage change. Shifting both sides by the same constant keeps the
 * ordering while making the ratio meaningful, and the shift is large enough that
 * realistic swings never flip a sign.
 */
export function shareSigned(
  aVal: number | null,
  bVal: number | null,
  shift = 100,
): number | null {
  if (aVal == null || bVal == null) return null;
  return shareHigh(aVal + shift, bVal + shift);
}

/** Clamp to 0..1. */
export function unit(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Absolute youth score 0..1: 22-or-younger = 1, 28-or-older = 0. */
export function youthScore(age: number | null): number | null {
  if (age == null) return null;
  return unit((28 - age) / (28 - 22));
}

/** Absolute production score 0..1 from a positional finish (1 = best). */
export function productionScore(finish: number | null): number | null {
  if (finish == null) return null;
  return unit(1 - (finish - 1) / 24);
}

/**
 * Depth-chart role to opportunity weight (higher = more volume). Null when the
 * player is not depth-charted, so the row drops out rather than scoring a zero
 * that would read as "no opportunity".
 */
export function roleWeight(role: string | null): number | null {
  if (!role) return null;
  switch (role) {
    case "Starter":
      return 4;
    case "Handcuff":
    case "Backup":
      return 2;
    case "Depth Piece":
      return 1;
    case "Dart Throw":
      return 0.25;
    default:
      return null;
  }
}

/** Turn an a-share (0..1) into an EdgeWinner with a near-even guard. */
export function winnerFromShare(share: number | null, guard = 0.03): EdgeWinner {
  if (share == null) return "na";
  if (share > 0.5 + guard) return "a";
  if (share < 0.5 - guard) return "b";
  return "even";
}

/* ------------------------------------------------------------------ */
/* Derived, absolute 0..1 reads used by more than one metric           */
/* ------------------------------------------------------------------ */

/**
 * Safety, where HIGHER means steadier. Prefers measured week-to-week volatility
 * (ratio_stdev, from the projection accuracy table) over the market proxy,
 * because a player's own scoring spread is a far better risk read than how much
 * his trade value moved. Falls back to value volatility, tier, and age when we
 * have not graded enough of his games.
 */
export function safetyScore(p: BreakdownPlayer, ratioStdev: number | null): number | null {
  const parts: number[] = [];

  if (ratioStdev != null) {
    // 0.35 or lower is metronomic, 1.10 or higher is a lottery ticket.
    parts.push(unit(1 - (ratioStdev - 0.35) / (1.1 - 0.35)));
  }

  const youth = youthScore(p.age);
  if (youth != null) parts.push(youth);

  if (p.change30dPct != null) {
    // Less market movement is steadier. 0% swing scores 1, 25% or more scores 0.
    parts.push(unit(1 - Math.abs(p.change30dPct) / 25));
  }
  if (p.tier != null) {
    // A proven tier is safer. Tier 1 scores 1, tier 6 scores 0.
    parts.push(unit((6 - p.tier) / 5));
  }
  if (parts.length === 0) return null;
  return parts.reduce((s, x) => s + x, 0) / parts.length;
}

/** Upside, where higher means more room to climb. */
export function upsideScore(p: BreakdownPlayer): number | null {
  const parts: number[] = [];
  const youth = youthScore(p.age);
  if (youth != null) parts.push(youth);
  if (p.change30dPct != null) {
    parts.push(unit(0.5 + p.change30dPct / 40));
  }
  if (p.tier != null) {
    parts.push(unit((6 - p.tier) / 5));
  }
  if (parts.length === 0) return null;
  return parts.reduce((s, x) => s + x, 0) / parts.length;
}

/**
 * Health score for the "this week" lens, where 1 is fully available. Sleeper's
 * designations are ordered by how likely they are to cost the player the game.
 */
export function healthScore(status: string | null): number | null {
  if (!status) return 1;
  const key = status.toUpperCase();
  switch (key) {
    case "Q":
    case "QUESTIONABLE":
      return 0.75;
    case "D":
    case "DOUBTFUL":
      return 0.3;
    case "O":
    case "OUT":
      return 0.05;
    case "IR":
    case "PUP":
    case "NA":
    case "SUS":
    case "COV":
    case "DNR":
      return 0;
    default:
      return 1;
  }
}

/* ------------------------------------------------------------------ */
/* Plain-language phrases                                              */
/* ------------------------------------------------------------------ */

export function dynastyPhrase(p: BreakdownPlayer): string {
  const strong = p.tier != null ? p.tier <= 2 : (p.value ?? 0) > 5000;
  const mid = p.tier != null ? p.tier <= 4 : (p.value ?? 0) > 2000;
  const young = p.age != null && p.age <= 24;
  const old = p.age != null && p.age >= 29;
  if (strong && young) return "Cornerstone";
  if (strong && old) return "Win-now asset";
  if (strong) return "Blue-chip";
  if (mid && young) return "Ascending";
  if (mid && old) return "Fading vet";
  if (young) return "Long-term dart";
  return "Depth hold";
}

export function redraftPhrase(p: BreakdownPlayer): string {
  const f = p.latestFinish?.finish ?? null;
  const rank = p.overallRank ?? null;
  if (f != null && f <= 6) return "Weekly starter";
  if (rank != null && rank <= 24) return "Weekly starter";
  if ((f != null && f <= 18) || (rank != null && rank <= 60)) return "Every-week flex";
  if ((f != null && f <= 36) || (rank != null && rank <= 120)) return "Matchup play";
  return "Bench / streamer";
}

/**
 * Risk read. Prefers the measured scoring spread when we have graded enough
 * games, because "how much does his weekly score bounce around" is the risk a
 * lineup decision actually carries.
 */
export function riskPhrase(p: BreakdownPlayer, ratioStdev: number | null): string {
  if (ratioStdev != null) {
    if (ratioStdev <= 0.45) return "Metronome";
    if (ratioStdev <= 0.65) return "Steady";
    if (ratioStdev <= 0.9) return "Swingy";
    return "Lottery ticket";
  }
  const swingy = p.change30dPct != null && Math.abs(p.change30dPct) >= 12;
  const old = p.age != null && p.age >= 29;
  const proven = p.tier != null && p.tier <= 2;
  if (proven && !old && !swingy) return "Rock solid";
  if (old && swingy) return "Volatile";
  if (old) return "Age risk";
  if (swingy) return "Swingy";
  return "Steady";
}

export function upsidePhrase(p: BreakdownPlayer): string {
  const rising = p.trend30d === "up" || (p.change30dPct != null && p.change30dPct >= 5);
  const young = p.age != null && p.age <= 24;
  const highTier = p.tier != null && p.tier <= 2;
  if (rising && young) return "Breakout arrow";
  if (highTier && young) return "Ceiling play";
  if (rising) return "Trending up";
  if (young) return "Room to grow";
  if (p.trend30d === "down") return "Cooling off";
  return "Known quantity";
}

/** Plain-language read on a schedule multiplier (1.0 is a neutral slate). */
export function schedulePhrase(multiplier: number | null): string {
  if (multiplier == null) return "-";
  if (multiplier >= 1.06) return "Easy slate";
  if (multiplier >= 1.02) return "Slightly easy";
  if (multiplier > 0.98) return "Neutral";
  if (multiplier > 0.94) return "Slightly tough";
  return "Tough slate";
}

/** Plain-language read on one week's matchup multiplier. */
export function matchupPhrase(multiplier: number): string {
  if (multiplier >= 1.08) return "Great matchup";
  if (multiplier >= 1.02) return "Favorable";
  if (multiplier > 0.98) return "Neutral";
  if (multiplier > 0.92) return "Tough";
  return "Very tough";
}

/* ------------------------------------------------------------------ */
/* Display formatters                                                  */
/* ------------------------------------------------------------------ */

export function fmtValue(v: number | null): string {
  return v != null && v > 0 ? v.toLocaleString() : "-";
}

export function fmtRank(r: number | null): string {
  return r != null ? `#${r}` : "-";
}

export function fmtPoints(v: number | null, digits = 1): string {
  return v != null ? v.toFixed(digits) : "-";
}

export function fmtPct(v: number | null, digits = 0): string {
  return v != null ? `${(v * 100).toFixed(digits)}%` : "-";
}

export function fmtChange(pct: number | null, raw: number | null): string {
  if (pct == null && raw == null) return "Flat";
  if (raw != null && raw === 0) return "Flat";
  const sign = (raw ?? pct ?? 0) > 0 ? "+" : "";
  if (pct != null) return `${sign}${pct.toFixed(1)}%`;
  return `${sign}${(raw ?? 0).toLocaleString()}`;
}

export function finishText(p: BreakdownPlayer): string {
  const f = p.latestFinish;
  if (!f) return "-";
  return `${p.position.toUpperCase()}${f.finish} (${f.season})`;
}
