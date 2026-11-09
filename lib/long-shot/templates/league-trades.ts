/**
 * Family 7, league_trades (plan 7.2, 31.1): one of the 15 or 30 most traded
 * players across our leagues in the last 30 or 90 days, counted by the
 * long_shot_trade_counts RPC (service role only). Relative, not an absolute
 * floor, so the set scales with how many leagues we hold. Sleeper ids are
 * mapped to players.id through players.external_ids->>'sleeper'; unmapped
 * ids drop.
 */

import { ELIGIBLE_POSITIONS } from "../types";
import { distinct, grid } from "./shared";
import type { TemplateFamily } from "./types";

const WINDOWS = [30, 90];
const TOPS = [15, 30];
const CHUNK = 200;

/** Pure: the `top` most traded Sleeper ids, ties at the boundary included. */
export function mostTraded(rows: ReadonlyArray<{ sleeper_player_id: string; league_count: number }>, top: number): string[] {
  const sorted = rows.filter((r) => r.league_count > 0).slice().sort((a, b) => b.league_count - a.league_count);
  const floor = sorted[top - 1]?.league_count;
  if (floor === undefined) return sorted.map((r) => r.sleeper_player_id);
  return sorted.filter((r) => r.league_count >= floor).map((r) => r.sleeper_player_id);
}

export const leagueTrades: TemplateFamily = {
  key: "league_trades",
  enabledByDefault: true,
  source: "leagues",
  draws(rng) {
    return grid(rng, { days: WINDOWS, top: TOPS });
  },
  text(params) {
    return `Name one of the ${Number(params.top)} most traded players across our leagues in the last ${Number(params.days)} days.`;
  },
  async answers(admin, params, ctx) {
    const since = new Date(ctx.now.getTime() - Number(params.days) * 86_400_000).toISOString();
    const { data, error } = await admin.rpc("long_shot_trade_counts", { p_since: since });
    if (error) throw new Error(`league_trades rpc failed: ${error.message}`);
    const sleeperIds = mostTraded(data ?? [], Number(params.top));
    const out: string[] = [];
    for (let i = 0; i < sleeperIds.length; i += CHUNK) {
      const chunk = sleeperIds.slice(i, i + CHUNK);
      const { data: players, error: pErr } = await admin
        .from("players")
        .select("id")
        .in("external_ids->>sleeper", chunk)
        .in("position", [...ELIGIBLE_POSITIONS]);
      if (pErr) throw new Error(`league_trades player map failed: ${pErr.message}`);
      for (const p of players ?? []) out.push(p.id);
    }
    return distinct(out);
  },
};
