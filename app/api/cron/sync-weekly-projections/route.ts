import { NextResponse, after } from "next/server";
import { revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { runWeeklyProjectionsSync } from "@/lib/sync-weekly-projections";
import { recordCronRun } from "@/lib/cron-runs";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { getActiveFormats } from "@/lib/source";
import { submitIndexNow } from "@/lib/indexnow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/sync-weekly-projections
 *
 * Vercel Cron entry point for the nightly weekly point-projection refresh.
 * Pulls Sleeper's per-week projections for the current season's upcoming weeks
 * and overwrites player_weekly_projections in place. When nothing is published
 * yet (deep off-season), the sync returns `skipped: true` (HTTP 200) rather than
 * erroring, so the ledger records a clean skip.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` only. Calls the same
 * runWeeklyProjectionsSync() the CLI uses and returns its JSON summary.
 */
export async function GET(req: Request) {
  const cronAuth = verifyCronRequest(req);
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const supabase = createAdminClient();
  try {
    const result = await recordCronRun(supabase, "sync-weekly-projections", async () => {
      const sync = await runWeeklyProjectionsSync(supabase);
      // Fresh projections -> bust the profile projection caches.
      if (!sync.skipped) revalidateTag(CACHE_TAGS.playerProjections);

      // A skipped run, or one that fetched nothing, wrote no new row for the
      // start/sit tool or any rankings board to reflect, so there is nothing to
      // push. Fired via after() so a slow or failed ping never adds to this
      // cron's own duration; submitIndexNow never throws.
      if (!sync.skipped && sync.totalStored > 0) {
        const activeFormats = await getActiveFormats(supabase);
        const urls = [
          "/tools/who-should-i-start",
          ...activeFormats.map((format) => `/rankings/${format.slug}`),
        ];
        after(() => submitIndexNow(urls));
      }
      return sync;
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/sync-weekly-projections] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
