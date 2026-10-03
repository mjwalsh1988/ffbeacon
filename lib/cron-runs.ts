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
 *
 * A run recorded as `error` (a throw, a `failedSteps` list, or a blown time
 * budget) also emails the owner straight away through lib/cron-alerts.ts, at
 * most once per job per cooldown. The daily cron-health digest still runs.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";
import { SITE_TIME_ZONE } from "./datetime";
import { isHeartbeatMinute } from "./cron-health";
import { ALERT_MARKER_KEY, maybeAlertCronFailure } from "./cron-alerts";

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
  | "sync-nfl-weather"
  | "build-beacon-projections"
  | "beacon-brief-curate"
  | "beacon-brief-worker"
  | "league-sync-worker"
  | "would-you-rather-discord"
  | "rebuild-draft-value"
  | "league-relay"
  | "ranking-guest-cleanup"
  | "community-rankings"
  | "league-maintenance"
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
 *
 * `schedule` is the job's one DAILY (or sub-hourly) run, the one cron-health
 * measures a gap against and the admin panels describe. `extraSchedules` are
 * the additional vercel.json entries for the same path: the game-day refreshes
 * of the player and projection syncs, and the weather sync's three game-day
 * passes (the same route with ?scope=gameday). The first two restrict the day
 * of week and the third skips itself on a day without a game, so cron-health
 * deliberately does not model any of them (a missed game-day run is covered by
 * the daily one landing within its window). lib/cron-schedule-sync.test.ts
 * fails when this registry and vercel.json disagree in either direction; it
 * compares the route and ignores a query string.
 */
export type CronJobEntry = {
  name: CronJobName;
  label: string;
  schedule: string;
  extraSchedules?: readonly string[];
  description: string;
};

/**
 * Game-day refreshes for the injury and projection syncs.
 *
 * The owner's rule: once a day on Tuesday, Wednesday, Friday and Saturday; on
 * Sunday, Monday and Thursday a few runs before kickoff and a couple after. The
 * daily 06:00 UTC player run is 2:00 AM EDT / 1:00 AM EST, which is already after
 * every night game, so on Monday, Tuesday and Friday it doubles as the
 * post-game run and those days get no extra entry beyond Monday's.
 *
 * Every time is chosen to land after inactives (about 90 minutes before
 * kickoff) and before kickoff in BOTH offsets, because Vercel schedules in UTC
 * and daylight saving moves Eastern by an hour. The player sync runs ten
 * minutes ahead of the projection sync each time, so a projection is never
 * built on an older injury designation than the one just stored.
 *
 *   UTC    players  projections  EDT (UTC-4)        EST (UTC-5)        covers
 *   13:05  13:15    Sun          9:05 / 9:15 AM     8:05 / 8:15 AM     London 9:30 AM
 *   16:35  16:45    Sun Mon Thu  12:35 / 12:45 PM   11:35 / 11:45 AM   1:00 PM games
 *   19:45  19:55    Sun Mon Thu  3:45 / 3:55 PM     2:45 / 2:55 PM     4:05 and 4:25 PM
 *   23:45  23:55    Sun Mon Thu  7:45 / 7:55 PM     6:45 / 6:55 PM     8:15 and 8:20 PM
 *   05:15  05:25    Mon          1:15 / 1:25 AM     12:15 / 12:25 AM   after Sunday night
 *
 * Month-restricted to September through February, so the off-season spends
 * nothing on them. Sunday's 23:45 run also lands after the late afternoon
 * games end, so Sunday gets two post-game passes (23:45 and Monday 05:15)
 * before the Monday 06:00 daily run.
 */
export const GAME_DAY_MONTHS = "1,2,9,10,11,12";
export const PLAYERS_GAME_DAY_SCHEDULES: readonly string[] = [
  `5 13 * ${GAME_DAY_MONTHS} 0`,
  `35 16 * ${GAME_DAY_MONTHS} 0,1,4`,
  `45 19 * ${GAME_DAY_MONTHS} 0,1,4`,
  `45 23 * ${GAME_DAY_MONTHS} 0,1,4`,
  `15 5 * ${GAME_DAY_MONTHS} 1`,
];
export const PROJECTIONS_GAME_DAY_SCHEDULES: readonly string[] = [
  `15 13 * ${GAME_DAY_MONTHS} 0`,
  `45 16 * ${GAME_DAY_MONTHS} 0,1,4`,
  `55 19 * ${GAME_DAY_MONTHS} 0,1,4`,
  `55 23 * ${GAME_DAY_MONTHS} 0,1,4`,
  `25 5 * ${GAME_DAY_MONTHS} 1`,
];

