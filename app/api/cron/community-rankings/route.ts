import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-runs";
import { loadRankingBuilderSettings } from "@/lib/ranking-boards/settings";
import { buildCommunityRankings } from "@/lib/community-rankings/build";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/community-rankings
 *
 * Rebuilds the Beacon Ranker community rankings (plan section 9): every saved
 * board that counts is merged, per format, into one ranking by a pairwise
 * strength fit, and each format's rows in community_rankings are replaced.
 *
 * Iterates FORMATS. It never visits a league, and it reads boards only in
 * pages, so it is not the per-league cron the League Pulse rules forbid.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` only.
 */
export async function GET(req: Request) {
  const cronAuth = verifyCronRequest(req);
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const admin = createAdminClient();
  try {
    const result = await recordCronRun(admin, "community-rankings", async () => {
      const settings = await loadRankingBuilderSettings(admin);
      const formats = await buildCommunityRankings(admin, settings, new Date());
      return { formats };
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/community-rankings] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
