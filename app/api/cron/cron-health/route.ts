import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun, CRON_JOBS } from "@/lib/cron-runs";
import {
  findMissedJobs,
  loadCronLedgerState,
  pruneCronRuns,
} from "@/lib/cron-health";
import { sendCronHealthEmail } from "@/lib/email/cron-health-emails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** This job cannot report on itself: at the moment it runs, its own row is still
 *  marked running and its previous row is a day old, which is exactly what it
 *  would flag. */
const SELF = new Set<string>(["cron-health"]);

/**
 * GET /api/cron/cron-health
 *
 * Two jobs in one, both about the schedule rather than about any single run.
 *
 * ONE: find jobs that should have run and did not. This is the only thing on the
 * site that can see that failure. cron_runs records invocations that STARTED, so
 * a job the platform never fires writes no row at all: no error, no failed
 * status, and an admin health panel still showing its last success. On
 * 2026-08-14 sync-dynastyprocess and recalculate-beacon both silently did not
 * run, and the evidence was a missing day in the value series nobody found for
 * weeks. The check works backwards from CRON_JOBS, which is the registry the
 * admin panel already treats as canonical, so a job added there is covered
 * without touching this file.
 *
 * TWO: prune the ledger. cron_runs had no retention and had reached 135,591 rows
 * and 67 MB, 99.7 percent of it from three jobs running every minute or every
 * five. Retention is per cadence: a week of the high-frequency workers, a year
 * of the nightly jobs anyone actually reads. Rows still marked running are never
 * pruned, because a row with no terminal status is the only evidence that an
 * invocation started and died.
 *
 * Scheduled at 16:00 UTC, last in the day, so every other job has had its window
 * before this looks. Runs every day whether or not anything is wrong; the email
 * only goes out when something is.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` only.
 */
export async function GET(req: Request) {
  const cronAuth = verifyCronRequest(req);
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const supabase = createAdminClient();
  try {
    const result = await recordCronRun(supabase, "cron-health", async () => {
      const nowMs = Date.now();

      const { lastRunByJob, stalled } = await loadCronLedgerState(
        supabase,
        CRON_JOBS,
        nowMs,
      );
      const missed = findMissedJobs(CRON_JOBS, lastRunByJob, nowMs, SELF);
      const stalledReportable = stalled.filter((s) => !SELF.has(s.name));

      if (missed.length > 0 || stalledReportable.length > 0) {
        // Loud in the platform log as well as in the mailbox: an alert that
        // depends on one delivery channel is an alert with a single point of
        // failure, and Resend can be unconfigured or down.
        console.error(
          "[cron/cron-health] overdue:",
          missed.map((m) => `${m.name} (${m.hoursSince?.toFixed(1) ?? "never"}h)`).join(", ") || "none",
          "| stalled:",
          stalledReportable.map((s) => s.name).join(", ") || "none",
        );
        await sendCronHealthEmail({ missed, stalled: stalledReportable });
      }

      // Pruning runs last and on its own error boundary. A retention problem is
      // housekeeping; failing the whole job over it would take the missed-run
      // check down with it, and that check is the half nothing else covers.
      let pruned;
      let pruneError: string | null = null;
      try {
        pruned = await pruneCronRuns(supabase, CRON_JOBS, nowMs);
      } catch (err) {
        pruneError = err instanceof Error ? err.message : String(err);
        console.warn("[cron/cron-health] prune failed:", pruneError);
      }

      return {
        ok: true as const,
        jobsChecked: CRON_JOBS.length - SELF.size,
        missed,
        stalled: stalledReportable,
        emailed: missed.length > 0 || stalledReportable.length > 0,
        pruned: pruned?.deleted ?? 0,
        pruneCapped: pruned?.capped ?? false,
        pruneByWindow: pruned?.byWindow ?? [],
        pruneError,
      };
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/cron-health] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
