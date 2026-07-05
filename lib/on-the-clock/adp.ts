/**
 * Sleeper ADP helpers for On The Clock. Pure, browser-safe, deterministic.
 * NOTHING here touches Sleeper, Supabase, or fetch.
 *
 * Three concerns:
 *  1. Which ADP map key (player_market_snapshots.adp) a league should be graded
 *     against, derived from its FF Beacon format slug and the inferred player
 *     pool. Returned as an ordered candidate list so callers can fall through to
 *     the first key the snapshot actually has data for (e.g. the "rookie" key,
 *     fed by FantasyPros dynasty rookie rankings via DynastyProcess, only
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

/** League type, superflex-ness, and scoring pulled from a format slug. */
type FormatShape = { isDynasty: boolean; isSuperflex: boolean; scoring: "ppr" | "half" | "std" };

/**
 * Parse league type, superflex-ness, and scoring out of an FF Beacon format slug,
 * robust to the best-ball prefixes ("bestball-ppr-std", "bestball-ppr-sflex",
 * "bestball-dynasty-ppr-sflex"). We do NOT read scoring positionally off
 * split("-")[1]: a best-ball dynasty slug puts "dynasty" in that slot, which used
 * to misgrade those rooms as redraft single-QB PPR. Instead we detect league type
 * anywhere in the slug, then strip the known league-type prefix so the scoring
 * token comes first. "chopped"-style rooms map to a redraft slug upstream, so
 * they arrive here already redraft and stay redraft.
 */
function parseFormatShape(formatSlug: string): FormatShape {
  const slug = (formatSlug ?? "").toLowerCase();
  const isSuperflex = slug.includes("sflex");
  const isDynasty = slug.includes("dynasty"); // catches "dynasty-*" and "bestball-dynasty-*"

  // Strip the league-type prefix so the scoring token is first.
  let rest = slug.startsWith("bestball-") ? slug.slice("bestball-".length) : slug;
  if (rest.startsWith("dynasty-")) rest = rest.slice("dynasty-".length);
  else if (rest.startsWith("redraft-")) rest = rest.slice("redraft-".length);
  const scoringToken = rest.split("-")[0];
  const scoring: FormatShape["scoring"] =
    scoringToken === "half" ? "half" : scoringToken === "std" ? "std" : "ppr";

  return { isDynasty, isSuperflex, scoring };
}

/**
 * Sleeper single-QB ADP key suffixes in preference order for a scoring type. PPR
 * and Half are nearest neighbors; Standard falls to Half then PPR. Suffixes take
 * a "dynasty_" prefix for dynasty leagues, none for redraft, yielding the eight
 * single-QB market keys: "ppr" | "half_ppr" | "std" | "dynasty_ppr" |
 * "dynasty_half_ppr" | "dynasty_std".
 */
function scoringFallbackOrder(scoring: FormatShape["scoring"]): string[] {
  const KEY = { ppr: "ppr", half: "half_ppr", std: "std" } as const;
  if (scoring === "half") return [KEY.half, KEY.ppr, KEY.std];
  if (scoring === "std") return [KEY.std, KEY.half, KEY.ppr];
  return [KEY.ppr, KEY.half, KEY.std];
}

/**
 * Ordered ADP-key candidates for a format slug. Slugs are FF Beacon
 * format_configs slugs shaped {league}-{scoring}-{shape}, including the best-ball
 * variants ("bestball-ppr-std", "bestball-ppr-sflex", "bestball-dynasty-ppr-sflex").
 *
 * The mapping honors these hard rules so the value/reach indicators grade against
 * a market that actually matches the room:
 *   - Dynasty stays dynasty, redraft stays redraft (best-ball inherits the league
 *     type baked into its slug).
 *   - Superflex stays superflex, single-QB stays single-QB. A superflex league is
 *     graded ONLY against the 2QB market for its league type; it never falls back
 *     to a single-QB market (and a single-QB league never borrows a 2QB market).
 *   - Within single-QB, prefer the exact scoring, then the nearest scoring in the
 *     same league type (PPR<->Half nearest; Standard falls to Half then PPR). This
 *     covers a thin snapshot missing one scoring key without ever crossing the
 *     SF/1QB or dynasty/redraft lines.
 * TEP has no dedicated Sleeper ADP market, so TEP formats grade against their base
 * shape (PPR single-QB, or the 2QB market when superflex). For rookie drafts the
 * dedicated "rookie" ADP (FantasyPros rookie rankings via DynastyProcess) leads
 * the list when it has data.
 */
export function adpFormatKeyCandidates(formatSlug: string, pool: PlayerPool): string[] {
  const { isDynasty, isSuperflex, scoring } = parseFormatShape(formatSlug);

  let base: string[];
  if (isSuperflex) {
    // Superflex stays superflex: only the 2QB market for this league type.
    base = [isDynasty ? "dynasty_2qb" : "2qb"];
  } else {
    // Single-QB: exact scoring first, then the nearest scoring in the same league
    // type. Never cross into a superflex market.
    const prefix = isDynasty ? "dynasty_" : "";
    base = scoringFallbackOrder(scoring).map((suffix) => `${prefix}${suffix}`);
  }

  const candidates = pool === "rookies" ? ["rookie", ...base] : base;
  // De-dupe while preserving order.
  return candidates.filter((key, i) => candidates.indexOf(key) === i);
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
