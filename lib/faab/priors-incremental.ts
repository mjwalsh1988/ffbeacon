/**
 * The incremental FAAB priors build, run by /api/cron/faab-priors.
 *
 * WHAT IT REPLACES. The old rebuild read every waiver row we hold, every
 * season, on every run, and on 2026-11-12 that pushed the nightly derived
 * recalc past its time budget. This build:
 *
 *   1. Prices from THIS season only, with LAST season kept as a per-cell
 *      fallback (lib/faab/priors-math.ts mergeSeasonCells). Nothing older is
 *      read, stored or published.
 *   2. Keeps the sample. Quantiles cannot be updated by adding new rows to an
 *      old answer, so every won auction lives in `faab_prior_auctions`, and a
 *      run re-reads only the leagues whose waiver rows changed since the last
 *      completed pass (league_transactions.updated_at, which a trigger bumps
 *      only on a real content change).
 *   3. Rebuilds the cells of a season from the kept sample once its pass is
 *      complete, and never from a half-finished one.
 *
 * A PASS CAN SPAN RUNS. It walks the changed leagues in id order, 100 at a
 * time, and saves its cursor after every batch. A run that reaches its budget
 * stops cleanly and the next run resumes from the cursor; the cells keep
 * serving the previous complete build until then. A full pass (the first one,
 * a season rollover, or a logic version bump) is the same walk over every
 * league of both seasons.
 *
 * WHY A ROLLOVER IS A FULL PASS. While season S is current, the pass reads
 * seasons S and S-1 only, so a league already filed under S+1 (a dynasty
 * league renewing in January) is never read. The first run that sees S+1 as
 * current therefore cannot trust the watermark and walks everything.
 *
 * THE WATERMARK OVERLAPS. A completed pass sets the watermark to its START
 * time minus 15 minutes, not its end: a row committed during the pass with an
 * earlier updated_at would otherwise fall between two passes. Re-reading a few
 * leagues twice is idempotent; missing one is not.
 *
 * Iterates leagues in BATCHES of transaction rows and does no per-league model
 * work and no Sleeper request, which is what keeps it on a global cron.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchAllRowsByKeyset } from "@/lib/supabase/fetch-all";
import { buildPriorCells, type PriorAuction, type PriorLeagueKind } from "./priors-build";
import { loadLeagueAuctions, type KeptAuction } from "./priors-load";
import { currentPriorSeason } from "./priors-math";

export { currentPriorSeason } from "./priors-math";

type ServiceClient = SupabaseClient<Database>;

/**
 * Bump when the grouping or the auction reduction changes. The next run sees
 * the mismatch and walks every league again instead of trusting the sample.
 */
export const PRIOR_LOGIC_VERSION = 1;

const LEAGUE_BATCH = 100;
const INSERT_CHUNK = 500;
const UPSERT_CHUNK = 500;
export const WATERMARK_OVERLAP_MS = 15 * 60 * 1000;
/** Do not start a cell rebuild with less than this left in the run. */
const CELLS_RESERVE_MS = 60_000;
/**
 * Rebuild both seasons' cells at least this often even when no waiver row
 * changed. An incremental pass only sees waiver-row changes, so a deleted
 * league (its auctions cascade away) or a deleted transaction would otherwise
 * leave cells published that the sample no longer supports.
 */
export const CELLS_REFRESH_MS = 24 * 60 * 60 * 1000;
/**
 * The lease outlives the route's 300-second limit, so a run the platform
 * kills cannot leave a second run free to start beside a still-running one.
 */
const LEASE_SECONDS = 330;

export type PriorBuildState = {
  current_season: number | null;
  logic_version: number;
  watermark: string | null;
  pass_since: string | null;
  pass_full: boolean;
  pass_started_at: string | null;
  pass_cursor: string | null;
  pass_dirty_seasons: number[];
  /** The season and logic version the open pass was started for. */
  pass_season: number | null;
  pass_logic_version: number | null;
  last_pass_completed_at: string | null;
  last_cells_built_at: string | null;
};

export type PassPlan = {
  /** Lower bound for changed rows; null on a full pass. */
  since: string | null;
  full: boolean;
  cursor: string | null;
  startedAt: string;
  dirtySeasons: number[];
  resumed: boolean;
  /** Why a full pass was chosen, for the run log. Null on an incremental. */
  fullReason: string | null;
};

