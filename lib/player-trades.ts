/**
 * Cross-league trade lookup for a player.
 *
 * league_transactions has no player_id column: players live only as Sleeper-id
 * string keys inside the adds/drops jsonb. To find every trade across all
 * synced leagues that involves a player, we resolve the player to their Sleeper
 * id and key-match the jsonb. Everything here reads public-readable tables, so a
 * normal (anon) server client is enough for the lookup and the minimal display.
 * Signal Check GRADING (trades tab) reads service-role-only config and is layered
 * on top of this by the trades tab.
 *
 * Sleeper sends "0" as an empty roster-slot placeholder; those are stripped.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export type TradeAsset = {
  sleeperPlayerId: string;
  name: string;
  position: string | null;
  team: string | null;
  slug: string | null;
};

export type TradePick = {
  season: number;
  round: number;
  pickPosition: string | null;
  label: string;
};

export type TradeSide = {
  rosterId: number;
  teamName: string;
  ownerHandle: string | null;
  players: TradeAsset[];
  picks: TradePick[];
};

export type PlayerTrade = {
  transactionId: string;
  leagueRowId: string;
  sleeperLeagueId: string | null;
  leagueName: string | null;
  formatDisplay: string | null;
  season: number | null;
  week: number | null;
  createdAtSleeper: string | null;
  sides: TradeSide[];
  isTwoTeam: boolean;
  /** Roster that received the focus player, for highlighting. */
  focusRosterId: number | null;
  raw: {
    adds: Record<string, number>;
    drops: Record<string, number>;
    draftPicks: unknown[];
  };
};

const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];

function pickLabel(season: number, round: number, position: string | null): string {
  const rd = ORDINAL[round] ?? `R${round}`;
  return position ? `${season} ${rd} (${position})` : `${season} ${rd}`;
}

function toInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Every trade across all leagues that includes the given Sleeper player id,
 * newest first. `limit` caps the number of trades returned.
 */
