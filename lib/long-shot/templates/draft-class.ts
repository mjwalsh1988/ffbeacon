/**
 * Family 10, draft_class (plan 31.3): drafted in the first or second round,
 * either at one position inside one decade or by one franchise since a
 * year. Source: history_players draft columns (nflverse draft picks, 1980
 * on), so no window starts before 1980.
 */

import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { historyAnswerIds } from "../history/answers";
import { franchiseByKey, franchiseFor, franchiseForModernCode, FRANCHISES } from "../history/franchises";
import { MAX_DRAWS, pick, positionOf, sampleDraws } from "./shared";
import { decadeLabel, decadeWindows, franchiseLabel, historyOpen, noun } from "./history-shared";
import type { TemplateFamily } from "./types";

export const DRAFT_FLOOR = 1980;
const ROUNDS = [1, 2];
const SINCE = [1980, 1990, 2000, 2010];
const ROUND_WORDS: Record<number, string> = { 1: "first", 2: "second" };

export const draftClass: TemplateFamily = {
  key: "draft_class",
  enabledByDefault: true,
  source: "history_careers",
  draws(rng, ctx) {
    if (!historyOpen(ctx)) return [];
    const windows = decadeWindows(Math.max(DRAFT_FLOOR, ctx.historyFloorSeason), ctx.season);
    const since = SINCE.filter((y) => y >= ctx.historyFloorSeason && y < ctx.season - 5);
    return sampleDraws(rng, MAX_DRAWS, () =>
      windows.length > 0 && rng() < 0.5
        ? (() => {
            const w = pick(windows, rng);
            return { form: "position", position: pick(["QB", "RB", "WR", "TE"], rng), round: pick(ROUNDS, rng), from: w.from, to: w.to };
          })()
        : { form: "team", franchise: pick(FRANCHISES, rng).key, round: 1, since: pick(since.length > 0 ? since : [DRAFT_FLOOR], rng) },
    );
  },
  position: (params) => (params.form === "position" ? positionOf(params) : null),
  text(params) {
    const round = ROUND_WORDS[Number(params.round)] ?? String(params.round);
    if (params.form === "position") {
      return `Name a ${noun(params.position)} drafted in the ${round} round ${decadeLabel({ from: Number(params.from), to: Number(params.to) })}.`;
    }
    const f = franchiseByKey(String(params.franchise));
    const team = f ? franchiseLabel(f, 2100) : String(params.franchise);
    // The answer set is the game's four positions, so the sentence says so.
    return `Name a quarterback, running back, receiver or tight end drafted in the ${round} round by ${team} in ${Number(params.since)} or later.`;
  },
  async answers(admin, params, ctx) {
    const rows = await fetchAllRows<{ id: string; player_id: string | null; draft_team: string | null; draft_year: number | null }>(
      "long shot draft class",
      (from, to) => {
        let q = admin
          .from("history_players")
          .select("id, player_id, draft_team, draft_year")
          .eq("draft_round", Number(params.round))
          .in("position", ["QB", "RB", "WR", "TE"]);
        q =
          params.form === "position"
            ? q.eq("position", String(params.position)).gte("draft_year", Number(params.from)).lte("draft_year", Number(params.to))
            : q.gte("draft_year", Number(params.since));
        return q.order("id", { ascending: true }).range(from, to);
      },
    );
    // draft_team is an era code from the draft file or a present-day code from
    // the players master; the era read comes first, the modern read is the fallback.
    const franchiseOf = (team: string, year: number) => franchiseFor(team, year) ?? franchiseForModernCode(team);
    const kept =
      params.form === "position"
        ? rows
        : rows.filter((r) => r.draft_team && r.draft_year && franchiseOf(r.draft_team, r.draft_year)?.key === params.franchise);
    return historyAnswerIds(kept, ctx.modernPool);
  },
};
