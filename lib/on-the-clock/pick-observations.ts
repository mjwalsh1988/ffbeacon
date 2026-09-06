/**
 * Real per-pick draft timing, captured going forward (docs/manager-pulse/manager-pulse-plan.md
 * section 2.3, part B). Sleeper publishes NO timestamp on a draft pick, in the
 * REST payload or the GraphQL type. The only honest measurement is the moment
 * OUR poll first sees a pick, so this module writes that moment to
 * draft_pick_observations and never revisits it.
 *
 * Written by the On The Clock live sync path only (lib/on-the-clock/sleeper-sync.ts),
 * which is the one place already polling live drafts and already knows which
 * picks are new since the last poll. This module does no Sleeper fetching and
 * no draft-status reasoning; it only shapes and writes what it is handed.
 *
 * `picks` MUST be the picks newly seen on THIS poll, not the whole draft board.
 * Passing the full board every time would make every poll after the first look
 * like a bulk catch-up (see below) and permanently disable gap tracking for a
 * draft that is otherwise being observed cleanly.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { SleeperDraftPick } from "@/lib/sleeper";

type Client = SupabaseClient<Database>;
export type PickObservationInsert = Database["public"]["Tables"]["draft_pick_observations"]["Insert"];

export interface RecordPickObservationsParams {
  sleeperDraftId: string;
  season: number | null;
  /** The picks newly seen on this poll, not the whole draft board. */
  picks: readonly SleeperDraftPick[];
  /** Milliseconds since the previous poll of THIS draft, when known. */
  pollGapMs: number | null;
  /** Sleeper user ids currently on autopick, when we could read them. */
  autopickerIds?: string[] | null;
}

export interface RecordPickObservationsResult {
  inserted: number;
  skipped: number;
}

/** Written in chunks so a deep draft is a bounded number of requests. */
const INSERT_CHUNK = 200;

/** Coerce a Sleeper numeric-ish field to a finite integer, or null. */
function intOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * was_autopick is THREE states, not two.
 *   true  - picked_by is on the autopicker list we read this poll
 *   false - we read a list this poll, and picked_by is not on it
 *   null  - we could not read the list at all (draft not live, or the
 *           GraphQL call failed), so we do not know and must not guess
 * Collapsing the null case to false would tell a report that a manager was
 * present at a draft we were never able to observe.
 */
function autopickFlag(pickedBy: string | null, autopickerIds: string[] | null): boolean | null {
  if (!autopickerIds) return null;
  return pickedBy !== null && autopickerIds.includes(pickedBy);
}

/**
 * The poll gap is only an honest error bar for a poll that first saw EXACTLY
 * one new pick. A poll that first sees more than one pick at once (the first
 * time we ever look at a draft already in progress, or a poll interval that
 * let two real picks pass between checks) proves those picks already
 * happened, not how long each one individually took: attributing the whole
 * poll gap to every one of them would overstate accuracy for picks that may
 * have landed seconds apart inside that same window. Both that case and a
 * genuinely unknown gap (no previous poll to measure from) collapse to the
 * same signal: null, never a guessed zero.
 */
function observationGapForBatch(newPickCount: number, pollGapMs: number | null): number | null {
  if (newPickCount > 1) return null;
  return pollGapMs;
}

/** Shape newly-seen Sleeper picks into ledger rows. Pure: no Supabase, no fetch. */
export function shapePickObservations(
  picks: readonly SleeperDraftPick[],
  params: {
    sleeperDraftId: string;
    season: number | null;
    pollGapMs: number | null;
    autopickerIds?: string[] | null;
  },
): PickObservationInsert[] {
  const autopickers = params.autopickerIds ?? null;
  const gapMs = observationGapForBatch(picks.length, params.pollGapMs);

  // Deduped by pick_no, last occurrence wins, matching shapeDraftSelections:
  // a single insert call cannot legally touch the same key twice.
  const byPickNo = new Map<number, PickObservationInsert>();
  for (const pick of picks) {
    const pickNo = intOrNull(pick.pick_no);
    if (pickNo === null || pickNo <= 0) continue;

    const pickedBy = typeof pick.picked_by === "string" && pick.picked_by ? pick.picked_by : null;
    const sleeperPlayerId =
      typeof pick.player_id === "string" && pick.player_id && pick.player_id !== "0"
        ? pick.player_id
        : null;

    byPickNo.set(pickNo, {
      sleeper_draft_id: params.sleeperDraftId,
      pick_no: pickNo,
      round: intOrNull(pick.round),
      draft_slot: intOrNull(pick.draft_slot),
      roster_id: intOrNull(pick.roster_id),
      picked_by: pickedBy,
      sleeper_player_id: sleeperPlayerId,
      season: params.season,
      observation_gap_ms: gapMs,
      was_autopick: autopickFlag(pickedBy, autopickers),
      // The raw pick object as received, under its own key, with the
      // autopicker list (when we have one) merged in under its own key
      // alongside it. Never drop raw source data on the floor.
      metadata: {
        pick: pick ?? {},
        ...(autopickers ? { autopickers } : {}),
      } as unknown as Json,
    });
  }

  return [...byPickNo.values()].sort((a, b) => (a.pick_no ?? 0) - (b.pick_no ?? 0));
}

/**
 * Write pick-observation rows for the newly-seen picks of one poll.
 *
 * INSERT ONLY, NEVER UPDATE. Uses upsert with ignoreDuplicates so a pick
 * already on file (seen by an earlier poll) is left untouched rather than
 * having its first_seen_at overwritten. first_seen_at is the FIRST time we
 * saw a pick; overwriting it on a later poll would turn a measurement of the
 * manager into a measurement of when our cron last happened to run.
 *
 * NEVER THROWS. This rides on a live user-facing draft poll; a telemetry
 * write failing here must never break the draft in progress.
 *
 * `admin` must be a service-role client: draft_pick_observations has no anon
 * or authenticated policy.
 */
export async function recordPickObservations(
  admin: Client,
  params: RecordPickObservationsParams,
): Promise<RecordPickObservationsResult> {
  try {
    const rows = shapePickObservations(params.picks, {
      sleeperDraftId: params.sleeperDraftId,
      season: params.season,
      pollGapMs: params.pollGapMs,
      autopickerIds: params.autopickerIds ?? null,
    });

    if (rows.length === 0) {
      return { inserted: 0, skipped: params.picks.length };
    }

    let inserted = 0;
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK);
      const { data, error } = await admin
        .from("draft_pick_observations")
        .upsert(chunk, {
          onConflict: "sleeper_draft_id,pick_no",
          ignoreDuplicates: true,
        })
        .select("pick_no");
      if (error) {
        console.error("[pick-observations] insert failed", error.message);
        return { inserted, skipped: params.picks.length - inserted };
      }
      inserted += data?.length ?? 0;
    }

    const skipped = params.picks.length - inserted;
    return { inserted, skipped: skipped > 0 ? skipped : 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[pick-observations] record failed", message);
    return { inserted: 0, skipped: params.picks.length };
  }
}
