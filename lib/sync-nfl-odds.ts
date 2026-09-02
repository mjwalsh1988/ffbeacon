/**
 * ESPN game odds sync (library form).
 *
 * Shared by the Vercel cron endpoint (app/api/cron/sync-nfl-odds) and the CLI
 * (scripts/sync-nfl-odds.ts). Pulls one ESPN scoreboard call per targeted week
 * via lib/nfl-odds.ts and OVERWRITES the stored row for each
 * (source, season, season_type, week, home_team). Re-runs update the same rows
 * in place through the unique key, so this is not a per-night history: it is
 * always the latest published line.
 *
 * Season / week resolution mirrors lib/sync-weekly-projections.ts exactly:
 * Sleeper's live state gives the season we are operating in and the current
 * week. Lines move through the week and a week that already kicked off is not
 * worth refetching, so the default window is narrow: the current week plus the
 * next two. That is a deliberate difference from the weekly projections sync,
 * which refreshes the whole remaining slate; a betting line for week 15 in
 * week 3 does not exist yet and is not worth asking ESPN for on a daily cron.
 *
 * Failure posture: a single week with no games published (ESPN answered, the
 * array is empty) is logged and skipped, not an error. If every targeted week
 * comes back empty, the run returns skipped: true with a reason rather than
 * throwing, so the nightly cron does not false-alarm in the off-season. A week
 * whose FETCH FAILED (getEspnScoreboard returned null, not []) is a different
 * thing entirely: it is reported in failedWeeks and perWeek, its existing rows
 * are left untouched, and it is never counted toward "the week came back
 * empty". Collapsing that distinction is the exact bug CLAUDE.md's Power Pulse
 * section calls out for Sleeper: a throttled fetch is not evidence a week has
 * no games.
 *
 * That same rule has one more consequence, and it is why this function THROWS
 * in exactly one case: when EVERY targeted week's fetch failed. A run that
 * returns ok:true looks like a healthy night to recordCronRun and cron-health
 * alike, so a total ESPN outage would otherwise sit silent through an entire
 * season with nothing in the ledger to say so. Zero successful weeks out of
 * the targeted set is treated as an outage, not a dead-months skip, and
 * throwing is the only way to make recordCronRun mark the run "error" so
 * cron-health can page on it. A SINGLE failed week among otherwise successful
 * ones is still genuinely tolerable and must not page anyone; only a complete
 * shutout throws.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";
import { currentNflSeason, getNflState } from "./sleeper";
import { getEspnScoreboard, impliedTotals, type EspnSeasonType } from "./nfl-odds";
import { withRetry } from "./supabase/retry";

type NflGameOddsInsert = Database["public"]["Tables"]["nfl_game_odds"]["Insert"];

export const NFL_ODDS_SOURCE_SLUG = "espn";

/** Default trailing window past the current week: the current week plus this many more. */
export const DEFAULT_ODDS_WEEK_SPAN = 2;

export type NflOddsSyncOptions = {
  /** NFL season to pull. Defaults to Sleeper's live league_season. */
  season?: number;
  /** Defaults to "regular". */
  seasonType?: EspnSeasonType;
  /** First week to refresh. Defaults to the live week (in season) or 1 (pre/off). */
  fromWeek?: number;
  /** Last week to refresh. Defaults to fromWeek + DEFAULT_ODDS_WEEK_SPAN. */
  toWeek?: number;
};

