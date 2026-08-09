/**
 * On The Clock Trade History analyzer (a mini Signal Check).
 *
 * Pure, browser-safe, deterministic. NOTHING here touches Sleeper, Supabase, or
 * fetch. It turns one Sleeper TRADE transaction into a per-side FF Beacon value
 * breakdown plus a plain-English verdict, reusing the same board-projection logic
 * the cockpit Trade Analyzer uses:
 *   - A player received is valued by its current FF Beacon value.
 *   - A draft pick that has ALREADY been made is valued by the player taken at that
 *     slot (the real FF Beacon value of that player), never a projection.
 *   - A current-draft pick that is not yet made is projected from the board (who is
 *     expected to be there at that point), flagged estimated.
 *   - A future-season pick reads the real FF Beacon published pick value for that
 *     season/round (mid bucket), source='ffbeacon'. No projection, no discount; not
 *     flagged estimated. A pick with no published FF Beacon value is marked noValue.
 *
 * Player and current-draft pick values come from the board the cockpit already holds
 * (FF Beacon, forced); future-pick values come from the board's `pickValues`
 * (source='ffbeacon', never KTC). Verdict thresholds mirror the site analyzer: within
 * 5% is fair, within 15% is a lean, beyond is strong.
 */

import type { PickBucketValue, RankedPlayer } from "./board-types";
import type { CurrentDraftPick } from "./pick-ownership";
import { buildPickValueLookup, lookupPickValue, bucketSlot, FALLBACK_PICK_VALUE } from "./trade-analyzer";
import type { SimulatedPick } from "./adp-sim";

// ---------------------------------------------------------------------------
// Shaped transaction (the wire shape the transactions route returns)
// ---------------------------------------------------------------------------

/** A traded draft pick, shaped from Sleeper's transaction draft_picks payload. */
export interface HistoryPick {
  season: number;
  round: number;
  /** The roster whose pick this originally was. */
  originalRosterId: number;
  /** The roster that received the pick in this trade. */
  newOwnerRosterId: number | null;
  /** The roster that gave the pick up. */
  previousOwnerRosterId: number | null;
}

/** One FAAB transfer inside a trade. */
export interface HistoryFaab {
  sender: number;
  receiver: number;
  amount: number;
}

/** A Sleeper trade transaction, reduced to the asset references we value. */
export interface HistoryTransaction {
  transactionId: string;
  status: string;
  week: number | null;
  /** Milliseconds epoch, or null when Sleeper omitted it. */
  createdAt: number | null;
  rosterIds: number[];
  /** sleeperPlayerId -> roster that received the player. */
  adds: Record<string, number>;
  /** sleeperPlayerId -> roster that gave the player up. */
  drops: Record<string, number>;
  picks: HistoryPick[];
  faab: HistoryFaab[];
}

// ---------------------------------------------------------------------------
// Analysis output
// ---------------------------------------------------------------------------

export type HistoryAssetKind = "player" | "made-pick" | "upcoming-pick" | "future-pick";

/** One valued asset a side received in the trade. */
export interface HistoryAsset {
  key: string;
  kind: HistoryAssetKind;
  /** Primary line, e.g. "Josh Allen, QB" or "1.04 - Marvin Harrison Jr." */
  label: string;
  /** Optional secondary line (team, projected player, "Estimated future pick"). */
  detail?: string;
  value: number;
  /** True when the value is a projection (an unmade or future pick). */
  estimated: boolean;
  /** True when we could not resolve any FF Beacon value for the asset. */
  noValue: boolean;
  /**
   * The roster that GAVE this asset up in the trade (the receiving roster is the
   * HistorySide that holds it). null when Sleeper did not record an origin. Used by
   * the awards computation to net each roster's give/get without re-valuing assets.
   */
  fromRosterId: number | null;
}

/** One side of the trade (one roster) with everything it received. */
export interface HistorySide {
  rosterId: number;
  teamName: string;
  isYou: boolean;
  assets: HistoryAsset[];
  /** FAAB dollars received (informational; not added to the value total). */
  faabIn: number;
  total: number;
  hasEstimates: boolean;
  hasMissingValues: boolean;
  /** True when this side is the verdict winner (never set on a fair deal). */
  leads: boolean;
}

