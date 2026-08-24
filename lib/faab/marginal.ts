/**
 * What does adding this player actually do to your team?
 *
 * The old calculator answered a different question. It took a player's overall
 * rank, divided by "teams times starters", and read a bid off a curve. That
 * prices the player as an asset. A FAAB bid is not an asset purchase: it buys
 * points in YOUR starting lineup over the weeks YOU have left. A dynasty rookie
 * everyone loves can be worth nothing to you this year, and a boring veteran on
 * a good offense can be worth a quarter of your budget.
 *
 * So we do the only thing that actually answers it. Build your optimal lineup
 * for every remaining week without him, build it again with him, and measure
 * the difference. If he never displaces anyone, the difference is zero and we
 * say so out loud instead of quoting a percentage.
 *
 * Pure. Every projection arrives already computed by lib/power-pulse/project.ts,
 * which is the same model the Power Pulse page uses, so a FAAB answer and a
 * Power Pulse answer can never disagree about what a player is projected to do.
 */

import {
  buildOptimalLineup,
  lineupSigma,
  type LineupCandidate,
} from "@/lib/power-pulse/lineup";
import type { PulsePosition } from "@/lib/power-pulse/types";
import type {
  DropCandidate,
  DropCost,
  DropGuardSettings,
  MarginalWeek,
} from "./types";

/** One week of a candidate's projected output. */
export type CandidateWeek = {
  points: number;
  sigma: number;
  opponent: string | null;
  opponentMultiplier: number;
};

export type LineupSwapInput = {
  /** The league's startable slot tokens, in the league's own order. */
  slots: string[];
  /** Remaining regular season weeks, ascending. */
  weeks: number[];
  /** Your roster's projectable players for each week. */
  rosterByWeek: Map<number, LineupCandidate[]>;
  /** The free agent, projected on identical terms. A missing week is a bye. */
  candidateByWeek: Map<number, CandidateWeek>;
  candidatePlayerId: string;
  candidatePosition: PulsePosition;
  /** Names for whoever we would suggest dropping. */
  rosterMeta: Map<string, RosterMetaEntry>;
  /**
   * True when the roster is full, so adding him requires cutting someone. When
   * there is an open bench spot the drop costs nothing and we do not pretend
   * otherwise.
   */
  mustDrop: boolean;
  /**
   * The same roster projected as if nobody were hurt, used ONLY to rank cut
   * candidates. A player on IR projects zero every week, which makes him look
   * free to cut when he is the opposite. Absent means fall back to the real
   * projections, which is the old behavior.
   */
  healthyRosterByWeek?: Map<number, LineupCandidate[]>;
  /** Market value per rostered player, in the league's own format. */
  rosterValues?: Map<string, number | null>;
  /** The same measure for the player being added. Null disables the ratio guard. */
  candidateValue?: number | null;
  /**
   * True for dynasty and keeper leagues. A cut there gives up the asset itself
   * rather than the rest of one season, so the bar for naming one is higher.
   */
  isKeeperLeague?: boolean;
  dropGuard?: DropGuardSettings;
};

export type RosterMetaEntry = {
  name: string;
  position: string;
  /** NFL team, for telling two players with the same surname apart. */
  team?: string | null;
  /** Sleeper's injury designation, verbatim. Null when healthy. */
  injuryStatus?: string | null;
};

export type LineupSwapResult = {
  weeks: MarginalWeek[];
  weeksConsidered: number;
  weeksStarting: number;
  /** Lineup points he adds, ignoring the cut. Averaged over every week. */
  pointsPerWeek: number;
  /** Averaged over only the weeks he starts. The flattering number. */
  pointsPerStartedWeek: number;
  /** After the cut. This is what the bid is actually built from. */
  netPointsPerWeek: number;
  dropCost: DropCost | null;
  /** Cheapest first. The applied cut is the first entry. */
  dropOptions: DropCandidate[];
  /** Why we would not name somebody, when we would not. */
  dropNote: string | null;
  isBenchOnly: boolean;
  /** Weekly lineup mean and spread as your team stands now. */
  weeklyBefore: Map<number, { mean: number; sigma: number }>;
  /** The same, with him added and the cut applied. */
  weeklyAfter: Map<number, { mean: number; sigma: number }>;
};

function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function withCandidate(
  roster: LineupCandidate[],
  input: LineupSwapInput,
  week: number,
): LineupCandidate[] {
  const own = input.candidateByWeek.get(week);
  if (!own) return roster;
  return [
    ...roster,
    {
      playerId: input.candidatePlayerId,
      position: input.candidatePosition,
      points: own.points,
      sigma: own.sigma,
    },
  ];
}

