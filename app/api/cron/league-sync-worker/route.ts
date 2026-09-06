import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-runs";
import { runLeagueSyncWorker } from "@/lib/league-bulk-sync";
import { loadManagerPulseSettings } from "@/lib/manager-pulse/settings";
import { wakeLeagueSyncWorker } from "@/lib/league-sync-wake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

/**
 * Drains the Sync all queue (public.league_sync_jobs) and the Manager Pulse
 * footprint queue that shares it, one pass at a time, guarded by
 * league_sync_worker_lease (migration 0264) so exactly one pass ever drains
 * the queue at once: with one drainer, the process-wide Sleeper token bucket
 * IS the site's Sleeper budget for queue traffic (see the module doc comment
 * in lib/league-bulk-sync.ts).
 *
 *   GET   the cron tick (vercel.json, every minute). Runs a pass inline if
 *         nobody holds the lease; the backstop for when nothing else woke
 *         the worker.
 *   POST  the wake: acquire the lease, schedule the pass in after(), answer
 *         202 immediately. Called by lib/league-sync-wake.ts from a request
 *         path that just queued work, so it starts draining without waiting
 *         out the rest of the minute.
 *
 * Cron auth (`Authorization: Bearer <CRON_SECRET>`) and nothing else, on both
 * verbs: the wake carries the same secret the cron tick does, not a session.
 *
 * Every response, on every branch of both verbs, carries Cache-Control:
 * no-store: this is operational state about a queue, never a cacheable
 * resource, matching the convention the two Manager Pulse run routes hold.
 */

async function runPass(
  admin: ReturnType<typeof createAdminClient>,
  holder: string,
  reason: string,
): Promise<void> {
  try {
    const summary = await recordCronRun(admin, "league-sync-worker", () =>
      runLeagueSyncWorker(admin, { holder }),
    );
    console.log(`[cron/league-sync-worker] pass (${reason})`, summary);
    const { count } = await admin
      .from("league_sync_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .lte("run_after", new Date().toISOString());
    await admin.rpc("release_league_sync_lease", { p_holder: holder });
    // Only wake again when pending work actually remains, so the self-chain
    // cannot loop without work: the lease bounds every pass this could start.
    if ((count ?? 0) > 0) await wakeLeagueSyncWorker("self-chain");
  } catch (err) {
    console.error(
      "[cron/league-sync-worker] pass failed",
      err instanceof Error ? err.message : err,
    );
    await admin.rpc("release_league_sync_lease", { p_holder: holder });
  }
}

async function acquire(admin: ReturnType<typeof createAdminClient>, holder: string): Promise<boolean> {
  const settings = await loadManagerPulseSettings(admin);
  const { data } = await admin.rpc("try_acquire_league_sync_lease", {
    p_holder: holder,
    p_seconds: settings.sync.passBudgetSeconds + 30,
  });
  return data === true;
}

/** Cron tick: run a pass inline if nobody holds the lease. */
export async function GET(req: Request) {
  const auth = verifyCronRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE_HEADERS });
  }
  const admin = createAdminClient();
  const holder = `cron:${randomUUID()}`;
  if (!(await acquire(admin, holder))) {
    return NextResponse.json({ ok: true, skipped: "lease held" }, { headers: NO_STORE_HEADERS });
  }
  await runPass(admin, holder, "cron");
  return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
}

/** Wake: acquire the lease, schedule the pass, answer immediately. */
export async function POST(req: Request) {
  const auth = verifyCronRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE_HEADERS });
  }
  const admin = createAdminClient();
  const holder = `wake:${randomUUID()}`;
  if (!(await acquire(admin, holder))) {
    return NextResponse.json(
      { started: false, reason: "lease held" },
      { headers: NO_STORE_HEADERS },
    );
  }
  // Logged only, never trusted for anything else: it is a reason string in a
  // request that is otherwise authenticated exactly like the cron tick.
  // Stripped to a small safe character set and length before it ever reaches
  // a log line: an unfiltered header value could carry CRLF and forge whole
  // lines in the operator's own log.
  const reason = (req.headers.get("x-wake-reason") ?? "wake").replace(/[^A-Za-z0-9:_-]/g, "").slice(0, 40) || "wake";
  after(() => runPass(admin, holder, reason));
  return NextResponse.json({ started: true }, { status: 202, headers: NO_STORE_HEADERS });
}
