/**
 * What a team is, in the two sentences a trade actually turns on: which way it
 * is pointing, and where its lineup leaks points.
 *
 * DIRECTION comes from the Competitor / Mid Tier / Rebuilder call that already
 * exists (lib/league-team-status.ts), so Trade Finder and the rest of League
 * Pulse can never disagree about who is competing. A team with no Power Pulse
 * row has no direction and is read as balanced, which is the absence of a claim
 * rather than a claim of mediocrity.
 *
 * NEED is measured, not assumed. For each position we ask a concrete question:
 * how many points a week would this team's STARTING LINEUP gain if we handed it
 * one league-average starter at that position? That number is the need. It falls
 * out of the same optimal-lineup fill Power Pulse uses, so it respects flex
 * slots, superflex, and the fact that a team with four good tight ends in a
 * one-TE league needs a fifth about as much as it needs a bye week.
 *
 * The alternative, counting bodies at each position, gets superflex wrong every
 * time: two quarterbacks looks like plenty until you notice the league starts
 * three.
 *
 * SURPLUS is measured the same way, by removal rather than by addition: how many
 * points a week does this lineup lose if this player leaves? A bench player
 * costs nothing, so he is surplus by definition. But so is the third running
 * back who technically holds a flex slot while projecting half a point more than
 * the receiver behind him, and "is he in the optimal lineup" would have called
 * that one untouchable.
 *
 * That distinction is the difference between a feature that finds trades and one
 * that mostly finds nothing. Real rosters start their good players; what makes a
 * player tradeable is not that he sits, it is that somebody else on the roster
 * can do nearly the same job.
 *
 * Pure. No database, no React. Cost is one lineup fill per rostered player plus
 * one per position, each over a roster-sized candidate list.
 */

import { buildOptimalLineup } from "@/lib/power-pulse/lineup";
import { PULSE_POSITIONS, type PulsePosition } from "@/lib/power-pulse/types";
import type { LineupCandidate } from "@/lib/power-pulse/lineup";
import type { FinderPlayer, FinderTeam, TeamDirection } from "./types";

/** Positions the lineup math can speak about at all. */
const LINEUP_POSITIONS = new Set<string>(PULSE_POSITIONS);

export type TeamProfile = {
  team: FinderTeam;
  direction: TeamDirection;
  /** Optimal starting lineup, points per week. Null with no projections. */
  startingTotal: number | null;
  /** player ids that make the optimal lineup. */
  starterIds: Set<string>;
  /**
   * Points per week this lineup would gain from one league-average starter at
   * each position. Empty when there are no projections to fill a lineup with.
   */
  positionNeed: Record<string, number>;
  /**
   * Points per week the optimal lineup loses if this player leaves. Zero for a
   * bench player. Empty when there are no projections to measure against.
   */
  replacementCost: Map<string, number>;
  /** Valuable players this roster could lose cheaply, best value first. */
  surplus: FinderPlayer[];
  /** Total trade value of every player and pick held. */
  totalValue: number;
  /** Value-weighted mean age of the players held. Null when no ages are known. */
  meanAge: number | null;
};

/** Only players who can be seated: known position, projected, not on IR/taxi. */
export function lineupCandidates(players: FinderPlayer[]): LineupCandidate[] {
  const out: LineupCandidate[] = [];
  for (const p of players) {
    if (p.isInactive) continue;
    if (p.projPoints === null || !Number.isFinite(p.projPoints)) continue;
    if (!LINEUP_POSITIONS.has(p.position)) continue;
    out.push({
      playerId: p.playerId,
      position: p.position as PulsePosition,
      points: p.projPoints,
      // Sigma drives the Monte Carlo in Power Pulse. Trade Finder compares two
      // lineups rather than simulating a season, so the spread never enters the
      // arithmetic and a flat zero is honest here.
      sigma: 0,
    });
  }
  return out;
}