/**
 * Injury designations that keep a player out for longer than one week. Kept in
 * step with LONG_TERM_INJURY_STATUSES in lib/power-pulse/project.ts, which is
 * what drives the zero projection this guard exists to see past.
 */
const LONG_TERM_STATUSES = new Set(["IR", "PUP", "NA", "SUS", "COV", "DNR"]);

function isLongTermStatus(status: string | null | undefined): boolean {
  return Boolean(status && LONG_TERM_STATUSES.has(status.toUpperCase()));
}

/** A player with no value row sits at the bottom of any board we could build. */
function valueOf(values: Map<string, number | null> | undefined, id: string): number {
  const v = values?.get(id);
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Which players we are willing to name as the cut.
 *
 * Lineup cost alone answers "who does my starting lineup miss least", which is
 * the wrong question for a cut, because a cut is permanent and returns nothing.
 * Two guards sit in front of it.
 *
 * REDRAFT. Never name a player the market rates above the man being added.
 * Malik Nabers on IR projects zero for every remaining week, so by lineup cost
 * he is free to cut; the redraft market still has him well above a waiver
 * running back, so we do not say it. When a season really is over for a player,
 * the redraft market marks him down and this guard lets go of him on its own.
 * We are not guessing at return dates, we are reading the rest-of-season price
 * somebody else already set.
 *
 * DYNASTY AND KEEPER. Only the bottom slice of the roster by value is ever
 * named. In a league where you keep your team, cutting a top asset for a waiver
 * add is not a move you would make and not one we will print, whatever this
 * week's projection says about him.
 *
 * Both guards stand down on a roster with too few valued players to have a
 * meaningful top and bottom.
 */
function eligibleForDrop(
  input: LineupSwapInput,
  ids: string[],
): { eligible: Set<string>; refused: string[] } {
  const guard = input.dropGuard;
  const all = new Set(ids);
  if (!guard?.enabled) return { eligible: all, refused: [] };

  const values = input.rosterValues;
  const valued = ids.filter((id) => valueOf(values, id) > 0);
  if (valued.length < guard.minValuedPlayers) return { eligible: all, refused: [] };

  let allowed: (id: string) => boolean;

  if (input.isKeeperLeague) {
    // Bottom share by value, ascending, so a player with no value row sorts to
    // the very bottom and stays droppable.
    const ordered = [...ids].sort((a, b) => valueOf(values, a) - valueOf(values, b));
    const keep = Math.max(1, Math.floor(ordered.length * guard.keeperBottomShare));
    const bottom = new Set(ordered.slice(0, keep));
    allowed = (id) => bottom.has(id);
  } else {
    const candidateValue = input.candidateValue;
    // No price for the man being added means no bar to test against, so the
    // guard stands down rather than inventing one.
    if (
      typeof candidateValue !== "number" ||
      !Number.isFinite(candidateValue) ||
      candidateValue <= 0
    ) {
      return { eligible: all, refused: [] };
    }
    const ceiling = candidateValue * guard.maxDropValueRatio;
    allowed = (id) => valueOf(values, id) <= ceiling;
  }

  const eligible = new Set<string>();
  const refused: string[] = [];
  for (const id of ids) {
    if (allowed(id)) eligible.add(id);
    else refused.push(id);
  }
  refused.sort((a, b) => valueOf(values, b) - valueOf(values, a));

  return { eligible, refused };
}

/**
 * Which player is cheapest to cut, measured properly.
 *
 * "Worst projected points" is the intuitive answer and the wrong one, because a
 * backup quarterback projected for 14 points may never start while a third
 * running back projected for 9 does. What matters is what the LINEUP loses, so
 * we remove each player in turn, rebuild, and take whoever costs the least.
 * Ties break toward the lower raw projection so the suggestion reads sensibly.
 *
 * The ranking runs on the healthy projections when we have them, so a player
 * who is hurt this week cannot look disposable for that reason alone.
 */
/**
 * How many cuts we offer. Fewer than two is a verdict dressed as a list; more
 * than four is a roster dump the reader has to wade through.
 */
const MAX_DROP_OPTIONS = 4;

function chooseDrop(input: LineupSwapInput): {
  drop: DropCost | null;
  options: DropCandidate[];
  note: string | null;
} {
  const { slots, weeks, rosterMeta } = input;
  const ranking = input.healthyRosterByWeek ?? input.rosterByWeek;

  const everyone = new Set<string>();
  for (const week of weeks) {
    for (const c of ranking.get(week) ?? []) everyone.add(c.playerId);
  }
  if (everyone.size === 0) return { drop: null, options: [], note: null };

  const ids = Array.from(everyone);
  const { eligible, refused } = eligibleForDrop(input, ids);
  const refusedSet = new Set(refused);

  // Two scoring passes over the same players. The ranking board is what we
  // choose from; the real board is what the reader is actually playing, and it
  // gives us both the cost we print and the name the unguarded model would have
  // produced. When there is no healthy board the two are the same map and the
  // second pass is the same numbers twice, which is cheap enough to be worth
  // the simpler code.
  const byRanking = scoreRemovals(slots, weeks, ranking, ids);
  const byReality = scoreRemovals(slots, weeks, input.rosterByWeek, ids);

  // The two boards do different jobs, and keeping them apart is what makes the
  // list both safe and readable.
  //
  //   The healthy board CHOOSES WHO MAY BE NAMED. A player is only a candidate
  //   if his lineup is cheap to lose when he is fit, which is what keeps an
  //   injured starter out of the shortlist however little he projects today.
  //
  //   The real board ORDERS THEM and picks the one the figures are measured
  //   against. It is the cost the reader actually pays, so it is the number
  //   printed beside each name, and a list printed out of order in its own
  //   numbers reads as a bug.
  const shortlist = ids
    .filter((id) => eligible.has(id))
    .map((id) => byRanking.get(id))
    .filter((scored): scored is Scored => scored !== undefined)
    .sort((a, b) => (Math.abs(a.cost - b.cost) > 1e-9 ? a.cost - b.cost : a.rawPoints - b.rawPoints))
    .slice(0, MAX_DROP_OPTIONS);

  // Whoever the model would have named with no guards at all: cheapest to lose
  // on the board as it stands, injuries and everything. This is the sentence
  // the reader needs, because it is the name they were expecting to see.
  let naive: Scored | null = null;
  for (const id of ids) {
    const scored = byReality.get(id);
    if (scored && cheaperThan(scored, naive)) naive = scored;
  }

  // Nobody cleared the guards. Deliberately nameless: the cheapest player to
  // lose here is whoever we just protected, so printing his name would read as
  // a suggestion to cut the man we refused to suggest cutting.
  if (shortlist.length === 0) {
    return {
      drop: null,
      options: [],
      note: "There is nobody on your roster we would tell you to release for him. Winning this claim means giving up somebody you would rather keep, and that call is yours to make.",
    };
  }

  const options: DropCandidate[] = shortlist
    .map((scored) => {
      const meta = rosterMeta.get(scored.id);
      const cost = byReality.get(scored.id)?.cost ?? scored.cost;
      return {
        playerId: scored.id,
        name: meta?.name ?? "a bench player",
        position: meta?.position ?? "",
        team: meta?.team ?? null,
        pointsPerWeek: cost,
        injuryStatus: meta?.injuryStatus ?? null,
        note: candidateNote(cost, meta?.injuryStatus ?? null),
      };
    })
    // Sort is stable, so players who cost the same land in healthy-board order.
    .sort((a, b) => a.pointsPerWeek - b.pointsPerWeek);

  // The cheapest spot to clear, which is what the net figures are measured
  // against. Taken from the real board for the same reason it is printed from
  // the real board: it is the cost the reader is actually paying this season.
  const drop = options[0];

  const notes: string[] = [];

  // Say who we passed over, and why, whenever the guards changed the answer.
  // Without this the reader sees a player projecting zero sitting on their
  // bench and no explanation for why he is not on the list.
  if (naive && !options.some((o) => o.playerId === naive.id)) {
    const passedMeta = rosterMeta.get(naive.id);
    const passedName = passedMeta?.name;
    if (passedName) {
      const projectsFor = passedMeta?.injuryStatus
        ? `${passedName} projects for nothing while he is on ${passedMeta.injuryStatus}`
        : `${passedName} projects for the least of anyone here`;
      const because = refusedSet.has(naive.id)
        ? input.isKeeperLeague
          ? "but you keep this team, and he is nowhere near the bottom of it"
          : "but the market still rates him above this claim"
        : "but he is only projecting low because he is hurt";
      notes.push(`${projectsFor}, ${because}, so we left him off this list.`);
    }
  }

  return { drop, options, note: notes.length > 0 ? notes.join(" ") : null };
}

/**
 * One plain sentence about a player's place on the roster, for anyone who does
 * not want to work out what "0.4 points a week" means. The figure itself sits
 * beside it for anyone who does.
 */
function candidateNote(costPerWeek: number, injuryStatus: string | null): string {
  if (isLongTermStatus(injuryStatus)) {
    return `Out on ${injuryStatus}, so he is not scoring for you.`;
  }
  if (costPerWeek <= 0.05) return "Never cracks your best lineup.";
  if (costPerWeek < 1) return "Sneaks in occasionally. You would barely notice.";
  if (costPerWeek < 3) return "Starts some weeks. You would feel this one.";
  return "A real part of your lineup. Only cut him if you are sure.";
}

type Scored = { id: string; cost: number; rawPoints: number };

function cheaperThan(a: Scored, b: Scored | null): boolean {
  return (
    b === null ||
    a.cost < b.cost - 1e-9 ||
    (Math.abs(a.cost - b.cost) <= 1e-9 && a.rawPoints < b.rawPoints)
  );
}

/**
 * What the optimal lineup loses by removing each player in turn, averaged over
 * the remaining weeks. Baselines come from the same board being scored, because
 * measuring a healthy-board removal against an injured-board baseline would
 * report a cost for everybody that nobody is paying.
 */
function scoreRemovals(
  slots: string[],
  weeks: number[],
  board: Map<number, LineupCandidate[]>,
  ids: string[],
): Map<string, Scored> {
  const base = new Map<number, number>();
  for (const week of weeks) {
    base.set(week, buildOptimalLineup(slots, board.get(week) ?? []).total);
  }

  const out = new Map<string, Scored>();
  for (const id of ids) {
    const costs: number[] = [];
    let rawTotal = 0;
    let rawWeeks = 0;
    for (const week of weeks) {
      const candidates = board.get(week) ?? [];
      const own = candidates.find((c) => c.playerId === id);
      if (own) {
        rawTotal += own.points;
        rawWeeks += 1;
      }
      const without = candidates.filter((c) => c.playerId !== id);
      const reduced = buildOptimalLineup(slots, without).total;
      costs.push(Math.max(0, (base.get(week) ?? 0) - reduced));
    }
    out.set(id, {
      id,
      cost: meanOf(costs),
      rawPoints: rawWeeks > 0 ? rawTotal / rawWeeks : 0,
    });
  }
  return out;
}

/**
 * Run the swap. Returns the per-week detail plus the weekly distributions for
 * both scenarios, which the caller feeds to the season simulation to turn a
 * points gain into a playoff-odds gain.
 */
export function computeLineupSwap(input: LineupSwapInput): LineupSwapResult {
  const { slots, weeks, rosterByWeek, candidatePlayerId } = input;

  const weeklyBefore = new Map<number, { mean: number; sigma: number }>();
  const weeklyAfter = new Map<number, { mean: number; sigma: number }>();
  const baseTotals = new Map<number, number>();

  // Pass one: the team as it stands. The drop search is measured against these.
  for (const week of weeks) {
    const lineup = buildOptimalLineup(slots, rosterByWeek.get(week) ?? []);
    baseTotals.set(week, lineup.total);
    weeklyBefore.set(week, { mean: lineup.total, sigma: lineupSigma(lineup.slots) });
  }

  // An open bench spot means no cut, and naming one would invent a cost the
  // reader does not actually pay.
  const chosen = input.mustDrop
    ? chooseDrop(input)
    : { drop: null, options: [], note: null };
  const appliedDrop = chosen.drop;

  const detail: MarginalWeek[] = [];
  const grossGains: number[] = [];
  const netGains: number[] = [];
  const startedGains: number[] = [];

  for (const week of weeks) {
    const base = baseTotals.get(week) ?? 0;
    const roster = rosterByWeek.get(week) ?? [];

    // Gross: what he adds before anything is cut. This is his own contribution.
    const gross = buildOptimalLineup(slots, withCandidate(roster, input, week));

    // Net: the same lineup, after the player you would actually cut is gone.
    // When no cut is required the two are the same build.
    const afterDrop = appliedDrop
      ? buildOptimalLineup(
          slots,
          withCandidate(
            roster.filter((c) => c.playerId !== appliedDrop.playerId),
            input,
            week,
          ),
        )
      : gross;

    weeklyAfter.set(week, {
      mean: afterDrop.total,
      sigma: lineupSigma(afterDrop.slots),
    });

    const startsForYou = afterDrop.slots.some((s) => s.playerId === candidatePlayerId);
    const grossGain = gross.total - base;
    const netGain = afterDrop.total - base;

    grossGains.push(grossGain);
    netGains.push(netGain);
    if (startsForYou) startedGains.push(grossGain);

    const own = input.candidateByWeek.get(week);
    detail.push({
      week,
      startsForYou,
      pointsAdded: netGain,
      opponent: own?.opponent ?? null,
      opponentMultiplier: own?.opponentMultiplier ?? 1,
    });
  }

  const weeksStarting = detail.filter((w) => w.startsForYou).length;

  return {
    weeks: detail,
    weeksConsidered: weeks.length,
    weeksStarting,
    pointsPerWeek: meanOf(grossGains),
    pointsPerStartedWeek: meanOf(startedGains),
    netPointsPerWeek: meanOf(netGains),
    dropCost: appliedDrop,
    dropOptions: chosen.options,
    dropNote: chosen.note,
    isBenchOnly: weeksStarting === 0,
    weeklyBefore,
    weeklyAfter,
  };
}
