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
 * Availability, and why a missing projection is not always a missing row:
 * Sleeper does NOT publish a zero for a player who cannot play. The row still
 * arrives, still carries the injury designation, and simply has no pts_ppr /
 * pts_half_ppr / pts_std key. This sync used to require one of those keys before
 * it would store anything, so an injured player was skipped and the PREVIOUS
 * night's numbers survived in place. That is how Ricky Pearsall (IR, out for the
 * season) kept reading 8.9 PPR a week in Power Pulse and Trade Ideas for 24 days
 * after Sleeper stopped projecting him.
 *
 * Writing a zero on sight would be just as wrong, because an empty stats object
 * describes three completely different things. In week 10 of 2026 it covers
 * Ricky Pearsall on season-ending IR, Jalen Hurts and 68 others on bye, and
 * Justin Fields, a healthy rostered quarterback Sleeper simply does not project
 * because he is a backup. classifyRow() separates them:
 *
 *   points published                    -> 'projected', store the numbers
 *   no points, game, injury designation -> 'out', store a real 0
 *   no points, game, no designation     -> 'unprojected', store nulls
 *   no points, no game                  -> bye; store NOTHING
 *
 * Bye weeks stay absent rather than becoming rows, and an unprojected row holds
 * nulls, so the project-wide rule that a null projection is never a zero still
 * holds. The only thing that changed is that "cannot play" now has a way to be
 * said out loud, separate from "we have no opinion".
 *
 * The sweep at the end of each week is the last piece. The upsert can only fix a
 * row the payload still mentions, so a player Sleeper drops from the feed
 * entirely would keep his old numbers forever. Anything this run did not touch
 * therefore has its numbers cleared, guarded on the run having actually stored
 * something, and skipped entirely for backfills (see clearStale).
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

/** Whether Sleeper published any point projection at all for this row. */
function hasPublishedPoints(row: SleeperWeeklyProjection): boolean {
  return (
    readPts(row.stats, "pts_ppr") !== null ||
    readPts(row.stats, "pts_half_ppr") !== null ||
    readPts(row.stats, "pts_std") !== null
  );
}

