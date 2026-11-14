import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  loadAccuracy,
  loadDefenseSplits,
  loadLeague,
  loadPlayers,
  NAMING_POSITIONS,
  projectablePlayerIds,
  loadProjections,
  loadRosters,
  type ProjectionRow,
} from "@/lib/power-pulse/load";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { idpEnabledFrom } from "@/lib/power-pulse/default-settings";
import { idpReadsFor, scoringKeysArg } from "@/lib/power-pulse/idp-reads";
import { closestScoringBase } from "@/lib/league-scoring";
import { projectPlayerWeek, reliabilityMultiplier } from "@/lib/power-pulse/project";
import { defenseSeasonsFor } from "@/lib/projections/defense-seasons";
import { resolveProjectionSourceForWindow } from "@/lib/projections/source";
import { MAX_MATCHUP_WEEK, resolveCurrentWeek } from "@/lib/league-matchups";
import { getNflHomeAwayMap, getNflState } from "@/lib/sleeper";
import { loadGameEnvironment } from "@/lib/nfl-game-environment";
import { alignedStartingSlots } from "./slots";
import {
  expectedTotal,
  gameClock,
  liveWinChance,
  sideState,
  type SideState,
  type StarterState,
} from "./win-chance";
import { otherLegWeek, playoffLeg, type PlayoffShape } from "./playoff-legs";
import { currentWeekFromStored } from "./stored-week";
import {
  readRosteredPlayerPoints,
  readSetLineup,
  weekPlayerIds,
  type RawMatchupRow,
} from "./lineups";
import { buildMatchupView, type MatchupSideInput } from "./matchup";
import type {
  MatchupView,
  ScheduleBoard,
  ScheduleMatchup,
  ScheduleMatchupSide,
  ScheduleTeam,
  ScheduleWeekView,
} from "./types";

/**
 * The read layer for the Schedule section.
 *
 * TWO FUNCTIONS, TWO VERY DIFFERENT COSTS, and keeping them apart is the whole
 * design:
 *
 *   `loadScheduleBoard` renders the week list and the team list. It is four
 *   queries and no arithmetic. Every projected number on it comes from
 *   `league_power_pulse_cache.weekly`, which Power Pulse computed on the same
 *   page load. Nothing is re-derived, so the Schedule page and the Power Pulse
 *   page cannot report different projections for the same team in the same week,
 *   and a twelve team season costs the same as one week.
 *
 *   `loadMatchupDetail` renders one matchup. It projects about sixty players for
 *   one week, which is a fraction of what `pulseLeagueDerived` already does on
 *   the same visit, and it only ever runs on a URL somebody navigated to.
 *
 * "PROJECTED" MEANS THE SET LINEUP EVERYWHERE. For the week in play the board
 * projects every roster's set lineup and quotes one win chance, the same one
 * the matchup page and the Lineups what-if quote (./win-chance.ts). Every other
 * unplayed week has no lineup set yet, so it shows the Power Pulse best-lineup
 * figure, labeled as the best lineup and never as "Projected".
 */

type ServiceClient = SupabaseClient<Database>;
type AnyClient =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/** Rows the board needs out of league_matchups. Kept narrow on purpose. */
type BoardMatchupRow = {
  week: number;
  sleeper_roster_id: number;
  matchup_id: number | null;
  points: number;
  is_final: boolean;
};

type CachedWeeklyEntry = { week?: unknown; mean?: unknown; sigma?: unknown };

function finiteOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export type ScheduleBoardParams = {
  leagueRowId: string;
  season: number;
  /** Sleeper's playoff_week_start for this league. */
  playoffWeekStart: number;
  /**
   * Passed in so a page that already resolved it does not pay for it twice.
   * Null when Sleeper's NFL state could not be read: the board then shows what
   * is stored, with the first week not yet final as the one in play.
   */
  currentWeek: number | null;
};

/** One roster's row for the week in play, as the live win chance reads it. */
export type LiveWeekRow = {
  sleeper_roster_id: number;
  starter_ids: Json;
  starter_points: Json;
  player_points: Json;
  metadata: Json;
};

