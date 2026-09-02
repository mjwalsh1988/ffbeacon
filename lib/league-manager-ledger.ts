/**
 * Manager Ledger orchestrator.
 *
 * Mirrors lib/league-power-pulse.ts and lib/league-positional-war.ts in shape:
 * load one league's world, run the model, upsert the cache, write an honest
 * verdict, and never throw to the caller. A failure here is never fatal to a
 * league page; the page renders its own empty state from
 * leagues.manager_ledger_status.
 *
 * ABSOLUTE RULE: RECOMPUTED ONLY ON DEMAND. Through `pulseLeague` (gated by
 * MANAGER_LEDGER_TTL_MS, plus a fingerprint change or a model version change),
 * or manually via `npm run calculate:manager-ledger`. NEVER wired into a
 * nightly cron, for the same scaling reason as league power rankings, Power
 * Pulse and Positional WAR: iterating every stored league does not scale to
 * tens of thousands of them, and a league nobody opens never needs a row.
 *
 * ABSOLUTE RULE: NEVER CACHE A LEDGER COMPUTED WITHOUT SETTLED WEEKS. A league
 * with nothing final produces zero for every figure and 100% efficiency for
 * every manager, which reads as a real answer and is not one. The run writes
 * nothing in that case AND clears any rows already stored for that league
 * season, because a degenerate answer outlives the run that produced it. Same
 * reasoning, and the same `settled` verdict, as `calculateLeaguePowerPulse`.
 *
 * ABSOLUTE RULE: THIS MODEL MAKES NO SLEEPER REQUEST. It reads rows an earlier
 * sync already stored. That is why it is cheap enough to be on the page path
 * at all, and why a throttled fetch cannot poison it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { coalesce } from "@/lib/request-coalesce";
import {
  MANAGER_LEDGER_MODEL_VERSION,
  MANAGER_LEDGER_RETRY_MS,
  MANAGER_LEDGER_TTL_MS,
} from "@/lib/manager-ledger/default-settings";
import { computeLedger, isLedgerSkip } from "@/lib/manager-ledger/engine";
import {
  ledgerFingerprint,
  type LedgerFingerprintInput,
} from "@/lib/manager-ledger/fingerprint";
import { planSlots } from "@/lib/manager-ledger/lineup";
import {
  buildIneligibleIds,
  loadLedgerDraftPicks,
  loadLedgerLeague,
  loadLedgerPlayers,
  loadLedgerTransactions,
  loadRosters,
  loadSettledWeeks,
  type LedgerLeagueRow,
  type LoadedWeek,
} from "@/lib/manager-ledger/load";
import type {
  DraftPickInput,
  TransactionInput,
} from "@/lib/manager-ledger/moves";
import type { LedgerPlayer } from "@/lib/manager-ledger/lineup";
import type { LedgerResult } from "@/lib/manager-ledger/types";

export { MANAGER_LEDGER_TTL_MS, MANAGER_LEDGER_RETRY_MS };

type ServiceClient = SupabaseClient<Database>;

export type ManagerLedgerResult =
  | {
      ok: true;
      season: number;
      teams: number;
      gradedWeeks: number;
      skipped?: string;
      fingerprint?: string;
    }
  | { ok: false; error: string };

/** The verdict persisted to leagues.manager_ledger_status. */
export type ManagerLedgerVerdictStatus = "ok" | "skipped" | "settled" | "error";

const MAX_DETAIL_LENGTH = 500;

function truncateDetail(detail: string): string {
  return detail.length > MAX_DETAIL_LENGTH
    ? detail.slice(0, MAX_DETAIL_LENGTH)
    : detail;
}

/**
 * Which skip reasons are a statement about the season rather than a wait.
 *
 * "No settled weeks yet" is a wait: it clears the first Tuesday after week one.
 * "No startable slots we can grade" is a statement about the league's own
 * roster shape and will not change until a commissioner edits it, so it backs
 * off on the season triple rather than being retried every fifteen minutes.
 */
const SETTLED_REASON_TESTS: Array<(reason: string) => boolean> = [
  (r) => r.startsWith("league has no startable slots"),
];

