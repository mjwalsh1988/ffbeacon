import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  loadAccuracy,
  loadDefenseSplits,
  loadLeague,
  loadPlayers,
  loadProjections,
  loadRosters,
  loadSchedule,
  type AccuracyRow,
  type DefenseRow,
  type LeagueRow,
  type PlayerRow,
  type ProjectionRow,
  type RosterRow,
} from "@/lib/power-pulse/load";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import type { PowerPulseSettings } from "@/lib/power-pulse/default-settings";
import type { ScheduleWeek } from "@/lib/power-pulse/types";
import type { WeeklyDistribution } from "@/lib/power-pulse/what-if";
import { closestScoringBase } from "@/lib/league-scoring";
import { resolveCurrentWeek } from "@/lib/league-matchups";
import { getNflState } from "@/lib/sleeper";
import {
  loadTradeFinderLeague,
  type RosterIdentity,
  type TradeFinderLeague,
} from "@/lib/trade-finder-data";

/**
 * Everything one trade evaluation needs, read once.
 *
 * THE EXPENSIVE DECISION IN THIS FILE, and the reason it is not simply a copy of
 * lib/faab/league-faab.ts's load:
 *
 *   To turn "your lineup gains 4.3 points a week" into "your playoff odds go
 *   from 41 to 58 percent", the season simulation needs a weekly scoring
 *   distribution for EVERY team in the league, not just the two trading. FAAB
 *   gets those by projecting every rostered player in the league and building
 *   every team's optimal lineup for every remaining week. In a twelve team
 *   dynasty league that is around 350 players, eighteen weeks, and 216 exact
 *   lineup fills, before the trade is even considered.
 *
 *   Power Pulse already computed exactly that and stored it.
 *   `league_power_pulse_cache.weekly` holds `{week, mean, sigma}` per roster,
 *   from the same optimal-lineup model, refreshed on the same page load. So the
 *   ten teams NOT in the trade are read rather than recomputed, and only the two
 *   teams whose rosters actually change get projected. That is roughly 60
 *   players instead of 350, and 4 lineup fills per week instead of 12.
 *
 *   The two involved teams use OUR freshly computed baseline on BOTH sides of
 *   the before/after comparison, never the cached one. Mixing a cached baseline
 *   with a recomputed post-trade lineup would attribute every difference between
 *   the two computations to the trade, which is how a deal that changes nothing
 *   ends up reporting a swing in playoff odds.
 *
 *   When the cache is missing or too thin, the odds are reported as unavailable
 *   rather than simulated against a league we half know. `gaps.simulation` is
 *   what says so, and the surface prints a sentence instead of a number.
 *
 * Values, ages, pick prices, team status, and the format and source context all
 * come from `loadTradeFinderLeague`, which is the same read the suggestion
 * engine uses. That is deliberate: a built trade and a suggested trade are then
 * priced identically by construction rather than by two code paths agreeing.
 */

type ServiceClient = SupabaseClient<Database>;
type AnyClient =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export type TradeImpactWorld = {
  finder: TradeFinderLeague;
  league: LeagueRow;
  rosters: RosterRow[];
  /** Keyed by Sleeper player id. */
  players: Map<string, PlayerRow>;
  /** Keyed by `${ffBeaconPlayerId}|${week}`. */
  projections: Map<string, ProjectionRow>;
  /** Keyed by FF Beacon player id. */
  accuracy: Map<string, AccuracyRow>;
  defense: Map<string, DefenseRow>;
  defenseSeasons: number[];
  settings: PowerPulseSettings;
  schedule: ScheduleWeek[];
  /** Unplayed regular-season weeks, ascending. Empty means no season left. */
  remainingWeeks: number[];
  currentWeek: number;
  /**
   * Cached weekly distributions per Sleeper roster id, from Power Pulse. Missing
   * or short entries are what drives `gaps.simulation`.
   */
  cachedWeekly: Map<number, WeeklyDistribution>;
};

export type LoadTradeImpactResult =
  | { ok: true; world: TradeImpactWorld }
  | { ok: false; error: string };

type CachedWeeklyEntry = {
  week?: unknown;
  mean?: unknown;
  sigma?: unknown;
};

function finiteOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read every roster's weekly scoring distribution out of the Power Pulse cache.
 *
 * One query, no joins. A roster whose row is absent simply is not in the map,
 * and the caller decides what an incomplete league means rather than this
 * function inventing a distribution for the gap.
 */
