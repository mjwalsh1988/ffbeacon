/**
 * Family 9, career_span (plan 31.3): a player at one position whose first
 * season fell in one decade and who played at least N seasons. Source:
 * history_players.
 */

import { positionOf, shuffleParams } from "./shared";
import { decadeLabel, decadeWindows, eraPositions, historyOpen, historyPlayersFrom, noun } from "./history-shared";
import type { TemplateFamily, TemplateParams } from "./types";

const MIN_SEASONS = [8, 10, 12];

export const careerSpan: TemplateFamily = {
  key: "career_span",
  enabledByDefault: true,
  source: "history_rosters",
  draws(rng, ctx) {
    if (!historyOpen(ctx)) return [];
    const windows = decadeWindows(ctx.historyFloorSeason, ctx.season);
    const all: TemplateParams[] = [];
    for (const w of windows)
      for (const position of eraPositions(w.from))
        for (const minSeasons of MIN_SEASONS) all.push({ from: w.from, to: w.to, position, minSeasons });
    return shuffleParams(rng, all);
  },
  position: positionOf,
  text(params) {
    return `Name a ${noun(params.position)} whose first NFL season was ${decadeLabel({ from: Number(params.from), to: Number(params.to) })} and who played at least ${Number(params.minSeasons)} seasons.`;
  },
  answers(admin, params, ctx) {
    return historyPlayersFrom("long shot career span", ctx, (from, to) =>
      admin
        .from("history_players")
        .select("id, player_id")
        .eq("position", String(params.position))
        .gte("first_season", Number(params.from))
        .lte("first_season", Number(params.to))
        .gte("seasons_played", Number(params.minSeasons))
        .order("id", { ascending: true })
        .range(from, to),
    );
  },
};
