import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { runBuildBeaconProjections } from "@/lib/build-beacon-projections";
import { recordCronRun } from "@/lib/cron-runs";
import { CACHE_TAGS } from "@/lib/cache-tags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/build-beacon-projections
 *
 * Builds the FF Beacon projections into player_weekly_projections with
 * source = 'ffbeacon', for the remaining weeks of the live season.
 *
 * WHY IT RUNS LAST IN THE DAY
 *
 * It reads three tables that three earlier jobs write, and a build that runs
 * before any of them would be a build on yesterday's inputs:
 *
 *   09:00 UTC  sync-sleeper-stats        the usage history
 *   12:00 UTC  sync-weekly-projections   the blend partner, and the list of
 *                                        weeks that exist at all
 *   13:00 UTC  sync-nfl-odds             the game environment
 *
 * 14:30 UTC is after all three with room for a slow run, and is the earliest
 * slot where every input is same-day.
 *
 * WHY A SKIPPED RUN IS NOT AN ERROR
 *
 * With no Sleeper rows for the window there is nothing to mirror and nothing
 * to blend against, and the builder writes NOTHING rather than an empty
 * source. An empty ffbeacon source would be worse than none at all:
 * resolveProjectionSource would select it and every reader would then see a
 * season with no weeks in it. That returns `skipped: true` on HTTP 200, so the
 * ledger records a clean skip rather than paging anyone in the off-season.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` only. Calls the same
 * runBuildBeaconProjections() the CLI uses and returns its JSON summary.
 */
export async function GET(req: Request) {
  const cronAuth = verifyCronRequest(req);
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const supabase = createAdminClient();
  try {
    const result = await recordCronRun(supabase, "build-beacon-projections", async () => {
      const built = await runBuildBeaconProjections(supabase);
      // Only a run that actually wrote rows changed what a reader would see.
      if (!built.skipped) revalidateTag(CACHE_TAGS.playerProjections);
      return built;
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/build-beacon-projections] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
