/**
 * Sleeper weekly point-projection sync (library form).
 *
 * Shared by the Vercel cron endpoint (app/api/cron/sync-weekly-projections) and
 * the CLI (scripts/sync-weekly-projections.ts). Pulls one call per week from
 * Sleeper's per-week projections endpoint and OVERWRITES the stored row for each
 * (source, season_type, season, week, player). The table therefore always holds
 * the latest projection for every upcoming week, not a per-night history: re-runs
 * update the same rows in place via the unique key.
 *
 * Season / week resolution: Sleeper's live state gives the season the app is
 * operating in (league_season, which is what drafts and the upcoming season run
 * against) and the current week. In the regular season we refresh the current
 * week forward (past weeks are already played, so their projections are moot); in
 * the pre / off season we refresh the full slate from week 1. Projections are a
 * regular-season concept, so season_type defaults to "regular" (weeks 1-18).
 *
 * Failure posture (mirrors the stats sync, same Sleeper per-week endpoint family):
 * an individual empty week is NOT an error. Early in the off-season Sleeper may
 * not have published later weeks yet, so we log and continue. If EVERY targeted
 * week comes back empty (nothing published at all), the run returns skipped:true
 * (HTTP 200) rather than throwing, so the nightly cron does not false-alarm in the
 * dead months. Upsert semantics mean an empty run writes nothing and never
 * clobbers previously stored projections.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";
import {
  currentNflSeason,
  getNflState,
  getSleeperWeeklyProjections,
  type SleeperSeasonType,
  type SleeperWeeklyProjection,
} from "./sleeper";
import { loadSleeperIdMap } from "./sync-sleeper-stats";
import { withRetry } from "./supabase/retry";

type WeeklyProjectionInsert = Database["public"]["Tables"]["player_weekly_projections"]["Insert"];

const UPSERT_BATCH_SIZE = 500;

/** Last week of the NFL regular season (fantasy projections are regular-season). */
export const REGULAR_SEASON_LAST_WEEK = 18;

export const WEEKLY_PROJECTION_SOURCE_SLUG = "sleeper";

