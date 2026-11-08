/**
 * Helpers shared by the template families. The season draw and phrase are
 * here so families 1 and 2 cannot disagree about what "the current season"
 * means.
 */

import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { pick } from "../random";
import type { Client, GenerationContext } from "./types";

/** Prior seasons only: every season but the current one. */
export function priorSeasons(ctx: GenerationContext): number[] {
  return ctx.seasons.filter((s) => s !== ctx.season);
}

/**
 * 50 percent the current season when it has a completed week, 50 percent
 * uniform over prior seasons; with no completed week, uniform over prior.
 */
export function drawStatSeason(rng: () => number, ctx: GenerationContext): number {
  const prior = priorSeasons(ctx);
  const currentEligible = ctx.completedWeek !== null;
  if (prior.length === 0) return ctx.season;
  if (currentEligible && rng() < 0.5) return ctx.season;
  return pick(prior, rng);
}

export function seasonPhrase(season: number, ctx: GenerationContext): string {
  return season === ctx.season ? "in the current season" : `in the ${season} season`;
}

/** Distinct, in first-seen order. */
export function distinct(ids: Iterable<string>): string[] {
  return Array.from(new Set(ids));
}

export interface StatFilter {
  col: string;
  min: number;
}

/** Any query builder supporting the filters the stat families apply. */
interface StatsBuilder {
  gte(col: string, v: number): StatsBuilder;
  or(expr: string): StatsBuilder;
  eq(col: string, v: string | number): StatsBuilder;
  order(col: string, o: { ascending: boolean }): StatsBuilder;
  range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
}

/**
 * Distinct player ids from one season of regular-season player_stats at one
 * position, with every `all` filter true and at least one `any` filter true.
 * Ordered on the unique id and paged, so the walk uses
 * idx_player_stats_season_id and cannot repeat a row.
 */
export async function statLinePlayers(
  admin: Client,
  opts: { season: number; position: string; all: StatFilter[]; any?: StatFilter[]; opponent?: string },
): Promise<string[]> {
  const rows = await fetchAllRows<{ player_id: string }>("long shot stat line", (from, to) => {
    let q = admin
      .from("player_stats")
      .select("player_id, players!inner(position)")
      .eq("season", opts.season)
      .eq("season_type", "regular")
      .eq("players.position", opts.position) as unknown as StatsBuilder;
    for (const f of opts.all) q = q.gte(f.col, f.min);
    if (opts.any && opts.any.length > 0) q = q.or(opts.any.map((f) => `${f.col}.gte.${f.min}`).join(","));
    if (opts.opponent) q = q.eq("opponent", opts.opponent);
    return q.order("id", { ascending: true }).range(from, to) as PromiseLike<{
      data: { player_id: string }[] | null;
      error: { message: string } | null;
    }>;
  });
  return distinct(rows.map((r) => r.player_id));
}
