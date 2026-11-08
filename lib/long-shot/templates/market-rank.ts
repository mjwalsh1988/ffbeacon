/**
 * Family 4, market_rank (plan 7.2): ranked inside the top N on today's board
 * for the SITE DEFAULT source and a drawn format. The source is named in the
 * prompt because the reader's own header source may differ.
 *
 * Only formats the default source supports are drawn; none means the family
 * is skipped for the day.
 */

import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { pick } from "../random";
import { ELIGIBLE_POSITIONS } from "../types";
import { distinct } from "./shared";
import type { GenerationContext, TemplateFamily } from "./types";

export const MARKET_FORMATS = ["dynasty-ppr-sflex", "dynasty-ppr-std", "redraft-ppr-std"] as const;
const CUTOFFS = [24, 50, 100];

export function marketFormats(ctx: GenerationContext): string[] {
  const known = new Set(ctx.formats.map((f) => f.slug));
  return MARKET_FORMATS.filter(
    (slug) => known.has(slug) && (ctx.defaultSourceFormats === null || ctx.defaultSourceFormats.includes(slug)),
  );
}

export const marketRank: TemplateFamily = {
  key: "market_rank",
  enabledByDefault: true,
  draw(rng, ctx) {
    if (!ctx.defaultSource) return null;
    const formats = marketFormats(ctx);
    if (formats.length === 0) return null;
    return { format: pick(formats, rng), cutoff: pick(CUTOFFS, rng) };
  },
  text(params, ctx) {
    const format = ctx.formats.find((f) => f.slug === params.format)?.display_name ?? String(params.format);
    const source = ctx.defaultSource?.display ?? "FF Beacon";
    return `Name a player ranked inside the top ${Number(params.cutoff)} on today's ${source} ${format} board.`;
  },
  async answers(admin, params, ctx) {
    const format = ctx.formats.find((f) => f.slug === params.format);
    if (!format || !ctx.defaultSource) return [];
    const { data: latest, error } = await admin
      .from("rankings")
      .select("generated_at")
      .eq("format_config_id", format.id)
      .eq("source", ctx.defaultSource.slug)
      .order("generated_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(`market_rank latest read failed: ${error.message}`);
    const generatedAt = latest?.[0]?.generated_at;
    if (!generatedAt) return [];
    const rows = await fetchAllRows<{ player_id: string }>("long shot market rank", (from, to) =>
      admin
        .from("rankings")
        .select("player_id, players!inner(position)")
        .eq("format_config_id", format.id)
        .eq("source", ctx.defaultSource!.slug)
        .eq("generated_at", generatedAt)
        .lte("overall_rank", Number(params.cutoff))
        .in("players.position", [...ELIGIBLE_POSITIONS])
        .order("id", { ascending: true })
        .range(from, to),
    );
    return distinct(rows.map((r) => r.player_id));
  },
};
