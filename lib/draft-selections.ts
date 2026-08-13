/**
 * The canonical draft-pick ledger writer.
 *
 * Two unrelated sync paths see real drafts and neither kept a durable record a
 * market model could read. On The Clock writes on_the_clock_pick_cache, which is
 * a LIVE ROOM cache: rows are deleted when a commissioner reverts a pick, and the
 * draft context lives in a different table. League Pulse wrote league_drafts,
 * which stored a draft's settings and never stored a single pick.
 *
 * This module is the one way rows reach draft_selections. Both paths call
 * recordDraftSelections and neither owns the shaping.
 *
 * THE SHAPING IS PURE AND THE I/O IS NOT.
 * shapeDraftSelections takes already-fetched picks plus an already-resolved
 * player-id map and returns rows. It is exhaustively unit tested. Only
 * recordDraftSelections touches Supabase, and it never throws: a ledger failure
 * must never fail a live draft sync or a league pulse. The ledger is analytics
 * input, not something a user is waiting on.
 *
 * DEDUPE IS AT THE DATABASE, NOT HERE. The unique constraint on
 * (sleeper_draft_id, pick_no) means the same draft seen by both paths converges
 * on one row set rather than double-counting, which matters because 34 of the
 * synced League Pulse drafts are also On The Clock drafts.
 *
 * No `import "server-only"` guard, matching lib/league-pulse.ts and
 * lib/calculate-trends.ts: this module is imported by a tsx backfill script,
 * where that specifier does not resolve. The real guard is the table itself,
 * which has no anon or authenticated policy, so a browser bundle importing this
 * would get nothing but failed writes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { mapSleeperToPlayerIds } from "@/lib/players/sleeper-map";
import { sanitizeSleeperPlayerId, isValidDraftId } from "@/lib/on-the-clock/validation";

type Client = SupabaseClient<Database>;
export type DraftSelectionInsert = Database["public"]["Tables"]["draft_selections"]["Insert"];

/** Which sync path produced these rows. Provenance only; never affects dedupe. */
export type DraftIngestSource = "on_the_clock" | "league_pulse" | "backfill";

/** Everything about the draft that gets denormalized onto every one of its picks. */
export interface DraftSelectionContext {
  sleeperDraftId: string;
  sleeperLeagueId: string | null;
  season: number;
  draftType: string | null;
  draftStatus: string | null;
  /** FF Beacon format_configs slug, or null when it could not be derived. */
  formatSlug: string | null;
  playerPool: "everyone" | "rookies" | null;
  teams: number | null;
  rounds: number | null;
  /** ISO string. The draft's start_time when Sleeper gives one. */
  draftedAt: string | null;
  ingestSource: DraftIngestSource;
}

/** The subset of a Sleeper draft pick this module reads. */
export interface RawDraftPick {
  pick_no?: number | string | null;
  round?: number | string | null;
  draft_slot?: number | string | null;
  roster_id?: number | string | null;
  picked_by?: string | null;
  /** Sleeper's PLAYER id, not our uuid. */
  player_id?: string | null;
  is_keeper?: boolean | null;
  metadata?: unknown;
}

/** Coerce a Sleeper numeric-ish field to a finite integer, or null. */
function intOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Shape raw Sleeper picks into ledger rows. Pure: no Supabase, no fetch.
 *
 * Dropped rows, and why:
 *  - a pick with no usable pick_no. pick_no is half the unique key and the entire
 *    basis of an ADP, so a pick we cannot place in the order is not a pick.
 *  - nothing else. A pick whose player we could not map to an FF Beacon id is
 *    still stored with player_id null, because the raw Sleeper id is worth
 *    keeping and the mapping may succeed on a later run once the player exists.
 *
 * Duplicate pick_no values inside one payload keep the LAST occurrence, matching
 * upsert semantics, so the shaped array can be handed to a single upsert without
 * Postgres rejecting it for touching the same key twice.
 */
