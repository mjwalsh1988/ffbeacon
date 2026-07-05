/**
 * Cron run ledger helpers.
 *
 * recordCronRun() wraps a cron handler so every invocation lands a row in
 * public.cron_runs (migration 0032): one "running" row at the start, updated to
 * success / error / skipped at the end with a duration and the handler's JSON
 * result. The admin panel reads these to answer "did last night's crons run and
 * succeed?" without inspecting data freshness by hand.
 *
 * Logging is best-effort: a failure to write the ledger NEVER breaks the actual
 * cron work or masks its error. The real result (or thrown error) always
 * propagates to the route handler unchanged.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";

export type CronJobName =
  | "sync-ktc"
  | "sync-fantasycalc"
  | "sync-dynastyprocess"
  | "recalculate-beacon"
  | "recalculate-derived"
  | "sync-sleeper-stats"
  | "sync-sleeper-market"
  | "beacon-brief-curate"
  | "beacon-brief-worker";

export type CronRunStatus = "running" | "success" | "error" | "skipped";

/**
 * Canonical registry of scheduled jobs. Drives the admin health panel so a job
 * that has never run still shows up (as "no runs yet") rather than silently
 * missing. Keep `name` in lockstep with the route folder under app/api/cron and
 * `schedule` in lockstep with vercel.json.
 */
export const CRON_JOBS: ReadonlyArray<{
  name: CronJobName;
  label: string;
  schedule: string;
  scheduleHuman: string;
  description: string;
}> = [
  {
    name: "sync-ktc",
    label: "KTC value sync",
    schedule: "0 7 * * *",
    scheduleHuman: "Daily, 07:00 UTC",
    description:
      "Scrapes KeepTradeCut and writes player_value_history + draft_pick_values.",
  },
  {
    name: "sync-fantasycalc",
    label: "FantasyCalc value sync",
    schedule: "0 8 * * *",
    scheduleHuman: "Daily, 08:00 UTC",
    description: "Pulls FantasyCalc current values into player_value_history.",
  },
  {
    name: "sync-dynastyprocess",
    label: "DynastyProcess value sync",
    schedule: "0 9 * * *",
    scheduleHuman: "Daily, 09:00 UTC",
    description:
      "Pulls DynastyProcess FantasyPros-derived dynasty values into player_value_history.",
  },
  {
    name: "recalculate-beacon",
    label: "FF Beacon value recalc",
    schedule: "30 9 * * *",
    scheduleHuman: "Daily, 09:30 UTC",
    description:
      "Recomputes FF Beacon proprietary values (all signals) into player_value_history + draft_pick_values, after the source syncs and before the derived recalc.",
  },
  {
    name: "recalculate-derived",
    label: "Rankings + trends recalc",
    schedule: "0 10 * * *",
    scheduleHuman: "Daily, 10:00 UTC",
    description:
      "Rebuilds the global rankings and player_value_trends tables from the latest values.",
  },
  {
    name: "sync-sleeper-stats",
    label: "Sleeper stats sync",
    schedule: "0 9 * 1,2,8,9,10,11,12 *",
    scheduleHuman: "Daily 09:00 UTC, NFL months only",
    description:
      "Refreshes current-season player_stats from Sleeper. Skips in the off-season.",
  },
  {
    name: "sync-sleeper-market",
    label: "Draft-market ADP sync",
    schedule: "0 11 * * *",
    scheduleHuman: "Daily, 11:00 UTC",
    description:
      "Refreshes Sleeper ADP (every format) + season projections into player_market_snapshots, then rookie ADP (FantasyPros rookie rankings via DynastyProcess) under the 'rookie' key. Historical: one partition per night.",
  },
  {
    name: "beacon-brief-curate",
    label: "Beacon Brief curation",
    schedule: "*/5 * * * *",
    scheduleHuman: "Every 5 minutes",
    description:
      "Ingests new source posts, scores/categorizes them, and enqueues Discord + article work (fast path only).",
  },
  {
    name: "beacon-brief-worker",
    label: "Beacon Brief queue worker",
    schedule: "* * * * *",
    scheduleHuman: "Every minute",
    description:
      "Drains the Beacon Brief queue: Discord posts/patches, article writing, and deletion checks, with throttle and backoff.",
  },
];

function isSkippedResult(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { skipped?: unknown }).skipped === true
  );
}

/**
 * Run `fn` and record the invocation in cron_runs. Returns whatever `fn`
 * returns; rethrows whatever `fn` throws (after recording the failure).
 */
export async function recordCronRun<T>(
  admin: SupabaseClient<Database>,
  jobName: CronJobName,
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  let runId: string | null = null;

  try {
    const { data } = await admin
      .from("cron_runs")
      .insert({ job_name: jobName, status: "running", started_at: startedAt })
      .select("id")
      .single();
    runId = data?.id ?? null;
  } catch (err) {
    console.warn(
      `[cron-runs] could not record start for ${jobName}:`,
      errMsg(err),
    );
  }

  const finalize = async (
    status: CronRunStatus,
    fields: { result?: Json | null; error?: string | null },
  ): Promise<void> => {
    const payload = {
      status,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      result: fields.result ?? null,
      error: fields.error ?? null,
    };
    try {
      if (runId) {
        await admin.from("cron_runs").update(payload).eq("id", runId);
      } else {
        // Start insert failed earlier; still leave a terminal record.
        await admin
          .from("cron_runs")
          .insert({ job_name: jobName, started_at: startedAt, ...payload });
      }
    } catch (err) {
      console.warn(
        `[cron-runs] could not record finish for ${jobName}:`,
        errMsg(err),
      );
    }
  };

  try {
    const result = await fn();
    await finalize(isSkippedResult(result) ? "skipped" : "success", {
      result: result as unknown as Json,
    });
    return result;
  } catch (err) {
    await finalize("error", { error: errMsg(err) });
    throw err;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Flatten a cron result's well-known numeric/string fields into short label,
 * value pairs for compact display. Unknown shapes return an empty list so the
 * UI can fall back to the raw JSON.
 */
export function summarizeCronResult(
  result: Json | null,
): Array<{ label: string; value: string }> {
  if (!result || typeof result !== "object" || Array.isArray(result)) return [];
  const r = result as Record<string, unknown>;
  const pairs: Array<{ label: string; value: string }> = [];
  const push = (label: string, key: string) => {
    const v = r[key];
    if (typeof v === "number" || typeof v === "string") {
      pairs.push({ label, value: String(v) });
    }
  };
  push("Value rows", "totalValueRows");
  push("Rows", "totalRows");
  push("Pick rows", "totalPickRows");
  push("Trend rows", "written");
  push("Combos", "combos");
  push("Unmatched", "unmatched");
  push("Merged players", "mergedPlayers");
  push("Inserted", "inserted");
  push("Updated", "updated");
  if (r.skipped === true) pairs.push({ label: "Skipped", value: "yes" });
  if (typeof r.reason === "string")
    pairs.push({ label: "Reason", value: r.reason });
  return pairs;
}
