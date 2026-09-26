/**
 * scripts/calculate-community-rankings.ts
 *
 * Rebuild the Beacon Ranker community rankings by hand:
 *   npm run calculate:community-rankings
 *
 * The same work as the nightly /api/cron/community-rankings job. It rewrites
 * community_rankings and community_ranking_formats and touches nothing else.
 * Runs under the react-server condition because the build is server-only, and
 * reads the defender seed uncached because there is no Next data cache here.
 */

import { getServiceClient } from "./_supabase";
import { loadRankingBuilderSettings } from "../lib/ranking-boards/settings";
import { buildCommunityRankings } from "../lib/community-rankings/build";

async function main() {
  const admin = getServiceClient();
  const settings = await loadRankingBuilderSettings(admin);
  const start = Date.now();
  const summaries = await buildCommunityRankings(admin, settings, new Date(), { uncachedSeeds: true });
  for (const s of summaries) {
    console.log(
      `  ${s.formatSlug}: ${s.eligibleBoards} boards from ${s.eligibleAccounts} people, ${s.playersListed} players listed, ` +
        `groups [${s.groups.join(", ")}], ${s.published ? "published" : "not published"}, ` +
        `${s.iterations} iterations`,
    );
  }
  console.log(`[community-rankings] done in ${Date.now() - start}ms`);
}

main().catch((err) => {
  console.error("[community-rankings] failed:", err);
  process.exit(1);
});
