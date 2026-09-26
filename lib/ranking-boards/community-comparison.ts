import "server-only";
import { unstable_cache } from "next/cache";
import { createCachedReadClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { isSinglePositionScope, type BoardScope } from "@/lib/ranking-boards";
import type { ComparisonRanks, RankComparison } from "./compare";

/**
 * "vs community" (plan sections 9.3 and 13.7): the reader's placement against
 * the community rankings for the board's own format. Shown ONLY once that
 * format's community board is published: a comparison against a handful of
 * boards would read as a consensus that does not exist.
 *
 * The community ranks defenders too, in a group of their own when nobody has
 * ranked them against offense, so a defender is compared by his rank among the
 * board's defenders (ranksDefenders). Public aggregate data, cached an hour:
 * the build runs nightly.
 */

function loadCommunityRanks(
  formatConfigId: string,
): Promise<{ published: boolean; ranks: Record<string, ComparisonRanks> }> {
  return unstable_cache(
    async () => {
      const supabase = createCachedReadClient();
      const { data: format } = await supabase
        .from("community_ranking_formats")
        .select("published")
        .eq("format_config_id", formatConfigId)
        .maybeSingle();
      if (!format?.published) return { published: false, ranks: {} };
      const rows = await fetchAllRows("community ranks for comparison", (from, to) =>
        supabase
          .from("community_rankings")
          .select("player_id, overall_rank, position_rank")
          .eq("format_config_id", formatConfigId)
          .order("player_id", { ascending: true })
          .range(from, to),
      );
      const ranks: Record<string, ComparisonRanks> = {};
      for (const r of rows) ranks[r.player_id] = { overall: r.overall_rank, position: r.position_rank };
      return { published: true, ranks };
    },
    ["ranking-boards:community-ranks", formatConfigId],
    { revalidate: 3600 },
  )();
}

export async function loadCommunityComparison(opts: {
  scope: BoardScope;
  formatConfigId: string | null;
  restrictTo?: readonly string[];
}): Promise<RankComparison | null> {
  if (!opts.formatConfigId) return null;
  const { published, ranks } = await loadCommunityRanks(opts.formatConfigId);
  if (!published) return null;
  let kept = ranks;
  if (opts.restrictTo) {
    const keep = new Set(opts.restrictTo);
    kept = Object.fromEntries(Object.entries(ranks).filter(([id]) => keep.has(id)));
  }
  return {
    label: "vs community",
    subject: "the community",
    fallbackFormatDisplay: null,
    basis: isSinglePositionScope(opts.scope) ? "position" : "overall",
    ranks: kept,
    ranksDefenders: true,
  };
}
