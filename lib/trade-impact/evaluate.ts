import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { projectPlayerWeek, reliabilityMultiplier } from "@/lib/power-pulse/project";
import type { LineupCandidate } from "@/lib/power-pulse/lineup";
import { buildOptimalLineup, startingSlots } from "@/lib/power-pulse/lineup";
import { winProbability } from "@/lib/power-pulse/math";
import {
  simulateWithReplacements,
  type WeeklyDistribution,
} from "@/lib/power-pulse/what-if";
import { gradeAssetPairs } from "@/lib/trade-finder-grade";
import type { SuggestionAsset } from "@/lib/trade-finder/types";
// A pure label map, imported across features on purpose: `SUPER_FLEX` and
// `WRRB_FLEX` are Sleeper's tokens, not words, and there is one place in this
// codebase that turns them into something a person would say.
import { slotLabel } from "@/lib/league-schedule/slots";
import { computeRosterSwap } from "./roster-swap";
import { buildTradeCaveats, buildTradeReasons } from "./reasons";
import { loadTradeImpactWorld, type TradeImpactWorld } from "./load";
import {
  loadTradeFinderLeague,
  type RosterIdentity,
  type TradeFinderLeague,
} from "@/lib/trade-finder-data";
import { MAX_BUILD_ASSETS_PER_SIDE } from "./proposal-url";
import type {
  BuildAsset,
  ImpactGaps,
  ResolvedAsset,
  TeamImpact,
  TradeImpact,
  TradeProposal,
  WeekImpact,
} from "./types";

/**
 * Evaluate one trade, end to end.
 *
 * The order of operations is the argument:
 *
 *   1. Load the league once (lib/trade-impact/load.ts).
 *   2. RE-DERIVE who owns what. The caller said "player X from roster 4"; this
 *      checks the roster. See below, it is the security-relevant step.
 *   3. Project both teams' rosters for every remaining week, on exactly the
 *      terms Power Pulse uses, and rebuild each optimal lineup with the trade
 *      applied.
 *   4. Run the season simulation twice, once on each set of distributions.
 *   5. Price both sides on trade value, which is a different question with a
 *      different answer, and say both.
 *   6. Ask Signal Check what it thinks, as a second opinion that decides nothing.
 *   7. Turn the figures into sentences. Nothing is invented at that step.
 *
 * OWNERSHIP IS RE-DERIVED, NEVER TRUSTED
 *   The proposal arrives from a client, or out of a URL somebody pasted. If it
 *   were believed, a forged input would produce a confident, fully reasoned
 *   evaluation of a trade that cannot happen: the wrong player on the wrong
 *   roster, priced and simulated and explained. That reads as a correctness bug
 *   and behaves as a security one, because the numbers are what a reader acts
 *   on. So every incoming asset must be on the counterparty's roster and every
 *   outgoing asset on the reader's, checked against what the database says.
 *
 * VALIDATION HAPPENS BEFORE THE RATE-LIMIT SLOT IS CLAIMED
 *   Callers run `validateProposal` first, then claim, then call `evaluateTrade`.
 *   A stale link must not burn a reader's budget, and a flood of garbage must
 *   gain an attacker nothing. The split lives in the callers because only they
 *   know whether they are a server action or a render.
 *
 * NEVER THROWS. Every failure is a named string a surface can print.
 */

type ServiceClient = SupabaseClient<Database>;
type AnyClient =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export type EvaluateResult =
  | { ok: true; impact: TradeImpact }
  | { ok: false; error: string };

/**
 * A proposal that has been checked against the league, ready to evaluate.
 *
 * Carries the FINDER league, not the whole world. That distinction is the point
 * of the split: everything ownership checking needs (`teams[].players`,
 * `teams[].picks`) is in the finder league, and everything else (projections,
 * accuracy, defense splits, the schedule, the Power Pulse cache) is only needed
 * once we have decided to spend the expensive budget on this request.
 */
export type ValidatedProposal = {
  proposal: TradeProposal;
  finder: TradeFinderLeague;
  incoming: ResolvedAsset[];
  outgoing: ResolvedAsset[];
  sourceSlug: string | null;
  identity: RosterIdentity;
};

