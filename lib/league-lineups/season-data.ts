import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import {
  loadAccuracy,
  loadDefenseSplits,
  loadLeague,
  loadPlayers,
  loadProjections,
  type ProjectionRow,
} from "@/lib/power-pulse/load";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { projectPlayerWeek, reliabilityMultiplier } from "@/lib/power-pulse/project";
import { closestScoringBase } from "@/lib/league-scoring";
import { defenseSeasonsFor } from "@/lib/projections/defense-seasons";
import { resolveProjectionSourceForWindow } from "@/lib/projections/source";
import { alignedStartingSlots } from "@/lib/league-schedule/slots";
import { rawStarterIds, type RawMatchupRow } from "@/lib/league-schedule/lineups";
import { MAX_MATCHUP_WEEK } from "@/lib/league-matchups";
import type { LedgerWeek } from "@/lib/manager-ledger/types";
import { buildSeasonSeries, projectionAccuracy, type SeasonSeries, type ProjectionAccuracy } from "./season";

/**
 * The season view behind the Lineups page: every week of this roster's year.
 *
 * TWO SOURCES, AND THE SPLIT IS THE POINT.
 *
 * Everything SETTLED is read from `league_manager_ledger_cache`. That table is
 * the Manager Ledger's, it is computed on demand through `pulseLeague` exactly
 * as CLAUDE.md requires, and it already holds the official score, the best
 * legal lineup, the deficit and both results for every graded week. Recomputing
 * any of that here would be a second implementation of the model the Decisions
 * page owns, and the two would disagree about the same week inside a month.
 * This file triggers nothing: it reads, or it reports that there is nothing to
 * read yet.
 *
 * Everything PROJECTED is computed here, because the ledger has none and cannot
 * have any: its own absolute rule is that every figure is retrospective and
 * settled. A projection is neither.
 *
 * WHAT THE RETROSPECTIVE PROJECTION CAN AND CANNOT CLAIM, said here and said
 * again in the footnote on the page. `player_weekly_projections` keeps a row
 * per player-week for the whole season, so the number a player was projected
 * for in week 3 is still there in week 12. What is NOT preserved is the state
 * of the adjustment layer at the time: opponent strength, reliability and
 * availability are read as they are TODAY, so a week 3 projection reconstructed
 * in week 12 is the model's current opinion of week 3 rather than a snapshot of
 * what the page displayed that Sunday. For a chart of "was the model roughly
 * right about this team" that is the honest and useful answer; it is not a
 * forecasting scorecard and the page does not present it as one.
 *
 * ONE WAVE, BEHIND THE PAGE'S OWN SUSPENSE BOUNDARY. Five reads that do not
 * depend on each other, none of which the lineup board needs, so nothing here
 * delays the thing a reader came for.
 */

type ServiceClient = SupabaseClient<Database>;
type AnyClient =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/** The season figures the report header quotes, straight off the ledger row. */
export type SeasonLedgerSummary = {
  weeksGraded: number;
  /** Set points over optimal points across the season. Null with nothing graded. */
  efficiency: number | null;
  efficiencyRank: number | null;
  scoringRank: number | null;
  /** Games lost that the best legal lineup would have won. */
  winsLeftOnBench: number;
  pointsLeft: number;
  actualRecord: { wins: number; losses: number; ties: number };
  bestLineupRecord: { wins: number; losses: number; ties: number };
  /** How many teams the ranks are out of. */
  teamCount: number;
};

export type LineupSeasonView = {
  series: SeasonSeries;
  accuracy: ProjectionAccuracy | null;
  /** Null when the ledger has not been built for this league yet. */
  ledger: SeasonLedgerSummary | null;
  /** The projection engine the retrospective series was rebuilt with. */
  projectionSource: string;
};

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Wrapped in React `cache()` so a page that reads it from two places issues one
 * set of queries.
 *
 * KEYED ON PRIMITIVES, WHICH IS THE ONLY WAY IT WORKS. `cache()` compares
 * arguments with Object.is, and the first version took the two Supabase clients
 * and a params object as arguments. Every one of those is freshly constructed
 * per call, so no second caller could ever hit and the wrapper was decoration
 * describing a dedupe that did not happen. The clients are created inside now.
 */
