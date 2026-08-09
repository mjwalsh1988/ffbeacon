/**
 * On The Clock Trade Analyzer (Phase 6C).
 *
 * Pure, browser-safe, deterministic. NOTHING here touches Sleeper, Supabase, or
 * fetch. It turns the board the cockpit already holds into a draft-room "value
 * check" with two pool-driven modes:
 *   - Everyone  -> startup draft picks only (made picks valued by the player
 *     taken, upcoming picks projected by the ADP simulation) plus future pick
 *     buckets. The available player pool is NOT a tradeable asset in a startup draft.
 *   - Rookies   -> available rookies, current rookie picks (projected from the
 *     rookie board), and future rookie buckets.
 *
 * Player and current-draft pick values come from the FF Beacon board the client
 * already loaded, so there is no DB round trip for those. FUTURE-year pick buckets
 * (2027, 2028, ...) are valued directly from the FF Beacon published pick values
 * (source='ffbeacon' in draft_pick_values), loaded with the board and passed in as
 * `futurePickValues`. We do NOT project a player and discount for future picks, and
 * we never read KTC pick values (that would break OTC's force-FF-Beacon posture).
 *
 * Made picks are valued by the player taken (real value). Upcoming current-draft
 * picks are still projected from the board (who is expected at that slot, no
 * multiplier) and flagged `estimated`. Future-year picks read a real FF Beacon value
 * and are NOT estimated; a future bucket with no FF Beacon value is simply omitted.
 *
 * Upcoming-pick projection reuses the existing snake/linear/3RR shape helpers in
 * draft-derive.ts (seatForPick / pickNoForSeat / draftShapeFromMeta), so the same
 * serpentine math that drives the board drives pick value.
 */

import type { PickBucketValue, RankedPlayer } from "./board-types";
import type { PlayerPool, ShapedPick } from "./types";
import type { CurrentDraftPick, TradedFuturePick } from "./pick-ownership";
import type { DraftAssetRef } from "./trade-assets";
import type { SimulatedPick } from "./adp-sim";

// ---------------------------------------------------------------------------
// Constants (documented fallbacks)
// ---------------------------------------------------------------------------

/**
 * Value used when the board is too thin to project a pick (e.g. a deep future
 * bucket on a tiny board). A small floor so an unprojectable pick still carries a
 * token value rather than 0, and the UI flags it estimated. Documented here so it
 * is never a hidden magic number.
 */
export const FALLBACK_PICK_VALUE = 50;

/**
 * Per-year discount for a FUTURE pick vs an equivalent current-draft slot.
 * Geometric 0.85^yearsAhead (next year ~0.85, the year after ~0.72).
 *
 * NOTE: The Trade Analyzer and Trade History NO LONGER use this for future picks;
 * they read real FF Beacon pick values instead. This is retained only for the
 * Rosters & Rankings power-ranking rollups (lib/on-the-clock/rosters.ts), which
 * still estimate future-pick value from the board.
 */
export function futureDiscount(yearsAhead: number): number {
  return Math.pow(0.85, Math.max(0, yearsAhead));
}

/** How many future seasons of buckets to offer, and which rounds (1st through 4th). */
const FUTURE_SEASON_COUNT = 2;
const FUTURE_ROUNDS = [1, 2, 3, 4] as const;
const BUCKETS = ["early", "mid", "late"] as const;

/** Cap on the player list in the picker (top N by value). Surfaced in a UI note. */
export const PLAYER_PICKER_CAP = 200;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TradeMode = "startup" | "rookie";
export type PickBucket = (typeof BUCKETS)[number];
export type TradeItemKind = "player" | "startup-pick" | "rookie-pick" | "future-pick";

/** One selectable trade asset with its computed FF Beacon value. */
export interface TradeItemOption {
  id: string;
  label: string;
  /** Optional secondary line (projected player for a pick, or "Estimated"). */
  detail?: string;
  value: number;
  kind: TradeItemKind;
  /** True when the value is a projection/estimate (UI shows the estimate note). */
  estimated: boolean;
  /**
   * True when the same asset can be placed more than once in a trade (generic
   * future-pick buckets like "2027 1st"). Exact draft slots (current-draft made /
   * upcoming picks and concrete traded future picks) are unique and default to
   * false, so the picker only offers each of them once across both sides.
   */
  repeatable?: boolean;
  /**
   * The draft-room asset this option stands for, so the dropdown and the
   * clickable board feed the SAME resolver on the way to Signal Check. Without
   * it the two paths would have to agree by convention, and they would drift.
   */
  ref?: DraftAssetRef;
}

