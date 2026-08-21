/**
 * Read + shape the On The Clock Supabase cache, and thin typed wrappers around
 * the sync-lock RPCs.
 *
 * Two responsibilities:
 *   1. RPC wrappers (claimSync / completeSync / releaseSync / claimLookup) - these
 *      call the SECURITY DEFINER functions and MUST be invoked with the
 *      service-role admin client (the RPCs are service-role-only EXECUTE).
 *   2. readDraftCache - SERVICE ROLE ONLY. Migration 0184 revoked the
 *      table-level SELECT grant on on_the_clock_draft_cache and re-granted
 *      fourteen columns by name (league_metadata carries Sleeper's league chat
 *      tail), so this function's `select("*")` fails for anon and authenticated.
 *      Every caller passes createAdminClient today. It reads the draft + pick
 *      cache rows and shapes them to the whitelisted wire payload
 *      (ShapedDraftCache).
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

/**
 * Identifier-independent per-IP budget for On The Clock Sleeper fan-outs (FFB-SEC-002).
 * Bounds the TOTAL expensive Sleeper work one source can trigger per window, regardless
 * of which league/draft id is requested, so a rotating-id script cannot amplify. Tuned
 * generously so ordinary draft-room usage and shared NAT / office / carrier / VPN IPs
 * are unaffected; only high-volume rotation trips it. Enforced in front of every Sleeper
 * fan-out. The RPC name is not yet in the generated DB types (migration 0135), so it is
 * cast, matching the house pattern for freshly added RPCs.
 */
export const IP_BUDGET_WINDOW_SECONDS = 60;
export const IP_BUDGET_MAX_REQUESTS = 40;

export async function claimIpBudget(
  admin: Client,
  ipKey: string,
  opts?: { maxRequests?: number; windowSeconds?: number },
): Promise<boolean> {
  const { data, error } = await admin.rpc(
    "try_claim_on_the_clock_ip_budget" as never,
    {
      p_ip_key: ipKey,
      p_max_requests: opts?.maxRequests ?? IP_BUDGET_MAX_REQUESTS,
      p_window_seconds: opts?.windowSeconds ?? IP_BUDGET_WINDOW_SECONDS,
    } as never,
  );
  if (error) throw new Error(`try_claim_on_the_clock_ip_budget failed: ${error.message}`);
  return Boolean(data);
}

/**
 * Budget for the Draft Pulse route, which burns CPU rather than Sleeper calls:
 * up to 160 candidates each rebuilt across every remaining week. It gets its own
 * key prefix and a far more generous ceiling than the Sleeper fan-out budget,
 * because a real draft room legitimately refetches on every pick from several
 * tabs at once, and two requests a second sustained is well past anything a
 * human draft produces while still capping what a script can burn.
 */
export const PULSE_BUDGET_MAX_REQUESTS = 120;
export const PULSE_BUDGET_WINDOW_SECONDS = 60;

export function claimPulseBudget(admin: Client, ip: string): Promise<boolean> {
  return claimIpBudget(admin, `pulse:${ip}`, {
    maxRequests: PULSE_BUDGET_MAX_REQUESTS,
    windowSeconds: PULSE_BUDGET_WINDOW_SECONDS,
  });
}

/**
 * Request-count ceiling for the draft sync route, separate from the Sleeper
 * fan-out budget above.
 *
 * The fan-out budget is spent only by a claim that WINS, which is what keeps a
 * dozen tabs on one draft from each being charged for the single fetch they
 * share. It therefore says nothing about the losing requests, and an open room
 * that refreshes itself on a timer makes those the ordinary case. A losing
 * request is not free: it costs a settings read, a claim, and a full read of the
 * draft and its picks whenever the caller does not already hold that snapshot.
 *
 * The ceiling is set well past anything a person produces. One viewer costs about
 * two requests a minute, so 300 covers a hundred and fifty rooms behind a single
 * office, carrier or VPN address before it bites.
 */
export const SYNC_REQUEST_BUDGET_MAX_REQUESTS = 300;
export const SYNC_REQUEST_BUDGET_WINDOW_SECONDS = 60;

export function claimSyncRequestBudget(admin: Client, ip: string): Promise<boolean> {
  return claimIpBudget(admin, `sync:${ip}`, {
    maxRequests: SYNC_REQUEST_BUDGET_MAX_REQUESTS,
    windowSeconds: SYNC_REQUEST_BUDGET_WINDOW_SECONDS,
  });
}

// ---------------------------------------------------------------------------
// Cache read + shaping (any client; cache tables are public-read)
// ---------------------------------------------------------------------------

/** Supabase's silent row cap. Reads that can exceed it page explicitly. */
const PICK_PAGE = 1000;

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