function assetKeyOf(asset: BuildAsset): string {
  return asset.kind === "player"
    ? `p:${asset.playerId}`
    : `k:${asset.season}:${asset.round}`;
}

/**
 * Resolve one side's assets against ONE team's actual holdings.
 *
 * A player has to be on that roster. A pick has to be among that roster's
 * tradeable picks, matched on season and round: the slot bucket is our estimate
 * rather than the league's fact, so requiring it to match would reject real
 * picks over a label we chose ourselves.
 */
function resolveAgainstTeam(
  assets: BuildAsset[],
  team: TradeImpactWorld["finder"]["teams"][number],
): { resolved: ResolvedAsset[]; missing: string[] } {
  const byPlayer = new Map(team.players.map((p) => [p.playerId, p]));
  const picksByKey = new Map<string, (typeof team.picks)[number]>();
  for (const pick of team.picks) {
    picksByKey.set(`k:${pick.season}:${pick.round}`, pick);
  }

  const resolved: ResolvedAsset[] = [];
  const missing: string[] = [];

  for (const asset of assets) {
    if (asset.kind === "player") {
      const player = byPlayer.get(asset.playerId);
      if (!player) {
        missing.push("a player who is not on that roster");
        continue;
      }
      resolved.push({
        kind: "player",
        playerId: player.playerId,
        sleeperId: player.sleeperId,
        name: player.name,
        position: player.position,
        team: player.team,
        value: player.hasValue ? player.value : 0,
        age: player.age,
        projPoints: player.projPoints,
        isInactive: player.isInactive,
      });
      continue;
    }

    const pick = picksByKey.get(assetKeyOf(asset));
    if (!pick) {
      missing.push(`a ${asset.season} round ${asset.round} pick that roster does not hold`);
      continue;
    }
    resolved.push({
      kind: "pick",
      key: pick.key,
      label: pick.label,
      season: pick.season,
      round: pick.round,
      pickPosition: pick.pickPosition,
      value: pick.hasValue ? pick.value : 0,
    });
  }

  return { resolved, missing };
}

/**
 * Check a proposal against the league. Cheap: no projection, no simulation.
 *
 * Run this BEFORE claiming a rate-limit slot. It is the whole reason the
 * expensive half is a separate function.
 */
export async function validateProposal(
  supabase: AnyClient,
  admin: ServiceClient,
  params: {
    sleeperLeagueId: string;
    sourceSlug: string | null;
    identity: Parameters<typeof loadTradeImpactWorld>[2]["identity"];
    proposal: TradeProposal;
    /** A league the caller already read. See loadTradeImpactWorld. */
    finder?: Parameters<typeof loadTradeImpactWorld>[2]["finder"];
  },
): Promise<{ ok: true; validated: ValidatedProposal } | { ok: false; error: string }> {
  const { proposal } = params;

  if (proposal.myRosterId === proposal.theirRosterId) {
    return { ok: false, error: "A trade needs two different teams." };
  }
  if (proposal.incoming.length === 0 && proposal.outgoing.length === 0) {
    return { ok: false, error: "Add at least one player or pick to evaluate a trade." };
  }
  if (
    proposal.incoming.length > MAX_BUILD_ASSETS_PER_SIDE ||
    proposal.outgoing.length > MAX_BUILD_ASSETS_PER_SIDE
  ) {
    return {
      ok: false,
      error: `A side can hold at most ${MAX_BUILD_ASSETS_PER_SIDE} assets.`,
    };
  }

  // The ONLY read this function makes, and the reason the split exists. It is
  // roughly ten queries against tables the league deep view has already filled;
  // the world load behind the rate-limit claim is twice that again plus a
  // megabyte of projection rows.
  const finder =
    params.finder ??
    (await loadTradeFinderLeague(supabase, {
      sleeperLeagueId: params.sleeperLeagueId,
      sourceSlug: params.sourceSlug,
      identity: params.identity,
    }));
  if (!finder) {
    return {
      ok: false,
      error: "We cannot price trades in this league yet. See the Overview tab.",
    };
  }
  void admin;

  const mine = finder.teams.find((t) => t.rosterId === proposal.myRosterId);
  const theirs = finder.teams.find((t) => t.rosterId === proposal.theirRosterId);
  if (!mine || !theirs) {
    return { ok: false, error: "One of those teams is not in this league." };
  }

  // The security-relevant step. Incoming must come off THEIR roster, outgoing
  // off MINE, checked against the database rather than believed. A forged
  // proposal would otherwise produce a confident, fully reasoned evaluation of a
  // trade that cannot happen.
  const incoming = resolveAgainstTeam(proposal.incoming, theirs);
  const outgoing = resolveAgainstTeam(proposal.outgoing, mine);
  const missing = [...incoming.missing, ...outgoing.missing];
  if (missing.length > 0) {
    return {
      ok: false,
      error:
        "This trade includes " +
        missing[0] +
        ". Rosters move, so a saved link can go stale. Rebuild it below.",
    };
  }

  return {
    ok: true,
    validated: {
      proposal,
      finder,
      incoming: incoming.resolved,
      outgoing: outgoing.resolved,
      sourceSlug: params.sourceSlug,
      identity: params.identity,
    },
  };
}

