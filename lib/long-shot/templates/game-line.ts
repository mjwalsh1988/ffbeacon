/**
 * Family 1, game_line (plan 7.2): a single-game stat line at one position in
 * one season. Source: regular-season player_stats.
 */

import { positionNoun } from "@/lib/site";
import { shuffle } from "../random";
import { MAX_DRAWS, positionOf, seasonPhrase, statLinePlayers, statSeasons, type StatFilter } from "./shared";
import type { TemplateFamily, TemplateParams } from "./types";

export interface GameLineThreshold {
  id: string;
  phrase: string;
  all: StatFilter[];
}

export const GAME_LINE_THRESHOLDS: Record<"QB" | "RB" | "WR" | "TE", GameLineThreshold[]> = {
  QB: [
    { id: "pass_yd_300", phrase: "300 or more passing yards", all: [{ col: "pass_yd", min: 300 }] },
    { id: "pass_td_3", phrase: "3 or more passing touchdowns", all: [{ col: "pass_td", min: 3 }] },
    {
      id: "rush_yd_50_pass_td_1",
      phrase: "50 or more rushing yards and a passing touchdown",
      all: [
        { col: "rush_yd", min: 50 },
        { col: "pass_td", min: 1 },
      ],
    },
  ],
  RB: [
    { id: "rush_yd_100", phrase: "100 or more rushing yards", all: [{ col: "rush_yd", min: 100 }] },
    {
      id: "rush_yd_100_rush_td_1",
      phrase: "100 or more rushing yards and a rushing touchdown",
      all: [
        { col: "rush_yd", min: 100 },
        { col: "rush_td", min: 1 },
      ],
    },
    { id: "rec_6", phrase: "6 or more catches", all: [{ col: "rec", min: 6 }] },
  ],
  WR: [
    { id: "rec_yd_100", phrase: "100 or more receiving yards", all: [{ col: "rec_yd", min: 100 }] },
    { id: "rec_8", phrase: "8 or more catches", all: [{ col: "rec", min: 8 }] },
    { id: "rec_td_2", phrase: "2 or more receiving touchdowns", all: [{ col: "rec_td", min: 2 }] },
  ],
  TE: [
    { id: "rec_yd_75", phrase: "75 or more receiving yards", all: [{ col: "rec_yd", min: 75 }] },
    { id: "rec_6", phrase: "6 or more catches", all: [{ col: "rec", min: 6 }] },
    {
      id: "rec_td_1_rec_yd_50",
      phrase: "a receiving touchdown and 50 or more receiving yards",
      all: [
        { col: "rec_td", min: 1 },
        { col: "rec_yd", min: 50 },
      ],
    },
  ],
};

type Pos = keyof typeof GAME_LINE_THRESHOLDS;
const POSITIONS: Pos[] = ["QB", "RB", "WR", "TE"];

function threshold(params: TemplateParams): GameLineThreshold {
  const list = GAME_LINE_THRESHOLDS[params.position as Pos];
  const t = list?.find((x) => x.id === params.threshold);
  if (!t) throw new Error(`game_line: unknown threshold ${String(params.threshold)}`);
  return t;
}

export const gameLine: TemplateFamily = {
  key: "game_line",
  enabledByDefault: true,
  source: "stat_lines",
  draws(rng, ctx) {
    const all: TemplateParams[] = [];
    for (const position of POSITIONS)
      for (const season of statSeasons(ctx))
        for (const t of GAME_LINE_THRESHOLDS[position]) all.push({ position, season, threshold: t.id });
    return shuffle(all, rng).slice(0, MAX_DRAWS);
  },
  position: positionOf,
  text(params, ctx) {
    const t = threshold(params);
    return `Name a ${positionNoun(String(params.position))} who had ${t.phrase} in one game ${seasonPhrase(Number(params.season), ctx)}.`;
  },
  answers(admin, params) {
    return statLinePlayers(admin, {
      season: Number(params.season),
      position: String(params.position),
      all: threshold(params).all,
    });
  },
};