export async function findPlayerTrades(
  supabase: AnySupabase,
  sleeperId: string,
  opts: { limit?: number } = {},
): Promise<PlayerTrade[]> {
  const db = supabase as SupabaseClient<Database>;
  const limit = Math.min(opts.limit ?? 50, 100);
  if (!/^\d+$/.test(sleeperId)) return [];

  // adds/drops are jsonb maps keyed by the Sleeper player id; a row involves the
  // player when the key exists (its value is the receiving/leaving roster id).
  // We go through the find_player_trade_transactions RPC (migration 0143) whose
  // `adds ? id OR drops ? id` predicate is served by the jsonb_ops GIN indexes,
  // instead of the old `adds->>"id" is not null` expression filter that forced a
  // seq scan. The RPC already filters type='trade', orders newest-first, and caps
  // the limit. sleeperId is validated /^\d+$/ above.
  const { data: txRows } = await db.rpc("find_player_trade_transactions", {
    p_sleeper_id: sleeperId,
    p_limit: limit,
  });

  const trades = txRows ?? [];
  if (trades.length === 0) return [];

  const leagueIds = Array.from(new Set(trades.map((t) => t.league_id)));

  // Batch-load league metadata + roster identities + player names for every
  // league and player referenced across the returned trades.
  const [{ data: leagueRows }, { data: rosterRows }, { data: userRows }] = await Promise.all([
    db.from("leagues").select("id, sleeper_league_id, name, season, format_config_id").in("id", leagueIds),
    db.from("rosters").select("league_id, sleeper_roster_id, owner_user_id").in("league_id", leagueIds),
    db
      .from("league_users")
      .select("league_id, sleeper_user_id, display_name, team_name")
      .in("league_id", leagueIds),
  ]);

  const leagueById = new Map(
    (leagueRows ?? []).map((l) => [
      l.id,
      l as {
        id: string;
        sleeper_league_id: string | null;
        name: string | null;
        season: number | null;
        format_config_id: string | null;
      },
    ]),
  );

  // League format display, shown on the minimal sidebar trade cards.
  const formatIds = Array.from(
    new Set((leagueRows ?? []).map((l) => l.format_config_id).filter((id): id is string => Boolean(id))),
  );
  const formatById = new Map<string, string>();
  if (formatIds.length > 0) {
    const { data: fmts } = await db
      .from("format_configs")
      .select("id, display_name")
      .in("id", formatIds);
    for (const f of fmts ?? []) formatById.set(f.id, f.display_name);
  }

  // (leagueId -> sleeper_user_id -> user) for owner-handle resolution.
  const usersByLeague = new Map<string, Map<string, { display_name: string | null; team_name: string | null }>>();
  for (const u of userRows ?? []) {
    let m = usersByLeague.get(u.league_id);
    if (!m) {
      m = new Map();
      usersByLeague.set(u.league_id, m);
    }
    if (u.sleeper_user_id) m.set(u.sleeper_user_id, { display_name: u.display_name, team_name: u.team_name });
  }

  // (leagueId -> roster_id -> identity)
  const identityByLeague = new Map<string, Map<number, { teamName: string; ownerHandle: string | null }>>();
  for (const r of rosterRows ?? []) {
    let m = identityByLeague.get(r.league_id);
    if (!m) {
      m = new Map();
      identityByLeague.set(r.league_id, m);
    }
    const user = r.owner_user_id ? usersByLeague.get(r.league_id)?.get(r.owner_user_id) : null;
    m.set(r.sleeper_roster_id, {
      teamName: user?.team_name || user?.display_name || `Team ${r.sleeper_roster_id}`,
      ownerHandle: user?.display_name ?? null,
    });
  }

  // Resolve every referenced Sleeper player id to a name/position/team/slug.
  const allSleeperIds = new Set<string>();
  for (const t of trades) {
    for (const map of [t.adds, t.drops]) {
      if (map && typeof map === "object") {
        for (const id of Object.keys(map)) if (id && id !== "0") allSleeperIds.add(id);
      }
    }
  }
  const playerLookup = await resolvePlayers(supabase, Array.from(allSleeperIds));

  const asset = (sleeperPlayerId: string): TradeAsset => {
    const p = playerLookup[sleeperPlayerId];
    return {
      sleeperPlayerId,
      name: p?.name ?? `Player ${sleeperPlayerId}`,
      position: p?.position ?? null,
      team: p?.team ?? null,
      slug: p?.slug ?? null,
    };
  };

  const out: PlayerTrade[] = [];
  for (const t of trades) {
    const adds = (t.adds as Record<string, number> | null) ?? {};
    const drops = (t.drops as Record<string, number> | null) ?? {};
    const draftPicks = Array.isArray(t.draft_picks) ? (t.draft_picks as unknown[]) : [];
    const identities = identityByLeague.get(t.league_id) ?? new Map();

    // Group received players (adds) and received picks (owner_id) by roster.
    const sideMap = new Map<number, TradeSide>();
    const ensureSide = (rosterId: number): TradeSide => {
      let s = sideMap.get(rosterId);
      if (!s) {
        const id = identities.get(rosterId);
        s = {
          rosterId,
          teamName: id?.teamName ?? `Team ${rosterId}`,
          ownerHandle: id?.ownerHandle ?? null,
          players: [],
          picks: [],
        };
        sideMap.set(rosterId, s);
      }
      return s;
    };

    for (const [pid, rosterId] of Object.entries(adds)) {
      if (!pid || pid === "0") continue;
      const rid = toInt(rosterId);
      if (rid == null) continue;
      ensureSide(rid).players.push(asset(pid));
    }

    for (const raw of draftPicks) {
      if (!raw || typeof raw !== "object") continue;
      const p = raw as Record<string, unknown>;
      const ownerId = toInt(p.owner_id);
      const season = toInt(p.season);
      const round = toInt(p.round);
      if (ownerId == null || season == null || round == null) continue;
      const position = typeof p.pick_position === "string" ? p.pick_position : null;
      ensureSide(ownerId).picks.push({
        season,
        round,
        pickPosition: position,
        label: pickLabel(season, round, position),
      });
    }

    const sides = Array.from(sideMap.values()).sort((a, b) => a.rosterId - b.rosterId);
    const focusRosterId = toInt(adds[sleeperId]);
    const league = leagueById.get(t.league_id);

    out.push({
      transactionId: t.sleeper_transaction_id,
      leagueRowId: t.league_id,
      sleeperLeagueId: league?.sleeper_league_id ?? null,
      leagueName: league?.name ?? null,
      formatDisplay: league?.format_config_id ? formatById.get(league.format_config_id) ?? null : null,
      season: t.season ?? league?.season ?? null,
      week: t.week ?? null,
      createdAtSleeper: t.created_at_sleeper ?? null,
      sides,
      isTwoTeam: sides.length === 2,
      focusRosterId: focusRosterId ?? null,
      raw: { adds, drops, draftPicks },
    });
  }

  return out;
}

