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
  getSleeperDraftPicksOrNull,
  getSleeperLeague,
  getSleeperLeagueUsers,
  getSleeperRosters,
  getSleeperTradedPicks,
  type SleeperDraft,
} from "@/lib/sleeper";
import { mapSleeperToPlayerIds } from "@/lib/players/sleeper-map";
import { recordDraftSelections } from "@/lib/draft-selections";
import { sanitizeSleeperPlayerId } from "./validation";
import { claimSync, completeSync, releaseSync, readDraftCache, claimIpBudget, IP_BUDGET_WINDOW_SECONDS } from "./cache";
import { ffbeaconFormatCandidates, detectLeagueFormat } from "./format-detect";
import { inferPlayerPool } from "./draft-derive";
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
  /** Trusted client IP for the identifier-independent Sleeper fan-out budget
   * (FFB-SEC-002). Checked only after the per-draft claim is won, so cache hits and
   * cooldown denials never consume budget. Omit to skip (e.g. server-internal syncs). */
  ipKey?: string;
  /**
   * The last_synced_at of the snapshot the caller already holds, if any.
   *
   * A room that refreshes itself every minute spends most of its attempts being
   * told the cooldown has not elapsed. When the caller's stamp matches the one the
   * claim just read, nothing has been fetched from Sleeper since it last looked, so
   * there is nothing to send: the read is skipped and `cache` comes back null,
   * which the caller reads as "keep what you have". Compared as an opaque string,
   * and only ever used to decide whether to skip a read.
   */
  knownLastSyncedAt?: string;
}

/** Sleeper uses "0" as an empty-roster-slot placeholder; never store it. */
function validPlayerId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id !== "0";
}

/**
 * Sleeper's draft start_time is epoch milliseconds. Returns null for anything
 * that is not a real instant rather than letting `new Date(NaN).toISOString()`
 * throw a RangeError inside the ledger write.
 */
