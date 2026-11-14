/**
 * Power Pulse orchestrator.
 *
 * The public entry point, mirroring lib/league-power-rankings.ts: load one
 * league's world, run the model, upsert league_power_pulse_cache. Idempotent,
 * so re-running replaces the rows for that league season.
 *
 * Unlike the value power rankings, there is no format or source loop. Power
 * Pulse is computed from Sleeper projections under the league's own scoring
 * settings, so there is exactly one answer per team per season.
 *
 * A failure here is never fatal to a league page. The caller logs and moves on,
 * and the deep view falls back to the value rankings.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { closestScoringBase } from "@/lib/league-scoring";
import { isDraftPending } from "@/lib/league-readiness";
import { getNflState } from "@/lib/sleeper";
import { MAX_MATCHUP_WEEK, resolveCurrentWeek, syncLeagueMatchups } from "@/lib/league-matchups";
import { computePowerPulse, type PowerPulseTeamResult } from "@/lib/power-pulse/engine";
import {
  loadAccuracy,
  loadAliveRosterIds,
  loadCompletedResults,
  loadDefenseSplits,
  loadLeague,
  loadLiveWeek,
  loadPlayers,
  loadProjectionStamp,
  loadProjections,
  loadRosters,
  loadSchedule,
  type LeagueRow,
  type RosterRow,
} from "@/lib/power-pulse/load";
import { bracketFacts, playoffStates } from "@/lib/power-pulse/playoffs";
import type { PowerPulseSettings } from "@/lib/power-pulse/default-settings";
import { choppedWeeks, resolveFinalWeek } from "@/lib/chopped/league";
import { defenseSeasonsFor } from "@/lib/projections/defense-seasons";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { idpEnabledFrom } from "@/lib/power-pulse/default-settings";
import { idpReadsFor, scoringKeysArg } from "@/lib/power-pulse/idp-reads";
import { resolveProjectionSourceForWindow } from "@/lib/projections/source";
import { changedSince } from "@/lib/league-roster-change";

type ServiceClient = SupabaseClient<Database>;

/** How long a computed Power Pulse row stays fresh. */
export const POWER_PULSE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * How long a non-'ok' Power Pulse verdict is left alone before the next view
 * retries it. See the bypass table on refreshPowerPulse for the conditions
 * that let a league skip this wait entirely.
 */
export const POWER_PULSE_RETRY_MS = 15 * 60 * 1000; // 15 minutes

export type PowerPulseResult =
  | { ok: true; teams: number; season: number; currentWeek: number; skipped?: string }
  | { ok: false; error: string };

/** The verdict persisted to leagues.power_pulse_status. */
export type PowerPulseVerdictStatus = "ok" | "skipped" | "settled" | "error";

const MAX_DETAIL_LENGTH = 500;

function truncateDetail(detail: string): string {
  return detail.length > MAX_DETAIL_LENGTH ? detail.slice(0, MAX_DETAIL_LENGTH) : detail;
}

// calculateLeaguePowerPulse's `skipped` reason strings, sorted into the two
// verdicts. 'skipped' is for a reason that is likely to clear up soon (a
// fetch that timed out, rosters or projections that have not synced yet).
// 'settled' is for a reason that is a statement about the season/week and
// will not change until a real event happens (no schedule yet, no draft yet,
// the season is over). Matched by exact string or prefix because several of
// these carry a dynamic suffix (a week number, a list of failed weeks).
const SKIPPED_REASON_TESTS: Array<(reason: string) => boolean> = [
  (r) => r.startsWith("incomplete schedule fetch"),
  (r) => r === "no rosters",
  (r) => r === "no teams scored",
  (r) => r.startsWith("no weekly projections stored for"),
];
const SETTLED_REASON_TESTS: Array<(reason: string) => boolean> = [
  (r) => r === "no published schedule",
  (r) => r === "draft pending with empty rosters",
  (r) => r.startsWith("no regular season games remaining from week"),
  (r) => r.startsWith("chopped league has no weeks left"),
  (r) => r.startsWith("season complete"),
];

/**
 * Map calculateLeaguePowerPulse's return shape to the verdict persisted on
 * leagues.power_pulse_status. This is a lookup over an already-exhaustive set
 * of reason strings, not new calculation logic.
 *
 * A skipped reason this function does not recognize classifies as 'skipped'
 * rather than 'settled': skipped carries the shorter backoff, so an
 * unclassified reason is retried soon rather than possibly parked forever.
 * The cost of an unnecessary extra retry is one recompute; the cost of a
 * wrongly-'settled' league is silence.
 */
export function classifyPowerPulseResult(
  result: PowerPulseResult,
): { status: PowerPulseVerdictStatus; detail: string } {
  if (!result.ok) {
    return { status: "error", detail: result.error };
  }
  if (!result.skipped) {
    return {
      status: "ok",
      detail: `${result.teams} team${result.teams === 1 ? "" : "s"} scored, through week ${result.currentWeek}`,
    };
  }
  const reason = result.skipped;
  if (SKIPPED_REASON_TESTS.some((test) => test(reason))) {
    return { status: "skipped", detail: reason };
  }
  if (SETTLED_REASON_TESTS.some((test) => test(reason))) {
    return { status: "settled", detail: reason };
  }
  return { status: "skipped", detail: reason };
}