/** A labeled group of options (renders as an <optgroup> in the picker). */
export interface TradeItemGroup {
  label: string;
  options: TradeItemOption[];
}

export interface TradeCatalogInput {
  mode: TradeMode;
  pool: PlayerPool;
  /** Post-exclusion, pool-filtered board (upcoming pick projection + player search). */
  available: RankedPlayer[];
  /** Pre-exclusion, pool-filtered board (future pick projection, not depleted). */
  poolBoard: RankedPlayer[];
  /** FULL pre-exclusion board (any position) for valuing already-made picks. */
  valueBoard: RankedPlayer[];
  /** Every pick in the current draft with ownership + made/upcoming state. */
  currentPicks: CurrentDraftPick[];
  /** Concrete traded FUTURE-season picks (owner-aware). */
  tradedFuturePicks: TradedFuturePick[];
  /**
   * FF Beacon published pick values for this league's format (source='ffbeacon').
   * Future-year buckets read directly from these; a bucket with no value is omitted.
   * Empty for redraft formats (no future picks published).
   */
  futurePickValues: PickBucketValue[];
  /** roster_id -> display name, for owner labels. */
  teamNameByRosterId: Record<number, string>;
  /** The connected user's roster id, for "Your pick" labels. null when undetected. */
  myRosterId: number | null;
  /** Sleeper draft settings (teams / rounds). */
  draftSettings: Record<string, number>;
  /** The draft's season (number); future buckets label currentSeason + 1.. */
  currentSeason: number;
  /**
   * The ADP simulation for the unmade picks, the SAME map resolveDraftAsset
   * reads. The catalog used to project an upcoming pick by walking the board in
   * VALUE order while the resolver used this, so a dropdown could name one
   * player and add another. One source, one answer.
   */
  simulated: Map<number, SimulatedPick>;
}

export type TradeLean = "empty" | "fair" | "a-lean" | "b-lean" | "a-strong" | "b-strong";

