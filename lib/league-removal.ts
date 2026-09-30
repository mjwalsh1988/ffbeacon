/**
 * Removing a league Sleeper says no longer exists.
 *
 * A commissioner can delete a league on Sleeper, and until this existed we kept
 * its copy forever: the deep view rendered a retry state on every visit, every
 * sync went back to Sleeper for it, and its trades stayed in the Would You
 * Rather pool. This module is the one place that decides a league is gone and
 * the one place that deletes it.
 *
 * ABSOLUTE RULE: ONLY A DEFINITIVE ANSWER COUNTS, AND ONE IS NEVER ENOUGH.
 * `lookupSleeperLeague` (lib/sleeper.ts) returns `not_found` only when Sleeper
 * itself answered with the literal body `null` (a 404 today). A timeout, a 429,
 * a 5xx or a missing budget token is `failed` and is not evidence of anything.
 * Even then the first sighting is only recorded (`leagues.sleeper_missing_since`,
 * migration 0317); the league is deleted when a second not-found answer arrives
 * at least LEAGUE_REMOVAL_CONFIRM_MS later AND nothing synced the league
 * successfully in between. One odd Sleeper response never deletes data.
 *
 * WHAT GOES. Every foreign key into `leagues` cascades (checked against the live
 * schema on 2026-09-29): rosters, league_users, league_transactions,
 * league_matchups, league_drafts, league_activity, the Power Pulse, trade-value,
 * Positional WAR and Manager Ledger caches, league_refresh_attempts,
 * community_leagues and league_relay_posts, and would_you_rather_trades with its
 * votes, polls and Discord votes. `positional_war_curves.first_league_id` is
 * ON DELETE SET NULL, which is right: a curve is shared by fingerprint across
 * leagues. So no migration was needed for the cascade, and the league row is
 * deleted with one statement.
 *
 * Four tables name a league by its Sleeper id with no foreign key, and are
 * handled explicitly before that statement:
 * - draft_selections: this league's draft picks. Deleted.
 * - on_the_clock_draft_cache: a live-draft cache for a league that is gone. Deleted.
 * - trade_suggestion_declines: "do not show me this again" for a league that
 *   can no longer show anything. Deleted.
 * - league_sync_jobs: a PENDING job would only go back to Sleeper for a league
 *   that is gone, so it is closed as failed with a reason. Finished jobs are run
 *   history and are left alone, as is a job another worker is processing.
 *
 * Deliberately NOT touched: trade_suggestion_saves (a reader's own saved copy,
 * self-contained in its snapshot), on_the_clock_draft_snapshots (a finished
 * draft's permanent recap), manager_pulse_run_leagues (a run's history) and
 * league_sync_attempts (a rate-limit ledger).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { lookupSleeperLeague } from "@/lib/sleeper";

type ServiceClient = SupabaseClient<Database>;

/** How long after the first not-found answer the second one must come. */
export const LEAGUE_REMOVAL_CONFIRM_MS = 60 * 60 * 1000;

/**
 * The pulse_error written when Sleeper answered that the league does not exist.
 * The maintenance cron selects on it, so it is a contract, not prose. It keeps
 * the wording rows already carry in production.
 */
export const LEAGUE_NOT_FOUND_ERROR = "Sleeper league fetch returned null";

/** The pulse_error written when the league request itself failed. */
export const LEAGUE_FETCH_FAILED_ERROR = "Sleeper league fetch failed";

/**
 * `sleeper_missing_since` arrives with migration 0317 and is not in the
 * generated types until they are regenerated after it is applied. Every read and
 * write of it goes through this untyped view, and every one of them is written
 * so that a missing column degrades to "do nothing", never to "delete".
 */
function untyped(supabase: ServiceClient): SupabaseClient {
  return supabase as unknown as SupabaseClient;
}

export type NotFoundState = {
  sleeperMissingSince: string | null;
  lastPulsedAt: string | null;
};

export type NotFoundDecision = "record_first_sighting" | "wait" | "delete";

/**
 * What to do with a second (or first) not-found answer. Pure and clock-injected.
 *
 * A successful sync after the first sighting (`last_pulsed_at` later than it)
 * means Sleeper served the league in between, so the earlier sighting is void
 * and this one starts the clock again.
 */
export function decideNotFound(state: NotFoundState, now: number): NotFoundDecision {
  const since = state.sleeperMissingSince ? new Date(state.sleeperMissingSince).getTime() : NaN;
  if (Number.isNaN(since)) return "record_first_sighting";
  const pulsed = state.lastPulsedAt ? new Date(state.lastPulsedAt).getTime() : NaN;
  if (!Number.isNaN(pulsed) && pulsed > since) return "record_first_sighting";
  if (now - since < LEAGUE_REMOVAL_CONFIRM_MS) return "wait";
  return "delete";
}

export type NotFoundOutcome =
  | { outcome: "first_sighting" }
  | { outcome: "waiting" }
  | { outcome: "deleted" }
  | { outcome: "error"; error: string };

/**
 * Handle one definitive not-found answer for a league we hold. Records the
 * first sighting, waits out the confirmation window, or deletes. Never throws.
 */
