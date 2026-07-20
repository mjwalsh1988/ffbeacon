import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { runWeeklyProjectionsSync } from "@/lib/sync-weekly-projections";
import { recordCronRun } from "@/lib/cron-runs";

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
    const result = await recordCronRun(supabase, "sync-weekly-projections", () =>
      runWeeklyProjectionsSync(supabase),
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/sync-weekly-projections] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
