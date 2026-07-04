/**
 * On The Clock startup-draft awards (Rankings & Awards tab).
 *
 * Pure, browser-safe, deterministic. NOTHING here touches Sleeper, Supabase, or
 * fetch. It turns the data the cockpit already holds (per-team rollups, the
 * league's completed trades, the made picks, and the league's starting-slot model)
 * into six live awards that re-resolve on every resync:
 *   - Most Active Trader      (The Signal Flare Award): most completed trades.
 *   - Most Successful Trader  (The Value Beacon Award): best AVERAGE FF Beacon value
 *     margin per trade (value received minus value given, averaged over their trades),
 *     gated to a minimum trade count so trade volume alone cannot win it.
 *   - First to Fill Starting Roster (The Full Beam Award): first team to fill every
 *     required starting slot, by overall pick number.
 *   - Most Boring League Mate (The Dead Air Award): fewest completed trades.
 *   - Best Drafter            (The North Star Award): most draft value captured
 *     versus Sleeper ADP (sum of pick_no - ADP across the team's non-keeper
 *     picks with a known ADP). Rewards beating the market, not raw totals.
 *   - Worst Drafter           (The Lost Signal Award): the exact mirror. Lowest
 *     total pick_no - ADP: the drafter who reached earliest and most often,
 *     losing the most value against the market.
 *
 * Trade values reuse trade-history.ts analyzeTradeTransaction (the same FF Beacon
 * board projection the Trade History tab uses), so there is no DB round trip and no
 * dependence on KTC pick values. Best / Worst Drafter share ONE per-roster total of
 * (pick_no - ADP) over ADP-known, non-keeper picks; North Star takes the max and
 * Lost Signal the min, so both judge market timing, not raw roster value.
 *
 * Every award stays "up for grabs" until it can be earned honestly: trade awards
 * until at least one trade exists and there is a standout, the drafter awards until
 * at least two teams have ADP-known picks with distinct totals, and the
 * starting-roster award until a team actually completes its lineup. Exact ties
 * surface every co-winner.
 */

import type { DraftPosition } from "./board-types";
import type { OnTheClockSettings, ShapedPick } from "./types";
import type { TeamRollup } from "./rosters";
import {
  analyzeTradeTransaction,
  type HistoryTransaction,
  type TradeHistoryContext,
} from "./trade-history";
import { buildSlotModel, assignToSlots } from "./recommend";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export type AwardId =
  | "most-active-trader"
  | "most-successful-trader"
  | "first-starting-roster"
  | "most-boring"
  | "best-drafter"
  | "worst-drafter";

/** One team that currently holds an award (usually one; more on an exact tie). */
export interface AwardClaimant {
  rosterId: number;
  /** Owner's Sleeper username / display name (the primary label). */
  ownerName: string;
  /** Custom team name shown subtly after the username, or null. */
  teamName: string | null;
  /** Raw Sleeper avatar id (owner avatar), or null. The UI builds the URL. */
  avatar: string | null;
  isYou: boolean;
}

export interface Award {
  id: AwardId;
  /** The flavor name, e.g. "The Signal Flare Award". */
  title: string;
  /** The plain category, e.g. "Most Active Trader". */
  category: string;
  /** One-line description of how it is earned. */
  description: string;
  /** Winning team(s). Empty when pending. */
  claimants: AwardClaimant[];
  /** Short human metric for the winner(s), e.g. "3 trades". null when pending. */
  metricLabel: string | null;
  /** True when no team qualifies yet (the award is up for grabs). */
  pending: boolean;
  /** Why it is pending (shown on the card in the pending state). */
  pendingLabel: string;
}

