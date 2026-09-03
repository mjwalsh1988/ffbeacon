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
import { buildOptimalLineup } from "@/lib/power-pulse/lineup";
import { closestScoringBase } from "@/lib/league-scoring";
import { defenseSeasonsFor } from "@/lib/projections/defense-seasons";
import { resolveProjectionSourceForWindow } from "@/lib/projections/source";
import { loadAdjustedProjections } from "@/lib/projections/read";
import { MAX_MATCHUP_WEEK } from "@/lib/league-matchups";
import { getNflHomeAwayMap } from "@/lib/sleeper";
import { alignedStartingSlots } from "@/lib/league-schedule/slots";
import { rawStarterIds, readRosteredPlayerPoints, type RawMatchupRow } from "@/lib/league-schedule/lineups";
import { loadGameEnvironment } from "@/lib/nfl-game-environment";
import { loadPositionalWarView } from "@/lib/league-positional-war-data";
import { loadLeagueFreeAgents } from "@/lib/faab/free-agents";
import { loadPlayerValues } from "@/lib/faab/league-load";
import { classifyTeamStatus, type TeamStatusVariant } from "@/lib/league-team-status";
import {
  buildLineup,
  buildLineupPlayer,
  type BuildLineupInput,
  type BuiltLineup,
  type PositionalWarEntry,
} from "./build";
import { buildDropOptions, buildWaiverSuggestions, type DropResult, type WaiverCandidate } from "./advice";
import { claimLineupWaiverSlot } from "./rate-limit";
import type { LineupOpponent, LineupTeamOption, LineupView, WaiverState } from "./types";
import { hasLivePoints, weekStatus } from "./status";
import { buildWeekRecap } from "./recap";

/**
 * The read layer for the Lineups section.
 *
 * ONE ROSTER, ONE WEEK. This is deliberately the most expensive page in League
 * Pulse per render and the cheapest per league: it touches the ~25 players on
 * one roster plus a capped shortlist of free agents, for one week, and it
 * writes nothing and caches nothing of its own. Compare
 * lib/league-schedule/data.ts loadScheduleBoard, which renders a whole season
 * for a whole league in four queries by reading numbers Power Pulse already
 * computed. Neither approach would work for the other page.
 *
 * EVERY NUMBER COMES FROM A FUNCTION SOMETHING ELSE ALREADY USES.
 *   - the slot list from lib/league-schedule/slots.ts
 *   - the set lineup from lib/league-schedule/lineups.ts
 *   - projections through lib/power-pulse/project.ts, on the source
 *     lib/projections/source.ts resolves
 *   - the optimal fill from lib/power-pulse/lineup.ts
 *   - rest-of-season totals through lib/projections/read.ts
 *   - free agency from lib/faab/free-agents.ts
 *   - market values from lib/faab/league-load.ts
 *   - Positional WAR read (never computed) from lib/league-positional-war-data.ts
 *
 * so nothing on this page can disagree with the page beside it, and this file
 * introduces no model of its own.
 *
 * IT NEVER TRIGGERS A COMPUTE. Positional WAR and Power Pulse are both read
 * from their caches and both are on-demand-only through `pulseLeague`, for the
 * scaling reasons in CLAUDE.md. A league with no curve gets an honest "not
 * built yet" line rather than a fabricated zero, and this page must never be
 * made to kick one off.
 */

type ServiceClient = SupabaseClient<Database>;
type AnyClient =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/**
 * How many available players get projected and offered to the optimiser.
 *
 * The free agent list is the whole ranked universe minus the league's rosters,
 * which in a twelve team league is several hundred names. Ranked order is a
 * good enough prior that the player who cracks a starting lineup is inside the
 * top few dozen, and every extra candidate costs one projection plus one
 * optimal fill. Forty keeps the whole waiver panel inside a single extra
 * projection query and a few milliseconds of arithmetic.
 */
export const WAIVER_CANDIDATE_POOL = 40;

