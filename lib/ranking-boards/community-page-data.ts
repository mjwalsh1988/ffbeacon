import "server-only";

/**
 * Reads for the community rankings page and the links into it. Both tables
 * (migration 0309) are public SELECT, so these use the cookie-free read client
 * inside unstable_cache: the rows change once a night, and every reader of a
 * format gets the same answer.
 *
 * Nothing here names a board or a person. The tables hold none.
 */

import { unstable_cache } from "next/cache";
import { createCachedReadClient } from "@/lib/supabase/server";
import { readSleeperId } from "@/lib/ranking-boards";
import type { CommunityFormatRow } from "./community-view";

export type CommunityRankingRow = {
  playerId: string;
  slug: string;
  name: string;
  team: string | null;
  position: string;
  sleeperId: string | null;
  strength: number;
  overallRank: number;
  positionRank: number;
  previousRank: number | null;
  boardsCount: number;
  groupKey: string;
};

const PAGE = 1000;
/** Far past any listed pool; a guard against a runaway loop, not a cap. */
const MAX_ROWS = 5000;

export const loadCommunityFormatRow = unstable_cache(
  async (formatConfigId: string): Promise<CommunityFormatRow | null> => {
    const { data, error } = await createCachedReadClient()
      .from("community_ranking_formats")
      .select("eligible_boards, eligible_accounts, published, players_listed, groups, built_at")
      .eq("format_config_id", formatConfigId)
      .maybeSingle();
    if (error || !data) return null;
    return data;
  },
  ["community-rankings:format-row", "v2"],
  { revalidate: 3600 },
);

type RawRow = {
  player_id: string;
  position: string;
  strength: number;
  overall_rank: number;
  position_rank: number;
  previous_rank: number | null;
  boards_count: number;
  group_key: string;
  players: {
    slug: string;
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    team: string | null;
    external_ids: unknown;
  } | null;
};

/** Every listed player in one format, ordered by group then rank. Paged,
 *  because PostgREST truncates at 1000 rows without saying so. */
export const loadCommunityRankings = unstable_cache(
  async (formatConfigId: string): Promise<CommunityRankingRow[]> => {
    const client = createCachedReadClient();
    const out: CommunityRankingRow[] = [];
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      const { data, error } = await client
        .from("community_rankings")
        .select(
          "player_id, position, strength, overall_rank, position_rank, previous_rank, boards_count, group_key, players!inner(slug, full_name, first_name, last_name, team, external_ids)",
        )
        .eq("format_config_id", formatConfigId)
        .order("group_key", { ascending: true })
        .order("overall_rank", { ascending: true })
        .order("player_id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error || !data) break;
      for (const row of data as unknown as RawRow[]) {
        const p = row.players;
        if (!p) continue;
        const name =
          p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
        out.push({
          playerId: row.player_id,
          slug: p.slug,
          name: name || p.slug,
          team: p.team,
          position: row.position,
          sleeperId: readSleeperId(p.external_ids as Record<string, unknown> | null),
          strength: row.strength,
          overallRank: row.overall_rank,
          positionRank: row.position_rank,
          previousRank: row.previous_rank,
          boardsCount: row.boards_count,
          groupKey: row.group_key,
        });
      }
      if (data.length < PAGE) break;
    }
    return out;
  },
  ["community-rankings:rows", "v1"],
  { revalidate: 3600 },
);

/**
 * One player's community row in one format, for the player profile. A single
 * primary-key read; null when the player is not listed.
 */
export const loadCommunityRankForPlayer = unstable_cache(
  async (
    formatConfigId: string,
    playerId: string,
  ): Promise<{ overallRank: number; boardsCount: number } | null> => {
    const { data, error } = await createCachedReadClient()
      .from("community_rankings")
      .select("overall_rank, boards_count")
      .eq("format_config_id", formatConfigId)
      .eq("player_id", playerId)
      .maybeSingle();
    if (error || !data) return null;
    return { overallRank: data.overall_rank, boardsCount: data.boards_count };
  },
  ["community-rankings:player", "v1"],
  { revalidate: 3600 },
);
