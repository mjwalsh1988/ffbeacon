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
 *   - Best Drafter            (The North Star Award): most SURPLUS VALUE captured
 *     against the market (see surplus.ts). Rewards beating the market where a
 *     pick is expensive, not simply holding more picks.
 *   - Worst Drafter           (The Lost Signal Award): the exact mirror, lowest
 *     surplus: the drafter who paid the most over the market price.
 *
 * Plus seven that only became possible once the room could project points
 * (draft-pulse.ts) and read projection accuracy:
 *   - Best Starting Lineup    (The Full Signal Award): highest Draft Pulse.
 *   - Best Long-Term Build    (The Long Game Award): dynasty only. Owns the most
 *     and wins the least right now. That gap IS the rebuild.
 *   - Most Reliable Roster    (The Sure Thing Award): highest points-weighted
 *     beat rate among projected starters.
 *   - Most Volatile Roster    (The Glass Cannon Award): highest weekly spread
 *     relative to the mean.
 *   - Most Available Roster   (The Iron Man Award): highest weighted availability.
 *   - Best Single Pick        (The Steal of the Draft): largest single surplus.
 *   - Biggest Single Reach    (The Reach of the Draft): the mirror.
 *
 * Trade values reuse trade-history.ts analyzeTradeTransaction, the same FF Beacon
 * board projection the Trade History tab uses, so an award and the tab can never
 * disagree about who won a deal, and no DB round trip is needed. The interactive
 * Trade Analyzer routes through Signal Check instead, because a trade the user is
 * BUILDING deserves the full ruleset; grading a league's whole completed trade
 * history through it would mean one server analysis per historical trade to fill
 * in a card.
 *
 * Best / Worst Drafter share ONE per-roster surplus total (surplus.ts); North Star
 * takes the max and Lost Signal the min, so both judge market timing rather than
 * raw roster value.
 *
 * Every award stays "up for grabs" until it can be earned honestly: trade awards
 * until at least one trade exists and there is a standout, the drafter awards until
 * at least two teams have ADP-known picks with distinct totals, and the
 * starting-roster award until a team actually completes its lineup. Exact ties
 * surface every co-winner.
 */

import type { DraftPosition, RankedPlayer } from "./board-types";
import type { OnTheClockSettings, ShapedPick } from "./types";
import type { DraftPulseTeam } from "./draft-pulse";
import { PULSE_POSITIONS } from "@/lib/power-pulse/types";
import {
  buildMarketCurve,
  computePickSurplus,
  surplusByRoster,
  type PickSurplus,
} from "./surplus";
import { tradeMarginsFor } from "./trade-margins";
import type { TeamRollup } from "./rosters";
import {
  analyzeTradeTransaction,
  type HistoryTransaction,
  type TradeHistoryContext,
} from "./trade-history";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export type AwardId =
  | "most-active-trader"
  | "most-successful-trader"
  | "most-boring"
  | "best-drafter"
  | "worst-drafter"
  | "best-starting-lineup"
  | "long-game"
  | "most-reliable"
  | "boom-bust"
  | "iron-man"
  | "steal-of-draft"
  | "reach-of-draft"
  | "round-steals"
  | "most-balanced"
  | "most-top-heavy"
  | "bye-week-nightmare"
  | "against-the-room"
  | "late-round-haul"
  | "toughest-schedule"
  | "scarcity-read";

/**
 * Retired, and kept only so an old snapshot still renders.
 *
 * "first-starting-roster" measured who completed a legal starting lineup
 * earliest. In a snake draft that is close to noise: it mostly rewards taking a
 * kicker in the ninth round, which is a bad decision the award was congratulating.
 * Nothing emits it any more; version 1 and 2 snapshots still carry it and the UI
 * still needs an icon for it.
 */
export type RetiredAwardId = "first-starting-roster";

/**
 * The award-set contract version frozen into a snapshot. A snapshot written
 * before the projection-backed awards existed is version 1 and renders the
 * original six rather than a grid with seven permanently empty cards.
 */
export const AWARDS_VERSION = 3;

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
  /**
   * For the two pick awards, the single pick that earned it. Absent on team
   * awards. Rendered under the claimant so the card names the actual moment.
   */
  pickHighlight?: {
    playerName: string;
    position: string | null;
    pickNo: number;
    /** Signed surplus, already rounded for display. */
    surplus: number;
  } | null;
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
   * market. Kept for the board indicators and the pending copy. Pass {} when no
   * ADP snapshot exists; the drafting awards then stay pending.
   */
  adpBySleeperId: Record<string, number>;
  /**
   * The FULL board, used to build the market price curve for surplus value and
   * to value each made pick. Empty leaves the drafting awards pending.
   */
  board: RankedPlayer[];
  /** Draft Pulse standings, when projections were available. Empty is fine. */
  pulseTeams: DraftPulseTeam[];
  /** True for a dynasty format; gates the dynasty-only Long Game award. */
  isDynasty: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Coerce a Sleeper pick position string to one of the six draft buckets. */
