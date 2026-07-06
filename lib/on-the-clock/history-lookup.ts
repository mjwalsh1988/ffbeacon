/**
 * Historical value + ADP lookup for On The Clock draft snapshots (server-only).
 *
 * Given a completed draft's completion time, these helpers answer: "what did the
 * FF Beacon board and the Sleeper ADP market look like at that moment?" They are
 * the single reusable layer behind snapshot finalization (board view, list view,
 * awards, finished-draft review, and future historical tools all read the frozen
 * snapshot these produce).
 *
 * Lookup priority (recorded in the returned `source` so callers can persist how
 * a snapshot was built):
 *   1. exact          - a snapshot from the completion day itself
 *   2. during_draft   - a snapshot taken between draft start and completion
 *   3. previous       - the closest snapshot before completion
 *   4. next_available - the closest snapshot after completion (no prior exists)
 *   5. current_fallback - only when no dated snapshot exists at all
 *
 * FF Beacon values come from player_value_history (source='ffbeacon'), which is
 * written nightly, so "the board on date X" is reconstructed by taking each
 * player's closest value row at-or-before X and re-ranking by value. Sleeper ADP
 * comes from player_market_snapshots (one partition per night).
 *
 * Reads are paginated defensively (PostgREST caps un-ranged selects at 1000
 * rows) and bounded: once a batch's captured_at window spans more than
 * BATCH_WINDOW_MS past the newest row, older history cannot change the result
 * (every player's closest row has been seen) and pagination stops.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { FFBEACON_SOURCE_SLUG, FFBEACON_SOURCE_DISPLAY } from "@/lib/signal-check/format";
import {
  ageFromBirthDate,
  deriveIsRookie,
  shapePickValues,
  toDraftPosition,
} from "./board-loader";
import type { PickBucketValue, RankedPlayer } from "./board-types";
import { MARKET_SOURCE_SLUG } from "@/lib/sync-sleeper-market";
import { ROOKIE_ADP_SOURCE, ROOKIE_ADP_KEY } from "@/lib/sync-rookie-adp";
import { pickFallbackFormat, type FormatLike } from "@/lib/format-fallback";

type Client = SupabaseClient<Database>;

// Canonical definitions live in snapshot-types.ts (pure, browser-safe) so the
// client can type snapshot payloads without importing this server-only module.
import type { SnapshotConfidence, SnapshotSourceKind } from "./snapshot-types";
export type { SnapshotConfidence, SnapshotSourceKind };

const PAGE = 1000;
const MAX_PAGES = 6;
/** Once fetched rows span this far past the newest row, every player's closest
 * snapshot has been seen (values are written nightly). 3 days of slack covers
 * partial sync nights. */
const BATCH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Classify how a chosen snapshot timestamp relates to the draft window.
 * `chosen` and `completedAt` are epoch ms; `draftStartAt` may be null.
 */
export function classifySnapshotSource(
  chosenMs: number | null,
  completedAtMs: number | null,
  draftStartAtMs: number | null,
): SnapshotSourceKind {
  if (chosenMs === null) return "current_fallback";
  if (completedAtMs === null) return "current_fallback";
  const sameDay =
    new Date(chosenMs).toISOString().slice(0, 10) ===
    new Date(completedAtMs).toISOString().slice(0, 10);
  if (sameDay) return "exact";
  if (chosenMs > completedAtMs) return "next_available";
  if (draftStartAtMs !== null && chosenMs >= draftStartAtMs) return "during_draft";
  return "previous";
}

/**
 * Overall confidence for a finalized snapshot. High when both inputs came from
 * at/inside the draft window or shortly before it; low when either had to fall
 * back to current data; medium otherwise.
 */
