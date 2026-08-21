import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  loadAccuracy,
  loadDefenseSplits,
  loadLeague,
  loadPlayers,
  loadProjections,
  loadRosters,
  type ProjectionRow,
} from "@/lib/power-pulse/load";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { closestScoringBase } from "@/lib/league-scoring";
import { winProbability } from "@/lib/power-pulse/math";
import { MAX_MATCHUP_WEEK, resolveCurrentWeek } from "@/lib/league-matchups";
import { getNflState } from "@/lib/sleeper";
import { alignedStartingSlots } from "./slots";
import {
  readRosteredPlayerPoints,
  readSetLineup,
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
 * The board deliberately shows the OPTIMAL lineup projection as its headline
 * number, because that is what Power Pulse ranks on and two different answers to
 * "what will this team score" on adjacent tabs is worse than either answer being
 * slightly off. The detail page adds the as-set number beside it, which is where
 * the difference between the two belongs.
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
  /** Passed in so a page that already resolved it does not pay for it twice. */
  currentWeek: number;
};

/**
 * Everything the week view and the team view render from.
 *
 * Four queries: matchups, rosters, members, and the Power Pulse cache. The cache
 * read carries the per-week means, the strength of schedule, and the lineup
 * efficiency, so there is no fifth.
 */
export async function loadScheduleBoard(
  supabase: AnyClient,
  params: ScheduleBoardParams,
): Promise<ScheduleBoard> {
  const { leagueRowId, season, playoffWeekStart, currentWeek } = params;

  const [matchupsRes, rostersRes, usersRes, cacheRes] = await Promise.all([
    supabase
      .from("league_matchups")
      .select("week, sleeper_roster_id, matchup_id, points, is_final")
      .eq("league_id", leagueRowId)
      .eq("season", season)
      .order("week", { ascending: true }),
    supabase
      .from("rosters")
      .select(
        "id, sleeper_roster_id, owner_user_id, wins, losses, ties, points_for",
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
        "roster_id, pulse_rank, sos_points, sos_rank, lineup_points_lost, weekly",
      )
      .eq("league_id", leagueRowId)
      .eq("season", season),
  ]);

  const usersById = new Map(
    (usersRes.data ?? []).map((u) => [u.sleeper_user_id, u] as const),
  );

  const cacheByRosterRow = new Map(
    (cacheRes.data ?? []).map((row) => [row.roster_id, row] as const),
  );

  const teams: ScheduleTeam[] = (rostersRes.data ?? []).map((r) => {
    const user = r.owner_user_id ? usersById.get(r.owner_user_id) : null;
    const cache = cacheByRosterRow.get(r.id);
    return {
      sleeperRosterId: Number(r.sleeper_roster_id),
      rosterRowId: r.id,
      teamName:
        user?.team_name || user?.display_name || `Team ${r.sleeper_roster_id}`,
      ownerHandle: user?.display_name ?? null,
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

  const teamByRoster = new Map(
    teams.map((t) => [t.sleeperRosterId, t] as const),
  );

  // Per-week projected mean and spread, keyed `${sleeperRosterId}|${week}`.
  const projectedByRosterWeek = new Map<
    string,
    { mean: number; sigma: number }
  >();
  const benchLossByRoster = new Map<number, number | null>();
  for (const row of cacheRes.data ?? []) {
    const roster = (rostersRes.data ?? []).find((r) => r.id === row.roster_id);
    if (!roster) continue;
    const rosterId = Number(roster.sleeper_roster_id);
    benchLossByRoster.set(
      rosterId,
      row.lineup_points_lost == null ? null : Number(row.lineup_points_lost),
    );
    const weekly = Array.isArray(row.weekly)
      ? (row.weekly as CachedWeeklyEntry[])
      : [];
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

  const rows = (matchupsRes.data ?? []) as unknown as BoardMatchupRow[];

  // Group by week, then pair within the week on matchup_id. The opponent is
  // derived rather than stored, matching how migration 0162 models it.
  const byWeek = new Map<number, BoardMatchupRow[]>();
  for (const row of rows) {
    const week = Number(row.week);
    const list = byWeek.get(week) ?? [];
    list.push(row);
    byWeek.set(week, list);
  }

  const sideOf = (
    row: BoardMatchupRow,
    opponent: BoardMatchupRow | null,
  ): ScheduleMatchupSide => {
    const rosterId = Number(row.sleeper_roster_id);
    const team = teamByRoster.get(rosterId);
    const weekOfRow = Number(row.week);
    const projected =
      projectedByRosterWeek.get(`${rosterId}|${weekOfRow}`) ?? null;
    const points = Number(row.points ?? 0);
    return {
      sleeperRosterId: rosterId,
      teamName: team?.teamName ?? `Team ${rosterId}`,
      ownerHandle: team?.ownerHandle ?? null,
      ownerAvatarId: team?.ownerAvatarId ?? null,
      record: team?.record ?? { wins: 0, losses: 0, ties: 0 },
      pulseRank: team?.pulseRank ?? null,
      actual: row.is_final ? points : null,
      projectedOptimal: row.is_final ? null : (projected?.mean ?? null),
      sigma: row.is_final ? null : (projected?.sigma ?? null),
      /**
       * The current week, and no other.
       *
       * `league_power_pulse_cache.lineup_points_lost` is ONE number per team,
       * graded against the lineup that is set right now: see
       * lib/power-pulse/engine.ts, where candidatesFor only compares set to
       * optimal at currentWeek. Stamping it onto every unplayed week claimed
       * that a manager was leaving the same 12.4 points on the bench in weeks 8
       * through 14, for lineups nobody has touched yet and rosters that will
       * not exist by then. Null is the honest answer for those weeks.
       *
       * A final week is null too, which makes the "Left" arm in
       * components/league-schedule/matchup-row.tsx unreachable. That branch is
       * dead by this contract, not by accident: a retrospective for a settled
       * week has to be graded on actual points, and this cache holds
       * projections. lib/league-schedule/matchup.ts answers that question on
       * the detail page, where the per-player results are loaded.
       */
      pointsLeftOnBench:
        row.is_final || weekOfRow !== currentWeek
          ? null
          : (benchLossByRoster.get(rosterId) ?? null),
      /**
       * A win, and only a win. An unpaired roster gets `won: false` on the one
       * side that exists, which is true (it beat nobody) but is NOT a tie. The
       * absence of an opponent is carried by `ScheduleMatchup.away === null`,
       * and any reader deriving an outcome label has to check that before it
       * falls through to "Tied".
       */
      won: Boolean(
        row.is_final && opponent && points > Number(opponent.points ?? 0),
      ),
    };
  };

  const weeks: ScheduleWeekView[] = [];
  for (let week = 1; week <= MAX_MATCHUP_WEEK; week += 1) {
    const weekRows = byWeek.get(week);
    if (!weekRows || weekRows.length === 0) continue;

    const isFinal = weekRows.some((r) => r.is_final);
    const seen = new Set<number>();
    const matchups: ScheduleMatchup[] = [];

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

      matchups.push({
        matchupId: row.matchup_id ?? null,
        week,
        isFinal: Boolean(row.is_final),
        home,
        away,
        homeWinProb:
          row.is_final ||
          !away ||
          home.projectedOptimal === null ||
          away.projectedOptimal === null
            ? null
            : winProbability(
                home.projectedOptimal,
                home.sigma ?? 0,
                away.projectedOptimal,
                away.sigma ?? 0,
              ),
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
  };
}

export type MatchupDetailParams = {
  leagueRowId: string;
  season: number;
  week: number;
  sleeperRosterId: number;
  currentWeek: number;
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
  const { leagueRowId, season, week, sleeperRosterId, currentWeek } = params;

  const league = await loadLeague(admin, leagueRowId);
  if (!league) return { ok: false, reason: "no-data" };

  const { data: weekRows, error } = await supabase
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
    .eq("week", week);
  if (error || !weekRows || weekRows.length === 0)
    return { ok: false, reason: "not-found" };

  const homeRow = weekRows.find(
    (r) => Number(r.sleeper_roster_id) === sleeperRosterId,
  );
  if (!homeRow) return { ok: false, reason: "not-found" };

  const awayRow =
    homeRow.matchup_id === null || homeRow.matchup_id === undefined
      ? null
      : (weekRows.find(
          (r) =>
            r.matchup_id === homeRow.matchup_id &&
            Number(r.sleeper_roster_id) !== sleeperRosterId,
        ) ?? null);

  // The matchup header shows an @handle and an avatar beside each team name.
  // Those used to arrive from a second `league_users` read and a second
  // `rosters` read issued right here, on top of the two loadRosters had already
  // done for the same league. loadRosters now carries ownerHandle and
  // ownerAvatarId off its existing join, so this page and the share card each
  // make two fewer round trips.
  const [rosters, settings, cacheRes] = await Promise.all([
    loadRosters(admin, leagueRowId),
    loadPowerPulseSettings(admin),
    supabase
      .from("league_power_pulse_cache")
      .select("roster_id, pulse_rank")
      .eq("league_id", leagueRowId)
      .eq("season", season),
  ]);

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

  const slots = alignedStartingSlots(league.rosterPositions);

  const sleeperIds = Array.from(
    new Set(
      involved.flatMap((r) => [
        ...r.playerSleeperIds,
        ...r.starterSleeperIds,
        ...r.reserveSleeperIds,
        ...r.taxiSleeperIds,
      ]),
    ),
  );
  const players = await loadPlayers(admin, sleeperIds);
  const playerIds = Array.from(
    new Set([...players.values()].map((p) => p.playerId)),
  );

  const scoringBase = closestScoringBase(league.scoringSettings);
  const defenseSeasons = [season - 1, season - 2];

  const [projectionRows, accuracy, defense] = await Promise.all([
    // One week only, and the ceiling belongs in the query rather than in a loop
    // underneath it. Both bounds are `week`, so Postgres returns the sixty rows
    // this page renders instead of the rest of the season for the same sixty
    // players. Discarding the surplus in JavaScript still paid to move it: at
    // sixty players it was 306 rows and 261ms against the live database, versus
    // 16 rows and 1.0ms bounded, and eighteen weeks of them clears the 1000-row
    // page size so the read also bought itself a second keyset round trip.
    loadProjections(admin, playerIds, season, week, week),
    loadAccuracy(admin, playerIds, scoringBase),
    loadDefenseSplits(admin, scoringBase, defenseSeasons),
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

    const raw: RawMatchupRow = {
      starter_ids: row.starter_ids as Json,
      starter_points: row.starter_points as Json,
      player_ids: null,
      player_points: row.player_points as Json,
      metadata: row.metadata as Json,
    };

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
    }),
  };
}

/**
 * The current NFL week for one league.
 *
 * Wrapped here so a page resolves it once and hands it to both loaders, rather
 * than each of them making its own network call to Sleeper's state endpoint.
 */
export async function resolveScheduleWeek(
  season: number,
  playoffWeekStart: number,
): Promise<number> {
  const state = await getNflState();
  return resolveCurrentWeek(state, season, playoffWeekStart);
}
