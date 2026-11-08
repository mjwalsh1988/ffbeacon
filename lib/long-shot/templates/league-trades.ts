/**
 * Family 7, league_trades (plan 7.2): a player traded in more than 25, 50 or
 * 100 of our leagues in the last 30 or 90 days, counted by the
 * long_shot_trade_counts RPC (service role only). Sleeper ids are mapped to
 * players.id through players.external_ids->>'sleeper'; unmapped ids drop.
 */

import { pick } from "../random";
import { ELIGIBLE_POSITIONS } from "../types";
import { distinct } from "./shared";
import type { TemplateFamily } from "./types";

const WINDOWS = [30, 90];
const FLOORS = [25, 50, 100];
const CHUNK = 200;

/** Pure: Sleeper ids traded in more than `floor` leagues. */
export function overFloor(rows: ReadonlyArray<{ sleeper_player_id: string; league_count: number }>, floor: number): string[] {
  return rows.filter((r) => r.league_count > floor).map((r) => r.sleeper_player_id);
}

export const leagueTrades: TemplateFamily = {
  key: "league_trades",
  enabledByDefault: true,
  draw(rng) {
    return { days: pick(WINDOWS, rng), floor: pick(FLOORS, rng) };
  },
  text(params) {
    return `Name a player traded in more than ${Number(params.floor)} of our leagues in the last ${Number(params.days)} days.`;
  },
  async answers(admin, params, ctx) {
    const since = new Date(ctx.now.getTime() - Number(params.days) * 86_400_000).toISOString();
    const { data, error } = await admin.rpc("long_shot_trade_counts", { p_since: since });
    if (error) throw new Error(`league_trades rpc failed: ${error.message}`);
    const sleeperIds = overFloor(data ?? [], Number(params.floor));
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