export function deriveSnapshotConfidence(params: {
  valueSource: SnapshotSourceKind;
  valueDateMs: number | null;
  adpSource: SnapshotSourceKind;
  adpDateMs: number | null;
  completedAtMs: number | null;
}): SnapshotConfidence {
  const { valueSource, valueDateMs, adpSource, adpDateMs, completedAtMs } = params;
  if (valueSource === "current_fallback" || adpSource === "current_fallback") return "low";

  const closeEnough = (kind: SnapshotSourceKind, dateMs: number | null): boolean => {
    if (kind === "exact" || kind === "during_draft") return true;
    if (dateMs === null || completedAtMs === null) return false;
    return Math.abs(completedAtMs - dateMs) <= 7 * DAY_MS;
  };

  const valueClose = closeEnough(valueSource, valueDateMs);
  const adpClose = closeEnough(adpSource, adpDateMs);
  if (valueClose && adpClose && valueSource !== "next_available" && adpSource !== "next_available") {
    return "high";
  }
  return "medium";
}

// ---------------------------------------------------------------------------
// Historical FF Beacon value board
// ---------------------------------------------------------------------------

interface ValueJoinRow {
  player_id: string;
  value: number;
  captured_at: string;
  players: {
    id: string;
    first_name: string;
    last_name: string;
    position: string;
    team: string | null;
    external_ids: Record<string, unknown> | null;
    draft_year: number | null;
    years_experience: number | null;
    birth_date: string | null;
  };
}

export interface HistoricalBoard {
  players: RankedPlayer[];
  pickValues: PickBucketValue[];
  formatSlug: string;
  formatLabel: string;
  /** The captured_at of the newest value row in the chosen batch (ISO). */
  capturedAt: string | null;
  source: SnapshotSourceKind;
}

function readSleeperId(externalIds: Record<string, unknown> | null): string | null {
  const v = externalIds?.sleeper;
  if (typeof v === "string" && v) return v;
  if (typeof v === "number") return String(v);
  return null;
}

/**
 * Fetch the closest per-player value rows in one direction of a target time.
 * direction 'before' walks newest-first from the target (or from now when the
 * target is null); 'after' walks oldest-first from the target. Returns the
 * per-player closest row map plus the batch boundary timestamp.
 */
async function fetchClosestValueRows(
  admin: Client,
  formatConfigId: string,
  targetIso: string | null,
  direction: "before" | "after",
): Promise<{ byPlayer: Map<string, ValueJoinRow>; boundaryMs: number | null }> {
  const byPlayer = new Map<string, ValueJoinRow>();
  let boundaryMs: number | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    let query = admin
      .from("player_value_history")
      .select(
        "player_id, value, captured_at, players!inner(id, first_name, last_name, position, team, external_ids, draft_year, years_experience, birth_date)",
      )
      .eq("format_config_id", formatConfigId)
      .eq("source", FFBEACON_SOURCE_SLUG)
      .order("captured_at", { ascending: direction === "after" })
      // Secondary sort makes pagination deterministic: hundreds of rows in one
      // nightly batch share (nearly) the same captured_at, and without a total
      // order Postgres may duplicate or skip tied rows across .range() pages,
      // which would silently drop players from a permanently frozen board.
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (targetIso) {
      query =
        direction === "before" ? query.lte("captured_at", targetIso) : query.gt("captured_at", targetIso);
    }

    const { data, error } = await query;
    if (error) throw new Error(`historical value lookup failed: ${error.message}`);
    const rows = (data ?? []) as unknown as ValueJoinRow[];
    if (rows.length === 0) break;

    if (boundaryMs === null) boundaryMs = Date.parse(rows[0].captured_at);

    let pastWindow = false;
    for (const row of rows) {
      if (!byPlayer.has(row.player_id)) byPlayer.set(row.player_id, row);
      const ts = Date.parse(row.captured_at);
      if (boundaryMs !== null && Number.isFinite(ts) && Math.abs(boundaryMs - ts) > BATCH_WINDOW_MS) {
        pastWindow = true;
      }
    }
    if (pastWindow || rows.length < PAGE) break;
  }

  return { byPlayer, boundaryMs };
}

