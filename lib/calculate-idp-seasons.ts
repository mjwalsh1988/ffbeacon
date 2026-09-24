/**
 * Rebuild player_idp_seasons (migration 0299) from the typed player_stats
 * columns (plan IDP-117).
 *
 * Chained into the nightly stats cron for the CURRENT season, because that job
 * is the one moment its input changes (lib/derived-tables-scheduled.test.ts
 * holds that). Prior seasons are built once with
 * `npm run calculate:idp-seasons -- --all`.
 *
 * Reads one (season, week) at a time on the partial index
 * idx_player_stats_def_weeks (def_snp is not null), keyset-paged by id, joined
 * to players for the primary position and the eligibility list. The pure
 * aggregation lives in lib/idp/seasons.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { aggregateIdpSeasons, type IdpWeekRow } from "./idp/seasons";
import { currentNflSeason } from "./sleeper";
import { withRetry } from "./supabase/retry";

type ServiceClient = SupabaseClient<Database>;

const PAGE = 1000;
const UPSERT_CHUNK = 500;
/** Every week number regular, post and preseason rows use. */
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);

const SELECT =
  "id, player_id, season, season_type, def_snp, tm_def_snp, def_snap_pct, idp_tkl, idp_tkl_solo, idp_tkl_ast, idp_tkl_loss, idp_sack, idp_sack_yd, idp_qb_hit, idp_int, idp_int_ret_yd, idp_pass_def, idp_pass_def_3p, idp_ff, idp_fum_rec, idp_fum_ret_yd, idp_def_td, idp_safe, idp_blk_kick, bonus_tkl_10p, bonus_sack_2p, players!inner(position, eligible_positions)";

export type IdpSeasonsResult = { seasons: number[]; weekRows: number; rows: number };

export async function runCalculateIdpSeasons(
  supabase: ServiceClient,
  opts: { seasons?: number[] } = {},
): Promise<IdpSeasonsResult> {
  const seasons = opts.seasons ?? [Number(currentNflSeason())];
  let weekRows = 0;
  let written = 0;

  for (const season of seasons) {
    const weeks: IdpWeekRow[] = [];
    for (const week of WEEKS) {
      let lastId = "";
      for (;;) {
        const data = await withRetry(
          async () => {
            let query = supabase
              .from("player_stats")
              .select(SELECT)
              .eq("season", season)
              .eq("week", week)
              .not("def_snp", "is", null)
              .in("players.position", ["DL", "LB", "DB"])
              .order("id", { ascending: true })
              .limit(PAGE);
            if (lastId) query = query.gt("id", lastId);
            const { data: rows, error } = await query;
            if (error) throw error;
            return rows ?? [];
          },
          { label: `idp seasons ${season} week ${week}` },
        );
        if (data.length === 0) break;
        lastId = data[data.length - 1].id;
        for (const row of data) {
          const player = Array.isArray(row.players) ? row.players[0] : row.players;
          if (!player) continue;
          const seasonType = row.season_type as IdpWeekRow["seasonType"];
          if (seasonType !== "regular" && seasonType !== "post" && seasonType !== "pre") continue;
          weeks.push({
            ...row,
            playerId: row.player_id,
            season: Number(row.season),
            seasonType,
            position: player.position,
            eligiblePositions: player.eligible_positions ?? [],
            defSnapPct: row.def_snap_pct,
          });
        }
        if (data.length < PAGE) break;
      }
    }
    weekRows += weeks.length;

    const computedAt = new Date().toISOString();
    const rows = aggregateIdpSeasons(weeks).map((r) => ({ ...r, computed_at: computedAt }));
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK);
      await withRetry(
        async () => {
          const { error } = await supabase
            .from("player_idp_seasons")
            .upsert(chunk, { onConflict: "player_id,season,season_type" });
          if (error) throw error;
        },
        { label: `player_idp_seasons upsert ${season} ${i}` },
      );
    }
    written += rows.length;

    // The upsert above cannot remove a row, so a player the players sync has
    // since relabelled (a DB now listed WR) would keep his old season here and
    // stay inside the search relevance gate (IDP-201). Skipped when the run
    // produced nothing: an empty read is far more likely a bad moment than a
    // season with no defenders, and pruning on it would empty the table.
    if (rows.length > 0) {
      await pruneUnproducedRows(supabase, season, rows, computedAt);
    }
  }

  return { seasons, weekRows, rows: written };
}

const PRUNE_DELETE_CHUNK = 100;

/**
 * Delete this season's rows whose (player, season type) this run did not
 * produce. Only KEYS the run did not produce are deleted, never a row merely
 * older than computedAt: two overlapping runs (a retried cron tick, or the CLI
 * during the cron) can each overwrite the other's rows, and a prune keyed on
 * the timestamp alone lets the later-stamped run delete every row the
 * earlier-stamped one rewrote after it, which empties the season. The
 * computed_at guard stays as a second condition so a row another run wrote
 * after this one started is left alone.
 *
 * A short or failed key read can only mean fewer deletions: a failure throws
 * before anything is deleted, and a key never seen is never deleted.
 */
async function pruneUnproducedRows(
  supabase: ServiceClient,
  season: number,
  produced: ReadonlyArray<{ player_id: string; season_type: string }>,
  computedAt: string,
): Promise<void> {
  const keep = new Set(produced.map((r) => `${r.player_id}|${r.season_type}`));
  const staleByType = new Map<string, string[]>();
  for (let from = 0; ; from += PAGE) {
    const pageFrom = from;
    const data = await withRetry(
      async () => {
        const { data: existing, error } = await supabase
          .from("player_idp_seasons")
          .select("player_id, season_type")
          .eq("season", season)
          .order("player_id", { ascending: true })
          .order("season_type", { ascending: true })
          .range(pageFrom, pageFrom + PAGE - 1);
        if (error) throw error;
        return existing ?? [];
      },
      { label: `player_idp_seasons prune read ${season} ${pageFrom}` },
    );
    for (const row of data) {
      if (keep.has(`${row.player_id}|${row.season_type}`)) continue;
      const list = staleByType.get(row.season_type) ?? [];
      list.push(row.player_id);
      staleByType.set(row.season_type, list);
    }
    if (data.length < PAGE) break;
  }

  for (const [seasonType, playerIds] of staleByType) {
    for (let i = 0; i < playerIds.length; i += PRUNE_DELETE_CHUNK) {
      const chunk = playerIds.slice(i, i + PRUNE_DELETE_CHUNK);
      await withRetry(
        async () => {
          const { error } = await supabase
            .from("player_idp_seasons")
            .delete()
            .eq("season", season)
            .eq("season_type", seasonType)
            .in("player_id", chunk)
            .lt("computed_at", computedAt);
          if (error) throw error;
        },
        { label: `player_idp_seasons prune ${season} ${seasonType} ${i}` },
      );
    }
  }
}
