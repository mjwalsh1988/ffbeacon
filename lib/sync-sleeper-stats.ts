/**
 * Sleeper current-season stats sync (library form).
 *
 * Shared by the Vercel cron endpoint (app/api/cron/sync-sleeper-stats) and the
 * CLI (scripts/sync-sleeper-stats.ts). Pulls the current week plus a configurable
 * number of prior weeks (default 1) so late stat corrections, which finalize a
 * couple of days after the games, always get refreshed.
 *
 * Off-season handling: a single GET /v1/state/nfl tells us the live season,
 * season_type, and week. When season_type is "off" (between the Super Bowl and
 * the next preseason) we exit immediately without touching the stats endpoints,
 * so the sync only does real work when Sleeper is actually generating stats.
 *
 * Stats-specific behavior: unlike the KTC / FantasyCalc value syncs, an empty
 * week is NOT an error here. Early in a game week the endpoint can legitimately
 * return nothing, so we log it and move on. Idempotent upserts (unique on
 * player_id, week, season, season_type) mean repeated nightly refreshes simply
 * update the same rows as games complete.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { getNflState, getWeeklyStats, type SleeperSeasonType } from "./sleeper";
import { mapStatPayloadToRow } from "./sleeper-stats-map";
import { withRetry } from "./supabase/retry";

type StatInsert = Database["public"]["Tables"]["player_stats"]["Insert"];
type StatMetadata = Database["public"]["Tables"]["player_stats"]["Row"]["metadata"];

const UPSERT_BATCH_SIZE = 500;
const VALID_SEASON_TYPES: SleeperSeasonType[] = ["pre", "regular", "post"];

/**
 * Build the Sleeper-id -> players.id map once. Shared with the historical
 * backfill so both paths match players identically. Paginated past PostgREST's
 * 1000-row default.
 */
export async function loadSleeperIdMap(
  supabase: SupabaseClient<Database>,
): Promise<Map<string, string>> {
  const idBySleeper = new Map<string, string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const pageFrom = from;
    const { data, error } = await withRetry(
      async () =>
        await supabase.from("players").select("id, external_ids").range(pageFrom, pageFrom + PAGE - 1),
      { label: `players page ${pageFrom}` },
    );
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const p of data) {
      const sleeperId = (p.external_ids as { sleeper?: string } | null)?.sleeper;
      if (sleeperId) idBySleeper.set(sleeperId, p.id);
    }
    if (data.length < PAGE) break;
  }
  return idBySleeper;
}

export type SleeperStatsSyncOptions = {
  season?: number;
  seasonType?: SleeperSeasonType;
  week?: number;
  /** How many prior weeks to also refresh. Default 1 (current + last week). */
  lookbackWeeks?: number;
};

export type SleeperStatsSyncResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  season: number | null;
  seasonType: SleeperSeasonType | null;
  weeks: number[];
  perWeek: Array<{ week: number; entries: number; matched: number }>;
  totalRows: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export async function runSleeperStatsSync(
  supabase: SupabaseClient<Database>,
  opts: SleeperStatsSyncOptions = {},
): Promise<SleeperStatsSyncResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const lookback = opts.lookbackWeeks ?? 1;

  const skipResult = (
    reason: string,
    season: number | null,
  ): SleeperStatsSyncResult => {
    const finished = Date.now();
    return {
      ok: true,
      skipped: true,
      reason,
      season,
      seasonType: null,
      weeks: [],
      perWeek: [],
      totalRows: 0,
      startedAt,
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
    };
  };

  // Resolve season / season_type / week from explicit opts or live state.
  let season = opts.season ?? null;
  let seasonTypeRaw: string | null = opts.seasonType ?? null;
  let week = opts.week ?? null;

  if (season === null || seasonTypeRaw === null || week === null) {
    const state = await getNflState();
    if (!state) {
      throw new Error("runSleeperStatsSync: could not fetch Sleeper NFL state.");
    }
    season = season ?? Number.parseInt(state.season, 10);
    seasonTypeRaw = seasonTypeRaw ?? state.season_type;
    week = week ?? state.week;
  }

  // Off-season (or any non-stat phase): exit before hitting stats endpoints.
  if (!VALID_SEASON_TYPES.includes(seasonTypeRaw as SleeperSeasonType)) {
    return skipResult(`offseason (season_type=${seasonTypeRaw})`, season);
  }
  const seasonType = seasonTypeRaw as SleeperSeasonType;

  // Current week + `lookback` prior weeks, floored at 1, deduped.
  const weeks: number[] = [];
  for (let i = 0; i <= lookback; i++) {
    const w = week - i;
    if (w >= 1 && !weeks.includes(w)) weeks.push(w);
  }
  if (weeks.length === 0) {
    return skipResult(`no playable week yet (state week=${week})`, season);
  }

  const idBySleeper = await loadSleeperIdMap(supabase);
  const now = new Date().toISOString();
  const perWeek: SleeperStatsSyncResult["perWeek"] = [];
  let totalRows = 0;

  for (const w of weeks) {
    const entries = await getWeeklyStats(seasonType, season, w);
    const rows: StatInsert[] = [];
    for (const { sleeperId, payload } of entries) {
      const playerId = idBySleeper.get(sleeperId);
      if (!playerId) continue;
      const mapped = mapStatPayloadToRow(payload as Record<string, unknown>);
      rows.push({
        player_id: playerId,
        week: w,
        season,
        season_type: seasonType,
        metadata: payload as StatMetadata,
        updated_at: now,
        ...mapped,
      } as StatInsert);
    }

    for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
      const chunk = rows.slice(i, i + UPSERT_BATCH_SIZE);
      await withRetry(
        async () => {
          const { error } = await supabase
            .from("player_stats")
            .upsert(chunk, {
              onConflict: "player_id,week,season,season_type",
              ignoreDuplicates: false,
            });
          if (error) throw error;
        },
        { label: `player_stats upsert ${season} ${seasonType} wk${w}` },
      );
    }

    totalRows += rows.length;
    perWeek.push({ week: w, entries: entries.length, matched: rows.length });
    console.log(
      `  ${season} ${seasonType} wk${w}: ${entries.length} entries, ${rows.length} matched rows upserted`,
    );
  }

  const finished = Date.now();
  return {
    ok: true,
    skipped: false,
    season,
    seasonType,
    weeks,
    perWeek,
    totalRows,
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
  };
}
