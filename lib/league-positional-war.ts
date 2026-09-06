/**
 * Positional WAR orchestrator.
 *
 * Mirrors lib/league-power-pulse.ts in shape: load one league's world, run
 * the model, upsert the cache, never throw to the caller. The differences
 * from Power Pulse are all in section 4 and section 6 of
 * docs/league-pulse/league-pulse-positional-war-plan.md: this model reads no roster (it
 * evaluates the whole projectable universe against a league-average
 * reference team, not any one team's players), does not vary by value source
 * or format, and its result is a pure enough function of the league's
 * settings that two leagues with identical inputs can share the compute
 * (lib/positional-war/share.ts, E4).
 *
 * A failure here is never fatal to a league page. The caller logs and moves
 * on; the panel renders its own honest empty state from
 * leagues.positional_war_status.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getNflState } from "@/lib/sleeper";
import { resolveCurrentWeek } from "@/lib/league-matchups";
import { loadLeague } from "@/lib/power-pulse/load";
import { loadPowerPulseSettings, type PowerPulseSettings } from "@/lib/power-pulse/settings";
import { startingSlots } from "@/lib/power-pulse/lineup";
import { closestScoringBase } from "@/lib/league-scoring";
import { resolveProjectionSourceForWindow } from "@/lib/projections/source";
import {
  loadWarUniverse,
  loadProjectionsSnapshot,
  loadAccuracySnapshot,
  buildWarPlayers,
} from "@/lib/positional-war/load";
import { computeCurves } from "@/lib/positional-war/engine";
import {
  warFingerprint,
  warInputsDigest,
  type WarFingerprintInput,
  type WarInputsDigest,
} from "@/lib/positional-war/fingerprint";
import {
  POSITIONAL_WAR_TTL_MS,
  POSITIONAL_WAR_RETRY_MS,
} from "@/lib/positional-war/default-settings";
import { resolveSharedCurves } from "@/lib/positional-war/share";
import type { PositionCurve } from "@/lib/positional-war/types";

export { POSITIONAL_WAR_TTL_MS, POSITIONAL_WAR_RETRY_MS };

type ServiceClient = SupabaseClient<Database>;

export type PositionalWarResult =
  | {
      ok: true;
      positions: number;
      season: number;
      fromWeek: number;
      toWeek: number;
      shared: boolean;
      skipped?: string;
      /**
       * Set when a stored fingerprint hit had a mismatched inputs_digest
       * (section 15.4.3) and this run recomputed fresh. Not part of the
       * brief's literal result shape; added so refreshPositionalWar can write
       * the "fingerprint collision, recomputed" detail without a second
       * round trip. `positions` and `shared: false` already describe the
       * successful outcome; this is purely a detail-text signal.
       */
      collision?: boolean;
      /**
       * Also not part of the brief's literal shape: the run's fingerprint, so
       * refreshPositionalWar's log line can carry its first 8 characters
       * without recomputing it a second time just to log it.
       */
      fingerprint?: string;
    }
  | { ok: false; error: string };

/** The verdict persisted to leagues.positional_war_status. */
export type PositionalWarVerdictStatus = "ok" | "skipped" | "settled" | "error";

const MAX_DETAIL_LENGTH = 500;

function truncateDetail(detail: string): string {
  return detail.length > MAX_DETAIL_LENGTH ? detail.slice(0, MAX_DETAIL_LENGTH) : detail;
}

// calculateLeaguePositionalWar's `skipped` reason strings, sorted into the
// two verdicts, mirroring lib/league-power-pulse.ts's classification tables.
// 'skipped' is for a reason likely to clear up soon on its own (rosters or
// projections that have not synced yet). 'settled' is for a reason that is a
// statement about the season/week window and will not change until a real
// event happens (no regular season weeks left). Matched by prefix because the
// reason carries a dynamic week number.
const SETTLED_REASON_TESTS: Array<(reason: string) => boolean> = [
  (r) => r.startsWith("no regular season weeks remaining from week"),
];

/**
 * Map calculateLeaguePositionalWar's return shape to the verdict persisted on
 * leagues.positional_war_status. A lookup over an already-exhaustive set of
 * reason strings, not new calculation logic. An unrecognised skipped reason
 * classifies as 'skipped' rather than 'settled', the same reasoning as Power
 * Pulse: the cost of an unnecessary extra retry is one recompute, the cost of
 * a wrongly-'settled' league is silence.
 */