/**
 * The machine-readable suffix a 'settled' verdict's detail carries, recording
 * the (season, currentWeek, playoffWeekStart) triple that made it settled.
 * Format: `<reason> [settled season=2026 week=9 playoffStart=15]`. Appended
 * after classifyPowerPulseResult's plain-English reason and parsed back by
 * the backoff check below, so a settled league only recomputes when that
 * triple actually changes rather than on a timer.
 */
const SETTLED_TRIPLE_SUFFIX = / \[settled season=(\d+) week=(\d+) playoffStart=(\d+)\]$/;

function encodeSettledDetail(
  reason: string,
  season: number,
  currentWeek: number,
  playoffWeekStart: number,
): string {
  return `${reason} [settled season=${season} week=${currentWeek} playoffStart=${playoffWeekStart}]`;
}

function parseSettledTriple(
  detail: string | null,
): { season: number; currentWeek: number; playoffWeekStart: number } | null {
  if (!detail) return null;
  const m = SETTLED_TRIPLE_SUFFIX.exec(detail);
  if (!m) return null;
  return { season: Number(m[1]), currentWeek: Number(m[2]), playoffWeekStart: Number(m[3]) };
}

type BackoffRow = {
  last_pulsed_at: string | null;
  power_pulse_status: string | null;
  power_pulse_detail: string | null;
  power_pulse_attempted_at: string | null;
};

/**
 * Whether an 'error' or 'skipped' verdict is still inside its retry window.
 *
 * Bypassed when leagues.last_pulsed_at has advanced past the attempt: that is
 * what keeps a league responsive on draft night. pulseLeagueCore writes
 * rosters and advances last_pulsed_at on every real resync (a roster sync, a
 * draft finishing), so a league that changed since the last attempt is worth
 * retrying on the very next view rather than waiting out fifteen minutes.
 * Without this clause, "draft pending with empty rosters" would have to be
 * classified 'skipped' instead of 'settled' to stay responsive, and the
 * classification table in the plan would be wrong.
 */
function withinRetryBackoff(row: BackoffRow): boolean {
  if (!row.power_pulse_attempted_at) return false;
  const attemptedAt = new Date(row.power_pulse_attempted_at).getTime();
  if (Number.isNaN(attemptedAt)) return false;
  if (Date.now() - attemptedAt >= POWER_PULSE_RETRY_MS) return false;
  if (row.last_pulsed_at) {
    const lastPulsedAt = new Date(row.last_pulsed_at).getTime();
    if (!Number.isNaN(lastPulsedAt) && lastPulsedAt > attemptedAt) return false;
  }
  return true;
}

/**
 * Whether this league needs a Power Pulse recompute.
 *
 * The backoff check runs first, before any of the queries below, so a league
 * whose last attempt was not 'ok' and has not earned a bypass costs one
 * select and returns false without touching Sleeper. Only a 'settled'
 * verdict whose stored triple needs checking calls getCurrentWeek() (a
 * single, process-wide memoised ping, not a per-league round trip); an
 * 'error' or 'skipped' verdict inside its retry window never does.
 *
 * Past the backoff, this is the original staleness check: true when there
 * are no rows, when the freshest row is past the TTL, when the model version
 * moved, or when the stored week is behind the live NFL week.
 */
/**
 * The version string `league_power_pulse_cache.model_version` is keyed on, WITH
 * the projection source folded in.
 *
 * `modelVersion` alone is not enough, and the gap is not hypothetical. It
 * hashes the stored settings document, so it moves when an admin edits
 * anything, the `beaconProjections.enabled` toggle included. It does NOT move
 * on the two flips that need no settings change at all: ffbeacon becoming
 * available once the nightly builder reaches count parity for the window, and
 * losing it again when a single builder run is missed. Either changes every
 * projected number in the league while leaving the stored row looking valid for
 * the full 12 hour TTL.
 *
 * Appending the source rather than adding a column keeps this inside the
 * comparison the staleness gate already makes. Positional WAR solves the same
 * problem by putting projectionSource in its fingerprint payload; this is that
 * fix in the shape this cache already has.
 */
export function powerPulseCacheModelVersion(
  modelVersion: string,
  projectionSource: string,
  /**
   * leagueResultFingerprint: the league settings that change the answer. A
   * commissioner who adds a playoff spot, edits scoring or a roster slot, or
   * splits the league into divisions has changed every figure, and the row
   * must rescore on the next view rather than at the end of its TTL.
   */
  leagueFingerprint?: string | null,
  /**
   * loadProjectionStamp: when the projection sync last wrote the week this
   * league is scored from. New projections are new numbers for every team.
   */
  projectionStamp?: string | null,
): string {
  let version = `${modelVersion}:${projectionSource}`;
  if (leagueFingerprint) version += `:${leagueFingerprint}`;
  if (projectionStamp) version += `@${projectionStamp}`;
  return version;
}

