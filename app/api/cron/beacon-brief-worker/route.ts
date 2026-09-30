import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-runs";
import { runWorker } from "@/lib/beacon-brief/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * A hard ceiling on top of the worker's own soft deadline
 * (settings.workerMaxRuntimeMs, 50 seconds by default).
 *
 * The soft deadline is only checked between jobs, so it cannot help when a
 * single database call hangs. The 437-second run on 2026-09-28 claimed no jobs
 * at all, so its time went to the settings, reap and claim calls, not to work.
 * On 2026-09-29 the same shape left rows stuck on "running" while the database
 * stalled (checkpoints taking 270 seconds, then a restart at 12:52 UTC). The
 * Supabase client has no request timeout, so the handler waited past
 * maxDuration and the platform killed it before the ledger heard. This
 * budget records the run as failed at four minutes, while the function is
 * still alive to write the row, and lets the next minute's run start clean.
 */
const RUN_BUDGET_MS = 240_000;

/**
 * GET /api/cron/beacon-brief-worker
 *
 * Vercel Cron entry point for the Beacon Brief queue worker (every minute,
 * scheduled in vercel.json). Accepts the Vercel cron auth header
 * (`Authorization: Bearer <CRON_SECRET>`) and refuses anything else. Claims a
 * bounded batch of queue jobs (FOR UPDATE SKIP LOCKED) and processes them with
 * the Discord throttle and backoff.
 */
export async function GET(req: Request) {
  const cronAuth = verifyCronRequest(req);
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const supabase = createAdminClient();
  try {
    const result = await recordCronRun(supabase, "beacon-brief-worker", () => runWorker(supabase), {
      timeoutMs: RUN_BUDGET_MS,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/beacon-brief-worker] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