type ResolvedPlayer = {
  name: string;
  position: string | null;
  team: string | null;
  slug: string;
};

const PLAYER_COLUMNS = "slug, full_name, first_name, last_name, position, team, external_ids";
const RESOLVE_CHUNK = 200;

function displayName(row: {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
}, fallback: string): string {
  return row.full_name ?? (`${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || fallback);
}

/** Resolve Sleeper player ids to name/position/team/slug. Mirrors the resolver
 *  in lib/league-transactions-data.ts, with slug added for profile links.
 *
 *  Two passes, and the split is the point. `external_ids->>'sleeper'` is indexed
 *  (idx_players_external_ids_sleeper, migration 0002), while the `slug.like.*-id`
 *  suffix match is a leading-wildcard pattern that no index can serve. Running
 *  both as branches of one `or()` made the whole filter unindexable, so every
 *  call seq-scanned the players table, once per profile view. The suffix match
 *  is a fallback for rows whose external id was never written, so it now runs
 *  only against the ids the indexed pass could not resolve, which is normally
 *  none and skips the second query entirely. */
async function resolvePlayers(
  supabase: AnySupabase,
  sleeperIds: string[],
): Promise<Record<string, ResolvedPlayer>> {
  const out: Record<string, ResolvedPlayer> = {};
  if (sleeperIds.length === 0) return out;
  const db = supabase as SupabaseClient<Database>;
  const safeIds = sleeperIds.filter((id) => /^\d+$/.test(id));

  // Pass 1: indexed lookup by external Sleeper id.
  for (let i = 0; i < safeIds.length; i += RESOLVE_CHUNK) {
    const chunk = safeIds.slice(i, i + RESOLVE_CHUNK);
    const { data } = await db
      .from("players")
      .select(PLAYER_COLUMNS)
      .or(chunk.map((id) => `external_ids->>sleeper.eq.${id}`).join(","));
    for (const row of data ?? []) {
      const ext = (row.external_ids as Record<string, unknown>) ?? {};
      const sid = typeof ext.sleeper === "string" ? ext.sleeper : null;
      if (!sid || out[sid]) continue;
      out[sid] = {
        name: displayName(row, sid),
        position: row.position ?? null,
        team: row.team ?? null,
        slug: row.slug as string,
      };
    }
  }

  // Pass 2: slug-suffix fallback, only for whatever pass 1 missed.
  const unresolved = safeIds.filter((id) => !out[id]);
  for (let i = 0; i < unresolved.length; i += RESOLVE_CHUNK) {
    const chunk = unresolved.slice(i, i + RESOLVE_CHUNK);
    const { data } = await db
      .from("players")
      .select(PLAYER_COLUMNS)
      .or(chunk.map((id) => `slug.like.*-${id}`).join(","));
    for (const row of data ?? []) {
      const sid = (row.slug as string).match(/-(\d+)$/)?.[1] ?? null;
      if (!sid || !chunk.includes(sid) || out[sid]) continue;
      out[sid] = {
        name: displayName(row, sid),
        position: row.position ?? null,
        team: row.team ?? null,
        slug: row.slug as string,
      };
    }
  }

  return out;
}