/** Coerce a raw jsonb map to a number map, dropping non-numeric entries. */
function numberMap(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function shapeMeta(row: DraftRow): ShapedDraftMeta {
  const meta = asObject(row.metadata);
  // The raw Sleeper LEAGUE object (migration 0180). Absent on rows written
  // before that migration, or when the league fetch failed during a sync; every
  // consumer treats an empty scoring map / roster_positions as "unknown" and
  // degrades rather than substituting a default league shape.
  const league = asObject(row.league_metadata);
  const leagueSettings = asObject(league.settings);
  const playoffTeams = Number(leagueSettings.playoff_teams);
  const playoffWeekStart = Number(leagueSettings.playoff_week_start);
  const rosterPositions = asArray(league.roster_positions)
    .map((p) => (typeof p === "string" ? p : null))
    .filter((p): p is string => p !== null);
  const slotRaw = asObject(meta.slot_to_roster_id);
  const slotToRosterId: Record<string, number> = {};
  for (const [slot, rosterId] of Object.entries(slotRaw)) {
    const n = Number(rosterId);
    if (Number.isFinite(n)) slotToRosterId[slot] = n;
  }
  const settings = numberMap(asObject(meta.settings));
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
    scoringSettings: numberMap(asObject(league.scoring_settings)),
    rosterPositions,
    playoffTeams: Number.isFinite(playoffTeams) ? playoffTeams : null,
    playoffWeekStart: Number.isFinite(playoffWeekStart) ? playoffWeekStart : null,
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
 * The columns readDraftCache actually needs, with the four fields it reads out of
 * `metadata` projected in Postgres rather than shipped as the whole jsonb.
 *
 * Measured on the largest real draft: 408 picks at 190 KB a read, of which
 * 105 KB was metadata, to read four short strings out of it.
 *
 * The Realtime path CANNOT use this (Postgres Changes delivers the full row,
 * metadata and all), which is why shapePickRow below still exists and still
 * reads from the jsonb. Two shapers, one output type, and a test that pins them
 * to the same answer.
 */
export const PICK_COLUMNS =
  "pick_no, round, draft_slot, roster_id, picked_by, sleeper_player_id, player_id, is_keeper, " +
  "first_name:metadata->>first_name, last_name:metadata->>last_name, " +
  "position:metadata->>position, team:metadata->>team";

export interface ProjectedPickRow {
  pick_no: number;
  round: number | null;
  draft_slot: number | null;
  roster_id: number | null;
  picked_by: string | null;
  sleeper_player_id: string | null;
  player_id: string | null;
  is_keeper: boolean;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  team: string | null;
}

/** The projected row, shaped into the same wire pick shapePickRow produces. */
export function shapeProjectedPickRow(row: ProjectedPickRow): ShapedPick {
  return {
    pickNo: row.pick_no,
    round: row.round,
    draftSlot: row.draft_slot,
    rosterId: row.roster_id,
    pickedBy: row.picked_by,
    sleeperPlayerId: row.sleeper_player_id,
    playerId: row.player_id,
    isKeeper: row.is_keeper,
    // Straight through, deliberately. `metadata->>key` gives the same answer
    // readString does for every case these four fields actually take: absent and
    // JSON null both arrive as SQL NULL, a number arrives as its text, and an
    // empty string stays an empty string. Normalizing "" to null HERE and not in
    // the Realtime path would be a drift, which is exactly what this shaper
    // exists to avoid.
    firstName: row.first_name,
    lastName: row.last_name,
    position: row.position,
    team: row.team,
  };
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

  // Paged explicitly. A select() silently truncates at 1000 rows, and a deep
  // draft (32 teams, 32 rounds) runs past that. A truncated pick list would not
  // just hide picks: it would also understate the highest pick number, which is
  // the Draft Pulse cache key, so a stale pulse would look fresh.
  const picks: ShapedPick[] = [];
  for (let from = 0; ; from += PICK_PAGE) {
    const { data, error: pickErr } = await client
      .from("on_the_clock_pick_cache")
      .select(PICK_COLUMNS)
      .eq("sleeper_draft_id", draftId)
      .order("pick_no", { ascending: true })
      .range(from, from + PICK_PAGE - 1)
      .overrideTypes<ProjectedPickRow[]>();
    // Throw rather than return a draft with no picks. A named-column select can
    // fail in ways `select("*")` could not (a renamed column, a missing grant),
    // and swallowing the error here would hand every caller a perfectly
    // well-formed cache reporting an empty board: the same silent-empty class of
    // bug as treating a failed Sleeper fetch as zero picks.
    if (pickErr) throw new Error(`otc pick cache read failed: ${pickErr.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) picks.push(shapeProjectedPickRow(row));
    if (data.length < PICK_PAGE) break;
  }

  return {
    draft: shapeMeta(draftRow),
    users: shapeUsers(draftRow),
    rosters: shapeRosters(draftRow),
    picks,
    tradedPicks: shapeTradedPicks(draftRow),
  };
}