/** Every projectable candidate on one roster, per remaining week. */
function buildRosterWeeks(
  world: TradeImpactWorld,
  sleeperRosterId: number,
  excludeSleeperIds: Set<string>,
): Map<number, LineupCandidate[]> {
  const byWeek = new Map<number, LineupCandidate[]>();
  for (const week of world.remainingWeeks) byWeek.set(week, []);

  const roster = world.rosters.find((r) => r.sleeperRosterId === sleeperRosterId);
  if (!roster) return byWeek;

  // IR and taxi players cannot start, so they are not lineup candidates. They
  // are still tradeable, which is why they are excluded here and not upstream.
  const cannotStart = new Set([...roster.reserveSleeperIds, ...roster.taxiSleeperIds]);

  for (const sleeperId of roster.playerSleeperIds) {
    if (excludeSleeperIds.has(sleeperId)) continue;
    if (cannotStart.has(sleeperId)) continue;
    const player = world.players.get(sleeperId);
    if (!player) continue;

    const accuracy = world.accuracy.get(player.playerId) ?? null;
    const reliability = reliabilityMultiplier(accuracy, world.settings);

    for (const week of world.remainingWeeks) {
      const projected = projectPlayerWeek({
        projection: world.projections.get(`${player.playerId}|${week}`),
        subject: { position: player.position, injuryStatus: player.injuryStatus },
        accuracy,
        reliability,
        scoringSettings: world.league.scoringSettings,
        defense: world.defense,
        defenseSeasons: world.defenseSeasons,
        week,
        currentWeek: world.currentWeek,
        settings: world.settings,
      });
      if (!projected) continue;
      byWeek.get(week)?.push({
        playerId: player.playerId,
        position: player.position,
        points: projected.points,
        sigma: projected.sigma,
      });
    }
  }

  return byWeek;
}

/**
 * Per-position starter output, as points PER WEEK.
 *
 * Two mistakes are being fixed here at once, and both reached the screen.
 *
 * The first is arithmetic: the previous version accumulated across every
 * remaining week and never divided, then handed the total to a sentence that
 * says "points a week". With ten weeks left that inflated the figure tenfold,
 * which also pushed it permanently past the noise threshold that was supposed
 * to keep the reason quiet on trades that do not move a position.
 *
 * The second is worse: the "after" map was built from the roster MINUS what you
 * send, and nothing was ever added back. Trading a receiver for a better
 * receiver reported that you had gutted your receiving corps. Callers now pass
 * the candidate set that actually exists after the trade.
 */
function positionPointsFrom(
  byWeek: Map<number, LineupCandidate[]>,
  weeks: number[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const week of weeks) {
    for (const candidate of byWeek.get(week) ?? []) {
      totals[candidate.position] = (totals[candidate.position] ?? 0) + candidate.points;
    }
  }
  if (weeks.length === 0) return totals;
  for (const position of Object.keys(totals)) totals[position] /= weeks.length;
  return totals;
}

