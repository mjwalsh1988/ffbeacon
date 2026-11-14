import type { SupabaseClient } from "@supabase/supabase-js";
import {
  currentNflSeason,
  getAllSleeperTransactions,
  getNflState,
  getSleeperDraft,
  getSleeperLeagueDraftsOrNull,
  getSleeperLeagueUsersOrNull,
  getSleeperLosersBracket,
  getSleeperRostersOrNull,
  getSleeperTradedPicksOrNull,
  getSleeperWinnersBracket,
  lookupSleeperLeague,
  type SleeperDraft,
  type SleeperLeague,
  type SleeperRoster,
  type SleeperLeagueUser,
  type SleeperTransaction,
  type SleeperTradedPick,
} from "@/lib/sleeper";
import { MAX_MATCHUP_WEEK, resolveCurrentWeek, syncLeagueMatchups } from "@/lib/league-matchups";
import {
  changedSince,
  idList,
  pickOwnershipKeys,
  rostersChanged,
  type RosterShape,
} from "@/lib/league-roster-change";
import {
  clearNotFoundSighting,
  handleSleeperLeagueNotFound,
  LEAGUE_FETCH_FAILED_ERROR,
} from "@/lib/league-removal";
import { deriveFormatSlug } from "@/lib/sleeper-to-format";
import {
  calculateLeaguePowerRankings,
  POWER_RANKINGS_MODEL_VERSION,
} from "@/lib/league-power-rankings";
import { refreshPowerPulse } from "@/lib/league-power-pulse";
import { refreshPositionalWar } from "@/lib/league-positional-war";
import { refreshManagerLedger } from "@/lib/league-manager-ledger";
import { coalesce } from "@/lib/request-coalesce";
import { captureLeagueDraftSelections } from "@/lib/league-draft-selections";
import { normalizeDraftPicks } from "@/lib/sleeper-draft-picks";
import { chooseDraftPerSeason, MAX_DRAFT_ROUNDS, type LeagueDraftRow } from "@/lib/league-drafts";
import {
  captureLeagueSnapshot,
  recordLeagueChanges,
  snapshotFromSleeper,
} from "@/lib/league-activity/record";
import { projectLeagueActivity } from "@/lib/league-activity/project";
import type { Database, Json } from "@/lib/database.types";

export const LEAGUE_PULSE_TTL_MS = 60 * 60 * 1000; // 60 minutes

/**
 * Whether a stored league is inside the 60-minute cache, so a pulse would not
 * go back to Sleeper. The one copy of the rule: pulseLeagueCore uses it for the
 * cache hit, and lib/league-on-demand-sync.ts uses it to answer a fresh league
 * without spending the reader's sync slot.
 */
export function isLeaguePulseFresh(
  row: { last_pulsed_at: string | null; pulse_status: string | null } | null | undefined,
  now: number = Date.now(),
): boolean {
  return Boolean(
    row &&
      row.last_pulsed_at &&
      row.pulse_status === "complete" &&
      now - new Date(row.last_pulsed_at).getTime() < LEAGUE_PULSE_TTL_MS,
  );
}

// Power rankings depend on player values that sync once nightly, so there is no
// benefit to recomputing them more than once a day per league. We recompute on
// the first league load after this window elapses (or when there are no cache
// rows yet); reloads within the window serve the existing cache untouched. A
// force refresh bypasses this gate.
export const LEAGUE_POWER_RANKINGS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export type LeaguePulseResult =
  | {
      ok: true;
      leagueRowId: string;
      sleeperLeagueId: string;
      cached: boolean;
      counts: { rosters: number; users: number; transactions: number };
    }
  | LeaguePulseFailure;

/**
 * Why a pulse could not produce a league.
 *
 * - `not_found`: Sleeper has definitively said this league does not exist and
 *   we hold no copy of it (never had one, or it was just removed after a
 *   confirmed second answer; see lib/league-removal.ts). A page should render
 *   its not-found state for this, not a retry state.
 * - `not_found_unconfirmed`: Sleeper said not found, but we still hold the
 *   league and are waiting for the second answer before deleting it.
 * - `sleeper_failed`: a Sleeper request did not come back. Says nothing about
 *   the league; retry.
 * - `error`: our own write failed.
 */
export type LeaguePulseFailureReason =
  | "not_found"
  | "not_found_unconfirmed"
  | "sleeper_failed"
  | "error";

export type LeaguePulseFailure = {
  ok: false;
  error: string;
  sleeperLeagueId: string;
  reason?: LeaguePulseFailureReason;
};

/**
 * The `leagues` row every deep view renders its header from.
 *
 * Named here rather than inferred, because the point of handing it back is that
 * a page does not read the same row a second time. If a page needs a column
 * this list lacks, widen this list and the select beside it, once.
 */
export const LEAGUE_CORE_COLUMNS =
  "id, sleeper_league_id, name, season, status, total_rosters, last_pulsed_at, pulse_status, pulse_error, format_config_id, roster_positions, scoring_settings, metadata, frozen_at";

/** Nullability matches the schema exactly. Do not loosen it to make a cast fit. */
export type LeagueCoreRow = {
  id: string;
  sleeper_league_id: string;
  name: string;
  season: number;
  status: string | null;
  total_rosters: number | null;
  last_pulsed_at: string | null;
  pulse_status: string;
  pulse_error: string | null;
  format_config_id: string | null;
  roster_positions: Json;
  scoring_settings: Json;
  metadata: Json;
  /** Set once a past season is captured in full. See isPastSeason. */
  frozen_at: string | null;
};

/**
 * A season before the current one (lib/nfl-season.ts rolls over in March, so
 * this is a season that has ended). Such a league gets one last full capture
 * and is then frozen: leagues.frozen_at is stamped, no Sleeper request is made
 * for it again, its rows are never rewritten, and pages read what is stored.
 * Frozen beats force, because there is nothing left on Sleeper to refresh.
 */
export function isPastSeason(season: number, current: number = Number(currentNflSeason())): boolean {
  return Number.isFinite(season) && season > 0 && season < current;
}

/**
 * What the deep view needs before it can draw anything: the league itself, its
 * rosters, and its members. Everything else (transaction history, rankings,
 * Power Pulse) hangs off this and can arrive afterwards.
 */
export type LeaguePulseCoreResult =
  | {
      ok: true;
      leagueRowId: string;
      sleeperLeagueId: string;
      season: number;
      /** True when the 60-minute cache answered and Sleeper was not contacted. */
      cached: boolean;
      /**
       * Zeroes unless the caller asked for `counts: true`.
       *
       * These are two `head: true` counts against rosters and league_users, and
       * for a long time every caller paid for them while only the bulk sync
       * summary read them. They are two round trips in the middle of the
       * critical path of every league page (site-speed-audit-and-plan.md, 4.7).
       */
      counts: { rosters: number; users: number };
      /**
       * The league row itself, so the caller does not read it again.
       *
       * Null only when the sync branch could not hand one back. A page that
       * needs the row should fall back to its own read on null rather than
       * assume.
       */
      league: LeagueCoreRow | null;
      /**
       * Set when Sleeper answered for the league but not for one of its
       * required children (rosters, members, traded picks, drafts). Nothing
       * stored was overwritten, the league is marked `error` rather than
       * `complete` so the next view retries, and `cached` is true because
       * what the caller will render is the stored copy. Callers that exist to
       * capture fresh data (the footprint job, the pulse script) treat this as
       * a failure; a page renders the stored rows.
       */
      syncFailed?: string;
      /**
       * `leagues.rosters_changed_at` after this pass: stamped when the rosters
       * Sleeper returned differ from the stored ones. Null when unknown.
       */
      rostersChangedAt?: string | null;
    }
  | LeaguePulseFailure;

type ServiceClient = SupabaseClient<Database>;

// The in-flight coalescer moved to lib/request-coalesce.ts when the Manager
// Ledger needed the same guarantee: it is imported BY this file, so importing
// the helper back out of here would close a cycle. Behavior is unchanged.

/**
 * Decide whether this league's power rankings need recomputing. Returns true
 * when there are no cache rows yet, or the freshest cache row is older than
 * LEAGUE_POWER_RANKINGS_TTL_MS. On any query error we return true (recompute
 * rather than silently serve stale rankings). Reads a single indexed row.
 *
 * A FINISHED SEASON FREEZES, and this is where that happens.
 *
 * These rankings are the one thing in League Pulse that keeps moving after a
 * league stops playing. Every other surface is already fixed: the Manager
 * Ledger reads settled weeks and nothing else, Schedules holds final scores,
 * Power Pulse and Positional WAR both refuse to compute without a remaining
 * schedule and clear what they had. But the value rankings are priced off
 * today's player market, which does not stop moving in February, so a reader
 * coming back to a league they won in December would find their roster
 * revalued by a rookie class they never had, a ranking table reordered by it,
 * and no way to tell that from what actually happened.
 *
 * So once the season is complete the last computed rows are the answer, and
 * they stay. Nothing new is stored and no snapshot table is needed: the rows
 * are already a per-league copy of the values, and their `generated_at` is the
 * date the reader is shown.
 *
 * `force` still recomputes, which is the manual way back for a league that
 * froze on rows somebody does not want. And a league with NO rows yet still
 * computes even when complete, because freezing an empty table would leave a
 * finished league with no rankings at all rather than with its final ones.
 *
 * The trigger is Sleeper's own `status`, not our fuller reading of who won
 * (lib/league-season/phase.ts), because this runs on the critical path of
 * every league page and that reading costs a rosters read and a bracket parse.
 * The difference is a few days of drift on a league whose bracket has been
 * decided but which Sleeper has not flipped yet, against a read on every load
 * of every league forever. The freeze is a promise about the offseason, not
 * about championship Sunday.
 *
 * ONE KNOWN HOLE, stated rather than left to be found. The check is per LEAGUE
 * and not per (format, source): any row at all freezes the lot. So a value
 * source added to `source_registry` after a league completed will never be
 * computed for that league, and its rankings table for that source stays
 * empty rather than filling in on the next TTL expiry the way it used to.
 * Scoping the gate to the combination being viewed would mean threading it in
 * from the page, and calculateLeaguePowerRankings iterates every active combo
 * anyway, so the fix for a league in that state is the manual
 * `npm run calculate:power-rankings -- --sleeper-league-id <id>`.
 *
 * A ROSTER CHANGE IS STALENESS TOO. `rostersChangedAt` is when the league sync
 * last saw the rosters differ from what it had stored (players, reserve, taxi,
 * pick ownership; lib/league-roster-change.ts). A cache row generated before it
 * ranks rosters that no longer exist, so it recomputes on the pass that saw the
 * change instead of up to a day later. A league whose rosters did not change
 * recomputes exactly as often as before. The season freeze above still wins:
 * a finished league's final rankings are the answer whatever moves after.
 *
 * Exported for its own test, which is the only caller outside this file.
 */