export function classifyPositionalWarResult(
  result: PositionalWarResult,
): { status: PositionalWarVerdictStatus; detail: string } {
  if (!result.ok) {
    return { status: "error", detail: result.error };
  }
  if (result.skipped) {
    const reason = result.skipped;
    if (SETTLED_REASON_TESTS.some((test) => test(reason))) {
      return { status: "settled", detail: reason };
    }
    return { status: "skipped", detail: reason };
  }
  if (result.collision) {
    return { status: "ok", detail: "fingerprint collision, recomputed" };
  }
  const base = `${result.positions} position${result.positions === 1 ? "" : "s"}`;
  return { status: "ok", detail: result.shared ? `${base}, shared` : base };
}

/**
 * The machine-readable suffix a 'settled' verdict's detail carries, recording
 * the (season, fromWeek, toWeek) triple that made it settled. Format:
 * `<reason> [settled season=2026 fromWeek=9 toWeek=8]`. Mirrors the bracketed
 * key=value convention lib/league-power-pulse.ts uses for its own
 * (season, week, playoffStart) triple, so the admin health view can read both
 * with the same pattern, carrying the fields this model actually has: a week
 * WINDOW rather than a single current week plus a playoff start.
 */
const SETTLED_TRIPLE_SUFFIX = / \[settled season=(\d+) fromWeek=(\d+) toWeek=(-?\d+)\]$/;

function encodeSettledDetail(reason: string, season: number, fromWeek: number, toWeek: number): string {
  return `${reason} [settled season=${season} fromWeek=${fromWeek} toWeek=${toWeek}]`;
}

function parseSettledTriple(
  detail: string | null,
): { season: number; fromWeek: number; toWeek: number } | null {
  if (!detail) return null;
  const m = SETTLED_TRIPLE_SUFFIX.exec(detail);
  if (!m) return null;
  return { season: Number(m[1]), fromWeek: Number(m[2]), toWeek: Number(m[3]) };
}

type BackoffRow = {
  last_pulsed_at: string | null;
  positional_war_status: string | null;
  positional_war_detail: string | null;
  positional_war_attempted_at: string | null;
};

/** The backoff columns plus the season, which is what keys the cache read. */
type WarGateRow = BackoffRow & { season: number | null };

/**
 * The one `leagues` read the gate needs.
 *
 * This used to be two reads of the same row a few lines apart: one for the
 * season, one for the backoff columns. Same table, same primary key, same
 * request; there was never a reason for the round trip.
 */
