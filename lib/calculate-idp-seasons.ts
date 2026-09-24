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
  }

  return { seasons, weekRows, rows: written };
}