/**
 * One roster's candidates with the trade applied: what it sends removed, what it
 * receives added.
 *
 * Derived from the BEFORE map by filtering rather than by projecting again. Every
 * projection in the after state was already computed for the before state, and
 * `projectPlayerWeek` is a stat-line dot product over about thirty keys per
 * player per week. Recomputing it was roughly 420 wasted projections per roster.
 */
function applySwap(
  before: Map<number, LineupCandidate[]>,
  incomingByWeek: Map<number, LineupCandidate[]>,
  outgoingPlayerIds: string[],
  weeks: number[],
): Map<number, LineupCandidate[]> {
  const leaving = new Set(outgoingPlayerIds.filter(Boolean));
  const out = new Map<number, LineupCandidate[]>();
  for (const week of weeks) {
    out.set(week, [
      ...(before.get(week) ?? []).filter((c) => !leaving.has(c.playerId)),
      ...(incomingByWeek.get(week) ?? []),
    ]);
  }
  return out;
}

/** Projected candidates for assets ARRIVING on a roster. */
function buildIncomingWeeks(
  world: TradeImpactWorld,
  assets: ResolvedAsset[],
): Map<number, LineupCandidate[]> {
  const byWeek = new Map<number, LineupCandidate[]>();
  for (const week of world.remainingWeeks) byWeek.set(week, []);

  for (const asset of assets) {
    // A pick cannot start in a lineup, which is the whole reason Power Pulse
    // ignores picks. It still moves the value number.
    if (asset.kind !== "player") continue;
    if (asset.isInactive) continue;
    if (!asset.sleeperId) continue;
    const player = world.players.get(asset.sleeperId);
    if (!player) continue;

    const accuracy = world.accuracy.get(player.playerId) ?? null;
    const reliability = reliabilityMultiplier(accuracy, world.settings);

    for (const week of world.remainingWeeks) {
      const projected = projectPlayerWeek({
        projection: world.projections.get(`${player.playerId}|${week}`),
        subject: { position: player.position, injuryStatus: player.injuryStatus },
        accuracy,
        reliability,
        scoringSettings: world.league.scoringSettings,
        defense: world.defense,
        defenseSeasons: world.defenseSeasons,
        week,
        currentWeek: world.currentWeek,
        settings: world.settings,
      });
      if (!projected) continue;
      byWeek.get(week)?.push({
        playerId: player.playerId,
        position: player.position,
        points: projected.points,
        sigma: projected.sigma,
      });
    }
  }

  return byWeek;
}

function sumValue(assets: ResolvedAsset[]): number {
  return assets.reduce((total, a) => total + a.value, 0);
}

function pickCount(assets: ResolvedAsset[]): number {
  return assets.filter((a) => a.kind === "pick").length;
}

/**
 * Value-weighted average age change.
 *
 * Weighted, because swapping a 1200-point 23 year old for a 1200-point 30 year
 * old is the move, and an unweighted mean over a package containing a 40-point
 * bench body would drown it.
 */
function ageDeltaOf(incoming: ResolvedAsset[], outgoing: ResolvedAsset[]): number | null {
  const weighted = (assets: ResolvedAsset[]): { sum: number; weight: number } => {
    let sum = 0;
    let weight = 0;
    for (const a of assets) {
      if (a.kind !== "player" || a.age === null) continue;
      const w = Math.max(1, a.value);
      sum += a.age * w;
      weight += w;
    }
    return { sum, weight };
  };
  const inA = weighted(incoming);
  const outA = weighted(outgoing);
  if (inA.weight === 0 || outA.weight === 0) return null;
  return inA.sum / inA.weight - outA.sum / outA.weight;
}

function toSuggestionAssets(assets: ResolvedAsset[]): SuggestionAsset[] {
  return assets.map((a) =>
    a.kind === "player"
      ? {
          kind: "player" as const,
          playerId: a.playerId,
          sleeperId: a.sleeperId,
          name: a.name,
          position: a.position,
          team: a.team,
          value: a.value,
          age: a.age,
          projPoints: a.projPoints,
        }
      : {
          kind: "pick" as const,
          key: a.key,
          label: a.label,
          season: a.season,
          round: a.round,
          value: a.value,
        },
  );
}