export async function handleSleeperLeagueNotFound(
  supabase: ServiceClient,
  league: { id: string; sleeper_league_id: string },
  now: number = Date.now(),
): Promise<NotFoundOutcome> {
  try {
    const { data, error } = await untyped(supabase)
      .from("leagues")
      .select("sleeper_missing_since, last_pulsed_at")
      .eq("id", league.id)
      .maybeSingle();
    if (error) {
      // Before migration 0317 this is where it stops: no column, no deletion.
      await markNotFound(supabase, league.id, now, false);
      return { outcome: "error", error: error.message };
    }
    if (!data) return { outcome: "error", error: "league row not found" };

    const row = data as { sleeper_missing_since: string | null; last_pulsed_at: string | null };
    const decision = decideNotFound(
      { sleeperMissingSince: row.sleeper_missing_since, lastPulsedAt: row.last_pulsed_at },
      now,
    );

    if (decision === "delete") {
      const removed = await removeLeague(supabase, league);
      return removed.ok ? { outcome: "deleted" } : { outcome: "error", error: removed.error };
    }
    await markNotFound(supabase, league.id, now, decision === "record_first_sighting");
    return decision === "wait" ? { outcome: "waiting" } : { outcome: "first_sighting" };
  } catch (err) {
    return { outcome: "error", error: (err as Error).message };
  }
}

async function markNotFound(
  supabase: ServiceClient,
  leagueRowId: string,
  now: number,
  firstSighting: boolean,
): Promise<void> {
  const stamp = new Date(now).toISOString();
  const { error } = await supabase
    .from("leagues")
    .update({ pulse_status: "error", pulse_error: LEAGUE_NOT_FOUND_ERROR, updated_at: stamp })
    .eq("id", leagueRowId);
  if (error) {
    console.warn(`[league-removal] could not mark league ${leagueRowId} not found: ${error.message}`);
  }
  if (!firstSighting) return;
  const { error: sightErr } = await untyped(supabase)
    .from("leagues")
    .update({ sleeper_missing_since: stamp })
    .eq("id", leagueRowId);
  if (sightErr) {
    console.warn(
      `[league-removal] could not record first not-found sighting for ${leagueRowId}: ${sightErr.message}`,
    );
  }
}

/**
 * Void an earlier not-found sighting, because Sleeper has just served the
 * league. Called whenever a league whose last sync ended in an error is found
 * again, so a later not-found answer has to start the confirmation clock from
 * scratch rather than inherit a sighting from before the league came back.
 * Errors are logged: before migration 0317 there is no column to clear.
 */
export async function clearNotFoundSighting(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<void> {
  const { error } = await untyped(supabase)
    .from("leagues")
    .update({ sleeper_missing_since: null })
    .eq("id", leagueRowId);
  if (error) {
    console.warn(`[league-removal] could not clear not-found sighting for ${leagueRowId}: ${error.message}`);
  }
}

/**
 * Delete one league and everything that belongs to it. The side tables go
 * first, so a failure there leaves the league row (and so the retry) in place.
 */
export async function removeLeague(
  supabase: ServiceClient,
  league: { id: string; sleeper_league_id: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sleeperLeagueId = league.sleeper_league_id;

  const sideDeletes = await Promise.all([
    supabase.from("draft_selections").delete().eq("sleeper_league_id", sleeperLeagueId),
    supabase.from("on_the_clock_draft_cache").delete().eq("sleeper_league_id", sleeperLeagueId),
    supabase.from("trade_suggestion_declines").delete().eq("sleeper_league_id", sleeperLeagueId),
    supabase
      .from("league_sync_jobs")
      .update({
        status: "failed",
        last_error: "league no longer exists on Sleeper",
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("sleeper_league_id", sleeperLeagueId)
      .eq("status", "pending"),
  ]);
  const sideError = sideDeletes.find((r) => r.error)?.error;
  if (sideError) return { ok: false, error: `side table cleanup failed: ${sideError.message}` };

  // Every foreign key into leagues cascades; see the header.
  const { error } = await supabase.from("leagues").delete().eq("id", league.id);
  if (error) return { ok: false, error: `league delete failed: ${error.message}` };

  console.log(`[league-removal] removed league ${sleeperLeagueId} (row ${league.id}): Sleeper no longer has it`);
  return { ok: true };
}

export type NotFoundCheckResult =
  | { status: "found" }
  | { status: "failed" }
  | ({ status: "not_found" } & NotFoundOutcome);

/**
 * The confirmation check the maintenance cron runs for one league whose last
 * sync ended in LEAGUE_NOT_FOUND_ERROR. One Sleeper request, through the budget.
 *
 * A league Sleeper serves again has its error cleared to a plain retry marker,
 * so the cron stops asking and the next view resyncs it normally.
 */
export async function checkLeagueStillMissing(
  supabase: ServiceClient,
  league: { id: string; sleeper_league_id: string },
  now: number = Date.now(),
): Promise<NotFoundCheckResult> {
  const lookup = await lookupSleeperLeague(league.sleeper_league_id);
  if (lookup.status === "failed") return { status: "failed" };
  if (lookup.status === "found") {
    await supabase
      .from("leagues")
      .update({
        pulse_status: "error",
        pulse_error: "Sleeper serves this league again; the next view resyncs it",
        updated_at: new Date(now).toISOString(),
      })
      .eq("id", league.id);
    await clearNotFoundSighting(supabase, league.id);
    return { status: "found" };
  }
  const outcome = await handleSleeperLeagueNotFound(supabase, league, now);
  return { status: "not_found", ...outcome };
}