export function shapeDraftSelections(
  picks: readonly RawDraftPick[],
  ctx: DraftSelectionContext,
  playerIdBySleeperId: ReadonlyMap<string, string>,
  now: Date = new Date(),
): DraftSelectionInsert[] {
  // The draft id becomes half the unique key, a PostgREST filter value on the
  // read path, and a Sleeper URL path segment on the backfill. On The Clock
  // validated it at the route; the League Pulse path did not, so it is enforced
  // here where BOTH callers pass through.
  if (!isValidDraftId(ctx.sleeperDraftId)) return [];

  const byPickNo = new Map<number, DraftSelectionInsert>();
  const timestamp = now.toISOString();

  for (const pick of picks) {
    const pickNo = intOrNull(pick.pick_no);
    if (pickNo === null || pickNo <= 0) continue;

    // Sleeper uses "0" as an empty-slot placeholder and it passes the id
    // allowlist (length-1 numeric), so it is stripped explicitly.
    const rawSleeperId = sanitizeSleeperPlayerId(pick.player_id);
    const sleeperPlayerId = rawSleeperId && rawSleeperId !== "0" ? rawSleeperId : null;

    byPickNo.set(pickNo, {
      sleeper_draft_id: ctx.sleeperDraftId,
      pick_no: pickNo,
      round: intOrNull(pick.round),
      draft_slot: intOrNull(pick.draft_slot),
      roster_id: intOrNull(pick.roster_id),
      picked_by: typeof pick.picked_by === "string" && pick.picked_by ? pick.picked_by : null,
      sleeper_player_id: sleeperPlayerId,
      player_id: sleeperPlayerId ? (playerIdBySleeperId.get(sleeperPlayerId) ?? null) : null,
      is_keeper: pick.is_keeper === true,
      sleeper_league_id: ctx.sleeperLeagueId,
      season: ctx.season,
      draft_type: ctx.draftType,
      draft_status: ctx.draftStatus,
      format_slug: ctx.formatSlug,
      player_pool: ctx.playerPool,
      teams: ctx.teams,
      rounds: ctx.rounds,
      drafted_at: ctx.draftedAt,
      ingest_source: ctx.ingestSource,
      metadata: (pick ?? {}) as unknown as Json,
      updated_at: timestamp,
    });
  }

  return [...byPickNo.values()].sort((a, b) => (a.pick_no ?? 0) - (b.pick_no ?? 0));
}

/** What a record attempt did, for the caller's logs. Never an exception. */
export interface RecordSelectionsResult {
  ok: boolean;
  rowsWritten: number;
  /** Present only when ok is false. */
  error?: string;
}

/** Upserted in chunks so a 300-pick draft is one request and a backfill is bounded. */
const UPSERT_CHUNK = 500;

/**
 * Resolve player ids and write the ledger rows for one draft.
 *
 * NEVER THROWS. Both callers are on a path a user is waiting on (a live draft
 * sync, a league pulse), and the ledger is analytics input. A failure here is
 * logged and reported in the return value; it is never allowed to surface as a
 * failed sync.
 *
 * `admin` must be a service-role client: draft_selections has no anon or
 * authenticated policy.
 */
export async function recordDraftSelections(
  admin: Client,
  picks: readonly RawDraftPick[],
  ctx: DraftSelectionContext,
  options: {
    /**
     * A Sleeper-id to player-id map the caller has already resolved. On The Clock
     * builds exactly this map to write its own pick cache, so passing it here
     * saves a second identical round trip on every live-draft sync.
     */
    playerIdBySleeperId?: ReadonlyMap<string, string>;
  } = {},
): Promise<RecordSelectionsResult> {
  try {
    if (picks.length === 0) return { ok: true, rowsWritten: 0 };

    let idMap = options.playerIdBySleeperId;
    if (!idMap) {
      const sleeperIds = picks
        .map((p) => p.player_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      idMap = await mapSleeperToPlayerIds(admin, sleeperIds);
    }

    const rows = shapeDraftSelections(picks, ctx, idMap);
    if (rows.length === 0) return { ok: true, rowsWritten: 0 };

    let written = 0;
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK);
      const { error } = await admin
        .from("draft_selections")
        .upsert(chunk, { onConflict: "sleeper_draft_id,pick_no" });
      if (error) {
        console.error("[draft-selections] upsert failed", error.message);
        return { ok: false, rowsWritten: written, error: error.message };
      }
      written += chunk.length;
    }

    return { ok: true, rowsWritten: written };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[draft-selections] record failed", message);
    return { ok: false, rowsWritten: 0, error: message };
  }
}

/**
 * Which of the given draft ids already have ledger rows. Used by the League Pulse
 * path so a completed draft's picks are fetched from Sleeper exactly ONCE ever,
 * rather than on every pulse.
 *
 * Filtered to pick_no = 1 ON PURPOSE. Selecting every row for a set of drafts
 * would return hundreds of rows per draft and hit PostgREST's silent 1000-row
 * ceiling long before the draft list ran out, so a large league portfolio would
 * report its later drafts as unseen and re-fetch them forever. Every real draft
 * has a pick 1, so this is exactly one row per already-captured draft.
 *
 * Returns an empty set on any failure, which makes the caller re-fetch rather
 * than silently skip: a wasted Sleeper call is a much cheaper mistake than
 * permanently missing picks.
 */
export async function draftIdsWithSelections(
  admin: Client,
  sleeperDraftIds: readonly string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  const ids = [...new Set(sleeperDraftIds)];
  if (ids.length === 0) return found;
  try {
    const { data, error } = await admin
      .from("draft_selections")
      .select("sleeper_draft_id")
      .in("sleeper_draft_id", ids)
      .eq("pick_no", 1);
    if (error || !data) return found;
    for (const row of data) found.add(row.sleeper_draft_id);
    return found;
  } catch {
    return found;
  }
}