/** Sleeper's injury designation on a projection row, trimmed. Null when healthy. */
function readInjuryStatus(row: SleeperWeeklyProjection): string | null {
  const raw = row.player?.injury_status;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * What this row means, which is not the same question as what it contains.
 *
 * Three different things arrive looking identical, as an empty stats object:
 *
 *   "projected"   Sleeper published points. Its opinion, stored verbatim.
 *   "out"         A scheduled game, no points, AND an injury designation.
 *                 Sleeper is saying this player cannot play. Stored as a real
 *                 zero, because that is the answer rather than the absence of
 *                 one. Ricky Pearsall on season-ending IR is this case in every
 *                 week of 2026.
 *   "unprojected" A scheduled game, no points, and no designation. Sleeper has
 *                 no opinion, which is NOT the same as an opinion of zero.
 *                 Stored with null points so readers treat the week as absent.
 *   "bye"         No game at all. Not stored; the week stays absent.
 *
 * The designation is the discriminator, and it has to be, because game_id alone
 * is not enough. In week 10 of 2026, Justin Fields (healthy, on KC, on fantasy
 * rosters, averaged 20.4 PPR in his projected weeks last season) has a scheduled
 * game and no points, exactly like Pearsall does. The only thing separating them
 * is that Pearsall carries "IR" and Fields carries nothing. Sleeper does not
 * project backup quarterbacks; that is silence, not a forecast of zero, and
 * writing a zero there would invent an opinion Sleeper never gave and bury a
 * real player at the bottom of every lineup.
 *
 * A bye is filtered on game_id and stays absent because bye weeks are fixed for
 * the season, so no stale number can be hiding behind one.
 */
export function classifyRow(
  row: SleeperWeeklyProjection,
): "projected" | "out" | "unprojected" | "bye" {
  if (hasPublishedPoints(row)) return "projected";
  const gameId = typeof row.game_id === "string" ? row.game_id.trim() : "";
  if (gameId.length === 0) return "bye";
  return readInjuryStatus(row) !== null ? "out" : "unprojected";
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
  /**
   * Clear the numbers on rows Sleeper no longer returns for a week. Default
   * true, which is what the nightly sync wants: a forward-looking projection
   * for a player who has vanished from the feed is the exact staleness this
   * whole path exists to stop.
   *
   * The BACKFILL passes false. A past week's projection is a historical record,
   * graded against what actually happened by
   * lib/calculate-projection-accuracy.ts. Sleeper's view of a finished season
   * shifts over time, and clearing a week we already scored would delete the
   * evidence rather than correct it.
   */
  clearStale?: boolean;
};

export type WeeklyProjectionsSyncResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  source: string;
  season: number;
  seasonType: SleeperSeasonType;
  weeks: number[];
  perWeek: Array<{
    week: number;
    fetched: number;
    stored: number;
    matched: number;
    /** Rows stored as a real zero: a scheduled game, no points, an injury designation. */
    out: number;
    /** Rows stored with null points: Sleeper simply does not cover the player. */
    unprojected: number;
    /** Rows deliberately not stored because the player had no game that week. */
    bye: number;
    /** Rows Sleeper dropped from the payload entirely, whose numbers we cleared. */
    cleared: number;
  }>;
  totalStored: number;
  /** Across every week: how many stored rows are a genuine "cannot play" zero. */
  totalOut: number;
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
  const clearStale = opts.clearStale ?? true;

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
      | "skipped"
      | "reason"
      | "weeks"
      | "perWeek"
      | "totalStored"
      | "totalOut"
      | "matchedPlayers"
      | "unmatchedPlayers"
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
      totalOut: 0,
      matchedPlayers: 0,
      unmatchedPlayers: 0,
    });
  }

  const idBySleeper = await loadSleeperIdMap(supabase);
  const nowIso = new Date().toISOString();

  const perWeek: WeeklyProjectionsSyncResult["perWeek"] = [];
  let totalFetched = 0;
  let totalStored = 0;
  let totalOut = 0;
  let matchedPlayers = 0;

  for (const week of weeks) {
    const rows = await getSleeperWeeklyProjections(season as number, week, seasonType);
    totalFetched += rows.length;

    const inserts: WeeklyProjectionInsert[] = [];
    let matchedThisWeek = 0;
    let outThisWeek = 0;
    let unprojectedThisWeek = 0;
    let byeThisWeek = 0;
    for (const row of rows) {
      const sleeperId = typeof row.player_id === "string" ? row.player_id.trim() : "";
      if (!sleeperId || sleeperId === "0") continue;

      const availability = classifyRow(row);
      // A bye is an absent week, not a zero. Storing one would sum into every
      // season total and quietly become a real number nobody could trace back.
      if (availability === "bye") {
        byeThisWeek += 1;
        continue;
      }
      const isOut = availability === "out";
      const isUnprojected = availability === "unprojected";
      if (isOut) outThisWeek += 1;
      if (isUnprojected) unprojectedThisWeek += 1;

      const playerId = idBySleeper.get(sleeperId) ?? null;
      if (playerId) matchedThisWeek += 1;

      inserts.push({
        source: WEEKLY_PROJECTION_SOURCE_SLUG,
        season: season as number,
        season_type: seasonType,
        week,
        sleeper_player_id: sleeperId,
        player_id: playerId,
        // An out row is a real zero in every scoring base, so a reader picking
        // whichever base fits its league gets the same answer. An unprojected
        // row carries nulls: the row exists to overwrite whatever number was
        // sitting there, not to assert a new one.
        projected_pts_ppr: isOut ? 0 : isUnprojected ? null : readPts(row.stats, "pts_ppr"),
        projected_pts_half_ppr: isOut
          ? 0
          : isUnprojected
            ? null
            : readPts(row.stats, "pts_half_ppr"),
        projected_pts_std: isOut ? 0 : isUnprojected ? null : readPts(row.stats, "pts_std"),
        availability,
        injury_status: readInjuryStatus(row),
        opponent: typeof row.opponent === "string" ? row.opponent : null,
        team: typeof row.team === "string" ? row.team : null,
        game_id: typeof row.game_id === "string" ? row.game_id : null,
        // Neither an out row nor an unprojected one carries a stat line, only
        // leftovers like adp_dd_ppr, so the extracted line is emptied either
        // way and nothing rescoring under a league's own settings can mistake a
        // draft-position number for production. The two differ in HOW empty:
        // {} scores to a definite zero, null scores to no opinion at all, which
        // is exactly the distinction between the two states. The raw payload is
        // preserved in metadata regardless.
        stat_line: (isOut ? {} : isUnprojected ? null : (row.stats ?? null)) as unknown as Json,
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

    // Anything this run did not touch is, by definition, a row Sleeper stopped
    // returning at all. That is the last way a stale number can survive: the
    // upsert above can only correct rows the payload still mentions, and a
    // player dropped from the feed entirely is never mentioned again. Their
    // numbers are cleared rather than the rows deleted, so the fact that we
    // once had a projection and no longer do stays on the record.
    //
    // Matched on updated_at rather than an id list, because the touched set runs
    // to a thousand ids a week and would not survive a URL. Every row this run
    // wrote carries nowIso exactly; every row it did not is strictly older.
    //
    // Guarded on having actually stored something. On a run that fetched
    // nothing, "untouched" would mean the whole week, and the sweep would erase
    // a good week's projections on the strength of one failed request.
    let cleared = 0;
    if (clearStale && inserts.length > 0) {
      const { data: clearedRows, error: clearError } = await withRetry(
        async () =>
          await supabase
            .from("player_weekly_projections")
            .update({
              projected_pts_ppr: null,
              projected_pts_half_ppr: null,
              projected_pts_std: null,
              stat_line: null,
              availability: "unprojected",
              updated_at: nowIso,
            })
            .eq("source", WEEKLY_PROJECTION_SOURCE_SLUG)
            .eq("season", season as number)
            .eq("season_type", seasonType)
            .eq("week", week)
            .lt("updated_at", nowIso)
            .select("id"),
        { label: `player_weekly_projections clear-stale ${season} ${seasonType} wk${week}` },
      );
      if (clearError) throw clearError;
      cleared = clearedRows?.length ?? 0;
    }

    totalStored += inserts.length;
    matchedPlayers += matchedThisWeek;
    totalOut += outThisWeek;
    perWeek.push({
      week,
      fetched: rows.length,
      stored: inserts.length,
      matched: matchedThisWeek,
      out: outThisWeek,
      unprojected: unprojectedThisWeek,
      bye: byeThisWeek,
      cleared,
    });
    console.log(
      `  ${season} ${seasonType} wk${week}: ${rows.length} fetched, ${inserts.length} stored ` +
        `(${matchedThisWeek} matched, ${outThisWeek} out, ${unprojectedThisWeek} unprojected, ` +
        `${byeThisWeek} on bye, ${cleared} cleared)`,
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
      totalOut: 0,
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
    totalOut,
    matchedPlayers,
    unmatchedPlayers,
  });
}