/**
 * Decide what this run does: resume the open pass, start an incremental one
 * from the watermark, or start a full one. Pure.
 */
export function planPass(
  state: PriorBuildState | null,
  currentSeason: number,
  nowIso: string,
  opts: { forceFull?: boolean } = {},
): PassPlan {
  let fullReason: string | null = null;
  if (opts.forceFull) fullReason = "a full rebuild was requested";
  else if (!state) fullReason = "no previous build";
  else if (state.logic_version !== PRIOR_LOGIC_VERSION) fullReason = "the build logic changed";
  else if (state.current_season !== currentSeason) fullReason = `the season turned over to ${currentSeason}`;
  else if (!state.watermark && !state.pass_started_at) fullReason = "no completed pass yet";

  const open = state?.pass_started_at ? state : null;
  // A pass is only worth resuming for the season and logic it was started
  // for. One left open across a rollover or a logic change has already walked
  // past leagues it never read under the new terms, so it is abandoned.
  const openValid =
    !!open &&
    open.pass_season === currentSeason &&
    open.pass_logic_version === PRIOR_LOGIC_VERSION;
  // Whatever that pass already wrote was written under other terms, so the
  // walk that replaces it has to be a full one.
  if (open && !openValid && !fullReason) {
    fullReason = "the open pass was started for another season or build";
  }

  // A valid open FULL pass is always resumed, including when a full rebuild
  // is requested (a second click must not throw away the first one's
  // progress). A valid open incremental pass is resumed unless a full pass
  // is now required.
  if (open && openValid && (open.pass_full || !fullReason)) {
    return {
      since: open.pass_full ? null : open.pass_since,
      full: open.pass_full,
      cursor: open.pass_cursor,
      startedAt: open.pass_started_at as string,
      dirtySeasons: open.pass_dirty_seasons ?? [],
      resumed: true,
      fullReason: open.pass_full ? "resuming a full pass" : null,
    };
  }

  if (fullReason) {
    return {
      since: null,
      full: true,
      cursor: null,
      startedAt: nowIso,
      dirtySeasons: [],
      resumed: false,
      fullReason,
    };
  }

  return {
    since: state?.watermark ?? null,
    full: false,
    cursor: null,
    startedAt: nowIso,
    dirtySeasons: [],
    resumed: false,
    fullReason: null,
  };
}

/** The watermark a pass that started at `startedAt` leaves behind. */
export function watermarkAfter(startedAt: string): string {
  return new Date(new Date(startedAt).getTime() - WATERMARK_OVERLAP_MS).toISOString();
}

function auctionRow(a: KeptAuction, builtAt: string) {
  return {
    league_id: a.leagueId,
    season: a.season,
    week: a.week,
    player_sleeper_id: a.playerSleeperId,
    league_kind: a.leagueKind,
    superflex: a.superflex,
    position: a.position,
    alive_fraction: a.aliveFraction,
    bidder_count: Math.max(1, a.bidderCount),
    winning_pct: a.winningPct,
    runner_up_pct: a.runnerUpPct,
    built_at: builtAt,
  };
}

async function readState(supabase: ServiceClient): Promise<PriorBuildState | null> {
  const { data, error } = await supabase
    .from("faab_prior_build_state")
    .select(
      "current_season, logic_version, watermark, pass_since, pass_full, pass_started_at, pass_cursor, pass_dirty_seasons, pass_season, pass_logic_version, last_pass_completed_at, last_cells_built_at",
    )
    .eq("id", "global")
    .maybeSingle();
  if (error) throw new Error(`faab priors state read failed: ${error.message}`);
  return (data as PriorBuildState | null) ?? null;
}

