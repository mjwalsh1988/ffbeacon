import "server-only";

/**
 * What Beacon Ranker's comparison card shows for a player (plan section 5.5):
 * photo, name, position, team, age, and the last three positional finishes in
 * the scoring that matches the board's format. No source rank (decision 4).
 *
 * Finishes are COMPLETED seasons only. A finish for the season in progress
 * ("2026 WR3" after three weeks) would sit on the card beside two full seasons
 * and read as one of them. A defender's finishes are under Sleeper's default
 * IDP scoring (idp123), which the finishes calc scores from his stat lines; an
 * offensive player's are under the format's scoring (PPR, half or standard).
 *
 * Loaded once per run for the whole seed list, not per question, so the page
 * never waits on the network between two questions.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchAllRowsInChunks } from "@/lib/supabase/fetch-all";
import { isDefender } from "@/lib/site";
import { readSleeperId } from "@/lib/ranking-boards";
import { ageOn, finishScoringFor, type CardFinish, type CardPlayer } from "./card-text";

export type { CardFinish, CardPlayer };

type Client = SupabaseClient<Database>;

/**
 * Card data for a set of players.
 *
 * @param lastCompletedSeason the newest season that has FINISHED; finishes are
 *                            read for it and the two before it
 */
export async function loadCardPlayers(
  supabase: Client,
  playerIds: readonly string[],
  opts: { scoringType: string | null; lastCompletedSeason: number; now?: Date },
): Promise<Record<string, CardPlayer>> {
  if (playerIds.length === 0) return {};
  const now = opts.now ?? new Date();
  const seasons = [0, 1, 2].map((i) => opts.lastCompletedSeason - i);
  const offenseScoring = finishScoringFor(opts.scoringType);
  const ids = [...new Set(playerIds)];

  const [players, finishes] = await Promise.all([
    fetchAllRowsInChunks("ranker card players", ids, (chunk, from, to) =>
      supabase
        .from("players")
        .select(
          "id, slug, first_name, last_name, full_name, position, team, external_ids, birth_date, years_experience",
        )
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRowsInChunks("ranker card finishes", ids, (chunk, from, to) =>
      supabase
        .from("player_positional_finishes")
        .select("player_id, season, finish, scoring")
        .in("player_id", chunk)
        .in("scoring", [offenseScoring, "idp123"])
        .in("season", seasons)
        .order("player_id", { ascending: true })
        .order("season", { ascending: false })
        .order("scoring", { ascending: true })
        .range(from, to),
    ),
  ]);

  const positionById = new Map(players.map((p) => [p.id, p.position]));
  const finishesById = new Map<string, CardFinish[]>();
  for (const f of finishes) {
    const wanted = isDefender(positionById.get(f.player_id)) ? "idp123" : offenseScoring;
    if (f.scoring !== wanted) continue;
    const list = finishesById.get(f.player_id) ?? [];
    list.push({ season: Number(f.season), finish: Number(f.finish) });
    finishesById.set(f.player_id, list);
  }

  const out: Record<string, CardPlayer> = {};
  for (const p of players) {
    const list = (finishesById.get(p.id) ?? []).sort((a, b) => b.season - a.season).slice(0, 3);
    out[p.id] = {
      playerId: p.id,
      slug: p.slug,
      name: p.full_name ?? `${p.first_name} ${p.last_name}`,
      position: p.position,
      team: p.team,
      sleeperId: readSleeperId(p.external_ids as Record<string, unknown> | null),
      age: ageOn(p.birth_date, now),
      finishes: list,
      rookie: p.years_experience === 0,
    };
  }
  return out;
}
