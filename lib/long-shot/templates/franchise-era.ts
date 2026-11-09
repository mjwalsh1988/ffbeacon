/**
 * Family 8, franchise_era (plan 31.3): a player at one position who played
 * for one franchise inside one decade. Source: history_player_seasons.
 */

import { franchiseByKey } from "../history/franchises";
import { MAX_DRAWS, pick, positionOf, sampleDraws } from "./shared";
import {
  decadeLabel,
  decadeWindows,
  eraPositions,
  franchiseLabel,
  franchisesIn,
  historyIdsFrom,
  historyOpen,
  noun,
  SKILL_POSITIONS,
} from "./history-shared";
import type { TemplateFamily } from "./types";

export const franchiseEra: TemplateFamily = {
  key: "franchise_era",
  enabledByDefault: true,
  source: "history_rosters",
  draws(rng, ctx) {
    if (!historyOpen(ctx)) return [];
    const windows = decadeWindows(ctx.historyFloorSeason, ctx.season);
    if (windows.length === 0) return [];
    return sampleDraws(rng, MAX_DRAWS, () => {
      const w = pick(windows, rng);
      return { franchise: pick(franchisesIn(w), rng).key, from: w.from, to: w.to, position: pick(eraPositions(w.from), rng) };
    });
  },
  position: positionOf,
  text(params) {
    const f = franchiseByKey(String(params.franchise));
    const team = f ? franchiseLabel(f, Number(params.to), Number(params.from)) : String(params.franchise);
    return `Name a ${noun(params.position)} who played for ${team} ${decadeLabel({ from: Number(params.from), to: Number(params.to) })}.`;
  },
  answers(admin, params, ctx) {
    return historyIdsFrom("long shot franchise era", ctx, (from, to) =>
      admin
        .from("history_player_seasons")
        .select("history_player_id, history_players!inner(player_id)")
        // Only people the typeahead can find: a career group of QB, RB, WR or TE.
        .in("history_players.position", SKILL_POSITIONS)
        .eq("franchise_key", String(params.franchise))
        .gte("season", Number(params.from))
        .lte("season", Number(params.to))
        .eq("position", String(params.position))
        .order("id", { ascending: true })
        .range(from, to),
    );
  },
};
