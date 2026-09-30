/**
 * The league-maintenance cron's work, as a library so it can be tested.
 *
 * Two jobs, both bounded, neither of which iterates leagues in general or
 * recomputes any model (CLAUDE.md forbids per-league work in a cron):
 *
 * 1. STUCK SYNCS. `pulse_status = 'syncing'` is the in-progress marker
 *    pulseLeagueCore writes before it goes to Sleeper. A function killed mid
 *    sync (a timeout, a deploy) leaves it there, and a row that says "syncing"
 *    forever reads to an admin as live work. One UPDATE flips every row that
 *    has said so for longer than STUCK_SYNC_MS to `error` with a reason, which
 *    is a state isLeaguePulseFresh never treats as fresh, so the next view or
 *    queue job resyncs it. The update is conditional on the row still being
 *    `syncing` and still old, so a sync that finishes meanwhile is untouched.
 *
 * 2. DELETED LEAGUES. A league whose last sync ended with Sleeper answering that
 *    it does not exist (LEAGUE_NOT_FOUND_ERROR) may never be viewed again, so
 *    nothing would ever take the second look lib/league-removal.ts requires
 *    before deleting it. This takes that look, for at most
 *    NOT_FOUND_BATCH_SIZE leagues per run, oldest first, through the Sleeper
 *    call budget.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { mapLimit } from "@/lib/sleeper";
import { countSleeperCalls } from "@/lib/sleeper-budget";
import { checkLeagueStillMissing, LEAGUE_NOT_FOUND_ERROR } from "@/lib/league-removal";

type ServiceClient = SupabaseClient<Database>;

/** How long a league may say `syncing` before it is treated as interrupted. */
export const STUCK_SYNC_MS = 30 * 60 * 1000;

/** At most this many not-found leagues are rechecked per run. */
export const NOT_FOUND_BATCH_SIZE = 25;

/** How many of those rechecks run at once. The budget paces them either way. */
const NOT_FOUND_CONCURRENCY = 5;

export const STUCK_SYNC_ERROR = "Sync interrupted before it finished; the next view resyncs it";

export type LeagueMaintenanceResult = {
  stuckSyncsReset: number;
  notFound: {
    checked: number;
    stillThere: number;
    requestFailed: number;
    firstSightings: number;
    waiting: number;
    deleted: number;
    errors: string[];
  };
  sleeperCalls: number;
};

export async function resetStuckSyncs(
  supabase: ServiceClient,
  now: number = Date.now(),
): Promise<number> {
  const cutoff = new Date(now - STUCK_SYNC_MS).toISOString();
  const { data, error } = await supabase
    .from("leagues")
    .update({
      pulse_status: "error",
      pulse_error: STUCK_SYNC_ERROR,
      updated_at: new Date(now).toISOString(),
    })
    .eq("pulse_status", "syncing")
    .lt("updated_at", cutoff)
    .select("id");
  if (error) throw new Error(`stuck sync reset failed: ${error.message}`);
  return (data ?? []).length;
}

export async function recheckNotFoundLeagues(
  supabase: ServiceClient,
  now: number = Date.now(),
): Promise<LeagueMaintenanceResult["notFound"]> {
  const out: LeagueMaintenanceResult["notFound"] = {
    checked: 0,
    stillThere: 0,
    requestFailed: 0,
    firstSightings: 0,
    waiting: 0,
    deleted: 0,
    errors: [],
  };
  const { data, error } = await supabase
    .from("leagues")
    .select("id, sleeper_league_id")
    .eq("pulse_error", LEAGUE_NOT_FOUND_ERROR)
    .order("updated_at", { ascending: true })
    .limit(NOT_FOUND_BATCH_SIZE);
  if (error) throw new Error(`not-found league read failed: ${error.message}`);

  const leagues = data ?? [];
  const results = await mapLimit(leagues, NOT_FOUND_CONCURRENCY, (league) =>
    checkLeagueStillMissing(supabase, league, now),
  );
  results.forEach((result, i) => {
    out.checked += 1;
    if (result.status === "found") out.stillThere += 1;
    else if (result.status === "failed") out.requestFailed += 1;
    else if (result.outcome === "first_sighting") out.firstSightings += 1;
    else if (result.outcome === "waiting") out.waiting += 1;
    else if (result.outcome === "deleted") out.deleted += 1;
    else out.errors.push(`${leagues[i].sleeper_league_id}: ${result.error}`);
  });
  return out;
}

/**
 * Both jobs. The not-found rechecks run inside `countSleeperCalls`, which is the
 * budget's job scope: token waits are patient and a 429 is retried once after
 * Retry-After, the same treatment the queue worker gets, because nobody is
 * waiting on this run.
 */
export async function runLeagueMaintenance(
  supabase: ServiceClient,
  now: number = Date.now(),
): Promise<LeagueMaintenanceResult> {
  const stuckSyncsReset = await resetStuckSyncs(supabase, now);
  const { result: notFound, calls } = await countSleeperCalls(() =>
    recheckNotFoundLeagues(supabase, now),
  );
  return { stuckSyncsReset, notFound, sleeperCalls: calls };
}
