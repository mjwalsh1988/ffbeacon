/**
 * Sleeper draft-market sync (library form): nightly ADP + season projections.
 *
 * Shared by the Vercel cron endpoint (app/api/cron/sync-sleeper-market) and the
 * CLI (scripts/sync-sleeper-market.ts). One Sleeper call pulls the season-long
 * projections payload (which carries ADP for every format Sleeper publishes),
 * and one snapshot partition per calendar date lands in player_market_snapshots.
 *
 * Historical preservation: each night INSERTS a new snapshot_date partition.
 * Prior dates are never touched, so we can always answer "what was this
 * player's Sleeper ADP on <date>?". Re-running on the same date is idempotent:
 * the upsert's unique key (source, season_type, season, sleeper_player_id,
 * snapshot_date) updates that date's rows in place instead of duplicating.
 *
 * Row filter: Sleeper returns ~3300 players, most of which carry neither a real
 * ADP (999 is the "no data" sentinel) nor a points projection. Only rows with at
 * least one real ADP value or a projection are stored, so a nightly partition is
 * roughly 600-800 rows, not 3300 rows of sentinels. The FULL raw source object is
 * preserved per stored row in `metadata` (audit / backfill / diagnosis).
 *
 * Failure posture (per project conventions): this is a real API, not a scraper,
 * so shape oddities are logged rather than fatal, but a ZERO-row write is always
 * a thrown error (an empty payload means the endpoint moved or broke, and a
 * silent empty night would poison the "closest snapshot" historical lookups).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";
import {
  currentNflSeason,
  getNflState,
  getSleeperSeasonProjections,
  type SleeperSeasonProjection,
  type SleeperSeasonType,
} from "./sleeper";
import { loadSleeperIdMap } from "./sync-sleeper-stats";
import { withRetry } from "./supabase/retry";

type MarketInsert = Database["public"]["Tables"]["player_market_snapshots"]["Insert"];

const UPSERT_BATCH_SIZE = 500;

/** Sleeper's "no ADP data" sentinel. Anything at or above this is not a real ADP. */
export const SLEEPER_ADP_SENTINEL = 999;

export const MARKET_SOURCE_SLUG = "sleeper";

/**
 * Normalize the raw stats map into the stored ADP map: adp_* keys with the
 * prefix stripped, keeping only finite positive values below the sentinel.
 */
export function extractAdpMap(stats: Record<string, number> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!stats) return out;
  for (const [key, value] of Object.entries(stats)) {
    if (!key.startsWith("adp_")) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (value <= 0 || value >= SLEEPER_ADP_SENTINEL) continue;
    out[key.slice(4)] = value;
  }
  return out;
}