async function writeState(
  supabase: ServiceClient,
  patch: Partial<PriorBuildState>,
): Promise<void> {
  const { error } = await supabase
    .from("faab_prior_build_state")
    .upsert({ id: "global", ...patch, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new Error(`faab priors state write failed: ${error.message}`);
}

async function maxLeagueSeason(supabase: ServiceClient): Promise<number | null> {
  const { data, error } = await supabase
    .from("leagues")
    .select("season")
    .order("season", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`faab priors season read failed: ${error.message}`);
  return data?.season == null ? null : Number(data.season);
}

async function changedLeagues(
  supabase: ServiceClient,
  since: string | null,
  seasons: number[],
  after: string | null,
): Promise<string[]> {
  const { data, error } = await supabase.rpc("faab_prior_changed_leagues", {
    p_since: since as string,
    p_seasons: seasons,
    p_after: after as string,
    p_limit: LEAGUE_BATCH,
  });
  if (error) throw new Error(`faab priors changed-leagues read failed: ${error.message}`);
  return ((data ?? []) as unknown[]).map((v) => String(v));
}

async function claimLease(supabase: ServiceClient): Promise<string | null> {
  const { data, error } = await supabase.rpc("claim_faab_prior_lease", { p_seconds: LEASE_SECONDS });
  if (error) throw new Error(`faab priors lease claim failed: ${error.message}`);
  return typeof data === "string" ? data : null;
}

async function releaseLease(supabase: ServiceClient, token: string): Promise<void> {
  const { error } = await supabase.rpc("release_faab_prior_lease", { p_token: token });
  // A release that fails lets the lease lapse on its own; nothing to undo.
  if (error) console.error("[faab-priors] lease release failed:", error.message);
}

/** Replace one batch of leagues' kept auctions. */
async function replaceLeagueAuctions(
  supabase: ServiceClient,
  leagueIds: string[],
  auctions: KeptAuction[],
): Promise<void> {
  const { error: delErr } = await supabase
    .from("faab_prior_auctions")
    .delete()
    .in("league_id", leagueIds);
  if (delErr) throw new Error(`faab priors auction clear failed: ${delErr.message}`);

  const builtAt = new Date().toISOString();
  for (let i = 0; i < auctions.length; i += INSERT_CHUNK) {
    const chunk = auctions.slice(i, i + INSERT_CHUNK).map((a) => auctionRow(a, builtAt));
    const { error } = await supabase.from("faab_prior_auctions").insert(chunk);
    if (error) throw new Error(`faab priors auction insert failed: ${error.message}`);
  }
}

type KeptRow = {
  id: number;
  league_id: string;
  season: number;
  week: number;
  league_kind: PriorLeagueKind;
  superflex: boolean;
  position: string | null;
  alive_fraction: number | null;
  bidder_count: number;
  winning_pct: number;
  runner_up_pct: number | null;
};

/** Every kept auction of one season, as the builder's input. */
export async function loadSeasonSample(
  supabase: ServiceClient,
  season: number,
): Promise<PriorAuction[]> {
  const rows = await fetchAllRowsByKeyset<KeptRow, number>(
    `faab priors sample ${season}`,
    (after, limit) => {
      let q = supabase
        .from("faab_prior_auctions")
        .select(
          "id, league_id, season, week, league_kind, superflex, position, alive_fraction, bidder_count, winning_pct, runner_up_pct",
        )
        .eq("season", season)
        .order("id", { ascending: true })
        .limit(limit);
      if (after !== null) q = q.gt("id", after);
      return q as unknown as PromiseLike<{ data: KeptRow[] | null; error: { message: string } | null }>;
    },
    (row) => row.id,
  );
  return rows.map((r) => ({
    leagueKind: r.league_kind,
    superflex: r.superflex,
    position: r.position,
    week: r.week,
    aliveFraction: r.alive_fraction,
    bidderCount: r.bidder_count,
    winningPct: Number(r.winning_pct),
    runnerUpPct: r.runner_up_pct === null ? null : Number(r.runner_up_pct),
    leagueId: r.league_id,
    season: r.season,
  }));
}

export type SeasonCellsResult = { season: number; cells: number; auctions: number; deleted: number };

/**
 * Rebuild one season's cells from the kept sample. A season with no auctions
 * left has its cells removed rather than kept alive by omission.
 */
export async function rebuildSeasonCells(
  supabase: ServiceClient,
  season: number,
): Promise<SeasonCellsResult> {
  const sample = await loadSeasonSample(supabase, season);
  const rows = buildPriorCells(sample);
  const builtAt = new Date().toISOString();

  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK).map((row) => ({ ...row, season, built_at: builtAt }));
    const { error } = await supabase
      .from("faab_market_priors")
      .upsert(chunk, { onConflict: "season,cell_key" });
    if (error) throw new Error(`Could not write FAAB priors for ${season}: ${error.message}`);
  }

  // Anything in this season not rewritten above is a cell the sample no longer
  // supports. An exact count, because returned rows cap at 1,000.
  const { count, error } = await supabase
    .from("faab_market_priors")
    .delete({ count: "exact" })
    .eq("season", season)
    .lt("built_at", builtAt);
  if (error) throw new Error(`Could not prune stale FAAB priors for ${season}: ${error.message}`);

  return { season, cells: rows.length, auctions: sample.length, deleted: count ?? 0 };
}