/**
 * Reconstruct the FF Beacon board for a format as it stood at `targetIso`
 * (falling forward to the closest later batch, then to current data). Ranks are
 * re-derived from the historical values (rankings rows are overwritten daily and
 * keep no history, so value ordering is the durable historical signal). Returns
 * null only when the format has no FF Beacon value rows at all.
 */
export async function resolveHistoricalBoard(
  admin: Client,
  params: {
    formatSlug: string;
    /** Draft completion time (ISO). Null = use current data (current_fallback). */
    targetIso: string | null;
    /** Draft start time (ms epoch) for during_draft classification. */
    draftStartAtMs: number | null;
    /** Season used for rookie derivation (the draft's season). */
    rookieSeason: string;
  },
): Promise<HistoricalBoard | null> {
  const { formatSlug, targetIso, draftStartAtMs, rookieSeason } = params;

  const { data: format } = await admin
    .from("format_configs")
    .select("id, slug, display_name")
    .eq("slug", formatSlug)
    .maybeSingle();
  if (!format) return null;

  // 1. closest at-or-before the target; 2. closest after; 3. current.
  let batch = await fetchClosestValueRows(admin, format.id, targetIso, "before");
  let usedTarget = targetIso;
  let after = false;
  if (batch.byPlayer.size === 0 && targetIso) {
    batch = await fetchClosestValueRows(admin, format.id, targetIso, "after");
    after = batch.byPlayer.size > 0;
  }
  if (batch.byPlayer.size === 0) {
    batch = await fetchClosestValueRows(admin, format.id, null, "before");
    usedTarget = null;
  }
  if (batch.byPlayer.size === 0) return null;

  const completedAtMs = targetIso ? Date.parse(targetIso) : null;
  const source: SnapshotSourceKind =
    usedTarget === null
      ? "current_fallback"
      : after
        ? "next_available"
        : classifySnapshotSource(batch.boundaryMs, completedAtMs, draftStartAtMs);

  // Re-rank by value (the durable historical ordering).
  const rows = [...batch.byPlayer.values()].sort(
    (a, b) => Number(b.value) - Number(a.value) || a.player_id.localeCompare(b.player_id),
  );

  const now = new Date();
  const rookieSeasonNum = Number(rookieSeason);
  const players: RankedPlayer[] = [];
  const posCounts: Record<string, number> = {};
  for (const row of rows) {
    const pl = row.players;
    const position = toDraftPosition(pl.position);
    if (!position) continue;
    posCounts[position] = (posCounts[position] ?? 0) + 1;
    players.push({
      playerId: pl.id,
      sleeperId: readSleeperId(pl.external_ids),
      name: `${pl.first_name} ${pl.last_name}`.trim(),
      position,
      team: pl.team,
      overallRank: players.length + 1,
      positionRank: posCounts[position],
      tier: 1, // re-tiered below once the board size is known
      value: Number(row.value),
      isRookie: deriveIsRookie(pl.years_experience, pl.draft_year, rookieSeasonNum),
      yearsExperience: pl.years_experience ?? undefined,
      age: ageFromBirthDate(pl.birth_date, now),
      change7d: null,
      change7dPct: null,
      trend7d: null,
      show7d: false,
    });
  }
  // Deterministic 6-bucket tiers by overall rank (the live board's editorial
  // tiers are not preserved historically; this keeps the field meaningful).
  const perTier = Math.max(1, Math.ceil(players.length / 6));
  for (const p of players) p.tier = Math.min(6, Math.ceil(p.overallRank / perTier));

  // Pick values: latest batch at-or-before the target, else the latest overall.
  let picksQuery = admin
    .from("draft_pick_values")
    .select("season, round, pick_position, value, captured_at")
    .eq("format_config_id", format.id)
    .eq("source", FFBEACON_SOURCE_SLUG)
    .order("captured_at", { ascending: false })
    .limit(PAGE);
  if (targetIso) picksQuery = picksQuery.lte("captured_at", targetIso);
  let { data: pickRows } = await picksQuery;
  if ((!pickRows || pickRows.length === 0) && targetIso) {
    const retry = await admin
      .from("draft_pick_values")
      .select("season, round, pick_position, value, captured_at")
      .eq("format_config_id", format.id)
      .eq("source", FFBEACON_SOURCE_SLUG)
      .order("captured_at", { ascending: false })
      .limit(PAGE);
    pickRows = retry.data;
  }

  return {
    players,
    pickValues: shapePickValues(pickRows ?? []),
    formatSlug: format.slug,
    formatLabel: format.display_name || FFBEACON_SOURCE_DISPLAY,
    capturedAt: batch.boundaryMs !== null ? new Date(batch.boundaryMs).toISOString() : null,
    source,
  };
}

