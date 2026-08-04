import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-runs";
import { runLeagueSyncWorker } from "@/lib/league-bulk-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/league-sync-worker
 *
 * Drains the Sync all queue (public.league_sync_jobs), a few leagues per run,
 * scheduled every minute in vercel.json. This is the only thing that moves the
 * queue in production; the enqueue endpoint runs one pass of its own purely as a
 * head start, and the two cannot collide because the claim is atomic.
 *
 * Most runs find nothing and cost one indexed read against a partial index.
 *
 * Vercel cron auth (`Authorization: Bearer <CRON_SECRET>`) and nothing else.
 */
export async function GET(req: Request) {
  const cronAuth = verifyCronRequest(req);
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const admin = createAdminClient();
  try {
    const result = await recordCronRun(admin, "league-sync-worker", () =>
      runLeagueSyncWorker(admin),
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/league-sync-worker] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
