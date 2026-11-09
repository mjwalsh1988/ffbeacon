/**
 * Family 3, season_finish (plan 7.2): a top-N PPR positional finish in one
 * prior season, or in any season since 2020. The current season has no
 * finish until it ends, so it is never drawn. The union is offered only with
 * cutoff 5 or 12; the cutoff-24 union exceeds the answer bound at every
 * position.
 */

import { positionNoun } from "@/lib/site";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { shuffle } from "../random";
import { ELIGIBLE_POSITIONS, STATS_FLOOR_SEASON } from "../types";
import { MAX_DRAWS, distinct, positionOf, priorSeasons } from "./shared";
import type { TemplateFamily, TemplateParams } from "./types";

const CUTOFFS: Record<string, number[]> = { QB: [5, 12, 24], RB: [5, 12, 24], WR: [5, 12, 24], TE: [5, 12] };

export const seasonFinish: TemplateFamily = {
  key: "season_finish",
  enabledByDefault: true,
  source: "finishes",
  draws(rng, ctx) {
    const prior = priorSeasons(ctx);
    if (prior.length === 0) return [];
    const all: TemplateParams[] = [];
    for (const position of ELIGIBLE_POSITIONS) {
      for (const cutoff of CUTOFFS[position]) {
        for (const season of prior) all.push({ position, cutoff, season, union: false });
        if (cutoff !== 24) all.push({ position, cutoff, season: 0, union: true });
      }
    }
    return shuffle(all, rng).slice(0, MAX_DRAWS);
  },
  position: positionOf,
  text(params) {
    const where = params.union ? `in any season since ${STATS_FLOOR_SEASON}` : `in ${Number(params.season)}`;
    return `Name a ${positionNoun(String(params.position))} who finished top ${Number(params.cutoff)} in PPR scoring ${where}.`;
  },
  async answers(admin, params, ctx) {
    const seasons = params.union ? priorSeasons(ctx) : [Number(params.season)];
    const rows = await fetchAllRows<{ player_id: string }>("long shot season finish", (from, to) =>
      admin
        .from("player_positional_finishes")
        .select("player_id")
        .eq("scoring", "pts_ppr")
        .eq("position", String(params.position))
        .lte("finish", Number(params.cutoff))
        .in("season", seasons)
        .order("player_id", { ascending: true })
        .order("season", { ascending: true })
        .range(from, to),
    );
    return distinct(rows.map((r) => r.player_id));
  },
};
