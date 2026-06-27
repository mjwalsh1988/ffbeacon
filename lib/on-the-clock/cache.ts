/**
 * Read + shape the On The Clock Supabase cache, and thin typed wrappers around
 * the sync-lock RPCs.
 *
 * Two responsibilities:
 *   1. RPC wrappers (claimSync / completeSync / releaseSync / claimLookup) - these
 *      call the SECURITY DEFINER functions and MUST be invoked with the
 *      service-role admin client (the RPCs are service-role-only EXECUTE).
 *   2. readDraftCache - reads the draft + pick cache rows and shapes them to the
 *      whitelisted wire payload (ShapedDraftCache). This can use any client; the
 *      cache tables are public-read.
 *
 * No Sleeper calls happen here. This module only touches Supabase.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type {
  ShapedDraftCache,
  ShapedDraftMeta,
  ShapedLeagueUser,
  ShapedPick,
  ShapedRoster,
  ShapedTradedPick,
} from "./types";

type Client = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// RPC wrappers (service-role admin client only)
// ---------------------------------------------------------------------------

export interface ClaimSyncResult {
  claimed: boolean;
  lastSyncedAt: string | null;
  cooldownRemainingSeconds: number;
  lockedByOther: boolean;
}

/** Attempt to win the per-draft sync slot. Throws on RPC failure. */
export async function claimSync(
  admin: Client,
  params: {
    draftId: string;
    leagueId: string;
    season: string;
    cooldownSeconds: number;
    lockSeconds: number;
  },
): Promise<ClaimSyncResult> {
  const { data, error } = await admin.rpc("claim_on_the_clock_sync", {
    p_draft_id: params.draftId,
    p_league_id: params.leagueId,
    p_season: params.season,
    p_cooldown_seconds: params.cooldownSeconds,
    p_lock_seconds: params.lockSeconds,
  });
  if (error) throw new Error(`claim_on_the_clock_sync failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    claimed: Boolean(row?.claimed),
    lastSyncedAt: row?.last_synced_at ?? null,
    cooldownRemainingSeconds: Number(row?.cooldown_remaining_seconds ?? 0),
    lockedByOther: Boolean(row?.locked_by_other),
  };
}

/** Mark a successful sync: advances last_synced_at, clears the lock. */
export async function completeSync(
  admin: Client,
  params: { draftId: string; pickCount: number; status: string | null },
): Promise<void> {
  const { error } = await admin.rpc("complete_on_the_clock_sync", {
    p_draft_id: params.draftId,
    p_pick_count: params.pickCount,
    // The RPC arg has a SQL default (text default null), so the generated type is
    // optional (string | undefined); pass undefined rather than null when absent.
    p_status: params.status ?? undefined,
  });
  if (error) throw new Error(`complete_on_the_clock_sync failed: ${error.message}`);
}

/** Clear the in-progress lock after a Sleeper failure (no cooldown advance). */
export async function releaseSync(admin: Client, draftId: string): Promise<void> {
  const { error } = await admin.rpc("release_on_the_clock_sync", { p_draft_id: draftId });
  if (error) throw new Error(`release_on_the_clock_sync failed: ${error.message}`);
}

/** Durable per-(ip, username) throttle for the leagues lookup route. */
export async function claimLookup(
  admin: Client,
  params: { ip: string; username: string; windowSeconds: number },
): Promise<boolean> {
  const { data, error } = await admin.rpc("try_claim_on_the_clock_lookup", {
    p_ip: params.ip,
    p_username: params.username,
    p_window_seconds: params.windowSeconds,
  });
  if (error) throw new Error(`try_claim_on_the_clock_lookup failed: ${error.message}`);
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// Cache read + shaping (any client; cache tables are public-read)
// ---------------------------------------------------------------------------

type DraftRow = Database["public"]["Tables"]["on_the_clock_draft_cache"]["Row"];
type PickRow = Database["public"]["Tables"]["on_the_clock_pick_cache"]["Row"];

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
}

function shapeMeta(row: DraftRow): ShapedDraftMeta {
  const meta = asObject(row.metadata);
  const slotRaw = asObject(meta.slot_to_roster_id);
  const slotToRosterId: Record<string, number> = {};
  for (const [slot, rosterId] of Object.entries(slotRaw)) {
    const n = Number(rosterId);
    if (Number.isFinite(n)) slotToRosterId[slot] = n;
  }
  const settingsRaw = asObject(meta.settings);
  const settings: Record<string, number> = {};
  for (const [k, v] of Object.entries(settingsRaw)) {
    const n = Number(v);
    if (Number.isFinite(n)) settings[k] = n;
  }
  return {
    sleeperDraftId: row.sleeper_draft_id,
    sleeperLeagueId: row.sleeper_league_id,
    season: row.season,
    draftStatus: row.draft_status,
    draftType: row.draft_type,
    pickCount: row.pick_count,
    slotToRosterId,
    settings,
    lastSyncedAt: row.last_synced_at,
  };
}

function shapeUsers(row: DraftRow): ShapedLeagueUser[] {
  return asArray(row.league_users).map((u) => {
    const o = asObject(u);
    return {
      userId: readString(o, "user_id") ?? "",
      displayName: readString(o, "display_name"),
      username: readString(o, "username"),
      teamName: readString(o, "team_name"),
      avatar: readString(o, "avatar"),
    };
  });
}

function shapeRosters(row: DraftRow): ShapedRoster[] {
  return asArray(row.rosters).map((r) => {
    const o = asObject(r);
    const coOwners = asArray(o.co_owners)
      .map((c) => (typeof c === "string" ? c : null))
      .filter((c): c is string => c !== null);
    const players = asArray(o.players)
      .map((p) => (typeof p === "string" ? p : typeof p === "number" ? String(p) : null))
      .filter((p): p is string => p !== null);
    const rosterId = Number(o.roster_id);
    return {
      rosterId: Number.isFinite(rosterId) ? rosterId : -1,
      ownerId: readString(o, "owner_id"),
      coOwners,
      players,
    };
  });
}

/**
 * Shape one raw pick-cache row into the whitelisted wire pick. Exported so the
 * client Realtime handler can reuse the SAME shaping for a `payload.new` row (the
 * Postgres Changes payload carries the full row with identical column names and
 * types), keeping the read path and the live path byte-for-byte consistent.
 */
export function shapePickRow(row: PickRow): ShapedPick {
  const meta = asObject(row.metadata);
  return {
    pickNo: row.pick_no,
    round: row.round,
    draftSlot: row.draft_slot,
    rosterId: row.roster_id,
    pickedBy: row.picked_by,
    sleeperPlayerId: row.sleeper_player_id,
    playerId: row.player_id,
    isKeeper: row.is_keeper,
    firstName: readString(meta, "first_name"),
    lastName: readString(meta, "last_name"),
    position: readString(meta, "position"),
    team: readString(meta, "team"),
  };
}

/**
 * Shape the cached traded_picks jsonb (raw Sleeper /traded_picks rows) into the
 * whitelisted wire shape. Keeps snake_case keys (matches the pick-ownership
 * normalizer) and drops rows missing the fields ownership resolution needs.
 */
function shapeTradedPicks(row: DraftRow): ShapedTradedPick[] {
  return asArray(row.traded_picks).flatMap((t) => {
    const o = asObject(t);
    const round = Number(o.round);
    const rosterId = Number(o.roster_id);
    const ownerId = Number(o.owner_id);
    const season = readString(o, "season");
    if (!Number.isFinite(round) || !Number.isFinite(rosterId) || !Number.isFinite(ownerId) || season === null) {
      return [];
    }
    const prev = Number(o.previous_owner_id);
    return [
      {
        season,
        round,
        roster_id: rosterId,
        owner_id: ownerId,
        previous_owner_id: Number.isFinite(prev) ? prev : null,
      },
    ];
  });
}

/** Build the full shaped payload from one draft row and its pick rows. */
export function shapeDraftCache(draftRow: DraftRow, pickRows: PickRow[]): ShapedDraftCache {
  return {
    draft: shapeMeta(draftRow),
    users: shapeUsers(draftRow),
    rosters: shapeRosters(draftRow),
    picks: pickRows.map(shapePickRow),
    tradedPicks: shapeTradedPicks(draftRow),
  };
}

/**
 * Read the cache for a draft and shape it. Returns null when no draft row exists
 * (a cold cache). Picks are ordered by pick_no. No Sleeper call.
 */
export async function readDraftCache(client: Client, draftId: string): Promise<ShapedDraftCache | null> {
  const { data: draftRow, error } = await client
    .from("on_the_clock_draft_cache")
    .select("*")
    .eq("sleeper_draft_id", draftId)
    .maybeSingle();
  if (error || !draftRow) return null;

  const { data: pickRows } = await client
    .from("on_the_clock_pick_cache")
    .select("*")
    .eq("sleeper_draft_id", draftId)
    .order("pick_no", { ascending: true });

  return shapeDraftCache(draftRow, pickRows ?? []);
}
