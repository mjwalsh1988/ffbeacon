/**
 * Family 14, history_finish (plan 31.3): a top-N PPR positional finish in any
 * season inside a window from 1999 on. Source: history_player_season_stats
 * (ppr_finish, computed at sync from the nflverse weekly stats).
 */

import { shuffleParams, positionOf } from "./shared";
import { decadeLabel, historyOpen, historyIdsFrom, noun, SKILL_POSITIONS } from "./history-shared";
import { statWindows } from "./history-stat-line";
import type { TemplateFamily, TemplateParams } from "./types";

const CUTOFFS: Record<string, number[]> = { QB: [3, 5, 12], RB: [3, 5, 12], WR: [3, 5, 12], TE: [3, 5] };

export const historyFinish: TemplateFamily = {
  key: "history_finish",
  enabledByDefault: true,
  source: "history_stats",
  draws(rng, ctx) {
    if (!historyOpen(ctx)) return [];
    const all: TemplateParams[] = [];
    for (const w of statWindows(ctx.historyFloorSeason, ctx.season))
      for (const position of Object.keys(CUTOFFS))
        for (const cutoff of CUTOFFS[position]) all.push({ position, cutoff, from: w.from, to: w.to });
    return shuffleParams(rng, all);
  },
  position: positionOf,
  text(params) {
    return `Name a ${noun(params.position)} who finished top ${Number(params.cutoff)} in PPR scoring in a season ${decadeLabel({ from: Number(params.from), to: Number(params.to) })}.`;
  },
  answers(admin, params, ctx) {
    return historyIdsFrom("long shot history finish", ctx, (from, to) =>
      admin
        .from("history_player_season_stats")
        .select("history_player_id, history_players!inner(player_id)")
        .in("history_players.position", SKILL_POSITIONS)
        .eq("position", String(params.position))
        .gte("season", Number(params.from))
        .lte("season", Number(params.to))
        .lte("ppr_finish", Number(params.cutoff))
        .order("history_player_id", { ascending: true })
        .order("season", { ascending: true })
        .range(from, to),
    );
  },
};
