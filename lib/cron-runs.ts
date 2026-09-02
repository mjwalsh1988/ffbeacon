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
import { SITE_TIME_ZONE } from "./datetime";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Plain-language, Eastern-time description of a cron expression.
 *
 * Vercel schedules in UTC, but every time shown on this site reads in
 * America/New_York, so the label is DERIVED from the expression rather than
 * written by hand. That matters twice over: a hardcoded "07:00 UTC" makes the
 * reader do the conversion, and a hardcoded "3:00 AM ET" would be wrong for half
 * the year, because the UTC-to-Eastern offset moves with daylight saving while
 * the cron does not. Resolving it against `nowMs` means the panel says 3:00 AM
 * EDT in August and 2:00 AM EST in January, which is what actually happens.
 *
 * Deriving it also removes the drift risk that came with keeping a separate
 * human string in lockstep with vercel.json by hand.
 */
export function describeCronSchedule(
  schedule: string,
  nowMs: number = Date.now(),
): string {
  if (!schedule.trim()) return "Not scheduled";

  const [minute, hour, , month] = schedule.trim().split(/\s+/);
  if (minute === undefined || hour === undefined) return schedule;

  // Sub-hourly jobs have no meaningful time of day, so no conversion applies.
  if (hour === "*") {
    if (minute === "*") return "Every minute";
    const everyN = /^\*\/(\d+)$/.exec(minute);
    if (everyN) return `Every ${everyN[1]} minutes`;
    return `Hourly at :${minute.padStart(2, "0")}`;
  }

  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return schedule;

  // Anchor to today's date so the EST/EDT label reflects the offset in force
  // now. A daily job keeps its Eastern time of day even when that lands on the
  // previous calendar day in UTC, so time-of-day alone is unambiguous here.
  const now = new Date(nowMs);
  const at = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m),
  );
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: SITE_TIME_ZONE,
    timeZoneName: "short",
  }).format(at);

  if (month && month !== "*") {
    const names = month
      .split(",")
      .map((part) => MONTH_NAMES[Number(part) - 1])
      .filter(Boolean);
    if (names.length > 0) return `Daily, ${time}, ${names.join(", ")} only`;
  }
  return `Daily, ${time}`;
}

export type CronJobName =
  | "sync-sleeper-players"
  | "sync-ktc"
  | "sync-fantasycalc"
  | "sync-dynastyprocess"
  | "recalculate-beacon"
  | "recalculate-derived"
  | "beacon-reference-drift"
  | "beacon-reference-rebuild"
  | "sync-sleeper-stats"
  | "sync-sleeper-market"
  | "sync-weekly-projections"
  | "sync-nfl-odds"
  | "build-beacon-projections"
  | "beacon-brief-curate"
  | "beacon-brief-worker"
  | "league-sync-worker"
  | "would-you-rather-discord"
  | "rebuild-draft-value"
  | "league-relay"
  | "cron-health";

export type CronRunStatus = "running" | "success" | "error" | "skipped";

/**
 * Canonical registry of scheduled jobs. Drives the admin health panel so a job
 * that has never run still shows up (as "no runs yet") rather than silently
 * missing. Keep `name` in lockstep with the route folder under app/api/cron and
 * `schedule` in lockstep with vercel.json.
 *
 * The cron expression is the only schedule stored here. Its human, Eastern-time
 * label comes from describeCronSchedule() above, so there is no second copy to
 * keep in step and no hand-written zone that goes stale at the daylight-saving
 * boundary.
 *
 * An empty `schedule` means the route exists and is callable but is not wired
 * into vercel.json yet. Nothing is in that state right now.
 */