export interface DraftAwardsInput {
  /** Per-team rollups (already ranked). Source of names + drafted-player value. */
  rollups: TeamRollup[];
  /** roster_id -> Sleeper avatar id (owner avatar). Missing -> null. */
  avatarByRosterId: Record<number, string | null>;
  /** Completed league trades (the route already drops failed ones). */
  transactions: HistoryTransaction[];
  /** Board/draft context for trade valuation. null -> the value award stays pending. */
  tradeContext: TradeHistoryContext | null;
  /** Every made pick in the current draft (drafted players, in any order). */
  picks: ShapedPick[];
  /** Sleeper draft.settings (slot counts + teams), for the starting-slot model. */
  draftSettings: Record<string, number>;
  /** Admin settings (fallback slot targets when the draft omits slot counts). */
  settings: OnTheClockSettings;
  /**
   * Sleeper player id -> ADP (overall pick number) for the draft's resolved ADP
   * market. Drives Best Drafter (value captured vs the market). Pass {} when no
   * ADP snapshot exists; the award then stays pending.
   */
  adpBySleeperId: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Coerce a Sleeper pick position string to one of the six draft buckets. */
function coercePosition(pos: string | null | undefined): DraftPosition | null {
  const p = (pos ?? "").toUpperCase();
  if (p === "QB" || p === "RB" || p === "WR" || p === "TE" || p === "K") return p;
  if (p === "DEF" || p === "DST") return "DEF";
  if (p === "PK") return "K";
  return null;
}

function fmtValue(v: number): string {
  return Math.round(v).toLocaleString();
}

function tradeWord(n: number): string {
  return `${n} ${n === 1 ? "trade" : "trades"}`;
}

/** Rosters that took part in a single trade (gave OR got any asset). */
function participants(txn: HistoryTransaction): Set<number> {
  const s = new Set<number>();
  for (const r of txn.rosterIds) s.add(r);
  for (const r of Object.values(txn.adds)) s.add(r);
  for (const r of Object.values(txn.drops)) s.add(r);
  for (const p of txn.picks) {
    if (p.newOwnerRosterId != null) s.add(p.newOwnerRosterId);
    if (p.previousOwnerRosterId != null) s.add(p.previousOwnerRosterId);
  }
  for (const f of txn.faab) {
    s.add(f.sender);
    s.add(f.receiver);
  }
  return s;
}

function buildClaimantBase(
  rollups: TeamRollup[],
  avatarByRosterId: Record<number, string | null>,
): Map<number, AwardClaimant> {
  const m = new Map<number, AwardClaimant>();
  for (const r of rollups) {
    m.set(r.rosterId, {
      rosterId: r.rosterId,
      ownerName: r.ownerName,
      teamName: r.teamName,
      avatar: avatarByRosterId[r.rosterId] ?? null,
      isYou: r.isYou,
    });
  }
  return m;
}

interface ExtremeResult {
  claimants: AwardClaimant[];
  extreme: number | null;
  /** True when every eligible team shares the extreme value (no standout). */
  allTied: boolean;
}

/**
 * The eligible team(s) holding the max/min of `values`. `allTied` is true when
 * every eligible team has the same value, which the callers treat as "no winner
 * yet" so an undifferentiated field (e.g. everyone at zero trades) reads as pending
 * rather than crowning the whole league.
 */
function pickExtreme(
  base: Map<number, AwardClaimant>,
  values: Map<number, number>,
  eligibleIds: number[],
  dir: "max" | "min",
): ExtremeResult {
  if (eligibleIds.length === 0) return { claimants: [], extreme: null, allTied: false };
  let extreme = values.get(eligibleIds[0]) ?? 0;
  for (const id of eligibleIds) {
    const v = values.get(id) ?? 0;
    if (dir === "max" ? v > extreme : v < extreme) extreme = v;
  }
  const winners = eligibleIds.filter((id) => (values.get(id) ?? 0) === extreme);
  const claimants = winners
    .map((id) => base.get(id))
    .filter((c): c is AwardClaimant => c != null)
    .sort((a, b) => a.rosterId - b.rosterId);
  return { claimants, extreme, allTied: winners.length === eligibleIds.length };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const ZERO_HAVE: Record<DraftPosition, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };

/**
 * Minimum completed-trade counts to qualify for Most Successful Trader, tried in
 * order. We start at 3 so a single lopsided trade cannot steal the award, then relax
 * to 2, then to any team that has traded, so a low-volume league still surfaces a
 * winner instead of leaving the award permanently up for grabs.
 */
const MIN_SUCCESSFUL_TRADER_TRADES = [3, 2, 1];

/**
 * Compute all six awards. Deterministic and side-effect free. Returns them in the
 * fixed product order (Signal Flare, Value Beacon, Full Beam, Dead Air, North Star,
 * Lost Signal). Callers render the array directly.
 */
export function computeDraftAwards(input: DraftAwardsInput): Award[] {
  const {
    rollups,
    avatarByRosterId,
    transactions,
    tradeContext,
    picks,
    draftSettings,
    settings,
    adpBySleeperId,
  } = input;

  const base = buildClaimantBase(rollups, avatarByRosterId);
  const rosterIds = rollups.map((r) => r.rosterId);
  const anyTrades = transactions.length > 0;

  // ---- Trade counts (board not required): participants per completed trade ----
  const tradeCount = new Map<number, number>();
  for (const id of rosterIds) tradeCount.set(id, 0);
  for (const txn of transactions) {
    for (const rid of participants(txn)) {
      if (tradeCount.has(rid)) tradeCount.set(rid, (tradeCount.get(rid) ?? 0) + 1);
    }
  }

  // ---- Per-trade value margin (needs the FF Beacon board context) ----
  // For each completed trade, a roster's margin is the value it received minus the
  // value it gave away in THAT trade. We track the running sum of those margins and
  // the count of trades each roster moved value in, so the Most Successful Trader can
  // be judged by AVERAGE margin per trade rather than a cumulative total (which just
  // tracks trade volume and would duplicate Most Active Trader).
  const rosterIdSet = new Set(rosterIds);
  const marginSum = new Map<number, number>();
  const marginTradeCount = new Map<number, number>();
  const netReady = tradeContext != null;
  if (tradeContext) {
    for (const txn of transactions) {
      const entry = analyzeTradeTransaction(txn, tradeContext);
      // Value received + value given per roster, within this single trade.
      const received = new Map<number, number>();
      const given = new Map<number, number>();
      for (const side of entry.sides) {
        received.set(side.rosterId, (received.get(side.rosterId) ?? 0) + side.total);
        for (const asset of side.assets) {
          if (asset.fromRosterId != null) {
            given.set(asset.fromRosterId, (given.get(asset.fromRosterId) ?? 0) + asset.value);
          }
        }
      }
      // Every roster that moved value in this trade records one per-trade margin.
      const involved = new Set<number>([...received.keys(), ...given.keys()]);
      for (const rid of involved) {
        if (!rosterIdSet.has(rid)) continue;
        const margin = (received.get(rid) ?? 0) - (given.get(rid) ?? 0);
        marginSum.set(rid, (marginSum.get(rid) ?? 0) + margin);
        marginTradeCount.set(rid, (marginTradeCount.get(rid) ?? 0) + 1);
      }
    }
  }

  // Average margin per trade, per roster (only rosters that actually moved value).
  const avgMargin = new Map<number, number>();
  for (const id of rosterIds) {
    const c = marginTradeCount.get(id) ?? 0;
    if (c > 0) avgMargin.set(id, (marginSum.get(id) ?? 0) / c);
  }

  // ---- ADP value captured (best AND worst drafter) ----
  // Per roster: sum of (pick_no - ADP) over its made, non-keeper picks with a
  // known Sleeper ADP. Positive = players landed later than the market expected
  // (discounts); negative = reaches. Keepers are excluded: their slot is
  // assigned, not a market decision. North Star takes the max; Lost Signal takes
  // the min of the same totals.
  const adpDeltaSum = new Map<number, number>();
  const adpPickCount = new Map<number, number>();
  for (const pk of picks) {
    if (pk.rosterId == null || pk.isKeeper) continue;
    const adp = pk.sleeperPlayerId ? adpBySleeperId[pk.sleeperPlayerId] : undefined;
    if (typeof adp !== "number" || !Number.isFinite(adp) || adp <= 0) continue;
    adpDeltaSum.set(pk.rosterId, (adpDeltaSum.get(pk.rosterId) ?? 0) + (pk.pickNo - adp));
    adpPickCount.set(pk.rosterId, (adpPickCount.get(pk.rosterId) ?? 0) + 1);
  }
  const adpEligibleIds = rosterIds.filter((id) => (adpPickCount.get(id) ?? 0) > 0);

  // ---- First to fill the starting lineup ----
  const completionPick = computeStartingRosterCompletion(picks, draftSettings, settings, base);

  const awards: Award[] = [];

  // 1. Most Active Trader — The Signal Flare Award.
  {
    const r = pickExtreme(base, tradeCount, rosterIds, "max");
    const pending = !anyTrades || r.allTied || r.extreme == null || r.extreme <= 0;
    awards.push({
      id: "most-active-trader",
      title: "The Signal Flare Award",
      category: "Most Active Trader",
      description: "Fires off the most completed trades during the draft.",
      claimants: pending ? [] : r.claimants,
      metricLabel: pending ? null : tradeWord(r.extreme!),
      pending,
      pendingLabel: "No trades have gone through yet. This one is up for grabs.",
    });
  }

  // 2. Most Successful Trader — The Value Beacon Award.
  {
    // Judge by AVERAGE value margin per trade, so the sharpest dealmaker wins rather
    // than simply the busiest trader. Qualify on a minimum trade count that relaxes
    // 3 -> 2 -> 1 when no team meets the higher bar (see MIN_SUCCESSFUL_TRADER_TRADES).
    let candidateIds: number[] = [];
    for (const threshold of MIN_SUCCESSFUL_TRADER_TRADES) {
      const ids = rosterIds.filter((id) => (marginTradeCount.get(id) ?? 0) >= threshold);
      if (ids.length > 0) {
        candidateIds = ids;
        break;
      }
    }
    const r = pickExtreme(base, avgMargin, candidateIds, "max");
    const pending =
      !netReady || !anyTrades || candidateIds.length === 0 || r.extreme == null || r.extreme <= 0;
    // Surface the winner's trade count beside the average when every co-winner shares
    // it (the common single-winner case); otherwise show the average alone.
    const winnerCounts = r.claimants.map((c) => marginTradeCount.get(c.rosterId) ?? 0);
    const sharedCount =
      winnerCounts.length > 0 && winnerCounts.every((c) => c === winnerCounts[0])
        ? winnerCounts[0]
        : null;
    awards.push({
      id: "most-successful-trader",
      title: "The Value Beacon Award",
      category: "Most Successful Trader",
      description: "Earns the best average FF Beacon value per trade across their deals.",
      claimants: pending ? [] : r.claimants,
      metricLabel: pending
        ? null
        : sharedCount != null
          ? `+${fmtValue(r.extreme!)} avg value per trade across ${tradeWord(sharedCount)}`
          : `+${fmtValue(r.extreme!)} avg value per trade`,
      pending,
      pendingLabel: netReady
        ? "No team has a winning trade average yet. Up for grabs."
        : "Trade values are still loading.",
    });
  }

  // 3. First to Fill Starting Roster — The Full Beam Award.
  {
    const completedIds = [...completionPick.keys()];
    const pending = completedIds.length === 0;
    let claimants: AwardClaimant[] = [];
    let metricLabel: string | null = null;
    if (!pending) {
      let minPick = Infinity;
      for (const v of completionPick.values()) minPick = Math.min(minPick, v);
      claimants = completedIds
        .filter((id) => completionPick.get(id) === minPick)
        .map((id) => base.get(id))
        .filter((c): c is AwardClaimant => c != null)
        .sort((a, b) => a.rosterId - b.rosterId);
      metricLabel = `Filled at pick ${minPick}`;
    }
    awards.push({
      id: "first-starting-roster",
      title: "The Full Beam Award",
      category: "First to Fill Starting Roster",
      description: "First team to fill every required starting spot.",
      claimants,
      metricLabel,
      pending,
      pendingLabel: "No team has filled every starting spot yet. Up for grabs.",
    });
  }

  // 4. Most Boring League Mate — The Dead Air Award.
  {
    const r = pickExtreme(base, tradeCount, rosterIds, "min");
    const pending = !anyTrades || r.allTied || r.extreme == null;
    awards.push({
      id: "most-boring",
      title: "The Dead Air Award",
      category: "Most Boring League Mate",
      description: "Makes the fewest trades while the rest of the league wheels and deals.",
      claimants: pending ? [] : r.claimants,
      metricLabel: pending ? null : tradeWord(r.extreme!),
      pending,
      pendingLabel: "Nobody has traded yet, so no one is in the doghouse.",
    });
  }

  // 5. Best Drafter (The North Star Award). Judged against the market: the team
  // that captured the most total draft value versus Sleeper ADP (sum of
  // pick_no - ADP across its picks) wins, so consistently landing players after
  // their ADP beats simply hoarding the biggest names. Uses the ADP map the
  // caller resolved for THIS draft (the locked snapshot for completed drafts),
  // never live market data.
  {
    const r = pickExtreme(base, adpDeltaSum, adpEligibleIds, "max");
    const noAdp = Object.keys(adpBySleeperId).length === 0 || adpEligibleIds.length === 0;
    const pending = noAdp || adpEligibleIds.length < 2 || r.allTied || r.extreme == null;
    const winnerCounts = r.claimants.map((c) => adpPickCount.get(c.rosterId) ?? 0);
    const sharedCount =
      winnerCounts.length > 0 && winnerCounts.every((c) => c === winnerCounts[0])
        ? winnerCounts[0]
        : null;
    const signed = r.extreme == null ? "" : `${r.extreme >= 0 ? "+" : "-"}${fmtValue(Math.abs(r.extreme))}`;
    awards.push({
      id: "best-drafter",
      title: "The North Star Award",
      category: "Best Drafter",
      description: "Finds the most draft value compared to Sleeper ADP.",
      claimants: pending ? [] : r.claimants,
      metricLabel: pending
        ? null
        : sharedCount != null
          ? `${signed} picks of ADP value across ${sharedCount} ${sharedCount === 1 ? "pick" : "picks"}`
          : `${signed} picks of ADP value`,
      pending,
      pendingLabel: noAdp
        ? "Sleeper ADP is not available for this draft yet, so no one has earned this."
        : "Not enough teams have made picks with a known ADP yet.",
    });
  }

  // 6. Worst Drafter (The Lost Signal Award). The exact mirror of North Star:
  // the team with the LOWEST total draft value versus Sleeper ADP (sum of
  // pick_no - ADP across its picks), i.e. the drafter who consistently reached
  // for players well before the market expected them to go. Uses the same
  // per-draft ADP map (the locked snapshot for completed drafts), so the loser
  // is as stable as the winner.
  {
    const r = pickExtreme(base, adpDeltaSum, adpEligibleIds, "min");
    const noAdp = Object.keys(adpBySleeperId).length === 0 || adpEligibleIds.length === 0;
    const pending = noAdp || adpEligibleIds.length < 2 || r.allTied || r.extreme == null;
    const loserCounts = r.claimants.map((c) => adpPickCount.get(c.rosterId) ?? 0);
    const sharedCount =
      loserCounts.length > 0 && loserCounts.every((c) => c === loserCounts[0])
        ? loserCounts[0]
        : null;
    const signed = r.extreme == null ? "" : `${r.extreme >= 0 ? "+" : "-"}${fmtValue(Math.abs(r.extreme))}`;
    awards.push({
      id: "worst-drafter",
      title: "The Lost Signal Award",
      category: "Worst Drafter",
      description: "Loses the most draft value compared to Sleeper ADP by reaching early.",
      claimants: pending ? [] : r.claimants,
      metricLabel: pending
        ? null
        : sharedCount != null
          ? `${signed} picks of ADP value across ${sharedCount} ${sharedCount === 1 ? "pick" : "picks"}`
          : `${signed} picks of ADP value`,
      pending,
      pendingLabel: noAdp
        ? "Sleeper ADP is not available for this draft yet, so no one is on the hook."
        : "Not enough teams have made picks with a known ADP yet.",
    });
  }

  return awards;
}

/**
 * For each team, the overall pick number at which it first filled every required
 * starting slot (dedicated + FLEX + SUPER_FLEX + K/DEF, per the league's slot
 * model). Teams that have not completed their lineup are absent from the map.
 */
function computeStartingRosterCompletion(
  picks: ShapedPick[],
  draftSettings: Record<string, number>,
  settings: OnTheClockSettings,
  base: Map<number, AwardClaimant>,
): Map<number, number> {
  const model = buildSlotModel(draftSettings, settings);
  const totalSlots =
    model.QB + model.RB + model.WR + model.TE + model.FLEX + model.SUPER_FLEX + model.K + model.DEF;
  const completion = new Map<number, number>();
  if (totalSlots <= 0) return completion;

  // Group each team's made picks (with a coercible position) ascending by pick no.
  // A pick whose position will not coerce (an unmapped player with no position in
  // the cached metadata) is skipped, so a team holding such a starter could have its
  // Full Beam completion delayed until that slot is filled by a mappable pick. This
  // is rare (the sync resolves most ids) and degrades safely toward "not yet filled".
  const byRoster = new Map<number, { pickNo: number; pos: DraftPosition }[]>();
  for (const pk of picks) {
    if (pk.rosterId == null || !base.has(pk.rosterId)) continue;
    const pos = coercePosition(pk.position);
    if (!pos) continue;
    const arr = byRoster.get(pk.rosterId) ?? [];
    arr.push({ pickNo: pk.pickNo, pos });
    byRoster.set(pk.rosterId, arr);
  }

  for (const [rid, list] of byRoster) {
    const sorted = list.slice().sort((a, b) => a.pickNo - b.pickNo);
    const have: Record<DraftPosition, number> = { ...ZERO_HAVE };
    for (const item of sorted) {
      have[item.pos] += 1;
      const open = assignToSlots(have, model);
      const remaining =
        open.QB + open.RB + open.WR + open.TE + open.FLEX + open.SUPER_FLEX + open.K + open.DEF;
      if (remaining === 0) {
        completion.set(rid, item.pickNo);
        break;
      }
    }
  }
  return completion;
}
