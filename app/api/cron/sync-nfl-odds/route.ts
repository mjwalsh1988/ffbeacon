import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { runNflOddsSync } from "@/lib/sync-nfl-odds";
import { recordCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 120, not 60, and the margin is the point.
 *
 * The sync fetches the current week plus the next two, sequentially, and
 * lib/nfl-odds.ts gives each request a 20 second timeout. Three worst-case
 * timeouts is 60 seconds, which landed exactly on the old ceiling. A slow but
 * not dead ESPN would then have Vercel hard-kill the function mid-run, and a
 * hard kill skips the finalize in lib/cron-runs.ts, leaving a "running" row
 * stuck in the ledger forever rather than a clean error. That is worse than the
 * outage itself, because cron-health can see an error and cannot see a job that
 * never finished saying anything.
 */
export const maxDuration = 120;

/**
 * GET /api/cron/sync-nfl-odds
 *
 * Vercel Cron entry point for the daily game-odds refresh. Pulls ESPN's public
 * scoreboard for the current week plus the next two and upserts
 * nfl_game_odds in place. When ESPN has published nothing for every targeted
 * week (the off-season, or a slate this far out), the sync returns
 * `skipped: true` (HTTP 200) rather than erroring, so the ledger records a
 * clean skip.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` only. Calls the same
 * runNflOddsSync() the CLI uses and returns its JSON summary.
 */
export async function GET(req: Request) {
  const cronAuth = verifyCronRequest(req);
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const supabase = createAdminClient();
  try {
    const result = await recordCronRun(supabase, "sync-nfl-odds", async () => {
      return runNflOddsSync(supabase);
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/sync-nfl-odds] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
