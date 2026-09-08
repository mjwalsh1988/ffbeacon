import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { withRetry } from "@/lib/supabase/retry";

/**
 * Rebuild `player_market_latest` for one source partition.
 *
 * `player_market_latest` used to be a view that recomputed "the newest snapshot
 * per player" with a DISTINCT ON sort over the whole 109k row snapshots table on
 * every read: a sequential scan, then an external merge sort spilling 16 MB to
 * disk, 1,330 ms per call (site-speed-audit-and-plan.md, 4.6). It is a real
 * table now, and something has to keep it current.
 *
 * TWO WRITERS, TWO STRATEGIES, AND THE DIFFERENCE IS NOT AN INCONSISTENCY.
 *
 * `lib/sync-sleeper-market.ts` writes today's date for every row it touches, so
 * the batch it just built IS the newest snapshot for each of its keys by
 * definition. It upserts that batch straight across and reads nothing back,
 * which is the cheaper path over its 3,138 players.
 *
 * `lib/sync-rookie-adp.ts` writes whatever `snapshot_date` the scrape carries,
 * which can be a historical date, and it can be re-run over an older file. An
 * unconditional upsert there would overwrite a newer row with an older one and
 * quietly move a player's ADP backwards. So that caller uses this function,
 * which asks the snapshots table which row actually is newest and writes that.
 * Its partition is 497 players, so the read-back is cheap and the answer is
 * right whatever order the scrapes arrive in.
 */

type ServiceClient = SupabaseClient<Database>;
type LatestInsert =
  Database["public"]["Tables"]["player_market_latest"]["Insert"];

const UPSERT_BATCH_SIZE = 500;

/** PostgREST caps an unbounded select at 1,000 rows. Page past it explicitly. */
const PAGE = 1000;

export async function refreshMarketLatest(
  supabase: ServiceClient,
  opts: { source: string; seasonType: string },
): Promise<{ written: number }> {
  const { source, seasonType } = opts;

  const rows: LatestInsert[] = [];
  const seen = new Set<string>();
  const nowIso = new Date().toISOString();

  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await withRetry(
      async () => {
        const result = await supabase
          .from("player_market_snapshots")
          .select(
            "sleeper_player_id, player_id, season, snapshot_date, adp, projected_pts_ppr, projected_pts_half_ppr, projected_pts_std",
          )
          .eq("source", source)
          .eq("season_type", seasonType)
          // Newest first, so the first row seen for a player is the one to keep.
          .order("snapshot_date", { ascending: false })
          .range(offset, offset + PAGE - 1);
        if (result.error) throw result.error;
        return result;
      },
      { label: `player_market_snapshots read ${source} ${offset}` },
    );
    if (error) throw error;
    const page = data ?? [];
    for (const row of page) {
      if (seen.has(row.sleeper_player_id)) continue;
      seen.add(row.sleeper_player_id);
      rows.push({
        source,
        season_type: seasonType,
        season: row.season,
        snapshot_date: row.snapshot_date,
        sleeper_player_id: row.sleeper_player_id,
        player_id: row.player_id,
        adp: row.adp,
        projected_pts_ppr: row.projected_pts_ppr,
        projected_pts_half_ppr: row.projected_pts_half_ppr,
        projected_pts_std: row.projected_pts_std,
        updated_at: nowIso,
      });
    }
    if (page.length < PAGE) break;
  }

  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_BATCH_SIZE);
    await withRetry(
      async () => {
        const { error: upsertErr } = await supabase
          .from("player_market_latest")
          .upsert(chunk, { onConflict: "source,season_type,sleeper_player_id" });
        if (upsertErr) throw upsertErr;
      },
      { label: `player_market_latest upsert ${source} ${i}` },
    );
  }

  return { written: rows.length };
}