/**
 * When a league's own format has no FF Beacon value rows at all, pick the closest
 * ACTIVE format that DOES have value data so a completed draft can still be graded
 * and locked instead of being stuck forever.
 *
 * We do not yet compute FF Beacon values for every active format (as of now
 * redraft Half PPR, redraft Standard, and redraft TEP have none), so a draft in
 * one of those formats can never build a value board. Rather than leave it
 * permanently unlockable, callers grade its VALUES against the format this returns
 * (using current values), while still resolving ADP against the league's real
 * format (Sleeper publishes those markets). Uses the shared format-fallback
 * preference chain (same league_type, then scoring, then superflex, then lowest
 * display_order), scoped to formats that actually have data. Returns null only
 * when NO active format has any FF Beacon values (nothing to fall back to), or
 * when the closest match is the input format itself.
 *
 * The chain keeps the same league_type only while at least one has-data format
 * shares it; today the PPR base of each league type (redraft-ppr-std /
 * dynasty-ppr-std) is always synced, so redraft stays redraft and dynasty stays
 * dynasty. If every same-league format ever lost its values, this would degrade to
 * a cross-type match rather than returning null.
 */
export async function pickValueFormatWithData(
  admin: Client,
  formatSlug: string,
): Promise<string | null> {
  const { data: formats } = await admin
    .from("format_configs")
    .select("id, slug, display_name, league_type, scoring_type, is_superflex, display_order")
    .eq("is_active", true);
  if (!formats || formats.length === 0) return null;

  // Existence probe per format: LIMIT 1 is an index-friendly point lookup on
  // (format_config_id, source), far cheaper than counting every value row.
  const withData = await Promise.all(
    formats.map(async (f) => {
      const { data } = await admin
        .from("player_value_history")
        .select("player_id")
        .eq("format_config_id", f.id)
        .eq("source", FFBEACON_SOURCE_SLUG)
        .limit(1);
      return data && data.length > 0 ? f.slug : null;
    }),
  );
  const eligible = withData.filter((s): s is string => s !== null);
  if (eligible.length === 0) return null;

  const formatLikes: FormatLike[] = formats.map((f) => ({
    slug: f.slug,
    display_name: f.display_name,
    league_type: f.league_type,
    scoring_type: f.scoring_type,
    is_superflex: f.is_superflex,
    display_order: f.display_order,
  }));
  const choice = pickFallbackFormat(formatLikes, formatSlug, eligible);
  if (!choice || choice.slug === formatSlug) return null;
  return choice.slug;
}

// ---------------------------------------------------------------------------
// Sleeper ADP snapshots (historical + latest)
// ---------------------------------------------------------------------------

export interface AdpSnapshot {
  /** Sleeper player id -> ADP (overall pick number) for the chosen key. */
  adpBySleeperId: Record<string, number>;
  /** The adp map key actually used (first candidate with data), or null. */
  adpKey: string | null;
  /** The snapshot_date (YYYY-MM-DD) served, or null when none exists. */
  snapshotDate: string | null;
  source: SnapshotSourceKind;
}

export const EMPTY_ADP: AdpSnapshot = {
  adpBySleeperId: {},
  adpKey: null,
  snapshotDate: null,
  source: "current_fallback",
};

