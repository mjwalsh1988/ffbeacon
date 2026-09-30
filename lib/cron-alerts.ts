/**
 * Email the owner the moment a scheduled job fails, at most once per job per
 * cooldown window.
 *
 * WHY. The owner's instruction is that a failed sync or cron of any kind is
 * emailed so it can be investigated, and that readers are never told our data
 * is old. The daily schedule health digest (app/api/cron/cron-health) only runs
 * at 16:00 UTC; a sync that failed at 07:00 went unmentioned for nine hours,
 * and a job that failed on a step it swallowed (sync-sleeper-stats folded its
 * derived calcs into a "success") was never mentioned at all.
 *
 * DEDUPLICATION, WITH NO NEW TABLE. An alert is recorded on the failed run's
 * own cron_runs row as `result.alertEmailedAt`. Before sending, one indexed
 * lookup over (job_name, started_at) asks whether any row for this job carries
 * that marker inside the cooldown. beacon-brief-worker runs every minute; if it
 * starts failing, the first failure emails and the next 359 do not. A job that
 * is still failing when the cooldown lapses emails again, which is the point of
 * a cooldown rather than a one-shot flag.
 *
 * Two runs of the same job failing in the same second can both pass the check
 * and both send. That costs one duplicate email in a rare race, which is a
 * better trade than a lock table for an alert path.
 *
 * Never throws. A failure to alert must not change what the run records or
 * returns.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { sendCronFailureEmail } from "./email/cron-failure-emails";

/** Hours between two alerts for the same job. */
export const CRON_ALERT_COOLDOWN_HOURS = 6;

/** The key on `cron_runs.result` that marks a run as the one that alerted. */
export const ALERT_MARKER_KEY = "alertEmailedAt";

/** Jobs that never send an immediate alert, with the reason. */
const NO_IMMEDIATE_ALERT = new Set<string>([
  // The health check emails through its own digest; alerting on its own
  // failure from inside itself would double every report.
  "cron-health",
]);

/** How long the cooldown lookup may take before it is treated as failed. */
const LOOKUP_BUDGET_MS = 5_000;

/**
 * When this server instance last sent an alert per job. A backstop for when
 * the ledger cannot be read, not the primary record: instances come and go.
 */
const lastAlertByJob = new Map<string, number>();

/** Test hook: forget this instance's alert memory. */
export function resetAlertMemoForTests(): void {
  lastAlertByJob.clear();
}

export type AlertDecision = { send: true } | { send: false; reason: string };

/** Whether this job may alert now, given whether an alert is already inside the cooldown. Pure. */
export function decideAlert(jobName: string, alertedWithinCooldown: boolean): AlertDecision {
  if (NO_IMMEDIATE_ALERT.has(jobName)) return { send: false, reason: "job reports through its own digest" };
  if (alertedWithinCooldown) return { send: false, reason: "already alerted inside the cooldown" };
  return { send: true };
}

/**
 * Send the alert if the cooldown allows, and return the ISO time it was sent
 * so the caller can stamp it on the run row. Null when nothing was sent (the
 * cooldown held, Resend is not configured, or the send failed): only a real
 * send may start a cooldown, or an outage at Resend would silence six hours
 * of real failures.
 */
export async function maybeAlertCronFailure(
  admin: SupabaseClient<Database>,
  args: {
    jobName: string;
    label: string;
    startedAt: string;
    error: string;
    partial: boolean;
    nowMs?: number;
  },
): Promise<string | null> {
  try {
    const nowMs = args.nowMs ?? Date.now();
    const since = new Date(nowMs - CRON_ALERT_COOLDOWN_HOURS * 3_600_000).toISOString();

    // This instance's own memory first. It costs nothing, and it is the only
    // guard left when the database itself is the thing failing: in the
    // 2026-09-29 12:52 UTC restart every per-minute job failed at once, and a
    // lookup that cannot reach cron_runs cannot say an alert already went out.
    const memo = lastAlertByJob.get(args.jobName);
    let alertedWithinCooldown =
      memo !== undefined && nowMs - memo < CRON_ALERT_COOLDOWN_HOURS * 3_600_000;

    if (!alertedWithinCooldown && !NO_IMMEDIATE_ALERT.has(args.jobName)) {
      const lookup = admin
        .from("cron_runs")
        .select("id")
        .eq("job_name", args.jobName)
        .gte("started_at", since)
        .not(`result->>${ALERT_MARKER_KEY}`, "is", null)
        .limit(1);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        Promise.resolve(lookup),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), LOOKUP_BUDGET_MS);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      // A failed or hung lookup errs toward sending, bounded by the memo above
      // to one email per job per instance per cooldown.
      if (outcome && !outcome.error) alertedWithinCooldown = (outcome.data ?? []).length > 0;
    }

    const decision = decideAlert(args.jobName, alertedWithinCooldown);
    if (!decision.send) return null;

    const sent = await sendCronFailureEmail({
      jobName: args.jobName,
      label: args.label,
      startedAt: args.startedAt,
      error: args.error,
      partial: args.partial,
      cooldownHours: CRON_ALERT_COOLDOWN_HOURS,
    });
    if (!sent.ok) return null;
    lastAlertByJob.set(args.jobName, nowMs);
    return new Date(nowMs).toISOString();
  } catch (err) {
    console.warn(
      `[cron-alerts] could not alert on ${args.jobName}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