export const CRON_JOBS: ReadonlyArray<{
  name: CronJobName;
  label: string;
  schedule: string;
  description: string;
}> = [
  {
    name: "sync-sleeper-players",
    label: "Player dimension sync",
    schedule: "0 6 * * *",
    description:
      "Refreshes every fantasy-relevant NFL player from Sleeper: names, teams, positions, and the injury designations (IR, PUP, Questionable, ...) that decide whether a player is projected at all. Runs FIRST each night, because the value syncs, the weekly projections sync and every derived recalc read those designations. This job existed but was never scheduled until 2026-08-25; the table sat unchanged from 2026-05-18, projecting injured players as healthy and healthy players as out.",
  },
  {
    name: "sync-ktc",
    label: "KTC value sync",
    schedule: "0 7 * * *",
    description:
      "Scrapes KeepTradeCut and writes player_value_history + draft_pick_values.",
  },
  {
    name: "sync-fantasycalc",
    label: "FantasyCalc value sync",
    schedule: "0 8 * * *",
    description: "Pulls FantasyCalc current values into player_value_history.",
  },
  {
    name: "sync-dynastyprocess",
    label: "DynastyProcess value sync",
    schedule: "0 9 * * *",
    description:
      "Pulls DynastyProcess FantasyPros-derived dynasty values into player_value_history.",
  },
  {
    name: "recalculate-beacon",
    label: "FF Beacon value recalc",
    schedule: "30 9 * * *",
    description:
      "Recomputes FF Beacon proprietary values (all signals) into player_value_history + draft_pick_values, after the source syncs and before the derived recalc.",
  },
  {
    name: "recalculate-derived",
    label: "Rankings + trends recalc",
    schedule: "0 10 * * *",
    description:
      "Rebuilds the global rankings and player_value_trends tables from the latest values.",
  },
  {
    name: "rebuild-draft-value",
    label: "Beacon Steals board rebuild",
    schedule: "0 15 * * *",
    description:
      "Rebuilds draft_market_adp from the synced pick ledger, then the draft_value_targets board the draft guide renders. Runs after rankings, ADP, and weekly projections so every input is same-day fresh. Global (one row per format, season, player), so it never iterates leagues.",
  },
  {
    name: "beacon-reference-rebuild",
    label: "Calibration reference rebuild",
    schedule: "0 13 * * *",
    description:
      "Rebuilds the stored calibration reference for any format whose reference has passed the rebuild cadence, so in practice about once a month per format; every other night it reports skipped. Runs after the whole daily pipeline so a new reference takes effect on the NEXT morning's recompute rather than landing mid-cycle. Refuses to build while a source is missing or stale, or the shared set is thin, leaving the current reference live.",
  },
  {
    name: "beacon-reference-drift",
    label: "Calibration drift check",
    schedule: "0 14 * * *",
    description:
      "Builds a candidate calibration reference in memory, compares the board it would produce against the stored one, and emails an alert if anything crosses the configured limits. Never persists or activates the candidate. Runs after the rebuild job, so on a rebuild night it confirms the result and on every other night it is the early warning that the stored reference is drifting.",
  },
  {
    name: "sync-sleeper-stats",
    label: "Sleeper stats sync",
    schedule: "0 9 * 1,2,8,9,10,11,12 *",
    description:
      "Refreshes current-season player_stats from Sleeper, then everything derived from them: positional finishes, opponent strength (nfl_defense_vs_position) and projection accuracy (player_projection_accuracy). Skips in the off-season. The last two were unscheduled until 2026-08-25, which would have frozen strength of schedule on prior seasons and left Power Pulse unable to learn anything about the current one.",
  },
  {
    name: "sync-sleeper-market",
    label: "Draft-market ADP sync",
    schedule: "0 11 * * *",
    description:
      "Refreshes Sleeper ADP (every format) + season projections into player_market_snapshots, then rookie ADP (FantasyPros rookie rankings via DynastyProcess) under the 'rookie' key. Historical: one partition per night.",
  },
  {
    name: "sync-weekly-projections",
    label: "Weekly projections sync",
    schedule: "0 12 * * *",
    description:
      "Refreshes Sleeper per-week projected points for the current season's upcoming weeks into player_weekly_projections (overwrite in place). Skips cleanly when nothing is published yet.",
  },
  {
    name: "sync-nfl-odds",
    label: "Game odds sync",
    schedule: "0 13 * * *",
    description:
      "Refreshes ESPN's published game total and spread for the current week plus the next two into nfl_game_odds (overwrite in place), the game-environment signal the projection engine's volume and script adjustments read. Lines move through the week, so a once-daily pull is the right cadence for a table whose only consumer is a weekly projection. Skips cleanly when ESPN has nothing published yet for every targeted week; a week whose fetch failed outright is never mistaken for a week with no games.",
  },
  {
    name: "build-beacon-projections",
    label: "FF Beacon projections build",
    schedule: "30 14 * * *",
    description:
      "Builds our own weekly projections into player_weekly_projections with source 'ffbeacon', for the rest of the live season. Runs last in the day because it reads what three earlier jobs write: the usage history from sync-sleeper-stats at 09:00, the blend partner and the list of weeks that exist at all from sync-weekly-projections at 12:00, and the game environment from sync-nfl-odds at 13:00. Building before any of those would build on yesterday's inputs. Skips cleanly when there are no Sleeper rows for the window, because an ffbeacon source that exists but covers nothing would be selected by the reader and then answer every question with silence.",
  },
  {
    name: "beacon-brief-curate",
    label: "Beacon Brief curation",
    schedule: "*/5 * * * *",
    description:
      "Ingests new source posts, scores/categorizes them, and enqueues Discord + article work (fast path only).",
  },
  {
    name: "beacon-brief-worker",
    label: "Beacon Brief queue worker",
    schedule: "* * * * *",
    description:
      "Drains the Beacon Brief queue: Discord posts/patches, article writing, and deletion checks, with throttle and backoff.",
  },
  {
    name: "league-sync-worker",
    label: "League Pulse Sync all worker",
    schedule: "* * * * *",
    description:
      "Drains the Sync all queue from My Sleeper Leagues: up to four league pulses per run, paced, with backoff and a reaper for stalled jobs. Idle runs cost one indexed read.",
  },
  {
    name: "would-you-rather-discord",
    label: "Would You Rather Discord poll",
    schedule: "0 * * * *",
    description:
      "Ticks hourly and almost always does nothing. Whether it posts is decided by the times an admin picked at /admin/would-you-rather, read in America/New_York, so the frequency is a setting rather than a cron expression and it holds its Eastern time across daylight saving. On a scheduled hour it posts one anonymised trade to Discord as a poll; on every tick it also folds any poll past its close time into that trade's tally, exactly once each. Off by default: nothing posts until a webhook is chosen and the toggle is turned on.",
  },
  {
    name: "league-relay",
    label: "League Relay",
    schedule: "*/15 * * * *",
    description:
      "Resyncs every league an admin marked as a community league, then writes up what changed and posts it to Discord: trades through Signal Check and the trade impact model, waiver claims, a Wednesday matchup preview and a Tuesday recap run. The cadence here is the RESYNC; what actually posts is decided by the message types and Eastern-time windows an admin picked at /admin/league-relay. Off by default, so until somebody turns it on this reads one settings row and returns.",
  },
  {
    name: "cron-health",
    label: "Schedule health check",
    schedule: "0 16 * * *",
    description:
      "Reads this registry, finds any job that should have run by now and has not, and emails when one is missing. A job that never fires writes no row, so a missed run is invisible to every other view here; this is the only thing that can see it. Also prunes the ledger: a week of the minute-by-minute workers, a year of everything else. Runs last in the day so every other job has had its window.",
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

/** How much of one error we are willing to store. Long enough for a stack-free
 *  Postgrest payload, short enough that a runaway object cannot bloat the row. */
const MAX_ERROR_CHARS = 2000;

/**
 * A readable message from anything that was thrown.
 *
 * `String(err)` on a plain object is "[object Object]", and Supabase throws
 * PostgrestError, which is a plain object. That is how the one genuine
 * beacon-reference-rebuild failure in this ledger came to be recorded as
 * "[object Object]" with its message, code, details and hint all discarded, and
 * why nobody can now say what went wrong that night. Anything object-shaped gets
 * its named fields pulled out first, and falls back to JSON rather than to the
 * default toString.
 */
function errMsg(err: unknown): string {
  const raw = describeError(err);
  return raw.length > MAX_ERROR_CHARS
    ? `${raw.slice(0, MAX_ERROR_CHARS)} [truncated]`
    : raw;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name || "Error";
  if (typeof err === "string") return err;
  if (err === null || err === undefined) return String(err);
  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    // The PostgrestError shape, and the shape most SDK errors settle on.
    const named = ["message", "code", "details", "hint"]
      .map((k) => {
        const v = o[k];
        if (typeof v === "string" && v.trim()) return `${k}: ${v.trim()}`;
        if (typeof v === "number") return `${k}: ${v}`;
        return null;
      })
      .filter((part): part is string => part !== null);
    if (named.length > 0) return named.join(" | ");
    try {
      const json = JSON.stringify(err);
      if (json && json !== "{}") return json;
    } catch {
      // Circular, or something with a throwing getter. Fall through.
    }
    return "Unrecognised error object with no message";
  }
  return String(err);
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