/**
 * The weather sync's schedule.
 *
 * The nightly pass at 13:45 UTC sits between the odds sync (13:15), whose
 * kickoff times it reads, and the projection build (14:30). It covers every
 * game of the next seven days.
 *
 * The three game-day passes hit /api/cron/sync-nfl-weather?scope=gameday and
 * refresh only games kicking off within 24 hours, which is where a forecast is
 * materially better than it was at five days. They fire every day rather than
 * on named days of the week, because the route skips itself before any
 * provider request when no game is that close, and a Saturday or Christmas
 * game then needs no schedule change.
 *
 *   UTC    EDT (UTC-4)  EST (UTC-5)  covers
 *   12:15  8:15 AM      7:15 AM      a 9:30 AM game abroad
 *   15:00  11:00 AM     10:00 AM     the 1:00 PM games
 *   21:00  5:00 PM      4:00 PM      the night game
 *
 * August through February, the months sync-sleeper-stats runs in. In August
 * every pass is a clean skip until week 1 is inside its window.
 */
export const WEATHER_MONTHS = "1,2,8,9,10,11,12";
export const WEATHER_NIGHTLY_SCHEDULE = `45 13 * ${WEATHER_MONTHS} *`;
export const WEATHER_GAME_DAY_SCHEDULES: readonly string[] = [
  `15 12 * ${WEATHER_MONTHS} *`,
  `0 15 * ${WEATHER_MONTHS} *`,
  `0 21 * ${WEATHER_MONTHS} *`,
];

/** Every schedule a job fires on: its daily run first, then any extras. */
export function allSchedules(job: Pick<CronJobEntry, "schedule" | "extraSchedules">): string[] {
  return [job.schedule, ...(job.extraSchedules ?? [])].filter((s) => s.trim().length > 0);
}