function epochMsToIso(value: unknown): string | null {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * FFB-SEC-003: resolve the AUTHORITATIVE league binding for a draft. The Sleeper draft
 * object is the source of truth; any client-supplied league_id/season are hints only.
 * A hint that disagrees with the draft object is ignored (and flagged as mismatched) so
 * a crafted request can never bind a draft to the wrong league in the shared cache.
 * When the draft object omits a value, the hint is used as a fallback.
 */
export function resolveAuthoritativeBinding(
  draft: { league_id?: string | null; season?: string | null },
  hintLeagueId: string,
  hintSeason: string,
): { leagueId: string; season: string; mismatched: boolean } {
  const leagueId = draft.league_id || hintLeagueId;
  const season = draft.season || hintSeason;
  const mismatched = Boolean(
    draft.league_id && hintLeagueId && draft.league_id !== hintLeagueId,
  );
  return { leagueId, season, mismatched };
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
    // Denied claims are the common case for a room that refreshes itself, and
    // most of them have nothing to report. Skip the read entirely when the caller
    // is already holding the exact snapshot the claim just looked at.
    const unchanged =
      params.knownLastSyncedAt !== undefined &&
      claim.lastSyncedAt !== null &&
      params.knownLastSyncedAt === claim.lastSyncedAt;
    const cache = unchanged ? null : await readDraftCache(admin, draftId);
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
    // FFB-SEC-002: identifier-independent per-IP budget for the Sleeper fan-out.
    // Checked after the per-draft claim was won, so cache hits and cooldown denials
    // (passive polling, which is what a room refreshing itself mostly produces)
    // never consume budget. Fails closed and releases the lock so the cooldown does
    // not advance on a denial.
    //
    // It sits ABOVE the getSleeperDraft below on purpose. A caller that omits the
    // league hint reaches this function with no draft object, and checking the
    // budget afterwards meant an exhausted network still spent one Sleeper request
    // per attempt: a script walking made-up draft ids won every claim (no row
    // exists yet), spent the lookup, and only then was refused. The budget has to
    // come before the first Sleeper call of the won claim, not before the rest.
    if (params.ipKey) {
      let withinBudget: boolean;
      try {
        withinBudget = await claimIpBudget(admin, params.ipKey);
      } catch {
        withinBudget = false;
      }
      if (!withinBudget) {
        await releaseSync(admin, draftId);
        return cacheOutcome(
          admin,
          draftId,
          "rate-limited",
          IP_BUDGET_WINDOW_SECONDS,
          "Too many draft lookups from your network. Try again in a minute.",
        );
      }
    }

    if (!draftObj) draftObj = await getSleeperDraft(draftId);
    if (!draftObj) {
      await releaseSync(admin, draftId);
      return cacheOutcome(admin, draftId, "error", 0, "Could not reach Sleeper. Try again shortly.");
    }

    // FFB-SEC-003: the Sleeper draft object is the AUTHORITATIVE league binding. Any
    // client-supplied league_id/season are hints only; a mismatch is ignored in favor
    // of the draft's true league so a crafted request cannot poison the shared cache,
    // and every resync self-heals a previously poisoned row.
    const binding = resolveAuthoritativeBinding(draftObj, leagueId, season);
    if (binding.mismatched) {
      console.warn(
        `[on-the-clock] ignoring mismatched league_id hint for draft ${draftId} (authoritative league from draft object used)`,
      );
    }
    const authoritativeLeagueId = binding.leagueId;
    const authoritativeSeason = binding.season;

    // traded_picks is fetched alongside the rest; getSleeperTradedPicks returns []
    // on any failure, so a traded-picks outage degrades to "no traded picks"
    // (pick ownership falls back to the original draft order) without breaking the
    // sync. All league fetches use the AUTHORITATIVE league id, never the hint.
    // The LEAGUE object joins the fan-out because scoring_settings and
    // roster_positions are what every points-based feature scores through (Draft
    // Pulse, the marginal starting-lineup engine, draft grades). It is one extra
    // request inside the existing per-draft cooldown and IP budget, and it
    // returns null on failure, in which case we keep whatever league_metadata is
    // already stored rather than blanking a good row with an empty object.
    //
    // The picks fetch keeps its null: `[]` means Sleeper answered and the draft
    // has no picks, `null` means the request failed and we know nothing. They
    // are not the same thing, and the reverted-pick cleanup below deletes on the
    // strength of that answer.
    const [fetchedPicks, users, rosters, tradedPicks, league] = await Promise.all([
      getSleeperDraftPicksOrNull(draftId),
      getSleeperLeagueUsers(authoritativeLeagueId),
      getSleeperRosters(authoritativeLeagueId),
      getSleeperTradedPicks(authoritativeLeagueId),
      getSleeperLeague(authoritativeLeagueId),
    ]);
    // No picks, no sync. Everything below writes on the strength of this answer:
    // pick_count, the pick rows themselves, and the reverted-pick cleanup that
    // deletes anything above the highest pick number in it. A throttled or 5xx
    // response used to arrive here as an empty array and take all three of those
    // with it, wiping the cached board and pinning it empty for the whole
    // cooldown. Failing the sync outright releases the lock WITHOUT advancing
    // the cooldown, so the next attempt can retry immediately.
    if (fetchedPicks === null) {
      throw new Error(`sleeper picks fetch failed for draft ${draftId}`);
    }
    const picks = fetchedPicks;

    // Resolve every drafted player's id once, here.
    const sleeperPlayerIds = picks
      .map((p) => p.player_id)
      .filter((id): id is string => validPlayerId(id));
    const idMap = await mapSleeperToPlayerIds(admin, sleeperPlayerIds);

    const leagueUsersJson = users.map((u) => ({
      user_id: u.user_id,
      display_name: u.display_name ?? null,
      username: u.username ?? null,
      team_name:
        typeof u.metadata?.team_name === "string" && u.metadata.team_name.trim() !== ""
          ? u.metadata.team_name
          : null,
      avatar: u.avatar ?? null,
    }));
    const rostersJson = rosters.map((r) => ({
      roster_id: r.roster_id,
      owner_id: r.owner_id ?? null,
      co_owners: Array.isArray(r.co_owners) ? r.co_owners : [],
      players: (r.players ?? []).filter(validPlayerId),
    }));

    // How many picks the ledger has already seen for this draft, read BEFORE the
    // cache row below overwrites it. A single-column primary-key lookup, and it
    // is what lets the ledger write only the new picks instead of the whole
    // array on every poll of a live draft.
    const { data: priorCache } = await admin
      .from("on_the_clock_draft_cache")
      .select("pick_count")
      .eq("sleeper_draft_id", draftId)
      .maybeSingle();
    const existingPickCount = priorCache?.pick_count ?? 0;

    const { error: draftErr } = await admin.from("on_the_clock_draft_cache").upsert(
      {
        sleeper_draft_id: draftId,
        sleeper_league_id: authoritativeLeagueId,
        season: authoritativeSeason,
        draft_status: draftObj.status ?? null,
        draft_type: draftObj.type ?? null,
        pick_count: picks.length,
        metadata: draftObj as unknown as Json,
        league_users: leagueUsersJson as unknown as Json,
        rosters: rostersJson as unknown as Json,
        traded_picks: tradedPicks as unknown as Json,
        // Only overwrite league_metadata when Sleeper actually answered. A failed
        // league fetch must not blank a previously captured scoring map, which
        // would silently switch every points-based feature into its degraded
        // path until the next successful sync.
        ...(league ? { league_metadata: league as unknown as Json } : {}),
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

    // A commissioner can REVERT picks, and Sleeper simply stops returning them.
    // Upserting alone never removes a row, so a reverted pick stayed on the board
    // forever, kept its player off the available list, and kept counting toward
    // a roster. Sleeper always returns picks 1..N with no gaps, so anything above
    // the highest pick in this payload no longer exists.
    //
    // Safe to delete on: a failed fetch never reaches this line (see the guard
    // above), so an empty payload here really does mean an empty draft, which is
    // what a reset draft looks like.
    const highestPickNo = picks.reduce((max, p) => Math.max(max, Number(p.pick_no) || 0), 0);
    const { error: staleErr } = await admin
      .from("on_the_clock_pick_cache")
      .delete()
      .eq("sleeper_draft_id", draftId)
      .gt("pick_no", highestPickNo);
    // Never fail a good sync over the cleanup: the picks that DO exist are
    // already correct, and the next sync retries this.
    if (staleErr) {
      console.error("[on-the-clock/sync] reverted-pick cleanup failed", staleErr.message);
    }

    // The durable ledger (draft_selections). Every pick this room sees is also a
    // data point for the Beacon Steals market model, and the live cache above is
    // the wrong place to keep it: its rows are DELETED on a commissioner revert,
    // and the draft context lives in a different table.
    //
    // Fully non-fatal and awaited AFTER the cache is consistent. A live draft
    // must never fail because an analytics write did. The id map is handed over
    // rather than re-resolved, so this costs no extra player lookup.
    try {
      // Only the picks that are NEW since the last sync. A live room polls every
      // few seconds, and re-upserting the whole array each time meant a two-hour
      // draft wrote on the order of 130,000 rows to persist 180 real picks, each
      // carrying a raw Sleeper object in metadata, with the index churn and dead
      // tuples that implies. `pickCount` is what the previous completeSync
      // stored, so anything above it is genuinely new. A commissioner revert
      // lowers the count, which makes the next sync re-send the tail and heal it.
      const alreadyRecorded = Number(existingPickCount ?? 0);
      const newPicks =
        alreadyRecorded > 0 ? picks.filter((p) => Number(p.pick_no) > alreadyRecorded) : picks;

      // Both of these are effectively static (13 format rows and one source row)
      // and the result is discarded when the league object failed to load, so
      // they are skipped entirely rather than run on every poll.
      const candidates =
        league && newPicks.length > 0 ? await ffbeaconFormatCandidates(admin) : [];
      const detected = league && candidates.length > 0 ? detectLeagueFormat(league, candidates) : null;
      const rounds = Number(draftObj.settings?.rounds ?? 0);
      const teams = Number(draftObj.settings?.teams ?? 0);
      const seasonNum = Number(authoritativeSeason);
      if (newPicks.length > 0 && Number.isFinite(seasonNum) && seasonNum > 0) {
        await recordDraftSelections(
          admin,
          newPicks,
          {
            sleeperDraftId: draftId,
            sleeperLeagueId: authoritativeLeagueId,
            season: seasonNum,
            draftType: draftObj.type ?? null,
            draftStatus: draftObj.status ?? null,
            // Null when the league object failed to load this time. The next
            // successful sync upserts the same rows with a real format, so the
            // gap self-heals rather than sticking.
            formatSlug: detected?.slug ?? null,
            playerPool: detected ? inferPlayerPool({ formatSlug: detected.slug, rounds }) : null,
            teams: Number.isFinite(teams) && teams > 0 ? teams : null,
            rounds: Number.isFinite(rounds) && rounds > 0 ? rounds : null,
            draftedAt: epochMsToIso(draftObj.start_time),
            ingestSource: "on_the_clock",
          },
          { playerIdBySleeperId: idMap },
        );
      }
    } catch (ledgerErr) {
      console.error("[on-the-clock/sync] draft-selections ledger write failed", ledgerErr);
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