/**
 * Optimal starting points per week for a set of players.
 *
 * Returns null when nobody on the roster has a projection, which the callers
 * treat as "we cannot answer this", never as zero. A zero here would read as a
 * lineup that scores nothing.
 */
export function lineupTotal(
  slots: string[],
  players: FinderPlayer[],
): number | null {
  const candidates = lineupCandidates(players);
  if (candidates.length === 0) return null;
  return buildOptimalLineup(slots, candidates).total;
}

/** The player ids that make the optimal lineup. */
function optimalStarterIds(slots: string[], players: FinderPlayer[]): Set<string> {
  const candidates = lineupCandidates(players);
  const out = new Set<string>();
  if (candidates.length === 0) return out;
  for (const slot of buildOptimalLineup(slots, candidates).slots) {
    if (slot.playerId) out.add(slot.playerId);
  }
  return out;
}

/**
 * What a league-average starter is worth at each position, in points per week.
 *
 * Taken from the players who actually hold a starting slot somewhere in this
 * league, so the yardstick is the room the reader is trading in rather than a
 * national average. The median is used rather than the mean because one
 * quarterback projecting 26 a week should not redefine what "average starter"
 * means for the other eleven teams.
 */
export function leagueStarterBaselines(
  teams: FinderTeam[],
  slots: string[],
): Record<string, number> {
  const byPosition = new Map<string, number[]>();
  const positionOf = new Map<string, string>();
  const pointsOf = new Map<string, number>();

  for (const team of teams) {
    for (const p of team.players) {
      positionOf.set(p.playerId, p.position);
      if (p.projPoints !== null) pointsOf.set(p.playerId, p.projPoints);
    }
  }

  for (const team of teams) {
    for (const playerId of optimalStarterIds(slots, team.players)) {
      const position = positionOf.get(playerId);
      const points = pointsOf.get(playerId);
      if (!position || points === undefined) continue;
      const list = byPosition.get(position) ?? [];
      list.push(points);
      byPosition.set(position, list);
    }
  }

  const out: Record<string, number> = {};
  for (const [position, list] of byPosition) {
    list.sort((a, b) => a - b);
    const mid = Math.floor(list.length / 2);
    out[position] =
      list.length % 2 === 0 ? (list[mid - 1] + list[mid]) / 2 : list[mid];
  }
  return out;
}

/** Competitor / Mid Tier / Rebuilder, as the engine reads it. */
export function directionOf(team: FinderTeam): TeamDirection {
  if (team.statusKey === "competitor") return "win-now";
  if (team.statusKey === "rebuilder") return "rebuild";
  return "balanced";
}

/**
 * How much this roster would gain, per week, from one average starter at each
 * position.
 *
 * The phantom player is seated by the same optimal fill as everyone else, so a
 * team whose flex is already covered three deep correctly reports a small gain,
 * and a superflex team missing a second quarterback correctly reports a large
 * one.
 */
function measurePositionNeed(
  slots: string[],
  players: FinderPlayer[],
  baselines: Record<string, number>,
  baseTotal: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  const candidates = lineupCandidates(players);
  for (const [position, points] of Object.entries(baselines)) {
    if (!LINEUP_POSITIONS.has(position)) continue;
    const withPhantom = [
      ...candidates,
      {
        playerId: `__phantom_${position}`,
        position: position as PulsePosition,
        points,
        sigma: 0,
      },
    ];
    const gain = buildOptimalLineup(slots, withPhantom).total - baseTotal;
    out[position] = Math.max(0, gain);
  }
  return out;
}

/** Value-weighted mean age, so one 34-year-old bench body cannot skew a roster. */
function weightedMeanAge(players: FinderPlayer[]): number | null {
  let weighted = 0;
  let weight = 0;
  for (const p of players) {
    if (p.age === null || !p.hasValue || p.value <= 0) continue;
    weighted += p.age * p.value;
    weight += p.value;
  }
  return weight > 0 ? weighted / weight : null;
}

