import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { WarCurvePoint } from "@/lib/positional-war/types";
import type { PositionalWarContext } from "./asset-notes";

export type { PositionalWarContext };

/**
 * Positional WAR for one league season, keyed by Sleeper id, for the Trade
 * Ideas asset card.
 *
 * READ ONLY. This selects the six rows league_positional_war_cache already
 * holds for the league; it never computes a curve and never imports the writer
 * (lib/league-positional-war.ts). A league with no cached rows, or a league
 * whose season is unknown, gets back an empty map, and the card note simply
 * does not fire: see lib/trade-impact/asset-notes.ts.
 *
 * Wrapped in React cache() and keyed on primitives only (the client is opened
 * inside the function, not passed in), matching loadBuilderLeague in
 * app/leagues/[league_id]/trade-ideas/page.tsx. Both the suggestion list and
 * the builder verdict read the same league season on the same request, so this
 * dedupes to one query rather than two.
 */
export const loadPositionalWarContext = cache(
  async (
    leagueRowId: string,
    season: number | null,
  ): Promise<Map<string, PositionalWarContext>> => {
    const map = new Map<string, PositionalWarContext>();
    if (season === null) return map;

    const supabase = await createClient();
    const { data } = await supabase
      .from("league_positional_war_cache")
      .select("position, structural_demand, curve")
      .eq("league_id", leagueRowId)
      .eq("season", season);
    if (!data) return map;

    for (const row of data) {
      const curve = row.curve as unknown as WarCurvePoint[] | null;
      if (!Array.isArray(curve)) continue;
      for (const point of curve) {
        // A curve entry with no Sleeper id can never match a roster, so it is
        // skipped rather than stored under a key nothing will look up.
        if (!point.sleeperId) continue;
        map.set(point.sleeperId, {
          war: point.war,
          positionRank: point.positionRank,
          structuralDemand: row.structural_demand,
          position: row.position,
        });
      }
    }
    return map;
  },
);
