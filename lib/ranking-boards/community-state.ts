import "server-only";

/**
 * Site-wide Beacon Ranker numbers for the tool page's masthead, and which
 * formats have a published community board. Aggregates only: counts, never a
 * board or a person. Cached for ten minutes, since a masthead count that is a
 * few minutes behind costs nothing and a per-visit count query costs every
 * visit.
 */

import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";

export type RankerSiteStats = {
  boardsBuilt: number;
  playersRanked: number;
  /** Boards counted across the formats whose community board is published. */
  communityBoards: number;
  /** Slugs of formats whose community board is published. */
  publishedFormatSlugs: string[];
};

export const loadRankerSiteStats = unstable_cache(
  async (): Promise<RankerSiteStats> => {
    const admin = createAdminClient();
    const [boards, rows, formats] = await Promise.all([
      admin.from("user_ranking_boards").select("id", { count: "exact", head: true }),
      admin.from("user_ranking_board_players").select("id", { count: "exact", head: true }),
      admin
        .from("community_ranking_formats")
        .select("eligible_boards, published, format_configs!inner(slug)")
        .eq("published", true),
    ]);
    const published = (formats.data ?? []) as unknown as {
      eligible_boards: number;
      format_configs: { slug: string } | null;
    }[];
    return {
      boardsBuilt: boards.count ?? 0,
      playersRanked: rows.count ?? 0,
      communityBoards: published.reduce((sum, f) => sum + (f.eligible_boards ?? 0), 0),
      publishedFormatSlugs: published
        .map((f) => f.format_configs?.slug)
        .filter((s): s is string => Boolean(s)),
    };
  },
  ["ranking-boards:site-stats", "v1"],
  { revalidate: 600 },
);