export type LineupViewParams = {
  leagueRowId: string;
  season: number;
  week: number;
  currentWeek: number;
  sleeperRosterId: number;
  /** Sleeper's playoff_week_start, so the rest-of-season window ends correctly. */
  playoffWeekStart: number;
  /** From resolveLeagueContext. Null when no source covers this league's format. */
  formatConfigId: string | null;
  /** The reader's resolved value source, for ranks and market values. */
  sourceSlug: string;
  /**
   * Dynasty and keeper leagues hold a cut to a higher bar.
   *
   * Resolved by the CALLER through lib/faab/league-load.ts
   * loadLeagueValueContext, which leads on the league's derived format and only
   * falls back to Sleeper's own `settings.type`. Deriving it from the metadata
   * alone gets a dynasty league with missing or zero Sleeper settings wrong in
   * the one direction that matters: the cut guard stands down and the panel
   * names a valuable dynasty asset as droppable, which advice.ts calls the
   * worst thing this feature can say.
   */
  isKeeperLeague: boolean;
  /** Which vocabulary the status tag uses. */
  statusVariant: TeamStatusVariant;
};

export type LineupViewResult =
  | { ok: true; view: LineupView; dropNote: string | null; teams: LineupTeamOption[] }
  | { ok: false; reason: "no-league" | "no-roster"; teams: LineupTeamOption[] };

function finiteOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The starters array as Sleeper wrote it, placeholders intact.
 *
 * `rosters.starter_ids` CANNOT be used for this. lib/league-pulse.ts filters it
 * through `validPlayerId` before storing, which strips the "0" that marks an
 * unfilled slot and shifts every slot below the gap up by one. The raw array
 * survives in `rosters.metadata`, which stores Sleeper's roster object verbatim
 * per the metadata-preservation rule in CLAUDE.md, and that is what this reads.
 * Same trap, same fix, and for the same reason as the `metadata.starters`
 * preference documented in lib/league-schedule/lineups.ts.
 */
export function starterIdsFromRosterMetadata(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const starters = (metadata as { starters?: unknown }).starters;
  if (!Array.isArray(starters)) return [];
  return starters.map((id) => (typeof id === "string" ? id : ""));
}

/** Sleeper id to Positional WAR, out of the cached curves. Empty when unbuilt. */
export function warBySleeperId(
  curves: { curve: Array<{ sleeperId: string | null; positionRank: number; war: number }> }[],
): Map<string, PositionalWarEntry> {
  const out = new Map<string, PositionalWarEntry>();
  for (const position of curves) {
    const poolSize = position.curve.length;
    for (const point of position.curve) {
      if (!point.sleeperId) continue;
      out.set(point.sleeperId, {
        war: point.war,
        rank: point.positionRank,
        poolSize,
      });
    }
  }
  return out;
}

/**
 * Everything the Lineups page renders from.
 *
 * `supabase` is the request-scoped client for the tables with public read
 * policies; `admin` is the service-role client the Power Pulse loaders and the
 * free agent search already require.
 */