/**
 * Every roster's SET lineup for one week, projected and conditioned on what is
 * already scored (lib/league-schedule/win-chance.ts). One week, the starters
 * only: about ten players per roster, through the same projectPlayerWeek the
 * matchup page uses, so the board and the matchup page quote one win chance.
 */
export async function loadSetLineupStates(
  admin: ServiceClient,
  league: NonNullable<Awaited<ReturnType<typeof loadLeague>>>,
  season: number,
  week: number,
  currentWeek: number,
  rows: LiveWeekRow[],
  nowMs: number,
): Promise<Map<number, SideState>> {
  const out = new Map<number, SideState>();
  if (rows.length === 0) return out;
  const settings = await loadPowerPulseSettings(admin);
  const scoringBase = closestScoringBase(league.scoringSettings);
  const idpReads = idpReadsFor(idpEnabledFrom(settings), league.rosterPositions, scoringBase);
  const slots = alignedStartingSlots(league.rosterPositions, idpReads.slotMap);

  const lineups = rows.map((row) => {
    const raw: RawMatchupRow = {
      starter_ids: row.starter_ids,
      starter_points: row.starter_points,
      player_ids: null,
      player_points: row.player_points,
      metadata: row.metadata,
    };
    return {
      rosterId: Number(row.sleeper_roster_id),
      lineup: readSetLineup(raw, slots),
      points: readRosteredPlayerPoints(raw),
    };
  });
  const sleeperIds = Array.from(
    new Set(
      lineups.flatMap((l) =>
        l.lineup.map((e) => e.sleeperId).filter((id): id is string => id !== null),
      ),
    ),
  );
  const players = await loadPlayers(admin, sleeperIds, { positions: NAMING_POSITIONS });
  const playerIds = projectablePlayerIds(players, idpReads.loadsDefenders);
  const projectionSource = await resolveProjectionSourceForWindow({
    supabase: admin,
    season,
    fromWeek: week,
    toWeek: week,
    settings: settings.beaconProjections,
  });
  const defenseSeasons = defenseSeasonsFor(season);
  const [projectionRows, accuracy, defense, environment] = await Promise.all([
    loadProjections(admin, playerIds, season, week, week, projectionSource),
    loadAccuracy(admin, playerIds, scoringKeysArg(idpReads), projectionSource),
    loadDefenseSplits(admin, scoringKeysArg(idpReads), defenseSeasons),
    loadGameEnvironment(admin, season, week),
  ]);
  const projections = new Map<string, ProjectionRow>();
  for (const row of projectionRows) projections.set(row.playerId, row);

  for (const { rosterId, lineup, points } of lineups) {
    const starters: StarterState[] = [];
    for (const entry of lineup) {
      if (!entry.sleeperId) continue;
      const row = players.get(entry.sleeperId);
      const actual = points.get(entry.sleeperId) ?? entry.actualPoints ?? null;
      let projected: number | null = null;
      let sigma: number | null = null;
      if (row && entry.slot.projectable && playerIds.includes(row.playerId)) {
        const acc = accuracy.get(row.playerId) ?? null;
        const result = projectPlayerWeek({
          projection: projections.get(row.playerId),
          subject: { position: row.position, injuryStatus: row.injuryStatus },
          accuracy: acc,
          reliability: reliabilityMultiplier(acc, settings),
          scoringSettings: league.scoringSettings,
          defense,
          defenseSeasons,
          week,
          currentWeek,
          settings,
        });
        projected = result ? result.points : null;
        sigma = result ? result.sigma : null;
      }
      const kickoff = row?.team
        ? (environment.byTeam.get(row.team.toUpperCase())?.kickoffAt ?? null)
        : null;
      starters.push({ projected, sigma, actual, ...gameClock(kickoff, nowMs, actual) });
    }
    out.set(rosterId, sideState(starters));
  }
  return out;
}

/** Throw a read error rather than letting it read as an empty league. */
function readOrThrow<T>(label: string, res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(`schedule board: ${label} read failed: ${res.error.message}`);
  return (res.data ?? ([] as unknown)) as T;
}

