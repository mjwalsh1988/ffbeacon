/**
 * Helpers shared by the template families. The season list and phrase are
 * here so the stat families cannot disagree about what "the current season"
 * means, and the draw helpers are here so every family lists its
 * parameterizations the same way (plan 31.1).
 */

import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { pick, shuffle } from "../random";
import type { Client, GenerationContext, TemplateParams } from "./types";

/** Most draws a family offers generate.ts for one day. */
export const MAX_DRAWS = 16;

/** Prior seasons only: every season but the current one. */
export function priorSeasons(ctx: GenerationContext): number[] {
  return ctx.seasons.filter((s) => s !== ctx.season);
}

/** Seasons a stat family may ask about: prior seasons, plus the current one once it has a completed week. */
export function statSeasons(ctx: GenerationContext): number[] {
  const prior = priorSeasons(ctx);
  return ctx.completedWeek !== null ? [...prior, ctx.season] : prior;
}

export function seasonPhrase(season: number, ctx: GenerationContext): string {
  return season === ctx.season ? "in the current season" : `in the ${season} season`;
}

/** Every combination of the option lists, in seeded random order, capped. */
export function grid(rng: () => number, options: Record<string, readonly (string | number | boolean)[]>): TemplateParams[] {
  let combos: TemplateParams[] = [{}];
  for (const [key, values] of Object.entries(options)) {
    const next: TemplateParams[] = [];
    for (const c of combos) for (const v of values) next.push({ ...c, [key]: v });
    combos = next;
  }
  return shuffle(combos, rng).slice(0, MAX_DRAWS);
}

/** An already built list of parameterizations, in seeded random order, capped. */
export function shuffleParams(rng: () => number, all: readonly TemplateParams[]): TemplateParams[] {
  return shuffle(all, rng).slice(0, MAX_DRAWS);
}

/** `count` distinct random draws from a generator, for grids too large to enumerate. */
export function sampleDraws(rng: () => number, count: number, draw: () => TemplateParams): TemplateParams[] {
  const seen = new Set<string>();
  const out: TemplateParams[] = [];
  for (let i = 0; i < count * 4 && out.length < count; i++) {
    const p = draw();
    const key = JSON.stringify(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export { pick };

/** The position a draw names, or null for "any player". */
export function positionOf(params: TemplateParams): string | null {
  const p = params.position;
  return typeof p === "string" && p !== "any" ? p : null;
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

/** The same line over several seasons, unioned. */
export async function statLinePlayersAcross(
  admin: Client,
  seasons: readonly number[],
  opts: { position: string; all: StatFilter[]; any?: StatFilter[]; opponent?: string },
): Promise<string[]> {
  const sets = await Promise.all(seasons.map((season) => statLinePlayers(admin, { ...opts, season })));
  return distinct(sets.flat());
}