/** FNV-1a over a canonical (key-sorted) JSON form. Collisions cost one stale row. */
function fingerprintOf(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") {
      return Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, inner]) => [k, canonical(inner)]);
    }
    return v;
  };
  const json = JSON.stringify(canonical(value)) ?? "";
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * A short fingerprint of every league setting that changes a Power Pulse
 * result: the playoff shape (teams, start week, round type, seeding, losers
 * bracket), divisions, the median game, best ball, the chopped switch, the
 * starting slots and the scoring.
 */
export function leagueResultFingerprint(league: LeagueRow): string {
  return fingerprintOf({
    playoffTeams: league.playoffTeams,
    playoffWeekStart: league.playoffWeekStart,
    playoffRoundType: league.playoffRoundType,
    playoffSeedType: league.playoffSeedType ?? 0,
    playoffType: league.playoffType ?? 0,
    divisions: league.divisions ?? 0,
    medianMatch: league.medianMatch,
    bestBall: league.bestBall ?? false,
    chopped: league.chopped,
    rosterPositions: league.rosterPositions,
    scoringSettings: league.scoringSettings,
  });
}

/**
 * The full cache version for one league at one week: the model, the source
 * it reads, the league settings and the projection sync stamp. The staleness
 * gate and the writer both call this, so the two can never disagree.
 */
export async function resolvePowerPulseCacheVersion(
  supabase: ServiceClient,
  league: LeagueRow,
  settings: Pick<PowerPulseSettings, "modelVersion" | "beaconProjections">,
  currentWeek: number,
): Promise<string> {
  const projectionSource = await resolveProjectionSourceForWindow({
    supabase,
    season: league.season,
    fromWeek: currentWeek,
    settings: settings.beaconProjections,
  });
  const stamp = await loadProjectionStamp(supabase, projectionSource, league.season, currentWeek);
  return powerPulseCacheModelVersion(
    settings.modelVersion,
    projectionSource,
    leagueResultFingerprint(league),
    stamp,
  );
}

export async function powerPulseIsStale(
  supabase: ServiceClient,
  leagueRowId: string,
  season: number,
  playoffWeekStart: number,
  getCurrentWeek: () => Promise<number>,
  /**
   * The version the cache should be keyed on, resolved LAZILY.
   *
   * A function rather than a string because working it out can cost two count
   * probes: it folds in which projection source this league would actually
   * read (see `cacheModelVersion` in calculateLeaguePowerPulse for why the
   * source has to be in the key at all). Every cheaper reason to answer the
   * question first, so a league in backoff, one with no cached row, or one
   * whose week window has moved on never pays for it.
   */
  getModelVersion: () => Promise<string>,
  /**
   * When the league sync last saw a roster change (players, injured reserve,
   * taxi squad or pick ownership), from `leagues.rosters_changed_at`. A cache
   * row generated before it describes rosters that no longer exist, so it is
   * stale whatever its age. Null or absent means no change on record, which
   * leaves the gate exactly as it was.
   */
  rostersChangedAt: string | null = null,
): Promise<boolean> {
  const { data: backoffRow } = await supabase
    .from("leagues")
    .select("last_pulsed_at, power_pulse_status, power_pulse_detail, power_pulse_attempted_at")
    .eq("id", leagueRowId)
    .maybeSingle();

  if (backoffRow) {
    const status = backoffRow.power_pulse_status;
    if (status === "error" || status === "skipped") {
      if (withinRetryBackoff(backoffRow)) return false;
    } else if (status === "settled") {
      const stored = parseSettledTriple(backoffRow.power_pulse_detail);
      if (stored) {
        const currentWeek = await getCurrentWeek();
        if (
          stored.season === season &&
          stored.currentWeek === currentWeek &&
          stored.playoffWeekStart === playoffWeekStart
        ) {
          return false;
        }
      }
    }
    // null / 'pending' / 'ok': no backoff. A null status (a pre-migration row,
    // or a league that has never attempted Power Pulse) behaves as 'pending':
    // no backoff, a normal first attempt.
  }

  const { data, error } = await supabase
    .from("league_power_pulse_cache")
    .select("generated_at, through_week, model_version")
    .eq("league_id", leagueRowId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.generated_at) return true;
  if (changedSince(rostersChangedAt, data.generated_at)) return true;
  const currentWeek = await getCurrentWeek();
  if (Number(data.through_week) < currentWeek - 1) return true;
  // Last, because it is the only check that can cost a round trip.
  if (data.model_version !== (await getModelVersion())) return true;
  return Date.now() - new Date(data.generated_at).getTime() >= POWER_PULSE_TTL_MS;
}

async function stampAttempted(
  supabase: ServiceClient,
  leagueRowId: string,
  attemptedAt: string,
): Promise<void> {
  const { error } = await supabase
    .from("leagues")
    .update({ power_pulse_attempted_at: attemptedAt })
    .eq("id", leagueRowId);
  if (error) {
    console.warn(
      `[power-pulse] could not stamp attempted_at for league ${leagueRowId}: ${error.message}`,
    );
  }
}

/**
 * Persist the verdict. Called after calculateLeaguePowerPulse returns (or,
 * from the catch block below, after it throws), so this always runs after
 * whatever cache rows it wrote or cleared. power_pulse_succeeded_at is
 * stamped only when result.ok is true: 'ok', 'skipped', and 'settled' are all
 * a completed run that reached an honest answer, 'error' is not.
 */
