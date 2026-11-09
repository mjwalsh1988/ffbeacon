/**
 * Family 2, opponent_line (plan 7.2, 31.1): a game line against one opponent,
 * in one season or in any season since 2020. One team in one season at one
 * position rarely clears eight answers, so the union form carries most days.
 * Rows with a null opponent never match the equality filter.
 */

import { NFL_TEAMS, nflTeamName } from "@/lib/nfl-teams";
import { positionNoun } from "@/lib/site";
import { STATS_FLOOR_SEASON } from "../types";
import {
  MAX_DRAWS,
  pick,
  positionOf,
  sampleDraws,
  seasonPhrase,
  statLinePlayersAcross,
  statSeasons,
  type StatFilter,
} from "./shared";
import type { TemplateFamily, TemplateParams } from "./types";

type Pos = "RB" | "WR" | "TE";
const POSITIONS: Pos[] = ["RB", "WR", "TE"];
/** 0 means every season since the floor. */
const ALL_SEASONS = 0;

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
  source: "stat_lines",
  draws(rng, ctx) {
    const seasons = [ALL_SEASONS, ALL_SEASONS, ...statSeasons(ctx)];
    return sampleDraws(rng, MAX_DRAWS, () => {
      const position = pick(POSITIONS, rng);
      return {
        position,
        opponent: pick(NFL_TEAMS, rng).code,
        season: pick(seasons, rng),
        threshold: pick(OPPONENT_THRESHOLDS[position], rng).id,
      };
    });
  },
  position: positionOf,
  text(params, ctx) {
    const t = threshold(params);
    const team = nflTeamName(String(params.opponent)) ?? String(params.opponent);
    const when =
      Number(params.season) === ALL_SEASONS
        ? `in any season since ${STATS_FLOOR_SEASON}`
        : seasonPhrase(Number(params.season), ctx);
    return `Name a ${positionNoun(String(params.position))} who ${t.phrase} against the ${team} ${when}.`;
  },
  answers(admin, params, ctx) {
    const t = threshold(params);
    const seasons = Number(params.season) === ALL_SEASONS ? statSeasons(ctx) : [Number(params.season)];
    return statLinePlayersAcross(admin, seasons, {
      position: String(params.position),
      all: t.all,
      any: t.any,
      opponent: String(params.opponent),
    });
  },
};