export interface TradeAnalysisResult {
  totalA: number;
  totalB: number;
  /** Absolute value difference. */
  diff: number;
  /** Difference as a percent of the larger side (0..100). */
  diffPct: number;
  lean: TradeLean;
  headline: string;
  detail: string;
  /** True when any placed asset on either side is an estimate (a projected pick). */
  hasEstimates: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortByValueDesc(players: RankedPlayer[]): RankedPlayer[] {
  return players.slice().sort((a, b) => b.value - a.value || a.overallRank - b.overallRank);
}

/** Index FF Beacon pick values by `${season}|${round}|${bucket}` for O(1) lookup. */
export function buildPickValueLookup(values: PickBucketValue[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const v of values) map.set(`${v.season}|${v.round}|${v.bucket}`, v.value);
  return map;
}

/** The FF Beacon value for a (season, round, bucket), or null when not published. */
export function lookupPickValue(
  lookup: Map<string, number>,
  season: number,
  round: number,
  bucket: PickBucket,
): number | null {
  const v = lookup.get(`${season}|${round}|${bucket}`);
  return typeof v === "number" ? v : null;
}

/** Representative seat within a round for a bucket (early/mid/late). */
export function bucketSlot(bucket: PickBucket, teams: number): number {
  if (teams <= 1) return 1;
  if (bucket === "early") return Math.max(1, Math.round(teams * 0.15));
  if (bucket === "late") return Math.min(teams, Math.round(teams * 0.85));
  return Math.round(teams * 0.5);
}

function ordinal(round: number): string {
  if (round === 1) return "1st";
  if (round === 2) return "2nd";
  if (round === 3) return "3rd";
  return `${round}th`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function cap(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function madeName(mp: ShapedPick): string {
  return `${mp.firstName ?? ""} ${mp.lastName ?? ""}`.trim() || "Unknown player";
}

/** Plain owner label for a roster, "Your pick" for the connected user. */
function ownerLabel(
  rosterId: number | null,
  myRosterId: number | null,
  teamNameByRosterId: Record<number, string>,
): string {
  if (rosterId == null) return "owner unknown";
  if (myRosterId != null && rosterId === myRosterId) return "Your pick";
  return teamNameByRosterId[rosterId] ?? `Team ${rosterId}`;
}

/** Plain team name, with no "Your pick" substitution. Reads inside a sentence. */
function teamLabel(
  rosterId: number | null,
  myRosterId: number | null,
  teamNameByRosterId: Record<number, string>,
): string {
  if (rosterId == null) return "an unknown team";
  if (myRosterId != null && rosterId === myRosterId) return "yours";
  return teamNameByRosterId[rosterId] ?? `Team ${rosterId}`;
}

/**
 * Sort comparator: natural draft order by overall pick number (1.01, 1.02, ...).
 * This is a generic trade builder, so every pick is listed in board order
 * regardless of owner (no "my picks first" reordering, which scrambled the list).
 */
function byOverall(a: CurrentDraftPick, b: CurrentDraftPick): number {
  return a.overall - b.overall;
}

// ---------------------------------------------------------------------------
// Catalog (Tasks 3, 4, 5, 6, 7)
// ---------------------------------------------------------------------------

/**
 * Build the pool-appropriate asset catalog with computed values. Returns empty
 * groups when the board is unavailable, so the UI shows a graceful "values
 * unavailable" state instead of crashing.
 *
 * Picks come from the ownership model (every pick in the current draft, any owner),
 * split into Made (valued by the selected player's FF Beacon value) and Upcoming
 * (projected from the available board). Future picks are generic discounted buckets
 * plus any concrete owner-aware traded future picks.
 */
export function buildTradeCatalog(input: TradeCatalogInput): TradeItemGroup[] {
  const {
    mode,
    available,
    poolBoard,
    valueBoard,
    currentPicks,
    tradedFuturePicks,
    futurePickValues,
    teamNameByRosterId,
    myRosterId,
    draftSettings,
    currentSeason,
    simulated,
  } = input;
  const teams = Number.isFinite(draftSettings.teams) && draftSettings.teams > 0 ? draftSettings.teams : 12;

  // No board at all: return an empty catalog so the UI shows the graceful
  // "values unavailable" state instead of floor-valued phantom picks.
  if (available.length === 0 && poolBoard.length === 0 && valueBoard.length === 0) return [];

  const availSorted = sortByValueDesc(available);
  const pickKind: TradeItemKind = mode === "rookie" ? "rookie-pick" : "startup-pick";
  const groups: TradeItemGroup[] = [];

  // Value lookup for already-made picks (FULL board, any position).
  const valByPlayerId = new Map<string, number>();
  const valBySleeperId = new Map<string, number>();
  for (const p of valueBoard) {
    valByPlayerId.set(p.playerId, p.value);
    if (p.sleeperId) valBySleeperId.set(p.sleeperId, p.value);
  }
  const madeValue = (mp: ShapedPick): number | null => {
    if (mp.playerId && valByPlayerId.has(mp.playerId)) return valByPlayerId.get(mp.playerId)!;
    if (mp.sleeperPlayerId && valBySleeperId.has(mp.sleeperPlayerId)) return valBySleeperId.get(mp.sleeperPlayerId)!;
    return null;
  };

  // 1. Players (FF Beacon value, not estimated). Capped to the top N by value.
  // ROOKIE drafts only: rookie players are tradeable assets alongside rookie picks.
  // In a STARTUP draft you trade draft picks, not the available player pool, so the
  // player group is intentionally omitted (a made pick already represents the player
  // taken at that slot). See the Startup Trade Builder copy in trade-analyzer.tsx.
  if (mode === "rookie") {
    const playerOptions: TradeItemOption[] = availSorted.slice(0, PLAYER_PICKER_CAP).map((p) => {
      const value = Math.round(p.value);
      return {
        id: `pl-${p.playerId}`,
        label: `${p.name}, ${p.position}`,
        detail: p.team ? `${p.team}, value ${value.toLocaleString()}` : `value ${value.toLocaleString()}`,
        value,
        kind: "player" as const,
        estimated: false,
        ref: { kind: "player", playerId: p.playerId } as DraftAssetRef,
      };
    });
    if (playerOptions.length > 0) {
      groups.push({ label: "Rookie players", options: playerOptions });
    }
  }

  // 2. MADE picks (any team), valued by the selected player's current FF Beacon value.
  const madeOptions: TradeItemOption[] = currentPicks
    .filter((p) => p.made && p.madePick)
    .slice()
    .sort(byOverall)
    .map((p) => {
      const mp = p.madePick as ShapedPick;
      const name = madeName(mp);
      const owner = ownerLabel(p.currentOwnerRosterId, myRosterId, teamNameByRosterId);
      const val = madeValue(mp);
      const posLabel = mp.position ? `, ${mp.position}` : "";
      return {
        id: `made-${p.overall}`,
        label: `${p.round}.${pad2(p.pickInRound)} - ${name}`,
        detail:
          val !== null
            ? `Made pick${posLabel}, ${owner}`
            : `Made pick${posLabel}, value unavailable, ${owner}`,
        value: val !== null ? Math.round(val) : 0,
        kind: pickKind,
        ref: { kind: "current-pick", overall: p.overall } as DraftAssetRef,
        // A made pick valued by a real player value is NOT a projection; only an
        // unmappable selection is flagged estimated/unavailable.
        estimated: val === null,
      };
    });
  if (madeOptions.length > 0) {
    groups.push({ label: "Made picks", options: madeOptions });
  }

  // 3. UPCOMING picks (any team), projected by the ADP simulation. This is the
  // same map resolveDraftAsset reads, so the label in the dropdown names the
  // player the asset actually lands as. A slot the simulation cannot reach (the
  // board runs out before it) is shown as unpriced rather than floored at an
  // invented number, which is also what the resolver does with it.
  const upcomingOptions: TradeItemOption[] = currentPicks
    .filter((p) => !p.made)
    .slice()
    .sort(byOverall)
    .map((p) => {
      const projected = simulated.get(p.overall) ?? null;
      const owner = ownerLabel(p.currentOwnerRosterId, myRosterId, teamNameByRosterId);
      return {
        id: `up-${p.overall}`,
        label: `${p.round}.${pad2(p.pickInRound)} - projected`,
        detail: projected
          ? `Projected: ${projected.player.name}, ${projected.player.position}, ${owner}`
          : `The board runs out before this pick, ${owner}`,
        value: projected ? Math.round(projected.player.value) : 0,
        kind: pickKind,
        estimated: true,
        ref: { kind: "current-pick", overall: p.overall } as DraftAssetRef,
      };
    });
  if (upcomingOptions.length > 0) {
    groups.push({ label: "Upcoming picks", options: upcomingOptions });
  }

  // 4. Future pick buckets, valued DIRECTLY from FF Beacon published pick values
  // (source='ffbeacon'). No board projection, no discount: "2027 3rd (Early)" is
  // exactly what FF Beacon says that bucket is worth. Buckets FF Beacon does not
  // publish (e.g. a redraft format, or a season beyond what is published) are simply
  // omitted rather than shown with a fabricated value. Real values, not estimates.
  const pickLookup = buildPickValueLookup(futurePickValues);
  const futureOptions: TradeItemOption[] = [];
  for (let s = 1; s <= FUTURE_SEASON_COUNT; s++) {
    const season = currentSeason + s;
    for (const round of FUTURE_ROUNDS) {
      for (const bucket of BUCKETS) {
        const val = lookupPickValue(pickLookup, season, round, bucket);
        if (val === null) continue; // hide buckets with no FF Beacon value
        futureOptions.push({
          id: `fut-${season}-${round}-${bucket}`,
          label: `${season} ${ordinal(round)} (${cap(bucket)})`,
          detail: "FF Beacon pick value",
          value: Math.round(val),
          kind: "future-pick",
          estimated: false,
          // Generic buckets are not a specific slot, so they can be added repeatedly
          // (a deal can include two 2027 1sts).
          repeatable: true,
          ref: { kind: "future-pick", season, round, bucket },
        });
      }
    }
  }
  if (futureOptions.length > 0) {
    groups.push({ label: "Future pick buckets", options: futureOptions });
  }

  // 5. Concrete traded FUTURE picks (owner-aware), valued from the FF Beacon value
  // for the round's mid bucket (the slot is unknown until that draft). A pick with no
  // published FF Beacon value is omitted. Real values, not estimates.
  //
  // The ref carries originalRosterId so the resolver mints the SAME id this
  // option advertises. Without it the option resolved to the generic bucket:
  // usedIds never suppressed it (the ids did not match) and the asset that
  // landed had lost which team's pick it was.
  const tradedFutureOptions: TradeItemOption[] = tradedFuturePicks
    .filter((t) => t.season - currentSeason >= 1 && t.season - currentSeason <= FUTURE_SEASON_COUNT)
    .map((t): TradeItemOption | null => {
      const val = lookupPickValue(pickLookup, t.season, t.round, "mid");
      if (val === null) return null;
      const holder = ownerLabel(t.currentOwnerRosterId, myRosterId, teamNameByRosterId);
      const from = teamLabel(t.originalRosterId, myRosterId, teamNameByRosterId);
      return {
        id: `tfut-${t.season}-${t.round}-${t.originalRosterId}`,
        label: `${t.season} ${ordinal(t.round)} - originally ${from}`,
        detail: `FF Beacon pick value, held by ${holder}`,
        value: Math.round(val),
        kind: "future-pick",
        estimated: false,
        ref: {
          kind: "future-pick",
          season: t.season,
          round: t.round,
          bucket: "mid",
          originalRosterId: t.originalRosterId,
        },
      };
    })
    .filter((o): o is TradeItemOption => o !== null);
  if (tradedFutureOptions.length > 0) {
    groups.push({ label: "Traded future picks", options: tradedFutureOptions });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Analysis (Task 2)
// ---------------------------------------------------------------------------

const EMPTY_RESULT: TradeAnalysisResult = {
  totalA: 0,
  totalB: 0,
  diff: 0,
  diffPct: 0,
  lean: "empty",
  headline: "Build both sides to see the value check",
  detail:
    "Add players or picks to Side A and Side B, then we will show which side carries more FF Beacon value. This is a value signal, not a guarantee.",
  hasEstimates: false,
};

/**
 * Total each side and produce a plain-English verdict. Thresholds mirror the
 * site's trade analyzer: within 5% is fair, within 15% is a lean, beyond that is a
 * strong edge. Pure: no rounding surprises, deterministic for a given input.
 */
export function analyzeTradeSides(
  sideA: TradeItemOption[],
  sideB: TradeItemOption[],
): TradeAnalysisResult {
  if (sideA.length === 0 && sideB.length === 0) return EMPTY_RESULT;

  const totalA = sideA.reduce((sum, i) => sum + i.value, 0);
  const totalB = sideB.reduce((sum, i) => sum + i.value, 0);
  const hasEstimates = [...sideA, ...sideB].some((i) => i.estimated);

  const diff = Math.abs(totalA - totalB);
  const max = Math.max(totalA, totalB, 1);
  const diffPct = (diff / max) * 100;
  const pctLabel = `${Math.round(diffPct)}%`;
  const diffLabel = Math.round(diff).toLocaleString();
  const estimateNote = hasEstimates
    ? " Some values are estimated pick projections, so treat this as a rough signal."
    : "";

  if (diffPct <= 5) {
    return {
      totalA,
      totalB,
      diff,
      diffPct,
      lean: "fair",
      headline: "Fair deal",
      detail: `Both sides land within ${pctLabel} of each other (${diffLabel} points apart). By FF Beacon value this is an even swap.${estimateNote}`,
      hasEstimates,
    };
  }

  const aLeads = totalA > totalB;
  const winner = aLeads ? "Side A" : "Side B";
  const strong = diffPct > 15;
  const lean: TradeLean = strong ? (aLeads ? "a-strong" : "b-strong") : aLeads ? "a-lean" : "b-lean";
  const headline = strong ? `Strong edge to ${winner}` : `Slight edge to ${winner}`;
  const margin = strong ? "a clear margin" : "a small margin";
  return {
    totalA,
    totalB,
    diff,
    diffPct,
    lean,
    headline,
    detail: `${winner} carries about ${pctLabel} more value (${diffLabel} points), ${margin}. This is a value signal, not a recommendation to accept or reject.${estimateNote}`,
    hasEstimates,
  };
}