/**
 * A team's total trade value.
 *
 * Picks count when the league prices them, and leaving them out was a real bug:
 * `valueDelta` has always counted a pick on either side, so a players-only base
 * made `valueAfter = valueBefore + valueDelta` internally inconsistent, and it
 * skewed the percentage-of-roster threshold the value reasons fire on. In a
 * dynasty league picks are a large share of what a rebuilding team owns, which
 * is exactly the team the value figure is for.
 */
function teamValueOf(
  team: TradeImpactWorld["finder"]["teams"][number],
  allowPicks: boolean,
): number {
  const players = team.players.reduce((total, p) => total + (p.hasValue ? p.value : 0), 0);
  if (!allowPicks) return players;
  return players + team.picks.reduce((total, k) => total + (k.hasValue ? k.value : 0), 0);
}

/**
 * The weakest starting slot, before and after.
 *
 * Reads the per-slot averages `computeRosterSwap` already produced. It used to
 * rebuild every weekly lineup a second time to recover them, which was 28 exact
 * augmenting-path fills to find a number the swap had computed and discarded.
 *
 * Returns the slot's raw roster_positions token; the caller is responsible for
 * turning `SUPER_FLEX` into something a person would say out loud.
 *
 * A LIMIT WORTH KNOWING ABOUT. `buildOptimalLineup` guarantees the optimal
 * TOTAL, not a canonical assignment of players to interchangeable slots. Offer a
 * league running WR and FLEX a much better receiver and the augmenting path may
 * seat him in FLEX and slide the incumbent into WR, so the WR slot's own figure
 * does not move even though the lineup got better. The `fills-hole` reason
 * therefore requires the weakest slot to actually improve before it fires: when
 * the upgrade lands somewhere else, the reason stays quiet rather than reporting
 * a slot that did not change. Silence is the right failure here, and the lineup
 * gain is reported by `lineup-gain` regardless.
 */
function weakestSlotOf(
  slots: string[],
  swap: { slotPointsBefore: number[]; slotPointsAfter: number[] },
): { label: string; before: number; after: number } | null {
  if (slots.length === 0 || swap.slotPointsBefore.length !== slots.length) return null;
  let worst = 0;
  for (let i = 1; i < swap.slotPointsBefore.length; i += 1) {
    if (swap.slotPointsBefore[i] < swap.slotPointsBefore[worst]) worst = i;
  }
  return {
    label: slots[worst],
    before: swap.slotPointsBefore[worst],
    after: swap.slotPointsAfter[worst],
  };
}

/** Which position lost the most starter output, and by how much. */
function depthCostOf(
  positionBefore: Record<string, number>,
  positionAfter: Record<string, number>,
): { position: string; gap: number } | null {
  let worst: { position: string; gap: number } | null = null;
  for (const position of Object.keys(positionBefore)) {
    const gap = (positionBefore[position] ?? 0) - (positionAfter[position] ?? 0);
    if (gap <= 0) continue;
    if (!worst || gap > worst.gap) worst = { position, gap };
  }
  return worst;
}

/**
 * The expensive half. Only call this after `validateProposal` has passed AND a
 * rate-limit slot has been claimed.
 */