export async function loadLineupView(
  supabase: AnyClient,
  admin: ServiceClient,
  params: LineupViewParams,
): Promise<LineupViewResult> {
  const {
    leagueRowId,
    season,
    week,
    currentWeek,
    sleeperRosterId,
    playoffWeekStart,
    formatConfigId,
    sourceSlug,
    isKeeperLeague,
    statusVariant,
  } = params;

  const [league, rosters, settings] = await Promise.all([
    loadLeague(admin, leagueRowId),
    loadRosters(admin, leagueRowId),
    loadPowerPulseSettings(admin),
  ]);

  const teams: LineupTeamOption[] = rosters
    .map((r) => ({
      sleeperRosterId: r.sleeperRosterId,
      rosterRowId: r.id,
      teamName: r.teamName,
      ownerHandle: r.ownerHandle,
      record: { wins: r.wins, losses: r.losses, ties: r.ties },
    }))
    .sort((a, b) => a.sleeperRosterId - b.sleeperRosterId);

  if (!league) return { ok: false, reason: "no-league", teams };

  const roster = rosters.find((r) => r.sleeperRosterId === sleeperRosterId);
  if (!roster) return { ok: false, reason: "no-roster", teams };

  const slots = alignedStartingSlots(league.rosterPositions);
  const scoringBase = closestScoringBase(league.scoringSettings);
  const defenseSeasons = defenseSeasonsFor(season);

  // The week's matchup row, when Sleeper has published one. It carries the
  // week-specific starters, whether the week has settled, the official score,
  // and the per-player results the bench retrospective is graded on.
  const [matchupRes, rosterMetaRes, projectionSource] = await Promise.all([
    supabase
      .from("league_matchups")
      .select(
        "is_final, points, matchup_id, starter_ids, starter_points, player_points, metadata",
      )
      .eq("league_id", leagueRowId)
      .eq("season", season)
      .eq("week", week)
      .eq("sleeper_roster_id", sleeperRosterId)
      .maybeSingle(),
    supabase
      .from("rosters")
      .select("metadata")
      .eq("id", roster.id)
      .maybeSingle(),
    resolveProjectionSourceForWindow({
      supabase: admin,
      season,
      fromWeek: week,
      toWeek: week,
      settings: settings.beaconProjections,
    }),
  ]);

  const matchupRow = matchupRes.data ?? null;
  const isFinal = Boolean(matchupRow?.is_final);

  const raw: RawMatchupRow | null = matchupRow
    ? {
        starter_ids: matchupRow.starter_ids as Json,
        starter_points: matchupRow.starter_points as Json,
        player_ids: null,
        player_points: matchupRow.player_points as Json,
        metadata: matchupRow.metadata as Json,
      }
    : null;

  // THE WEEK'S LINEUP FIRST, THE ROSTER'S CURRENT ONE SECOND.
  //
  // A published matchup row is week-specific and is the only correct answer for
  // a settled week. A week Sleeper has not published a row for (the preseason,
  // a week past the stored slate) has no lineup of its own, so the roster's own
  // current starters are the honest stand-in and the page says which it is
  // showing.
  const setStarterIds: (string | null)[] = raw
    ? rawStarterIds(raw)
    : starterIdsFromRosterMetadata(rosterMetaRes.data?.metadata);
  const usedRosterFallback = raw === null;

  const actualByPlayer = raw ? readRosteredPlayerPoints(raw) : new Map<string, number>();

  // WHAT STATE THIS WEEK IS IN, decided once and used everywhere below. A live
  // week is one with points actually on the board, not one whose number matches
  // the calendar: Sleeper publishes the current week's row from Tuesday with
  // every score at zero. See ./status.ts.
  const live = hasLivePoints(actualByPlayer);
  const phase = weekStatus({ week, currentWeek, isFinal, hasLivePoints: live });

  const sleeperIds = Array.from(
    new Set([
      ...roster.playerSleeperIds,
      ...roster.starterSleeperIds,
      ...roster.reserveSleeperIds,
      ...roster.taxiSleeperIds,
      ...setStarterIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id !== "0"),
    ]),
  );

  // THE WEEK'S PAIRING RIDES ALONG WITH THE PLAYER LOAD.
  //
  // `matchup_id` is the only thing that pairs two rosters (lib/league-schedule/
  // data.ts derives the opponent the same way), and it has been in hand since
  // the row above, so this is the earliest wave it can join. It has to be
  // resolved before the big wave below, because that wave is where the
  // opponent's own Power Pulse row is read, and running it afterwards spent a
  // whole round trip on four small columns.
  const [players, weekMatchupsRes] = await Promise.all([
    loadPlayers(admin, sleeperIds),
    matchupRow?.matchup_id === null || matchupRow?.matchup_id === undefined
      ? Promise.resolve({ data: null })
      : supabase
          .from("league_matchups")
          .select("sleeper_roster_id, matchup_id, points, is_final")
          .eq("league_id", leagueRowId)
          .eq("season", season)
          .eq("week", week)
          .eq("matchup_id", matchupRow.matchup_id),
  ]);
  const playerIds = Array.from(new Set([...players.values()].map((p) => p.playerId)));

  const opponentRow = (
    (weekMatchupsRes.data ?? []) as Array<{
      sleeper_roster_id: number;
      matchup_id: number | null;
      points: number | null;
      is_final: boolean | null;
    }>
  ).find((row) => Number(row.sleeper_roster_id) !== sleeperRosterId);

  const opponentRoster = opponentRow
    ? (rosters.find((r) => r.sleeperRosterId === Number(opponentRow.sleeper_roster_id)) ?? null)
    : null;

  // The rest-of-season window, for the cut list. Bounded by the last regular
  // season week, because a player's value to a lineup ends when the lineup
  // does. An empty window (the regular season is over) simply produces no
  // per-week figures and the cut list falls back to saying so.
  const lastRegularWeek = Math.min(Math.max(playoffWeekStart - 1, 0), MAX_MATCHUP_WEEK);
  const hasRemaining = lastRegularWeek >= currentWeek;

  // WAIVERS ARE ABOUT A WEEK YOU CAN STILL DO SOMETHING ABOUT.
  //
  // Nobody can claim a player for a week that has already been played, so a
  // panel offering "adds 4.2 points this week" on week 3 in November is not a
  // recommendation, it is a number pretending to be one. Decided here rather
  // than after the loads, so a reader browsing history pays for none of it:
  // not the ranked-universe read, not the extra projection query, and not the
  // forty optimal fills underneath.
  //
  // NOT MERELY `week >= currentWeek`. Sleeper's live week stays on the current
  // week after its games have settled, so on a Monday night that test is still
  // true while `isFinal` has flipped. The baseline fill is graded on ACTUAL
  // points once a week is final, so a free agent's projected points would be
  // differenced against a lineup of results and the panel would offer "+4.2"
  // for a week nobody can act on.
  const waiversApply = phase.showsAdvice;

  const [projectionRows, accuracy, defense, homeAwayByTeamWeek, environment, warView, cacheRes, valueRankRes, restOfSeason, freeAgents, marketValues, opponentPulseRes] =
    await Promise.all([
      // One week, both bounds equal, so Postgres returns the ~25 rows this page
      // renders rather than the rest of the season for the same players.
      loadProjections(admin, playerIds, season, week, week, projectionSource),
      loadAccuracy(admin, playerIds, scoringBase, projectionSource),
      loadDefenseSplits(admin, scoringBase, defenseSeasons),
      getNflHomeAwayMap(season),
      loadGameEnvironment(supabase, season, week),
      // READ ONLY. Never a compute: see the module header.
      loadPositionalWarView(supabase, leagueRowId, season),
      supabase
        .from("league_power_pulse_cache")
        .select("roster_id, pulse_rank")
        .eq("league_id", leagueRowId)
        .eq("season", season),
      formatConfigId
        ? supabase
            .from("league_power_rankings_cache")
            .select("roster_id, overall_rank")
            .eq("league_id", leagueRowId)
            .eq("format_config_id", formatConfigId)
            .eq("source", sourceSlug)
        : Promise.resolve({ data: null }),
      hasRemaining
        ? loadAdjustedProjections({
            supabase: admin,
            playerIds,
            season,
            fromWeek: currentWeek,
            toWeek: lastRegularWeek,
            scoringSettings: league.scoringSettings,
            positionByPlayer: new Map(
              [...players.values()].map((p) => [p.playerId, p.position] as const),
            ),
            injuryByPlayer: new Map(
              [...players.values()].map((p) => [p.playerId, p.injuryStatus] as const),
            ),
            currentWeek,
          })
        : Promise.resolve(null),
      formatConfigId && waiversApply
        ? loadLeagueFreeAgents(admin, { leagueRowId, formatConfigId, source: sourceSlug })
        : Promise.resolve(null),
      // ONLY WHEN SOMETHING CAN USE THEM. The single consumer is the dynasty
      // cut guard in ./advice.ts, which never fires in a redraft league, and
      // nothing renders the figure. Every redraft league was paying for a read
      // it then discarded.
      isKeeperLeague
        ? loadPlayerValues(admin, formatConfigId, playerIds)
        : Promise.resolve(new Map<string, number>()),
      // THE OPPONENT'S PROJECTED WEEK, one row, and only when it can be used.
      //
      // `weekly` is a whole season of per-week distributions, so pulling it for
      // every roster in the league to read one week of one of them is a read
      // the Schedules board can afford (it renders all of them) and this page
      // cannot. Skipped outright on a settled week: the result is known, and
      // the only consumer is the what-if, which a settled week does not offer.
      opponentRoster && !isFinal
        ? supabase
            .from("league_power_pulse_cache")
            .select("weekly")
            .eq("league_id", leagueRowId)
            .eq("season", season)
            .eq("roster_id", opponentRoster.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const projections = new Map<string, ProjectionRow>();
  for (const row of projectionRows) projections.set(row.playerId, row);

  const positionalWar = warBySleeperId(warView?.curves ?? []);

  const buildInput: BuildLineupInput = {
    week,
    season,
    currentWeek,
    isFinal,
    slots,
    setStarterIds,
    allPlayerSleeperIds: roster.playerSleeperIds,
    reserveSleeperIds: roster.reserveSleeperIds,
    taxiSleeperIds: roster.taxiSleeperIds,
    players,
    projections,
    accuracy,
    defense,
    defenseSeasons,
    scoringSettings: league.scoringSettings,
    settings,
    actualByPlayer,
    // Carried while a week is being played as well as after it, so the board
    // can headline a live score. The GRADING basis is still `isFinal`.
    actualsVisible: phase.showsResults,
    officialActualTotal: isFinal ? finiteOrNull(matchupRow?.points) : null,
    homeAwayByTeamWeek,
    environment,
    positionalWar,
  };

  const built = buildLineup(buildInput);

  const pulseRankByRosterRow = new Map(
    (cacheRes.data ?? []).map(
      (row) => [row.roster_id, row.pulse_rank == null ? null : Number(row.pulse_rank)] as const,
    ),
  );
  const valueRankByRosterRow = new Map(
    ((valueRankRes.data ?? []) as Array<{ roster_id: string; overall_rank: number | null }>).map(
      (row) => [row.roster_id, row.overall_rank == null ? null : Number(row.overall_rank)] as const,
    ),
  );

  // WHO THIS TEAM PLAYS, and what they are projected to score.
  //
  // Assembled from two reads the waves above already made, so it costs nothing
  // here. Only the what-if uses it, and a week with no published matchup, an
  // unpaired roster or a league whose Power Pulse has never been built each
  // leave it null or partly null; the panel names those states rather than
  // printing a win probability out of nothing.
  let opponent: LineupOpponent | null = null;
  if (opponentRow) {
    const weekly = Array.isArray(opponentPulseRes.data?.weekly)
      ? (opponentPulseRes.data.weekly as Array<Record<string, unknown>>)
      : [];
    const entry = weekly.find((row) => Number(row?.week) === week) ?? null;
    const mean = finiteOrNull(entry?.mean);

    opponent = {
      sleeperRosterId: Number(opponentRow.sleeper_roster_id),
      teamName: opponentRoster?.teamName ?? `Team ${opponentRow.sleeper_roster_id}`,
      ownerHandle: opponentRoster?.ownerHandle ?? null,
      projected: mean,
      sigma: mean === null ? null : (finiteOrNull(entry?.sigma) ?? 0),
      actual: opponentRow.is_final ? finiteOrNull(opponentRow.points) : null,
    };
  }

  const status = classifyTeamStatus({
    pulseRank: pulseRankByRosterRow.get(roster.id) ?? null,
    valueRank: valueRankByRosterRow.get(roster.id) ?? null,
    teamCount: rosters.length,
    variant: statusVariant,
  });

  // Rest-of-season per week, keyed back to Sleeper ids so the cut list can key
  // off the same id every other panel does.
  const restOfSeasonPerWeek = new Map<string, number>();
  if (restOfSeason) {
    for (const [sleeperId, row] of players) {
      const summary = restOfSeason.byPlayer.get(row.playerId);
      if (summary?.perWeek != null) restOfSeasonPerWeek.set(sleeperId, summary.perWeek);
    }
  }

  const valueBySleeperId = new Map<string, number>();
  for (const [sleeperId, row] of players) {
    const value = marketValues.get(row.playerId);
    if (value !== undefined) valueBySleeperId.set(sleeperId, value);
  }

  // Everyone the optimiser seats this week, so the cut list can never offer one
  // of them while the optimiser panel is telling the reader to start him.
  //
  // BUILT FROM THE FILL, NOT FROM THE DISPLAYED MOVES. The move list is filtered
  // by MIN_MOVE_GAIN, so a bench player the optimum genuinely seats by less
  // than half a point never appears in it, and deriving the set from it left
  // exactly that player eligible to be offered as a cut.
  const seatedSleeperIds = new Set(built.optimalSleeperIds);
  for (const group of built.groups) {
    for (const entry of group.entries) {
      // A player in an unprojectable slot is not in the fill and is still
      // starting, so he is not a cut candidate either.
      if (entry.player && !entry.slot.projectable) seatedSleeperIds.add(entry.player.sleeperId);
    }
  }

  const drops: DropResult = buildDropOptions({
    benchable: [...built.bench, ...built.reserve, ...built.taxi],
    restOfSeasonPerWeek,
    valueBySleeperId,
    isKeeperLeague,
    seatedSleeperIds,
  });

  // THE METER IS CLAIMED HERE, after every validation and only when the panel
  // is actually going to do the work. A past week and an uncovered format both
  // skip it, so browsing history never spends a reader's budget. See
  // ./rate-limit.ts for why only this half of the page is metered.
  let waiversState: WaiverState = !waiversApply
    ? "past-week"
    : freeAgents === null
      ? "no-format"
      : "ok";

  let waivers: Awaited<ReturnType<typeof buildWaivers>> = [];
  if (waiversState === "ok") {
    if (await claimLineupWaiverSlot()) {
      waivers = await buildWaivers({
        admin,
        buildInput,
        built,
        freeAgents,
        slots,
        week,
        season,
        projectionSource,
        scoringBase,
        status,
      });
    } else {
      waiversState = "throttled";
    }
  }

  const view: LineupView = {
    season,
    week,
    currentWeek,
    isFinal,
    isCurrent: week === currentWeek && !isFinal,
    usedRosterFallback,
    sleeperRosterId,
    rosterRowId: roster.id,
    teamName: roster.teamName,
    ownerHandle: roster.ownerHandle,
    ownerAvatarId: roster.ownerAvatarId,
    record: { wins: roster.wins, losses: roster.losses, ties: roster.ties },
    pulseRank: pulseRankByRosterRow.get(roster.id) ?? null,
    status,
    groups: built.groups,
    bench: built.bench,
    reserve: built.reserve,
    taxi: built.taxi,
    optimization: built.optimization,
    dropOptions: drops.options,
    waivers,
    actualTotal: built.actualTotal,
    // Display only, and only while a week is being played. `officialActualTotal`
    // above stays `isFinal`-gated because it is the grading basis.
    liveTotal: phase.phase === "live" ? finiteOrNull(matchupRow?.points) : null,
    hasUnprojectableSlots: built.unprojectableSlotCount > 0,
    unprojectableSlotCount: built.unprojectableSlotCount,
    unprojectedSlotCount: built.unprojectedSlotCount,
    environmentAverage: environment.average,
    environmentUnavailable: environment.byTeam.size === 0,
    positionalWarUnavailable: positionalWar.size === 0,
    waiversState,
    projectionSource,
    opponent,
    weekStatus: phase,
    // THE REPORT, and only once there is something to report. A live week has
    // points but no settled result, so it gets a recap with a null outcome
    // rather than a fabricated one: `buildWeekRecap` reads `actualTotal`, which
    // stays null until the week settles.
    // THE REPORT, AND ONLY ON A SETTLED WEEK.
    //
    // `showsResults` is true mid-week too, and building it then is wrong in a
    // way that looks plausible: Sleeper's `players_points` map carries an entry
    // for every rostered player and it reads 0 until he plays, so on a Sunday
    // afternoon a Monday-night starter has an actual of 0 against a projection
    // of 18 and lands at the top of "Let you down". Every figure in a recap is
    // retrospective, which is the same guarantee the Manager Ledger makes, and
    // a week that is still being played is not retrospective yet.
    recap: isFinal
      ? buildWeekRecap({
          groups: built.groups,
          optimization: built.optimization,
          actualTotal: built.actualTotal,
          opponentActual: opponent?.actual ?? null,
        })
      : null,
  };

  return { ok: true, view, dropNote: drops.note, teams };
}

/**
 * Which available players would change this lineup, and by how much.
 *
 * ONE EXTRA PROJECTION QUERY, then arithmetic. Each candidate is added to the
 * same candidate list the baseline fill used and the fill is run again; the
 * difference in total is what he adds, and the slot he lands in is the one the
 * two fills disagree about. That is the same shape lib/faab/marginal.ts uses
 * for a whole remaining season, run here for a single week, which is why it can
 * afford forty candidates instead of one.
 *
 * A free agent's projection is built through `buildLineupPlayer` with the SAME
 * input object the roster used, so his number is computed identically to the
 * players he is being compared against. Anything else would make the comparison
 * meaningless in exactly the way that is hardest to notice.
 *
 * THE BASELINE IS THE ONE THE OPTIMISER ALREADY USED. `buildLineup` hands back
 * the exact candidate list and slot tokens it filled with, and its own total,
 * so the "+4.2" under a free agent is measured against the very same optimum
 * the panel above the fold is showing. Reassembling that list here would mean
 * remembering four separate exclusions (IR, taxi, no graded number, and anyone
 * sitting in a slot the fill cannot use) and getting one of them wrong would
 * shift every figure in this panel by a constant nobody could see.
 */
async function buildWaivers(args: {
  admin: ServiceClient;
  buildInput: BuildLineupInput;
  built: BuiltLineup;
  freeAgents: Awaited<ReturnType<typeof loadLeagueFreeAgents>>;
  slots: BuildLineupInput["slots"];
  week: number;
  season: number;
  projectionSource: string;
  scoringBase: string;
  status: Parameters<typeof buildWaiverSuggestions>[1];
}) {
  const { admin, buildInput, built, freeAgents, slots, week, season, projectionSource, scoringBase, status } =
    args;

  if (!freeAgents || freeAgents.players.length === 0) return [];

  const shortlist = freeAgents.players
    .filter((p) => p.sleeper_id)
    .slice(0, WAIVER_CANDIDATE_POOL);
  if (shortlist.length === 0) return [];

  const candidateIds = shortlist.map((p) => p.player_id);
  const [rows, accuracy, faPlayers] = await Promise.all([
    loadProjections(admin, candidateIds, season, week, week, projectionSource),
    loadAccuracy(admin, candidateIds, scoringBase, projectionSource),
    loadPlayers(
      admin,
      shortlist.map((p) => p.sleeper_id as string),
    ),
  ]);

  // A projection input that carries the free agents alongside the roster, so
  // buildLineupPlayer resolves them the same way it resolved everybody else.
  const faInput: BuildLineupInput = {
    ...buildInput,
    players: new Map([...buildInput.players, ...faPlayers]),
    projections: new Map([
      ...buildInput.projections,
      ...rows.map((r) => [r.playerId, r] as const),
    ]),
    accuracy: new Map([...buildInput.accuracy, ...accuracy]),
    // A free agent has no result for a week he was not on anybody's roster, and
    // the retrospective is about the lineup that was actually set, so the
    // waiver panel is always graded on projections.
    isFinal: false,
    actualByPlayer: new Map(),
  };

  // The baseline, straight from the fill the optimiser already ran.
  const projectableIndex: number[] = [];
  slots.forEach((slot, i) => {
    if (slot.projectable) projectableIndex.push(i);
  });

  const projectableTokens = built.fillTokens;
  const baseCandidates = built.fillCandidates;
  if (projectableTokens.length === 0 || built.fillTotal === null) return [];
  const baseTotal = built.fillTotal;

  const candidates: WaiverCandidate[] = [];
  for (const option of shortlist) {
    const sleeperId = option.sleeper_id as string;
    const row = faPlayers.get(sleeperId);
    if (!row) continue;

    const player = buildLineupPlayer(faInput, sleeperId, "bench", null);
    if (player.projected === null) continue;

    const withHim = buildOptimalLineup(projectableTokens, [
      ...baseCandidates,
      {
        playerId: row.playerId,
        position: row.position,
        points: player.projected,
        sigma: player.sigma ?? 0,
      },
    ]);

    const pointsAdded = Math.max(0, withHim.total - baseTotal);
    const seatIndex = withHim.slots.findIndex((s) => s.playerId === row.playerId);
    const slotLabel =
      seatIndex >= 0 ? (slots[projectableIndex[seatIndex]]?.label ?? null) : null;

    candidates.push({
      player,
      pointsAdded,
      slotLabel,
      overallRank: Number.isFinite(option.overall_rank) ? option.overall_rank : null,
    });
  }

  return buildWaiverSuggestions(candidates, status);
}