async function writeVerdict(
  supabase: ServiceClient,
  leagueRowId: string,
  result: PowerPulseResult,
): Promise<void> {
  const { status, detail } = classifyPowerPulseResult(result);
  let finalDetail = detail;
  if (status === "settled" && result.ok) {
    // The triple recorded is the one this verdict was reached under. Reading
    // playoffWeekStart back from the league row (rather than threading it
    // through PowerPulseResult) keeps calculateLeaguePowerPulse's return
    // shape untouched.
    const league = await loadLeague(supabase, leagueRowId);
    const playoffWeekStart = league?.playoffWeekStart ?? 15;
    finalDetail = encodeSettledDetail(detail, result.season, result.currentWeek, playoffWeekStart);
  }
  finalDetail = truncateDetail(finalDetail);

  const update: Database["public"]["Tables"]["leagues"]["Update"] = {
    power_pulse_status: status,
    power_pulse_detail: finalDetail,
  };
  if (result.ok) {
    update.power_pulse_succeeded_at = new Date().toISOString();
  }

  const { error } = await supabase.from("leagues").update(update).eq("id", leagueRowId);
  if (error) {
    console.warn(
      `[power-pulse] could not write verdict for league ${leagueRowId}: ${error.message}`,
    );
  }
}

/**
 * Recompute Power Pulse for a league if it is stale, swallowing every failure.
 *
 * This is what pulseLeague calls. Power Pulse is a bonus surface: a league page
 * must still render its rosters, transactions, and value rankings when the
 * model cannot run, so nothing here is allowed to throw.
 *
 * Gating mirrors the power rankings: recompute at most once per TTL, plus
 * whenever the live NFL week moves past the stored one, so a Sunday night
 * refresh picks up the new week's schedule, plus whenever the league sync has
 * recorded a roster change newer than the cached row (`rostersChangedAt`).
 * `force` always recomputes and always bypasses the backoff below.
 *
 * Backoff bypass table (see powerPulseIsStale / withinRetryBackoff for the
 * mechanics):
 *
 * | Last status      | Retried immediately when                              |
 * | ---------------- | ------------------------------------------------------ |
 * | error, skipped    | force:true, OR last_pulsed_at advanced since the attempt |
 * | settled           | force:true, OR (season, currentWeek, playoffWeekStart) changed |
 *
 * power_pulse_attempted_at is stamped before calculateLeaguePowerPulse runs,
 * so a crash mid-run still leaves an honest attempt and the retry window
 * still applies rather than hot-looping. power_pulse_succeeded_at and the
 * status/detail are written after the cache rows land (writeVerdict runs
 * after calculateLeaguePowerPulse returns).
 */
export async function refreshPowerPulse(
  supabase: ServiceClient,
  leagueRowId: string,
  options: {
    force?: boolean;
    /**
     * `leagues.rosters_changed_at`, read by the caller (pulseLeagueDerived
     * already reads the league row). A cache row older than it is stale
     * whatever its age, so a trade or a waiver claim rescores the league on
     * the pass that saw it rather than twelve hours later. Still on demand
     * only: this never runs from a cron, and a league whose rosters did not
     * change recomputes exactly as often as before.
     */
    rostersChangedAt?: string | null;
  } = {},
): Promise<void> {
  let attemptedAt: string | null = null;
  try {
    // Settings and the league row are independent reads: one round trip.
    const [settings, preloadedLeague] = await Promise.all([
      loadPowerPulseSettings(supabase),
      options.force ? Promise.resolve(null) : loadLeague(supabase, leagueRowId),
    ]);
    if (!options.force) {
      const league = preloadedLeague;
      if (!league) return;
      // Lazy: only invoked (and only then does it touch Sleeper) if
      // powerPulseIsStale's backoff check does not already resolve the
      // question on its own.
      // Unknown week (Sleeper's NFL state did not answer): throw, which the
      // catch below logs, and the stored cache is served untouched (LPI-T02).
      const getCurrentWeek = () =>
        getNflState().then((state) => {
          const week = resolveCurrentWeek(state, league.season, league.playoffWeekStart);
          if (week === null) throw new Error("NFL week unknown: Sleeper state did not answer");
          return week;
        });
      const stale = await powerPulseIsStale(
        supabase,
        leagueRowId,
        league.season,
        league.playoffWeekStart,
        getCurrentWeek,
        async () =>
          resolvePowerPulseCacheVersion(supabase, league, settings, await getCurrentWeek()),
        options.rostersChangedAt ?? null,
      );
      if (!stale) return;
    }

    attemptedAt = new Date().toISOString();
    await stampAttempted(supabase, leagueRowId, attemptedAt);

    const result = await calculateLeaguePowerPulse(supabase, leagueRowId, {
      force: options.force,
    });
    await writeVerdict(supabase, leagueRowId, result);

    if (!result.ok) {
      console.warn(`[power-pulse] calc failed for league ${leagueRowId}: ${result.error}`);
    } else if (result.skipped) {
      console.log(`[power-pulse] skipped for league ${leagueRowId}: ${result.skipped}`);
    }
  } catch (err) {
    console.warn(`[power-pulse] calc threw for league ${leagueRowId}:`, (err as Error).message);
    if (attemptedAt) {
      // attempted_at was already stamped for this run; record why it did not
      // complete rather than leaving the previous verdict looking current.
      await writeVerdict(supabase, leagueRowId, {
        ok: false,
        error: (err as Error).message,
      }).catch(() => {});
    }
  }
}

