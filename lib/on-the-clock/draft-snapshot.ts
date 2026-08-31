/**
 * Completed-draft snapshot finalizer for On The Clock (server-only).
 *
 * getOrCreateDraftSnapshot implements the snapshot-first strategy:
 *   1. A finalized snapshot exists -> return it untouched (no Sleeper, no
 *      value/ADP reads). Completed drafts NEVER re-derive from moving data.
 *   2. No snapshot and the draft is complete -> build one ONCE: resolve the
 *      FF Beacon board and Sleeper ADP as they stood at the draft's completion
 *      time (lib/on-the-clock/history-lookup.ts fallback chain), freeze the
 *      shaped cache / trades / per-pick results / awards, persist, return.
 *   3. The draft is not complete -> report not-complete (live mode applies).
 *
 * The frozen board + cache + trades are the SAME shapes the live cockpit
 * consumes, so snapshot mode renders through the exact same components; the
 * calculations are deterministic functions of frozen inputs. Awards are ALSO
 * persisted (computed here at finalize) so the awards shown for a completed
 * draft can never drift even if the award engine's tuning changes later.
 *
 * Recalculation is intentional, never automatic: delete the snapshot row (the
 * pick rows cascade) and reopen the draft to rebuild it.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { getAllSleeperTransactions, getSleeperLeague } from "@/lib/sleeper";
import {
  adpFormatKeyCandidates,
  attachAdpToPlayers,
  classifyPickValue,
  pickValueDelta,
} from "./adp";
import { computeDraftAwards, type Award } from "./awards";
import { computeDraftGrades, type DraftGrade } from "./draft-grade";
import { buildMarketCurve, computePickSurplus } from "./surplus";
import { getDraftPulseWithVintage } from "./pulse-service";
import { tradeMarginsFor } from "./trade-margins";
import type { DraftPulseResult } from "./draft-pulse";
import { readDraftCache } from "./cache";
import {
  deriveDraftState,
  draftShapeFromMeta,
  excludeDrafted,
  inferPlayerPool,
} from "./draft-derive";
import { detectLeagueFormat, ffbeaconFormatCandidates } from "./format-detect";
import {
  deriveSnapshotConfidence,
  EMPTY_ADP,
  pickValueFormatWithData,
  resolveAdpSnapshot,
  resolveHistoricalBoard,
  type AdpSnapshot,
  type HistoricalBoard,
} from "./history-lookup";
import {
  normalizeTradedPicks,
  resolveCurrentDraftPicks,
} from "./pick-ownership";
import { buildTeamRollups } from "./rosters";
import { performDraftSync } from "./sleeper-sync";
import type { DraftSnapshotPayload, FrozenBoard } from "./snapshot-types";
import type { HistoryTransaction, TradeHistoryContext } from "./trade-history";
import { shapeLeagueTrades } from "./transactions-shape";
import type { OnTheClockSettings, ShapedDraftCache } from "./types";
import { DEFAULT_ON_THE_CLOCK_SETTINGS } from "./default-settings";

type Client = SupabaseClient<Database>;
type SnapshotRow =
  Database["public"]["Tables"]["on_the_clock_draft_snapshots"]["Row"];
type SnapshotInsert =
  Database["public"]["Tables"]["on_the_clock_draft_snapshots"]["Insert"];
type PickSnapshotInsert =
  Database["public"]["Tables"]["on_the_clock_pick_snapshots"]["Insert"];

/** Same cap as the live transactions route: a pathological league stays bounded. */
const MAX_SNAPSHOT_TRADES = 250;

/**
 * The payload contract version written into new snapshots.
 *   1  the original six awards, no grades, no Draft Pulse
 *   2  the full award set plus grades plus Draft Pulse
 * A version 1 row renders without the grades tab and with its own six awards,
 * rather than showing seven cards that can never be filled in.
 */
export const SNAPSHOT_VERSION = 2;

export type DraftSnapshotOutcome =
  | { status: "ready"; snapshot: DraftSnapshotPayload; created: boolean }
  | { status: "not-complete" }
  | { status: "no-board" }
  | { status: "error"; message: string };