/** Drop everything older than last season: the owner's one-year limit. */
async function pruneOldSeasons(supabase: ServiceClient, currentSeason: number) {
  const floor = currentSeason - 1;
  const { count: auctions, error: aErr } = await supabase
    .from("faab_prior_auctions")
    .delete({ count: "exact" })
    .lt("season", floor);
  if (aErr) throw new Error(`faab priors auction prune failed: ${aErr.message}`);
  const { count: cells, error: cErr } = await supabase
    .from("faab_market_priors")
    .delete({ count: "exact" })
    .lt("season", floor);
  if (cErr) throw new Error(`faab priors cell prune failed: ${cErr.message}`);
  return { auctions: auctions ?? 0, cells: cells ?? 0 };
}

export type FaabPriorsRunResult = {
  ok: true;
  /** Set when the run did nothing because another run holds the lease. */
  skipped: string | null;
  currentSeason: number | null;
  seasons: number[];
  pass: {
    full: boolean;
    fullReason: string | null;
    resumed: boolean;
    since: string | null;
    complete: boolean;
    leaguesRead: number;
    auctionsWritten: number;
    batches: number;
  } | null;
  cells: SeasonCellsResult[];
  pruned: { auctions: number; cells: number } | null;
  /** True when the run stopped at its budget and the next run will resume. */
  partial: boolean;
  wroteCells: boolean;
  durationMs: number;
};

/**
 * One run: advance the pass as far as the budget allows, and when it
 * completes, rebuild the cells of the seasons it touched.
 *
 * Holds the lease for the whole run. A run that finds the lease held does
 * nothing and says so, rather than interleaving with the holder.
 */
export async function runFaabPriors(
  supabase: ServiceClient,
  opts: {
    budgetMs: number;
    nowMs?: number;
    forceFull?: boolean;
    /**
     * Walk the pass but leave the published cells alone, with the pass left
     * open at its end so the next run only builds the cells. For filling the
     * kept sample before the reading code is deployed.
     */
    skipCells?: boolean;
  },
): Promise<FaabPriorsRunResult> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const idle = (skipped: string | null, currentSeason: number | null): FaabPriorsRunResult => ({
    ok: true,
    skipped,
    currentSeason,
    seasons: [],
    pass: null,
    cells: [],
    pruned: null,
    partial: false,
    wroteCells: false,
    durationMs: elapsed(),
  });

  const token = await claimLease(supabase);
  if (!token) return idle("another FAAB priors run is in progress", null);
  try {
    return await runUnderLease(supabase, opts, started, idle);
  } finally {
    await releaseLease(supabase, token);
  }
}