/**
 * Measured lineup efficiency per roster, from the Manager Ledger cache.
 *
 * Read only when `settings.lineupRealism.enabled` is true. Never triggers a
 * ledger computation: the ledger is on-demand-only through the Decisions page,
 * for the same scaling reasons as this model, so a league that has never had
 * one simply gets an empty map and every roster keeps the perfect-lineup
 * assumption. A failed read is treated the same way, because degrading to the
 * previous behavior is always safe and throwing here would fail a league page.
 */
async function loadMeasuredEfficiency(
  supabase: ServiceClient,
  leagueRowId: string,
  season: number,
): Promise<Map<number, { efficiency: number; weeksGraded: number }>> {
  const out = new Map<number, { efficiency: number; weeksGraded: number }>();
  const { data, error } = await supabase
    .from("league_manager_ledger_cache")
    .select("sleeper_roster_id, lineup_efficiency, weeks_graded")
    .eq("league_id", leagueRowId)
    .eq("season", season);
  if (error || !data) return out;
  for (const row of data) {
    const efficiency = Number(row.lineup_efficiency);
    if (!Number.isFinite(efficiency)) continue;
    out.set(Number(row.sleeper_roster_id), {
      efficiency,
      weeksGraded: Number(row.weeks_graded ?? 0),
    });
  }
  return out;
}