export async function powerRankingsAreStale(
  supabase: ServiceClient,
  leagueRowId: string,
  seasonComplete: boolean,
  rostersChangedAt: string | null = null,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("league_power_rankings_cache")
    .select("generated_at, model_version:positional_breakdowns->PICKS->>model_version")
    .eq("league_id", leagueRowId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.generated_at) return true;
  if (seasonComplete) return false;
  // Rows written by older ranking math rebuild on the next view (LPI-T03).
  if (data.model_version !== POWER_RANKINGS_MODEL_VERSION) return true;
  if (changedSince(rostersChangedAt, data.generated_at)) return true;
  return Date.now() - new Date(data.generated_at).getTime() >= LEAGUE_POWER_RANKINGS_TTL_MS;
}

/**
 * `leagues.rosters_changed_at` arrives with migration 0316 and is not in the
 * generated types until they are regenerated after it is applied. Its reads and
 * writes go through this untyped view and degrade to "no change on record" on
 * any error, so this code is safe to deploy either side of the migration.
 */
function untypedLeagues(supabase: ServiceClient) {
  return (supabase as unknown as SupabaseClient).from("leagues");
}

async function readRostersChangedAt(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<string | null> {
  try {
    const { data, error } = await untypedLeagues(supabase)
      .select("rosters_changed_at")
      .eq("id", leagueRowId)
      .maybeSingle();
    if (error || !data) return null;
    const value = (data as { rosters_changed_at?: unknown }).rosters_changed_at;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Pulse one Sleeper league end-to-end (fetch + persist). Idempotent,
 * re-running upserts every table by its natural key. Returns the
 * leagues.id (uuid) on success.
 *
 * Cache: refuses to refetch from Sleeper if last_pulsed_at is within
 * LEAGUE_PULSE_TTL_MS (60 minutes), unless force=true.
 *
 * Power rankings are recomputed at most once per LEAGUE_POWER_RANKINGS_TTL_MS
 * (24 hours) per league, on whichever load first crosses that window, on both
 * the cached and full-sync paths. force=true always recomputes them.
 *
 * This is the whole-league entry point, kept for scripts, the refresh endpoint,
 * and any page that wants one await. The deep view instead calls the two halves
 * below directly so it can paint the league before the derived work finishes.
 *
 * Caller supplies the service-role supabase client (scripts use
 * scripts/_supabase.ts getServiceClient(); the server action uses
 * lib/supabase/server.ts createAdminClient()).
 */
export async function pulseLeague(
  supabase: ServiceClient,
  sleeperLeagueId: string,
  options: { force?: boolean } = {},
): Promise<LeaguePulseResult> {
  // counts: true, because THIS function's result type promises them and its
  // callers (the pulse script, the admin refresh endpoint) print them. Nothing
  // downstream of pulseLeagueCore itself reads them, which is why they are off
  // by default everywhere else.
  const core = await pulseLeagueCore(supabase, sleeperLeagueId, {
    ...options,
    counts: true,
  });
  if (!core.ok) return core;
  // The script and the admin refresh exist to fetch fresh data, so a sync that
  // could only serve the stored copy is a failure to them, said out loud.
  if (core.syncFailed) {
    return { ok: false, error: core.syncFailed, sleeperLeagueId, reason: "sleeper_failed" };
  }

  const derived = await pulseLeagueDerived(supabase, core.leagueRowId, {
    force: options.force,
    resynced: !core.cached,
    // `pulseLeague` is the "do everything" entry point: it is what
    // `npm run pulse:league` and the admin refresh endpoint call, and neither
    // has a Suspense boundary to protect. Pages call the two halves separately
    // and leave this off. See the default in pulseLeagueDerived.
    includeManagerLedger: true,
  });

  return {
    ok: true,
    leagueRowId: core.leagueRowId,
    sleeperLeagueId,
    cached: core.cached,
    counts: { ...core.counts, transactions: derived.transactions },
  };
}

/**
 * The half a league page cannot render without: the league row, its rosters,
 * and its members. Four Sleeper endpoints, all fetched together.
 *
 * Freshness is stamped at the END, once the child rows are actually persisted.
 * Marking the league complete before that meant any interruption in the slow
 * tail (a timed-out function, a thrown calculation) left a row that looked
 * fresh with data underneath it that was not, and the 60-minute cache then
 * served that state back on the next load instead of retrying.
 */
export async function pulseLeagueCore(
  supabase: ServiceClient,
  sleeperLeagueId: string,
  options: { force?: boolean; counts?: boolean } = {},
): Promise<LeaguePulseCoreResult> {
  // `counts` defaults OFF. The two head counts it gates are consumed only by
  // the bulk sync summary, and every league page was paying two round trips
  // for them in the middle of its critical path.
  const { force = false, counts: wantCounts = false } = options;
  return coalesce(`core:${sleeperLeagueId}:${force}:${wantCounts}`, async () => {
    const startedAt = Date.now();

    // Widened past what the cache check needs so the activity snapshot below can
    // be built from this row instead of reading the same one again, and so the
    // caller can render its header from what comes back rather than reading the
    // same row a third time. The extra columns are a few kilobytes on a query
    // that was happening anyway, against two whole round trips saved on the
    // critical path of every league page.
    const { data: existing } = await supabase
      .from("leagues")
      .select(LEAGUE_CORE_COLUMNS)
      .eq("sleeper_league_id", sleeperLeagueId)
      .maybeSingle();

    // A frozen past season answers from the stored copy whatever the caller
    // asked for, force included: no Sleeper request is ever made for it again.
    if (existing && (existing.frozen_at || (!force && isLeaguePulseFresh(existing)))) {
      // Cache hit: league, roster, and member rows are fresh enough that we do
      // not re-hit Sleeper at all. On this branch the whole function is meant
      // to be one round trip, so the two counts run only when asked for.
      const [rosterCount, userCount] = wantCounts
        ? await Promise.all([
            supabase
              .from("rosters")
              .select("id", { count: "exact", head: true })
              .eq("league_id", existing.id)
              .then((r) => r.count ?? 0),
            supabase
              .from("league_users")
              .select("id", { count: "exact", head: true })
              .eq("league_id", existing.id)
              .then((r) => r.count ?? 0),
          ])
        : [0, 0];
      return {
        ok: true as const,
        leagueRowId: existing.id,
        sleeperLeagueId,
        season: Number(existing.season ?? 0),
        cached: true,
        counts: { rosters: rosterCount, users: userCount },
        league: existing as unknown as LeagueCoreRow,
      };
    }

    if (existing) {
      const { error: markErr } = await supabase
        .from("leagues")
        .update({ pulse_status: "syncing", pulse_error: null, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      // This marker is how an interrupted sync gets retried instead of being
      // served from cache, so a failure to write it is worth hearing about.
      if (markErr) {
        console.warn(
          `[pulseLeague] could not mark league ${existing.id} syncing: ${markErr.message}`,
        );
      }
    }

    // THE SNAPSHOT HAS TO BE TAKEN HERE, before the upserts below write over
    // the values it is made of. Everything the activity log reports about
    // lineups, scoring, roster slots and managers is a DIFFERENCE between two
    // syncs, and until this line existed the sync destroyed its own evidence:
    // the upsert replaced the old row and nothing had read it.
    //
    // It costs nothing on the clock. The read runs against our own database
    // while the Sleeper round trip beside it is the slow half of this function,
    // so the pair finishes when `getSleeperLeague` does.
    const [lookup, priorSnapshot] = await Promise.all([
      lookupSleeperLeague(sleeperLeagueId),
      captureLeagueSnapshot(supabase, existing),
    ]);
    if (lookup.status === "not_found") {
      // Sleeper itself answered that this league does not exist. Evidence, but
      // one answer is never enough to delete anything: lib/league-removal.ts
      // records the first sighting and deletes only on a second one at least
      // an hour later with no successful sync in between.
      if (!existing) {
        return {
          ok: false as const,
          error: "Sleeper league not found",
          sleeperLeagueId,
          reason: "not_found" as const,
        };
      }
      const handled = await handleSleeperLeagueNotFound(supabase, {
        id: existing.id,
        sleeper_league_id: existing.sleeper_league_id,
      });
      return {
        ok: false as const,
        error: "Sleeper league not found",
        sleeperLeagueId,
        reason: handled.outcome === "deleted" ? ("not_found" as const) : ("not_found_unconfirmed" as const),
      };
    }
    if (lookup.status === "failed") {
      // The request did not come back. That says nothing about the league.
      if (existing) {
        await supabase
          .from("leagues")
          .update({
            pulse_status: "error",
            pulse_error: LEAGUE_FETCH_FAILED_ERROR,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      }
      return {
        ok: false as const,
        error: "Sleeper league fetch failed",
        sleeperLeagueId,
        reason: "sleeper_failed" as const,
      };
    }
    const league = lookup.league;
    // Sleeper just served the league, so any earlier not-found sighting is
    // void. Only a league whose last sync ended in an error can carry one, so
    // every healthy league skips this write.
    if (existing?.pulse_status === "error") {
      await clearNotFoundSighting(supabase, existing.id);
    }

    const formatSlug = deriveFormatSlug(league);
    let formatConfigId: string | null = null;
    if (formatSlug) {
      const { data: fc } = await supabase
        .from("format_configs")
        .select("id")
        .eq("slug", formatSlug)
        .maybeSingle();
      formatConfigId = fc?.id ?? null;
    }

    const season = Number(league.season);
    const leagueRow = {
      sleeper_league_id: league.league_id,
      name: league.name,
      season,
      sport: league.sport ?? "nfl",
      status: league.status ?? null,
      total_rosters: league.total_rosters ?? null,
      scoring_settings: (league.scoring_settings ?? {}) as Database["public"]["Tables"]["leagues"]["Insert"]["scoring_settings"],
      roster_positions: (league.roster_positions ?? []) as Database["public"]["Tables"]["leagues"]["Insert"]["roster_positions"],
      format_config_id: formatConfigId,
      metadata: league as unknown as Database["public"]["Tables"]["leagues"]["Insert"]["metadata"],
      // Deliberately NOT marked complete here. See the doc comment above.
      // "syncing" is one of the four values leagues_sync_status_check allows;
      // the string "pulsing" this code used to write was rejected by that
      // constraint every time, and the failure went unread.
      pulse_status: "syncing" as const,
      pulse_error: null,
      updated_at: new Date().toISOString(),
    };

    // Returning the whole row rather than just its id, so the caller can render
    // its header from this instead of reading the same row back. The two
    // columns the stamp below changes are corrected on the way out; every other
    // column here is what was just written.
    const { data: upserted, error: upsertErr } = await supabase
      .from("leagues")
      .upsert(leagueRow, { onConflict: "sleeper_league_id" })
      .select(LEAGUE_CORE_COLUMNS)
      .single();

    if (upsertErr || !upserted) {
      return {
        ok: false as const,
        error: `Failed to upsert league: ${upsertErr?.message ?? "unknown"}`,
        sleeperLeagueId,
      };
    }
    const leagueRowId = upserted.id;

    // Every child fetch distinguishes "Sleeper did not answer" (null) from
    // "Sleeper answered with nothing" ([]). The stored roster shapes are read
    // beside them, before anything is written, so the change check below
    // compares Sleeper's answer with what we held rather than with itself.
    const [rosterResult, userResult, tradedPickResult, draftSummaryResult, storedShapes] =
      await Promise.all([
        getSleeperRostersOrNull(sleeperLeagueId),
        getSleeperLeagueUsersOrNull(sleeperLeagueId),
        getSleeperTradedPicksOrNull(sleeperLeagueId),
        getSleeperLeagueDraftsOrNull(sleeperLeagueId),
        readStoredRosterShapes(supabase, leagueRowId),
      ]);

    // Fan out one /draft/{id} fetch per league draft. Sleeper's /league/{id}/drafts
    // summary does NOT include `slot_to_roster_id`, that lives on the per-draft
    // endpoint. We need it to render slot labels like "1.04" on rosters and trades.
    //
    // A detail that did not come back is a failure, NOT a reason to fall back
    // to the summary: the summary has no `slot_to_roster_id`, so writing it
    // would store `{}` over a real slot map and strip every pick label.
    const summaries = (draftSummaryResult ?? []).filter(
      (d): d is SleeperDraft => !!d?.draft_id,
    );
    const detailResults = await Promise.all(summaries.map((d) => getSleeperDraft(d.draft_id)));
    const draftDetails = detailResults.filter((d): d is SleeperDraft => !!d?.draft_id);

    const failedFetches: string[] = [];
    if (rosterResult === null) failedFetches.push("rosters");
    if (userResult === null) failedFetches.push("users");
    if (tradedPickResult === null) failedFetches.push("traded_picks");
    if (draftSummaryResult === null) failedFetches.push("drafts");
    const failedDetails = summaries.filter((_, i) => !detailResults[i]?.draft_id);
    if (failedDetails.length > 0) {
      failedFetches.push(`draft ${failedDetails.map((d) => d.draft_id).join(", ")}`);
    }

    if (failedFetches.length > 0) {
      // A FAILED REQUEST IS NOT AN EMPTY LEAGUE. Writing anything from a
      // partial answer is how a timeout used to rebuild every roster's picks
      // without the traded ones, or store `{}` over a real draft slot map. So
      // nothing below is written, the league is marked `error` rather than
      // `complete`, and the next view retries.
      const syncFailed = `Sleeper did not answer for: ${failedFetches.join("; ")}`;
      const failedAt = new Date().toISOString();
      await supabase
        .from("leagues")
        .update({ pulse_status: "error", pulse_error: syncFailed, updated_at: failedAt })
        .eq("id", leagueRowId);
      console.warn(`[pulseLeague] core ${sleeperLeagueId}: ${syncFailed}`);
      if (!existing) {
        // A first sync has no stored copy to fall back on.
        return {
          ok: false as const,
          error: syncFailed,
          sleeperLeagueId,
          reason: "sleeper_failed" as const,
        };
      }
      return {
        ok: true as const,
        leagueRowId,
        sleeperLeagueId,
        season,
        cached: true,
        counts: { rosters: 0, users: 0 },
        league: {
          ...(upserted as unknown as LeagueCoreRow),
          last_pulsed_at: existing.last_pulsed_at,
          pulse_status: "error",
          pulse_error: syncFailed,
        },
        syncFailed,
      };
    }

    const rosters = rosterResult as SleeperRoster[];
    const users = userResult as SleeperLeagueUser[];
    const tradedPicks = tradedPickResult as SleeperTradedPick[];

    // A child write that fails must not leave the league saying "syncing":
    // that marker reads as live work until the maintenance cron gives up on it
    // half an hour later. The league is marked `error` instead, so the next
    // view retries, and a page still renders whatever is stored.
    let nextShapes: RosterShape[];
    try {
      [nextShapes] = await Promise.all([
        upsertRosters(supabase, leagueRowId, rosters, tradedPicks, draftDetails, league),
        upsertLeagueUsers(supabase, leagueRowId, users),
        upsertLeagueDrafts(supabase, leagueRowId, draftDetails),
      ]);
    } catch (err) {
      const writeFailed = `Saving the league failed: ${(err as Error).message}`;
      await supabase
        .from("leagues")
        .update({
          pulse_status: "error",
          pulse_error: writeFailed,
          updated_at: new Date().toISOString(),
        })
        .eq("id", leagueRowId);
      console.warn(`[pulseLeague] core ${sleeperLeagueId}: ${writeFailed}`);
      if (!existing) {
        return { ok: false as const, error: writeFailed, sleeperLeagueId, reason: "error" as const };
      }
      return {
        ok: true as const,
        leagueRowId,
        sleeperLeagueId,
        season,
        cached: true,
        counts: { rosters: 0, users: 0 },
        league: {
          ...(upserted as unknown as LeagueCoreRow),
          last_pulsed_at: existing.last_pulsed_at,
          pulse_status: "error",
          pulse_error: writeFailed,
        },
        syncFailed: writeFailed,
      };
    }

    // Did the rosters move? Stamped BEFORE the pulse stamp below, so a derived
    // pass that starts the moment the league reads fresh already sees it. A
    // failed read of the stored rosters counts as a change: one extra
    // recompute is cheap, and a missed one serves stale rankings for a day.
    let rostersChangedAt: string | null = null;
    if (storedShapes === null || rostersChanged(storedShapes, nextShapes)) {
      rostersChangedAt = new Date().toISOString();
      const { error: changedErr } = await untypedLeagues(supabase)
        .update({ rosters_changed_at: rostersChangedAt })
        .eq("id", leagueRowId);
      if (changedErr) {
        console.warn(
          `[pulseLeague] could not stamp rosters_changed_at for ${leagueRowId}: ${changedErr.message}`,
        );
        rostersChangedAt = null;
      }
    }

    // Everything the page needs is on disk. Now the league counts as pulsed.
    const pulsedAt = new Date().toISOString();
    const { error: stampErr } = await supabase
      .from("leagues")
      .update({
        last_pulsed_at: pulsedAt,
        pulse_status: "complete",
        pulse_error: null,
        updated_at: pulsedAt,
      })
      .eq("id", leagueRowId);
    if (stampErr) {
      return {
        ok: false as const,
        error: `Failed to mark league pulsed: ${stampErr.message}`,
        sleeperLeagueId,
      };
    }

    // What changed since the snapshot above. Awaited rather than fired and
    // forgotten, because an unawaited promise in a serverless request is killed
    // when the response is sent; but the common case is a sync where nothing
    // changed, and that path writes nothing and returns immediately.
    //
    // `settings.leg` is Sleeper's own current week for this league, already in
    // the payload we just fetched, so a lineup card gets its week badge without
    // an extra request for the NFL state.
    const nextSnapshot = snapshotFromSleeper(
      league,
      rosters,
      users,
      draftDetails,
      priorSnapshot?.snapshot ?? null,
    );
    const currentLeg = Number((league.settings ?? {}).leg);
    await recordLeagueChanges(supabase, leagueRowId, priorSnapshot, nextSnapshot, {
      week: Number.isFinite(currentLeg) && currentLeg > 0 ? currentLeg : null,
    });

    console.log(
      `[pulseLeague] core ${sleeperLeagueId} in ${Date.now() - startedAt}ms (rosters=${rosters.length}, users=${users.length})`,
    );

    return {
      ok: true as const,
      leagueRowId,
      sleeperLeagueId,
      season,
      cached: false,
      counts: { rosters: rosters.length, users: users.length },
      league: {
        ...(upserted as unknown as LeagueCoreRow),
        // The upsert wrote "syncing" and left last_pulsed_at alone. The stamp
        // above is what a reader should be told, and it has just succeeded.
        last_pulsed_at: pulsedAt,
        pulse_status: "complete",
        pulse_error: null,
      },
      rostersChangedAt,
    };
  });
}

/**
 * The stored rosters in the shape the change check compares, or null when the
 * read failed (which the caller treats as a change).
 */
async function readStoredRosterShapes(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<RosterShape[] | null> {
  const { data, error } = await supabase
    .from("rosters")
    .select("sleeper_roster_id, player_ids, reserve_ids, taxi_ids, draft_pick_assets")
    .eq("league_id", leagueRowId);
  if (error || !Array.isArray(data)) return null;
  return data.map((r) => ({
    sleeperRosterId: Number(r.sleeper_roster_id),
    playerIds: idList(r.player_ids),
    reserveIds: idList(r.reserve_ids),
    taxiIds: idList(r.taxi_ids),
    picks: pickOwnershipKeys(r.draft_pick_assets),
  }));
}

/**
 * One in-flight shared derived pass per league. See pulseLeagueDerived.
 *
 * `syncs` says the pass pulls transaction history from Sleeper (the caller
 * resynced the core, or forced); `force` says it bypasses every gate. A caller
 * may join a pass that does at least what it needs, and never one that does
 * less.
 */
type SharedDerivedPass = { promise: Promise<void>; syncs: boolean; force: boolean };
const sharedDerivedPasses = new Map<string, SharedDerivedPass>();

/**
 * Join the league's in-flight shared pass when it covers what this caller
 * needs, otherwise start one.
 *
 * A pass that does LESS than asked (it is not pulling transactions and this
 * caller resynced, or it is not forced and this caller is) is waited out and
 * then followed, rather than run beside. Two passes on one league at once race
 * each other on the same tables, which is the thing this exists to stop; and
 * joining one that skips the transaction pull would silently drop the pull the
 * second caller was owed. Exported for its own test.
 */
export function joinSharedDerivedPass(
  leagueRowId: string,
  wants: { syncs: boolean; force: boolean },
  run: (wants: { syncs: boolean; force: boolean }) => Promise<void>,
): Promise<void> {
  const inFlight = sharedDerivedPasses.get(leagueRowId);
  if (inFlight) {
    if ((inFlight.syncs || !wants.syncs) && (inFlight.force || !wants.force)) {
      return inFlight.promise;
    }
    const next = () => joinSharedDerivedPass(leagueRowId, wants, run);
    return inFlight.promise.then(next, next);
  }
  const pass: SharedDerivedPass = { promise: Promise.resolve(), ...wants };
  pass.promise = run(wants).finally(() => {
    if (sharedDerivedPasses.get(leagueRowId) === pass) sharedDerivedPasses.delete(leagueRowId);
  });
  sharedDerivedPasses.set(leagueRowId, pass);
  return pass.promise;
}

/**
 * Everything downstream of the league itself: transaction history, trade-value
 * power rankings, Power Pulse, and (opt-in) Positional WAR and the Manager
 * Ledger. None of it blocks the page header, and none of it is allowed to fail
 * the load.
 *
 * `resynced` says the core actually contacted Sleeper, which is the signal to
 * pull transactions again. Within the cache window we leave the stored history
 * alone, matching what the single-pass version did.
 *
 * CONCURRENT CALLERS FOR ONE LEAGUE SHARE THE WORK. The hover warm-up and the
 * page it warms routinely overlap, and they pass different option flags (the
 * warm-up runs with the defaults, a page turns Positional WAR off). Keying the
 * whole pass on those flags gave each its own key, so both ran the capture set,
 * the rankings and Power Pulse side by side. Now the pass is split:
 *
 * - The SHARED half (capture set, activity projection, trade-value rankings,
 *   Power Pulse) is keyed on the league alone, through joinSharedDerivedPass,
 *   whatever optional pieces each caller wants.
 * - The OPTIONAL pieces run beside it, each coalesced per league (and force) on
 *   its own key, so a caller that wants the curve and one that does not still
 *   share the curve's single run between whoever asked for it.
 *
 * `includeManagerLedger` still defaults to false; see the default below.
 */
export async function pulseLeagueDerived(
  supabase: ServiceClient,
  leagueRowId: string,
  options: {
    force?: boolean;
    resynced?: boolean;
    includePositionalWar?: boolean;
    includeManagerLedger?: boolean;
  } = {},
): Promise<{ transactions: number }> {
  const {
    force = false,
    resynced = false,
    includePositionalWar = true,
    // DEFAULTS OFF, WHICH IS THE OPPOSITE POLARITY TO ITS SIBLINGS AND IS
    // DELIBERATE. Exactly one surface renders a ledger, and it awaits the
    // compute in its own Suspense boundary. Defaulting this on put a full
    // season of reads on the critical path of eight other pages plus the
    // hover warm-up endpoint and the relay cron, none of which display it.
    // Opting in is one flag on one page; opting out was eleven call sites and
    // every new one would have had to remember.
    includeManagerLedger = false,
  } = options;
  const startedAt = Date.now();
  const timings: string[] = [];
  const timed = async <T>(label: string, run: () => Promise<T>): Promise<T> => {
    const at = Date.now();
    try {
      return await run();
    } finally {
      timings.push(`${label}=${Date.now() - at}ms`);
    }
  };

  await Promise.all([
    timed("shared", () =>
      joinSharedDerivedPass(leagueRowId, { syncs: force || resynced, force }, (wants) =>
        runSharedDerivedPass(supabase, leagueRowId, wants),
      ),
    ),

    // Positional WAR: league-wide positional scarcity. Deliberately NOT
    // sequenced after Power Pulse; it reads no Power Pulse output (it reads no
    // roster at all), and it owns its own failure, so there is no ordering
    // constraint between them.
    //
    // `includePositionalWar: false` exists because of WHO AWAITS THIS. A page
    // does not call pulseLeagueDerived from the Suspense boundary that shows
    // the curve; it calls it from the one that shows the RANKINGS TABLE. So
    // every millisecond this stage takes was being spent holding up the
    // page's primary content, and a cold fingerprint costs about ten seconds
    // of universe read. Pages therefore pass false here and let the curve's
    // OWN boundary (components/league-war/positional-war-section.tsx) await
    // the compute, which is what its skeleton was always for. Scripts and the
    // refresh endpoint keep the default, because they have no boundaries to
    // protect and want one call that does everything.
    includePositionalWar
      ? timed("positional-war", () =>
          coalesce(`positional-war:${leagueRowId}:${force}`, () =>
            refreshPositionalWar(supabase, leagueRowId, { force }),
          ),
        )
      : Promise.resolve(),

    // Manager Ledger: how well each manager has played the roster they have.
    // Reads only rows already stored (settled matchups, transactions, draft
    // selections), makes no Sleeper request, and owns its own failure like
    // every other stage here. Only ever true when a caller asks for it; see
    // the default above for why the polarity is inverted.
    includeManagerLedger
      ? timed("manager-ledger", () =>
          coalesce(`manager-ledger:${leagueRowId}:${force}`, () =>
            refreshManagerLedger(supabase, leagueRowId, { force }),
          ),
        )
      : Promise.resolve(),
  ]);

  const { count } = await supabase
    .from("league_transactions")
    .select("id", { count: "exact", head: true })
    .eq("league_id", leagueRowId);

  console.log(
    `[pulseLeague] derived ${leagueRowId} in ${Date.now() - startedAt}ms (${timings.join(", ")})`,
  );

  return { transactions: count ?? 0 };
}

/**
 * The shared half of the derived pass: the capture set and activity
 * projection, the trade-value rankings, and Power Pulse. Run through
 * joinSharedDerivedPass, never directly, so concurrent callers share it.
 */
async function runSharedDerivedPass(
  supabase: ServiceClient,
  leagueRowId: string,
  wants: { syncs: boolean; force: boolean },
): Promise<void> {
  const { syncs, force } = wants;
  const startedAt = Date.now();

  const [{ data: league }, rostersChangedAt] = await Promise.all([
    supabase
      .from("leagues")
      .select(
        // `leg` is Sleeper's own current week for this league. Projected out of
        // the stored raw object rather than selecting the whole of it, and
        // needed here because whether a game has been played is what decides
        // whether it is a result. `status`, `playoff_week_start` and
        // `last_scored_leg` are widened onto this same select and handed down
        // to captureLeagueRawData as `meta` below, so a real resync does not
        // pay for a second primary-key select of the same row for the same
        // fields.
        "id, sleeper_league_id, season, status, frozen_at, leg:metadata->settings->leg, playoff_week_start:metadata->settings->playoff_week_start, last_scored_leg:metadata->settings->last_scored_leg",
      )
      .eq("id", leagueRowId)
      .maybeSingle(),
    // When the core last saw the rosters change. Both gates below compare it
    // with their cache, so a trade or a waiver claim is reflected on the pass
    // that saw it. Read on its own so a missing column (before migration 0316)
    // degrades to "no change on record" instead of failing the select above.
    readRostersChangedAt(supabase, leagueRowId),
  ]);
  if (!league) return;

  const season = Number(league.season ?? 0);
  const legValue = Number(league.leg);
  const currentLeg = Number.isFinite(legValue) && legValue > 0 ? legValue : null;
  // Per-stage timings. Cheap, and the only way to aim the next round of
  // tuning at what is actually slow rather than at what looks slow.
  const timings: string[] = [];
  const timed = async <T>(label: string, run: () => Promise<T>): Promise<T> => {
    const at = Date.now();
    try {
      return await run();
    } finally {
      timings.push(`${label}=${Date.now() - at}ms`);
    }
  };

  // The stages touch different tables and, with one exception, none reads
  // another's output, so they run together rather than in a queue. Each owns
  // its own failure: a thrown calculation must not take the others down, and
  // none of them may fail the page.
  //
  // THE ONE EXCEPTION IS THE PAIR BELOW. The activity projector reads the
  // transactions the sync above it writes, so those two are sequential inside
  // a single member of this list rather than two siblings of it. As siblings
  // they raced, and the race had a visible symptom: a reader opening a cold
  // league saw a log with no moves in it, because the projector read the
  // table while the sync was still filling it.
  await Promise.all([
    (async () => {
      // A frozen league never goes back to Sleeper; its stored rows are final.
      if (syncs && !league.frozen_at) {
        await timed("capture-set", () =>
          captureLeagueRawData(
            supabase,
            {
              leagueRowId,
              sleeperLeagueId: league.sleeper_league_id,
              season,
              // Already on hand from the select above; passing it down
              // saves captureLeagueRawData its own primary-key select.
              meta: {
                status: league.status ?? null,
                leg: legValue,
                playoffWeekStart: Number(league.playoff_week_start),
                lastScoredLeg: Number(league.last_scored_leg),
                frozenAt: league.frozen_at ?? null,
              },
            },
            { force, includeMatchups: false },
          ),
        );
      }

      // Turning transactions and played matchups into feed entries.
      //
      // Deliberately NOT gated on `syncs` like the sync above it, because
      // this reads OUR tables rather than Sleeper's: a league whose 60-minute
      // cache is warm still needs its back history projected the first time
      // anyone opens it after this shipped. The gates inside make a repeat run
      // a pair of indexed reads that write nothing.
      try {
        const projected = await timed("activity", () =>
          projectLeagueActivity(supabase, leagueRowId, season, currentLeg),
        );
        if (projected.transactions > 0 || projected.results > 0) {
          console.log(
            `[pulseLeague] activity projected for ${leagueRowId} (transactions=${projected.transactions}, results=${projected.results})`,
          );
        }
      } catch (err) {
        console.warn(
          `[pulseLeague] activity projection threw for league ${leagueRowId}:`,
          (err as Error).message,
        );
      }
    })(),

    // Power rankings track the nightly player-value sync, not the league TTL,
    // so they recompute at most once per 24h, plus once after a roster change
    // the core recorded. A failure is non-fatal; the cache row can be
    // backfilled by npm run calculate:power-rankings.
    (async () => {
      const seasonComplete =
        Boolean(league.frozen_at) || (league.status ?? "").toLowerCase() === "complete";
      if (
        !force &&
        !(await powerRankingsAreStale(supabase, leagueRowId, seasonComplete, rostersChangedAt))
      ) {
        return;
      }
      try {
        const calcResult = await timed("rankings", () =>
          calculateLeaguePowerRankings(supabase, leagueRowId),
        );
        if (!calcResult.ok) {
          console.warn(
            `[pulseLeague] power-rankings calc failed for league ${leagueRowId}: ${calcResult.error}`,
          );
        }
      } catch (err) {
        console.warn(
          `[pulseLeague] power-rankings calc threw for league ${leagueRowId}:`,
          (err as Error).message,
        );
      }
    })(),

    // Power Pulse: expected competitive performance under the league's own
    // scoring. Independent of the value source, so no format/source loop.
    timed("power-pulse", () =>
      refreshPowerPulse(supabase, leagueRowId, { force, rostersChangedAt }),
    ),
  ]);

  console.log(
    `[pulseLeague] shared derived ${league.sleeper_league_id} in ${Date.now() - startedAt}ms (${
      timings.join(", ") || "nothing to do"
    })`,
  );
}

/**
 * The week a league's playoff bracket starts, or null when it runs none.
 * Sleeper writes `playoff_week_start: 0` for a league with playoffs off (every
 * chopped league does), and anything that is not a positive integer is the
 * same answer: there is no bracket to capture.
 */
export function bracketStartWeekOf(playoffWeekStart: number): number | null {
  return Number.isInteger(playoffWeekStart) && playoffWeekStart > 0 ? playoffWeekStart : null;
}

export type CaptureRawOptions = {
  force: boolean;
  /**
   * Whether this call syncs the matchup slate. The derived half passes false
   * because refreshPowerPulse syncs the slate itself with the failed-week
   * semantics Power Pulse needs and running it twice in one pass would refetch
   * the volatile window twice. The footprint path passes true: nothing else on
   * that path touches the slate.
   */
  includeMatchups: boolean;
};

export type CaptureRawResult = {
  transactions: "ok" | "failed";
  brackets: "ok" | "failed" | "not_applicable";
  draftSelections: "ok" | "failed";
  matchups: "ok" | "failed" | "skipped";
  complete: boolean;
};

/**
 * The applicability fields captureLeagueRawData needs (status, leg,
 * playoff_week_start, last_scored_leg), for a caller that already read this
 * league row and can hand the values down instead of paying for a second
 * primary-key select of the same row.
 */
export type CaptureRawLeagueMeta = {
  status: string | null;
  leg: number;
  playoffWeekStart: number;
  lastScoredLeg: number;
  /** leagues.frozen_at. A frozen league's capture makes no request at all. */
  frozenAt: string | null;
};

/**
 * THE CAPTURE SET. Everything a league sync writes beyond the core rows,
 * whoever asked for the sync. lib/league-capture-set.test.ts asserts that
 * pulseLeagueDerived and pulseLeagueFootprint both call this and that nothing
 * else calls the stage functions directly.
 *
 * Stamps leagues.capture_completed_at only when every applicable stage
 * succeeded, and writes capture_error otherwise. Never throws; a stage failure
 * is a value in the result, and the FOOTPRINT caller turns an incomplete
 * result into a failed job so the worker retries it.
 */
export async function captureLeagueRawData(
  supabase: ServiceClient,
  league: {
    leagueRowId: string;
    sleeperLeagueId: string;
    season: number;
    /**
     * Present when the caller already has this row (pulseLeagueDerived reads
     * its own league row moments before calling this function and widens
     * that select). Absent for pulseLeagueFootprint, which has no such row
     * on hand and falls back to reading it here.
     */
    meta?: CaptureRawLeagueMeta;
  },
  options: CaptureRawOptions,
): Promise<CaptureRawResult> {
  const { leagueRowId, sleeperLeagueId, season } = league;
  const result: CaptureRawResult = {
    transactions: "failed",
    brackets: "not_applicable",
    draftSelections: "failed",
    matchups: "skipped",
    complete: false,
  };

  let status: string | null;
  let leg: number;
  let playoffWeekStart: number;
  let lastScoredLeg: number;
  let frozenAt: string | null;
  if (league.meta) {
    ({ status, leg, playoffWeekStart, lastScoredLeg, frozenAt } = league.meta);
  } else {
    // One read for everything the stages need to decide applicability, for a
    // caller that did not already have this row.
    const { data: row, error: rowErr } = await supabase
      .from("leagues")
      .select(
        "status, frozen_at, leg:metadata->settings->leg, playoff_week_start:metadata->settings->playoff_week_start, last_scored_leg:metadata->settings->last_scored_leg",
      )
      .eq("id", leagueRowId)
      .maybeSingle();
    if (rowErr) {
      // Without the row we cannot tell a frozen league from a live one, so
      // nothing is fetched and nothing is stamped. The caller retries.
      console.warn(`[captureLeagueRawData] league read failed for ${leagueRowId}: ${rowErr.message}`);
      return result;
    }
    status = row?.status ?? null;
    leg = Number(row?.leg);
    playoffWeekStart = Number(row?.playoff_week_start);
    lastScoredLeg = Number(row?.last_scored_leg);
    frozenAt = row?.frozen_at ?? null;
  }

  // A frozen league is a finished snapshot: no Sleeper request, no write.
  if (frozenAt) {
    return {
      transactions: "ok",
      brackets: "not_applicable",
      draftSelections: "ok",
      matchups: "skipped",
      complete: true,
    };
  }

  // THE LAST CAPTURE OF A PAST SEASON. Everything is fetched in full (every
  // transaction week from week 0, the whole matchup slate, every completed
  // draft), and if all of it lands the league is frozen below. A stage that
  // fails leaves it unfrozen and the next capture tries again.
  const finalCapture = isPastSeason(season);
  const force = options.force || finalCapture;
  const includeMatchups = options.includeMatchups || finalCapture;

  const seasonComplete = status === "complete" || finalCapture;
  // A league with `playoff_week_start` 0 or missing runs no bracket at all
  // (chopped leagues, playoffs switched off). Reading 0 as a real week made
  // `leg >= 0` true from week 1, so the bracket stage ran, found nothing,
  // was marked failed, and capture_completed_at was never stamped for any of
  // them. For those leagues the bracket stage is not applicable, and it stays
  // that way even once the season is complete.
  const bracketStartWeek = bracketStartWeekOf(playoffWeekStart);
  const playoffsStarted =
    bracketStartWeek !== null &&
    (seasonComplete || (Number.isFinite(leg) && leg >= bracketStartWeek));

  try {
    await syncTransactions(
      supabase,
      leagueRowId,
      sleeperLeagueId,
      season,
      force,
      lastScoredLeg,
      seasonComplete,
    );
    result.transactions = "ok";
  } catch (err) {
    console.warn(`[captureLeagueRawData] transactions failed for ${leagueRowId}:`, (err as Error).message);
  }

  if (playoffsStarted) {
    const bracketsOk = await captureLeagueBrackets(supabase, leagueRowId, sleeperLeagueId);
    result.brackets = bracketsOk ? "ok" : "failed";
  }

  try {
    // The final capture takes every outstanding draft at once: there is no
    // later sync to pick up the remainder.
    const captured = await captureLeagueDraftSelections(
      supabase,
      leagueRowId,
      finalCapture ? { maxDrafts: Number.POSITIVE_INFINITY } : {},
    );
    result.draftSelections = captured.fetchFailures > 0 ? "failed" : "ok";
  } catch (err) {
    console.warn(`[captureLeagueRawData] draft selections failed for ${leagueRowId}:`, (err as Error).message);
  }

  if (includeMatchups) {
    // Wrapped so the function's own "never throws" contract holds regardless
    // of who calls it, rather than resting on the fact that the derived path
    // (the only caller today whose Promise.all a throw here would take down)
    // happens to pass includeMatchups: false. A page must still render if
    // this throws, the same reasoning that wraps every stage above it.
    try {
      // With no bracket the regular season is the whole season, so the week
      // the postseason clamps to is past the last matchup week, not week 15
      // (and not 0, which resolveCurrentWeek floors to week 1 and would read
      // as "nothing played yet").
      //
      // A past season needs no NFL state at all: every week of it is played.
      // Otherwise a null state (Sleeper did not answer) means the week is
      // unknown, and the slate is not synced against a guess. It counts as a
      // failed stage so the capture is retried rather than stamped.
      const currentWeek = finalCapture
        ? MAX_MATCHUP_WEEK + 1
        : resolveCurrentWeek(await getNflState(), season, bracketStartWeek ?? MAX_MATCHUP_WEEK + 1);
      if (currentWeek === null) {
        result.matchups = "failed";
      } else {
        const sync = await syncLeagueMatchups(supabase, leagueRowId, sleeperLeagueId, season, currentWeek, {
          force,
        });
        result.matchups = sync.ok && sync.failedWeeks.length === 0 ? "ok" : "failed";
      }
    } catch (err) {
      console.warn(`[captureLeagueRawData] matchups failed for ${leagueRowId}:`, (err as Error).message);
      result.matchups = "failed";
    }
  } else {
    // The caller (pulseLeagueDerived) passes includeMatchups: false on the
    // assumption that refreshPowerPulse syncs the slate itself, with the
    // failed-week semantics Power Pulse needs. That assumption does not
    // always hold: refreshPowerPulse backs off after a recent non-'ok'
    // verdict, and can itself report failedWeeks without writing a single row
    // (lib/league-power-pulse.ts). Trusting the skip on its own would stamp
    // capture_completed_at over a league-season that has never actually
    // captured a slate, and Manager Pulse's settled-forever rule would then
    // never look at it again. One bounded existence check settles it without
    // a Sleeper call of its own; it does not solve the race against a
    // Power Pulse run still in flight beside this one, it only refuses to
    // claim victory it cannot see, and a later pass picks it up once the
    // slate lands.
    const { count: matchupRowCount } = await supabase
      .from("league_matchups")
      .select("id", { count: "exact", head: true })
      .eq("league_id", leagueRowId)
      .eq("season", season);
    if (!matchupRowCount) {
      result.matchups = "failed";
    }
  }

  result.complete =
    result.transactions === "ok" &&
    result.brackets !== "failed" &&
    result.draftSelections === "ok" &&
    result.matchups !== "failed";

  const now = new Date().toISOString();
  await supabase
    .from("leagues")
    .update(
      result.complete
        ? {
            capture_completed_at: now,
            capture_error: null,
            updated_at: now,
            // The past season's last capture landed in full: freeze it.
            ...(finalCapture ? { frozen_at: now } : {}),
          }
        : {
            capture_error: `incomplete: ${Object.entries(result)
              .filter(([k, v]) => k !== "complete" && v === "failed")
              .map(([k]) => k)
              .join(", ")}`,
            updated_at: now,
          },
    )
    .eq("id", leagueRowId);

  return result;
}

/**
 * The lighter capture a Manager Pulse run queues instead of a full pulse: the
 * league, its rosters, its members, its drafts and its traded picks (all via
 * pulseLeagueCore), plus transaction history and the two playoff brackets.
 * Deliberately stops there.
 *
 * A full pulseLeague also computes trade-value power rankings, Power Pulse,
 * Positional WAR and (opt-in) the Manager Ledger. Manager Pulse reads none of
 * that for the sections built on top of this capture, and it can queue dozens
 * of league-seasons for one report, so running the full pulse on each of them
 * would spend most of an hour of compute nobody asked for. See
 * docs/manager-pulse/manager-pulse-plan.md section 4.4.
 *
 * Shares pulseLeagueCore's in-process coalescing (a footprint job and a page
 * render of the same league collapse into one execution) and its 60-minute
 * TTL: on a cache hit, core makes no Sleeper request, and this function skips
 * its own Sleeper requests (the transaction pull and the bracket fetch) for
 * the same reason, UNLESS the capture set itself has never completed
 * (`leagues.capture_completed_at` is null), in which case it runs anyway. A
 * core cache hit only says the league/roster/member rows are fresh; it says
 * nothing about whether an earlier capture set finished, and a cached core
 * that skipped the set outright is exactly how a failed bracket or
 * transaction stage settled as done and was never retried. `last_pulsed_at`
 * and `pulse_status` are stamped by pulseLeagueCore alone, only after core's
 * own child rows land; the transaction and bracket writes below run AFTER
 * that stamp, the same ordering pulseLeague already uses for its derived half.
 */
export async function pulseLeagueFootprint(
  supabase: ServiceClient,
  sleeperLeagueId: string,
  options: { force?: boolean } = {},
): Promise<LeaguePulseResult> {
  const { force = false } = options;
  // No counts. Manager Pulse queues dozens of league-seasons per report and
  // nothing on that path reads the roster and member counts, so two head
  // counts per league would be two round trips per league for nothing. The
  // zeroes that come back are the documented contract, not a measurement.
  const core = await pulseLeagueCore(supabase, sleeperLeagueId, options);
  if (!core.ok) return core;
  // A footprint job exists to capture fresh data, so serving the stored copy
  // because a Sleeper request failed is a failed job, and the worker retries it.
  if (core.syncFailed) {
    return { ok: false, error: core.syncFailed, sleeperLeagueId, reason: "sleeper_failed" };
  }

  // A cache hit means core made no Sleeper request, which is usually this
  // function's own signal to skip Sleeper too, the same `force || resynced`
  // gate pulseLeagueDerived applies to its own transaction sync. But a cache
  // hit only proves the CORE rows (league, rosters, members) are fresh; it
  // says nothing about whether the CAPTURE SET (transactions, brackets, draft
  // selections, matchups) ever finished. A capture-set failure inside the
  // 60-minute core window leaves `capture_completed_at` null while
  // `last_pulsed_at` stays fresh, and gating on `resynced` alone let that
  // league settle as `ok: true` with zero Sleeper calls and no retry: the
  // worker's own run-time freshness check (lib/league-bulk-sync.ts) correctly
  // re-queues a league whose capture set never completed, and this function
  // then silently skipped it anyway. See
  // docs/manager-pulse/manager-pulse-audit-and-speed-plan.md Part 3.3 and F8.
  const resynced = !core.cached;
  let captureIncomplete = false;
  if (!force && !resynced) {
    const { data: captureState } = await supabase
      .from("leagues")
      .select("capture_completed_at")
      .eq("id", core.leagueRowId)
      .maybeSingle();
    captureIncomplete = !captureState?.capture_completed_at;
  }

  const raw = await coalesce(`footprint-derived:${core.leagueRowId}:${force}`, async () => {
    if (!(force || resynced || captureIncomplete)) return null;
    return captureLeagueRawData(
      supabase,
      { leagueRowId: core.leagueRowId, sleeperLeagueId, season: core.season },
      { force, includeMatchups: true },
    );
  });
  if (raw && !raw.complete) {
    return { ok: false, error: "capture set incomplete", sleeperLeagueId };
  }

  const { count } = await supabase
    .from("league_transactions")
    .select("id", { count: "exact", head: true })
    .eq("league_id", core.leagueRowId);
  const transactions = count ?? 0;

  return {
    ok: true,
    leagueRowId: core.leagueRowId,
    sleeperLeagueId,
    cached: core.cached,
    counts: { ...core.counts, transactions },
  };
}

/**
 * The two playoff brackets, merged into `leagues.metadata` under a
 * `brackets` key.
 *
 * getSleeperWinnersBracket/getSleeperLosersBracket return null when the
 * REQUEST failed (timeout, 429, 5xx) and [] when Sleeper answered and the
 * league genuinely has no bracket yet (season not over, or no playoffs). Only
 * the second is written: writing null over a bracket already captured would
 * erase a real answer because of one timeout, so a failed fetch is skipped
 * and the prior value is left alone rather than cleared.
 *
 * Read-modify-write rather than a blind overwrite, per the project's metadata
 * rule: `leagues.metadata` already carries the raw Sleeper league object
 * pulseLeagueCore wrote moments earlier, and this merges the brackets key
 * into it instead of clobbering those sibling keys.
 *
 * Returns true when at least one bracket was written this run, or when a
 * prior run already wrote the one this run's fetch could not confirm (the
 * merge preserves it, so the stored pair is complete either way). Returns
 * false only when both fetches failed and there is nothing to merge.
 */
async function captureLeagueBrackets(
  supabase: ServiceClient,
  leagueRowId: string,
  sleeperLeagueId: string,
): Promise<boolean> {
  const [winners, losers] = await Promise.all([
    getSleeperWinnersBracket(sleeperLeagueId),
    getSleeperLosersBracket(sleeperLeagueId),
  ]);

  const patch: Record<string, unknown> = {};
  if (winners !== null) patch.winners = winners;
  if (losers !== null) patch.losers = losers;
  if (Object.keys(patch).length === 0) return false;

  const { data: existing, error: readErr } = await supabase
    .from("leagues")
    .select("metadata")
    .eq("id", leagueRowId)
    .maybeSingle();
  if (readErr) {
    console.warn(
      `[pulseLeagueFootprint] could not read metadata for league ${leagueRowId}: ${readErr.message}`,
    );
    return false;
  }

  const currentMetadata = (existing?.metadata ?? {}) as Record<string, unknown>;
  const currentBrackets = (currentMetadata.brackets ?? {}) as Record<string, unknown>;
  const nextMetadata = {
    ...currentMetadata,
    brackets: { ...currentBrackets, ...patch },
  };

  const { error: writeErr } = await supabase
    .from("leagues")
    .update({
      metadata: nextMetadata as unknown as Database["public"]["Tables"]["leagues"]["Update"]["metadata"],
      updated_at: new Date().toISOString(),
    })
    .eq("id", leagueRowId);
  if (writeErr) {
    console.warn(
      `[pulseLeagueFootprint] could not write brackets for league ${leagueRowId}: ${writeErr.message}`,
    );
    return false;
  }
  return true;
}

/**
 * Pull transaction history and persist it.
 *
 * Past weeks are settled: a week 3 waiver claim from last season is not going to
 * change. So a league that already has history only asks Sleeper about the last
 * stored week onward, instead of walking from week 0 every single sync. A force
 * refresh still walks the whole thing, because that is what a user pressing
 * refresh is asking for.
 *
 * `lastScoredLeg` caps the far end of the walk. Sleeper's transactions
 * endpoint has no "how many weeks exist" answer, so without a cap the walk
 * asks about weeks well past the league's actual last scored week; a settled
 * league still stops on its own via the empty-week streak, but a live league's
 * own scored week is the honest ceiling. Passed in from captureLeagueRawData's
 * own league read rather than queried again here.
 */
async function syncTransactions(
  supabase: ServiceClient,
  leagueRowId: string,
  sleeperLeagueId: string,
  season: number,
  force: boolean,
  lastScoredLeg: number,
  seasonSettled: boolean,
): Promise<void> {
  let fromWeek = 0;
  if (!force) {
    const { data: latest } = await supabase
      .from("league_transactions")
      .select("week")
      .eq("league_id", leagueRowId)
      .eq("season", season)
      .not("week", "is", null)
      .order("week", { ascending: false })
      .limit(1)
      .maybeSingle();
    const storedMax = latest?.week == null ? null : Number(latest.week);
    // Step back one week so a partially-played week gets completed rather than
    // frozen at whatever we happened to catch mid-week.
    if (storedMax !== null && Number.isFinite(storedMax)) fromWeek = Math.max(0, storedMax - 1);
  }

  // MPS-T037's code and its own prose disagreed on the fallback when
  // last_scored_leg is absent: the code said 25, the sentence right after it
  // said 18 for a settled league. Resolved toward the prose: a settled
  // league-season cannot have transactions past week 18 (there is no week 19
  // in any Sleeper league), so walking to 25 there is seven wasted requests
  // per such league. An unsettled league missing last_scored_leg (early in a
  // season, or metadata not yet populated) keeps the wider 25-week ceiling.
  const hasScoredLeg = Number.isFinite(lastScoredLeg) && lastScoredLeg > 0;
  const maxWeek = hasScoredLeg ? lastScoredLeg + 1 : seasonSettled ? 18 : 25;
  // A known far end means every week up to it is read: a run of quiet weeks
  // is not the end of a league's history, and stopping on one (with the resume
  // point parked just before it) froze 130 leagues weeks behind. Only the
  // unbounded 25-week guess still stops on three empty weeks.
  const emptyStop = transactionWalkEmptyStop(hasScoredLeg, seasonSettled);
  const transactions = await getAllSleeperTransactions(sleeperLeagueId, maxWeek, emptyStop, fromWeek);
  await upsertTransactions(supabase, leagueRowId, transactions, season);
}

/**
 * How many consecutive empty weeks end the transaction walk. Infinity (read
 * every week to the bound) whenever the bound is real: the league's last scored
 * week, or week 18 for a settled season. Exported for its test.
 */
export function transactionWalkEmptyStop(hasScoredLeg: boolean, seasonSettled: boolean): number {
  return hasScoredLeg || seasonSettled ? Number.POSITIVE_INFINITY : 3;
}

/**
 * The stored rows whose Sleeper key is absent from the latest payload.
 *
 * Split out and pure because the rule is one line and the reason for it is not.
 * See pruneStaleRosters below.
 */
export function orphanRowIds(
  stored: Array<{ id: string; key: string | number | null }>,
  keptKeys: Array<string | number>,
): string[] {
  const kept = new Set(keptKeys.map((k) => String(k)));
  return stored.filter((row) => !kept.has(String(row.key))).map((row) => row.id);
}

/**
 * Drop roster rows Sleeper no longer returns.
 *
 * Every child write in this file is an upsert, which adds and updates the rows
 * the payload names and leaves everything else exactly where it was. That is
 * correct for a league whose shape never changes and wrong the moment one does.
 * A 16-team league cut to 12 kept four ownerless roster rows indefinitely, and
 * every reader that counts teams by reading this table (the deep view, the
 * trade-value ranking, Power Pulse's season simulation) went on believing there
 * were sixteen. Power Pulse simulated a 16-team bracket against a 12-team
 * schedule and stored playoff odds for every real manager off the back of it.
 *
 * ABSOLUTE RULE: an empty payload is never evidence about a league. The core now
 * fetches through the OrNull variants in lib/sleeper.ts and writes nothing at
 * all when a request failed, but the plain variants still collapse a failure
 * into `[]`, and pruning against an empty payload would empty a healthy league
 * on one timeout. The caller also returns early on a zero-length payload; the
 * length check below is the last lock on that same door and must not be removed.
 *
 * A failed prune is logged, not thrown. A stale row is a wrong number on a page;
 * a thrown sync is no page at all.
 */
async function pruneStaleRosters(
  supabase: ServiceClient,
  leagueRowId: string,
  keptRosterIds: number[],
): Promise<void> {
  if (keptRosterIds.length === 0) return;
  const { data, error } = await supabase
    .from("rosters")
    .select("id, sleeper_roster_id")
    .eq("league_id", leagueRowId);
  if (error) {
    console.warn(`[pulseLeague] roster prune read failed: ${error.message}`);
    return;
  }
  const orphans = orphanRowIds(
    (data ?? []).map((r) => ({ id: r.id, key: r.sleeper_roster_id })),
    keptRosterIds,
  );
  if (orphans.length === 0) return;
  // league_power_rankings_cache and league_power_pulse_cache both cascade off
  // rosters.id, so the derived rows for a removed team go with it.
  const { error: delErr } = await supabase.from("rosters").delete().in("id", orphans);
  if (delErr) {
    console.warn(`[pulseLeague] roster prune delete failed: ${delErr.message}`);
    return;
  }
  console.log(
    `[pulseLeague] removed ${orphans.length} roster row(s) league ${leagueRowId} no longer has`,
  );
}

/** Drop member rows Sleeper no longer returns. Same contract as pruneStaleRosters. */
async function pruneStaleLeagueUsers(
  supabase: ServiceClient,
  leagueRowId: string,
  keptUserIds: string[],
): Promise<void> {
  if (keptUserIds.length === 0) return;
  const { data, error } = await supabase
    .from("league_users")
    .select("id, sleeper_user_id")
    .eq("league_id", leagueRowId);
  if (error) {
    console.warn(`[pulseLeague] member prune read failed: ${error.message}`);
    return;
  }
  const orphans = orphanRowIds(
    (data ?? []).map((u) => ({ id: u.id, key: u.sleeper_user_id })),
    keptUserIds,
  );
  if (orphans.length === 0) return;
  const { error: delErr } = await supabase.from("league_users").delete().in("id", orphans);
  if (delErr) {
    console.warn(`[pulseLeague] member prune delete failed: ${delErr.message}`);
    return;
  }
  console.log(
    `[pulseLeague] removed ${orphans.length} member row(s) league ${leagueRowId} no longer has`,
  );
}

/**
 * Drop draft rows Sleeper no longer returns. Same contract as pruneStaleRosters.
 *
 * A commissioner who deletes and recreates a draft gets a new draft_id, and the
 * abandoned one stays in our copy forever otherwise, which puts a draft board
 * on screen for a draft that no longer exists.
 */
async function pruneStaleLeagueDrafts(
  supabase: ServiceClient,
  leagueRowId: string,
  keptDraftIds: string[],
): Promise<void> {
  if (keptDraftIds.length === 0) return;
  const { data, error } = await supabase
    .from("league_drafts")
    .select("id, sleeper_draft_id")
    .eq("league_id", leagueRowId);
  if (error) {
    console.warn(`[pulseLeague] draft prune read failed: ${error.message}`);
    return;
  }
  const orphans = orphanRowIds(
    (data ?? []).map((d) => ({ id: d.id, key: d.sleeper_draft_id })),
    keptDraftIds,
  );
  if (orphans.length === 0) return;
  const { error: delErr } = await supabase.from("league_drafts").delete().in("id", orphans);
  if (delErr) {
    console.warn(`[pulseLeague] draft prune delete failed: ${delErr.message}`);
    return;
  }
  console.log(
    `[pulseLeague] removed ${orphans.length} draft row(s) league ${leagueRowId} no longer has`,
  );
}

async function upsertRosters(
  supabase: ServiceClient,
  leagueRowId: string,
  rosters: SleeperRoster[],
  tradedPicks: SleeperTradedPick[],
  draftDetails: SleeperDraft[],
  league: Pick<SleeperLeague, "season" | "settings">,
): Promise<RosterShape[]> {
  if (rosters.length === 0) return [];

  const picksByOwner = new Map<number, PickAsset[]>();
  for (const pick of buildRosterPicks(rosters, tradedPicks, draftDetails, league)) {
    const arr = picksByOwner.get(pick.current_roster_id) ?? [];
    arr.push(pick);
    picksByOwner.set(pick.current_roster_id, arr);
  }

  const rows = rosters.map((r) => {
    const sleeperPlayers = (r.players ?? []).filter(validPlayerId);
    const sleeperStarters = (r.starters ?? []).filter(validPlayerId);
    const sleeperReserve = (r.reserve ?? []).filter(validPlayerId);
    const sleeperTaxi = (r.taxi ?? []).filter(validPlayerId);
    const settings = r.settings ?? {};
    return {
      league_id: leagueRowId,
      sleeper_roster_id: r.roster_id,
      owner_user_id: r.owner_id,
      co_owners: (r.co_owners ?? []) as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["co_owners"],
      player_ids: sleeperPlayers as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["player_ids"],
      starter_ids: sleeperStarters as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["starter_ids"],
      reserve_ids: sleeperReserve as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["reserve_ids"],
      taxi_ids: sleeperTaxi as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["taxi_ids"],
      draft_pick_assets: (picksByOwner.get(r.roster_id) ?? []) as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["draft_pick_assets"],
      wins: Number(settings.wins ?? 0),
      losses: Number(settings.losses ?? 0),
      ties: Number(settings.ties ?? 0),
      points_for: scaledPoints(settings.fpts, settings.fpts_decimal),
      points_against: scaledPoints(settings.fpts_against, settings.fpts_against_decimal),
      waiver_position: Number(settings.waiver_position ?? 0) || null,
      waiver_budget: Number(settings.waiver_budget_used ?? 0) || null,
      metadata: r as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["metadata"],
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase
    .from("rosters")
    .upsert(rows, { onConflict: "league_id,sleeper_roster_id" });
  if (error) throw new Error(`rosters upsert failed: ${error.message}`);

  await pruneStaleRosters(
    supabase,
    leagueRowId,
    rosters.map((r) => r.roster_id),
  );

  // What was just written, in the shape the roster-change check compares.
  return rows.map((row) => ({
    sleeperRosterId: Number(row.sleeper_roster_id),
    playerIds: idList(row.player_ids),
    reserveIds: idList(row.reserve_ids),
    taxiIds: idList(row.taxi_ids),
    picks: pickOwnershipKeys(row.draft_pick_assets),
  }));
}

async function upsertLeagueUsers(
  supabase: ServiceClient,
  leagueRowId: string,
  users: SleeperLeagueUser[],
): Promise<void> {
  if (users.length === 0) return;
  const rows = users.map((u) => {
    const meta = (u.metadata ?? {}) as Record<string, unknown>;
    // Sleeper's `is_owner` on the /users response means "active league
    // member" (not a placeholder), which can include every co-owner of a
    // roster. It is NOT a reliable commissioner signal, overloading it as
    // such would grant force-refresh to every co-owner. Until we have a
    // verified commissioner signal (league.metadata.commissioner_id, or
    // a service-role flip), default is_commissioner to false. Admins (via
    // user_preferences.is_admin) can still force refresh.
    return {
      league_id: leagueRowId,
      sleeper_user_id: u.user_id,
      display_name: u.display_name ?? null,
      avatar: u.avatar ?? null,
      team_name: typeof meta.team_name === "string" ? (meta.team_name as string) : null,
      is_owner: Boolean(u.is_owner),
      is_commissioner: false,
      metadata: u as unknown as Database["public"]["Tables"]["league_users"]["Insert"]["metadata"],
      updated_at: new Date().toISOString(),
    };
  });
  const { error } = await supabase
    .from("league_users")
    .upsert(rows, { onConflict: "league_id,sleeper_user_id" });
  if (error) throw new Error(`league_users upsert failed: ${error.message}`);

  await pruneStaleLeagueUsers(
    supabase,
    leagueRowId,
    users.map((u) => u.user_id),
  );
}

/**
 * The week a transaction happened, from whichever field Sleeper populated.
 *
 * `leg` is the one that is actually present: it is set on 100% of the rows we
 * hold, while `week` has never once arrived. Both are read so a payload
 * carrying either is handled, and anything that is not a positive integer
 * resolves to null rather than to a zero that would sort ahead of week 1.
 */
export function transactionWeek(t: { week?: number | null; leg?: number | null }): number | null {
  for (const candidate of [t.week, t.leg]) {
    const n = Number(candidate);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

async function upsertTransactions(
  supabase: ServiceClient,
  leagueRowId: string,
  transactions: SleeperTransaction[],
  season: number,
): Promise<void> {
  if (transactions.length === 0) return;
  const rows = transactions.map((t) => {
    const draftPicks = normalizeDraftPicks(t.draft_picks);
    const rosterIds = collectRosterIds(t.adds, t.drops, t.roster_ids, draftPicks);
    return {
      league_id: leagueRowId,
      sleeper_transaction_id: t.transaction_id,
      type: t.type,
      status: t.status ?? null,
      // Sleeper calls it `leg`, not `week`. Reading `t.week` stored null on
      // every transaction ever synced, which broke three things at once: the
      // week filter and its facet list on the Transactions page had nothing to
      // offer, every row rendered without its week, and the incremental sync
      // below (which finds the newest stored week to resume from) found null
      // and walked the whole history from week 0 on every single resync.
      // `week` is kept as the first choice in case Sleeper ever populates it.
      week: transactionWeek(t),
      season,
      adds: (t.adds ?? {}) as unknown as Database["public"]["Tables"]["league_transactions"]["Insert"]["adds"],
      drops: (t.drops ?? {}) as unknown as Database["public"]["Tables"]["league_transactions"]["Insert"]["drops"],
      draft_picks: draftPicks as unknown as Database["public"]["Tables"]["league_transactions"]["Insert"]["draft_picks"],
      waiver_budget: (Array.isArray(t.waiver_budget) ? t.waiver_budget : []) as unknown as Database["public"]["Tables"]["league_transactions"]["Insert"]["waiver_budget"],
      roster_ids: rosterIds as unknown as Database["public"]["Tables"]["league_transactions"]["Insert"]["roster_ids"],
      created_at_sleeper: t.created ? new Date(t.created).toISOString() : null,
      metadata: t as unknown as Database["public"]["Tables"]["league_transactions"]["Insert"]["metadata"],
    };
  });

  // Chunk in case of giant transaction histories
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    const { error } = await supabase
      .from("league_transactions")
      .upsert(slice, { onConflict: "league_id,sleeper_transaction_id" });
    if (error) throw new Error(`league_transactions upsert failed: ${error.message}`);
  }
}

// ---------- helpers ----------

export type PickAsset = {
  season: number;
  round: number;
  original_roster_id: number;
  current_roster_id: number;
  /** Draft slot (1..N) that this pick maps to. Null until the season's
   * draft is scheduled and `slot_to_roster_id` is published. */
  slot?: number | null;
  /** Pre-formatted "R.SS" label (e.g. "1.04"). Null when slot is unknown. */
  pick_label?: string | null;
};

function pickKey(season: number, round: number, originalRosterId: number): string {
  return `${season}:${round}:${originalRosterId}`;
}

/**
 * The draft each season's picks are read against, chosen by the same rule the
 * read path uses (lib/league-drafts.ts chooseDraftPerSeason), so the slot and
 * label stamped here agree with what a page computes. A season with a deleted
 * and recreated draft used to take whichever detail Sleeper listed last.
 */
export function chooseSleeperDraftPerSeason(details: SleeperDraft[]): Map<number, SleeperDraft> {
  const byId = new Map<string, SleeperDraft>();
  const rows: LeagueDraftRow[] = [];
  for (const d of details) {
    const season = Number.parseInt(String(d.season), 10);
    if (!Number.isFinite(season) || !d.draft_id) continue;
    byId.set(d.draft_id, d);
    const start = Number(d.start_time);
    // Only the fields preferLaterDraft reads are meaningful here.
    rows.push({
      sleeperDraftId: d.draft_id,
      season,
      status: d.status ?? null,
      isComplete: (d.status ?? "").toLowerCase() === "complete",
      type: d.type ?? null,
      rounds: 0,
      teams: 0,
      shape: undefined as unknown as LeagueDraftRow["shape"],
      rosterToSeat: new Map(),
      startedAtMs: Number.isFinite(start) && start > 0 ? start : null,
      lastPickedAtMs: null,
    });
  }
  const out = new Map<number, SleeperDraft>();
  for (const [season, row] of chooseDraftPerSeason(rows)) {
    const draft = byId.get(row.sleeperDraftId);
    if (draft) out.set(season, draft);
  }
  return out;
}

/**
 * Original roster id to draft slot for one draft, once its order is known.
 * `slot_to_roster_id` first; `draft_order` (user id to slot) fills any roster
 * it does not place, through each roster's owner.
 */
export function rosterSlotsForDraft(
  draft: Pick<SleeperDraft, "slot_to_roster_id" | "draft_order">,
  rosters: Array<Pick<SleeperRoster, "roster_id" | "owner_id">>,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const [slotStr, rosterId] of Object.entries(draft.slot_to_roster_id ?? {})) {
    const slot = Number.parseInt(slotStr, 10);
    const rid = Number(rosterId);
    // Sleeper writes null for a slot nobody holds yet; Number(null) is 0.
    if (Number.isInteger(slot) && slot > 0 && Number.isInteger(rid) && rid > 0) {
      out.set(rid, slot);
    }
  }
  const order = draft.draft_order ?? {};
  for (const r of rosters) {
    if (out.has(r.roster_id) || !r.owner_id) continue;
    const slot = Number(order[r.owner_id]);
    if (Number.isInteger(slot) && slot > 0) out.set(r.roster_id, slot);
  }
  return out;
}

/** Sleeper league types that hold no future rookie picks: 0 redraft, 3 chopped. */
const PICKLESS_LEAGUE_TYPES = new Set([0, 3]);

/** Rounds planted per season when the league does not say. */
const DEFAULT_DRAFT_ROUNDS = 4;

/** How many seasons of picks are planted, starting with the league's own. */
const PICK_SEASONS = 4;

/**
 * Every pick each roster holds, ready to store on `rosters.draft_pick_assets`.
 *
 * A baseline (every roster owns its own pick in every round of every season)
 * with Sleeper's traded picks laid over it. /traded_picks returns the CURRENT
 * state per traded pick, one row per pick, and its `roster_id` is the immutable
 * original owner, so the baseline is indexed and overwritten by that key only.
 * Using `previous_owner_id` would mis-attribute multi-hop trades (A to B to C
 * would leave the pick on A's roster AND add a phantom entry on B's).
 *
 * The rules, each a past bug:
 * - Rounds come from the league's `settings.draft_rounds`, not a flat 4.
 * - Redraft and chopped leagues hold no picks at all.
 * - A season whose draft is complete is dropped, traded picks included: those
 *   picks are spent, and Sleeper leaves them on rosters after the draft.
 * - When a season's draft order is known, each pick carries its real slot and
 *   a "R.SS" label, read from the draft chooseSleeperDraftPerSeason picks.
 *
 * Exported for its test.
 */
export function buildRosterPicks(
  rosters: Array<Pick<SleeperRoster, "roster_id" | "owner_id">>,
  tradedPicks: SleeperTradedPick[],
  draftDetails: SleeperDraft[],
  league: Pick<SleeperLeague, "season" | "settings">,
): PickAsset[] {
  const settings = league.settings ?? {};
  if (PICKLESS_LEAGUE_TYPES.has(Number(settings.type ?? 0))) return [];

  const leagueSeason = Number.parseInt(String(league.season), 10);
  if (!Number.isFinite(leagueSeason)) return [];
  const declaredRounds = Number(settings.draft_rounds);
  const rounds =
    Number.isInteger(declaredRounds) && declaredRounds > 0
      ? Math.min(declaredRounds, MAX_DRAFT_ROUNDS)
      : DEFAULT_DRAFT_ROUNDS;

  const draftBySeason = chooseSleeperDraftPerSeason(draftDetails);
  const spent = (season: number) =>
    season < leagueSeason ||
    (draftBySeason.get(season)?.status ?? "").toLowerCase() === "complete";

  const picks = new Map<string, PickAsset>();
  for (let season = leagueSeason; season < leagueSeason + PICK_SEASONS; season += 1) {
    if (spent(season)) continue;
    for (let round = 1; round <= rounds; round += 1) {
      for (const r of rosters) {
        picks.set(pickKey(season, round, r.roster_id), {
          season,
          round,
          original_roster_id: r.roster_id,
          current_roster_id: r.roster_id,
        });
      }
    }
  }
  for (const traded of tradedPicks) {
    const season = Number(traded.season);
    if (!Number.isFinite(season) || spent(season)) continue;
    picks.set(pickKey(season, traded.round, traded.roster_id), {
      season,
      round: traded.round,
      original_roster_id: traded.roster_id,
      current_roster_id: traded.owner_id,
    });
  }

  const slotsBySeason = new Map<number, Map<number, number>>();
  for (const [season, draft] of draftBySeason) {
    const slots = rosterSlotsForDraft(draft, rosters);
    if (slots.size > 0) slotsBySeason.set(season, slots);
  }

  return [...picks.values()].map((pick) => {
    const slot = slotsBySeason.get(pick.season)?.get(pick.original_roster_id) ?? null;
    return {
      ...pick,
      slot,
      pick_label: slot != null ? `${pick.round}.${String(slot).padStart(2, "0")}` : null,
    };
  });
}

async function upsertLeagueDrafts(
  supabase: ServiceClient,
  leagueRowId: string,
  drafts: SleeperDraft[],
): Promise<void> {
  if (drafts.length === 0) return;
  const rows = drafts
    .map((d) => {
      const season =
        typeof d.season === "string" ? parseInt(d.season, 10) : Number(d.season);
      if (!Number.isFinite(season)) return null;
      const startTime =
        typeof d.start_time === "number" && d.start_time > 0
          ? new Date(d.start_time).toISOString()
          : null;
      return {
        league_id: leagueRowId,
        sleeper_draft_id: d.draft_id,
        season,
        status: d.status ?? null,
        type: d.type ?? null,
        start_time: startTime,
        slot_to_roster_id: (d.slot_to_roster_id ?? {}) as unknown as Database["public"]["Tables"]["league_drafts"]["Insert"]["slot_to_roster_id"],
        draft_order: ((d as unknown as { draft_order?: unknown }).draft_order ?? null) as Database["public"]["Tables"]["league_drafts"]["Insert"]["draft_order"],
        settings: (d.settings ?? null) as Database["public"]["Tables"]["league_drafts"]["Insert"]["settings"],
        metadata: d as unknown as Database["public"]["Tables"]["league_drafts"]["Insert"]["metadata"],
        updated_at: new Date().toISOString(),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length === 0) return;
  // Dedupe by sleeper_draft_id so one upsert batch never targets the same
  // conflict row twice (Postgres rejects "affect a row a second time").
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    if (seen.has(r.sleeper_draft_id)) return false;
    seen.add(r.sleeper_draft_id);
    return true;
  });
  const { error } = await supabase
    .from("league_drafts")
    .upsert(deduped, { onConflict: "sleeper_draft_id" });
  if (error) throw new Error(`league_drafts upsert failed: ${error.message}`);

  await pruneStaleLeagueDrafts(
    supabase,
    leagueRowId,
    deduped.map((d) => d.sleeper_draft_id),
  );
}

function validPlayerId(id: string | null | undefined): id is string {
  if (id === null || id === undefined) return false;
  if (id === "" || id === "0") return false;
  return true;
}

function scaledPoints(whole: number | undefined, decimal: number | undefined): number {
  const w = Number(whole ?? 0);
  const d = Number(decimal ?? 0);
  return w + d / 100;
}

/**
 * Re-exported so every existing importer keeps working.
 *
 * The implementation moved to `lib/sleeper-draft-picks.ts` because this module
 * now imports the activity projector, which needs the same normalizer while
 * reading transactions back. Leaving it here made that pair an import cycle.
 */
export { normalizeDraftPicks };

function collectRosterIds(
  adds: Record<string, number> | null | undefined,
  drops: Record<string, number> | null | undefined,
  topLevel: number[] | undefined,
  draftPicks: unknown[],
): number[] {
  const set = new Set<number>();
  for (const v of Object.values(adds ?? {})) if (typeof v === "number") set.add(v);
  for (const v of Object.values(drops ?? {})) if (typeof v === "number") set.add(v);
  for (const id of topLevel ?? []) set.add(id);
  for (const pick of draftPicks) {
    if (pick && typeof pick === "object") {
      const p = pick as Record<string, unknown>;
      if (typeof p.owner_id === "number") set.add(p.owner_id);
      if (typeof p.previous_owner_id === "number") set.add(p.previous_owner_id);
      if (typeof p.roster_id === "number") set.add(p.roster_id);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

export type { SleeperLeague };
