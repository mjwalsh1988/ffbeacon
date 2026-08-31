/**
 * Does the schedule actually run, and does its ledger stay a sane size?
 *
 * WHY THIS EXISTS
 * On 2026-08-14 two jobs did not run. sync-dynastyprocess (09:00) and
 * recalculate-beacon (09:30) have no row in cron_runs for that day at all, while
 * 07:00, 08:00 and 10:00 all ran normally. That is the platform not firing the
 * window, not our code failing, and the consequence was a missing day in the FF
 * Beacon value series plus a trends rebuild at 10:02 that ran happily off a
 * day-old board.
 *
 * Nobody was told, and nobody could have been. cron_runs only holds rows for
 * runs that STARTED, so a job that never fires is invisible by construction: no
 * row, no error, no failed status, nothing to query. The only way to see it is
 * to start from the list of jobs that were supposed to run and look for the
 * absence. That is what findMissedJobs does.
 *
 * THE LEDGER ALSO NEEDED A LID
 * cron_runs had no retention and had reached 135,591 rows and 67 MB, of which
 * 99.7 percent came from three jobs that run every minute or every five. The
 * daily value jobs, the ones anyone ever reads, were 400 rows of it. Retention
 * is therefore per cadence rather than one global window: a minute-by-minute
 * worker's history is worth a week, a nightly job's is worth a year.
 *
 * AND THEN THE LID DID NOT CLOSE
 * That retention pass ran nightly for months and deleted nothing. By 2026-08-31
 * the table was 157,853 rows and 71 MB, still growing at the original rate, and
 * the only trace was `pruneError: "[object Object]"` in a cron result nobody had
 * cause to open. Two independent mistakes in the batch size, both described at
 * PRUNE_BATCH below, and a stringification that threw the diagnosis away. The
 * lesson worth keeping is the third one: an error path that cannot say what went
 * wrong is the same as no error path.
 *
 * Everything in this file that can be pure is pure, so the schedule reasoning is
 * testable without a database or a clock. The two functions that touch rows are
 * at the bottom, past the divider.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/** Sub-hourly and hourly jobs. A week of their history is plenty. */
export const HIGH_FREQUENCY_RETENTION_DAYS = 7;
/** Daily and seasonal jobs. Small enough to keep a full year of. */
export const STANDARD_RETENTION_DAYS = 365;

/** Grace on a daily job. Vercel promises the hour, not the minute. */
const DAILY_MAX_GAP_HOURS = 26;
/** Grace on anything that runs at least hourly. */
const FREQUENT_MAX_GAP_HOURS = 3;

export type CronExpectation =
  /** We know how often this should run, so a gap is measurable. */
  | { checked: true; maxGapHours: number }
  /** We deliberately do not check this one, and why. */
  | { checked: false; reason: string };

type CronFields = {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
};

function parseFields(schedule: string): CronFields | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

/** Expand a cron list field ("1,2,8" or "*") into the numbers it matches. */
function listMatches(field: string, value: number): boolean {
  if (field === "*") return true;
  return field
    .split(",")
    .map((p) => Number(p.trim()))
    .some((n) => Number.isInteger(n) && n === value);
}

/**
 * How long this job may go without running before the silence means something.
 *
 * Anything with a restricted day-of-month or day-of-week is skipped rather than
 * guessed at. Nothing in CRON_JOBS uses those today, and inventing an answer for
 * a schedule we cannot reason about would produce a false alarm on the first job
 * that does.
 *
 * A month-restricted job (the seasonal stats sync) is checked during its months
 * and skipped outside them, because "did not run in June" is the correct
 * behaviour for a job that is not scheduled in June.
 */
export function expectationFor(schedule: string, nowMs: number): CronExpectation {
  const trimmed = schedule.trim();
  if (!trimmed) return { checked: false, reason: "Not scheduled." };

  const f = parseFields(trimmed);
  if (!f) return { checked: false, reason: `Cannot parse the schedule "${schedule}".` };

  if (f.dayOfMonth !== "*" || f.dayOfWeek !== "*") {
    return {
      checked: false,
      reason: "Runs on specific days, which this check does not model.",
    };
  }

  // Vercel schedules in UTC, so the month gate is read in UTC.
  const month = new Date(nowMs).getUTCMonth() + 1;
  if (!listMatches(f.month, month)) {
    return { checked: false, reason: "Out of season this month." };
  }

  if (f.hour === "*") return { checked: true, maxGapHours: FREQUENT_MAX_GAP_HOURS };

  const hour = Number(f.hour);
  if (!Number.isInteger(hour)) {
    return { checked: false, reason: `Cannot parse the hour field "${f.hour}".` };
  }
  return { checked: true, maxGapHours: DAILY_MAX_GAP_HOURS };
}

