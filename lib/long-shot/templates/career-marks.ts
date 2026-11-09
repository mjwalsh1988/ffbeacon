/**
 * Family 12, career_marks (plan 31.3): honors and career totals. Three forms,
 * each phrased to the data that proves it:
 *
 * - hof: a Hall of Famer at one position drafted in 1980 or later (the
 *   nflverse draft file carries the flag from 1980).
 * - pro_bowls: N or more Pro Bowl selections, drafted in 1980 or later.
 * - total: a career total since 1999, summed from the weekly stats, which
 *   cover every player of that era, drafted or not.
 *
 * Source: history_players.
 */

import { HISTORY_STATS_FLOOR_SEASON } from "../types";
import { positionOf, shuffleParams } from "./shared";
import { historyOpen, historyPlayersFrom, noun } from "./history-shared";
import type { TemplateFamily, TemplateParams } from "./types";

const DRAFT_FLOOR = 1980;
const PRO_BOWLS = [3, 5];

interface Total {
  id: string;
  col: "career_pass_yd" | "career_pass_td" | "career_rush_yd" | "career_rush_td" | "career_rec_yd" | "career_rec_td" | "career_rec";
  phrase: (n: number) => string;
  thresholds: number[];
}

export const TOTALS: Record<"QB" | "RB" | "WR" | "TE", Total[]> = {
  QB: [
    { id: "pass_yd", col: "career_pass_yd", phrase: (n) => `${n.toLocaleString("en-US")} or more passing yards`, thresholds: [30000, 40000] },
    { id: "pass_td", col: "career_pass_td", phrase: (n) => `${n} or more passing touchdowns`, thresholds: [200, 300] },
  ],
  RB: [
    { id: "rush_yd", col: "career_rush_yd", phrase: (n) => `${n.toLocaleString("en-US")} or more rushing yards`, thresholds: [8000, 10000] },
    { id: "rush_td", col: "career_rush_td", phrase: (n) => `${n} or more rushing touchdowns`, thresholds: [60, 80] },
  ],
  WR: [
    { id: "rec_yd", col: "career_rec_yd", phrase: (n) => `${n.toLocaleString("en-US")} or more receiving yards`, thresholds: [10000, 12000] },
    { id: "rec_td", col: "career_rec_td", phrase: (n) => `${n} or more receiving touchdowns`, thresholds: [60, 80] },
  ],
  TE: [
    { id: "rec_yd", col: "career_rec_yd", phrase: (n) => `${n.toLocaleString("en-US")} or more receiving yards`, thresholds: [6000, 8000] },
    { id: "rec", col: "career_rec", phrase: (n) => `${n} or more catches`, thresholds: [500, 700] },
  ],
};

function total(params: TemplateParams): Total {
  const t = TOTALS[params.position as keyof typeof TOTALS]?.find((x) => x.id === params.stat);
  if (!t) throw new Error(`career_marks: unknown total ${String(params.stat)}`);
  return t;
}

export const careerMarks: TemplateFamily = {
  key: "career_marks",
  enabledByDefault: true,
  source: "history_careers",
  draws(rng, ctx) {
    if (!historyOpen(ctx)) return [];
    const all: TemplateParams[] = [];
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      if (ctx.historyFloorSeason <= DRAFT_FLOOR) {
        all.push({ form: "hof", position });
        for (const n of PRO_BOWLS) all.push({ form: "pro_bowls", position, n });
      }
      for (const t of TOTALS[position]) for (const n of t.thresholds) all.push({ form: "total", position, stat: t.id, n });
    }
    return shuffleParams(rng, all);
  },
  position: positionOf,
  text(params) {
    const who = noun(params.position);
    if (params.form === "hof") return `Name a Hall of Fame ${who} drafted in ${DRAFT_FLOOR} or later.`;
    if (params.form === "pro_bowls") return `Name a ${who} drafted in ${DRAFT_FLOOR} or later with ${Number(params.n)} or more Pro Bowl selections.`;
    return `Name a ${who} with ${total(params).phrase(Number(params.n))} since ${HISTORY_STATS_FLOOR_SEASON}.`;
  },
  answers(admin, params, ctx) {
    return historyPlayersFrom("long shot career marks", ctx, (from, to) => {
      const q = admin.from("history_players").select("id, player_id").eq("position", String(params.position));
      const filtered =
        params.form === "hof"
          ? q.eq("hof", true).gte("draft_year", DRAFT_FLOOR)
          : params.form === "pro_bowls"
            ? q.gte("pro_bowls", Number(params.n)).gte("draft_year", DRAFT_FLOOR)
            : q.gte(total(params).col, Number(params.n));
      return filtered.order("id", { ascending: true }).range(from, to);
    });
  },
};