export type HistoryLean = "fair" | "slight" | "strong" | "empty";

export interface HistoryVerdict {
  lean: HistoryLean;
  headline: string;
  detail: string;
  winnerRosterId: number | null;
}

/** The fully analyzed trade, ready to render. */
export interface HistoryEntry {
  transactionId: string;
  week: number | null;
  createdAt: number | null;
  sides: HistorySide[];
  verdict: HistoryVerdict;
  hasEstimates: boolean;
  hasMissingValues: boolean;
}

/** Board + draft context the analyzer values every trade against. */
export interface TradeHistoryContext {
  /** FULL pre-exclusion board (any position); values made picks + traded players. */
  valueBoard: RankedPlayer[];
  /** Post-exclusion board (drafted removed); upcoming-pick projection. */
  available: RankedPlayer[];
  /** Pre-exclusion board; current-season unknown-seat projection (not depleted). */
  poolBoard: RankedPlayer[];
  /**
   * FF Beacon published pick values for the league's format (source='ffbeacon').
   * Future-season picks read directly from these. Empty for redraft formats.
   */
  futurePickValues: PickBucketValue[];
  /** Every pick in the current draft with made/owner state. */
  currentPicks: CurrentDraftPick[];
  /** roster_id -> display name, for side labels. */
  teamNameByRosterId: Record<number, string>;
  /** The connected user's roster id, for the "You" badge. null when undetected. */
  myRosterId: number | null;
  /** Teams in the draft (defaults to 12 when unknown). */
  teams: number;
  /** The current draft's season; future buckets are currentSeason + 1.. */
  currentSeason: number;
  /**
   * The ADP simulation, the SAME map the trade builder reads. Optional only so
   * a caller without a board can still render made picks; an unmade pick with
   * no simulation is reported as unpriced rather than floored at an invented
   * number.
   */
  simulated?: Map<number, SimulatedPick>;
}

// ---------------------------------------------------------------------------
// Helpers (small, local; the documented pick constants are imported)
// ---------------------------------------------------------------------------

function sortByValueDesc(players: RankedPlayer[]): RankedPlayer[] {
  return players.slice().sort((a, b) => b.value - a.value || a.overallRank - b.overallRank);
}

