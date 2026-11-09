/**
 * Family 5, value_mover (plan 7.2, 31.1): a player whose default-source
 * dynasty superflex value rose or fell at least 10 or 15 percent over 7 or 30
 * days, at one position or any, with at least 7 data points and a current
 * value of 1000 or more. Skipped for the day when the default source does
 * not cover dynasty-ppr-sflex; an empty trends table fails the bounds.
 */

import { positionNoun } from "@/lib/site";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { ELIGIBLE_POSITIONS } from "../types";
import { distinct, grid, positionOf } from "./shared";
import type { GenerationContext, TemplateFamily } from "./types";

export const VALUE_FORMAT = "dynasty-ppr-sflex";
const MOVES = [10, 15];
const MIN_POINTS = 7;
const MIN_VALUE = 1000;

function covered(ctx: GenerationContext): boolean {
  if (!ctx.defaultSource) return false;
  if (!ctx.formats.some((f) => f.slug === VALUE_FORMAT)) return false;
  return ctx.defaultSourceFormats === null || ctx.defaultSourceFormats.includes(VALUE_FORMAT);
}

export const valueMover: TemplateFamily = {
  key: "value_mover",
  enabledByDefault: true,
  source: "market",
  draws(rng, ctx) {
    if (!covered(ctx)) return [];
    return grid(rng, {
      direction: ["up", "down"],
      window: ["7d", "30d"],
      move: MOVES,
      position: ["any", ...ELIGIBLE_POSITIONS],
    });
  },
  position: positionOf,
  text(params, ctx) {
    const source = ctx.defaultSource?.display ?? "FF Beacon";
    const verb = params.direction === "up" ? "rose" : "fell";
    const days = params.window === "7d" ? 7 : 30;
    const who = positionOf(params) ? `a ${positionNoun(String(params.position))}` : "a player";
    return `Name ${who} whose ${source} dynasty superflex value ${verb} at least ${Number(params.move)} percent over the last ${days} days.`;
  },
  async answers(admin, params, ctx) {
    const format = ctx.formats.find((f) => f.slug === VALUE_FORMAT);
    if (!format || !ctx.defaultSource) return [];
    const col = params.window === "7d" ? "change_7d_pct" : "change_30d_pct";
    const positions = positionOf(params) ? [String(params.position)] : [...ELIGIBLE_POSITIONS];
    const rows = await fetchAllRows<{ player_id: string }>("long shot value mover", (from, to) => {
      const q = admin
        .from("player_value_trends")
        .select("player_id, players!inner(position)")
        .eq("format_config_id", format.id)
        .eq("source", ctx.defaultSource!.slug)
        .gte("data_points_30d", MIN_POINTS)
        .gte("current_value", MIN_VALUE)
        .in("players.position", positions);
      const move = Number(params.move);
      const moved = params.direction === "up" ? q.gte(col, move) : q.lte(col, -move);
      return moved.order("id", { ascending: true }).range(from, to);
    });
    return distinct(rows.map((r) => r.player_id));
  },
};
