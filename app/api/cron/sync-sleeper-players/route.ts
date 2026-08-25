import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { runSleeperPlayersSync } from "@/lib/sync-sleeper-players";
import { recordCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/sync-sleeper-players
 *
 * Vercel Cron entry point for the nightly player dimension refresh: names,
 * teams, positions and, the reason this runs first every night, Sleeper's
 * injury designations.
 *
 * Scheduled at 06:00 UTC, ahead of every other job. Injury status decides
 * whether a player is projected at all, so the value syncs, the weekly
 * projections sync and the derived recalcs all need it already current when
 * they run. Landing it last would mean a full day of downstream work built on
 * yesterday's designations.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` only. Calls the same
 * runSleeperPlayersSync() the CLI uses and returns its JSON summary.
 */
export async function GET(req: Request) {
  const cronAuth = verifyCronRequest(req);
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const supabase = createAdminClient();
  try {
    const result = await recordCronRun(supabase, "sync-sleeper-players", async () => {
      return await runSleeperPlayersSync(supabase);
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/sync-sleeper-players] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
