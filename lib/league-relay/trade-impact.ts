import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { validateProposal, evaluateValidatedTrade } from "@/lib/trade-impact/evaluate";
import type { BuildAsset, TeamImpact, TradeImpact } from "@/lib/trade-impact/types";

type Admin = SupabaseClient<Database>;

/**
 * The impact model, pointed at a trade that has ALREADY HAPPENED.
 *
 * THE PROBLEM. `lib/trade-impact/` answers "what would this proposal do", and
 * it re-derives ownership from `rosters.player_ids` before it will answer
 * anything, because a proposal that is believed rather than checked produces a
 * confident evaluation of a trade that cannot happen. That check is correct and
 * must not be relaxed. But it also means an EXECUTED trade cannot be submitted
 * as itself: the players a manager received are already on their roster, so
 * "incoming must be on the counterparty's roster" fails for every asset.
 *
 * THE FIX, AND WHY IT IS NOT A BYPASS. We evaluate the UN-TRADE. From team A's
 * point of view: incoming is what A sent away (which really is on B's roster
 * right now) and outgoing is what A received (which really is on A's). That
 * proposal passes the ownership check honestly, because it describes a trade
 * that could in fact be made today. What comes back is the counterfactual
 * league in which the deal never happened, so "before" is the world we are in
 * and "after" is the world without the trade.
 *
 * Then every before/after pair is SWAPPED, which turns that into "what the
 * trade did". No sign arithmetic is scattered through the writeups, no
 * ownership rule is loosened, and the expensive half is the same code path the
 * Trade Ideas builder uses, so the two can never disagree about a league.
 *
 * WHAT FAILS, AND WHAT THAT MEANS. If an asset has moved on since (traded
 * again, dropped, or the roster resynced mid-flight) the ownership check fails
 * and this returns null. The writeup then runs on Signal Check alone and says
 * so. That is the honest outcome: we cannot model a swap we can no longer
 * locate, and inventing one is exactly what the check exists to prevent.
 */

/** One team's side of an executed trade, in the direction it really went. */
export interface ExecutedTeamImpact {
  rosterId: number;
  teamName: string;
  /** Contender / Bubble / Rebuilder band, from Power Pulse. Null without one. */
  statusKey: TeamImpact["statusKey"];
  statusLabel: string | null;
  pulseRank: number | null;

  /** Trade value before the deal, and after it. */
  valueBefore: number;
  valueAfter: number;
  /** Positive means this team gained value. */
  valueDelta: number;
  /** Value-weighted change in average age. Negative means younger. */
  ageDelta: number | null;
  pickCountDelta: number;

  /** Optimal-lineup points per remaining week, before and after. */
  lineupBefore: number | null;
  lineupAfter: number | null;
  lineupDelta: number | null;
  weeksImproved: number;
  weeksWorsened: number;

  projectedWinsBefore: number | null;
  projectedWinsAfter: number | null;
  playoffOddsBefore: number | null;
  playoffOddsAfter: number | null;
  titleOddsBefore: number | null;
  titleOddsAfter: number | null;

  positionBefore: Record<string, number>;
  positionAfter: Record<string, number>;

  /** What this team RECEIVED, priced. */
  received: TeamImpact["incoming"];
  /** What this team SENT, priced. */
  sent: TeamImpact["outgoing"];
  /**
   * For each player this team gave up, how many of the remaining weeks they
   * would still have started. Keyed by FF Beacon player id.
   *
   * This is `incomingStartWeeks` from the un-trade, kept under a name that says
   * what it means in this direction. "The running back they sold would have
   * started seven of the nine weeks left" is the sentence it buys, and it is
   * the most quoted number in the whole writeup.
   */
  departedStartWeeks: Record<string, number>;
}

export interface ExecutedTradeImpact {
  a: ExecutedTeamImpact;
  b: ExecutedTeamImpact;
  gaps: TradeImpact["gaps"];
  weeksConsidered: number;
  isDynasty: boolean;
  formatDisplay: string;
  sourceDisplay: string;
  caveats: string[];
}