function coercePosition(pos: string | null | undefined): DraftPosition | null {
  const p = (pos ?? "").toUpperCase();
  if (p === "QB" || p === "RB" || p === "WR" || p === "TE" || p === "K")
    return p;
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
  if (eligibleIds.length === 0)
    return { claimants: [], extreme: null, allTied: false };
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

/**
 * Which round a pick number falls in.
 *
 * Snake or linear makes no difference to the arithmetic: Sleeper numbers picks
 * straight through, so round is just the pick divided by the room size. A team
 * count of zero or less would divide by nothing, so it falls back to one round,
 * which reports every pick as round 1 rather than throwing.
 */
export function roundOfPick(pickNo: number, teams: number): number {
  if (!Number.isFinite(pickNo) || pickNo < 1) return 1;
  if (!Number.isFinite(teams) || teams < 1) return 1;
  return Math.floor((pickNo - 1) / teams) + 1;
}

/** The last round anyone actually picked in. */
export function lastRound(
  picks: ReadonlyArray<PickSurplus>,
  teams: number,
): number {
  let last = 0;
  for (const p of picks) last = Math.max(last, roundOfPick(p.pickNo, teams));
  return last;
}

/**
 * How much of a roster's haul came from taking a player the room could not
 * easily replace at that position.
 *
 * The measurement, per pick: the gap between the player taken and the NEXT
 * player at the same position taken anywhere in the draft. A big gap means the
 * shelf emptied right behind them, which is the whole reason to reach at a
 * scarce position; a small gap means someone just as good was available a round
 * later and the pick bought nothing but comfort.
 *
 * Only positive gaps count. A pick with a better player at the same position
 * taken after it is not evidence of a bad read; it is evidence that the room
 * had depth there, which the pick itself did not create.
 *
 * Deliberately NOT called anything with WAR in it. CLAUDE.md reserves that token
 * for the player-independent positional metric, and this measures one roster.
 */
export function scarcityCaptureByRoster(
  picks: ReadonlyArray<PickSurplus>,
): Map<number, number> {
  const byPosition = new Map<string, PickSurplus[]>();
  for (const pick of picks) {
    const position = (pick.position ?? "").toUpperCase();
    if (!position) continue;
    const list = byPosition.get(position) ?? [];
    list.push(pick);
    byPosition.set(position, list);
  }

  const out = new Map<number, number>();
  for (const list of byPosition.values()) {
    const ordered = list.slice().sort((a, b) => a.pickNo - b.pickNo);
    for (let i = 0; i < ordered.length; i += 1) {
      const mine = ordered[i];
      const next = ordered[i + 1];
      if (!next) continue;
      const gap = mine.value - next.value;
      if (gap <= 0) continue;
      out.set(mine.rosterId, (out.get(mine.rosterId) ?? 0) + gap);
    }
  }
  return out;
}

/** Max minus min across the eligible teams. Zero for fewer than two of them. */
function spreadOfValues(
  values: Map<number, number>,
  eligibleIds: number[],
): number {
  if (eligibleIds.length < 2) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const id of eligibleIds) {
    const v = values.get(id);
    if (v === undefined) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return Number.isFinite(min) && Number.isFinite(max) ? max - min : 0;
}

/**
 * Six points of beat rate, roughly two standard errors on a team-level figure.
 * Below it the field is too close to name a winner honestly.
 */
const RELIABILITY_MIN_SPREAD = 0.06;

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * The Most Successful Trader ladder, seeded from the admin's configured minimum.
 * It relaxes one step at a time down to a single trade, so a low-volume league
 * still surfaces a winner rather than leaving the award permanently up for
 * grabs. The original hardcoded default was 3, which is where the admin setting
 * starts: high enough that a single lopsided trade cannot steal the award.
 */
function traderThresholds(minimum: number): number[] {
  const start = Math.max(1, Math.round(minimum));
  const out: number[] = [];
  for (let n = start; n >= 1; n -= 1) out.push(n);
  return out;
}

/**
 * Compute every award. Deterministic and side-effect free. Returns them in the
 * fixed product order, with any award the admin has switched off removed.
 * Callers render the array directly.
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
    board,
    pulseTeams,
    isDynasty,
  } = input;

  const base = buildClaimantBase(rollups, avatarByRosterId);
  const rosterIds = rollups.map((r) => r.rosterId);
  // The room size, which is what turns a pick number into a round. Sleeper's own
  // draft settings carry it; a league whose settings did not come through falls
  // back to the number of rollups, which is the same number in every draft that
  // has not lost a team mid-season.
  const teamsInDraft =
    Number(draftSettings.teams) > 0
      ? Number(draftSettings.teams)
      : rosterIds.length;
  const anyTrades = transactions.length > 0;

  // ---- Trade counts (board not required): participants per completed trade ----
  const tradeCount = new Map<number, number>();
  for (const id of rosterIds) tradeCount.set(id, 0);
  for (const txn of transactions) {
    for (const rid of participants(txn)) {
      if (tradeCount.has(rid))
        tradeCount.set(rid, (tradeCount.get(rid) ?? 0) + 1);
    }
  }

  // ---- Per-trade value margin (needs the FF Beacon board context) ----
  // For each completed trade, a roster's margin is the value it received minus the
  // value it gave away in THAT trade. We track the running sum of those margins and
  // the count of trades each roster moved value in, so the Most Successful Trader can
  // be judged by AVERAGE margin per trade rather than a cumulative total (which just
  // tracks trade volume and would duplicate Most Active Trader).
  // ONE per-roster margin computation, shared with the draft grades (see
  // trade-margins.ts). It used to be duplicated here, which meant an award and a
  // grade could quietly disagree about who won a deal.
  const rosterIdSet = new Set(rosterIds);
  const marginSum = new Map<number, number>();
  const marginTradeCount = new Map<number, number>();
  const netReady = tradeContext != null;
  for (const [rosterId, margin] of tradeMarginsFor(
    transactions,
    tradeContext,
  )) {
    if (!rosterIdSet.has(rosterId)) continue;
    marginSum.set(rosterId, margin.total);
    marginTradeCount.set(rosterId, margin.trades);
  }

  // Average margin per trade, per roster (only rosters that actually moved value).
  const avgMargin = new Map<number, number>();
  for (const id of rosterIds) {
    const c = marginTradeCount.get(id) ?? 0;
    if (c > 0) avgMargin.set(id, (marginSum.get(id) ?? 0) / c);
  }

  // ---- Surplus value against the market (best AND worst drafter) ----
  // Per roster: the sum, over its made non-keeper picks, of what the player was
  // worth minus what the market said that slot was worth (see surplus.ts). This
  // replaced a sum of (pick_no - ADP), which rewarded holding more picks and
  // valued a round-one bargain the same as a round-fourteen one. Keepers are
  // excluded: their slot is assigned, not a market decision. North Star takes
  // the max; Lost Signal takes the min of the same totals.
  const valueByPlayerId = new Map<string, number>();
  const valueBySleeperId = new Map<string, number>();
  for (const p of board) {
    valueByPlayerId.set(p.playerId, p.value);
    if (p.sleeperId) valueBySleeperId.set(p.sleeperId, p.value);
  }
  const curve = buildMarketCurve(board);
  const pickSurpluses = computePickSurplus({
    picks,
    valueByPlayerId,
    valueBySleeperId,
    curve,
  });
  const surplusTotals = surplusByRoster(pickSurpluses);
  const adpDeltaSum = new Map<number, number>();
  const adpPickCount = new Map<number, number>();
  for (const [rosterId, entry] of surplusTotals) {
    adpDeltaSum.set(rosterId, entry.total);
    adpPickCount.set(rosterId, entry.count);
  }
  const minAdpPicks = Math.max(1, settings.awards.minAdpPicks);
  const adpEligibleIds = rosterIds.filter(
    (id) => (adpPickCount.get(id) ?? 0) >= minAdpPicks,
  );

  // ---- First to fill the starting lineup ----

  const awards: Award[] = [];

  // 1. Most Active Trader, The Signal Flare Award.
  {
    const r = pickExtreme(base, tradeCount, rosterIds, "max");
    const pending =
      !anyTrades || r.allTied || r.extreme == null || r.extreme <= 0;
    awards.push({
      id: "most-active-trader",
      title: "The Signal Flare Award",
      category: "Most Active Trader",
      description: "Fires off the most completed trades during the draft.",
      claimants: pending ? [] : r.claimants,
      metricLabel: pending ? null : tradeWord(r.extreme!),
      pending,
      pendingLabel:
        "No trades have gone through yet. This one is up for grabs.",
    });
  }

  // 2. Most Successful Trader, The Value Beacon Award.
  {
    // Judge by AVERAGE value margin per trade, so the sharpest dealmaker wins rather
    // than simply the busiest trader. Qualify on a minimum trade count that relaxes
    // 3 -> 2 -> 1 when no team meets the higher bar (see traderThresholds).
    let candidateIds: number[] = [];
    for (const threshold of traderThresholds(
      settings.awards.minSuccessfulTraderTrades,
    )) {
      const ids = rosterIds.filter(
        (id) => (marginTradeCount.get(id) ?? 0) >= threshold,
      );
      if (ids.length > 0) {
        candidateIds = ids;
        break;
      }
    }
    const r = pickExtreme(base, avgMargin, candidateIds, "max");
    const pending =
      !netReady ||
      !anyTrades ||
      candidateIds.length === 0 ||
      r.extreme == null ||
      r.extreme <= 0;
    // Surface the winner's trade count beside the average when every co-winner shares
    // it (the common single-winner case); otherwise show the average alone.
    const winnerCounts = r.claimants.map(
      (c) => marginTradeCount.get(c.rosterId) ?? 0,
    );
    const sharedCount =
      winnerCounts.length > 0 &&
      winnerCounts.every((c) => c === winnerCounts[0])
        ? winnerCounts[0]
        : null;
    awards.push({
      id: "most-successful-trader",
      title: "The Value Beacon Award",
      category: "Most Successful Trader",
      description:
        "Earns the best average FF Beacon value per trade across their deals.",
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

  // 3. Retired: First to Fill Starting Roster.
  // It measured who assembled a legal lineup earliest, which in a snake draft
  // mostly measures who took a kicker in the ninth round. That is a bad decision
  // the award was congratulating, so it is no longer emitted. Old snapshots keep
  // rendering it from their frozen payload.

  // 4. Most Boring League Mate, The Dead Air Award.
  {
    const r = pickExtreme(base, tradeCount, rosterIds, "min");
    const pending = !anyTrades || r.allTied || r.extreme == null;
    awards.push({
      id: "most-boring",
      title: "The Dead Air Award",
      category: "Most Boring League Mate",
      description:
        "Makes the fewest trades while the rest of the league wheels and deals.",
      claimants: pending ? [] : r.claimants,
      metricLabel: pending ? null : tradeWord(r.extreme!),
      pending,
      pendingLabel: "Nobody has traded yet, so no one is in the doghouse.",
    });
  }

  // 5. Best Drafter (The North Star Award). Judged against the market in FF
  // Beacon value: the team whose picks were worth the most MORE than the market
  // price of the slots they used (see surplus.ts). A round-one bargain therefore
  // counts for more than a round-fourteen one, which the old pick-number metric
  // could not express. Uses the ADP map the caller resolved for THIS draft (the
  // locked snapshot for completed drafts), never live market data.
  {
    const r = pickExtreme(base, adpDeltaSum, adpEligibleIds, "max");
    const noMarket = curve.sample === 0 || pickSurpluses.length === 0;
    const pending =
      noMarket || adpEligibleIds.length < 2 || r.allTied || r.extreme == null;
    const winnerCounts = r.claimants.map(
      (c) => adpPickCount.get(c.rosterId) ?? 0,
    );
    const sharedCount =
      winnerCounts.length > 0 &&
      winnerCounts.every((c) => c === winnerCounts[0])
        ? winnerCounts[0]
        : null;
    const signed =
      r.extreme == null
        ? ""
        : `${r.extreme >= 0 ? "+" : "-"}${fmtValue(Math.abs(r.extreme))}`;
    awards.push({
      id: "best-drafter",
      title: "The North Star Award",
      category: "Best Drafter",
      description: "Gets the most value for the draft slots they spent.",
      claimants: pending ? [] : r.claimants,
      metricLabel: pending
        ? null
        : sharedCount != null
          ? `${signed} value over market across ${sharedCount} ${sharedCount === 1 ? "pick" : "picks"}`
          : `${signed} value over market`,
      pending,
      pendingLabel: noMarket
        ? "Sleeper ADP is not available for this draft yet, so there is no market to beat."
        : `Not enough teams have made ${minAdpPicks} priced picks yet.`,
    });
  }

  // 6. Worst Drafter (The Lost Signal Award). The exact mirror of North Star:
  // the team that paid the most OVER the market price of the slots it used.
  // Same per-draft market curve, so the loser is as stable as the winner.
  {
    const r = pickExtreme(base, adpDeltaSum, adpEligibleIds, "min");
    const noMarket = curve.sample === 0 || pickSurpluses.length === 0;
    const pending =
      noMarket || adpEligibleIds.length < 2 || r.allTied || r.extreme == null;
    const loserCounts = r.claimants.map(
      (c) => adpPickCount.get(c.rosterId) ?? 0,
    );
    const sharedCount =
      loserCounts.length > 0 && loserCounts.every((c) => c === loserCounts[0])
        ? loserCounts[0]
        : null;
    const signed =
      r.extreme == null
        ? ""
        : `${r.extreme >= 0 ? "+" : "-"}${fmtValue(Math.abs(r.extreme))}`;
    awards.push({
      id: "worst-drafter",
      title: "The Lost Signal Award",
      category: "Worst Drafter",
      description: "Pays the most over market for the draft slots they spent.",
      claimants: pending ? [] : r.claimants,
      metricLabel: pending
        ? null
        : sharedCount != null
          ? `${signed} value over market across ${sharedCount} ${sharedCount === 1 ? "pick" : "picks"}`
          : `${signed} value over market`,
      pending,
      pendingLabel: noMarket
        ? "Sleeper ADP is not available for this draft yet, so nobody is on the hook."
        : `Not enough teams have made ${minAdpPicks} priced picks yet.`,
    });
  }

  // ---- Projection-backed awards ----
  // Every one of these needs Draft Pulse, which needs Sleeper's weekly
  // projections scored under the league's own settings. When projections are
  // unavailable the whole group stays pending with a truthful reason rather than
  // being computed from something weaker that looks the same on the card.
  const pulseById = new Map<number, DraftPulseTeam>();
  for (const t of pulseTeams) pulseById.set(t.rosterId, t);
  const minPlayers = Math.max(1, settings.awards.minPlayersForLineupAwards);
  const lineupEligibleIds = rosterIds.filter((id) => {
    const t = pulseById.get(id);
    return t != null && t.projectedCount >= minPlayers;
  });
  const noPulse = pulseTeams.length === 0;
  /**
   * The positions this league actually starts, read off the room rather than
   * asserted. A position nobody in a whole league produces at is a position the
   * league does not start; a position where one team produces nothing and the
   * others do is that team's hole, and the difference matters to every award
   * built on positional shares.
   */
  const startablePositions = PULSE_POSITIONS.filter((pos) =>
    pulseTeams.some((t) => t.positionPoints[pos] > 0),
  );
  const pulsePendingLabel = noPulse
    ? "Weekly projections are not available for this league yet, so nothing has been scored."
    : `No team has ${minPlayers} projected players yet.`;

  // 7. Best Starting Lineup (The Full Signal Award).
  {
    const values = new Map<number, number>();
    for (const id of lineupEligibleIds)
      values.set(id, pulseById.get(id)?.meanStartingPoints ?? 0);
    const r = pickExtreme(base, values, lineupEligibleIds, "max");
    const pending =
      noPulse || lineupEligibleIds.length < 2 || r.allTied || r.extreme == null;
    awards.push({
      id: "best-starting-lineup",
      title: "The Full Signal Award",
      category: "Best Starting Lineup",
      description:
        "Projects the most points from their starting lineup each week.",
      claimants: pending ? [] : r.claimants,
      metricLabel: pending
        ? null
        : `${r.extreme!.toFixed(1)} projected points a week`,
      pending,
      pendingLabel: pulsePendingLabel,
    });
  }

  // 8. Best Long-Term Build (The Long Game Award). Dynasty only, and it is the
  // gap that earns it: owning the most while projecting near the bottom right
  // now is the signature of a rebuild, and it is a compliment here rather than
  // an accusation. In a redraft league the same gap would just be a bad team.
  {
    const gaps = new Map<number, number>();
    const teamCount = rosterIds.length;
    if (isDynasty && teamCount > 1) {
      const valueRank = new Map<number, number>();
      rollups.forEach((r) => valueRank.set(r.rosterId, r.rank));
      for (const id of lineupEligibleIds) {
        const pulse = pulseById.get(id);
        const vRank = valueRank.get(id);
        if (!pulse || vRank == null) continue;
        // Both as percentiles so an eight-team league and a sixteen read alike.
        const valuePct = (teamCount - vRank) / (teamCount - 1);
        const pulsePct = (teamCount - pulse.rank) / (teamCount - 1);
        gaps.set(id, valuePct - pulsePct);
      }
    }
    const eligible = [...gaps.keys()];
    const r = pickExtreme(base, gaps, eligible, "max");
    // NOT EMITTED AT ALL in a redraft league, rather than emitted permanently
    // pending. There is no future to build toward, so the card could never be
    // won, and "up for grabs" is a promise a redraft reader will wait on
    // forever. An award nobody can win is not an award; it is an empty tile.
    if (isDynasty) {
      const pending =
        noPulse ||
        eligible.length < 2 ||
        r.allTied ||
        r.extreme == null ||
        r.extreme <= 0;
      awards.push({
        id: "long-game",
        title: "The Long Game Award",
        category: "Best Long-Term Build",
        description:
          "Owns far more than they start: the clearest rebuild in the room.",
        claimants: pending ? [] : r.claimants,
        metricLabel:
          pending || r.extreme == null
            ? null
            : `${Math.round(r.extreme * 100)} percentile points more value than lineup`,
        pending,
        pendingLabel: noPulse
          ? pulsePendingLabel
          : "No team is holding more than it starts yet.",
      });
    }
  }

  // 9. Most Reliable Roster (The Sure Thing Award).
  {
    const minWeeks = settings.awards.minAccuracyWeeks;
    const values = new Map<number, number>();
    const eligible: number[] = [];
    for (const id of lineupEligibleIds) {
      const t = pulseById.get(id);
      if (!t || t.starterBeatRate == null) continue;
      // The gate the pending copy promises. A beat rate over one week is a
      // number, not evidence, and crowning it would make the card a lie.
      if ((t.starterWeeksPlayed ?? 0) < minWeeks) continue;
      values.set(id, t.starterBeatRate);
      eligible.push(id);
    }
    const r = pickExtreme(base, values, eligible, "max");
    // A SPREAD WORTH REPORTING, not just a maximum.
    //
    // A team's beat rate is a points-weighted average over about ten starters,
    // each measured across roughly thirty graded weeks, which puts its standard
    // error near 0.03. In a real twelve-team league the whole field lands inside
    // about thirteen points of each other, so the "winner" is frequently the
    // team whose sample happened to break well. Crowning that is worse than
    // saying nothing, so the award needs a gap of at least two standard errors
    // before it will name anyone.
    const spread = spreadOfValues(values, eligible);
    const pending =
      noPulse ||
      eligible.length < 2 ||
      r.allTied ||
      r.extreme == null ||
      spread < RELIABILITY_MIN_SPREAD;
    awards.push({
      id: "most-reliable",
      title: "The Sure Thing Award",
      category: "Most Reliable Roster",
      description:
        "Their starters beat their projections more often than anyone else's.",
      claimants: pending ? [] : r.claimants,
      metricLabel:
        pending || r.extreme == null
          ? null
          : `Starters beat projection ${Math.round(r.extreme * 100)}% of weeks`,
      pending,
      pendingLabel: noPulse
        ? pulsePendingLabel
        : eligible.length >= 2 && spread < RELIABILITY_MIN_SPREAD
          ? "Every roster in this draft is within a few points of the same reliability, which is too close to call."
          : `Not enough teams have starters with ${minWeeks} weeks of history yet.`,
    });
  }

  // 10. Most Volatile Roster (The Glass Cannon Award). Spread relative to the
  // mean, not raw spread: a high-scoring lineup swings more in absolute points
  // simply for being high-scoring, and calling that volatility would just crown
  // the best team twice.
  {
    const values = new Map<number, number>();
    const eligible: number[] = [];
    for (const id of lineupEligibleIds) {
      const t = pulseById.get(id);
      if (!t || t.meanStartingPoints <= 0) continue;
      values.set(id, t.sigma / t.meanStartingPoints);
      eligible.push(id);
    }
    const r = pickExtreme(base, values, eligible, "max");
    const pending =
      noPulse || eligible.length < 2 || r.allTied || r.extreme == null;
    awards.push({
      id: "boom-bust",
      title: "The Glass Cannon Award",
      category: "Most Volatile Roster",
      description:
        "The widest weekly swing in the league, for better and worse.",
      claimants: pending ? [] : r.claimants,
      metricLabel:
        pending || r.extreme == null
          ? null
          : `Weekly swing of ${Math.round(r.extreme * 100)}% of their average`,
      pending,
      pendingLabel: pulsePendingLabel,
    });
  }

  // 11. Most Available Roster (The Iron Man Award).
  {
    const values = new Map<number, number>();
    const eligible: number[] = [];
    for (const id of lineupEligibleIds) {
      const t = pulseById.get(id);
      if (!t || t.starterAvailability == null) continue;
      values.set(id, t.starterAvailability);
      eligible.push(id);
    }
    const r = pickExtreme(base, values, eligible, "max");
    const pending =
      noPulse || eligible.length < 2 || r.allTied || r.extreme == null;
    awards.push({
      id: "iron-man",
      title: "The Iron Man Award",
      category: "Most Available Roster",
      description:
        "Drafted the starters most likely to actually be on the field.",
      claimants: pending ? [] : r.claimants,
      metricLabel:
        pending || r.extreme == null
          ? null
          : `Starters available ${Math.round(r.extreme * 100)}% of weeks`,
      pending,
      pendingLabel: pulsePendingLabel,
    });
  }

  // 12 and 13. The two pick awards. These name a moment rather than a season, so
  // they carry a pickHighlight and their claimant is whoever made that one pick.
  {
    const sorted = pickSurpluses.slice().sort((a, b) => b.surplus - a.surplus);
    const steal = sorted[0] ?? null;
    const reach = sorted.length > 0 ? sorted[sorted.length - 1] : null;
    const noMarket = curve.sample === 0 || pickSurpluses.length === 0;

    const stealPending = noMarket || steal === null || steal.surplus <= 0;
    awards.push({
      id: "steal-of-draft",
      title: "The Steal of the Draft",
      category: "Best Single Pick",
      description: "The one pick that beat its slot by the widest margin.",
      claimants:
        stealPending || !steal
          ? []
          : [base.get(steal.rosterId)].filter(
              (c): c is AwardClaimant => c != null,
            ),
      metricLabel:
        stealPending || !steal
          ? null
          : `+${fmtValue(steal.surplus)} over the market price of pick ${steal.pickNo}`,
      pending: stealPending,
      pendingLabel: noMarket
        ? "Sleeper ADP is not available for this draft yet, so there is no market to beat."
        : "No pick has beaten its slot yet.",
      pickHighlight:
        stealPending || !steal
          ? null
          : {
              playerName: steal.playerName,
              position: steal.position,
              pickNo: steal.pickNo,
              surplus: Math.round(steal.surplus),
            },
    });

    const reachPending = noMarket || reach === null || reach.surplus >= 0;
    awards.push({
      id: "reach-of-draft",
      title: "The Reach of the Draft",
      category: "Biggest Single Reach",
      description: "The one pick that paid the most over its slot.",
      claimants:
        reachPending || !reach
          ? []
          : [base.get(reach.rosterId)].filter(
              (c): c is AwardClaimant => c != null,
            ),
      metricLabel:
        reachPending || !reach
          ? null
          : `${fmtValue(Math.abs(reach.surplus))} under the market price of pick ${reach.pickNo}`,
      pending: reachPending,
      pendingLabel: noMarket
        ? "Sleeper ADP is not available for this draft yet, so nobody is on the hook."
        : "No pick has come in under its slot yet.",
      pickHighlight:
        reachPending || !reach
          ? null
          : {
              playerName: reach.playerName,
              position: reach.position,
              pickNo: reach.pickNo,
              surplus: Math.round(reach.surplus),
            },
    });
  }

  // 14. Best Value Pick of Each Round, The Bargain Bin Award.
  //
  // Twelve small wins beat one big one. Steal of the Draft names a single pick
  // in the whole room; this names the best pick in EVERY round, which is the
  // thing a drafter actually replays afterwards, and it gives most of the league
  // something to point at instead of one person.
  {
    const noMarket = curve.sample === 0 || pickSurpluses.length === 0;
    const bestByRound = new Map<number, PickSurplus>();
    for (const pick of pickSurpluses) {
      const round = roundOfPick(pick.pickNo, teamsInDraft);
      const held = bestByRound.get(round);
      if (!held || pick.surplus > held.surplus) bestByRound.set(round, pick);
    }
    const wins = new Map<number, number>();
    for (const pick of bestByRound.values()) {
      if (pick.surplus <= 0) continue;
      wins.set(pick.rosterId, (wins.get(pick.rosterId) ?? 0) + 1);
    }
    const eligible = [...wins.keys()];
    const r = pickExtreme(base, wins, eligible, "max");
    const pending =
      noMarket ||
      eligible.length < 2 ||
      r.allTied ||
      r.extreme == null ||
      r.extreme <= 0;
    awards.push({
      id: "round-steals",
      title: "The Bargain Bin Award",
      category: "Most Rounds Won",
      description:
        "Made the best value pick of the round more often than anyone.",
      claimants: pending ? [] : r.claimants,
      metricLabel:
        pending || r.extreme == null
          ? null
          : `Best pick of the round ${r.extreme} ${r.extreme === 1 ? "time" : "times"}`,
      pending,
      pendingLabel: noMarket
        ? "Sleeper ADP is not available for this draft, so there is no market to measure against."
        : "No team has won more rounds than the rest yet.",
    });
  }

  // 15 and 16. Most Balanced and Most Top Heavy.
  //
  // The same measurement read from both ends: the gap between a team's best and
  // worst starting position, as a share of its weekly output. A balanced roster
  // has no obvious hole to attack in a trade; a top-heavy one wins big on the
  // weeks its stars go off and loses badly when they do not.
  {
    const imbalance = new Map<number, number>();
    for (const id of lineupEligibleIds) {
      const t = pulseById.get(id);
      if (!t || t.meanStartingPoints <= 0) continue;
      // Measured over the positions the LEAGUE starts, not the ones this team
      // happens to have points at. Filtering on a positive contribution cannot
      // tell "this league has no kicker slot" apart from "this team has an empty
      // tight end slot", and it scored the second as though the position did not
      // exist, which handed Most Balanced to the roster with the biggest hole.
      const contributions = startablePositions.map(
        (pos) => t.positionPoints[pos],
      );
      if (contributions.length < 2) continue;
      const gap = Math.max(...contributions) - Math.min(...contributions);
      imbalance.set(id, gap / t.meanStartingPoints);
    }
    const eligible = [...imbalance.keys()];
    const balanced = pickExtreme(base, imbalance, eligible, "min");
    const topHeavy = pickExtreme(base, imbalance, eligible, "max");
    const notReady =
      noPulse ||
      eligible.length < 2 ||
      spreadOfValues(imbalance, eligible) < 0.05;
    const tooClose =
      "Every roster in this draft is shaped about the same, which is too close to call.";

    awards.push({
      id: "most-balanced",
      title: "The Even Keel Award",
      category: "Most Balanced Roster",
      description: "No position carries them and none lets them down.",
      claimants: notReady || balanced.allTied ? [] : balanced.claimants,
      metricLabel:
        notReady || balanced.extreme == null
          ? null
          : `Only ${Math.round(balanced.extreme * 100)}% between their best and worst starting spot`,
      pending: notReady || balanced.allTied,
      pendingLabel: noPulse ? pulsePendingLabel : tooClose,
    });

    awards.push({
      id: "most-top-heavy",
      title: "The Two Stars Award",
      category: "Most Top Heavy Roster",
      description: "Leans harder on one position than anyone else in the room.",
      claimants: notReady || topHeavy.allTied ? [] : topHeavy.claimants,
      metricLabel:
        notReady || topHeavy.extreme == null
          ? null
          : `${Math.round(topHeavy.extreme * 100)}% between their best and worst starting spot`,
      pending: notReady || topHeavy.allTied,
      pendingLabel: noPulse ? pulsePendingLabel : tooClose,
    });
  }

  // 17. Bye Week Nightmare, The Empty Sunday Award.
  //
  // Everyone has the same number of byes. What differs is whether they land
  // together, and losing four starters in one week is a problem that losing one
  // a week for four weeks is not. We already compute this and have never shown
  // it, which is a shame: it is the rare draft finding a manager can act on
  // immediately.
  {
    const worst = new Map<number, number>();
    const weekOf = new Map<number, number>();
    for (const id of lineupEligibleIds) {
      const t = pulseById.get(id);
      if (!t?.worstByeWeek) continue;
      worst.set(id, t.worstByeWeek.startersMissing);
      weekOf.set(id, t.worstByeWeek.week);
    }
    const eligible = [...worst.keys()];
    const r = pickExtreme(base, worst, eligible, "max");
    // Two starters out at once is ordinary. Three is a week you lose.
    const pending =
      noPulse ||
      eligible.length < 2 ||
      r.allTied ||
      r.extreme == null ||
      r.extreme < 3;
    const winnerWeek = r.claimants[0]
      ? weekOf.get(r.claimants[0].rosterId)
      : null;
    awards.push({
      id: "bye-week-nightmare",
      title: "The Empty Sunday Award",
      category: "Bye Week Nightmare",
      description: "Loses more starters to a single bye week than anyone else.",
      claimants: pending ? [] : r.claimants,
      metricLabel:
        pending || r.extreme == null
          ? null
          : `${r.extreme} starters out in week ${winnerWeek ?? "?"}`,
      pending,
      pendingLabel: noPulse
        ? pulsePendingLabel
        : "Nobody in this draft loses three or more starters to the same bye week.",
    });
  }

  // 18. Zigged When They Zagged, The Contrarian Award.
  //
  // How far a team's positional shape sits from the room's. Not a judgement: the
  // most contrarian roster in a draft is sometimes the smartest and sometimes
  // the strangest, and the card says which by sitting next to the lineup and
  // grade cards rather than by asserting it.
  {
    const shares = new Map<number, number[]>();
    for (const id of lineupEligibleIds) {
      const t = pulseById.get(id);
      if (!t || t.meanStartingPoints <= 0) continue;
      shares.set(
        id,
        startablePositions.map(
          (pos) => t.positionPoints[pos] / t.meanStartingPoints,
        ),
      );
    }
    const ids = [...shares.keys()];
    const distance = new Map<number, number>();
    if (ids.length >= 3) {
      const room = PULSE_POSITIONS.map(
        (_, i) =>
          ids.reduce((sum, id) => sum + (shares.get(id)?.[i] ?? 0), 0) /
          ids.length,
      );
      for (const id of ids) {
        const mine = shares.get(id) ?? [];
        let sum = 0;
        for (let i = 0; i < room.length; i += 1)
          sum += Math.abs((mine[i] ?? 0) - room[i]);
        // Halved so the figure reads as "share of the lineup that sits somewhere
        // the room's does not" rather than double-counting every shift.
        distance.set(id, sum / 2);
      }
    }
    const eligible = [...distance.keys()];
    const r = pickExtreme(base, distance, eligible, "max");
    const pending =
      noPulse ||
      eligible.length < 3 ||
      r.allTied ||
      r.extreme == null ||
      r.extreme < 0.08;
    awards.push({
      id: "against-the-room",
      title: "The Contrarian Award",
      category: "Zigged When They Zagged",
      description: "Built the least conventional roster shape in the draft.",
      claimants: pending ? [] : r.claimants,
      metricLabel:
        pending || r.extreme == null
          ? null
          : `${Math.round(r.extreme * 100)}% of their lineup sits where the room's does not`,
      pending,
      pendingLabel: noPulse
        ? pulsePendingLabel
        : "Every roster in this draft is shaped about the same way.",
    });
  }

  // 19. Best Late Round Haul, The Deep Cuts Award.
  //
  // Surplus captured in the last third of the draft only. Separate from Best
  // Drafter on purpose: beating the market with the third pick of the first
  // round is largely the market being wrong, while doing it in the twelfth is
  // the part that was actually you.
  {
    const noMarket = curve.sample === 0 || pickSurpluses.length === 0;
    const totalRounds = lastRound(pickSurpluses, teamsInDraft);
    const lateFrom = Math.max(2, Math.ceil((totalRounds * 2) / 3) + 1);
    const late = new Map<number, number>();
    for (const pick of pickSurpluses) {
      if (roundOfPick(pick.pickNo, teamsInDraft) < lateFrom) continue;
      late.set(pick.rosterId, (late.get(pick.rosterId) ?? 0) + pick.surplus);
    }
    const eligible = [...late.keys()];
    const r = pickExtreme(base, late, eligible, "max");
    const pending =
      noMarket ||
      totalRounds < 3 ||
      eligible.length < 2 ||
      r.allTied ||
      r.extreme == null ||
      r.extreme <= 0;
    awards.push({
      id: "late-round-haul",
      title: "The Deep Cuts Award",
      category: "Best Late Round Haul",
      description:
        "Found the most value after most of the room had stopped looking.",
      claimants: pending ? [] : r.claimants,
      metricLabel:
        pending || r.extreme == null
          ? null
          : `Plus ${fmtValue(r.extreme)} of value from round ${lateFrom} on`,
      pending,
      pendingLabel: noMarket
        ? "Sleeper ADP is not available for this draft, so there is no market to measure against."
        : "Nobody has pulled ahead in the late rounds yet.",
    });
  }

  // 20. Toughest Schedule Drafted, The Uphill Award.
  //
  // Built from nfl_defense_vs_position, which is our own measurement rather than
  // a projection provider's. It is the one thing on this page no other draft
  // tool can say, and it is genuinely actionable: a hard early run is a reason
  // to be patient with a slow start rather than to panic-trade in week 3.
  {
    const strength = new Map<number, number>();
    for (const id of lineupEligibleIds) {
      const t = pulseById.get(id);
      if (!t || t.scheduleStrength == null) continue;
      strength.set(id, t.scheduleStrength);
    }
    const eligible = [...strength.keys()];
    // A LOWER multiplier is a harder set of defenses, so this is a min.
    const r = pickExtreme(base, strength, eligible, "min");
    const pending =
      noPulse ||
      eligible.length < 2 ||
      r.allTied ||
      r.extreme == null ||
      spreadOfValues(strength, eligible) < 0.02;
    awards.push({
      id: "toughest-schedule",
      title: "The Uphill Award",
      category: "Toughest Schedule Drafted",
      description:
        "Their starters face the hardest run of defenses in the league.",
      claimants: pending ? [] : r.claimants,
      metricLabel:
        pending || r.extreme == null
          ? null
          : `Starters face defenses ${Math.round((1 - r.extreme) * 100)}% tougher than average`,
      pending,
      pendingLabel: noPulse
        ? pulsePendingLabel
        : "Every roster in this draft faces about the same run of defenses.",
    });
  }

  // 21. Best Scarcity Read, The Cliff Edge Award.
  //
  // NOT named after Positional WAR, deliberately. CLAUDE.md reserves that token
  // for the one player-independent metric, and this measures a SPECIFIC ROSTER,
  // which the naming rule forbids calling WAR in code or in copy. What it
  // measures is the same instinct: how much of a team's haul sits at the
  // positions where the drop-off from their pick to the next man was steepest.
  {
    const noMarket = curve.sample === 0 || pickSurpluses.length === 0;
    const cliff = scarcityCaptureByRoster(pickSurpluses);
    const eligible = [...cliff.keys()];
    const r = pickExtreme(base, cliff, eligible, "max");
    const pending =
      noMarket ||
      eligible.length < 2 ||
      r.allTied ||
      r.extreme == null ||
      r.extreme <= 0;
    awards.push({
      id: "scarcity-read",
      title: "The Cliff Edge Award",
      category: "Best Scarcity Read",
      description:
        "Spent where the drop-off was steepest, not just where value was cheap.",
      claimants: pending ? [] : r.claimants,
      metricLabel:
        pending || r.extreme == null
          ? null
          : `Took ${fmtValue(r.extreme)} more than the next man up at their positions`,
      pending,
      pendingLabel: noMarket
        ? "Sleeper ADP is not available for this draft, so there is no market to measure against."
        : "No team has read the scarcity better than the rest yet.",
    });
  }

  // Admin can switch any award off. A missing key means on, so a settings row
  // written before an award existed never hides it.
  return awards.filter((a) => settings.awards.enabled[a.id] !== false);
}