function rowToPayload(row: SnapshotRow): DraftSnapshotPayload {
  // The threshold the draft was graded with lives in the row metadata; fall back
  // to the code default only for rows written before it was recorded.
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const storedThreshold = Number(meta.threshold_picks);
  const thresholdPicks =
    Number.isFinite(storedThreshold) && storedThreshold > 0
      ? storedThreshold
      : DEFAULT_ON_THE_CLOCK_SETTINGS.valueIndicators.thresholdPicks;
  return {
    thresholdPicks,
    sleeperDraftId: row.sleeper_draft_id,
    sleeperLeagueId: row.sleeper_league_id,
    season: row.season,
    leagueName: row.league_name,
    playerPool: row.player_pool === "rookies" ? "rookies" : "everyone",
    formatSlug: row.format_slug,
    formatLabel: row.format_label,
    draftCompletedAt: row.draft_completed_at,
    finalizedAt: row.finalized_at,
    valueSnapshotSource:
      (row.value_snapshot_source as DraftSnapshotPayload["valueSnapshotSource"]) ??
      null,
    adpSnapshotSource:
      (row.adp_snapshot_source as DraftSnapshotPayload["adpSnapshotSource"]) ??
      null,
    valueSnapshotDate: row.value_snapshot_date,
    adpSnapshotDate: row.adp_snapshot_date,
    adpFormatKey: row.adp_format_key,
    confidence:
      (row.snapshot_confidence as DraftSnapshotPayload["confidence"]) ?? "low",
    board: row.board as unknown as FrozenBoard,
    cache: row.draft as unknown as ShapedDraftCache,
    transactions: (row.transactions as unknown as HistoryTransaction[]) ?? [],
    awards: (row.awards as unknown as Award[]) ?? [],
    grades: (row.grades as unknown as DraftGrade[]) ?? [],
    pulse:
      row.pulse && Object.keys(row.pulse).length > 0
        ? (row.pulse as unknown as DraftPulseResult)
        : null,
    snapshotVersion: Number(row.snapshot_version) || 1,
  };
}

