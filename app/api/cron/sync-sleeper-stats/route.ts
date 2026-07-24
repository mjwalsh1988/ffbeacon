import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { runSleeperStatsSync } from "@/lib/sync-sleeper-stats";
import { runCalculatePositionalFinishes } from "@/lib/calculate-positional-finishes";
import { recordCronRun } from "@/lib/cron-runs";
import { CACHE_TAGS } from "@/lib/cache-tags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/sync-sleeper-stats
 *
 * Vercel Cron entry point for the nightly current-season stats refresh.
 * Scheduled in vercel.json with a month-restricted expression so it never fires
 * in the dead months; the handler also short-circuits via Sleeper's live state
 * when season_type is "off", returning `skipped: true` (HTTP 200, not an error).
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` only. Calls the same
 * runSleeperStatsSync() the CLI uses and returns its JSON summary.
 */
export async function GET(req: Request) {
  const cronAuth = verifyCronRequest(req);
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const supabase = createAdminClient();
  try {
    const result = await recordCronRun(supabase, "sync-sleeper-stats", async () => {
      const sync = await runSleeperStatsSync(supabase);
      // New stats -> rebuild the positional-finishes cache and bust the profile
      // caches that read stats/finishes. Skipped runs (offseason) touched nothing.
      if (!sync.skipped) {
        const finishes = await runCalculatePositionalFinishes(supabase);
        revalidateTag(CACHE_TAGS.playerStats);
        revalidateTag(CACHE_TAGS.playerFinishes);
        return { ...sync, finishes };
      }
      return sync;
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/sync-sleeper-stats] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
