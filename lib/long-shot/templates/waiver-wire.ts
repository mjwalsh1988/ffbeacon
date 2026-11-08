/**
 * Family 6, waiver_wire (plan 7.2): a player rostered in under 25 or 50
 * percent of our redraft leagues who scored at least 12, 15 or 20 PPR points
 * in the most recent completed week. A player with no roster-rate row counts
 * as rate 0. Skipped in the offseason (no completed week) and when no
 * roster-rate season qualifies.
 */

import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { pick } from "../random";
import { loadRosterRates } from "../rates";
import { ELIGIBLE_POSITIONS } from "../types";
import { distinct } from "./shared";
import type { TemplateFamily } from "./types";

const CEILINGS = [0.25, 0.5];
const FLOORS = [12, 15, 20];

/** Pure: keep ids whose rate (absent means 0) is under the ceiling. */
export function underCeiling(ids: readonly string[], rates: ReadonlyMap<string, number>, ceiling: number): string[] {
  return ids.filter((id) => (rates.get(id) ?? 0) < ceiling);
}

export const waiverWire: TemplateFamily = {
  key: "waiver_wire",
  enabledByDefault: true,
  draw(rng, ctx) {
    if (ctx.completedWeek === null || ctx.rateSeason === null) return null;
    return { ceiling: pick(CEILINGS, rng), floor: pick(FLOORS, rng), week: ctx.completedWeek };
  },
  text(params) {
    const pct = Math.round(Number(params.ceiling) * 100);
    return `Name a player rostered in under ${pct} percent of our redraft leagues who scored ${Number(params.floor)} or more PPR points in week ${Number(params.week)}.`;
  },
  async answers(admin, params, ctx) {
    const rows = await fetchAllRows<{ player_id: string }>("long shot waiver wire", (from, to) =>
      admin
        .from("player_stats")
        .select("player_id, players!inner(position)")
        .eq("season", ctx.season)
        .eq("season_type", "regular")
        .eq("week", Number(params.week))
        .gte("pts_ppr", Number(params.floor))
        .in("players.position", [...ELIGIBLE_POSITIONS])
        .order("id", { ascending: true })
        .range(from, to),
    );
    const ids = distinct(rows.map((r) => r.player_id));
    const rates = await loadRosterRates(admin, ctx.rateSeason, ids);
    return underCeiling(ids, rates, Number(params.ceiling));
  },
};