export const CRON_JOBS: ReadonlyArray<CronJobEntry> = [
  {
    name: "sync-sleeper-players",
    label: "Player dimension sync",
    schedule: "0 6 * * *",
    extraSchedules: PLAYERS_GAME_DAY_SCHEDULES,
    description:
      "Refreshes every fantasy-relevant NFL player from Sleeper: names, teams, positions, and the injury designations (IR, PUP, Questionable, ...) that decide whether a player is projected at all. Runs FIRST each night, because the value syncs, the weekly projections sync and every derived recalc read those designations. On Sundays, Mondays and Thursdays in season it also runs before each kickoff window and after the night games, ten minutes ahead of the projections sync each time, so an injury posted with the inactives reaches the site before the game. This job existed but was never scheduled until 2026-08-25; the table sat unchanged from 2026-05-18, projecting injured players as healthy and healthy players as out.",
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
    schedule: "15 9 * * *",
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
    extraSchedules: PROJECTIONS_GAME_DAY_SCHEDULES,
    description:
      "Refreshes Sleeper per-week projected points for the current season's upcoming weeks into player_weekly_projections (overwrite in place). Skips cleanly when nothing is published yet. The 12:00 UTC run covers every remaining week; the game-day runs on Sundays, Mondays and Thursdays in season (ten minutes after each player sync) refresh only the live week and the next one, which is all an inactive or an in-game injury can move.",
  },
  {
    name: "sync-nfl-odds",
    label: "Game odds sync",
    schedule: "15 13 * * *",
    description:
      "Refreshes ESPN's published game total and spread for the current week plus the next two into nfl_game_odds (overwrite in place), the game-environment signal the projection engine's volume and script adjustments read. Lines move through the week, so a once-daily pull is the right cadence for a table whose only consumer is a weekly projection. Skips cleanly when ESPN has nothing published yet for every targeted week; a week whose fetch failed outright is never mistaken for a week with no games.",
  },
  {
    name: "sync-nfl-weather",
    label: "Game weather sync",
    schedule: WEATHER_NIGHTLY_SCHEDULE,
    extraSchedules: WEATHER_GAME_DAY_SCHEDULES,
    description:
      "Appends a weather forecast snapshot to nfl_game_weather for every regular-season game kicking off in the next seven days: the National Weather Service for open-air US venues, MET Norway for games abroad, and a single indoor row with no provider request for a venue with a roof. Runs after the odds sync, whose kickoff times it reads. Three more passes a day refresh only games kicking off within 24 hours and skip cleanly on a day without one. A failed provider request leaves the previous snapshot as the newest; the run is recorded as failed only when no forecast came back at all.",
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
    name: "ranking-guest-cleanup",
    label: "Beacon Ranker guest board cleanup",
    schedule: "20 * * * *",
    description:
      "Deletes Beacon Ranker boards built by signed-out readers once they have gone unchanged for the retention time set at /admin/beacon-ranker (48 hours by default), which is the deletion time the tool page promises. Iterates guest rows by age through one index, never leagues or accounts. A signed-in reader's boards are never touched.",
  },
  {
    name: "community-rankings",
    label: "Community rankings build",
    schedule: "45 10 * * *",
    description:
      "Rebuilds the community rankings from every saved board that counts: one pairwise strength fit per format over aggregated head-to-head counts, written to community_rankings. Runs after the rankings recalc so each board's pool is read from today's seed rankings. Iterates formats, never leagues or users one by one. A format below the published threshold is still built and stored, so the page can say how many more boards it needs.",
  },
  {
    name: "league-maintenance",
    label: "League maintenance",
    schedule: "*/30 * * * *",
    description:
      "League Pulse housekeeping, every 30 minutes, at /api/cron/league-maintenance.",
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
 * The sub-steps a run reports as failed, from `result.failedSteps`.
 *
 * A handler that runs several independent steps (sync-sleeper-stats and its
 * four derived calcs, sync-sleeper-market and its rookie ADP step) keeps going
 * when one step fails, because the others are worth saving. It must still not
 * be recorded as a success: that is how two nightly calcs timed out for days
 * with the ledger reading green. Such a handler returns
 * `failedSteps: ["defenseSplits: <error>", ...]`, and a non-empty list records
 * the run as `error` (the status cron-health and the admin panel already treat
 * as a failure) while the result itself is kept in full. Pure.
 */
export function failedStepsOf(result: unknown): string[] {
  if (typeof result !== "object" || result === null) return [];
  const steps = (result as { failedSteps?: unknown }).failedSteps;
  if (!Array.isArray(steps)) return [];
  return steps.filter((s): s is string => typeof s === "string" && s.length > 0);
}

/** The registry label for a job, for alert subjects. */
function labelFor(jobName: CronJobName): string {
  return CRON_JOBS.find((j) => j.name === jobName)?.label ?? jobName;
}

/** Thrown by recordCronRun when `timeoutMs` elapses before the handler settles. */
export class CronTimeBudgetError extends Error {
  constructor(jobName: string, timeoutMs: number) {
    super(
      `${jobName} did not finish within its ${Math.round(timeoutMs / 1000)}s time budget and was recorded as failed before the platform limit could kill it. The work may still complete in the background; the next run starts clean.`,
    );
    this.name = "CronTimeBudgetError";
  }
}

/**
 * Race `work` against a timer. On timeout the returned promise rejects with
 * CronTimeBudgetError; `work` itself is not cancelled (nothing in a Supabase
 * or fetch call chain here takes a signal), but the ledger gets a terminal
 * row while the function is still alive to write it.
 */
export function withTimeBudget<T>(
  work: Promise<T>,
  timeoutMs: number,
  jobName: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CronTimeBudgetError(jobName, timeoutMs)), timeoutMs);
  });
  // A late rejection from `work` after the timer won must not surface as unhandled.
  work.catch(() => {});
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** How long a ledger write may take before we give up on it and return anyway. */
const LEDGER_WRITE_BUDGET_MS = 10_000;

/** A ledger write that cannot hold the response hostage when the database hangs. */
async function boundedLedgerWrite(write: () => PromiseLike<unknown>, what: string): Promise<void> {
  try {
    await withTimeBudget(Promise.resolve(write()), LEDGER_WRITE_BUDGET_MS, what);
  } catch (err) {
    console.warn(`[cron-runs] ${what}:`, errMsg(err));
  }
}