/**
 * What the lineup loses if each player leaves.
 *
 * One fill per player. A bench player scores zero, and so does a nominal starter
 * whose replacement is just as good, which is exactly the player a manager can
 * afford to trade.
 */
function measureReplacementCost(
  slots: string[],
  players: FinderPlayer[],
  baseTotal: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const candidates = lineupCandidates(players);
  const seatable = new Set(candidates.map((c) => c.playerId));

  for (const p of players) {
    // A player the lineup cannot seat (no projection, on IR) costs nothing to
    // lose in points, whatever he is worth in a trade.
    if (!seatable.has(p.playerId)) {
      out.set(p.playerId, 0);
      continue;
    }
    const without = candidates.filter((c) => c.playerId !== p.playerId);
    const total = without.length === 0 ? 0 : buildOptimalLineup(slots, without).total;
    out.set(p.playerId, Math.max(0, baseTotal - total));
  }
  return out;
}

/**
 * How cheap a player has to be to lose before he counts as currency, in points
 * per week.
 *
 * Two points is about a fifth of a starting flex, which is the most a manager
 * will shrug at for the right return. Above that it is a real subtraction and
 * the deal has to argue for itself on the incoming side.
 */
const SURPLUS_COST_CEILING = 2;

/**
 * Without projections, the top of a roster by value stands in for its lineup.
 *
 * A blunt rule, and stated as one: with nothing to fill a lineup from, the only
 * honest reading of "untouchable" is "one of the best few players here".
 */
const UNTOUCHABLE_BY_VALUE = 3;

/**
 * Build one team's profile.
 *
 * `surplusFloor` keeps waiver flotsam out of the surplus list: a player has to
 * be worth at least this share of the roster's best player before the fact that
 * he is expendable says anything interesting about him.
 */
export function buildTeamProfile(
  team: FinderTeam,
  slots: string[],
  baselines: Record<string, number>,
  surplusFloor = 0.06,
): TeamProfile {
  const startingTotal = lineupTotal(slots, team.players);
  const starterIds = optimalStarterIds(slots, team.players);

  const bestValue = team.players.reduce(
    (max, p) => (p.hasValue && p.value > max ? p.value : max),
    0,
  );
  const floor = bestValue * surplusFloor;

  const replacementCost =
    startingTotal === null
      ? new Map<string, number>()
      : measureReplacementCost(slots, team.players, startingTotal);

  const affordable = new Set<string>();
  if (startingTotal === null) {
    const ranked = [...team.players]
      .filter((p) => p.hasValue)
      .sort((a, b) => b.value - a.value);
    for (const p of ranked.slice(UNTOUCHABLE_BY_VALUE)) affordable.add(p.playerId);
  } else {
    for (const [playerId, cost] of replacementCost) {
      if (cost <= SURPLUS_COST_CEILING) affordable.add(playerId);
    }
  }

  const surplus = team.players
    .filter((p) => p.hasValue && p.value > floor && affordable.has(p.playerId))
    .sort((a, b) => b.value - a.value || a.playerId.localeCompare(b.playerId));

  const playersValue = team.players.reduce(
    (sum, p) => sum + (p.hasValue ? p.value : 0),
    0,
  );
  const picksValue = team.picks.reduce(
    (sum, p) => sum + (p.hasValue ? p.value : 0),
    0,
  );

  return {
    team,
    direction: directionOf(team),
    startingTotal,
    starterIds,
    replacementCost,
    positionNeed:
      startingTotal === null
        ? {}
        : measurePositionNeed(slots, team.players, baselines, startingTotal),
    surplus,
    totalValue: playersValue + picksValue,
    meanAge: weightedMeanAge(team.players),
  };
}

export const PROFILE_THRESHOLDS = { SURPLUS_COST_CEILING, UNTOUCHABLE_BY_VALUE };