/** The board player projected at a 0-based index (clamped). Null on empty board. */
function projectAt(sortedDesc: RankedPlayer[], index: number): RankedPlayer | null {
  if (sortedDesc.length === 0) return null;
  const i = Math.min(Math.max(0, Math.round(index)), sortedDesc.length - 1);
  return sortedDesc[i];
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

function madeName(mp: CurrentDraftPick["madePick"]): string {
  if (!mp) return "Unknown player";
  return `${mp.firstName ?? ""} ${mp.lastName ?? ""}`.trim() || "Unknown player";
}

// ---------------------------------------------------------------------------
// Analyzer
// ---------------------------------------------------------------------------

/**
 * Value one trade transaction against the board context and return a per-side
 * breakdown plus a verdict. Deterministic and side-effect free. Sides are derived
 * from the transaction's roster_ids (with a fallback to any roster that actually
 * received an asset), so a multi-team trade renders every participating team.
 */
export function analyzeTradeTransaction(
  txn: HistoryTransaction,
  ctx: TradeHistoryContext,
): HistoryEntry {
  const teams = ctx.teams > 0 ? ctx.teams : 12;
  const availSorted = sortByValueDesc(ctx.available);
  const poolSorted = sortByValueDesc(ctx.poolBoard.length > 0 ? ctx.poolBoard : ctx.available);
  const pickLookup = buildPickValueLookup(ctx.futurePickValues);

  // Player lookups (meta for display + value) from the full value board.
  const playerBySleeperId = new Map<string, RankedPlayer>();
  for (const p of ctx.valueBoard) if (p.sleeperId) playerBySleeperId.set(p.sleeperId, p);

  // Made-pick value lookups, keyed by FF Beacon id and Sleeper id.
  const valByPlayerId = new Map<string, number>();
  const valBySleeperId = new Map<string, number>();
  for (const p of ctx.valueBoard) {
    valByPlayerId.set(p.playerId, p.value);
    if (p.sleeperId) valBySleeperId.set(p.sleeperId, p.value);
  }

  // Current-draft pick lookup by (round, original roster) -> the seat in this draft.
  const currentByKey = new Map<string, CurrentDraftPick>();
  for (const cp of ctx.currentPicks) {
    if (cp.originalRosterId != null) currentByKey.set(`${cp.round}|${cp.originalRosterId}`, cp);
  }

  const valuePick = (pick: HistoryPick): HistoryAsset => {
    const { season, round } = pick;
    const cs = ctx.currentSeason;

    if (season === cs) {
      const cp = currentByKey.get(`${round}|${pick.originalRosterId}`);
      // Made pick -> the player actually taken at that slot (real value, not estimated).
      if (cp && cp.made && cp.madePick) {
        const mp = cp.madePick;
        let val: number | null = null;
        if (mp.playerId && valByPlayerId.has(mp.playerId)) val = valByPlayerId.get(mp.playerId)!;
        else if (mp.sleeperPlayerId && valBySleeperId.has(mp.sleeperPlayerId)) {
          val = valBySleeperId.get(mp.sleeperPlayerId)!;
        }
        const posLabel = mp.position ? `, ${mp.position}` : "";
        return {
          key: `mp-${cp.overall}`,
          kind: "made-pick",
          label: `${cp.round}.${pad2(cp.pickInRound)} - ${madeName(mp)}`,
          detail: val !== null ? `Pick used${posLabel}` : `Pick used${posLabel} - no FF Beacon value`,
          value: val ?? 0,
          estimated: false,
          noValue: val === null,
          fromRosterId: pick.previousOwnerRosterId,
        };
      }
      // Known seat, not yet made -> the ADP simulation, the same map the trade
      // builder and resolveDraftAsset read. This used to walk the board in VALUE
      // order with a 50-point floor, so one draft slot carried two different
      // players and two different prices depending on which tab you were
      // looking at, and the awards and the trades component of the draft grades
      // were valued by the one nobody else used.
      if (cp && !cp.made) {
        const projected = ctx.simulated?.get(cp.overall) ?? null;
        return {
          key: `up-${cp.overall}`,
          kind: "upcoming-pick",
          label: `${cp.round}.${pad2(cp.pickInRound)} pick`,
          detail: projected
            ? `Projected: ${projected.player.name}, ${projected.player.position}`
            : "The board runs out before this pick",
          value: projected ? projected.player.value : 0,
          estimated: true,
          noValue: !projected,
          fromRosterId: pick.previousOwnerRosterId,
        };
      }
      // Current season but the seat is unknown (cold/odd draft): generic round bucket.
      const idx = (round - 1) * teams + bucketSlot("mid", teams) - 1;
      const projected = projectAt(poolSorted, idx);
      return {
        key: `cur-${season}-${round}-${pick.originalRosterId}`,
        kind: "future-pick",
        label: `${season} ${ordinal(round)}`,
        detail: "Estimated pick",
        value: projected ? projected.value : FALLBACK_PICK_VALUE,
        estimated: true,
        noValue: false,
        fromRosterId: pick.previousOwnerRosterId,
      };
    }

    // Future-season pick: the real FF Beacon value for that season/round (mid bucket,
    // since the exact slot is unknown until that draft). No projection, no discount.
    // A pick FF Beacon does not publish a value for (e.g. a past season, or a redraft
    // format) is marked noValue rather than fabricated.
    const val = lookupPickValue(pickLookup, season, round, "mid");
    return {
      key: `fut-${season}-${round}-${pick.originalRosterId}`,
      kind: "future-pick",
      label: `${season} ${ordinal(round)}`,
      detail: val !== null ? "FF Beacon pick value" : "No FF Beacon value",
      value: val ?? 0,
      estimated: false,
      noValue: val === null,
      fromRosterId: pick.previousOwnerRosterId,
    };
  };

  // Participating rosters: roster_ids first, then anyone who received an asset.
  const rosterSet = new Set<number>(txn.rosterIds);
  for (const r of Object.values(txn.adds)) rosterSet.add(r);
  for (const p of txn.picks) if (p.newOwnerRosterId != null) rosterSet.add(p.newOwnerRosterId);
  for (const f of txn.faab) rosterSet.add(f.receiver);
  const rosterIds = [...rosterSet].sort((a, b) => a - b);

  const sides: HistorySide[] = rosterIds.map((rosterId) => {
    const assets: HistoryAsset[] = [];

    // Players received.
    for (const [sleeperId, toRoster] of Object.entries(txn.adds)) {
      if (toRoster !== rosterId) continue;
      const meta = playerBySleeperId.get(sleeperId);
      assets.push(
        meta
          ? {
              key: `pl-${sleeperId}`,
              kind: "player",
              label: `${meta.name}, ${meta.position}`,
              detail: meta.team ?? undefined,
              value: meta.value,
              estimated: false,
              noValue: false,
              fromRosterId: txn.drops[sleeperId] ?? null,
            }
          : {
              key: `pl-${sleeperId}`,
              kind: "player",
              label: "Player off the board",
              detail: "No FF Beacon value",
              value: 0,
              estimated: false,
              noValue: true,
              fromRosterId: txn.drops[sleeperId] ?? null,
            },
      );
    }

    // Picks received.
    for (const pick of txn.picks) {
      if (pick.newOwnerRosterId !== rosterId) continue;
      assets.push(valuePick(pick));
    }

    // FAAB received (informational; dollars, not value points).
    let faabIn = 0;
    for (const f of txn.faab) if (f.receiver === rosterId) faabIn += f.amount;

    const total = assets.reduce((s, a) => s + a.value, 0);
    return {
      rosterId,
      teamName: ctx.teamNameByRosterId[rosterId] ?? `Team ${rosterId}`,
      isYou: ctx.myRosterId != null && rosterId === ctx.myRosterId,
      assets,
      faabIn,
      total,
      hasEstimates: assets.some((a) => a.estimated),
      hasMissingValues: assets.some((a) => a.noValue),
      leads: false,
    };
  });

  const verdict = computeVerdict(sides);
  for (const s of sides) s.leads = verdict.winnerRosterId != null && s.rosterId === verdict.winnerRosterId;

  return {
    transactionId: txn.transactionId,
    week: txn.week,
    createdAt: txn.createdAt,
    sides,
    verdict,
    hasEstimates: sides.some((s) => s.hasEstimates),
    hasMissingValues: sides.some((s) => s.hasMissingValues),
  };
}

/**
 * Plain-English verdict. Thresholds mirror the site analyzer: within 5% is fair,
 * within 15% is a slight edge, beyond that a strong edge. For a multi-team trade we
 * compare the top side against the next-best side and name the leader.
 */
function computeVerdict(sides: HistorySide[]): HistoryVerdict {
  if (sides.length < 2 || sides.every((s) => s.total === 0)) {
    return {
      lean: "empty",
      headline: "Not enough value data",
      detail:
        "We could not value enough of this trade from the FF Beacon board to call a winner.",
      winnerRosterId: null,
    };
  }

  const sorted = [...sides].sort((a, b) => b.total - a.total);
  const top = sorted[0];
  const second = sorted[1];
  const diff = top.total - second.total;
  const max = Math.max(top.total, 1);
  const diffPct = (diff / max) * 100;
  const pctLabel = `${Math.round(diffPct)}%`;
  const diffLabel = Math.round(diff).toLocaleString();
  const estimateNote = sides.some((s) => s.hasEstimates)
    ? " Some pick values are projections, so treat this as a rough signal."
    : "";
  const multi = sides.length > 2 ? " (multi-team trade)" : "";

  if (diffPct <= 5) {
    return {
      lean: "fair",
      headline: "Fair deal",
      detail: `Both sides land within ${pctLabel} of each other (${diffLabel} points apart). By FF Beacon value this was an even swap${multi}.${estimateNote}`,
      winnerRosterId: null,
    };
  }

  const strong = diffPct > 15;
  return {
    lean: strong ? "strong" : "slight",
    headline: strong ? `${top.teamName} won the trade` : `Slight edge: ${top.teamName}`,
    detail: `${top.teamName} came away with about ${pctLabel} more value (${diffLabel} points)${multi}. This is a value signal, not a recommendation.${estimateNote}`,
    winnerRosterId: top.rosterId,
  };
}