/**
 * Run `fn` and record the invocation in cron_runs. Returns whatever `fn`
 * returns; rethrows whatever `fn` throws (after recording the failure).
 *
 * `quietWhen` (PERF-T060) is for a job that ticks far more often than it has
 * anything to say, namely league-sync-worker running every minute against a
 * queue that is idle almost all the time. When it is supplied and the result
 * satisfies it, the ledger row is skipped outright (no insert, no update)
 * rather than the normal two-write running/finalize dance, EXCEPT once an
 * hour, when one row still lands so cron-health's missed-job check keeps
 * seeing the job alive (see isHeartbeatMinute in lib/cron-health.ts). A
 * caller that never passes `quietWhen` gets the original behaviour: an
 * immediate "running" row, updated to a terminal status when `fn` settles,
 * every single time.
 */
export type RecordCronRunOptions<T> = {
  quietWhen?: (result: T) => boolean;
  /**
   * Record the run as failed if `fn` has not settled after this long. Set it
   * below the route's maxDuration: a function the platform kills never reaches
   * the finalize, and its row says "running" until the health pass closes it.
   */
  timeoutMs?: number;
};

export async function recordCronRun<T>(
  admin: SupabaseClient<Database>,
  jobName: CronJobName,
  fn: () => Promise<T>,
  options?: RecordCronRunOptions<T>,
): Promise<T> {
  const timeoutMs = options?.timeoutMs;
  const run =
    timeoutMs && timeoutMs > 0 ? () => withTimeBudget(fn(), timeoutMs, jobName) : fn;
  if (!options?.quietWhen) return recordCronRunAlways(admin, jobName, run);
  return recordCronRunQuiet(admin, jobName, run, options.quietWhen);
}

/**
 * Merge the alert marker into what the row stores. First, so truncation can
 * never be the thing that drops it. Pure apart from the object spread.
 */
function withAlertMarker(result: Json | null, alertedAt: string | null): Json | null {
  if (!alertedAt) return result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return { [ALERT_MARKER_KEY]: alertedAt, ...(result as Record<string, Json>) };
  }
  return { [ALERT_MARKER_KEY]: alertedAt, result };
}

/** The original, unconditional recording: a "running" row up front, a terminal update after. */
async function recordCronRunAlways<T>(
  admin: SupabaseClient<Database>,
  jobName: CronJobName,
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  let runId: string | null = null;

  await boundedLedgerWrite(async () => {
    const { data } = await admin
      .from("cron_runs")
      .insert({ job_name: jobName, status: "running", started_at: startedAt })
      .select("id")
      .single();
    runId = data?.id ?? null;
  }, `could not record start for ${jobName}`);

  const finalize = async (
    status: CronRunStatus,
    fields: { result?: Json | null; error?: string | null },
  ): Promise<void> => {
    // Alert first, so the marker lands in the same write as the terminal status.
    let alertedAt: string | null = null;
    if (status === "error") {
      alertedAt = await maybeAlertCronFailure(admin, {
        jobName,
        label: labelFor(jobName),
        startedAt,
        error: fields.error ?? "No error recorded.",
        partial: fields.result !== undefined && fields.result !== null,
      });
    }
    const payload = {
      status,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      result: withAlertMarker(truncateResult(fields.result ?? null), alertedAt),
      error: fields.error ?? null,
    };
    await boundedLedgerWrite(async () => {
      if (runId) {
        await admin.from("cron_runs").update(payload).eq("id", runId);
      } else {
        // Start insert failed earlier; still leave a terminal record.
        await admin
          .from("cron_runs")
          .insert({ job_name: jobName, started_at: startedAt, ...payload });
      }
    }, `could not record finish for ${jobName}`);
  };

  try {
    const result = await fn();
    const failed = failedStepsOf(result);
    if (failed.length > 0) {
      await finalize("error", {
        result: result as unknown as Json,
        error: `Failed steps: ${failed.join("; ")}`,
      });
    } else {
      await finalize(isSkippedResult(result) ? "skipped" : "success", {
        result: result as unknown as Json,
      });
    }
    return result;
  } catch (err) {
    await finalize("error", { error: errMsg(err) });
    throw err;
  }
}

