/**
 * Family 5, value_mover (plan 7.2): a player whose default-source dynasty
 * superflex value rose or fell at least 5 percent over 7 or 30 days, with at
 * least 7 data points and a current value of 1000 or more. Skipped for the
 * day when the default source does not cover dynasty-ppr-sflex; an empty
 * trends table fails the bounds and the family redraws elsewhere.
 */

import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { pick } from "../random";
import { ELIGIBLE_POSITIONS } from "../types";
import { distinct } from "./shared";
import type { GenerationContext, TemplateFamily } from "./types";

export const VALUE_FORMAT = "dynasty-ppr-sflex";
const MOVE_PCT = 5;
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
  draw(rng, ctx) {
    if (!covered(ctx)) return null;
    return { direction: pick(["up", "down"], rng), window: pick(["7d", "30d"], rng) };
  },
  text(params, ctx) {
    const source = ctx.defaultSource?.display ?? "FF Beacon";
    const verb = params.direction === "up" ? "rose" : "fell";
    const days = params.window === "7d" ? 7 : 30;
    return `Name a player whose ${source} dynasty superflex value ${verb} over the last ${days} days.`;
  },
  async answers(admin, params, ctx) {
    const format = ctx.formats.find((f) => f.slug === VALUE_FORMAT);
    if (!format || !ctx.defaultSource) return [];
    const col = params.window === "7d" ? "change_7d_pct" : "change_30d_pct";
    const rows = await fetchAllRows<{ player_id: string }>("long shot value mover", (from, to) => {
      const q = admin
        .from("player_value_trends")
        .select("player_id, players!inner(position)")
        .eq("format_config_id", format.id)
        .eq("source", ctx.defaultSource!.slug)
        .gte("data_points_30d", MIN_POINTS)
        .gte("current_value", MIN_VALUE)
        .in("players.position", [...ELIGIBLE_POSITIONS]);
      const moved = params.direction === "up" ? q.gte(col, MOVE_PCT) : q.lte(col, -MOVE_PCT);
      return moved.order("id", { ascending: true }).range(from, to);
    });
    return distinct(rows.map((r) => r.player_id));
  },
};