export function classifyManagerLedgerResult(result: ManagerLedgerResult): {
  status: ManagerLedgerVerdictStatus;
  detail: string;
} {
  if (!result.ok) return { status: "error", detail: result.error };
  if (result.skipped) {
    const reason = result.skipped;
    if (SETTLED_REASON_TESTS.some((test) => test(reason))) {
      return { status: "settled", detail: reason };
    }
    return { status: "skipped", detail: reason };
  }
  return {
    status: "ok",
    detail: `${result.teams} team${result.teams === 1 ? "" : "s"}, ${result.gradedWeeks} week${
      result.gradedWeeks === 1 ? "" : "s"
    }`,
  };
}

/**
 * The machine-readable suffix a 'settled' verdict carries, recording the pair
 * that made it settled. Mirrors the bracketed key=value convention Power Pulse
 * and Positional WAR use, carrying the fields this model actually has.
 */
const SETTLED_PAIR_SUFFIX = / \[settled season=(\d+) weeks=(\d+)\]$/;

function encodeSettledDetail(
  reason: string,
  season: number,
  gradedWeeks: number,
): string {
  return `${reason} [settled season=${season} weeks=${gradedWeeks}]`;
}

function parseSettledPair(
  detail: string | null,
): { season: number; weeks: number } | null {
  if (!detail) return null;
  const m = SETTLED_PAIR_SUFFIX.exec(detail);
  if (!m) return null;
  return { season: Number(m[1]), weeks: Number(m[2]) };
}

type BackoffRow = {
  last_pulsed_at: string | null;
  manager_ledger_status: string | null;
  manager_ledger_detail: string | null;
  manager_ledger_attempted_at: string | null;
};

type LedgerGateRow = BackoffRow & { season: number | null };