async function runUnderLease(
  supabase: ServiceClient,
  opts: { budgetMs: number; nowMs?: number; forceFull?: boolean; skipCells?: boolean },
  started: number,
  idle: (skipped: string | null, currentSeason: number | null) => FaabPriorsRunResult,
): Promise<FaabPriorsRunResult> {
  const nowMs = opts.nowMs ?? started;
  const elapsed = () => Date.now() - started;

  const currentSeason = currentPriorSeason(await maxLeagueSeason(supabase), nowMs);
  if (currentSeason === null) return idle(null, null);
  const seasons = [currentSeason, currentSeason - 1];

  const state = await readState(supabase);
  const plan = planPass(state, currentSeason, new Date(nowMs).toISOString(), {
    forceFull: opts.forceFull,
  });

  // Claim the pass before any work, so a run killed mid-batch resumes.
  await writeState(supabase, {
    pass_since: plan.since,
    pass_full: plan.full,
    pass_started_at: plan.startedAt,
    pass_cursor: plan.cursor,
    pass_dirty_seasons: plan.dirtySeasons,
    pass_season: currentSeason,
    pass_logic_version: PRIOR_LOGIC_VERSION,
  });

  let cursor = plan.cursor;
  const dirty = new Set<number>(plan.dirtySeasons);
  let leaguesRead = 0;
  let auctionsWritten = 0;
  let batches = 0;
  let longestBatchMs = 0;
  let complete = false;

  for (;;) {
    if (elapsed() + Math.max(longestBatchMs * 1.5, 5_000) > opts.budgetMs) break;
    const batchStart = Date.now();
    const ids = await changedLeagues(supabase, plan.since, seasons, cursor);
    if (ids.length === 0) {
      complete = true;
      break;
    }
    const { auctions, leagueSeasons } = await loadLeagueAuctions(supabase, ids, seasons);
    await replaceLeagueAuctions(supabase, ids, auctions);
    // Only the seasons these leagues are filed under can have changed. Every
    // league the RPC returns belongs to one of `seasons`.
    for (const s of leagueSeasons) if (seasons.includes(s)) dirty.add(s);
    cursor = ids[ids.length - 1];
    leaguesRead += ids.length;
    auctionsWritten += auctions.length;
    batches += 1;
    await writeState(supabase, { pass_cursor: cursor, pass_dirty_seasons: Array.from(dirty) });
    longestBatchMs = Math.max(longestBatchMs, Date.now() - batchStart);
    if (ids.length < LEAGUE_BATCH) {
      complete = true;
      break;
    }
  }

  const passSummary = {
    full: plan.full,
    fullReason: plan.fullReason,
    resumed: plan.resumed,
    since: plan.since,
    complete: false,
    leaguesRead,
    auctionsWritten,
    batches,
  };
  const partial = (): FaabPriorsRunResult => ({
    ok: true,
    skipped: null,
    currentSeason,
    seasons,
    pass: passSummary,
    cells: [],
    pruned: null,
    partial: true,
    wroteCells: false,
    durationMs: elapsed(),
  });

  // Out of time, or told to leave the cells alone. The cursor is saved; the
  // next run finishes the walk, or finds nothing after the cursor and goes
  // straight to the cells.
  if (!complete || opts.skipCells || elapsed() + CELLS_RESERVE_MS > opts.budgetMs) return partial();

  // A full pass rewrites the sample for both seasons, and the daily refresh
  // catches what an incremental pass cannot see (a deleted league or row).
  const lastBuilt = state?.last_cells_built_at ? Date.parse(state.last_cells_built_at) : NaN;
  if (plan.full || !Number.isFinite(lastBuilt) || nowMs - lastBuilt > CELLS_REFRESH_MS) {
    for (const s of seasons) dirty.add(s);
  }

  const cells: SeasonCellsResult[] = [];
  for (const season of seasons) {
    if (!dirty.has(season)) continue;
    cells.push(await rebuildSeasonCells(supabase, season));
  }
  const pruned = await pruneOldSeasons(supabase, currentSeason);

  const finishedAt = new Date().toISOString();
  await writeState(supabase, {
    current_season: currentSeason,
    logic_version: PRIOR_LOGIC_VERSION,
    watermark: watermarkAfter(plan.startedAt),
    pass_since: null,
    pass_full: false,
    pass_started_at: null,
    pass_cursor: null,
    pass_dirty_seasons: [],
    pass_season: null,
    pass_logic_version: null,
    last_pass_completed_at: finishedAt,
    ...(cells.length > 0 ? { last_cells_built_at: finishedAt } : {}),
  });

  return {
    ok: true,
    skipped: null,
    currentSeason,
    seasons,
    pass: { ...passSummary, complete: true },
    cells,
    pruned,
    partial: false,
    wroteCells: cells.length > 0 || pruned.cells > 0,
    durationMs: elapsed(),
  };
}

/** When the newest cell was built, or null when the table is empty. */
export async function priorsBuiltAt(supabase: ServiceClient): Promise<Date | null> {
  const { data } = await supabase
    .from("faab_market_priors")
    .select("built_at")
    .order("built_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.built_at) return null;
  const at = new Date(data.built_at);
  return Number.isNaN(at.getTime()) ? null : at;
}