async function loadWarGateRow(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<WarGateRow | null> {
  const { data } = await supabase
    .from("leagues")
    .select(
      "season, last_pulsed_at, positional_war_status, positional_war_detail, positional_war_attempted_at",
    )
    .eq("id", leagueRowId)
    .maybeSingle();
  return (data as WarGateRow | null) ?? null;
}

/** Whether the last attempt is still inside its retry window. */
function withinRetryBackoff(row: BackoffRow): boolean {
  if (!row.positional_war_attempted_at) return false;
  const attemptedAt = new Date(row.positional_war_attempted_at).getTime();
  if (Number.isNaN(attemptedAt)) return false;
  return Date.now() - attemptedAt < POSITIONAL_WAR_RETRY_MS;
}

/**
 * last_pulsed_at having advanced past the attempt is what keeps a league
 * responsive on draft night: pulseLeagueCore writes rosters and advances
 * last_pulsed_at on every real resync, so a league that changed since the
 * last attempt is worth retrying on the very next view rather than waiting
 * out fifteen minutes. Matches withinRetryBackoff's sibling check in
 * lib/league-power-pulse.ts.
 */
function lastPulsedAtAdvanced(row: BackoffRow): boolean {
  if (!row.positional_war_attempted_at || !row.last_pulsed_at) return false;
  const attemptedAt = new Date(row.positional_war_attempted_at).getTime();
  const lastPulsedAt = new Date(row.last_pulsed_at).getTime();
  if (Number.isNaN(attemptedAt) || Number.isNaN(lastPulsedAt)) return false;
  return lastPulsedAt > attemptedAt;
}

/** Everything needed to run the model, once the cheap checks have all passed. */
type WarContext = {
  season: number;
  fromWeek: number;
  toWeek: number;
  teamCount: number;
  rosterPositions: string[];
  scoringSettings: WarFingerprintInput["scoringSettings"];
  pulseSettings: PowerPulseSettings;
  /** "sleeper" or "ffbeacon", resolved once for the whole compute. */
  projectionSource: string;
  fingerprintInput: WarFingerprintInput;
  fingerprint: string;
  digest: WarInputsDigest;
};

/** A reason to skip, carrying enough of the window to report and (for a settled reason) to clear against. */
type WarSkip = { skipped: string; season: number; fromWeek: number; toWeek: number };

function isSkip(value: WarContext | WarSkip | null): value is WarSkip {
  return value !== null && "skipped" in value;
}

/** How many roster rows this league has stored, or null when the read failed. */
async function countStoredRosters(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from("rosters")
    .select("id", { count: "exact", head: true })
    .eq("league_id", leagueRowId);
  return !error && count !== null ? count : null;
}

/**
 * Pure once its two inputs are in hand, so the read it used to do inline can
 * run alongside the other reads in the same wave. Same precedence as before:
 * Sleeper's own total_rosters wins, the stored roster count is the fallback,
 * and a disagreement is logged rather than silently resolved.
 */
function resolveTeamCount(
  leagueRowId: string,
  totalRosters: number | null,
  storedRosterCount: number | null,
): number | null {
  if (totalRosters !== null && totalRosters > 0) {
    if (storedRosterCount !== null && storedRosterCount > 0 && storedRosterCount !== totalRosters) {
      console.warn(
        `[positional-war] league ${leagueRowId}: total_rosters=${totalRosters} disagrees with stored roster count=${storedRosterCount}; using total_rosters`,
      );
    }
    return totalRosters;
  }
  if (storedRosterCount !== null && storedRosterCount > 0) return storedRosterCount;
  return null;
}

async function loadTotalRosters(supabase: ServiceClient, leagueRowId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from("leagues")
    .select("total_rosters")
    .eq("id", leagueRowId)
    .maybeSingle();
  if (error || !data) return null;
  const n = data.total_rosters;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Build the cheap (universe-free) fingerprint context for one league: the
 * league row, the settings, the resolved week window, the team count, and
 * the projections snapshot. Section 8.2: "the fingerprint needs the league
 * row, the settings, and the projections snapshot, all cheap, and NOT the
 * universe load." This is that cheap half, reused by both the backoff bypass
 * check and the real computation so the two can never compute the
 * fingerprint two different ways, and reused again by the skip branches so
 * calculateLeaguePositionalWar never needs to redo a load just to report the
 * window it already resolved here.
 *
 * Returns null only when there is no league row at all. A resolvable-but-
 * skippable state (empty window, unknown team count, no projections) is a
 * WarSkip, not a null: the caller still has season/fromWeek/toWeek to report
 * and, for the settled case, to clear the cache against.
 */
async function buildWarContext(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<WarContext | WarSkip | null> {
  // Two waves, not six serial reads. Nothing in the first three depends on
  // either of the others, and this whole function runs on EVERY view of a
  // league page whose curve is already fresh, so its round trips were the
  // warm path's entire cost. Splitting at the week window is the real
  // boundary: the second wave cannot start until fromWeek exists, and the
  // empty-window return below must still fire before anything in it runs.
  const [league, settings, nflState] = await Promise.all([
    loadLeague(supabase, leagueRowId),
    loadPowerPulseSettings(supabase),
    getNflState(),
  ]);
  if (!league) return null;

  const fromWeek = resolveCurrentWeek(nflState, league.season, league.playoffWeekStart);
  const toWeek = league.playoffWeekStart - 1;

  if (toWeek < fromWeek) {
    return {
      skipped: `no regular season weeks remaining from week ${fromWeek}`,
      season: league.season,
      fromWeek,
      toWeek,
    };
  }

  // WHICH PROJECTION SOURCE THIS CURVE IS BUILT FROM.
  //
  // Resolved here rather than inside the loader so ONE answer feeds the
  // universe read, the freshness snapshot and the fingerprint. It makes no
  // query at all while the FF Beacon projection engine is disabled, which is
  // the default, so the warm path pays nothing for it.
  const projectionSource = await resolveProjectionSourceForWindow({
    supabase,
    season: league.season,
    fromWeek,
    toWeek,
    settings: settings.beaconProjections,
  });

  const [totalRosters, storedRosterCount, projectionsSnapshot, accuracySnapshot] =
    await Promise.all([
      loadTotalRosters(supabase, leagueRowId),
      countStoredRosters(supabase, leagueRowId),
      loadProjectionsSnapshot({
        season: league.season,
        fromWeek,
        source: projectionSource,
      }),
      loadAccuracySnapshot(),
    ]);

  const teamCount = resolveTeamCount(leagueRowId, totalRosters, storedRosterCount);
  if (teamCount === null) {
    return { skipped: "unknown team count", season: league.season, fromWeek, toWeek };
  }

  if (!projectionsSnapshot) {
    return {
      skipped: `no weekly projections stored for ${league.season} from week ${fromWeek}`,
      season: league.season,
      fromWeek,
      toWeek,
    };
  }

  const fingerprintInput: WarFingerprintInput = {
    season: league.season,
    fromWeek,
    toWeek,
    teamCount,
    rosterPositions: league.rosterPositions,
    scoringSettings: league.scoringSettings,
    pulseSettings: {
      reliability: settings.reliability,
      availability: settings.availability,
      injury: settings.injury,
      opponent: settings.opponent,
      variance: settings.variance,
      recency: settings.recency,
    },
    warSettings: {
      displayDepthMultiple: settings.war.displayDepthMultiple,
      minDisplayDepth: settings.war.minDisplayDepth,
      cliffThreshold: settings.war.cliffThreshold,
      clampBelowReplacement: settings.war.clampBelowReplacement,
    },
    modelVersion: settings.war.modelVersion,
    projectionsSnapshot,
    accuracySnapshot,
    projectionSource,
  };

  return {
    season: league.season,
    fromWeek,
    toWeek,
    teamCount,
    rosterPositions: league.rosterPositions,
    scoringSettings: league.scoringSettings,
    pulseSettings: settings,
    projectionSource,
    fingerprintInput,
    fingerprint: warFingerprint(fingerprintInput),
    digest: warInputsDigest(fingerprintInput),
  };
}

async function readStoredFingerprint(
  supabase: ServiceClient,
  leagueRowId: string,
  season: number,
): Promise<string | null> {
  const { data } = await supabase
    .from("league_positional_war_cache")
    .select("fingerprint")
    .eq("league_id", leagueRowId)
    .eq("season", season)
    .limit(1)
    .maybeSingle();
  return data?.fingerprint ?? null;
}

/**
 * Whether this league needs a Positional WAR recompute.
 *
 * Backoff first, mirroring lib/league-power-pulse.ts powerPulseIsStale: a
 * league whose last attempt was not 'ok' and has not earned a bypass costs a
 * handful of cheap selects (never the universe load) and returns false.
 *
 * Bypass table (section 8.2):
 *
 * | Last status      | Retried immediately when                                       |
 * | ----------------- | --------------------------------------------------------------- |
 * | error, skipped     | force, OR the fingerprint changed, OR last_pulsed_at advanced   |
 * | settled            | force, OR (season, fromWeek, toWeek) changed                    |
 *
 * `buildContext` is supplied by the caller so it can be computed at most once
 * per refreshPositionalWar call (memoised there) even though this function
 * and calculateLeaguePositionalWar both potentially need it.
 *
 * Past the backoff, staleness is section 6.3's formula: no rows, a changed
 * fingerprint, a changed model version, a stored window behind the live one,
 * or the TTL elapsed.
 */
export async function positionalWarIsStale(
  supabase: ServiceClient,
  leagueRowId: string,
  season: number,
  buildContext: () => Promise<WarContext | WarSkip | null>,
  /**
   * The gate row, when the caller has already read it. refreshPositionalWar
   * has: it needs the same row for the season anyway, and reading it twice in
   * one call was a round trip spent to learn something already in hand. Left
   * optional so this stays callable on its own, which is how the tests use it.
   */
  prefetchedRow?: BackoffRow | null,
): Promise<boolean> {
  const backoffRow =
    prefetchedRow !== undefined ? prefetchedRow : await loadWarGateRow(supabase, leagueRowId);

  if (backoffRow) {
    const status = backoffRow.positional_war_status;
    if ((status === "error" || status === "skipped") && withinRetryBackoff(backoffRow)) {
      if (lastPulsedAtAdvanced(backoffRow)) {
        // bypass: fall through to a real attempt below.
      } else {
        const context = await buildContext();
        if (context === null) return false;
        const currentFingerprint = isSkip(context) ? null : context.fingerprint;
        if (currentFingerprint === null) return false; // still skippable; nothing to compare
        const storedFingerprint = await readStoredFingerprint(supabase, leagueRowId, season);
        if (storedFingerprint === null || storedFingerprint === currentFingerprint) return false;
        // fingerprint changed: fall through to a real attempt below.
      }
    } else if (status === "settled" && withinRetryBackoff(backoffRow)) {
      const stored = parseSettledTriple(backoffRow.positional_war_detail);
      const context = await buildContext();
      if (context === null) return false;
      if (
        stored &&
        stored.season === context.season &&
        stored.fromWeek === context.fromWeek &&
        stored.toWeek === context.toWeek
      ) {
        return false;
      }
      // triple changed (or was unparseable): fall through to a real attempt.
    }
    // null / 'pending' / 'ok', or a backed-off status past its window: no
    // early return here, continue to the staleness formula below.
  }

  const { data, error } = await supabase
    .from("league_positional_war_cache")
    .select("fingerprint, model_version, through_week, generated_at")
    .eq("league_id", leagueRowId)
    .eq("season", season)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.generated_at) return true;

  const context = await buildContext();
  if (context === null || isSkip(context)) return true;
  if (data.fingerprint !== context.fingerprint) return true;
  if (data.model_version !== context.fingerprintInput.modelVersion) return true;
  if (Number(data.through_week) < context.fromWeek - 1) return true;
  return Date.now() - new Date(data.generated_at).getTime() >= POSITIONAL_WAR_TTL_MS;
}

async function stampAttempted(
  supabase: ServiceClient,
  leagueRowId: string,
  attemptedAt: string,
): Promise<void> {
  const { error } = await supabase
    .from("leagues")
    .update({ positional_war_attempted_at: attemptedAt })
    .eq("id", leagueRowId);
  if (error) {
    console.warn(
      `[positional-war] could not stamp attempted_at for league ${leagueRowId}: ${error.message}`,
    );
  }
}

/**
 * Persist the verdict. Called after calculateLeaguePositionalWar returns (or,
 * from the catch block below, after it throws), so this always runs after
 * whatever cache rows it wrote or cleared. positional_war_succeeded_at is
 * stamped only when result.ok is true.
 */
async function writeVerdict(
  supabase: ServiceClient,
  leagueRowId: string,
  result: PositionalWarResult,
  durationMs: number,
): Promise<void> {
  const { status, detail } = classifyPositionalWarResult(result);
  let finalDetail = detail;
  if (status === "settled" && result.ok) {
    finalDetail = encodeSettledDetail(detail, result.season, result.fromWeek, result.toWeek);
  } else if (status === "ok" && result.ok && !result.collision) {
    finalDetail = `${detail}, ${durationMs}ms`;
  }
  finalDetail = truncateDetail(finalDetail);

  const update: Database["public"]["Tables"]["leagues"]["Update"] = {
    positional_war_status: status,
    positional_war_detail: finalDetail,
  };
  if (result.ok) {
    update.positional_war_succeeded_at = new Date().toISOString();
  }

  const { error } = await supabase.from("leagues").update(update).eq("id", leagueRowId);
  if (error) {
    console.warn(
      `[positional-war] could not write verdict for league ${leagueRowId}: ${error.message}`,
    );
  }
}

/**
 * Stamp the attempt, run the calculation, write the verdict, log the line.
 *
 * Extracted so the page path and `npm run calculate:positional-war` share ONE
 * copy of the write ordering. The script used to call
 * `calculateLeaguePositionalWar` directly, which wrote cache rows and no
 * verdict, so a manually recomputed league kept a null
 * `positional_war_succeeded_at` while its `last_pulsed_at` stayed recent. That
 * combination is exactly the signature the admin league-health view reads as a
 * systemic break, so a successful manual recompute would have reported itself
 * as a failure.
 *
 * `attemptedAt` is stamped BEFORE the expensive work, so a crash mid-run still
 * leaves an honest attempt and the retry window applies rather than hot
 * looping. The verdict and `positional_war_succeeded_at` are written AFTER the
 * cache rows land.
 */
export async function runWithVerdict(
  supabase: ServiceClient,
  leagueRowId: string,
  options: { force?: boolean },
  attemptedAt: string,
  /**
   * The already-built context, when the caller has one. The gate that decided
   * this league is stale built the whole thing (league row, settings, week
   * window, team count, projections snapshot) and then threw it away, so the
   * compute immediately rebuilt it: five round trips spent twice per cold run.
   */
  buildContext?: () => Promise<WarContext | WarSkip | null>,
): Promise<PositionalWarResult> {
  const startedAt = Date.now();
  await stampAttempted(supabase, leagueRowId, attemptedAt);

  const result = await calculateLeaguePositionalWar(supabase, leagueRowId, options, buildContext);
  const durationMs = Date.now() - startedAt;
  await writeVerdict(supabase, leagueRowId, result, durationMs);

  if (!result.ok) {
    console.warn(`[positional-war] calc failed for league ${leagueRowId}: ${result.error}`);
  } else if (result.skipped) {
    console.log(`[positional-war] skipped for league ${leagueRowId}: ${result.skipped}`);
  } else {
    const fpPrefix = result.fingerprint ? ` fp=${result.fingerprint.slice(0, 8)}` : "";
    console.log(
      `[positional-war] league ${leagueRowId} ok: ${result.positions} positions, shared=${result.shared}, ${durationMs}ms${fpPrefix}`,
    );
  }
  return result;
}

/**
 * Recompute Positional WAR for a league if it is stale, swallowing every
 * failure. This is what pulseLeagueDerived calls, as an independent fourth
 * stage alongside transactions, rankings, and Power Pulse.
 *
 * positional_war_attempted_at is stamped before calculateLeaguePositionalWar
 * runs, so a crash mid-run still leaves an honest attempt and the retry
 * window still applies rather than hot-looping.
 * positional_war_succeeded_at and the status/detail are written after the
 * cache rows land.
 */
export async function refreshPositionalWar(
  supabase: ServiceClient,
  leagueRowId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  let attemptedAt: string | null = null;

  // ONE memo for the whole call, and it caches the PROMISE rather than the
  // resolved value. Two things now ask for the context concurrently (the gate
  // below and, past it, the compute), and a memo that only writes its slot
  // after awaiting would let both callers start their own build and pay for
  // the reads twice.
  let contextPromise: Promise<WarContext | WarSkip | null> | undefined;
  const buildContext = (): Promise<WarContext | WarSkip | null> => {
    contextPromise ??= buildWarContext(supabase, leagueRowId);
    return contextPromise;
  };

  try {
    if (!options.force) {
      // The gate row and the context read different things and neither needs
      // the other, so they run together. The context is not speculative work:
      // every branch of the staleness check below consults it, and if the
      // league does turn out to be stale the compute reuses this exact one.
      const [gateRow] = await Promise.all([loadWarGateRow(supabase, leagueRowId), buildContext()]);
      if (!gateRow) return;
      const season = Number(gateRow.season ?? 0);

      const stale = await positionalWarIsStale(
        supabase,
        leagueRowId,
        season,
        buildContext,
        gateRow,
      );
      if (!stale) return;
    }

    attemptedAt = new Date().toISOString();
    await runWithVerdict(supabase, leagueRowId, options, attemptedAt, buildContext);
  } catch (err) {
    console.warn(`[positional-war] calc threw for league ${leagueRowId}:`, (err as Error).message);
    // Record why it did not complete rather than leaving the previous verdict
    // looking current. This runs whether or not the run got as far as stamping
    // attempted_at: a throw inside the gate itself (loadProjectionsSnapshot is
    // the one read in there that throws rather than returning null) would
    // otherwise leave no verdict and no backoff, so every subsequent view of
    // that league would rerun the same failing read.
    if (!attemptedAt) {
      attemptedAt = new Date().toISOString();
      await stampAttempted(supabase, leagueRowId, attemptedAt).catch(() => {});
    }
    await writeVerdict(
      supabase,
      leagueRowId,
      { ok: false, error: (err as Error).message },
      0,
    ).catch(() => {});
  }
}

export async function calculateLeaguePositionalWar(
  supabase: ServiceClient,
  leagueRowId: string,
  _options: { force?: boolean } = {},
  buildContext?: () => Promise<WarContext | WarSkip | null>,
): Promise<PositionalWarResult> {
  const context = buildContext
    ? await buildContext()
    : await buildWarContext(supabase, leagueRowId);
  if (context === null) return { ok: false, error: "league row not found" };

  if (isSkip(context)) {
    const reason = context.skipped;
    // Only the empty-window reason is a statement that will not change until
    // the season or the playoff start date does; that is exactly the one
    // this module classifies 'settled', and a settled verdict clears any
    // rows a previous, now-expired window left behind. Every other skip is
    // transient and leaves the existing cache alone.
    if (SETTLED_REASON_TESTS.some((t) => t(reason))) {
      await clearCache(supabase, leagueRowId, context.season);
    }
    return {
      ok: true,
      positions: 0,
      season: context.season,
      fromWeek: context.fromWeek,
      toWeek: context.toWeek,
      shared: false,
      skipped: reason,
    };
  }

  const scoringBase = closestScoringBase(context.scoringSettings);
  const slots = startingSlots(context.rosterPositions);
  const weeks: number[] = [];
  for (let w = context.fromWeek; w <= context.toWeek; w += 1) weeks.push(w);

  // The model reads no roster: the universe is every projectable player at
  // this league's positions, whether owned or not, so a pre-draft league with
  // zero rostered players still produces a full curve. No draft-pending guard
  // belongs here, unlike Power Pulse.
  const shared = await resolveSharedCurves(supabase, {
    leagueRowId,
    season: context.season,
    fingerprint: context.fingerprint,
    digest: context.digest,
    fromWeek: context.fromWeek,
    toWeek: context.toWeek,
    modelVersion: context.fingerprintInput.modelVersion,
    compute: async (): Promise<PositionCurve[]> => {
      const universe = await loadWarUniverse({
        season: context.season,
        fromWeek: context.fromWeek,
        toWeek: context.toWeek,
        scoringBase,
        source: context.projectionSource,
      });
      const players = buildWarPlayers({
        universe,
        scoringSettings: context.scoringSettings,
        settings: context.pulseSettings,
        weeks,
        currentWeek: context.fromWeek,
      });
      const warResult = computeCurves({
        league: {
          season: context.season,
          slots,
          teamCount: context.teamCount,
          fromWeek: context.fromWeek,
          toWeek: context.toWeek,
        },
        players,
        settings: context.fingerprintInput.warSettings,
      });
      return warResult.curves;
    },
  });

  if (!shared.ok) return { ok: false, error: shared.error };

  if (shared.curves.length === 0) {
    // The universe came back with nothing to plot (no projectable players at
    // any position this league starts). Transient, like the earlier "no
    // weekly projections stored" check this mirrors; does not clear the
    // existing cache.
    return {
      ok: true,
      positions: 0,
      season: context.season,
      fromWeek: context.fromWeek,
      toWeek: context.toWeek,
      shared: false,
      skipped: `no weekly projections stored for ${context.season} from week ${context.fromWeek}`,
    };
  }

  return {
    ok: true,
    positions: shared.curves.length,
    season: context.season,
    fromWeek: context.fromWeek,
    toWeek: context.toWeek,
    shared: shared.shared,
    collision: shared.collision,
    fingerprint: context.fingerprint,
  };
}

/**
 * Drop any cached rows for a league season a settled verdict just decided
 * cannot be scored. Mirrors lib/league-power-pulse.ts clearCache: declining
 * to write a new row is not enough, a curve computed under a previous,
 * now-expired window would keep showing forever otherwise.
 */
async function clearCache(supabase: ServiceClient, leagueRowId: string, season: number): Promise<void> {
  const { error } = await supabase
    .from("league_positional_war_cache")
    .delete()
    .eq("league_id", leagueRowId)
    .eq("season", season);
  if (error) {
    console.warn(
      `[positional-war] could not clear stale cache for league ${leagueRowId}: ${error.message}`,
    );
  }
}