export const loadLineupSeason = cache(async function loadLineupSeason(params: {
  leagueRowId: string;
  season: number;
  sleeperRosterId: number;
  /** The week the page is showing, so the chart can mark it. */
  viewedWeek: number;
  /** The live NFL week, so a past week gets no present-tense injury discount. */
  currentWeek: number;
  teamCount: number;
}): Promise<LineupSeasonView> {
  const { leagueRowId, season, sleeperRosterId, viewedWeek, currentWeek, teamCount } = params;
  const supabase = await createClient();
  const admin = createAdminClient();

  const [league, settings, ledgerRes, matchupsRes] = await Promise.all([
    loadLeague(admin, leagueRowId),
    loadPowerPulseSettings(admin),
    supabase
      .from("league_manager_ledger_cache")
      .select(
        "weeks, weeks_graded, lineup_efficiency, efficiency_rank, scoring_rank, wins_left_on_bench, points_left, actual_wins, actual_losses, actual_ties, best_lineup_wins, best_lineup_losses, best_lineup_ties",
      )
      .eq("league_id", leagueRowId)
      .eq("season", season)
      .eq("sleeper_roster_id", sleeperRosterId)
      .maybeSingle(),
    supabase
      .from("league_matchups")
      .select("week, is_final, starter_ids, metadata")
      .eq("league_id", leagueRowId)
      .eq("season", season)
      .eq("sleeper_roster_id", sleeperRosterId)
      .order("week", { ascending: true }),
  ]);

  const ledgerRow = ledgerRes.data ?? null;
  const ledgerWeeks = Array.isArray(ledgerRow?.weeks)
    ? (ledgerRow.weeks as unknown as LedgerWeek[])
    : [];

  const ledger: SeasonLedgerSummary | null = ledgerRow
    ? {
        weeksGraded: Number(ledgerRow.weeks_graded ?? 0),
        efficiency: numberOrNull(ledgerRow.lineup_efficiency),
        efficiencyRank: numberOrNull(ledgerRow.efficiency_rank),
        scoringRank: numberOrNull(ledgerRow.scoring_rank),
        winsLeftOnBench: Number(ledgerRow.wins_left_on_bench ?? 0),
        pointsLeft: Number(ledgerRow.points_left ?? 0),
        actualRecord: {
          wins: Number(ledgerRow.actual_wins ?? 0),
          losses: Number(ledgerRow.actual_losses ?? 0),
          ties: Number(ledgerRow.actual_ties ?? 0),
        },
        bestLineupRecord: {
          wins: Number(ledgerRow.best_lineup_wins ?? 0),
          losses: Number(ledgerRow.best_lineup_losses ?? 0),
          ties: Number(ledgerRow.best_lineup_ties ?? 0),
        },
        teamCount,
      }
    : null;

  const projectedByWeek = new Map<number, number>();
  let projectionSource = "sleeper";

  const matchupRows = (matchupsRes.data ?? []) as unknown as Array<{
    week: number;
    is_final: boolean | null;
    starter_ids: Json;
    metadata: Json;
  }>;

  if (league && matchupRows.length > 0) {
    // THE SLOT LIST IS POSITIONALLY ALIGNED TO SLEEPER'S OWN ARRAY, so an
    // unfilled slot leaves a gap rather than shifting everybody below it up
    // one. Same list, same reason, as the board itself.
    const slots = alignedStartingSlots(league.rosterPositions);
    const scoringBase = closestScoringBase(league.scoringSettings);
    const defenseSeasons = defenseSeasonsFor(season);

    const startersByWeek = new Map<number, (string | null)[]>();
    const sleeperIds = new Set<string>();
    let lastWeek = 1;

    for (const row of matchupRows) {
      const week = Number(row.week);
      if (!Number.isFinite(week) || week < 1 || week > MAX_MATCHUP_WEEK) continue;
      // SETTLED WEEKS ONLY. Both charts draw a week only when it has a result:
      // one plots the score inside the ceiling, the other plots the miss against
      // the projection. Projecting the rest of the season would be reading the
      // whole 18 week slate Sleeper publishes at league creation, several
      // thousand rows, to produce points nothing draws.
      if (!row.is_final) continue;
      const raw: RawMatchupRow = {
        starter_ids: row.starter_ids,
        starter_points: null,
        player_ids: null,
        player_points: null,
        metadata: row.metadata,
      };
      const ids = rawStarterIds(raw);
      if (ids.length === 0) continue;
      startersByWeek.set(week, ids);
      if (week > lastWeek) lastWeek = week;
      // EVERY WEEK'S OWN STARTERS, not the roster as it stands. A player
      // started in week 2 and traded in week 5 is not on this roster now, and
      // dropping him would understate week 2 by whatever he scored.
      for (const id of ids) {
        if (typeof id === "string" && id.length > 0 && id !== "0") sleeperIds.add(id);
      }
    }

    if (sleeperIds.size > 0) {
      // THREE LEVELS BECOME TWO. Only the projection and accuracy reads need the
      // resolved player ids; the defence splits and the engine resolution need
      // nothing from wave 1 beyond what is already in hand, so waiting for the
      // player lookup before starting them spent a round trip on nothing.
      const [players, defense, resolvedSource] = await Promise.all([
        loadPlayers(admin, [...sleeperIds]),
        loadDefenseSplits(admin, scoringBase, defenseSeasons),
        resolveProjectionSourceForWindow({
          supabase: admin,
          season,
          fromWeek: 1,
          toWeek: lastWeek,
          settings: settings.beaconProjections,
        }),
      ]);
      projectionSource = resolvedSource;
      const playerIds = [...new Set([...players.values()].map((p) => p.playerId))];

      if (playerIds.length > 0) {
        const [projectionRows, accuracy] = await Promise.all([
          loadProjections(admin, playerIds, season, 1, lastWeek, projectionSource),
          loadAccuracy(admin, playerIds, scoringBase, projectionSource),
        ]);

        const byPlayerWeek = new Map<string, ProjectionRow>();
        for (const row of projectionRows) {
          byPlayerWeek.set(`${row.playerId}|${row.week}`, row);
        }

        for (const [week, ids] of startersByWeek) {
          let total = 0;
          let counted = 0;
          // A duplicate id in Sleeper's starters array keeps its FIRST slot, so
          // this total and the board's cannot disagree about a week. Sleeper
          // has produced them, and lib/league-lineups/build.ts guards the same
          // case for the same reason.
          const seen = new Set<string>();
          slots.forEach((slot, index) => {
            if (!slot.projectable) return;
            const sleeperId = ids[index];
            if (typeof sleeperId !== "string" || sleeperId.length === 0 || sleeperId === "0") return;
            if (seen.has(sleeperId)) return;
            seen.add(sleeperId);
            const row = players.get(sleeperId);
            if (!row) return;
            const acc = accuracy.get(row.playerId) ?? null;
            const projected = projectPlayerWeek({
              projection: byPlayerWeek.get(`${row.playerId}|${week}`),
              subject: { position: row.position, injuryStatus: row.injuryStatus },
              accuracy: acc,
              reliability: reliabilityMultiplier(acc, settings),
              scoringSettings: league.scoringSettings,
              defense,
              defenseSeasons,
              week,
              // The LIVE week, so the week-to-week injury discount fires only on
              // the week it is actually about. Passing the week being rebuilt
              // would apply today's injury designation retroactively to every
              // Sunday of the season.
              currentWeek,
              settings,
            });
            if (!projected) return;
            total += projected.points;
            counted += 1;
          });
          // A week where nothing resolved is left ABSENT rather than plotted as
          // zero. A zero on this chart reads as "your lineup was projected for
          // nothing", which is a claim, and an absent point reads as what it is.
          if (counted > 0) projectedByWeek.set(week, total);
        }
      }
    }
  }

  const series = buildSeasonSeries({ ledgerWeeks, projectedByWeek, viewedWeek });

  return {
    series,
    accuracy: projectionAccuracy(series.points),
    ledger,
    projectionSource,
  };
});