export type NflOddsSyncResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  source: string;
  season: number;
  seasonType: EspnSeasonType;
  weeks: number[];
  /** Weeks whose ESPN request failed outright. Existing rows for these weeks are untouched. */
  failedWeeks: number[];
  perWeek: Array<{
    week: number;
    status: "ok" | "failed";
    /** Games ESPN returned for the week. 0 on a failed fetch, distinct from a genuine empty slate. */
    fetched: number;
    stored: number;
  }>;
  totalStored: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export async function runNflOddsSync(
  supabase: SupabaseClient<Database>,
  opts: NflOddsSyncOptions = {},
): Promise<NflOddsSyncResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const seasonType: EspnSeasonType = opts.seasonType ?? "regular";

  // Resolve season and starting week from explicit opts or Sleeper's live state,
  // the same way lib/sync-weekly-projections.ts does.
  let season = opts.season ?? null;
  let fromWeek = opts.fromWeek ?? null;
  if (season === null || fromWeek === null) {
    const state = await getNflState();
    if (season === null) {
      const fromState = Number(state?.league_season ?? state?.season);
      season = Number.isFinite(fromState) && fromState > 2000 ? fromState : Number(currentNflSeason());
    }
    if (fromWeek === null) {
      const stateSeason = Number(state?.season);
      const inThisRegularSeason = state?.season_type === "regular" && stateSeason === season;
      fromWeek = inThisRegularSeason ? Math.max(1, state?.week ?? 1) : 1;
    }
  }

  const toWeek = opts.toWeek ?? (fromWeek as number) + DEFAULT_ODDS_WEEK_SPAN;
  const weeks: number[] = [];
  for (let w = Math.max(1, fromWeek as number); w <= toWeek; w++) weeks.push(w);

  const finish = (
    partial: Pick<
      NflOddsSyncResult,
      "skipped" | "reason" | "weeks" | "failedWeeks" | "perWeek" | "totalStored"
    >,
  ): NflOddsSyncResult => {
    const finished = Date.now();
    return {
      ok: true,
      source: NFL_ODDS_SOURCE_SLUG,
      season: season as number,
      seasonType,
      startedAt,
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      ...partial,
    };
  };

  if (weeks.length === 0) {
    return finish({
      skipped: true,
      reason: `no weeks to sync (fromWeek=${fromWeek} > toWeek=${toWeek})`,
      weeks: [],
      failedWeeks: [],
      perWeek: [],
      totalStored: 0,
    });
  }

  const nowIso = new Date().toISOString();
  const perWeek: NflOddsSyncResult["perWeek"] = [];
  const failedWeeks: number[] = [];
  let totalStored = 0;

  for (const week of weeks) {
    const games = await getEspnScoreboard(season as number, week, seasonType);

    if (games === null) {
      failedWeeks.push(week);
      perWeek.push({ week, status: "failed", fetched: 0, stored: 0 });
      console.warn(
        `  ${season} ${seasonType} wk${week}: ESPN scoreboard request failed, existing rows left untouched`,
      );
      continue;
    }

    if (games.length === 0) {
      perWeek.push({ week, status: "ok", fetched: 0, stored: 0 });
      console.log(`  ${season} ${seasonType} wk${week}: 0 games published by ESPN`);
      continue;
    }

    const inserts: NflGameOddsInsert[] = games.map((game) => {
      const implied = impliedTotals(game.gameTotal, game.homeSpread);
      return {
        source: NFL_ODDS_SOURCE_SLUG,
        season: game.season,
        season_type: game.seasonType,
        week: game.week,
        home_team: game.homeTeam,
        away_team: game.awayTeam,
        kickoff_at: game.kickoffAt,
        game_total: game.gameTotal,
        home_spread: game.homeSpread,
        home_implied_total: implied.home,
        away_implied_total: implied.away,
        provider: game.provider,
        metadata: game.raw as Json,
        updated_at: nowIso,
      };
    });

    await withRetry(
      async () => {
        const { error } = await supabase.from("nfl_game_odds").upsert(inserts, {
          onConflict: "source,season,season_type,week,home_team",
          ignoreDuplicates: false,
        });
        if (error) throw error;
      },
      { label: `nfl_game_odds upsert ${season} ${seasonType} wk${week}` },
    );

    totalStored += inserts.length;
    perWeek.push({ week, status: "ok", fetched: games.length, stored: inserts.length });
    console.log(
      `  ${season} ${seasonType} wk${week}: ${games.length} games from ESPN, ${inserts.length} stored`,
    );
  }

  // Every targeted week's fetch failed: this is an outage, not the dead-months
  // case, and it has to be said somewhere. CLAUDE.md's Power Pulse section is
  // explicit that a failed request is never evidence about the world, and the
  // only place that rule can actually be enforced is the cron ledger: a run
  // that returns ok:true looks identical to a healthy night to recordCronRun
  // and to cron-health, so ESPN could be down for a fortnight during the
  // season and nothing would say so. A SINGLE failed week among otherwise
  // successful ones stays tolerable and is reported below via failedWeeks /
  // perWeek without throwing; only a complete shutout (zero successful weeks
  // out of the targeted set) throws.
  if (failedWeeks.length === weeks.length) {
    throw new Error(
      `ESPN scoreboard request failed for all ${weeks.length} targeted week(s) (${weeks.join(", ")}) for ${season} ${seasonType}; treating this as an outage rather than a healthy run.`,
    );
  }

  // Every targeted week fetched cleanly and none had games published: a real
  // "nothing to report" state (the dead months), not a failure. Weeks that
  // FAILED are excluded from this check on purpose: a run made up entirely of
  // failed fetches must never read as "ESPN has nothing this week."
  if (failedWeeks.length === 0 && totalStored === 0) {
    return finish({
      skipped: true,
      reason: `no games published by ESPN for ${season} ${seasonType} (weeks ${weeks[0]}-${weeks[weeks.length - 1]})`,
      weeks,
      failedWeeks,
      perWeek,
      totalStored: 0,
    });
  }

  return finish({
    skipped: false,
    weeks,
    failedWeeks,
    perWeek,
    totalStored,
  });
}