export async function evaluateValidatedTrade(
  supabase: AnyClient,
  admin: ServiceClient,
  validated: ValidatedProposal,
): Promise<EvaluateResult> {
  const { proposal, incoming, outgoing } = validated;

  // THE EXPENSIVE READ, and it lives here rather than in validateProposal on
  // purpose. Roughly twenty round trips plus a megabyte of projection rows, all
  // of it behind the rate-limit claim the caller has already made. Putting it in
  // the validator meant a proposal naming a player who is not on the roster paid
  // for the whole thing and never touched the meter.
  const loaded = await loadTradeImpactWorld(supabase, admin, {
    sleeperLeagueId: validated.finder.sleeperLeagueId,
    sourceSlug: validated.sourceSlug,
    identity: validated.identity,
    involvedRosterIds: [proposal.myRosterId, proposal.theirRosterId],
    finder: validated.finder,
  });
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const world = loaded.world;

  const mineTeam = world.finder.teams.find((t) => t.rosterId === proposal.myRosterId);
  const theirTeam = world.finder.teams.find((t) => t.rosterId === proposal.theirRosterId);
  if (!mineTeam || !theirTeam) {
    return { ok: false, error: "One of those teams is not in this league." };
  }

  // Only slots the projection model can fill. IDP slots are dropped for the same
  // reason Power Pulse drops them: nothing is published for them, and filling
  // them with zero would drag every team toward a floor no roster can reach.
  const slots = startingSlots(world.league.rosterPositions);
  const weeks = world.remainingWeeks;

  const outgoingPlayerIds = outgoing
    .filter((a): a is Extract<ResolvedAsset, { kind: "player" }> => a.kind === "player")
    .map((a) => a.playerId);
  const incomingPlayerIds = incoming
    .filter((a): a is Extract<ResolvedAsset, { kind: "player" }> => a.kind === "player")
    .map((a) => a.playerId);

  // TWO projection passes, not five.
  //
  // Each roster is projected ONCE, in its current state. Every "after" figure is
  // derived from that by filtering out what leaves and concatenating what
  // arrives, because a player's projection does not depend on which roster he
  // sits on. The earlier version called buildRosterWeeks five times over
  // overlapping player sets, which at 30 startable players and 14 remaining
  // weeks was about 1260 redundant projectPlayerWeek calls per evaluation.
  const mineBefore = buildRosterWeeks(world, proposal.myRosterId, new Set<string>());
  const theirBefore = buildRosterWeeks(world, proposal.theirRosterId, new Set<string>());
  const incomingWeeks = buildIncomingWeeks(world, incoming);
  const outgoingWeeks = buildIncomingWeeks(world, outgoing);

  const mineAfter = applySwap(mineBefore, incomingWeeks, outgoingPlayerIds, weeks);
  const theirAfter = applySwap(theirBefore, outgoingWeeks, incomingPlayerIds, weeks);

  const mineSwap = computeRosterSwap({
    slots,
    weeks,
    rosterByWeek: mineBefore,
    incomingByWeek: incomingWeeks,
    outgoingPlayerIds,
  });
  const theirSwap = computeRosterSwap({
    slots,
    weeks,
    rosterByWeek: theirBefore,
    incomingByWeek: outgoingWeeks,
    outgoingPlayerIds: incomingPlayerIds,
  });

  const lineupUnavailable = weeks.length === 0 || world.projections.size === 0;

  // ---- season simulation ---------------------------------------------------
  // Baseline: every OTHER team from the Power Pulse cache, the two involved
  // teams from our own computation. See lib/trade-impact/load.ts for why.
  const baseline = new Map<number, WeeklyDistribution>();
  for (const [rosterId, dist] of world.cachedWeekly) baseline.set(rosterId, dist);
  baseline.set(proposal.myRosterId, mineSwap.weeklyBefore);
  baseline.set(proposal.theirRosterId, theirSwap.weeklyBefore);

  const replacements = new Map<number, WeeklyDistribution>([
    [proposal.myRosterId, mineSwap.weeklyAfter],
    [proposal.theirRosterId, theirSwap.weeklyAfter],
  ]);

  const upcoming = world.schedule.filter(
    (w) => !w.isFinal && w.week >= world.currentWeek && w.week < world.league.playoffWeekStart,
  );

  // Every roster needs a distribution or the simulation is scoring a league it
  // only half knows, which is worse than saying nothing.
  const everyRosterCovered = world.rosters.every((r) => baseline.has(r.sleeperRosterId));
  const sim =
    !lineupUnavailable && everyRosterCovered
      ? simulateWithReplacements({
          rosters: world.rosters,
          baseline,
          replacements,
          upcoming,
          options: {
            runs: world.settings.simulation.runs,
            seed: world.settings.simulation.seed,
            playoffTeams: world.league.playoffTeams,
            playoffWeekStart: world.league.playoffWeekStart,
          },
        })
      : null;

  const gaps: ImpactGaps = {
    lineup: lineupUnavailable,
    simulation: sim === null,
    picks: !world.finder.allowPicks,
  };

  const opponentFor = (rosterId: number, week: number): number | null => {
    const scheduled = world.schedule.find((w) => w.week === week);
    return scheduled?.opponents.get(rosterId) ?? null;
  };
  const teamNameFor = (rosterId: number | null): string | null => {
    if (rosterId === null) return null;
    return world.finder.teams.find((t) => t.rosterId === rosterId)?.teamName ?? null;
  };

  const buildWeeks = (
    swap: typeof mineSwap,
    rosterId: number,
  ): WeekImpact[] =>
    swap.weeks.map((w) => {
      const opponentRosterId = opponentFor(rosterId, w.week);
      const opponentDist =
        opponentRosterId === null ? null : baseline.get(opponentRosterId)?.get(w.week) ?? null;
      const own = { mean: w.beforeTotal, sigma: swap.weeklyBefore.get(w.week)?.sigma ?? 0 };
      const ownAfter = { mean: w.afterTotal, sigma: swap.weeklyAfter.get(w.week)?.sigma ?? 0 };
      return {
        week: w.week,
        opponentRosterId,
        opponentName: teamNameFor(opponentRosterId),
        beforeMean: w.beforeTotal,
        afterMean: w.afterTotal,
        delta: w.delta,
        winProbBefore: opponentDist
          ? winProbability(own.mean, own.sigma, opponentDist.mean, opponentDist.sigma)
          : null,
        winProbAfter: opponentDist
          ? winProbability(ownAfter.mean, ownAfter.sigma, opponentDist.mean, opponentDist.sigma)
          : null,
      };
    });

  const statusOf = (team: typeof mineTeam) => team.statusLabel ?? null;

  const mineImpact: TeamImpact = {
    rosterId: proposal.myRosterId,
    teamName: mineTeam.teamName,
    statusLabel: statusOf(mineTeam),
    pulseRank: mineTeam.pulseRank,
    valueBefore: teamValueOf(mineTeam, world.finder.allowPicks),
    valueAfter: 0,
    valueDelta: sumValue(incoming) - sumValue(outgoing),
    ageDelta: ageDeltaOf(incoming, outgoing),
    pickCountDelta: pickCount(incoming) - pickCount(outgoing),
    lineupBefore: lineupUnavailable ? null : mineSwap.meanBefore,
    lineupAfter: lineupUnavailable ? null : mineSwap.meanAfter,
    lineupDelta: lineupUnavailable ? null : mineSwap.delta,
    weeks: lineupUnavailable ? [] : buildWeeks(mineSwap, proposal.myRosterId),
    weeksImproved: mineSwap.weeksImproved,
    weeksWorsened: mineSwap.weeksWorsened,
    incomingStartWeeks: mineSwap.incomingStartWeeks,
    projectedWinsBefore: sim?.before.get(proposal.myRosterId)?.expectedWins ?? null,
    projectedWinsAfter: sim?.after.get(proposal.myRosterId)?.expectedWins ?? null,
    playoffOddsBefore: sim?.before.get(proposal.myRosterId)?.playoffOdds ?? null,
    playoffOddsAfter: sim?.after.get(proposal.myRosterId)?.playoffOdds ?? null,
    titleOddsBefore: sim?.before.get(proposal.myRosterId)?.titleOdds ?? null,
    titleOddsAfter: sim?.after.get(proposal.myRosterId)?.titleOdds ?? null,
    positionBefore: positionPointsFrom(mineBefore, weeks),
    positionAfter: positionPointsFrom(mineAfter, weeks),
    incoming,
    outgoing,
  };
  mineImpact.valueAfter = mineImpact.valueBefore + mineImpact.valueDelta;

  const theirImpact: TeamImpact = {
    rosterId: proposal.theirRosterId,
    teamName: theirTeam.teamName,
    statusLabel: statusOf(theirTeam),
    pulseRank: theirTeam.pulseRank,
    valueBefore: teamValueOf(theirTeam, world.finder.allowPicks),
    valueAfter: 0,
    valueDelta: sumValue(outgoing) - sumValue(incoming),
    ageDelta: ageDeltaOf(outgoing, incoming),
    pickCountDelta: pickCount(outgoing) - pickCount(incoming),
    lineupBefore: lineupUnavailable ? null : theirSwap.meanBefore,
    lineupAfter: lineupUnavailable ? null : theirSwap.meanAfter,
    lineupDelta: lineupUnavailable ? null : theirSwap.delta,
    weeks: lineupUnavailable ? [] : buildWeeks(theirSwap, proposal.theirRosterId),
    weeksImproved: theirSwap.weeksImproved,
    weeksWorsened: theirSwap.weeksWorsened,
    incomingStartWeeks: theirSwap.incomingStartWeeks,
    projectedWinsBefore: sim?.before.get(proposal.theirRosterId)?.expectedWins ?? null,
    projectedWinsAfter: sim?.after.get(proposal.theirRosterId)?.expectedWins ?? null,
    playoffOddsBefore: sim?.before.get(proposal.theirRosterId)?.playoffOdds ?? null,
    playoffOddsAfter: sim?.after.get(proposal.theirRosterId)?.playoffOdds ?? null,
    titleOddsBefore: sim?.before.get(proposal.theirRosterId)?.titleOdds ?? null,
    titleOddsAfter: sim?.after.get(proposal.theirRosterId)?.titleOdds ?? null,
    positionBefore: positionPointsFrom(theirBefore, weeks),
    positionAfter: positionPointsFrom(theirAfter, weeks),
    incoming: outgoing,
    outgoing: incoming,
  };
  theirImpact.valueAfter = theirImpact.valueBefore + theirImpact.valueDelta;

  // Signal Check, as a second opinion that decides nothing. A failure here must
  // not cost the reader the rest of the evaluation.
  const [grade] = await gradeAssetPairs(admin, world.finder.sleeperLeague, [
    {
      incoming: toSuggestionAssets(incoming),
      outgoing: toSuggestionAssets(outgoing),
      counterpartyLabel: theirTeam.teamName,
    },
  ]).catch(() => [null]);

  const reasonInput = {
    mine: mineImpact,
    theirs: theirImpact,
    gaps,
    weeksConsidered: weeks.length,
    isDynasty: world.finder.isDynasty,
    grade: grade ?? null,
    weakestSlot: (() => {
      if (lineupUnavailable) return null;
      const weakest = weakestSlotOf(slots, mineSwap);
      // The reason prints this. A reader should see "Your SUPERFLEX", never
      // "Your SUPER_FLEX".
      return weakest ? { ...weakest, label: slotLabel(weakest.label) } : null;
    })(),
    depthCost: depthCostOf(mineImpact.positionBefore, mineImpact.positionAfter),
  };

  const unpricedNames = [...incoming, ...outgoing]
    .filter((a): a is Extract<ResolvedAsset, { kind: "player" }> => a.kind === "player")
    .filter((a) => a.projPoints === null)
    .map((a) => a.name);
  const inactiveNames = [...incoming, ...outgoing]
    .filter((a): a is Extract<ResolvedAsset, { kind: "player" }> => a.kind === "player")
    .filter((a) => a.isInactive)
    .map((a) => a.name);

  return {
    ok: true,
    impact: {
      mine: mineImpact,
      theirs: theirImpact,
      reasons: buildTradeReasons(reasonInput),
      caveats: buildTradeCaveats({
        ...reasonInput,
        unpricedNames,
        inactiveNames,
        pickSourceDisplay: world.finder.pickSourceDisplay,
      }),
      grade: grade ?? null,
      gaps,
      weeksConsidered: weeks.length,
      formatDisplay: world.finder.formatDisplay,
      sourceDisplay: world.finder.sourceDisplay,
      pickSourceDisplay: world.finder.pickSourceDisplay,
    },
  };
}