export async function calculateLeaguePowerPulse(
  supabase: ServiceClient,
  leagueRowId: string,
  options: { force?: boolean } = {},
): Promise<PowerPulseResult> {
  const league = await loadLeague(supabase, leagueRowId);
  if (!league) return { ok: false, error: "league row not found" };

  // A chopped league's rows from before the chopped model (pp-6 to pp-8, and
  // any other row not marked chopped) describe a bracket the league does not
  // have. They are never a good cache, so they go first, before the unknown
  // week, a failed sync or an incomplete schedule can return early and leave
  // them standing for every reader of the cache.
  const [settings, nflState] = await Promise.all([
    loadPowerPulseSettings(supabase),
    getNflState(),
    league.chopped
      ? purgeBracketRowsForChoppedLeague(supabase, leagueRowId, league.season)
      : Promise.resolve(),
  ]);
  const currentWeek = resolveCurrentWeek(nflState, league.season, league.playoffWeekStart);
  // Unknown week: no sync, no compute, the stored cache stays (LPI-T02).
  if (currentWeek === null) {
    return {
      ok: true,
      teams: 0,
      season: league.season,
      currentWeek: 0,
      skipped: "NFL week unknown (Sleeper state did not answer)",
    };
  }

  // Refresh the head-to-head slate before reading it.
  const matchupSync = await syncLeagueMatchups(
    supabase,
    league.id,
    league.sleeperLeagueId,
    league.season,
    currentWeek,
    { force: options.force },
  );
  // A failed database read or write inside the sync (no Sleeper week missing)
  // is an error, not an empty slate: stop, write nothing, keep the cache. The
  // Sleeper-side misses are the failedWeeks case just below.
  if (!matchupSync.ok && matchupSync.failedWeeks.length === 0) {
    return {
      ok: false,
      error: `matchup sync failed: ${matchupSync.error ?? "unknown error"}`,
    };
  }

  // A schedule we could not fully fetch is not a schedule we may reason about.
  // Sleeper timing out or throttling looks exactly like "this league has no
  // games" once the failure is flattened into an empty list, and scoring a
  // league against an empty slate produces a table of 0.0 win projections and
  // 0%/100% playoff odds that then sits in the cache for the full TTL. Bail
  // before the expensive loads and leave whatever is already cached alone; the
  // absence of a fresh row makes the next page view retry.
  if (matchupSync.failedWeeks.length > 0) {
    return {
      ok: true,
      teams: 0,
      season: league.season,
      currentWeek,
      skipped: `incomplete schedule fetch (weeks ${matchupSync.failedWeeks.join(", ")} did not answer)`,
    };
  }

  // Sleeper answered the probe with no games, so this league has no slate at
  // all. Stop before the roster, player, and projection loads rather than
  // paying for them on every view of an undrafted league.
  if (matchupSync.noScheduleYet) {
    await clearCache(supabase, leagueRowId, league.season);
    return {
      ok: true,
      teams: 0,
      season: league.season,
      currentWeek,
      skipped: "no published schedule",
    };
  }

  const rosters = await loadRosters(supabase, leagueRowId);
  if (rosters.length === 0) {
    return { ok: true, teams: 0, season: league.season, currentWeek, skipped: "no rosters" };
  }

  // Nothing drafted yet. Every team would score zero, the ranks would be a
  // shuffle of ties, and we would cache that as though it meant something. Bail
  // before the expensive loads; the UI renders the pre-draft state instead.
  const rostersFilled = rosters.some((r) => r.playerSleeperIds.length > 0);
  if (isDraftPending(league.status) && !rostersFilled) {
    await clearCache(supabase, leagueRowId, league.season);
    return {
      ok: true,
      teams: 0,
      season: league.season,
      currentWeek,
      skipped: "draft pending with empty rosters",
    };
  }

  // The slate first, because whether any regular season game is left decides
  // which mode this league is scored in.
  const [schedule, results] = await Promise.all([
    loadSchedule(supabase, leagueRowId, league.season),
    loadCompletedResults(supabase, leagueRowId, league.season),
  ]);
  const regularWeeksLeft = schedule.weeks.filter(
    (w) => !w.isFinal && w.week >= currentWeek && w.week < league.playoffWeekStart,
  ).length;
  const playsBracket = !league.chopped && league.playoffTeams >= 2;

  // THE SEASON IS DECIDED. Once the title game is played the answer is the
  // real champion and the real final order, and it is kept: never cleared,
  // never rescored from projections that no longer exist. The stored rows are
  // brought up to the result and left alone after that.
  if (playsBracket && regularWeeksLeft === 0 && bracketFacts(league.winnersBracket).championRosterId !== null) {
    const kept = await keepFinalResult(supabase, league, rosters);
    if (kept > 0) {
      return {
        ok: true,
        teams: kept,
        season: league.season,
        currentWeek,
        skipped: "season complete, final result kept",
      };
    }
    // No rows were ever computed for this season: fall through and score it
    // from whatever projections exist, which the engine marks complete too.
  }

  const sleeperIds = Array.from(
    new Set(rosters.flatMap((r) => r.playerSleeperIds)),
  );
  const scoringBase = closestScoringBase(league.scoringSettings);
  // The IDP switch, read once here and passed down as a boolean (plan R-25).
  // Off, or on in a league that starts no defensive slot: the offense list and
  // one scoring key, the exact reads this made before the switch existed.
  const idpReads = idpReadsFor(idpEnabledFrom(settings), league.rosterPositions, scoringBase);

  const players = await loadPlayers(supabase, sleeperIds, {
    positions: idpReads.candidatePositions,
  });
  const playerIds = Array.from(new Set([...players.values()].map((p) => p.playerId)));

  // Opponent splits come from whichever of the current season and the two
  // before it actually have a usable row; opponentMultiplier picks.
  const defenseSeasons = defenseSeasonsFor(league.season);

  // WHICH PROJECTION SOURCE THIS SCORE IS BUILT ON IS NOT DECIDED HERE.
  //
  // Both loads below used to default to Sleeper, which meant the FF Beacon
  // projection engine could be switched on and Power Pulse, the model every
  // other League Pulse surface reads its per-week numbers back out of, would
  // never notice. The resolver makes no query while the feature is disabled, so
  // this is free today. Enabling it changes the stored settings document, which
  // changes `modelVersion` (see effectiveModelVersion in
  // lib/power-pulse/default-settings.ts), which is what forces every cached row
  // to rescore rather than serving numbers from the old source for 12 hours.
  const projectionSource = await resolveProjectionSourceForWindow({
    supabase,
    season: league.season,
    fromWeek: currentWeek,
    settings: settings.beaconProjections,
  });

  const [projections, accuracy, defense, projectionStamp, live] = await Promise.all([
    // From the current week with no ceiling, so the playoff weeks' projections
    // are here for the playoff rounds.
    loadProjections(supabase, playerIds, league.season, currentWeek, undefined, projectionSource),
    // Scoped to the SAME source, per migration 0240.
    // A defender is graded and split under idp123 only (plan IDP-303).
    loadAccuracy(supabase, playerIds, scoringKeysArg(idpReads), projectionSource),
    loadDefenseSplits(supabase, scoringKeysArg(idpReads), defenseSeasons),
    loadProjectionStamp(supabase, projectionSource, league.season, currentWeek),
    // Points already on the board this week, once a game has kicked off.
    currentWeek <= MAX_MATCHUP_WEEK
      ? loadLiveWeek(supabase, leagueRowId, league.season, currentWeek)
      : Promise.resolve(null),
  ]);

  const cacheModelVersion = powerPulseCacheModelVersion(
    settings.modelVersion,
    projectionSource,
    leagueResultFingerprint(league),
    projectionStamp,
  );

  if (projections.length === 0) {
    return {
      ok: true,
      teams: 0,
      season: league.season,
      currentWeek,
      skipped: `no weekly projections stored for ${league.season} from week ${currentWeek}`,
    };
  }

  // Who is still in, in a chopped league. Read before the slate check below,
  // because there the number of teams left IS the remaining slate.
  const aliveRosterIds = league.chopped
    ? await loadAliveRosterIds(supabase, leagueRowId)
    : null;

  // No games left to play means there is nothing to project. This covers the
  // league waiting on its draft, the league whose schedule Sleeper has not
  // published, and the season that is already over. All three used to fall
  // through and cache "0.0 expected wins out of 1 game" for every team, which
  // reads as a real answer and is not one. Store nothing instead; the UI has
  // honest empty states, and no row means the next view recomputes.
  //
  // A chopped league is asked the same question in its own terms. Its
  // published pairings decide nothing, so what it has left to play is the run
  // of weeks between now and the one that leaves a single survivor, and a
  // league already down to that survivor is over: choppedWeeks says so by
  // coming back empty rather than by being clamped up to one more week.
  //
  // A bracket league whose regular season is over is NOT this case any more.
  // It is in its playoffs, and the engine simulates the rest of its stored
  // bracket from the playoff weeks' projections. Clearing it here is what used
  // to blank the page for the three weeks people care about most.
  const aliveCount = aliveRosterIds?.length ?? rosters.length;
  const remainingWeekCount = league.chopped
    ? choppedWeeks(
        currentWeek,
        resolveFinalWeek(currentWeek, aliveCount, league.choppedPerWeek ?? 1).finalWeek,
      )
        .length
    : regularWeeksLeft;
  const inPlayoffs = playsBracket && remainingWeekCount === 0 && schedule.weeks.length > 0;
  if (remainingWeekCount === 0 && !inPlayoffs) {
    await clearCache(supabase, leagueRowId, league.season);
    return {
      ok: true,
      teams: 0,
      season: league.season,
      currentWeek,
      skipped: league.chopped
        ? `chopped league has no weeks left to decide from week ${currentWeek}`
        : schedule.weeks.length === 0
          ? "no published schedule"
          : `no regular season games remaining from week ${currentWeek}`,
    };
  }

  // Measured lineup efficiency, read ONLY when an admin has turned the
  // correction on. Off by default, and the read does not happen at all in that
  // case, so a league with no Manager Ledger rows costs nothing here and
  // behaves exactly as it did before the setting existed. A missing row simply
  // leaves that roster on the perfect-lineup assumption.
  const lineupEfficiency = settings.lineupRealism?.enabled
    ? await loadMeasuredEfficiency(supabase, leagueRowId, league.season)
    : undefined;

  const teams = computePowerPulse({
    league,
    rosters,
    players,
    projections,
    accuracy,
    defense,
    defenseSeasons,
    schedule: schedule.weeks,
    setLineups: schedule.setLineups,
    results,
    lineupEfficiency,
    aliveRosterIds,
    currentWeek,
    settings,
    idpEnabled: idpReads.idpEnabled,
    live,
  });

  if (teams.length === 0) {
    return { ok: true, teams: 0, season: league.season, currentWeek, skipped: "no teams scored" };
  }

  const generatedAt = new Date().toISOString();
  const rows = teams.map((t) =>
    toCacheRow(t, leagueRowId, league.season, currentWeek, cacheModelVersion, generatedAt),
  );

  const { error } = await supabase
    .from("league_power_pulse_cache")
    .upsert(rows, { onConflict: "league_id,roster_id,season" });
  if (error) return { ok: false, error: `power pulse upsert failed: ${error.message}` };

  // Drop any row for a roster this run did NOT score. An upsert only touches
  // the rows it writes, so a roster the model has stopped scoring keeps the
  // last answer it was ever given, forever.
  //
  // A chopped league is where this bites: an eliminated team is left out of
  // the run on purpose, and what stayed behind was its final row, which reads
  // 0.0 projected points, 0% playoff odds and last place. That is the exact
  // shape of degenerate row the guards above exist to keep out of the cache,
  // and it was sitting in a table of live teams describing a team that is not
  // in the league any more. It also applies to an ordinary league whose roster
  // count shrank.
  const scoredRosterIds = rows.map((r) => r.roster_id);
  const { error: pruneError } = await supabase
    .from("league_power_pulse_cache")
    .delete()
    .eq("league_id", leagueRowId)
    .eq("season", league.season)
    .not("roster_id", "in", `(${scoredRosterIds.join(",")})`);
  if (pruneError) {
    // Not fatal: the rows this run wrote are correct and are what nearly every
    // surface reads. Logged rather than failed, the same way a failed cache
    // clear is, because refusing the whole run over a leftover row would throw
    // away the answer we just computed.
    console.warn(
      `[power-pulse] could not prune unscored rows for league ${leagueRowId}: ${pruneError.message}`,
    );
  }

  return { ok: true, teams: teams.length, season: league.season, currentWeek };
}

