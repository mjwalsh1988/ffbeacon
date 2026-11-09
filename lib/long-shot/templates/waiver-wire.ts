/**
 * Family 6, waiver_wire (plan 7.2, 31.1): a player rostered in under 25 or 50
 * percent of our redraft leagues who scored at least 10, 12, 15 or 20 PPR
 * points in any of the last one, two or three completed weeks. A player with
 * no roster-rate row counts as rate 0. Skipped in the offseason (no completed
 * week) and when no roster-rate season qualifies.
 */

import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { loadRosterRates } from "../rates";
import { ELIGIBLE_POSITIONS } from "../types";
import { distinct, grid } from "./shared";
import type { TemplateFamily, TemplateParams } from "./types";

const CEILINGS = [0.25, 0.5];
const FLOORS = [10, 12, 15, 20];
const SPANS = [1, 2, 3];

/** Pure: keep ids whose rate (absent means 0) is under the ceiling. */
export function underCeiling(ids: readonly string[], rates: ReadonlyMap<string, number>, ceiling: number): string[] {
  return ids.filter((id) => (rates.get(id) ?? 0) < ceiling);
}

/** Pure: the weeks a draw covers, oldest first. */
export function weeksOf(params: TemplateParams): number[] {
  const last = Number(params.week);
  const span = Math.min(Number(params.span), last);
  return Array.from({ length: span }, (_, i) => last - span + 1 + i);
}

export const waiverWire: TemplateFamily = {
  key: "waiver_wire",
  enabledByDefault: true,
  source: "leagues",
  draws(rng, ctx) {
    if (ctx.completedWeek === null || ctx.rateSeason === null) return [];
    return grid(rng, { ceiling: CEILINGS, floor: FLOORS, span: SPANS, week: [ctx.completedWeek] });
  },
  text(params) {
    const pct = Math.round(Number(params.ceiling) * 100);
    const weeks = weeksOf(params);
    const when = weeks.length === 1 ? `in week ${weeks[0]}` : `in any week from ${weeks[0]} to ${weeks[weeks.length - 1]}`;
    return `Name a player rostered in under ${pct} percent of our redraft leagues who scored ${Number(params.floor)} or more PPR points ${when}.`;
  },
  async answers(admin, params, ctx) {
    const rows = await fetchAllRows<{ player_id: string }>("long shot waiver wire", (from, to) =>
      admin
        .from("player_stats")
        .select("player_id, players!inner(position)")
        .eq("season", ctx.season)
        .eq("season_type", "regular")
        .in("week", weeksOf(params))
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
