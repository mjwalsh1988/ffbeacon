/**
 * Server-only sync helper for On The Clock. This is the ONLY path that calls
 * Sleeper to write the cache. The Phase 3 POST /draft/sync route will call
 * performDraftSync; it is NOT wired to any route yet.
 *
 * Flow (matches ON-THE-CLOCK-PLAN.md section 4):
 *   resolve league_id/season (from args, the Sleeper draft object, or the cache)
 *   -> claim_on_the_clock_sync (durable 30s lock)
 *        not claimed -> return cached shape + status (cooldown | synced-by-other)
 *        claimed     -> fetch Sleeper draft/picks/users/rosters
 *                       -> resolve sleeper_player_id -> player_id once, here
 *                       -> upsert draft + pick cache rows
 *                       -> complete_on_the_clock_sync (advances last_synced_at)
 *   on Sleeper failure -> release_on_the_clock_sync (clears lock, no cooldown
 *                         advance) and return the existing cache + a safe error
 *
 * Player-id mapping is done ONCE here and stored on the pick row, so the read path
 * and Realtime never re-map per viewer.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  getSleeperDraft,
  getSleeperDraftPicks,
  getSleeperLeagueUsers,
  getSleeperRosters,
  getSleeperTradedPicks,
  type SleeperDraft,
} from "@/lib/sleeper";
import { mapSleeperToPlayerIds } from "@/lib/players/sleeper-map";
import { sanitizeSleeperPlayerId } from "./validation";
import { claimSync, completeSync, releaseSync, readDraftCache } from "./cache";
import type { SyncOutcome } from "./types";

type Client = SupabaseClient<Database>;
type PickInsert = Database["public"]["Tables"]["on_the_clock_pick_cache"]["Insert"];

export interface PerformSyncParams {
  draftId: string;
  /** Optional. Resolved from the Sleeper draft object or cache when absent. */
  leagueId?: string;
  /** Optional. Resolved from the Sleeper draft object or cache when absent. */
  season?: string;
  cooldownSeconds: number;
  lockSeconds: number;
}

/** Sleeper uses "0" as an empty-roster-slot placeholder; never store it. */
function validPlayerId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id !== "0";
}

async function cacheOutcome(
  admin: Client,
  draftId: string,
  status: SyncOutcome["status"],
  cooldownRemainingSeconds: number,
  error?: string,
): Promise<SyncOutcome> {
  const cache = await readDraftCache(admin, draftId);
  return {
    status,
    cooldownRemainingSeconds,
    lastSyncedAt: cache?.draft.lastSyncedAt ?? null,
    cache,
    ...(error ? { error } : {}),
  };
}

/**
 * Run a sync for one draft through the durable lock. Always returns the current
 * shaped cache (when one exists) so the caller can render regardless of status.
 */