/**
 * Everything the week view and the team view render from.
 *
 * Four queries: matchups, rosters, members, and the Power Pulse cache. The cache
 * read carries the per-week means, the strength of schedule, and the lineup
 * efficiency. On top of that, for the week in play only, every roster's set
 * lineup is projected so the board can quote the same win chance the matchup
 * page does.
 *
 * A READ ERROR THROWS. An empty answer from a failed read used to render as
 * "Sleeper has published no slate", which is a claim about the league that a
 * network blip has no business making.
 */
export async function loadScheduleBoard(
  supabase: AnyClient,
  params: ScheduleBoardParams,
  /**
   * The service client for the league row and the set-lineup projections.
   * Optional so a caller already holding one as `supabase` need not pass it
   * twice (the relay jobs pass the service client first).
   */
  adminClient?: ServiceClient,
): Promise<ScheduleBoard> {
  const { leagueRowId, season, playoffWeekStart } = params;
  const admin = adminClient ?? (supabase as ServiceClient);

  const [matchupsRes, rostersRes, usersRes, cacheRes, league] = await Promise.all([
    supabase
      .from("league_matchups")
      .select(
        "week, sleeper_roster_id, matchup_id, points, is_final, starter_ids, starter_points, player_points, metadata",
      )
      .eq("league_id", leagueRowId)
      .eq("season", season)
      .order("week", { ascending: true }),
    supabase
      .from("rosters")
      .select(
        "id, sleeper_roster_id, owner_user_id, co_owners, wins, losses, ties, points_for",
      )
      .eq("league_id", leagueRowId)
      .order("sleeper_roster_id", { ascending: true }),
    supabase
      .from("league_users")
      .select("sleeper_user_id, display_name, team_name, avatar")
      .eq("league_id", leagueRowId),
    supabase
      .from("league_power_pulse_cache")
      .select(
        "roster_id, pulse_rank, sos_points, sos_rank, lineup_points_lost, weekly, chopped",
      )
      .eq("league_id", leagueRowId)
      .eq("season", season),
    loadLeague(admin, leagueRowId),
  ]);

  const matchupRows = readOrThrow("matchups", matchupsRes) as unknown as Array<
    BoardMatchupRow & LiveWeekRow
  >;
  const rosterRows = readOrThrow("rosters", rostersRes);
  const userRows = readOrThrow("league users", usersRes);
  const cacheRows = readOrThrow("power pulse cache", cacheRes);

  const weekFromStored = params.currentWeek === null;
  const currentWeek =
    params.currentWeek ??
    currentWeekFromStored(
      [...new Set(matchupRows.map((r) => Number(r.week)))].map((week) => ({
        week,
        isFinal: matchupRows.some((r) => Number(r.week) === week && r.is_final),
      })),
    );

  const usersById = new Map(userRows.map((u) => [u.sleeper_user_id, u] as const));

  const cacheByRosterRow = new Map(cacheRows.map((row) => [row.roster_id, row] as const));

  // Read off the stored rows rather than the league's Sleeper settings, so the
  // board and the model that produced its numbers can never disagree about
  // which game this league is playing. The league row is the fallback for a
  // league whose Power Pulse has never been built.
  const chopped = cacheRows.some((row) => row.chopped === true) || league?.chopped === true;

  const legShape: PlayoffShape = {
    playoffWeekStart: chopped ? null : playoffWeekStart,
    playoffRoundType: league?.playoffRoundType ?? 0,
    playoffTeams: league?.playoffTeams ?? 6,
  };

  const teams: ScheduleTeam[] = rosterRows.map((r) => {
    const user = r.owner_user_id ? usersById.get(r.owner_user_id) : null;
    const cache = cacheByRosterRow.get(r.id);
    return {
      sleeperRosterId: Number(r.sleeper_roster_id),
      rosterRowId: r.id,
      teamName:
        user?.team_name || user?.display_name || `Team ${r.sleeper_roster_id}`,
      ownerHandle: user?.display_name ?? null,
      ownerUserId: r.owner_user_id ?? null,
      coOwnerIds: Array.isArray(r.co_owners)
        ? r.co_owners.filter((id): id is string => typeof id === "string")
        : [],
      ownerAvatarId: user?.avatar ?? null,
      record: {
        wins: Number(r.wins ?? 0),
        losses: Number(r.losses ?? 0),
        ties: Number(r.ties ?? 0),
      },
      pointsFor: Number(r.points_for ?? 0),
      pulseRank: cache?.pulse_rank == null ? null : Number(cache.pulse_rank),
      sosPoints: cache?.sos_points == null ? null : Number(cache.sos_points),
      sosRank: cache?.sos_rank == null ? null : Number(cache.sos_rank),
    };
  });

  const teamByRoster = new Map(teams.map((t) => [t.sleeperRosterId, t] as const));

  // Per-week projected mean and spread, keyed `${sleeperRosterId}|${week}`.
  const projectedByRosterWeek = new Map<string, { mean: number; sigma: number }>();
  const benchLossByRoster = new Map<number, number | null>();
  for (const row of cacheRows) {
    const roster = rosterRows.find((r) => r.id === row.roster_id);
    if (!roster) continue;
    const rosterId = Number(roster.sleeper_roster_id);
    benchLossByRoster.set(
      rosterId,
      row.lineup_points_lost == null ? null : Number(row.lineup_points_lost),
    );
    const weekly = Array.isArray(row.weekly) ? (row.weekly as CachedWeeklyEntry[]) : [];
    for (const entry of weekly) {
      const week = finiteOrNull(entry?.week);
      const mean = finiteOrNull(entry?.mean);
      if (week === null || mean === null) continue;
      projectedByRosterWeek.set(`${rosterId}|${Math.trunc(week)}`, {
        mean,
        sigma: finiteOrNull(entry?.sigma) ?? 0,
      });
    }
  }

  // Group by week, then pair within the week on matchup_id. The opponent is
  // derived rather than stored, matching how migration 0162 models it.
  const byWeek = new Map<number, Array<BoardMatchupRow & LiveWeekRow>>();
  for (const row of matchupRows) {
    const week = Number(row.week);
    const list = byWeek.get(week) ?? [];
    list.push(row);
    byWeek.set(week, list);
  }

  // THE WEEK IN PLAY, AND ONLY IT, gets a set-lineup projection and a win
  // chance. No other week has a lineup set yet, and a settled one has a score.
  const liveRows = (byWeek.get(currentWeek) ?? []).filter((r) => !r.is_final);
  const liveStates =
    league && liveRows.length > 0
      ? await loadSetLineupStates(admin, league, season, currentWeek, currentWeek, liveRows, Date.now())
      : new Map<number, SideState>();

  const pointsOf = (week: number, rosterId: number): number | null => {
    const row = (byWeek.get(week) ?? []).find((r) => Number(r.sleeper_roster_id) === rosterId);
    return row && row.is_final ? Number(row.points ?? 0) : null;
  };
  const opponentOf = (week: number, rosterId: number): number | null => {
    const rows = byWeek.get(week) ?? [];
    const own = rows.find((r) => Number(r.sleeper_roster_id) === rosterId);
    if (!own || own.matchup_id === null || own.matchup_id === undefined) return null;
    const other = rows.find(
      (r) => r.matchup_id === own.matchup_id && Number(r.sleeper_roster_id) !== rosterId,
    );
    return other ? Number(other.sleeper_roster_id) : null;
  };

  /**
   * Both legs added, for leg 2 of a two-week round, once it is final and the
   * same two teams met in leg 1. Null otherwise.
   */
  const roundTotalOf = (week: number, rosterId: number, opponentId: number | null): number | null => {
    if (playoffLeg(week, legShape) !== 2 || opponentId === null) return null;
    const first = otherLegWeek(week, legShape);
    if (first === null || opponentOf(first, rosterId) !== opponentId) return null;
    const legOne = pointsOf(first, rosterId);
    const legTwo = pointsOf(week, rosterId);
    return legOne === null || legTwo === null ? null : legOne + legTwo;
  };

  const sideOf = (
    row: BoardMatchupRow,
    opponent: BoardMatchupRow | null,
  ): ScheduleMatchupSide => {
    const rosterId = Number(row.sleeper_roster_id);
    const team = teamByRoster.get(rosterId);
    const weekOfRow = Number(row.week);
    const projected = projectedByRosterWeek.get(`${rosterId}|${weekOfRow}`) ?? null;
    const points = Number(row.points ?? 0);
    const live = !row.is_final && weekOfRow === currentWeek ? liveStates.get(rosterId) : undefined;
    const opponentId = opponent ? Number(opponent.sleeper_roster_id) : null;
    const roundTotal = roundTotalOf(weekOfRow, rosterId, opponentId);
    const opponentRoundTotal =
      opponentId === null ? null : roundTotalOf(weekOfRow, opponentId, rosterId);
    const leg = playoffLeg(weekOfRow, legShape);
    let won = false;
    if (!chopped && row.is_final && opponent && leg !== 1) {
      won =
        leg === 2
          ? roundTotal !== null && opponentRoundTotal !== null && roundTotal > opponentRoundTotal
          : points > Number(opponent.points ?? 0);
    }
    return {
      sleeperRosterId: rosterId,
      teamName: team?.teamName ?? `Team ${rosterId}`,
      ownerHandle: team?.ownerHandle ?? null,
      ownerAvatarId: team?.ownerAvatarId ?? null,
      record: team?.record ?? { wins: 0, losses: 0, ties: 0 },
      pulseRank: team?.pulseRank ?? null,
      actual: row.is_final ? points : null,
      projectedSet: live ? expectedTotal(live) : null,
      liveScore: live && live.banked !== 0 ? Number(row.points ?? live.banked) : null,
      projectedOptimal: row.is_final ? null : (projected?.mean ?? null),
      sigma: row.is_final ? null : (projected?.sigma ?? null),
      roundTotal,
      /**
       * The current week, and no other.
       *
       * `league_power_pulse_cache.lineup_points_lost` is ONE number per team,
       * graded against the lineup that is set right now (lib/power-pulse/
       * engine.ts compares set to optimal at currentWeek only), so it says
       * nothing about an unplayed week or a settled one. The detail page grades
       * a settled week on actual points.
       */
      pointsLeftOnBench:
        row.is_final || weekOfRow !== currentWeek
          ? null
          : (benchLossByRoster.get(rosterId) ?? null),
      won,
    };
  };

  const weeks: ScheduleWeekView[] = [];
  for (let week = 1; week <= MAX_MATCHUP_WEEK; week += 1) {
    const weekRows = byWeek.get(week);
    if (!weekRows || weekRows.length === 0) continue;

    const isFinal = weekRows.some((r) => r.is_final);
    const seen = new Set<number>();
    const matchups: ScheduleMatchup[] = [];
    const leg = playoffLeg(week, legShape);

    for (const row of weekRows) {
      const rosterId = Number(row.sleeper_roster_id);
      if (seen.has(rosterId)) continue;

      const partner =
        row.matchup_id === null || row.matchup_id === undefined
          ? null
          : (weekRows.find(
              (other) =>
                other.matchup_id === row.matchup_id &&
                Number(other.sleeper_roster_id) !== rosterId,
            ) ?? null);

      seen.add(rosterId);
      if (partner) seen.add(Number(partner.sleeper_roster_id));

      const home = sideOf(row, partner);
      const away = partner ? sideOf(partner, row) : null;
      const homeLive = liveStates.get(rosterId);
      const awayLive = partner ? liveStates.get(Number(partner.sleeper_roster_id)) : undefined;

      matchups.push({
        matchupId: row.matchup_id ?? null,
        week,
        isFinal: Boolean(row.is_final),
        home,
        away,
        // One win chance: set lineup against set lineup, scored points banked.
        // None in a chopped league, where nothing follows from one of these two
        // teams outscoring the other, and none for a week with no lineup set.
        homeWinProb:
          chopped || row.is_final || !away || week !== currentWeek || !homeLive || !awayLive
            ? null
            : liveWinChance(homeLive, awayLive),
        leg,
      });
    }

    // Stable order so the same week does not shuffle between renders.
    matchups.sort((a, b) => a.home.sleeperRosterId - b.home.sleeperRosterId);

    weeks.push({
      week,
      isFinal,
      isCurrent: week === currentWeek && !isFinal,
      isPlayoffWeek: week >= playoffWeekStart,
      matchups,
    });
  }

  const storedWeeks = new Set(weeks.map((w) => w.week));
  const missingWeeks: number[] = [];
  if (storedWeeks.size > 0) {
    for (let week = 1; week <= MAX_MATCHUP_WEEK; week += 1) {
      if (!storedWeeks.has(week)) missingWeeks.push(week);
    }
  }

  return {
    season,
    currentWeek,
    playoffWeekStart,
    weeks,
    teams,
    missingWeeks,
    noScheduleYet: weeks.length === 0,
    projectionsUnavailable: projectedByRosterWeek.size === 0,
    weekFromStored,
    chopped,
  };
}

