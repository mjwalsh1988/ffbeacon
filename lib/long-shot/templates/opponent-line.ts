/**
 * Family 2, opponent_line (plan 7.2): a game line against one opponent in one
 * season. Rows with a null opponent never match the equality filter.
 */

import { NFL_TEAMS, nflTeamName } from "@/lib/nfl-teams";
import { positionNoun } from "@/lib/site";
import { pick } from "../random";
import { drawStatSeason, seasonPhrase, statLinePlayers, type StatFilter } from "./shared";
import type { TemplateFamily, TemplateParams } from "./types";

type Pos = "RB" | "WR" | "TE";
const POSITIONS: Pos[] = ["RB", "WR", "TE"];

interface OpponentThreshold {
  id: string;
  phrase: string;
  all: StatFilter[];
  any?: StatFilter[];
}

const TOUCHDOWN: OpponentThreshold = {
  id: "td_1",
  phrase: "scored a touchdown",
  all: [],
  any: [
    { col: "rush_td", min: 1 },
    { col: "rec_td", min: 1 },
  ],
};

export const OPPONENT_THRESHOLDS: Record<Pos, OpponentThreshold[]> = {
  RB: [
    { id: "rush_yd_75", phrase: "had 75 or more rushing yards", all: [{ col: "rush_yd", min: 75 }] },
    TOUCHDOWN,
  ],
  WR: [
    { id: "rec_yd_75", phrase: "had 75 or more receiving yards", all: [{ col: "rec_yd", min: 75 }] },
    TOUCHDOWN,
  ],
  TE: [
    { id: "rec_yd_50", phrase: "had 50 or more receiving yards", all: [{ col: "rec_yd", min: 50 }] },
    TOUCHDOWN,
  ],
};

function threshold(params: TemplateParams): OpponentThreshold {
  const t = OPPONENT_THRESHOLDS[params.position as Pos]?.find((x) => x.id === params.threshold);
  if (!t) throw new Error(`opponent_line: unknown threshold ${String(params.threshold)}`);
  return t;
}

export const opponentLine: TemplateFamily = {
  key: "opponent_line",
  enabledByDefault: true,
  draw(rng, ctx) {
    const position = pick(POSITIONS, rng);
    const opponent = pick(NFL_TEAMS, rng).code;
    const season = drawStatSeason(rng, ctx);
    const t = pick(OPPONENT_THRESHOLDS[position], rng);
    return { position, opponent, season, threshold: t.id };
  },
  text(params, ctx) {
    const t = threshold(params);
    const team = nflTeamName(String(params.opponent)) ?? String(params.opponent);
    return `Name a ${positionNoun(String(params.position))} who ${t.phrase} against the ${team} ${seasonPhrase(Number(params.season), ctx)}.`;
  },
  answers(admin, params) {
    const t = threshold(params);
    return statLinePlayers(admin, {
      season: Number(params.season),
      position: String(params.position),
      all: t.all,
      any: t.any,
      opponent: String(params.opponent),
    });
  },
};