export async function performDraftSync(admin: Client, params: PerformSyncParams): Promise<SyncOutcome> {
  const { draftId, cooldownSeconds, lockSeconds } = params;

  // 1. Resolve league_id + season. Prefer caller-supplied (the normal path, where
  //    the client already knows them from the leagues route) so the claim happens
  //    with no pre-fetch. Otherwise look them up from the Sleeper draft object
  //    (cold start), then from the existing cache row as a last resort.
  let leagueId = params.leagueId;
  let season = params.season;
  let draftObj: SleeperDraft | null = null;

  if (!leagueId || !season) {
    draftObj = await getSleeperDraft(draftId);
    if (draftObj) {
      leagueId = leagueId ?? draftObj.league_id ?? undefined;
      season = season ?? draftObj.season;
    }
  }
  if (!leagueId || !season) {
    const existing = await readDraftCache(admin, draftId);
    if (existing) {
      leagueId = leagueId ?? existing.draft.sleeperLeagueId;
      season = season ?? existing.draft.season;
    }
  }
  if (!leagueId || !season) {
    return cacheOutcome(admin, draftId, "error", 0, "Could not find this draft on Sleeper.");
  }

  // 2. Claim the durable lock.
  let claim;
  try {
    claim = await claimSync(admin, { draftId, leagueId, season, cooldownSeconds, lockSeconds });
  } catch {
    return cacheOutcome(admin, draftId, "error", 0, "Sync is temporarily unavailable. Try again shortly.");
  }

  if (!claim.claimed) {
    const cache = await readDraftCache(admin, draftId);
    return {
      status: claim.lockedByOther ? "synced-by-other" : "cooldown",
      cooldownRemainingSeconds: claim.cooldownRemainingSeconds,
      lastSyncedAt: claim.lastSyncedAt,
      cache,
    };
  }

  // 3. We won the claim: fetch Sleeper and upsert. Release the lock on any failure
  //    so the user can retry before the cooldown.
  try {
    if (!draftObj) draftObj = await getSleeperDraft(draftId);
    // traded_picks is fetched alongside the rest; getSleeperTradedPicks returns []
    // on any failure, so a traded-picks outage degrades to "no traded picks"
    // (pick ownership falls back to the original draft order) without breaking the
    // sync. This is the ONLY new Sleeper call: one per sync, inside the same lock.
    const [picks, users, rosters, tradedPicks] = await Promise.all([
      getSleeperDraftPicks(draftId),
      getSleeperLeagueUsers(leagueId),
      getSleeperRosters(leagueId),
      getSleeperTradedPicks(leagueId),
    ]);

    if (!draftObj) {
      await releaseSync(admin, draftId);
      return cacheOutcome(admin, draftId, "error", 0, "Could not reach Sleeper. Try again shortly.");
    }

    // Resolve every drafted player's id once, here.
    const sleeperPlayerIds = picks
      .map((p) => p.player_id)
      .filter((id): id is string => validPlayerId(id));
    const idMap = await mapSleeperToPlayerIds(admin, sleeperPlayerIds);

    const leagueUsersJson = users.map((u) => ({
      user_id: u.user_id,
      display_name: u.display_name ?? null,
      avatar: u.avatar ?? null,
    }));
    const rostersJson = rosters.map((r) => ({
      roster_id: r.roster_id,
      owner_id: r.owner_id ?? null,
      co_owners: Array.isArray(r.co_owners) ? r.co_owners : [],
      players: (r.players ?? []).filter(validPlayerId),
    }));

    const { error: draftErr } = await admin.from("on_the_clock_draft_cache").upsert(
      {
        sleeper_draft_id: draftId,
        sleeper_league_id: leagueId,
        season,
        draft_status: draftObj.status ?? null,
        draft_type: draftObj.type ?? null,
        pick_count: picks.length,
        metadata: draftObj as unknown as Json,
        league_users: leagueUsersJson as unknown as Json,
        rosters: rostersJson as unknown as Json,
        traded_picks: tradedPicks as unknown as Json,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "sleeper_draft_id" },
    );
    if (draftErr) throw new Error(`draft cache upsert failed: ${draftErr.message}`);

    const pickRows: PickInsert[] = picks.map((p) => {
      const sleeperPid = sanitizeSleeperPlayerId(p.player_id);
      const playerId = sleeperPid ? (idMap.get(sleeperPid) ?? null) : null;
      return {
        sleeper_draft_id: draftId,
        pick_no: p.pick_no,
        round: p.round ?? null,
        draft_slot: p.draft_slot ?? null,
        roster_id: p.roster_id ?? null,
        picked_by: p.picked_by ?? null,
        sleeper_player_id: sleeperPid,
        player_id: playerId,
        is_keeper: p.is_keeper === true,
        metadata: (p.metadata ?? {}) as Json,
        updated_at: new Date().toISOString(),
      };
    });

    if (pickRows.length > 0) {
      const { error: pickErr } = await admin
        .from("on_the_clock_pick_cache")
        .upsert(pickRows, { onConflict: "sleeper_draft_id,pick_no" });
      if (pickErr) throw new Error(`pick cache upsert failed: ${pickErr.message}`);
    }

    await completeSync(admin, {
      draftId,
      pickCount: picks.length,
      status: draftObj.status ?? null,
    });

    return cacheOutcome(admin, draftId, "synced", cooldownSeconds);
  } catch {
    // Best-effort release; never let a release failure mask the original error.
    await releaseSync(admin, draftId).catch(() => {});
    return cacheOutcome(admin, draftId, "error", 0, "Sync failed. Try again shortly.");
  }
}