/** How long one job's ledger rows are kept, from its cadence. */
export function retentionDaysFor(schedule: string): number {
  const f = parseFields(schedule);
  if (!f) return STANDARD_RETENTION_DAYS;
  return f.hour === "*" ? HIGH_FREQUENCY_RETENTION_DAYS : STANDARD_RETENTION_DAYS;
}

export type CronJobLike = {
  name: string;
  label: string;
  schedule: string;
};

export type CronMiss = {
  name: string;
  label: string;
  schedule: string;
  maxGapHours: number;
  /** ISO timestamp of the most recent run, or null when there has never been one. */
  lastRunAt: string | null;
  /** Hours since that run. Null when the job has never run. */
  hoursSince: number | null;
};

/**
 * Jobs that should have run by now and have not.
 *
 * A job with no runs at all is reported, not skipped. A brand new route that has
 * never fired is exactly the case worth surfacing, and "never" is the longest
 * possible gap rather than a missing measurement.
 */
export function findMissedJobs(
  jobs: ReadonlyArray<CronJobLike>,
  lastRunByJob: ReadonlyMap<string, string>,
  nowMs: number,
  ignore: ReadonlySet<string> = new Set(),
): CronMiss[] {
  const misses: CronMiss[] = [];
  for (const job of jobs) {
    if (ignore.has(job.name)) continue;
    const expectation = expectationFor(job.schedule, nowMs);
    if (!expectation.checked) continue;

    const last = lastRunByJob.get(job.name) ?? null;
    const lastMs = last ? new Date(last).getTime() : NaN;
    const hoursSince = Number.isFinite(lastMs)
      ? (nowMs - lastMs) / 3_600_000
      : null;

    if (hoursSince !== null && hoursSince <= expectation.maxGapHours) continue;

    misses.push({
      name: job.name,
      label: job.label,
      schedule: job.schedule,
      maxGapHours: expectation.maxGapHours,
      lastRunAt: Number.isFinite(lastMs) ? last : null,
      hoursSince,
    });
  }
  return misses;
}

/**
 * Runs that claimed to start and never reported a finish.
 *
 * Distinct from a miss, and the opposite failure: the row exists, so the job DID
 * fire, and then the process died before recordCronRun could write a terminal
 * status. Worth reporting for the same reason, and worth keeping in the table
 * rather than pruning, because the row is the only evidence it happened.
 */
export function isStaleRunning(startedAt: string, nowMs: number): boolean {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return false;
  // Longer than any maxDuration we set, so a slow job in flight is never called
  // stalled while it is still working.
  return nowMs - started > 6 * 3_600_000;
}

/* ---------------------------------------------------------------------------
 * The database half. Everything above is pure; everything below touches rows.
 * ------------------------------------------------------------------------- */

/**
 * Rows read and deleted per round trip.
 *
 * 200, and the number is load-bearing rather than a taste. The delete names its
 * rows by primary key in the QUERY STRING, so the batch size is really a URL
 * length: a uuid costs about 39 characters there, and PostgREST sits behind a
 * 16KB header limit. This shipped at 2000, which is a 78KB request line, and
 * every prune since has died inside undici with UND_ERR_HEADERS_OVERFLOW before
 * the request ever left the machine. 200 ids is roughly 8KB, half the ceiling.
 *
 * It also has to stay at or below PostgREST's 1000-row response cap, which the
 * old value silently breached from the other direction: `.limit(2000)` returned
 * 1000 rows, `1000 < room` read as "that was the last page", and the loop broke
 * after one iteration. Two bugs pointing the same way, so the table never lost
 * a single row.
 */
export const PRUNE_BATCH = 200;
/**
 * Ceiling on one run's deletions.
 *
 * PostgREST runs each statement under an 8-second timeout, so a single unbounded
 * delete over a six-figure table would be killed halfway and roll back. Batching
 * is what makes the work possible at all; this cap is what keeps one run inside
 * the route's maxDuration: 40,000 rows is 200 select-and-delete pairs, measured
 * at about 460ms each against production, so roughly 95 seconds of a 300-second
 * budget. A large backlog takes several nights to clear, which is fine for
 * housekeeping.
 */
const PRUNE_MAX_PER_RUN = 40_000;

export type PruneOutcome = {
  deleted: number;
  /** True when the cap stopped it early, so tomorrow has more to do. */
  capped: boolean;
  byWindow: Array<{ retentionDays: number; jobs: number; deleted: number }>;
};

