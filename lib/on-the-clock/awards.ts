/**
 * On The Clock startup-draft awards (Rankings & Awards tab).
 *
 * Pure, browser-safe, deterministic. NOTHING here touches Sleeper, Supabase, or
 * fetch. It turns the data the cockpit already holds (per-team rollups, the
 * league's completed trades, the made picks, and the league's starting-slot model)
 * into six live awards that re-resolve on every resync:
 *   - Most Active Trader      (The Signal Flare Award): most completed trades.
 *   - Most Successful Trader  (The Value Beacon Award): highest net FF Beacon value
 *     gained across completed trades (value received minus value given).
 *   - First to Fill Starting Roster (The Full Beam Award): first team to fill every
 *     required starting slot, by overall pick number.
 *   - Most Boring League Mate (The Dead Air Award): fewest completed trades.
 *   - Best Drafter            (The North Star Award): highest drafted-player value.
 *   - Worst Drafter           (The Lost Signal Award): lowest drafted-player value.
 *
 * Trade values reuse trade-history.ts analyzeTradeTransaction (the same FF Beacon
 * board projection the Trade History tab uses), so there is no DB round trip and no
 * dependence on KTC pick values. Best / Worst Drafter measure DRAFTED-player value
 * only (rollup.playersValue), which is distinct from the power-ranking total (which
 * also folds in equal-baseline future picks) and is the truer "who drafted well"
 * signal early in a startup.
 *
 * Every award stays "up for grabs" until it can be earned honestly: trade awards
 * until at least one trade exists and there is a standout, the drafter awards until
 * at least two teams have drafted distinct values, and the starting-roster award
 * until a team actually completes its lineup. Exact ties surface every co-winner.
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
 * Compute all six awards. Deterministic and side-effect free. Returns them in the
 * fixed product order (Signal Flare, Value Beacon, Full Beam, Dead Air, North Star,
 * Lost Signal). Callers render the array directly.
 */
export function computeDraftAwards(input: DraftAwardsInput): Award[] {
  const { rollups, avatarByRosterId, transactions, tradeContext, picks, draftSettings, settings } =
    input;

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

  // ---- Net trade value (needs the FF Beacon board context) ----
  // net(roster) = sum(received) - sum(given) across every completed trade.
  const net = new Map<number, number>();
  for (const id of rosterIds) net.set(id, 0);
  const netReady = tradeContext != null;
  if (tradeContext) {
    for (const txn of transactions) {
      const entry = analyzeTradeTransaction(txn, tradeContext);
      for (const side of entry.sides) {
        if (net.has(side.rosterId)) {
          net.set(side.rosterId, (net.get(side.rosterId) ?? 0) + side.total);
        }
        for (const asset of side.assets) {
          if (asset.fromRosterId != null && net.has(asset.fromRosterId)) {
            net.set(asset.fromRosterId, (net.get(asset.fromRosterId) ?? 0) - asset.value);
          }
        }
      }
    }
  }

  // ---- Drafted-player value (best / worst drafter) ----
  const playersValue = new Map<number, number>();
  for (const r of rollups) playersValue.set(r.rosterId, r.playersValue);
  const draftedIds = rollups.filter((r) => r.playerCount > 0).map((r) => r.rosterId);

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
    const r = pickExtreme(base, net, rosterIds, "max");
    const pending = !netReady || !anyTrades || r.allTied || r.extreme == null || r.extreme <= 0;
    awards.push({
      id: "most-successful-trader",
      title: "The Value Beacon Award",
      category: "Most Successful Trader",
      description: "Gains the most FF Beacon value across completed trades.",
      claimants: pending ? [] : r.claimants,
      metricLabel: pending ? null : `+${fmtValue(r.extreme!)} value`,
      pending,
      pendingLabel: netReady
        ? "No trade has come out ahead yet. Up for grabs."
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

  // 5. Best Drafter — The North Star Award.
  {
    const r = pickExtreme(base, playersValue, draftedIds, "max");
    const pending = draftedIds.length < 2 || r.allTied || r.extreme == null;
    awards.push({
      id: "best-drafter",
      title: "The North Star Award",
      category: "Best Drafter",
      description: "Holds the highest drafted-player FF Beacon value.",
      claimants: pending ? [] : r.claimants,
      metricLabel: pending ? null : `${fmtValue(r.extreme!)} drafted value`,
      pending,
      pendingLabel: "Not enough teams have drafted yet.",
    });
  }

  // 6. Worst Drafter — The Lost Signal Award.
  {
    const r = pickExtreme(base, playersValue, draftedIds, "min");
    const pending = draftedIds.length < 2 || r.allTied || r.extreme == null;
    awards.push({
      id: "worst-drafter",
      title: "The Lost Signal Award",
      category: "Worst Drafter",
      description: "Holds the lowest drafted-player FF Beacon value.",
      claimants: pending ? [] : r.claimants,
      metricLabel: pending ? null : `${fmtValue(r.extreme!)} drafted value`,
      pending,
      pendingLabel: "Not enough teams have drafted yet.",
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