function msFrom(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Return the finalized snapshot for a completed draft, creating it on first
 * open. `formatSlug`/`formatLabel` are hints from the client's LeagueCard; when
 * absent the league is fetched from Sleeper once and the format re-detected.
 */
export async function getOrCreateDraftSnapshot(
  admin: Client,
  params: {
    draftId: string;
    formatSlug?: string | null;
    formatLabel?: string | null;
    leagueName?: string | null;
    settings: OnTheClockSettings;
  },
): Promise<DraftSnapshotOutcome> {
  const { draftId, settings } = params;

  // 1. Snapshot-first: an existing finalized snapshot is always served as-is.
  const { data: existing, error: readErr } = await admin
    .from("on_the_clock_draft_snapshots")
    .select("*")
    .eq("sleeper_draft_id", draftId)
    .maybeSingle();
  if (readErr)
    return {
      status: "error",
      message: `snapshot read failed: ${readErr.message}`,
    };
  if (existing)
    return {
      status: "ready",
      snapshot: rowToPayload(existing),
      created: false,
    };

  // 2. Ensure the draft cache exists and reflects a completed draft. The sync
  //    goes through the shared durable lock, so concurrent opens collapse.
  let cache = await readDraftCache(admin, draftId);
  if (!cache || cache.draft.draftStatus !== "complete") {
    await performDraftSync(admin, {
      draftId,
      leagueId: cache?.draft.sleeperLeagueId,
      season: cache?.draft.season,
      cooldownSeconds: settings.sync.cooldownSeconds,
      lockSeconds: settings.sync.lockSeconds,
    });
    cache = await readDraftCache(admin, draftId);
  }
  if (!cache)
    return {
      status: "error",
      message: "Could not load this draft from Sleeper.",
    };

  const derived = deriveDraftState(cache, null);
  if (!derived.complete) return { status: "not-complete" };

  const leagueId = cache.draft.sleeperLeagueId;
  const season = cache.draft.season;
  const rounds = Number(cache.draft.settings.rounds ?? 0);
  const teams = Number(cache.draft.settings.teams ?? 0);

  // 3. Completion + start times from the raw Sleeper draft object we cached.
  const { data: cacheRow } = await admin
    .from("on_the_clock_draft_cache")
    .select("metadata, updated_at")
    .eq("sleeper_draft_id", draftId)
    .maybeSingle();
  const rawDraft = (cacheRow?.metadata ?? {}) as Record<string, unknown>;
  const completedAtMs = msFrom(rawDraft.last_picked);
  const draftStartAtMs = msFrom(rawDraft.start_time);
  const completedAtIso =
    completedAtMs !== null ? new Date(completedAtMs).toISOString() : null;

  // 4. Format: caller hint first, else re-detect from the Sleeper league.
  let formatSlug = params.formatSlug ?? null;
  let formatLabel = params.formatLabel ?? null;
  let leagueName = params.leagueName ?? null;
  if (!formatSlug) {
    const league = await getSleeperLeague(leagueId);
    if (league) {
      leagueName = leagueName ?? league.name ?? null;
      const candidates = await ffbeaconFormatCandidates(admin);
      const detected = detectLeagueFormat(league, candidates);
      formatSlug = detected?.slug ?? null;
      formatLabel = detected?.label ?? null;
    }
  }
  if (!formatSlug) {
    formatSlug = settings.sourceFormat.defaultFormatFallback;
    formatLabel = formatLabel ?? null;
  }

  const pool = inferPlayerPool({ formatSlug, rounds });

  // 5. Historical FF Beacon board + Sleeper ADP.
  //    resolveHistoricalBoard reconstructs the board as of the draft's completion
  //    (falling forward to the earliest available batch when a draft predates our
  //    value history). Two failure modes must NEVER leave a completed draft
  //    permanently unlockable (showing the "reload later" warning on every open):
  //      - a THROWN error, e.g. a DB statement timeout on a slow reconstruction, and
  //      - the league's format having NO FF Beacon values at all.
  //    In both cases we fall back to CURRENT values and still lock (low confidence):
  //    first the league's own format at current date, then the closest format that
  //    has data. The league's real format is always used for ADP, so the pick
  //    value/reach indicators stay accurate to its scoring.
  let board: HistoricalBoard | null = null;
  let valueFormatSlug = formatSlug;
  let valueFormatSubstituted = false;
  // True when values reflect "now" rather than the draft date (a thrown/empty
  // historical lookup, or a cross-format substitution). Drives the ADP target so
  // both inputs describe the same moment.
  let usingCurrentValues = false;
  // The league's own display label. On a substitution board.formatLabel would be the
  // SUBSTITUTE format's name, so we resolve the real label to avoid mislabeling.
  let realFormatLabel: string | null = formatLabel;

  // Resolve a board without ever throwing: a DB error (timeout) becomes null so the
  // fallback chain below can still lock the draft with current data.
  const tryBoard = async (
    slug: string,
    targetIso: string | null,
  ): Promise<HistoricalBoard | null> => {
    try {
      return await resolveHistoricalBoard(admin, {
        formatSlug: slug,
        targetIso,
        draftStartAtMs,
        rookieSeason: season,
      });
    } catch (err) {
      console.error(
        `[on-the-clock/draft-snapshot] value lookup failed (format=${slug}, target=${targetIso ?? "current"}); falling back`,
        err,
      );
      return null;
    }
  };

  // (a) Historical board at completion time (highest fidelity for recent drafts).
  board = await tryBoard(formatSlug, completedAtIso);

  // (b) Fall back to CURRENT values for the league's own format. Covers a historical
  //     reconstruction that errored/timed out even though the format has data.
  if (!board) {
    board = await tryBoard(formatSlug, null);
    if (board) usingCurrentValues = true;
  }

  // (c) Last resort: the league's format has no values at all; grade against the
  //     closest supported format that does, using current values. Guarded so a hard
  //     DB outage here degrades to no-board (a transient "reload later") rather than
  //     throwing; nothing is locked.
  if (!board) {
    try {
      const fallbackSlug = await pickValueFormatWithData(admin, formatSlug);
      if (fallbackSlug) {
        board = await tryBoard(fallbackSlug, null);
        if (board) {
          valueFormatSlug = fallbackSlug;
          valueFormatSubstituted = true;
          usingCurrentValues = true;
          if (!realFormatLabel) {
            const { data: realFormat } = await admin
              .from("format_configs")
              .select("display_name")
              .eq("slug", formatSlug)
              .maybeSingle();
            realFormatLabel = realFormat?.display_name ?? null;
          }
        }
      }
    } catch (err) {
      console.error(
        "[on-the-clock/draft-snapshot] value-format fallback failed",
        err,
      );
    }
  }
  if (!board) return { status: "no-board" };

  // ADP always uses the league's OWN format (Sleeper publishes Half/Standard/etc.
  // markets even where we lack values). Use current ADP whenever the values are
  // current, so both frozen inputs describe the same moment. Never fail the lock on
  // an ADP error: an empty ADP map just means no pick value/reach indicators.
  let adp: AdpSnapshot;
  try {
    adp = await resolveAdpSnapshot(admin, {
      keyCandidates: adpFormatKeyCandidates(formatSlug, pool),
      targetDate: usingCurrentValues
        ? null
        : completedAtIso
          ? completedAtIso.slice(0, 10)
          : null,
      completedAtMs,
      draftStartAtMs,
    });
  } catch (err) {
    console.error(
      "[on-the-clock/draft-snapshot] ADP lookup failed; locking without ADP",
      err,
    );
    adp = { ...EMPTY_ADP };
  }

  const players = attachAdpToPlayers(board.players, adp.adpBySleeperId);
  const frozenBoard: FrozenBoard = {
    players,
    pickValues: board.pickValues,
    // The snapshot's identity stays the league's real format even when values were
    // graded against a substitute (valueFormatSlug); the substitution is recorded
    // in metadata for provenance.
    formatSlug,
    formatLabel: realFormatLabel ?? board.formatLabel,
    season,
    adpFormatKey: adp.adpKey,
    adpSnapshotDate: adp.snapshotDate,
  };

  // 6. League trades, frozen through the same shaping as the live route. Only
  //    trades completed BEFORE the draft finished count: the draft awards must
  //    reflect the draft window, not whenever the draft happened to be opened
  //    (an in-season trade months later must never flip Most Active Trader).
  //    Trades with no timestamp are kept (dropping them could lose real draft
  //    trades); the cutoff is recorded in metadata for auditability.
  const allTrades = shapeLeagueTrades(
    await getAllSleeperTransactions(leagueId),
  );
  const trades = (
    completedAtMs !== null
      ? allTrades.filter(
          (t) => t.createdAt === null || t.createdAt <= completedAtMs,
        )
      : allTrades
  ).slice(0, MAX_SNAPSHOT_TRADES);

  // 7. Per-pick value results against the frozen board + ADP.
  const valueByPlayerId = new Map<string, { value: number; rank: number }>();
  const valueBySleeperId = new Map<string, { value: number; rank: number }>();
  for (const p of players) {
    valueByPlayerId.set(p.playerId, { value: p.value, rank: p.overallRank });
    if (p.sleeperId)
      valueBySleeperId.set(p.sleeperId, {
        value: p.value,
        rank: p.overallRank,
      });
  }
  const threshold = settings.valueIndicators.thresholdPicks;
  const pickRows: PickSnapshotInsert[] = cache.picks.map((pk) => {
    const boardEntry =
      (pk.playerId ? valueByPlayerId.get(pk.playerId) : undefined) ??
      (pk.sleeperPlayerId
        ? valueBySleeperId.get(pk.sleeperPlayerId)
        : undefined) ??
      null;
    const pickAdp = pk.sleeperPlayerId
      ? (adp.adpBySleeperId[pk.sleeperPlayerId] ?? null)
      : null;
    const delta = pickValueDelta(pk.pickNo, pickAdp);
    const verdict = pk.isKeeper ? null : classifyPickValue(delta, threshold);
    return {
      sleeper_draft_id: draftId,
      pick_no: pk.pickNo,
      round: pk.round,
      draft_slot: pk.draftSlot,
      roster_id: pk.rosterId,
      picked_by: pk.pickedBy,
      sleeper_player_id: pk.sleeperPlayerId,
      player_id: pk.playerId,
      player_name: `${pk.firstName ?? ""} ${pk.lastName ?? ""}`.trim() || null,
      position: pk.position,
      team: pk.team,
      is_keeper: pk.isKeeper,
      beacon_value: boardEntry?.value ?? null,
      beacon_rank: boardEntry?.rank ?? null,
      sleeper_adp: pickAdp,
      pick_value_delta: delta,
      value_verdict: verdict,
      metadata: { threshold_picks: threshold } as unknown as Json,
    };
  });

  // 8. Awards, computed once from the frozen inputs and persisted.
  const teamNameByRosterId: Record<number, string> = {};
  const ownerNameByRosterId: Record<number, string> = {};
  const customTeamNameByRosterId: Record<number, string | null> = {};
  const avatarByRosterId: Record<number, string | null> = {};
  for (const r of cache.rosters) {
    const user = r.ownerId
      ? cache.users.find((u) => u.userId === r.ownerId)
      : undefined;
    teamNameByRosterId[r.rosterId] = user?.displayName ?? `Team ${r.rosterId}`;
    ownerNameByRosterId[r.rosterId] =
      user?.displayName || user?.username || `Team ${r.rosterId}`;
    customTeamNameByRosterId[r.rosterId] = user?.teamName ?? null;
    avatarByRosterId[r.rosterId] = user?.avatar ?? null;
  }

  const tradedPicks = normalizeTradedPicks(cache.tradedPicks);
  const seasonNum = Number(season) || 0;
  const currentPicks = resolveCurrentDraftPicks({
    teams,
    rounds,
    shape: draftShapeFromMeta(cache.draft),
    slotToRosterId: cache.draft.slotToRosterId,
    madePicks: cache.picks,
    tradedPicks,
    currentSeason: seasonNum,
  });

  const rollups = buildTeamRollups({
    rosters: cache.rosters,
    picks: cache.picks,
    tradedPicks,
    valueBoard: players,
    futurePickValues: board.pickValues,
    ownerNameByRosterId,
    teamNameByRosterId: customTeamNameByRosterId,
    myRosterId: null,
    draftSettings: cache.draft.settings,
    draftSeason: seasonNum,
  });

  const tradeContext: TradeHistoryContext = {
    valueBoard: players,
    available: excludeDrafted(players, cache.picks),
    poolBoard: players,
    futurePickValues: board.pickValues,
    currentPicks,
    teamNameByRosterId,
    myRosterId: null,
    teams,
    currentSeason: seasonNum,
    // No `simulated`: this only runs for a COMPLETE draft, where every pick in
    // the current season has been made and the unmade-pick branch is dead.
  };

  // Draft Pulse at completion. Best effort: a projection outage must not stop a
  // draft locking, so a failure freezes an empty pulse and the awards and grades
  // that depend on it stay honestly pending in that snapshot forever. That is
  // the right trade. A snapshot is permanent, and a permanent record saying "we
  // could not project this draft" beats one that quietly graded on less.
  let pulse: DraftPulseResult | null = null;
  let projectionComputedAt: string | null = null;
  try {
    const withVintage = await getDraftPulseWithVintage(admin, draftId, {
      includePreDraftRoster: pool === "rookies",
    });
    pulse = withVintage.pulse;
    projectionComputedAt = withVintage.projectionComputedAt;
  } catch (err) {
    console.error("[on-the-clock/draft-snapshot] draft pulse failed", err);
  }
  const pulseTeams = pulse?.teams ?? [];
  const isDynasty = /dynasty/i.test(formatSlug ?? "");

  const awards = computeDraftAwards({
    rollups,
    avatarByRosterId,
    transactions: trades,
    tradeContext,
    picks: cache.picks,
    draftSettings: cache.draft.settings,
    settings,
    adpBySleeperId: adp.adpBySleeperId,
    board: players,
    pulseTeams,
    isDynasty,
  });

  // Grades, from exactly the inputs the awards used. Local names, because the
  // pick-snapshot writer above already holds richer maps under the obvious ones.
  const gradeValueByPlayerId = new Map<string, number>();
  const gradeValueBySleeperId = new Map<string, number>();
  for (const p of players) {
    gradeValueByPlayerId.set(p.playerId, p.value);
    if (p.sleeperId) gradeValueBySleeperId.set(p.sleeperId, p.value);
  }
  const pickSurpluses = computePickSurplus({
    picks: cache.picks,
    valueByPlayerId: gradeValueByPlayerId,
    valueBySleeperId: gradeValueBySleeperId,
    curve: buildMarketCurve(players),
  });
  const grades: DraftGrade[] = settings.grades.enabled
    ? computeDraftGrades({
        rollups,
        pulseTeams,
        pickSurpluses,
        tradeMarginByRoster: tradeMarginsFor(trades, tradeContext),
        startingSlotCount: pulse?.slots.length ?? 0,
        isDynasty,
        settings: settings.grades,
        inProgress: false,
      })
    : [];

  // 9. Provenance + persistence. Upserts keep concurrent first-opens idempotent
  //    (both compute from the same frozen inputs; last write wins harmlessly).
  const valueDateMs = board.capturedAt ? Date.parse(board.capturedAt) : null;
  const adpDateMs = adp.snapshotDate
    ? Date.parse(`${adp.snapshotDate}T12:00:00.000Z`)
    : null;
  const projectionDateMs = projectionComputedAt
    ? Date.parse(projectionComputedAt)
    : null;
  const confidence = deriveSnapshotConfidence({
    valueSource: board.source,
    valueDateMs,
    adpSource: adp.source,
    adpDateMs,
    completedAtMs,
    projectionDateMs: Number.isFinite(projectionDateMs)
      ? projectionDateMs
      : null,
  });
  const finalizedAt = new Date().toISOString();

  const draftRow: SnapshotInsert = {
    sleeper_draft_id: draftId,
    sleeper_league_id: leagueId,
    season,
    league_name: leagueName,
    draft_type: cache.draft.draftType,
    draft_status: "complete",
    teams,
    rounds,
    format_slug: formatSlug,
    format_label: frozenBoard.formatLabel,
    player_pool: pool,
    adp_format_key: adp.adpKey,
    draft_completed_at: completedAtIso,
    finalized_at: finalizedAt,
    value_snapshot_source: board.source,
    adp_snapshot_source: adp.source,
    value_snapshot_date: board.capturedAt,
    adp_snapshot_date: adp.snapshotDate,
    projection_snapshot_date: projectionComputedAt,
    snapshot_confidence: confidence,
    board: frozenBoard as unknown as Json,
    draft: cache as unknown as Json,
    transactions: trades as unknown as Json,
    awards: awards as unknown as Json,
    grades: grades as unknown as Json,
    pulse: (pulse ?? {}) as unknown as Json,
    snapshot_version: SNAPSHOT_VERSION,
    metadata: {
      threshold_picks: threshold,
      adp_key_candidates: adpFormatKeyCandidates(formatSlug, pool),
      completed_at_source: completedAtMs !== null ? "last_picked" : "unknown",
      board_player_count: players.length,
      adp_player_count: Object.keys(adp.adpBySleeperId).length,
      trade_cutoff_ms: completedAtMs,
      trades_fetched: allTrades.length,
      trades_kept: trades.length,
      // Value-format substitution: when the league's own format has no FF Beacon
      // values, we grade against value_format_slug's CURRENT values so the draft
      // still locks. Equal to format_slug on the normal path. using_current_values
      // is true whenever values reflect "now" rather than the draft date (a
      // thrown/empty historical lookup, or a substitution).
      value_format_slug: valueFormatSlug,
      value_format_substituted: valueFormatSubstituted,
      using_current_values: usingCurrentValues,
    } as unknown as Json,
    updated_at: finalizedAt,
  };

  const { error: insertErr } = await admin
    .from("on_the_clock_draft_snapshots")
    .upsert(draftRow, { onConflict: "sleeper_draft_id" });
  if (insertErr) {
    return {
      status: "error",
      message: `snapshot write failed: ${insertErr.message}`,
    };
  }
  if (pickRows.length > 0) {
    const { error: pickErr } = await admin
      .from("on_the_clock_pick_snapshots")
      .upsert(pickRows, { onConflict: "sleeper_draft_id,pick_no" });
    if (pickErr) {
      // The draft row is the render source; pick rows are analytic. Log, keep going.
      console.error(
        "[on-the-clock/draft-snapshot] pick snapshot write failed",
        pickErr.message,
      );
    }
  }

  const payload: DraftSnapshotPayload = {
    sleeperDraftId: draftId,
    sleeperLeagueId: leagueId,
    season,
    leagueName,
    playerPool: pool,
    thresholdPicks: threshold,
    formatSlug,
    formatLabel: frozenBoard.formatLabel,
    draftCompletedAt: completedAtIso,
    finalizedAt,
    valueSnapshotSource: board.source,
    adpSnapshotSource: adp.source,
    valueSnapshotDate: board.capturedAt,
    adpSnapshotDate: adp.snapshotDate,
    adpFormatKey: adp.adpKey,
    confidence,
    board: frozenBoard,
    cache,
    transactions: trades,
    awards,
    grades,
    pulse,
    snapshotVersion: SNAPSHOT_VERSION,
  };
  return { status: "ready", snapshot: payload, created: true };
}