/**
 * The quiet-aware recording. `fn` always runs; the ledger write happens only
 * when there is something worth reading (an error, a non-quiet result, or
 * the hourly heartbeat), and when it does happen it is a single insert
 * rather than an insert-then-update pair, because by the time this decides
 * to write anything at all it already knows the terminal outcome.
 *
 * This deliberately does not write a "running" row before `fn` starts. A
 * process killed mid-`fn` therefore leaves no row for that tick rather than
 * a stale "running" one, but for a job calling this path (a per-minute
 * worker with its own lease and its own retrying jobs queue) that trade is
 * the point: cron-health's missed-job check still catches genuine, sustained
 * silence within its normal grace window, and a single crashed tick is
 * indistinguishable from an idle one, which is exactly what "quiet" means.
 */
async function recordCronRunQuiet<T>(
  admin: SupabaseClient<Database>,
  jobName: CronJobName,
  fn: () => Promise<T>,
  quietWhen: (result: T) => boolean,
): Promise<T> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();

  const recordFailure = async (error: string, stored: Json | null): Promise<void> => {
    const alertedAt = await maybeAlertCronFailure(admin, {
      jobName,
      label: labelFor(jobName),
      startedAt,
      error,
      partial: stored !== null,
    });
    await boundedLedgerWrite(
      async () =>
        await admin.from("cron_runs").insert({
          job_name: jobName,
          status: "error",
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - started,
          result: withAlertMarker(stored, alertedAt),
          error,
        }),
      `could not record failure for ${jobName}`,
    );
  };

  let result: T;
  try {
    result = await fn();
  } catch (err) {
    // A failure is never quiet: it always gets a row.
    await recordFailure(errMsg(err), null);
    throw err;
  }

  const failed = failedStepsOf(result);
  if (failed.length > 0) {
    await recordFailure(
      `Failed steps: ${failed.join("; ")}`,
      truncateResult(result as unknown as Json),
    );
    return result;
  }

  if (quietWhen(result) && !isHeartbeatMinute(started)) {
    return result;
  }

  await boundedLedgerWrite(
    async () =>
      await admin.from("cron_runs").insert({
        job_name: jobName,
        status: isSkippedResult(result) ? "skipped" : "success",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
        result: truncateResult(result as unknown as Json),
        error: null,
      }),
    `could not record run for ${jobName}`,
  );
  return result;
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
 * PERF-T061: cap on the stored `result` payload. `cron_runs` was 76 MB for
 * 24,810 rows, about 3 kB per row, and `result` is the bulk of it: most jobs
 * report a handful of counters, but a few pass back a large object (a list
 * of errors, an array of names) that dominates the row. 2 kB keeps the
 * common case untouched and bounds the rare one.
 */
const MAX_RESULT_BYTES = 2048;

/**
 * Shrink a cron result to fit MAX_RESULT_BYTES, in a way that still reads as
 * the real result rather than as an opaque blob or invalid JSON.
 *
 * A plain object keeps every top-level key: each value is included as-is
 * while there is room, and a value that would push the payload over budget
 * is replaced with a short marker naming that value's own size, so the
 * small, useful fields (counts, flags, a short message) survive next to a
 * named placeholder for whichever field was actually the problem. Anything
 * that is not a plain object (a bare array, string, or scalar too big to
 * store) has no top-level keys to preserve piecewise, so the whole value is
 * replaced with a marker naming its size instead.
 */
function truncateResult(result: Json | null): Json | null {
  if (result === null) return null;

  const fullBytes = byteLength(result);
  if (fullBytes <= MAX_RESULT_BYTES) return result;

  if (typeof result !== "object" || Array.isArray(result)) {
    return {
      truncated: true,
      original_bytes: fullBytes,
      note: "Result was not an object, so it could not be truncated field by field.",
    };
  }

  const obj = result as Record<string, Json>;
  const out: Record<string, Json> = { truncated: true, original_bytes: fullBytes };
  let used = byteLength(out);

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const valueBytes = byteLength(value);
    const entryBytes = byteLength(key) + valueBytes + 4; // quotes, colon, comma, slack
    if (used + entryBytes > MAX_RESULT_BYTES) {
      out[key] = `[omitted: ${valueBytes} bytes]`;
      used += byteLength(out[key]) + byteLength(key) + 4;
      continue;
    }
    out[key] = value;
    used += entryBytes;
  }

  return out;
}

function byteLength(value: Json): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  } catch {
    return MAX_RESULT_BYTES + 1; // unstringifiable: treat as over budget
  }
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