async function pickSnapshotDate(
  admin: Client,
  targetDate: string | null,
  source: string = MARKET_SOURCE_SLUG,
): Promise<{ date: string | null; after: boolean }> {
  if (targetDate) {
    const before = await admin
      .from("player_market_snapshots")
      .select("snapshot_date")
      .eq("source", source)
      .lte("snapshot_date", targetDate)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (before.data?.snapshot_date) return { date: before.data.snapshot_date, after: false };
    const afterRow = await admin
      .from("player_market_snapshots")
      .select("snapshot_date")
      .eq("source", source)
      .gt("snapshot_date", targetDate)
      .order("snapshot_date", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (afterRow.data?.snapshot_date) return { date: afterRow.data.snapshot_date, after: true };
    return { date: null, after: false };
  }
  const latest = await admin
    .from("player_market_snapshots")
    .select("snapshot_date")
    .eq("source", source)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { date: latest.data?.snapshot_date ?? null, after: false };
}

/**
 * Resolve the ADP map for a draft. `keyCandidates` is the ordered list from
 * adpFormatKeyCandidates; the first key with rows on the chosen snapshot date
 * wins. `targetDate` (YYYY-MM-DD) selects the closest partition at-or-before it,
 * falling forward to the closest later one; null means "latest" (live mode).
 * `completedAtMs` / `draftStartAtMs` drive the source classification for
 * historical use; pass null in live mode (source is then informational only).
 */
export async function resolveAdpSnapshot(
  admin: Client,
  params: {
    keyCandidates: string[];
    targetDate: string | null;
    completedAtMs: number | null;
    draftStartAtMs: number | null;
  },
): Promise<AdpSnapshot> {
  const { keyCandidates, targetDate, completedAtMs, draftStartAtMs } = params;

  // ADP lives in two sources with independent partition dates: Sleeper writes the
  // standard market keys, DynastyProcess writes the "rookie" key (Sleeper's own
  // adp_rookie is a permanent 999 sentinel). Resolve each source's snapshot date
  // once, then route every candidate key to the right (source, date) pair.
  const [sleeper, rookie] = await Promise.all([
    pickSnapshotDate(admin, targetDate, MARKET_SOURCE_SLUG),
    pickSnapshotDate(admin, targetDate, ROOKIE_ADP_SOURCE),
  ]);
  if (!sleeper.date && !rookie.date) return { ...EMPTY_ADP };

  for (const key of keyCandidates) {
    const isRookie = key === ROOKIE_ADP_KEY;
    const source = isRookie ? ROOKIE_ADP_SOURCE : MARKET_SOURCE_SLUG;
    const picked = isRookie ? rookie : sleeper;
    if (!picked.date) continue;

    // Keys are internal constants (adpFormatKeyCandidates), never user input.
    const { data, error } = await admin
      .from("player_market_snapshots")
      .select("sleeper_player_id, adp")
      .eq("source", source)
      .eq("snapshot_date", picked.date)
      .not(`adp->>${key}`, "is", null)
      .limit(PAGE);
    if (error) throw new Error(`ADP snapshot lookup failed: ${error.message}`);
    if (!data || data.length === 0) continue;

    const adpBySleeperId: Record<string, number> = {};
    for (const row of data) {
      const map = row.adp as Record<string, unknown> | null;
      const v = Number(map?.[key]);
      if (Number.isFinite(v) && v > 0) adpBySleeperId[row.sleeper_player_id] = v;
    }
    if (Object.keys(adpBySleeperId).length === 0) continue;

    const chosenMs = Date.parse(`${picked.date}T12:00:00.000Z`);
    const source_: SnapshotSourceKind =
      targetDate === null
        ? "current_fallback"
        : picked.after
          ? "next_available"
          : classifySnapshotSource(chosenMs, completedAtMs, draftStartAtMs);
    return { adpBySleeperId, adpKey: key, snapshotDate: picked.date, source: source_ };
  }

  return { ...EMPTY_ADP, snapshotDate: sleeper.date ?? rookie.date };
}