export async function loadCachedWeekly(
  supabase: AnyClient,
  leagueRowId: string,
  season: number,
): Promise<Map<number, WeeklyDistribution>> {
  const out = new Map<number, WeeklyDistribution>();

  const { data, error } = await supabase
    .from("league_power_pulse_cache")
    .select("roster_id, weekly, rosters!inner(sleeper_roster_id)")
    .eq("league_id", leagueRowId)
    .eq("season", season);
  if (error || !data) return out;

  for (const row of data) {
    const joined = (row as { rosters?: { sleeper_roster_id?: unknown } }).rosters;
    const rosterId = finiteOrNull(joined?.sleeper_roster_id);
    if (rosterId === null) continue;

    const weekly = Array.isArray(row.weekly) ? (row.weekly as CachedWeeklyEntry[]) : [];
    const dist: WeeklyDistribution = new Map();
    for (const entry of weekly) {
      const week = finiteOrNull(entry?.week);
      const mean = finiteOrNull(entry?.mean);
      if (week === null || mean === null) continue;
      const sigma = finiteOrNull(entry?.sigma) ?? 0;
      dist.set(Math.trunc(week), { mean, sigma });
    }
    if (dist.size > 0) out.set(Math.trunc(rosterId), dist);
  }

  return out;
}

/**
 * Load the world for one league's trade evaluation.
 *
 * `involvedRosterIds` narrows the projection read to the teams whose rosters
 * change. Everything else comes from the cache, for the reason in the header.
 * Pass both sides' Sleeper roster ids.
 */
export async function loadTradeImpactWorld(
  supabase: AnyClient,
  admin: ServiceClient,
  params: {
    sleeperLeagueId: string;
    sourceSlug: string | null;
    identity: RosterIdentity;
    involvedRosterIds: number[];
    /**
     * A league the caller has ALREADY read.
     *
     * The Trade Ideas page loads it for the builder, the rail, and the identity
     * resolution before it knows whether the URL even carries a proposal. Left
     * to itself this function would read it a second time on every evaluated
     * request: same query, same answer, twice the work on the hot path. The
     * server action has nothing to hand over and passes nothing, which is the
     * behaviour this parameter defaults to.
     */
    finder?: TradeFinderLeague | null;
  },
): Promise<LoadTradeImpactResult> {
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

  const league = await loadLeague(admin, finder.leagueRowId);
  if (!league) return { ok: false, error: "We do not have this league synced yet." };

  const [settings, nflState, rosters] = await Promise.all([
    loadPowerPulseSettings(admin),
    getNflState(),
    loadRosters(admin, finder.leagueRowId),
  ]);
  if (rosters.length < 2) {
    return { ok: false, error: "This league has fewer than two rosters stored." };
  }

  const currentWeek = resolveCurrentWeek(nflState, league.season, league.playoffWeekStart);

  // Only the teams whose rosters change get projected. See the header.
  const involved = new Set(params.involvedRosterIds);
  const involvedRosters = rosters.filter((r) => involved.has(r.sleeperRosterId));
  if (involvedRosters.length !== involved.size) {
    return { ok: false, error: "One of those teams is not in this league." };
  }

  const sleeperIds = Array.from(
    new Set(
      involvedRosters.flatMap((r) => [
        ...r.playerSleeperIds,
        ...r.starterSleeperIds,
        ...r.reserveSleeperIds,
        ...r.taxiSleeperIds,
      ]),
    ),
  );
  const players = await loadPlayers(admin, sleeperIds);
  const playerIds = Array.from(new Set([...players.values()].map((p) => p.playerId)));

  const scoringBase = closestScoringBase(league.scoringSettings);
  const defenseSeasons = [league.season - 1, league.season - 2];

  const [projectionRows, accuracy, defense, schedule, cachedWeekly] = await Promise.all([
    loadProjections(admin, playerIds, league.season, currentWeek),
    loadAccuracy(admin, playerIds, scoringBase),
    loadDefenseSplits(admin, scoringBase, defenseSeasons),
    loadSchedule(admin, finder.leagueRowId, league.season),
    loadCachedWeekly(admin, finder.leagueRowId, league.season),
  ]);

  // Keyed for O(1) lookup by the engine, which asks per player per week and
  // would otherwise scan a few thousand rows for each of them.
  const projections = new Map<string, ProjectionRow>();
  for (const row of projectionRows) {
    projections.set(`${row.playerId}|${row.week}`, row);
  }

  const remainingWeeks = schedule.weeks
    .filter((w) => !w.isFinal && w.week >= currentWeek && w.week < league.playoffWeekStart)
    .map((w) => w.week)
    .sort((a, b) => a - b);

  return {
    ok: true,
    world: {
      finder,
      league,
      rosters,
      players,
      projections,
      accuracy,
      defense,
      defenseSeasons,
      settings,
      schedule: schedule.weeks,
      remainingWeeks,
      currentWeek,
      cachedWeekly,
    },
  };
}