/**
 * Drop any cached rows for a league season we have just decided cannot be
 * scored.
 *
 * Declining to write a new row is not enough on its own: a league that was
 * scored under a previous run keeps showing those numbers forever, and the
 * numbers most likely to be sitting there are the degenerate ones this guard
 * exists to prevent. Only called from the branches that are a settled statement
 * about the league (no schedule, nothing drafted, no games left), never from a
 * transient fetch failure, where the previous answer is still the best one we
 * have.
 */
async function clearCache(
  supabase: ServiceClient,
  leagueRowId: string,
  season: number,
): Promise<void> {
  const { error } = await supabase
    .from("league_power_pulse_cache")
    .delete()
    .eq("league_id", leagueRowId)
    .eq("season", season);
  if (error) {
    console.warn(
      `[power-pulse] could not clear stale cache for league ${leagueRowId}: ${error.message}`,
    );
  }
}

/**
 * Delete a chopped league's rows that were not scored by the chopped model.
 * Rows written by pp-6 to pp-8, before chopped leagues had their own model,
 * carry bracket odds for a league with no bracket, and nothing may serve them.
 */
async function purgeBracketRowsForChoppedLeague(
  supabase: ServiceClient,
  leagueRowId: string,
  season: number,
): Promise<void> {
  const { error } = await supabase
    .from("league_power_pulse_cache")
    .delete()
    .eq("league_id", leagueRowId)
    .eq("season", season)
    .eq("chopped", false);
  if (error) {
    console.warn(
      `[power-pulse] could not purge bracket rows for chopped league ${leagueRowId}: ${error.message}`,
    );
  }
}