function flip(team: TeamImpact): ExecutedTeamImpact {
  return {
    rosterId: team.rosterId,
    teamName: team.teamName,
    statusKey: team.statusKey,
    statusLabel: team.statusLabel,
    pulseRank: team.pulseRank,

    // Every pair swaps. The un-trade's "before" is today; its "after" is the
    // world without the deal, which for us is the world before it.
    valueBefore: team.valueAfter,
    valueAfter: team.valueBefore,
    valueDelta: -team.valueDelta,
    ageDelta: team.ageDelta === null ? null : -team.ageDelta,
    pickCountDelta: -team.pickCountDelta,

    lineupBefore: team.lineupAfter,
    lineupAfter: team.lineupBefore,
    lineupDelta: team.lineupDelta === null ? null : -team.lineupDelta,
    weeksImproved: team.weeksWorsened,
    weeksWorsened: team.weeksImproved,

    projectedWinsBefore: team.projectedWinsAfter,
    projectedWinsAfter: team.projectedWinsBefore,
    playoffOddsBefore: team.playoffOddsAfter,
    playoffOddsAfter: team.playoffOddsBefore,
    titleOddsBefore: team.titleOddsAfter,
    titleOddsAfter: team.titleOddsBefore,

    positionBefore: team.positionAfter,
    positionAfter: team.positionBefore,

    // In the un-trade, `incoming` is what this team gave up and `outgoing` is
    // what it received. Swapping them restores the real direction.
    received: team.outgoing,
    sent: team.incoming,
    departedStartWeeks: team.incomingStartWeeks,
  };
}

export interface ExecutedTradeParams {
  sleeperLeagueId: string;
  sourceSlug: string | null;
  /** The two rosters, in the order the writeup will name them. */
  rosterA: number;
  rosterB: number;
  /** What A received in the real trade. */
  aReceived: BuildAsset[];
  /** What B received in the real trade. */
  bReceived: BuildAsset[];
}

export type ExecutedTradeResult =
  | { ok: true; impact: ExecutedTradeImpact }
  | { ok: false; error: string };

/**
 * Evaluate a trade that already happened.
 *
 * NOT RATE LIMITED HERE, and it does not need to be. Every caller is a cron
 * tick working through a bounded list of transactions from leagues an admin
 * nominated, not a request an anonymous reader can repeat. The rate limit in
 * `lib/trade-impact/rate-limit.ts` guards the READER-FACING paths, where the
 * actor is a person who can press a button in a loop.
 */
export async function evaluateExecutedTrade(
  admin: Admin,
  params: ExecutedTradeParams,
): Promise<ExecutedTradeResult> {
  // The un-trade, from A's point of view. See the module header.
  const proposal = {
    myRosterId: params.rosterA,
    theirRosterId: params.rosterB,
    incoming: params.bReceived,
    outgoing: params.aReceived,
  };

  const validated = await validateProposal(admin, admin, {
    sleeperLeagueId: params.sleeperLeagueId,
    sourceSlug: params.sourceSlug,
    identity: { rosterId: params.rosterA },
    proposal,
  });
  if (!validated.ok) return { ok: false, error: validated.error };

  const evaluated = await evaluateValidatedTrade(admin, admin, validated.validated);
  if (!evaluated.ok) return { ok: false, error: evaluated.error };

  const impact = evaluated.impact;
  return {
    ok: true,
    impact: {
      a: flip(impact.mine),
      b: flip(impact.theirs),
      gaps: impact.gaps,
      weeksConsidered: impact.weeksConsidered,
      isDynasty: impact.isDynasty,
      formatDisplay: impact.formatDisplay,
      sourceDisplay: impact.sourceDisplay,
      // The caveats are about the MODEL (no projections published, no games
      // left, picks unpriced), not about the direction, so they carry over
      // unchanged. Nothing in them reads as a before or an after.
      caveats: impact.caveats,
    },
  };
}