/**
 * Turn whatever the client rejected with into something a log line can read.
 *
 * Every failure on this path arrives as a plain object, not an Error: PostgREST
 * returns `{message, details, hint, code}` and a transport failure is wrapped in
 * the same shape. The caller stringifies with `String(err)`, so for a year the
 * only record of a prune that had never once succeeded was the literal text
 * `[object Object]` in the cron result, which is indistinguishable from no
 * diagnosis at all. The hint is included because Supabase puts the actual
 * remedy there.
 */
function asError(raw: unknown, context: string): Error {
  if (raw instanceof Error) return raw;
  const parts =
    raw && typeof raw === "object"
      ? (["message", "code", "details", "hint"] as const)
          .map((k) => (raw as Record<string, unknown>)[k])
          .filter((v): v is string => typeof v === "string" && v.length > 0)
      : [String(raw)];
  return new Error(`${context}: ${parts.join(" | ") || "no detail returned"}`);
}

/**
 * Delete ledger rows past their job's retention window.
 *
 * Deletes by primary key in batches rather than by predicate. A `delete` with an
 * `lt(started_at)` filter over 100,000+ rows is one statement, and one statement
 * is what the 8-second timeout kills; selecting a bounded page of ids and
 * deleting exactly those is bounded work per round trip.
 *
 * Rows still marked 'running' are never pruned. They are the only evidence that
 * an invocation started and died, which is precisely the thing worth keeping.
 */
export async function pruneCronRuns(
  supabase: SupabaseClient<Database>,
  jobs: ReadonlyArray<CronJobLike>,
  nowMs: number,
): Promise<PruneOutcome> {
  // Group by window so each retention period is one pass rather than one per
  // job. Two groups today (7 days and 365), and it stays two however many jobs
  // are added.
  const byWindow = new Map<number, string[]>();
  for (const job of jobs) {
    const days = retentionDaysFor(job.schedule);
    const list = byWindow.get(days) ?? [];
    list.push(job.name);
    byWindow.set(days, list);
  }

  const out: PruneOutcome = { deleted: 0, capped: false, byWindow: [] };

  for (const [retentionDays, names] of [...byWindow.entries()].sort((a, b) => a[0] - b[0])) {
    const cutoff = new Date(nowMs - retentionDays * 86_400_000).toISOString();
    let deletedHere = 0;

    for (;;) {
      if (out.deleted >= PRUNE_MAX_PER_RUN) {
        out.capped = true;
        break;
      }
      const room = Math.min(PRUNE_BATCH, PRUNE_MAX_PER_RUN - out.deleted);

      const { data, error } = await supabase
        .from("cron_runs")
        .select("id")
        .in("job_name", names)
        .lt("started_at", cutoff)
        .neq("status", "running")
        .limit(room);
      if (error) throw asError(error, "selecting expired cron_runs ids");

      const ids = (data ?? []).map((r) => r.id);
      if (ids.length === 0) break;

      const { error: delErr } = await supabase.from("cron_runs").delete().in("id", ids);
      if (delErr) throw asError(delErr, `deleting ${ids.length} cron_runs rows`);

      deletedHere += ids.length;
      out.deleted += ids.length;
      if (ids.length < room) break;
    }

    out.byWindow.push({ retentionDays, jobs: names.length, deleted: deletedHere });
    if (out.capped) break;
  }

  return out;
}

/**
 * The most recent start per job, and any run left marked 'running'.
 *
 * One indexed lookup per job over (job_name, started_at desc), the index
 * migration 0032 already created for the admin health panel.
 */
export async function loadCronLedgerState(
  supabase: SupabaseClient<Database>,
  jobs: ReadonlyArray<CronJobLike>,
  nowMs: number,
): Promise<{
  lastRunByJob: Map<string, string>;
  stalled: Array<{ name: string; startedAt: string }>;
}> {
  const lastRunByJob = new Map<string, string>();
  const stalled: Array<{ name: string; startedAt: string }> = [];

  const results = await Promise.all(
    jobs.map(async (job) => {
      const { data, error } = await supabase
        .from("cron_runs")
        .select("started_at, status")
        .eq("job_name", job.name)
        .order("started_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return { job, row: data?.[0] ?? null };
    }),
  );

  for (const { job, row } of results) {
    if (!row) continue;
    lastRunByJob.set(job.name, row.started_at);
    if (row.status === "running" && isStaleRunning(row.started_at, nowMs)) {
      stalled.push({ name: job.name, startedAt: row.started_at });
    }
  }

  return { lastRunByJob, stalled };
}