/**
 * Bring the stored rows of a finished bracket league up to the real result:
 * title odds 1 for the champion and 0 for everyone else, playoff odds 1 for the
 * field, and each team's playoff state (seed, champion or eliminated, final
 * place) in components.playoff. Rows already showing the result are not
 * written again. Returns how many rows the league holds; 0 means there is
 * nothing to keep and the caller scores the season instead.
 *
 * Throws on a failed read or write: a final result half written is not one.
 */
async function keepFinalResult(
  supabase: ServiceClient,
  league: LeagueRow,
  rosters: RosterRow[],
): Promise<number> {
  const { data, error } = await supabase
    .from("league_power_pulse_cache")
    .select("id, roster_id, title_odds, playoff_odds, components")
    .eq("league_id", league.id)
    .eq("season", league.season);
  if (error) throw new Error(`power pulse cache read failed: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return 0;

  const teams = rosters.filter((r) => r.playerSleeperIds.length > 0);
  const { states } = playoffStates(
    teams.map((r) => ({
      sleeperRosterId: r.sleeperRosterId,
      wins: r.wins,
      ties: r.ties,
      pointsFor: r.pointsFor,
      division: r.division ?? null,
    })),
    league,
    true,
  );
  const sleeperIdByRow = new Map(rosters.map((r) => [r.id, r.sleeperRosterId]));

  for (const row of rows) {
    const sleeperRosterId = sleeperIdByRow.get(row.roster_id);
    const state = sleeperRosterId === undefined ? undefined : states.get(sleeperRosterId);
    if (!state) continue;
    const titleOdds = state.status === "champion" ? 1 : 0;
    const playoffOdds = state.seed !== null ? 1 : 0;
    const components = (row.components ?? {}) as Record<string, unknown>;
    const current = JSON.stringify(components.playoff ?? null);
    if (
      Number(row.title_odds) === titleOdds &&
      Number(row.playoff_odds) === playoffOdds &&
      current === JSON.stringify(state)
    ) {
      continue;
    }
    const { error: writeError } = await supabase
      .from("league_power_pulse_cache")
      .update({
        title_odds: titleOdds,
        playoff_odds: playoffOdds,
        components: { ...components, playoff: state } as unknown as Json,
      })
      .eq("id", row.id);
    if (writeError) throw new Error(`power pulse final result write failed: ${writeError.message}`);
  }
  return rows.length;
}

function toCacheRow(
  t: PowerPulseTeamResult,
  leagueId: string,
  season: number,
  currentWeek: number,
  modelVersion: string,
  generatedAt: string,
): Database["public"]["Tables"]["league_power_pulse_cache"]["Insert"] {
  return {
    league_id: leagueId,
    roster_id: t.rosterRowId,
    season,
    through_week: Math.max(0, currentWeek - 1),
    power_pulse: t.powerPulse,
    pulse_rank: t.pulseRank,
    score_points: t.scorePoints,
    score_points_rank: t.scorePointsRank,
    score_schedule: t.scoreSchedule,
    score_schedule_rank: t.scoreScheduleRank,
    score_depth: t.scoreDepth,
    score_depth_rank: t.scoreDepthRank,
    score_form: t.scoreForm,
    score_form_rank: t.scoreFormRank,
    expected_points_per_week: t.expectedPointsPerWeek,
    expected_points_stdev: t.expectedPointsStdev,
    expected_wins: t.expectedWins,
    projected_wins: t.projectedWins,
    projected_losses: t.projectedLosses,
    projected_ties: t.projectedTies,
    playoff_odds: t.playoffOdds,
    bye_odds: t.byeOdds,
    title_odds: t.titleOdds,
    last_place_odds: t.lastPlaceOdds,
    sos_points: t.sosPoints,
    sos_rank: t.sosRank,
    lineup_efficiency: t.lineupEfficiency,
    lineup_efficiency_rank: t.lineupEfficiencyRank,
    lineup_points_lost: t.lineupPointsLost,
    reliability_score: t.reliabilityScore,
    reliability_rank: t.reliabilityRank,
    chopped: t.chopped,
    chop_odds_this_week: t.chopOddsThisWeek,
    survive_all_odds: t.surviveAllOdds,
    expected_weeks_alive: t.expectedWeeksAlive,
    weekly: t.weekly as unknown as Json,
    drivers: t.drivers as unknown as Json,
    components: t.components as unknown as Json,
    model_version: modelVersion,
    generated_at: generatedAt,
  };
}
