/**
 * Family 13, history_stat_line (plan 31.3): a season total or a single-game
 * high at one position inside a window of seasons from 1999 on. Source:
 * history_player_season_stats (sums and maxes of the nflverse weekly stats).
 */

import { shuffleParams, positionOf } from "./shared";
import { decadeLabel, historyOpen, historyIdsFrom, noun, SKILL_POSITIONS, type Window } from "./history-shared";
import { HISTORY_STATS_FLOOR_SEASON } from "../types";
import type { TemplateFamily, TemplateParams } from "./types";

interface Line {
  id: string;
  col: string;
  phrase: (n: number) => string;
  thresholds: number[];
}

export const LINES: Record<"QB" | "RB" | "WR" | "TE", Line[]> = {
  QB: [
    { id: "season_pass_yd", col: "pass_yd", phrase: (n) => `a ${n.toLocaleString("en-US")}-yard passing season`, thresholds: [4500] },
    { id: "season_pass_td", col: "pass_td", phrase: (n) => `a season with ${n} or more passing touchdowns`, thresholds: [35] },
    { id: "game_pass_yd", col: "max_pass_yd", phrase: (n) => `a ${n}-yard passing game`, thresholds: [400] },
    { id: "game_pass_td", col: "max_pass_td", phrase: (n) => `a game with ${n} or more passing touchdowns`, thresholds: [5] },
  ],
  RB: [
    { id: "season_rush_yd", col: "rush_yd", phrase: (n) => `a ${n.toLocaleString("en-US")}-yard rushing season`, thresholds: [1500] },
    { id: "season_rush_td", col: "rush_td", phrase: (n) => `a season with ${n} or more rushing touchdowns`, thresholds: [15] },
    { id: "game_rush_yd", col: "max_rush_yd", phrase: (n) => `a ${n}-yard rushing game`, thresholds: [200] },
    { id: "game_rush_td", col: "max_rush_td", phrase: (n) => `a game with ${n} or more rushing touchdowns`, thresholds: [3] },
  ],
  WR: [
    { id: "season_rec_yd", col: "rec_yd", phrase: (n) => `a ${n.toLocaleString("en-US")}-yard receiving season`, thresholds: [1400] },
    { id: "season_rec_td", col: "rec_td", phrase: (n) => `a season with ${n} or more receiving touchdowns`, thresholds: [12] },
    { id: "game_rec_yd", col: "max_rec_yd", phrase: (n) => `a ${n}-yard receiving game`, thresholds: [200] },
    { id: "game_rec", col: "max_rec", phrase: (n) => `a game with ${n} or more catches`, thresholds: [12] },
  ],
  TE: [
    { id: "season_rec_yd", col: "rec_yd", phrase: (n) => `a ${n.toLocaleString("en-US")}-yard receiving season`, thresholds: [1000] },
    { id: "season_rec_td", col: "rec_td", phrase: (n) => `a season with ${n} or more receiving touchdowns`, thresholds: [10] },
    { id: "game_rec_yd", col: "max_rec_yd", phrase: (n) => `a ${n}-yard receiving game`, thresholds: [150] },
  ],
};

/** Windows from 1999: 1999 to 2009, then decades, never reaching the current season. */
export function statWindows(floor: number, season: number): Window[] {
  const start = Math.max(floor, HISTORY_STATS_FLOOR_SEASON);
  const out: Window[] = [];
  if (start <= 1999) out.push({ from: 1999, to: 2009 });
  for (let from = Math.max(2010, Math.ceil(start / 10) * 10); from + 9 < season; from += 10) out.push({ from, to: from + 9 });
  return out;
}

function line(params: TemplateParams): Line {
  const l = LINES[params.position as keyof typeof LINES]?.find((x) => x.id === params.line);
  if (!l) throw new Error(`history_stat_line: unknown line ${String(params.line)}`);
  return l;
}

export const historyStatLine: TemplateFamily = {
  key: "history_stat_line",
  enabledByDefault: true,
  source: "history_stats",
  draws(rng, ctx) {
    if (!historyOpen(ctx)) return [];
    const all: TemplateParams[] = [];
    for (const w of statWindows(ctx.historyFloorSeason, ctx.season))
      for (const position of ["QB", "RB", "WR", "TE"] as const)
        for (const l of LINES[position]) for (const n of l.thresholds) all.push({ position, line: l.id, n, from: w.from, to: w.to });
    return shuffleParams(rng, all);
  },
  position: positionOf,
  text(params) {
    return `Name a ${noun(params.position)} who had ${line(params).phrase(Number(params.n))} ${decadeLabel({ from: Number(params.from), to: Number(params.to) })}.`;
  },
  answers(admin, params, ctx) {
    return historyIdsFrom("long shot history stat line", ctx, (from, to) =>
      admin
        .from("history_player_season_stats")
        .select("history_player_id, history_players!inner(player_id)")
        .in("history_players.position", SKILL_POSITIONS)
        .eq("position", String(params.position))
        .gte("season", Number(params.from))
        .lte("season", Number(params.to))
        .gte(line(params).col, Number(params.n))
        .order("history_player_id", { ascending: true })
        .order("season", { ascending: true })
        .range(from, to),
    );
  },
};