export type MatchupDetailParams = {
  leagueRowId: string;
  season: number;
  week: number;
  sleeperRosterId: number;
  /** Null when Sleeper's NFL state could not be read; the stored week decides. */
  currentWeek: number | null;
};

export type MatchupDetailResult =
  | { ok: true; view: MatchupView }
  | { ok: false; reason: "not-found" | "no-data" };

/**
 * One matchup, both lineups, fully projected.
 *
 * Reads only the two rosters involved. A twelve team league holds around 350
 * players; this touches the sixty that are actually on the screen.
 */
export async function loadMatchupDetail(
  supabase: AnyClient,
  admin: ServiceClient,
  params: MatchupDetailParams,
): Promise<MatchupDetailResult> {
  const { leagueRowId, season, week, sleeperRosterId } = params;

  // One wave for everything that depends only on (league, season, week):
  // the league row, the week's rows, the rosters, the settings and the Pulse
  // ranks used to be three waves in a row. A missing league or week now costs
  // the other reads for nothing, which is the rare path; the page it serves
  // saves two round trips on every render.
  const [league, weekRes, rosters, settings, cacheRes] = await Promise.all([
    loadLeague(admin, leagueRowId),
    supabase
    .from("league_matchups")
    .select(
      // `player_ids` is deliberately absent. Nothing downstream reads it:
      // readSetLineup takes the starters arrays and readRosteredPlayerPoints
      // takes `player_points`, which is keyed by sleeper id and carries its own
      // membership. Selecting it fetched a twenty-odd element array per roster
      // per week for nobody. RawMatchupRow still declares the field, so it is
      // passed as null below rather than silently dropped from the shape.
      "week, sleeper_roster_id, matchup_id, points, is_final, starter_ids, starter_points, player_points, metadata",
    )
    .eq("league_id", leagueRowId)
    .eq("season", season)
    .eq("week", week),
    loadRosters(admin, leagueRowId),
    loadPowerPulseSettings(admin),
    supabase
      .from("league_power_pulse_cache")
      .select("roster_id, pulse_rank")
      .eq("league_id", leagueRowId)
      .eq("season", season),
  ]);
  if (!league) return { ok: false, reason: "no-data" };
  const { data: weekRows, error } = weekRes;
  // A failed read is a failure, not a matchup that does not exist.
  if (error) throw new Error(`matchup detail: week read failed: ${error.message}`);
  if (!weekRows || weekRows.length === 0) return { ok: false, reason: "not-found" };

  const homeRow = weekRows.find(
    (r) => Number(r.sleeper_roster_id) === sleeperRosterId,
  );
  if (!homeRow) return { ok: false, reason: "not-found" };

  // With no NFL state, the stored week decides: a settled week is behind the
  // one in play, an unsettled one is the one in play.
  const currentWeek = params.currentWeek ?? (homeRow.is_final ? week + 1 : week);

  const awayRow =
    homeRow.matchup_id === null || homeRow.matchup_id === undefined
      ? null
      : (weekRows.find(
          (r) =>
            r.matchup_id === homeRow.matchup_id &&
            Number(r.sleeper_roster_id) !== sleeperRosterId,
        ) ?? null);

  // The matchup header's @handle and avatar come off loadRosters' existing
  // join (read in the wave above), not a second league_users read.
  const involvedIds = [sleeperRosterId];
  if (awayRow) involvedIds.push(Number(awayRow.sleeper_roster_id));
  const involved = rosters.filter((r) =>
    involvedIds.includes(r.sleeperRosterId),
  );
  if (involved.length === 0) return { ok: false, reason: "no-data" };

  const pulseRankByRosterRow = new Map(
    (cacheRes.data ?? []).map(
      (row) =>
        [
          row.roster_id,
          row.pulse_rank == null ? null : Number(row.pulse_rank),
        ] as const,
    ),
  );

  const scoringBase = closestScoringBase(league.scoringSettings);
  // The IDP switch (plan R-25): which slots this page projects, which players
  // get a projection and which keys their accuracy and splits are read under.
  const idpReads = idpReadsFor(idpEnabledFrom(settings), league.rosterPositions, scoringBase);
  const slots = alignedStartingSlots(league.rosterPositions, idpReads.slotMap);

  const rawRowFor = (row: (typeof weekRows)[number]): RawMatchupRow => ({
    starter_ids: row.starter_ids as Json,
    starter_points: row.starter_points as Json,
    player_ids: null,
    player_points: row.player_points as Json,
    metadata: row.metadata as Json,
  });
  const weekRawRows = [homeRow, ...(awayRow ? [awayRow] : [])].map(rawRowFor);

  // The week's own starters and scorers are resolved as well as the stored
  // roster. The roster row is only as fresh as the league's last pulse, and
  // the OG matchup routes render without one, so a player started that week
  // and added after that pulse would otherwise come back "Unknown player"
  // while sitting in the players table the whole time. Once resolved he is
  // projected and counted like anyone else, on both sides of the best-lineup
  // gap (see lib/league-schedule/lineups.ts weekPlayerIds).
  const sleeperIds = Array.from(
    new Set(
      [
        ...involved.flatMap((r) => [
          ...r.playerSleeperIds,
          ...r.starterSleeperIds,
          ...r.reserveSleeperIds,
          ...r.taxiSleeperIds,
        ]),
        ...weekRawRows.flatMap(weekPlayerIds),
      ],
    ),
  );
  // Defenders are always NAMED (plan IDP-122). They are projected only when
  // the switch is on and this league starts a defensive slot.
  const players = await loadPlayers(admin, sleeperIds, { positions: NAMING_POSITIONS });
  const playerIds = projectablePlayerIds(players, idpReads.loadsDefenders);

  const defenseSeasons = defenseSeasonsFor(season);

  // WHICH PROJECTION SOURCE THIS PAGE READS IS NOT THIS PAGE'S DECISION.
  //
  // It used to be, by omission: both loads below defaulted to Sleeper, so the
  // day an admin enables the FF Beacon projection engine, Power Pulse and the
  // Schedule board would move onto our own numbers and this lineup table would
  // quietly stay on Sleeper's. Two totals for the same team in the same week,
  // one tab apart, with nothing on either screen saying why. The resolver is
  // the same one lib/projections/read.ts uses and it makes no query while the
  // feature is off, so this costs nothing today and carries over on its own the
  // moment the switch is flipped.
  const projectionSource = await resolveProjectionSourceForWindow({
    supabase: admin,
    season,
    fromWeek: week,
    toWeek: week,
    settings: settings.beaconProjections,
  });

  const [projectionRows, accuracy, defense, homeAwayByTeamWeek, environment] = await Promise.all([
    // One week only, and the ceiling belongs in the query rather than in a loop
    // underneath it. Both bounds are `week`, so Postgres returns the sixty rows
    // this page renders instead of the rest of the season for the same sixty
    // players. Discarding the surplus in JavaScript still paid to move it: at
    // sixty players it was 306 rows and 261ms against the live database, versus
    // 16 rows and 1.0ms bounded, and eighteen weeks of them clears the 1000-row
    // page size so the read also bought itself a second keyset round trip.
    loadProjections(admin, playerIds, season, week, week, projectionSource),
    // Scoped to the SAME source, per migration 0240: a reliability multiplier
    // measured against Sleeper's projection means nothing applied to ours.
    loadAccuracy(admin, playerIds, scoringKeysArg(idpReads), projectionSource),
    loadDefenseSplits(admin, scoringKeysArg(idpReads), defenseSeasons),
    // Home and away, which no stats or projection row carries. Memoised for an
    // hour inside lib/sleeper.ts, so this is one request per process per season
    // rather than one per matchup view. A null means the venue reads as unknown
    // and the lineup says nothing about it, which is the honest fallback.
    getNflHomeAwayMap(season),
    // Kickoffs, so the win chance banks the points of games already played.
    loadGameEnvironment(admin, season, week),
  ]);

  const projections = new Map<string, ProjectionRow>();
  for (const row of projectionRows) {
    projections.set(`${row.playerId}|${row.week}`, row);
  }

  const sideInputFor = (
    row: (typeof weekRows)[number],
  ): MatchupSideInput | null => {
    const rosterId = Number(row.sleeper_roster_id);
    const roster = involved.find((r) => r.sleeperRosterId === rosterId);
    if (!roster) return null;

    const raw = rawRowFor(row);

    return {
      sleeperRosterId: rosterId,
      rosterRowId: roster.id,
      teamName: roster.teamName,
      ownerHandle: roster.ownerHandle,
      ownerAvatarId: roster.ownerAvatarId,
      record: { wins: roster.wins, losses: roster.losses, ties: roster.ties },
      pulseRank: pulseRankByRosterRow.get(roster.id) ?? null,
      setLineup: readSetLineup(raw, slots),
      allPlayerSleeperIds: roster.playerSleeperIds,
      reserveSleeperIds: roster.reserveSleeperIds,
      taxiSleeperIds: roster.taxiSleeperIds,
      actualTotal: row.is_final ? Number(row.points ?? 0) : null,
      // The same column, ungated. On a live week it is the running score, which
      // is what the share card and the header lead with once games are under
      // way. `actualTotal` above stays final-only because the retrospective
      // hangs off it.
      officialPoints: Number(row.points ?? 0),
      actualByPlayer: readRosteredPlayerPoints(raw),
    };
  };

  const home = sideInputFor(homeRow);
  if (!home) return { ok: false, reason: "no-data" };
  const away = awayRow ? sideInputFor(awayRow) : null;

  return {
    ok: true,
    view: buildMatchupView({
      week,
      season,
      currentWeek,
      isFinal: Boolean(homeRow.is_final),
      slots,
      home,
      away,
      players,
      projections,
      accuracy,
      defense,
      defenseSeasons,
      scoringSettings: league.scoringSettings,
      settings,
      chopped: league.chopped,
      homeAwayByTeamWeek,
      idpEnabled: idpReads.idpEnabled,
      kickoffByTeam: new Map(
        [...environment.byTeam].map(([team, env]) => [team, env.kickoffAt] as const),
      ),
      nowMs: Date.now(),
    }),
  };
}

/**
 * The current NFL week for one league.
 *
 * Wrapped here so a page resolves it once and hands it to both loaders, rather
 * than each of them making its own network call to Sleeper's state endpoint.
 *
 * NULL WHEN THE STATE REQUEST FAILED. A failed request is not week 1; every
 * caller shows what is stored instead (./stored-week.ts).
 */
export async function resolveScheduleWeek(
  season: number,
  playoffWeekStart: number,
): Promise<number | null> {
  const state = await getNflState();
  if (!state) return null;
  const week: number | null = resolveCurrentWeek(state, season, playoffWeekStart);
  return week;
}