function readPts(stats: Record<string, number> | null | undefined, key: string): number | null {
  const v = stats?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A row is worth storing only if it carries at least one real point projection. */
function isStorableRow(row: SleeperWeeklyProjection): boolean {
  return (
    readPts(row.stats, "pts_ppr") !== null ||
    readPts(row.stats, "pts_half_ppr") !== null ||
    readPts(row.stats, "pts_std") !== null
  );
}

export type WeeklyProjectionsSyncOptions = {
  /** NFL season to pull. Defaults to Sleeper's live league_season. */
  season?: number;
  /** Defaults to "regular". */
  seasonType?: SleeperSeasonType;
  /** First week to refresh. Defaults to the live week (in season) or 1 (pre/off). */
  fromWeek?: number;
  /** Last week to refresh. Defaults to week 18. */
  toWeek?: number;
};

export type WeeklyProjectionsSyncResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  source: string;
  season: number;
  seasonType: SleeperSeasonType;
  weeks: number[];
  perWeek: Array<{ week: number; fetched: number; stored: number; matched: number }>;
  totalStored: number;
  matchedPlayers: number;
  unmatchedPlayers: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export async function runWeeklyProjectionsSync(
  supabase: SupabaseClient<Database>,
  opts: WeeklyProjectionsSyncOptions = {},
): Promise<WeeklyProjectionsSyncResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const seasonType: SleeperSeasonType = opts.seasonType ?? "regular";

  // Resolve season and starting week from explicit opts or Sleeper's live state.
  let season = opts.season ?? null;
  let fromWeek = opts.fromWeek ?? null;
  if (season === null || fromWeek === null) {
    const state = await getNflState();
    if (season === null) {
      const fromState = Number(state?.league_season ?? state?.season);
      season = Number.isFinite(fromState) && fromState > 2000 ? fromState : Number(currentNflSeason());
    }
    if (fromWeek === null) {
      // Skip already-played weeks only when live state is the regular season of
      // this same season; otherwise refresh the whole slate from week 1.
      const stateSeason = Number(state?.season);
      const inThisRegularSeason = state?.season_type === "regular" && stateSeason === season;
      fromWeek = inThisRegularSeason ? Math.max(1, state?.week ?? 1) : 1;
    }
  }

  const toWeek = opts.toWeek ?? REGULAR_SEASON_LAST_WEEK;
  const weeks: number[] = [];
  for (let w = Math.max(1, fromWeek); w <= toWeek; w++) weeks.push(w);

  const finish = (
    partial: Pick<
      WeeklyProjectionsSyncResult,
      "skipped" | "reason" | "weeks" | "perWeek" | "totalStored" | "matchedPlayers" | "unmatchedPlayers"
    >,
  ): WeeklyProjectionsSyncResult => {
    const finished = Date.now();
    return {
      ok: true,
      source: WEEKLY_PROJECTION_SOURCE_SLUG,
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
      perWeek: [],
      totalStored: 0,
      matchedPlayers: 0,
      unmatchedPlayers: 0,
    });
  }

  const idBySleeper = await loadSleeperIdMap(supabase);
  const nowIso = new Date().toISOString();

  const perWeek: WeeklyProjectionsSyncResult["perWeek"] = [];
  let totalFetched = 0;
  let totalStored = 0;
  let matchedPlayers = 0;

  for (const week of weeks) {
    const rows = await getSleeperWeeklyProjections(season as number, week, seasonType);
    totalFetched += rows.length;

    const inserts: WeeklyProjectionInsert[] = [];
    let matchedThisWeek = 0;
    for (const row of rows) {
      const sleeperId = typeof row.player_id === "string" ? row.player_id.trim() : "";
      if (!sleeperId || sleeperId === "0") continue;
      if (!isStorableRow(row)) continue;

      const playerId = idBySleeper.get(sleeperId) ?? null;
      if (playerId) matchedThisWeek += 1;

      inserts.push({
        source: WEEKLY_PROJECTION_SOURCE_SLUG,
        season: season as number,
        season_type: seasonType,
        week,
        sleeper_player_id: sleeperId,
        player_id: playerId,
        projected_pts_ppr: readPts(row.stats, "pts_ppr"),
        projected_pts_half_ppr: readPts(row.stats, "pts_half_ppr"),
        projected_pts_std: readPts(row.stats, "pts_std"),
        opponent: typeof row.opponent === "string" ? row.opponent : null,
        team: typeof row.team === "string" ? row.team : null,
        game_id: typeof row.game_id === "string" ? row.game_id : null,
        stat_line: (row.stats ?? null) as unknown as Json,
        metadata: row as unknown as Json,
        generated_at: nowIso,
        updated_at: nowIso,
      });
    }

    for (let i = 0; i < inserts.length; i += UPSERT_BATCH_SIZE) {
      const chunk = inserts.slice(i, i + UPSERT_BATCH_SIZE);
      await withRetry(
        async () => {
          const { error } = await supabase
            .from("player_weekly_projections")
            .upsert(chunk, {
              onConflict: "source,season_type,season,week,sleeper_player_id",
              ignoreDuplicates: false,
            });
          if (error) throw error;
        },
        { label: `player_weekly_projections upsert ${season} ${seasonType} wk${week}` },
      );
    }

    totalStored += inserts.length;
    matchedPlayers += matchedThisWeek;
    perWeek.push({ week, fetched: rows.length, stored: inserts.length, matched: matchedThisWeek });
    console.log(
      `  ${season} ${seasonType} wk${week}: ${rows.length} fetched, ${inserts.length} stored (${matchedThisWeek} matched)`,
    );
  }

  // Nothing published across every targeted week: treat as a graceful skip (like
  // the stats sync's off-season skip), not a hard failure. Upserts wrote nothing.
  if (totalFetched === 0) {
    return finish({
      skipped: true,
      reason: `no projections published for ${season} ${seasonType} (weeks ${weeks[0]}-${weeks[weeks.length - 1]})`,
      weeks,
      perWeek,
      totalStored: 0,
      matchedPlayers: 0,
      unmatchedPlayers: 0,
    });
  }

  const unmatchedPlayers = totalStored - matchedPlayers;
  if (unmatchedPlayers > 0) {
    console.warn(
      `[sync-weekly-projections] ${unmatchedPlayers} of ${totalStored} stored rows have no players match (kept with player_id null).`,
    );
  }

  return finish({
    skipped: false,
    weeks,
    perWeek,
    totalStored,
    matchedPlayers,
    unmatchedPlayers,
  });
}
