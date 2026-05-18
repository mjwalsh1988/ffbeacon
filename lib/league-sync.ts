import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAllSleeperTransactions,
  getSleeperDraft,
  getSleeperLeague,
  getSleeperLeagueDrafts,
  getSleeperLeagueUsers,
  getSleeperRosters,
  getSleeperTradedPicks,
  type SleeperDraft,
  type SleeperLeague,
  type SleeperRoster,
  type SleeperLeagueUser,
  type SleeperTransaction,
  type SleeperTradedPick,
} from "@/lib/sleeper";
import { deriveFormatSlug } from "@/lib/sleeper-to-format";
import { calculateLeaguePowerRankings } from "@/lib/league-power-rankings";
import type { Database } from "@/lib/database.types";

export const LEAGUE_SYNC_TTL_MS = 10 * 60 * 1000; // 10 minutes

export type LeagueSyncResult =
  | {
      ok: true;
      leagueRowId: string;
      sleeperLeagueId: string;
      cached: boolean;
      counts: { rosters: number; users: number; transactions: number };
    }
  | { ok: false; error: string; sleeperLeagueId: string };

type ServiceClient = SupabaseClient<Database>;

/**
 * Sync one Sleeper league end-to-end. Idempotent — re-running upserts every
 * table by its natural key. Returns the leagues.id (uuid) on success.
 *
 * Cache: refuses to refetch from Sleeper if last_synced_at is within
 * LEAGUE_SYNC_TTL_MS, unless force=true. The cached path still returns ok.
 *
 * Caller supplies the service-role supabase client (scripts use
 * scripts/_supabase.ts getServiceClient(); the server action uses
 * lib/supabase/server.ts createAdminClient()).
 */
