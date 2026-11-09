/**
 * Family 4, market_rank (plan 7.2, 31.2): a question across TWO of today's
 * boards for the site default source, which no single page on the site
 * shows. Two forms:
 *
 * - gap: inside the top N on board A and at least G spots lower on board B.
 * - diff: inside the top N on board A but outside the top M on board B.
 *
 * The source is named in the prompt because the reader's own header source
 * may differ. Only formats the default source supports are drawn; fewer than
 * two means the family is skipped for the day.
 */

import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { shuffle } from "../random";
import { ELIGIBLE_POSITIONS } from "../types";
import { MAX_DRAWS } from "./shared";
import type { Client, GenerationContext, TemplateFamily, TemplateParams } from "./types";

export const MARKET_FORMATS = ["dynasty-ppr-sflex", "dynasty-ppr-std", "redraft-ppr-std"] as const;
const INSIDE = [40, 60];
const GAPS = [15, 25, 40];
const OUTSIDE = [80, 120];

export function marketFormats(ctx: GenerationContext): string[] {
  const known = new Set(ctx.formats.map((f) => f.slug));
  return MARKET_FORMATS.filter(
    (slug) => known.has(slug) && (ctx.defaultSourceFormats === null || ctx.defaultSourceFormats.includes(slug)),
  );
}

/** Pure: the answer ids for either form from two rank maps (player id to overall rank). */
export function marketAnswers(
  params: TemplateParams,
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): string[] {
  const inside = Number(params.inside);
  const out: string[] = [];
  for (const [id, rankA] of a) {
    if (rankA > inside) continue;
    const rankB = b.get(id);
    if (params.form === "gap") {
      if (rankB !== undefined && rankB - rankA >= Number(params.gap)) out.push(id);
    } else if (rankB === undefined || rankB > Number(params.outside)) {
      out.push(id);
    }
  }
  return out;
}

async function latestRanks(admin: Client, formatId: string, source: string): Promise<Map<string, number>> {
  const { data: latest, error } = await admin
    .from("rankings")
    .select("generated_at")
    .eq("format_config_id", formatId)
    .eq("source", source)
    .order("generated_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`market_rank latest read failed: ${error.message}`);
  const generatedAt = latest?.[0]?.generated_at;
  const out = new Map<string, number>();
  if (!generatedAt) return out;
  const rows = await fetchAllRows<{ player_id: string; overall_rank: number }>("long shot market rank", (from, to) =>
    admin
      .from("rankings")
      .select("player_id, overall_rank, players!inner(position)")
      .eq("format_config_id", formatId)
      .eq("source", source)
      .eq("generated_at", generatedAt)
      .lte("overall_rank", 400)
      .in("players.position", [...ELIGIBLE_POSITIONS])
      .order("id", { ascending: true })
      .range(from, to),
  );
  for (const r of rows) out.set(r.player_id, r.overall_rank);
  return out;
}

export const marketRank: TemplateFamily = {
  key: "market_rank",
  enabledByDefault: true,
  source: "market",
  draws(rng, ctx) {
    if (!ctx.defaultSource) return [];
    const formats = marketFormats(ctx);
    if (formats.length < 2) return [];
    const all: TemplateParams[] = [];
    for (const a of formats)
      for (const b of formats) {
        if (a === b) continue;
        for (const inside of INSIDE) {
          for (const gap of GAPS) all.push({ form: "gap", a, b, inside, gap });
          for (const outside of OUTSIDE) if (outside > inside) all.push({ form: "diff", a, b, inside, outside });
        }
      }
    return shuffle(all, rng).slice(0, MAX_DRAWS);
  },
  text(params, ctx) {
    const name = (slug: unknown) => ctx.formats.find((f) => f.slug === slug)?.display_name ?? String(slug);
    const source = ctx.defaultSource?.display ?? "FF Beacon";
    const lead = `Name a player inside the top ${Number(params.inside)} on today's ${source} ${name(params.a)} board`;
    return params.form === "gap"
      ? `${lead} who sits at least ${Number(params.gap)} spots lower on the ${name(params.b)} board.`
      : `${lead} but outside the top ${Number(params.outside)} on the ${name(params.b)} board.`;
  },
  async answers(admin, params, ctx) {
    const a = ctx.formats.find((f) => f.slug === params.a);
    const b = ctx.formats.find((f) => f.slug === params.b);
    if (!a || !b || !ctx.defaultSource) return [];
    const [ranksA, ranksB] = await Promise.all([
      latestRanks(admin, a.id, ctx.defaultSource.slug),
      latestRanks(admin, b.id, ctx.defaultSource.slug),
    ]);
    return marketAnswers(params, ranksA, ranksB);
  },
};
