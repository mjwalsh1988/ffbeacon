/**
 * Sleeper ADP helpers for On The Clock. Pure, browser-safe, deterministic.
 * NOTHING here touches Sleeper, Supabase, or fetch.
 *
 * Three concerns:
 *  1. Which ADP map key (player_market_snapshots.adp) a league should be graded
 *     against, derived from its FF Beacon format slug and the inferred player
 *     pool. Returned as an ordered candidate list so callers can fall through to
 *     the first key the snapshot actually has data for (e.g. "rookie" ADP only
 *     populates near rookie-draft season).
 *  2. Classifying a made pick against ADP: pick_value_delta = pick_no - adp.
 *     Positive means the player was taken LATER than the market expected (a
 *     discount, good value); negative means EARLIER (a reach). Neutral inside
 *     the threshold so tiny ADP wobbles are not called good or bad.
 *  3. Plain-English copy for both the board/list pick indicators and the
 *     available-players "Beacon vs ADP" comparison.
 */

import type { PlayerPool } from "./types";
import type { RankedPlayer } from "./board-types";

/** How a made pick compares to Sleeper ADP at the configured threshold. */
export type PickValueVerdict = "value" | "reach" | "neutral";

/**
 * Ordered ADP-key candidates for a format slug. Slugs are FF Beacon
 * format_configs slugs shaped {league}-{scoring}-{shape} (e.g.
 * "dynasty-ppr-sflex", "redraft-half-std", "dynasty-ppr-tep-sflex").
 * Superflex maps to Sleeper's 2QB markets. TEP has no Sleeper ADP market, so
 * TEP formats grade against their base shape. For rookie drafts, Sleeper's
 * dedicated "rookie" ADP leads the list when it has data.
 */
export function adpFormatKeyCandidates(formatSlug: string, pool: PlayerPool): string[] {
  const slug = (formatSlug ?? "").toLowerCase();
  const isDynasty = slug.startsWith("dynasty");
  const isSuperflex = slug.includes("sflex");
  const scoring = slug.split("-")[1] ?? "ppr"; // "ppr" | "half" | "std"

  let base: string;
  if (isDynasty) {
    if (isSuperflex) base = "dynasty_2qb";
    else if (scoring === "half") base = "dynasty_half_ppr";
    else if (scoring === "std") base = "dynasty_std";
    else base = "dynasty_ppr";
  } else {
    if (isSuperflex) base = "2qb";
    else if (scoring === "half") base = "half_ppr";
    else if (scoring === "std") base = "std";
    else base = "ppr";
  }

  const candidates = pool === "rookies" ? ["rookie", base] : [base];
  // Always end on the broadest market so a thin snapshot still grades something.
  if (!candidates.includes(isDynasty ? "dynasty_ppr" : "ppr")) {
    candidates.push(isDynasty ? "dynasty_ppr" : "ppr");
  }
  return candidates;
}

/**
 * pick_no minus ADP. Positive = taken later than the market expected (value),
 * negative = taken earlier (reach). Null when ADP is unknown.
 */
export function pickValueDelta(pickNo: number, adp: number | null | undefined): number | null {
  if (typeof adp !== "number" || !Number.isFinite(adp) || adp <= 0) return null;
  return pickNo - adp;
}

/**
 * Classify a pick's ADP delta at a threshold (in picks). Deltas inside the
 * threshold are neutral so ordinary draft-order noise is never flagged.
 */
export function classifyPickValue(
  delta: number | null | undefined,
  thresholdPicks: number,
): PickValueVerdict | null {
  if (typeof delta !== "number" || !Number.isFinite(delta)) return null;
  const t = Math.max(1, thresholdPicks);
  if (delta >= t) return "value";
  if (delta <= -t) return "reach";
  return "neutral";
}

/** Round an ADP delta to whole picks for display. */
function picks(n: number): string {
  const v = Math.round(Math.abs(n));
  return `${v} ${v === 1 ? "pick" : "picks"}`;
}

/**
 * Plain-English line for a made pick's ADP comparison (board list view).
 * Examples: "Great value: taken 14 picks after ADP", "Reach: taken 11 picks
 * before ADP", "Near ADP". Null delta reads as no data.
 */
export function describePickValue(
  delta: number | null | undefined,
  verdict: PickValueVerdict | null,
): string {
  if (verdict === null || typeof delta !== "number") return "No ADP data";
  if (verdict === "value") return `Great value: taken ${picks(delta)} after ADP`;
  if (verdict === "reach") return `Reach: taken ${picks(delta)} before ADP`;
  return "Near ADP";
}

/**
 * Plain-English comparison between a player's FF Beacon overall rank and their
 * Sleeper ADP, for the available-players list. Positive gap (ADP later than
 * Beacon rank) means FF Beacon is higher on the player than the market:
 * "Sleeper ADP is 12 picks later. Beacon says value." Negative means the market
 * drafts them earlier than Beacon ranks them.
 */
export function describeBeaconVsAdp(
  overallRank: number,
  adp: number | null | undefined,
  thresholdPicks: number,
): { gap: number | null; label: string; lean: "beacon-higher" | "market-higher" | "even" | "none" } {
  if (typeof adp !== "number" || !Number.isFinite(adp) || adp <= 0) {
    return { gap: null, label: "No ADP data", lean: "none" };
  }
  const gap = adp - overallRank;
  const t = Math.max(1, thresholdPicks);
  if (gap >= t) {
    return {
      gap,
      label: `Sleeper ADP is ${picks(gap)} later. Beacon says value.`,
      lean: "beacon-higher",
    };
  }
  if (gap <= -t) {
    return {
      gap,
      label: `Sleeper ADP is ${picks(gap)} earlier than Beacon rank.`,
      lean: "market-higher",
    };
  }
  return { gap, label: "Near Beacon rank", lean: "even" };
}

/**
 * Return a copy of the board players with each player's `adp` set from the
 * resolved ADP map (keyed by Sleeper player id). Players absent from the map
 * get adp null so the UI can distinguish "no data" from "not attached yet".
 */
export function attachAdpToPlayers(
  players: RankedPlayer[],
  adpBySleeperId: Record<string, number>,
): RankedPlayer[] {
  return players.map((p) => ({
    ...p,
    adp: p.sleeperId != null ? (adpBySleeperId[p.sleeperId] ?? null) : null,
  }));
}

/** Short screen-reader-friendly pick indicator label for the draft board cell. */
export function pickIndicatorLabel(
  delta: number,
  verdict: PickValueVerdict,
): string | null {
  if (verdict === "value") return `good value, taken ${picks(delta)} after Sleeper ADP`;
  if (verdict === "reach") return `possible reach, taken ${picks(delta)} before Sleeper ADP`;
  return null;
}