export async function syncLeague(
  supabase: ServiceClient,
  sleeperLeagueId: string,
  options: { force?: boolean } = {},
): Promise<LeagueSyncResult> {
  const { force = false } = options;

  // Cache check
  const { data: existing } = await supabase
    .from("leagues")
    .select("id, last_synced_at, sync_status")
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();

  if (
    !force &&
    existing &&
    existing.last_synced_at &&
    existing.sync_status === "complete" &&
    Date.now() - new Date(existing.last_synced_at).getTime() < LEAGUE_SYNC_TTL_MS
  ) {
    const [{ count: rosterCount }, { count: userCount }, { count: txCount }] = await Promise.all([
      supabase.from("rosters").select("id", { count: "exact", head: true }).eq("league_id", existing.id),
      supabase.from("league_users").select("id", { count: "exact", head: true }).eq("league_id", existing.id),
      supabase
        .from("league_transactions")
        .select("id", { count: "exact", head: true })
        .eq("league_id", existing.id),
    ]);
    return {
      ok: true,
      leagueRowId: existing.id,
      sleeperLeagueId,
      cached: true,
      counts: {
        rosters: rosterCount ?? 0,
        users: userCount ?? 0,
        transactions: txCount ?? 0,
      },
    };
  }

  // Mark syncing
  if (existing) {
    await supabase
      .from("leagues")
      .update({ sync_status: "syncing", sync_error: null, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  }

  const league = await getSleeperLeague(sleeperLeagueId);
  if (!league) {
    if (existing) {
      await supabase
        .from("leagues")
        .update({
          sync_status: "error",
          sync_error: "Sleeper league fetch returned null",
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    }
    return { ok: false, error: "Sleeper league not found", sleeperLeagueId };
  }

  const formatSlug = deriveFormatSlug(league);
  let formatConfigId: string | null = null;
  if (formatSlug) {
    const { data: fc } = await supabase
      .from("format_configs")
      .select("id")
      .eq("slug", formatSlug)
      .maybeSingle();
    formatConfigId = fc?.id ?? null;
  }

  const leagueRow = {
    sleeper_league_id: league.league_id,
    name: league.name,
    season: Number(league.season),
    sport: league.sport ?? "nfl",
    status: league.status ?? null,
    total_rosters: league.total_rosters ?? null,
    scoring_settings: (league.scoring_settings ?? {}) as Database["public"]["Tables"]["leagues"]["Insert"]["scoring_settings"],
    roster_positions: (league.roster_positions ?? []) as Database["public"]["Tables"]["leagues"]["Insert"]["roster_positions"],
    format_config_id: formatConfigId,
    metadata: league as unknown as Database["public"]["Tables"]["leagues"]["Insert"]["metadata"],
    last_synced_at: new Date().toISOString(),
    sync_status: "complete" as const,
    sync_error: null,
    updated_at: new Date().toISOString(),
  };

  const { data: upserted, error: upsertErr } = await supabase
    .from("leagues")
    .upsert(leagueRow, { onConflict: "sleeper_league_id" })
    .select("id")
    .single();

  if (upsertErr || !upserted) {
    return {
      ok: false,
      error: `Failed to upsert league: ${upsertErr?.message ?? "unknown"}`,
      sleeperLeagueId,
    };
  }
  const leagueRowId = upserted.id;

  // Fetch children in parallel — independent endpoints
  const [rosters, users, transactions, tradedPicks, draftSummaries] = await Promise.all([
    getSleeperRosters(sleeperLeagueId),
    getSleeperLeagueUsers(sleeperLeagueId),
    getAllSleeperTransactions(sleeperLeagueId),
    getSleeperTradedPicks(sleeperLeagueId),
    getSleeperLeagueDrafts(sleeperLeagueId),
  ]);

  // Fan out one /draft/{id} fetch per league draft. Sleeper's /league/{id}/drafts
  // summary does NOT include `slot_to_roster_id` — that lives on the per-draft
  // endpoint. We need it to render slot labels like "1.04" on rosters and trades.
  const draftDetails = (
    await Promise.all(
      (draftSummaries ?? [])
        .filter((d): d is SleeperDraft => !!d?.draft_id)
        .map(async (d) => {
          const detail = await getSleeperDraft(d.draft_id);
          return detail ?? d;
        }),
    )
  ).filter((d): d is SleeperDraft => !!d?.draft_id);

  await Promise.all([
    upsertRosters(supabase, leagueRowId, rosters, tradedPicks, draftDetails),
    upsertLeagueUsers(supabase, leagueRowId, users),
    upsertTransactions(supabase, leagueRowId, transactions, Number(league.season)),
    upsertLeagueDrafts(supabase, leagueRowId, draftDetails),
  ]);

  // Recalculate power rankings for this league. A failure here does not
  // fail the sync; the cache row is non-critical and can be backfilled by
  // npm run calculate:power-rankings.
  try {
    const calcResult = await calculateLeaguePowerRankings(supabase, leagueRowId);
    if (!calcResult.ok) {
      console.warn(
        `[syncLeague] power-rankings calc failed for league ${leagueRowId}: ${calcResult.error}`,
      );
    }
  } catch (err) {
    console.warn(
      `[syncLeague] power-rankings calc threw for league ${leagueRowId}:`,
      (err as Error).message,
    );
  }

  return {
    ok: true,
    leagueRowId,
    sleeperLeagueId,
    cached: false,
    counts: {
      rosters: rosters.length,
      users: users.length,
      transactions: transactions.length,
    },
  };
}

async function upsertRosters(
  supabase: ServiceClient,
  leagueRowId: string,
  rosters: SleeperRoster[],
  tradedPicks: SleeperTradedPick[],
  draftDetails: SleeperDraft[],
): Promise<void> {
  if (rosters.length === 0) return;

  // Build a map of current pick ownership by (season, round, original_roster_id).
  // Sleeper's /traded_picks returns the CURRENT state per traded pick (one row
  // per pick, not one per hop). The `roster_id` field is the IMMUTABLE original
  // owner. Index baseline by original_roster_id, and update only by that key —
  // using `previous_owner_id` would mis-attribute multi-hop trades (A→B→C would
  // leave the pick on A's roster AND add a phantom entry on B's roster).
  const baselinePicks = buildBaselinePicks(rosters);
  for (const traded of tradedPicks) {
    const key = pickKey(Number(traded.season), traded.round, traded.roster_id);
    baselinePicks.set(key, {
      season: Number(traded.season),
      round: traded.round,
      original_roster_id: traded.roster_id,
      current_roster_id: traded.owner_id,
    });
  }

  // Build season → rosterId → slot map from each season's draft detail so we
  // can stamp `pick_label` (e.g. "1.04") onto picks for completed/scheduled drafts.
  const rosterSlotBySeason = buildRosterSlotMap(draftDetails);

  const picksByOwner = new Map<number, PickAsset[]>();
  for (const pick of baselinePicks.values()) {
    const slot = rosterSlotBySeason.get(pick.season)?.get(pick.original_roster_id) ?? null;
    const pickLabel = slot != null ? `${pick.round}.${String(slot).padStart(2, "0")}` : null;
    const arr = picksByOwner.get(pick.current_roster_id) ?? [];
    arr.push({ ...pick, slot, pick_label: pickLabel });
    picksByOwner.set(pick.current_roster_id, arr);
  }

  const rows = rosters.map((r) => {
    const sleeperPlayers = (r.players ?? []).filter(validPlayerId);
    const sleeperStarters = (r.starters ?? []).filter(validPlayerId);
    const sleeperReserve = (r.reserve ?? []).filter(validPlayerId);
    const sleeperTaxi = (r.taxi ?? []).filter(validPlayerId);
    const settings = r.settings ?? {};
    return {
      league_id: leagueRowId,
      sleeper_roster_id: r.roster_id,
      owner_user_id: r.owner_id,
      co_owners: (r.co_owners ?? []) as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["co_owners"],
      player_ids: sleeperPlayers as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["player_ids"],
      starter_ids: sleeperStarters as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["starter_ids"],
      reserve_ids: sleeperReserve as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["reserve_ids"],
      taxi_ids: sleeperTaxi as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["taxi_ids"],
      draft_pick_assets: (picksByOwner.get(r.roster_id) ?? []) as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["draft_pick_assets"],
      wins: Number(settings.wins ?? 0),
      losses: Number(settings.losses ?? 0),
      ties: Number(settings.ties ?? 0),
      points_for: scaledPoints(settings.fpts, settings.fpts_decimal),
      points_against: scaledPoints(settings.fpts_against, settings.fpts_against_decimal),
      waiver_position: Number(settings.waiver_position ?? 0) || null,
      waiver_budget: Number(settings.waiver_budget_used ?? 0) || null,
      metadata: r as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["metadata"],
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase
    .from("rosters")
    .upsert(rows, { onConflict: "league_id,sleeper_roster_id" });
  if (error) throw new Error(`rosters upsert failed: ${error.message}`);
}

async function upsertLeagueUsers(
  supabase: ServiceClient,
  leagueRowId: string,
  users: SleeperLeagueUser[],
): Promise<void> {
  if (users.length === 0) return;
  const rows = users.map((u) => {
    const meta = (u.metadata ?? {}) as Record<string, unknown>;
    // Sleeper's `is_owner` on the /users response means "active league
    // member" (not a placeholder), which can include every co-owner of a
    // roster. It is NOT a reliable commissioner signal — overloading it as
    // such would grant force-resync to every co-owner. Until we have a
    // verified commissioner signal (league.metadata.commissioner_id, or
    // a service-role flip), default is_commissioner to false. Admins (via
    // user_preferences.is_admin) can still force resync.
    return {
      league_id: leagueRowId,
      sleeper_user_id: u.user_id,
      display_name: u.display_name ?? null,
      avatar: u.avatar ?? null,
      team_name: typeof meta.team_name === "string" ? (meta.team_name as string) : null,
      is_owner: Boolean(u.is_owner),
      is_commissioner: false,
      metadata: u as unknown as Database["public"]["Tables"]["league_users"]["Insert"]["metadata"],
      updated_at: new Date().toISOString(),
    };
  });
  const { error } = await supabase
    .from("league_users")
    .upsert(rows, { onConflict: "league_id,sleeper_user_id" });
  if (error) throw new Error(`league_users upsert failed: ${error.message}`);
}

async function upsertTransactions(
  supabase: ServiceClient,
  leagueRowId: string,
  transactions: SleeperTransaction[],
  season: number,
): Promise<void> {
  if (transactions.length === 0) return;
  const rows = transactions.map((t) => {
    const draftPicks = normalizeDraftPicks(t.draft_picks);
    const rosterIds = collectRosterIds(t.adds, t.drops, t.roster_ids, draftPicks);
    return {
      league_id: leagueRowId,
      sleeper_transaction_id: t.transaction_id,
      type: t.type,
      status: t.status ?? null,
      week: t.week ?? null,
      season,
      adds: (t.adds ?? {}) as unknown as Database["public"]["Tables"]["league_transactions"]["Insert"]["adds"],
      drops: (t.drops ?? {}) as unknown as Database["public"]["Tables"]["league_transactions"]["Insert"]["drops"],
      draft_picks: draftPicks as unknown as Database["public"]["Tables"]["league_transactions"]["Insert"]["draft_picks"],
      waiver_budget: (Array.isArray(t.waiver_budget) ? t.waiver_budget : []) as unknown as Database["public"]["Tables"]["league_transactions"]["Insert"]["waiver_budget"],
      roster_ids: rosterIds as unknown as Database["public"]["Tables"]["league_transactions"]["Insert"]["roster_ids"],
      created_at_sleeper: t.created ? new Date(t.created).toISOString() : null,
      metadata: t as unknown as Database["public"]["Tables"]["league_transactions"]["Insert"]["metadata"],
    };
  });

  // Chunk in case of giant transaction histories
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    const { error } = await supabase
      .from("league_transactions")
      .upsert(slice, { onConflict: "league_id,sleeper_transaction_id" });
    if (error) throw new Error(`league_transactions upsert failed: ${error.message}`);
  }
}

// ---------- helpers ----------

type PickAsset = {
  season: number;
  round: number;
  original_roster_id: number;
  current_roster_id: number;
  /** Draft slot (1..N) that this pick maps to. Null until the season's
   * draft is scheduled and `slot_to_roster_id` is published. */
  slot?: number | null;
  /** Pre-formatted "R.SS" label (e.g. "1.04"). Null when slot is unknown. */
  pick_label?: string | null;
};

function pickKey(season: number, round: number, originalRosterId: number): string {
  return `${season}:${round}:${originalRosterId}`;
}

/**
 * Index draft details by season → originalRosterId → slot. Sleeper's
 * `slot_to_roster_id` maps slot number → roster_id; we invert it so the
 * read path can look up a slot from the pick's original owner.
 */
function buildRosterSlotMap(
  details: SleeperDraft[],
): Map<number, Map<number, number>> {
  const out = new Map<number, Map<number, number>>();
  for (const d of details) {
    const season =
      typeof d.season === "string" ? parseInt(d.season, 10) : Number(d.season);
    if (!Number.isFinite(season)) continue;
    const mapping = d.slot_to_roster_id;
    if (!mapping || typeof mapping !== "object") continue;
    const rosterToSlot = new Map<number, number>();
    for (const [slotStr, rosterId] of Object.entries(mapping)) {
      const slot = parseInt(slotStr, 10);
      const rid = Number(rosterId);
      if (!Number.isFinite(slot) || !Number.isFinite(rid)) continue;
      rosterToSlot.set(rid, slot);
    }
    if (rosterToSlot.size > 0) out.set(season, rosterToSlot);
  }
  return out;
}

async function upsertLeagueDrafts(
  supabase: ServiceClient,
  leagueRowId: string,
  drafts: SleeperDraft[],
): Promise<void> {
  if (drafts.length === 0) return;
  const rows = drafts
    .map((d) => {
      const season =
        typeof d.season === "string" ? parseInt(d.season, 10) : Number(d.season);
      if (!Number.isFinite(season)) return null;
      const startTime =
        typeof d.start_time === "number" && d.start_time > 0
          ? new Date(d.start_time).toISOString()
          : null;
      return {
        league_id: leagueRowId,
        sleeper_draft_id: d.draft_id,
        season,
        status: d.status ?? null,
        type: d.type ?? null,
        start_time: startTime,
        slot_to_roster_id: (d.slot_to_roster_id ?? {}) as unknown as Database["public"]["Tables"]["league_drafts"]["Insert"]["slot_to_roster_id"],
        draft_order: ((d as unknown as { draft_order?: unknown }).draft_order ?? null) as Database["public"]["Tables"]["league_drafts"]["Insert"]["draft_order"],
        settings: (d.settings ?? null) as Database["public"]["Tables"]["league_drafts"]["Insert"]["settings"],
        metadata: d as unknown as Database["public"]["Tables"]["league_drafts"]["Insert"]["metadata"],
        updated_at: new Date().toISOString(),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("league_drafts")
    .upsert(rows, { onConflict: "sleeper_draft_id" });
  if (error) throw new Error(`league_drafts upsert failed: ${error.message}`);
}

/**
 * For each (season, round, roster) baseline, default current owner = original.
 * We use the current league rosters as the set of roster_ids and assume 4
 * future seasons starting from the league's season+0..+3. Sleeper doesn't
 * publish "all my picks" — we synthesize the baseline and traded_picks
 * mutates ownership.
 */
function buildBaselinePicks(rosters: SleeperRoster[]): Map<string, PickAsset> {
  const map = new Map<string, PickAsset>();
  // Use current calendar year +0..+3 as the pick horizon (Sleeper traded_picks
  // returns seasons beyond the current one; we plant a baseline for each).
  // Round count = 4 (Sleeper rookie drafts are typically 3-5 rounds; 4 is a
  // safe middle ground for dynasty pick visualization).
  const currentYear = new Date().getFullYear();
  const seasons = [currentYear, currentYear + 1, currentYear + 2, currentYear + 3];
  const rounds = [1, 2, 3, 4];
  for (const season of seasons) {
    for (const round of rounds) {
      for (const r of rosters) {
        const key = pickKey(season, round, r.roster_id);
        map.set(key, {
          season,
          round,
          original_roster_id: r.roster_id,
          current_roster_id: r.roster_id,
        });
      }
    }
  }
  return map;
}

function validPlayerId(id: string | null | undefined): id is string {
  if (id === null || id === undefined) return false;
  if (id === "" || id === "0") return false;
  return true;
}

function scaledPoints(whole: number | undefined, decimal: number | undefined): number {
  const w = Number(whole ?? 0);
  const d = Number(decimal ?? 0);
  return w + d / 100;
}

/**
 * Sleeper emits transaction.draft_picks as one of:
 *   - array of pick objects
 *   - object map keyed by index
 *   - JSON-encoded string
 *   - null/undefined
 * Normalize to a plain array. See CLAUDE.md gotchas.
 */
function normalizeDraftPicks(input: unknown): unknown[] {
  if (input == null) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === "object") return Object.values(input as Record<string, unknown>);
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? parsed : Object.values(parsed ?? {});
    } catch {
      return [];
    }
  }
  return [];
}

function collectRosterIds(
  adds: Record<string, number> | null | undefined,
  drops: Record<string, number> | null | undefined,
  topLevel: number[] | undefined,
  draftPicks: unknown[],
): number[] {
  const set = new Set<number>();
  for (const v of Object.values(adds ?? {})) if (typeof v === "number") set.add(v);
  for (const v of Object.values(drops ?? {})) if (typeof v === "number") set.add(v);
  for (const id of topLevel ?? []) set.add(id);
  for (const pick of draftPicks) {
    if (pick && typeof pick === "object") {
      const p = pick as Record<string, unknown>;
      if (typeof p.owner_id === "number") set.add(p.owner_id);
      if (typeof p.previous_owner_id === "number") set.add(p.previous_owner_id);
      if (typeof p.roster_id === "number") set.add(p.roster_id);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

export type { SleeperLeague };