async function loadGateRow(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<LedgerGateRow | null> {
  const { data } = await supabase
    .from("leagues")
    .select(
      "season, last_pulsed_at, manager_ledger_status, manager_ledger_detail, manager_ledger_attempted_at",
    )
    .eq("id", leagueRowId)
    .maybeSingle();
  return (data as LedgerGateRow | null) ?? null;
}

function withinRetryBackoff(row: BackoffRow): boolean {
  if (!row.manager_ledger_attempted_at) return false;
  const attemptedAt = new Date(row.manager_ledger_attempted_at).getTime();
  if (Number.isNaN(attemptedAt)) return false;
  return Date.now() - attemptedAt < MANAGER_LEDGER_RETRY_MS;
}

/**
 * A league that resynced since the last attempt is worth retrying on the very
 * next view rather than waiting out the backoff. pulseLeagueCore advances
 * last_pulsed_at on every real resync, and a resync is exactly when a week
 * settles or a trade lands.
 */
function lastPulsedAtAdvanced(row: BackoffRow): boolean {
  if (!row.manager_ledger_attempted_at || !row.last_pulsed_at) return false;
  const attemptedAt = new Date(row.manager_ledger_attempted_at).getTime();
  const lastPulsedAt = new Date(row.last_pulsed_at).getTime();
  if (Number.isNaN(attemptedAt) || Number.isNaN(lastPulsedAt)) return false;
  return lastPulsedAt > attemptedAt;
}

/**
 * The fingerprint, WITHOUT the universe read.
 *
 * THIS IS THE WARM PATH AND IT IS ALL THE WARM PATH DOES. Every view of a
 * league whose ledger is already fresh runs this and nothing else, so its round
 * trips are the entire cost of a cache hit. It used to build the whole compute
 * context (every settled matchup row with its `player_points` jsonb, every
 * transaction with its `metadata`, every draft pick, then every player) purely
 * to produce five counts and a slot list, which is roughly 2.5 seconds of reads
 * to answer "nothing changed".
 *
 * Every field except `slots` is a count or a maximum, so all of them come from
 * `head: true` counts and one thin week column. `slots` is already on the
 * league row. Same key, same invalidation behaviour, a fraction of the cost.
 * Mirrors the split lib/league-positional-war.ts makes for the same reason.
 */
async function buildFingerprintInput(
  supabase: ServiceClient,
  leagueRowId: string,
  league: LedgerLeagueRow,
): Promise<LedgerFingerprintInput> {
  const [weeksRes, rosterRes, txRes, pickRes] = await Promise.all([
    // `week` alone, not the jsonb columns: 216 tiny rows rather than 430 kB.
    supabase
      .from("league_matchups")
      .select("week")
      .eq("league_id", leagueRowId)
      .eq("season", league.season)
      .eq("is_final", true),
    supabase
      .from("rosters")
      .select("id", { count: "exact", head: true })
      .eq("league_id", leagueRowId),
    supabase
      .from("league_transactions")
      .select("id", { count: "exact", head: true })
      .eq("league_id", leagueRowId)
      .eq("season", league.season)
      .eq("status", "complete"),
    supabase
      .from("draft_selections")
      .select("id", { count: "exact", head: true })
      .eq("sleeper_league_id", league.sleeperLeagueId)
      .eq("season", league.season),
  ]);

  const weekNumbers = [...new Set((weeksRes.data ?? []).map((r) => Number(r.week)))];

  return {
    season: league.season,
    gradedWeekCount: weekNumbers.length,
    latestGradedWeek: weekNumbers.length > 0 ? Math.max(...weekNumbers) : 0,
    rosterCount: rosterRes.count ?? 0,
    slots: planSlots(league.rosterPositions).gradableTokens,
    transactionCount: txRes.count ?? 0,
    draftPickCount: pickRes.count ?? 0,
    modelVersion: MANAGER_LEDGER_MODEL_VERSION,
  };
}

/** The cheap half: the league row plus the fingerprint built from counts. */
type LedgerGate = {
  league: LedgerLeagueRow;
  fingerprintInput: LedgerFingerprintInput;
  fingerprint: string;
};

async function buildGate(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<LedgerGate | null> {
  const league = await loadLedgerLeague(supabase, leagueRowId);
  if (!league) return null;
  const fingerprintInput = await buildFingerprintInput(supabase, leagueRowId, league);
  return { league, fingerprintInput, fingerprint: ledgerFingerprint(fingerprintInput) };
}

/** Everything one run needs, read once and shared by the gate and the compute. */
type LedgerContext = {
  league: LedgerLeagueRow;
  rosters: Awaited<ReturnType<typeof loadRosters>>;
  weeks: LoadedWeek[];
  transactions: TransactionInput[];
  picks: DraftPickInput[];
  players: Map<string, LedgerPlayer>;
  fingerprintInput: LedgerFingerprintInput;
  fingerprint: string;
};

/**
 * Read the whole world for one league, once.
 *
 * The reads that do not depend on each other run together. `loadLedgerPlayers`
 * is the one that does: it needs the union of ids the other three mention, so
 * it cannot start until they have all answered.
 */
async function buildContext(
  supabase: ServiceClient,
  leagueRowId: string,
  /** The already-built cheap half, so the league row is read once per run. */
  gate: LedgerGate,
): Promise<LedgerContext | null> {
  const league = gate.league;

  // Rosters come first because the settled-week read needs each roster's IR
  // and taxi lists to know which players could not legally have been started.
  // The other three are independent of it and of each other.
  const rosters = await loadRosters(supabase, leagueRowId);
  const [weeks, transactions, picks] = await Promise.all([
    loadSettledWeeks(supabase, leagueRowId, league.season, buildIneligibleIds(rosters)),
    loadLedgerTransactions(supabase, leagueRowId, league.season),
    loadLedgerDraftPicks(supabase, league.sleeperLeagueId, league.season),
  ]);

  const players = await loadLedgerPlayers(supabase, weeks, transactions, picks);

  // Recomputed from the FULL read rather than reused from the gate's counts.
  // The two agree in every ordinary case; when they do not, a write landed
  // between the gate and this read, and the value stored is then the one
  // describing the data actually graded, so the next view sees a mismatch and
  // recomputes rather than serving a row keyed to inputs it did not use.
  const gradedWeekNumbers = [...new Set(weeks.map((w) => w.week))];
  const fingerprintInput: LedgerFingerprintInput = {
    ...gate.fingerprintInput,
    gradedWeekCount: gradedWeekNumbers.length,
    latestGradedWeek:
      gradedWeekNumbers.length > 0 ? Math.max(...gradedWeekNumbers) : 0,
    rosterCount: rosters.length,
    transactionCount: transactions.length,
    draftPickCount: picks.length,
  };

  return {
    league,
    rosters,
    weeks,
    transactions,
    picks,
    players,
    fingerprintInput,
    fingerprint: ledgerFingerprint(fingerprintInput),
  };
}

async function readStoredFingerprint(
  supabase: ServiceClient,
  leagueRowId: string,
  season: number,
): Promise<string | null> {
  const { data } = await supabase
    .from("league_manager_ledger_cache")
    .select("fingerprint")
    .eq("league_id", leagueRowId)
    .eq("season", season)
    .limit(1)
    .maybeSingle();
  return data?.fingerprint ?? null;
}

/**
 * Is this league's ledger worth recomputing?
 *
 * Bypass table, matching Positional WAR's:
 *
 * | Last status     | Retried immediately when                                    |
 * | --------------- | ----------------------------------------------------------- |
 * | error, skipped  | force, OR the fingerprint changed, OR last_pulsed_at advanced|
 * | settled         | force, OR (season, graded week count) changed               |
 *
 * Past the backoff: no rows, a changed fingerprint, a changed model version,
 * or the TTL elapsed.
 */
export async function managerLedgerIsStale(
  supabase: ServiceClient,
  leagueRowId: string,
  season: number,
  /** The CHEAP half. Never the universe read. See buildFingerprintInput. */
  gate: () => Promise<LedgerGate | null>,
  prefetchedRow?: BackoffRow | null,
): Promise<boolean> {
  const backoffRow =
    prefetchedRow !== undefined
      ? prefetchedRow
      : await loadGateRow(supabase, leagueRowId);

  if (backoffRow) {
    const status = backoffRow.manager_ledger_status;
    if (
      (status === "error" || status === "skipped") &&
      withinRetryBackoff(backoffRow)
    ) {
      if (!lastPulsedAtAdvanced(backoffRow)) {
        const ctx = await gate();
        if (!ctx) return false;
        const stored = await readStoredFingerprint(
          supabase,
          leagueRowId,
          season,
        );
        if (stored === null || stored === ctx.fingerprint) return false;
      }
    } else if (status === "settled" && withinRetryBackoff(backoffRow)) {
      const stored = parseSettledPair(backoffRow.manager_ledger_detail);
      const ctx = await gate();
      if (!ctx) return false;
      if (
        stored &&
        stored.season === ctx.league.season &&
        stored.weeks === ctx.fingerprintInput.gradedWeekCount
      ) {
        return false;
      }
    }
  }

  const { data, error } = await supabase
    .from("league_manager_ledger_cache")
    .select("fingerprint, model_version, generated_at")
    .eq("league_id", leagueRowId)
    .eq("season", season)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.generated_at) return true;

  // Checked BEFORE the fingerprint, because both are answered from this row
  // alone and neither needs a second read. Only the fingerprint comparison
  // below has to reach for anything else.
  if (data.model_version !== MANAGER_LEDGER_MODEL_VERSION) return true;
  if (
    Date.now() - new Date(data.generated_at).getTime() >=
    MANAGER_LEDGER_TTL_MS
  ) {
    return true;
  }

  const ctx = await gate();
  if (!ctx) return true;
  return data.fingerprint !== ctx.fingerprint;
}

async function stampAttempted(
  supabase: ServiceClient,
  leagueRowId: string,
  attemptedAt: string,
): Promise<void> {
  const { error } = await supabase
    .from("leagues")
    .update({ manager_ledger_attempted_at: attemptedAt })
    .eq("id", leagueRowId);
  if (error) {
    console.warn(
      `[manager-ledger] could not stamp attempted_at for league ${leagueRowId}: ${error.message}`,
    );
  }
}

/**
 * Persist the verdict. Always runs after whatever cache rows the calculation
 * wrote or cleared, and manager_ledger_succeeded_at is stamped only on ok.
 */
async function writeVerdict(
  supabase: ServiceClient,
  leagueRowId: string,
  result: ManagerLedgerResult,
  durationMs: number,
): Promise<void> {
  const { status, detail } = classifyManagerLedgerResult(result);
  let finalDetail = detail;
  if (status === "settled" && result.ok) {
    finalDetail = encodeSettledDetail(
      detail,
      result.season,
      result.gradedWeeks,
    );
  } else if (status === "ok") {
    finalDetail = `${detail}, ${durationMs}ms`;
  }

  const update: Database["public"]["Tables"]["leagues"]["Update"] = {
    manager_ledger_status: status,
    manager_ledger_detail: truncateDetail(finalDetail),
  };
  if (result.ok) update.manager_ledger_succeeded_at = new Date().toISOString();

  const { error } = await supabase
    .from("leagues")
    .update(update)
    .eq("id", leagueRowId);
  if (error) {
    console.warn(
      `[manager-ledger] could not write verdict for league ${leagueRowId}: ${error.message}`,
    );
  }
}

/**
 * Stamp the attempt, run the calculation, write the verdict, log the line.
 *
 * Extracted so the page path and `npm run calculate:manager-ledger` share ONE
 * copy of the write ordering. A script that wrote cache rows and no verdict
 * would leave a league looking like a systemic failure to the admin health
 * view, which is the exact trap Positional WAR fell into and documents.
 */
export async function runWithVerdict(
  supabase: ServiceClient,
  leagueRowId: string,
  options: { force?: boolean },
  attemptedAt: string,
  context?: () => Promise<LedgerContext | null>,
): Promise<ManagerLedgerResult> {
  const startedAt = Date.now();
  await stampAttempted(supabase, leagueRowId, attemptedAt);

  const result = await calculateLeagueManagerLedger(
    supabase,
    leagueRowId,
    options,
    context,
  );
  const durationMs = Date.now() - startedAt;
  await writeVerdict(supabase, leagueRowId, result, durationMs);

  if (!result.ok) {
    console.warn(
      `[manager-ledger] calc failed for league ${leagueRowId}: ${result.error}`,
    );
  } else if (result.skipped) {
    console.log(
      `[manager-ledger] skipped for league ${leagueRowId}: ${result.skipped}`,
    );
  } else {
    const fp = result.fingerprint
      ? ` fp=${result.fingerprint.slice(0, 8)}`
      : "";
    console.log(
      `[manager-ledger] league ${leagueRowId} ok: ${result.teams} teams, ${result.gradedWeeks} weeks, ${durationMs}ms${fp}`,
    );
  }
  return result;
}

/**
 * Recompute the ledger if it is stale, swallowing every failure.
 *
 * This is what `pulseLeagueDerived` calls. It never throws, so a league page
 * renders with or without it.
 */
export async function refreshManagerLedger(
  supabase: ServiceClient,
  leagueRowId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  // COALESCED PER LEAGUE, like every other stage of the derived sync. Two
  // concurrent requests for the same league (the Decisions page and a warm-up
  // that lands mid-render, say) would otherwise each run the full season read,
  // race each other's upsert on the same rows, and both write `attempted_at`.
  // The key deliberately carries `force`, so an admin's forced recompute is
  // never satisfied by an in-flight cached one.
  return coalesce(`manager-ledger:${leagueRowId}:${options.force ?? false}`, () =>
    runRefresh(supabase, leagueRowId, options),
  );
}

async function runRefresh(
  supabase: ServiceClient,
  leagueRowId: string,
  options: { force?: boolean },
): Promise<void> {
  let attemptedAt: string | null = null;

  // TWO memos, and the split is the point. The GATE is five counts and a
  // league row, and it is all a warm view ever pays for. The CONTEXT is the
  // whole season of matchups, transactions, picks and players, and it is built
  // only once something has decided a recompute is actually going to happen.
  // Both cache the PROMISE rather than the resolved value, so two callers
  // cannot each start their own build.
  let gatePromise: Promise<LedgerGate | null> | undefined;
  const gate = (): Promise<LedgerGate | null> => {
    gatePromise ??= buildGate(supabase, leagueRowId);
    return gatePromise;
  };

  let contextPromise: Promise<LedgerContext | null> | undefined;
  const context = (): Promise<LedgerContext | null> => {
    contextPromise ??= (async () => {
      const built = await gate();
      if (!built) return null;
      return buildContext(supabase, leagueRowId, built);
    })();
    return contextPromise;
  };

  try {
    if (!options.force) {
      const gateRow = await loadGateRow(supabase, leagueRowId);
      if (!gateRow) return;
      const season = Number(gateRow.season ?? 0);
      if (
        !(await managerLedgerIsStale(
          supabase,
          leagueRowId,
          season,
          gate,
          gateRow,
        ))
      )
        return;
    }

    attemptedAt = new Date().toISOString();
    await runWithVerdict(supabase, leagueRowId, options, attemptedAt, context);
  } catch (err) {
    console.warn(
      `[manager-ledger] calc threw for league ${leagueRowId}:`,
      (err as Error).message,
    );
    // Record why it did not complete rather than leaving the previous verdict
    // looking current, and back off, so a league whose reads throw does not
    // rerun the same failing query on every view.
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

/** Drop stored rows for one league season. See the degenerate-answer rule. */
async function clearCache(
  supabase: ServiceClient,
  leagueRowId: string,
  season: number,
): Promise<void> {
  const { error } = await supabase
    .from("league_manager_ledger_cache")
    .delete()
    .eq("league_id", leagueRowId)
    .eq("season", season);
  if (error) {
    console.warn(
      `[manager-ledger] could not clear cache for league ${leagueRowId}: ${error.message}`,
    );
  }
}

/**
 * The full context with no caller-supplied gate, for the one path that has
 * none: `calculateLeagueManagerLedger` called directly rather than through
 * `refreshManagerLedger`. Everything on the page path arrives with a gate
 * already built and never reaches this.
 */
async function buildStandaloneContext(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<LedgerContext | null> {
  const gate = await buildGate(supabase, leagueRowId);
  if (!gate) return null;
  return buildContext(supabase, leagueRowId, gate);
}

export async function calculateLeagueManagerLedger(
  supabase: ServiceClient,
  leagueRowId: string,
  _options: { force?: boolean } = {},
  prebuilt?: () => Promise<LedgerContext | null>,
): Promise<ManagerLedgerResult> {
  const ctx = prebuilt ? await prebuilt() : await buildStandaloneContext(supabase, leagueRowId);
  if (!ctx) return { ok: false, error: "league row not found" };

  const computed = computeLedger({
    season: ctx.league.season,
    rosterPositions: ctx.league.rosterPositions,
    rosters: ctx.rosters.map((r) => ({
      sleeperRosterId: r.sleeperRosterId,
      teamName: r.teamName,
      ownerHandle: r.ownerHandle,
    })),
    weeks: ctx.weeks,
    transactions: ctx.transactions,
    draftPicks: ctx.picks,
    players: ctx.players,
    leagueHasFaab: ctx.league.hasFaab,
  });

  if (isLedgerSkip(computed)) {
    // A skipped run must not leave last season's rows, or a stale answer
    // outlives the run that decided there was no answer to give.
    await clearCache(supabase, leagueRowId, ctx.league.season);
    return {
      ok: true,
      season: ctx.league.season,
      teams: 0,
      // THE REAL WEEK COUNT, NOT ZERO. A 'settled' verdict encodes this number
      // into its detail and the backoff then compares it against the live one.
      // Returning a literal 0 here made that comparison fail forever, so a
      // league settled for a reason that will never change (its starting slots
      // cannot be graded) recomputed on every single page view instead of
      // backing off. Positional WAR returns its real window for the same
      // reason; see lib/league-positional-war.ts.
      gradedWeeks: ctx.fingerprintInput.gradedWeekCount,
      skipped: computed.skipped,
    };
  }

  const rows = buildCacheRows(leagueRowId, ctx.fingerprint, computed);
  const { error } = await supabase
    .from("league_manager_ledger_cache")
    .upsert(rows, { onConflict: "league_id,season,sleeper_roster_id" });
  if (error)
    return { ok: false, error: `ledger upsert failed: ${error.message}` };

  // Rosters Sleeper no longer returns would otherwise keep a row forever, and
  // a departed team sitting in a leaderboard is a bug a reader can see.
  // Integers only, filtered HERE rather than trusted from three files away.
  // These come from `rosters.sleeper_roster_id`, an integer column, so nothing
  // user-supplied can reach the interpolated filter below today. The guard
  // makes that a local property of this line rather than a fact about the call
  // chain, which is the same reasoning lib/power-pulse/load.ts gives for
  // filtering ids before building its own PostgREST filter string.
  const kept = computed.teams
    .map((t) => t.sleeperRosterId)
    .filter((id) => Number.isInteger(id));
  if (kept.length > 0) {
    const { error: pruneError } = await supabase
      .from("league_manager_ledger_cache")
      .delete()
      .eq("league_id", leagueRowId)
      .eq("season", computed.season)
      .not("sleeper_roster_id", "in", `(${kept.join(",")})`);
    if (pruneError) {
      console.warn(
        `[manager-ledger] could not prune stale rows for league ${leagueRowId}: ${pruneError.message}`,
      );
    }
  }

  return {
    ok: true,
    season: computed.season,
    teams: computed.teams.length,
    gradedWeeks: computed.gradedWeeks.length,
    fingerprint: ctx.fingerprint,
  };
}

/** Round to a fixed precision so stored numbers do not carry float noise. */
function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function roundOrNull(value: number | null, places = 4): number | null {
  return value === null ? null : round(value, places);
}

function buildCacheRows(
  leagueRowId: string,
  fingerprint: string,
  result: LedgerResult,
): Database["public"]["Tables"]["league_manager_ledger_cache"]["Insert"][] {
  const generatedAt = new Date().toISOString();
  return result.teams.map((team) => ({
    league_id: leagueRowId,
    season: result.season,
    sleeper_roster_id: team.sleeperRosterId,

    weeks_graded: team.lineup.weeksGraded,
    set_points: round(team.lineup.setPoints),
    optimal_points: round(team.lineup.optimalPoints),
    points_left: round(team.lineup.pointsLeft),
    lineup_efficiency: roundOrNull(team.lineup.efficiency),

    actual_wins: team.lineup.actualRecord.wins,
    actual_losses: team.lineup.actualRecord.losses,
    actual_ties: team.lineup.actualRecord.ties,
    best_lineup_wins: team.lineup.bestLineupRecord.wins,
    best_lineup_losses: team.lineup.bestLineupRecord.losses,
    best_lineup_ties: team.lineup.bestLineupRecord.ties,

    wins_left_on_bench: team.lineup.winsLeftOnBench,
    weeks_with_ungraded_slots: team.lineup.weeksWithUngradedSlots,

    waiver_moves: team.waivers.moves,
    waiver_hits: team.waivers.hits,
    waiver_faab_spent: roundOrNull(team.waivers.faabSpent, 2),
    waiver_points_on_roster: round(team.waivers.pointsOnRoster),
    waiver_points_started: round(team.waivers.pointsStarted),
    waiver_points_per_dollar: roundOrNull(team.waivers.pointsPerDollar, 3),

    trade_count: team.trades.trades,
    trade_points_in: round(team.trades.pointsIn),
    trade_points_out: round(team.trades.pointsOut),
    trade_net: round(team.trades.net),
    trade_any_picks: team.trades.anyPicks,

    draft_picks: team.draft.picks,
    draft_points: round(team.draft.points),
    draft_above_baseline: round(team.draft.aboveBaseline),

    efficiency_rank: team.efficiencyRank,
    waiver_rank: team.waiverRank,
    trade_rank: team.tradeRank,
    draft_rank: team.draftRank,
    scoring_rank: team.scoringRank,

    weeks: team.lineup.weeks as unknown as Json,
    moves: {
      waivers: team.waivers.best,
      trades: team.trades.moves,
      draftBest: team.draft.best,
      draftWorst: team.draft.worst,
    } as unknown as Json,
    graded_weeks: result.gradedWeeks as unknown as Json,
    gradable_slots: result.gradableSlots as unknown as Json,
    ungradable_slots: result.ungradableSlots as unknown as Json,

    fingerprint,
    model_version: MANAGER_LEDGER_MODEL_VERSION,
    generated_at: generatedAt,
  }));
}