function readPts(stats: Record<string, number> | null | undefined, key: string): number | null {
  const v = stats?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export type SleeperMarketSyncOptions = {
  /** NFL season to pull. Defaults to Sleeper's live league_season. */
  season?: number;
  seasonType?: SleeperSeasonType;
  /** Snapshot date (YYYY-MM-DD, UTC). Defaults to today. Exposed for tests. */
  snapshotDate?: string;
};

export type SleeperMarketSyncResult = {
  ok: boolean;
  source: string;
  season: number;
  seasonType: SleeperSeasonType;
  snapshotDate: string;
  fetched: number;
  stored: number;
  withAdp: number;
  withProjection: number;
  matchedPlayers: number;
  unmatchedPlayers: number;
  adpFormatCounts: Record<string, number>;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

/** True when the row carries any signal worth storing. */
function isStorableRow(row: SleeperSeasonProjection, adp: Record<string, number>): boolean {
  if (Object.keys(adp).length > 0) return true;
  return (
    readPts(row.stats, "pts_ppr") !== null ||
    readPts(row.stats, "pts_half_ppr") !== null ||
    readPts(row.stats, "pts_std") !== null
  );
}

export async function runSleeperMarketSync(
  supabase: SupabaseClient<Database>,
  opts: SleeperMarketSyncOptions = {},
): Promise<SleeperMarketSyncResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const seasonType: SleeperSeasonType = opts.seasonType ?? "regular";

  // Resolve the season from Sleeper's live state (league_season is the season the
  // app itself is operating in, which is what drafts run against). Falls back to
  // the calendar-derived season when the state endpoint is unreachable.
  let season = opts.season ?? null;
  if (season === null) {
    const state = await getNflState();
    const fromState = Number(state?.league_season ?? state?.season);
    season = Number.isFinite(fromState) && fromState > 2000 ? fromState : Number(currentNflSeason());
  }

  const snapshotDate = opts.snapshotDate ?? new Date().toISOString().slice(0, 10);

  const rows = await getSleeperSeasonProjections(String(season), seasonType);
  if (rows.length === 0) {
    throw new Error(
      `runSleeperMarketSync: Sleeper projections endpoint returned no rows for ${season} ${seasonType}.`,
    );
  }

  // Sleeper-id -> players.id, one paginated read (same map the stats sync uses).
  const idBySleeper = await loadSleeperIdMap(supabase);

  const nowIso = new Date().toISOString();
  const inserts: MarketInsert[] = [];
  const adpFormatCounts: Record<string, number> = {};
  let withAdp = 0;
  let withProjection = 0;
  let matchedPlayers = 0;

  for (const row of rows) {
    const sleeperId = typeof row.player_id === "string" ? row.player_id.trim() : "";
    if (!sleeperId || sleeperId === "0") continue;

    const adp = extractAdpMap(row.stats);
    if (!isStorableRow(row, adp)) continue;

    const adpKeys = Object.keys(adp);
    if (adpKeys.length > 0) {
      withAdp += 1;
      for (const k of adpKeys) adpFormatCounts[k] = (adpFormatCounts[k] ?? 0) + 1;
    }
    const ptsPpr = readPts(row.stats, "pts_ppr");
    const ptsHalf = readPts(row.stats, "pts_half_ppr");
    const ptsStd = readPts(row.stats, "pts_std");
    if (ptsPpr !== null || ptsHalf !== null || ptsStd !== null) withProjection += 1;

    const playerId = idBySleeper.get(sleeperId) ?? null;
    if (playerId) matchedPlayers += 1;

    inserts.push({
      source: MARKET_SOURCE_SLUG,
      season,
      season_type: seasonType,
      snapshot_date: snapshotDate,
      sleeper_player_id: sleeperId,
      player_id: playerId,
      adp: adp as unknown as Json,
      projected_pts_ppr: ptsPpr,
      projected_pts_half_ppr: ptsHalf,
      projected_pts_std: ptsStd,
      metadata: row as unknown as Json,
      updated_at: nowIso,
    });
  }

  if (inserts.length === 0) {
    throw new Error(
      `runSleeperMarketSync: ${rows.length} rows fetched but none carried ADP or projections. Refusing to write an empty snapshot.`,
    );
  }
  if (withAdp === 0) {
    throw new Error(
      `runSleeperMarketSync: no row carried a real ADP value (all sentinels). The ADP payload shape may have changed; refusing to write.`,
    );
  }

  for (let i = 0; i < inserts.length; i += UPSERT_BATCH_SIZE) {
    const chunk = inserts.slice(i, i + UPSERT_BATCH_SIZE);
    await withRetry(
      async () => {
        const { error } = await supabase
          .from("player_market_snapshots")
          .upsert(chunk, { onConflict: "source,season_type,season,sleeper_player_id,snapshot_date" });
        if (error) throw error;
      },
      { label: `player_market_snapshots upsert ${i}` },
    );
  }

  const unmatchedPlayers = inserts.length - matchedPlayers;
  if (unmatchedPlayers > 0) {
    console.warn(
      `[sync-sleeper-market] ${unmatchedPlayers} of ${inserts.length} stored rows have no players match (kept with player_id null).`,
    );
  }

  const finished = Date.now();
  return {
    ok: true,
    source: MARKET_SOURCE_SLUG,
    season,
    seasonType,
    snapshotDate,
    fetched: rows.length,
    stored: inserts.length,
    withAdp,
    withProjection,
    matchedPlayers,
    unmatchedPlayers,
    adpFormatCounts,
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
  };
}
