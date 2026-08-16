import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { loadLeagueDraftSlots } from "@/lib/league-pick-slots";
import {
  resolvePlayers,
  loadTrends,
  type CacheRow,
  type DraftPickAsset,
  type ValuedPosition,
} from "@/lib/league-view-data";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export const SHARE_CARD_POSITIONS: readonly ValuedPosition[] = [
  "QB",
  "RB",
  "WR",
  "TE",
] as const;

export type ShareCardPlayer = {
  name: string;
  position: string;
  /** NFL team abbreviation, or null for a free agent. */
  team: string | null;
  value: number;
  /** True when the player sits in a starting slot on the synced roster. */
  starter: boolean;
};

export type ShareCardPick = {
  /** "2027 R1" or "2027 1.04" once the draft slot is published. */
  label: string;
  /** "Own pick" or "via @handle". */
  attribution: string;
  isOwn: boolean;
};

export type ShareCardPositionGroup = {
  position: ValuedPosition;
  players: ShareCardPlayer[];
  value: number;
  /** 1 = most valuable at this position in the league. Null when nobody has value there. */
  rank: number | null;
};

export type TeamShareCard = {
  teamName: string;
  ownerHandle: string | null;
  record: { wins: number; losses: number; ties: number };
  teamCount: number;
  overallRank: number | null;
  totalValue: number;
  starterValue: number;
  benchValue: number;
  picksValue: number;
  positions: ShareCardPositionGroup[];
  picks: ShareCardPick[];
};

/**
 * Everything the team share image needs, for ONE roster.
 *
 * `loadLeagueTeamCards` builds the same shape for every team in the league,
 * which means resolving and pricing roughly 200 players when the share card
 * needs about 15. That cost lands on the first request for an uncached image,
 * so this loader keeps the league-wide queries to the small rows it genuinely
 * needs (rosters, members, the power-rankings cache) and only resolves players
 * and trends for the target roster.
 *
 * Returns null when the roster is not in the league.
 */
export async function loadTeamShareCard(
  supabase: AnySupabase,
  leagueRowId: string,
  sleeperRosterId: number,
  formatConfigId: string | null,
  sourceSlug: string | null,
  /** League season, used to drop already-drafted current-season rookie picks. */
  currentSeason: string | null,
  /** Sleeper league status. Only `pre_draft` keeps current-season picks. */
  leagueStatus: string | null,
  /** Whether pick values count toward the totals shown on the card. */
  includePicks = true,
): Promise<TeamShareCard | null> {
  const [rostersRes, usersRes, cacheRes, slotIndex] = await Promise.all([
    supabase
      .from("rosters")
      .select(
        "id, sleeper_roster_id, owner_user_id, player_ids, starter_ids, draft_pick_assets, wins, losses, ties",
      )
      .eq("league_id", leagueRowId)
      .order("sleeper_roster_id", { ascending: true }),
    supabase
      .from("league_users")
      .select("sleeper_user_id, display_name, team_name")
      .eq("league_id", leagueRowId),
    formatConfigId && sourceSlug
      ? supabase
          .from("league_power_rankings_cache")
          .select(
            "roster_id, starter_value, bench_value, picks_value, total_value, overall_rank, starter_rank, positional_breakdowns",
          )
          .eq("league_id", leagueRowId)
          .eq("format_config_id", formatConfigId)
          .eq("source", sourceSlug)
      : Promise.resolve({ data: [], error: null }),
    loadLeagueDraftSlots(supabase, leagueRowId),
  ]);

  const rosters = rostersRes.data ?? [];
  const target = rosters.find((r) => r.sleeper_roster_id === sleeperRosterId);
  if (!target) return null;

  const users = usersRes.data ?? [];
  const usersById = new Map(users.map((u) => [u.sleeper_user_id, u]));
  const cache = (cacheRes.data ?? []) as Array<{ roster_id: string } & CacheRow>;
  const cacheByRoster = new Map(cache.map((c) => [c.roster_id, c]));
  const row = cacheByRoster.get(target.id) ?? null;

  const owner = target.owner_user_id ? usersById.get(target.owner_user_id) : null;
  const teamName =
    owner?.team_name || owner?.display_name || `Team ${target.sleeper_roster_id}`;

  // Only this roster's players get resolved and priced.
  const sleeperIds = asStringArray(target.player_ids);
  const resolved = await resolvePlayers(supabase, sleeperIds);
  const playerIds = Array.from(new Set([...resolved.values()].map((p) => p.id)));
  const trends =
    formatConfigId && sourceSlug
      ? await loadTrends(supabase, playerIds, formatConfigId, sourceSlug)
      : {};

  const starterSet = new Set(asStringArray(target.starter_ids));
  const grouped: Record<ValuedPosition, ShareCardPlayer[]> = {
    QB: [],
    RB: [],
    WR: [],
    TE: [],
  };
  for (const sid of sleeperIds) {
    const p = resolved.get(sid);
    if (!p) continue;
    if (!(p.position in grouped)) continue;
    grouped[p.position as ValuedPosition].push({
      name: p.full_name,
      position: p.position,
      team: p.team,
      value: trends[p.id]?.current_value ?? 0,
      starter: starterSet.has(sid),
    });
  }
  for (const pos of SHARE_CARD_POSITIONS) {
    grouped[pos].sort((a, b) => b.value - a.value);
  }

  // Per-position league rank comes from every team's cached breakdown, which is
  // one small row per roster rather than a second pass over their players.
  const positionRanks = rankPositions(rosters, cacheByRoster);

  const positions: ShareCardPositionGroup[] = SHARE_CARD_POSITIONS.map((pos) => ({
    position: pos,
    players: grouped[pos],
    value: positionValue(row, pos),
    rank: positionRanks[pos].get(target.id) ?? null,
  }));

  const rosterIdToHandle = new Map<number, string | null>();
  const rosterIdToTeamName = new Map<number, string>();
  for (const r of rosters) {
    const u = r.owner_user_id ? usersById.get(r.owner_user_id) : null;
    rosterIdToHandle.set(r.sleeper_roster_id, u?.display_name ?? null);
    rosterIdToTeamName.set(
      r.sleeper_roster_id,
      u?.team_name || u?.display_name || `Team ${r.sleeper_roster_id}`,
    );
  }

  const picks = buildPicks(
    ((target.draft_pick_assets ?? []) as DraftPickAsset[]) || [],
    target.sleeper_roster_id,
    slotIndex,
    rosterIdToHandle,
    rosterIdToTeamName,
    currentSeason,
    leagueStatus,
  );

  const totalValue = row ? Number(row.total_value) : 0;
  const picksValue = row ? Number(row.picks_value) : 0;

  return {
    teamName,
    ownerHandle: owner?.display_name ?? null,
    record: { wins: target.wins, losses: target.losses, ties: target.ties },
    teamCount: rosters.length,
    overallRank: overallRank(rosters, cacheByRoster, target.id, includePicks),
    totalValue: includePicks ? totalValue : totalValue - picksValue,
    starterValue: row ? Number(row.starter_value) : 0,
    benchValue: row ? Number(row.bench_value) : 0,
    picksValue,
    positions,
    picks,
  };
}

// ---------- helpers ----------

type RosterLite = { id: string; sleeper_roster_id: number };

function positionValue(row: CacheRow | null, pos: ValuedPosition): number {
  if (!row || !row.positional_breakdowns) return 0;
  const breakdowns = row.positional_breakdowns as Record<
    string,
    { value?: number | null } | undefined
  >;
  const v = breakdowns[pos]?.value;
  return typeof v === "number" ? v : 0;
}

/** roster row id → 1-based league rank, per position. Zero-value teams stay unranked. */
function rankPositions(
  rosters: RosterLite[],
  cacheByRoster: Map<string, CacheRow>,
): Record<ValuedPosition, Map<string, number>> {
  const out = {
    QB: new Map<string, number>(),
    RB: new Map<string, number>(),
    WR: new Map<string, number>(),
    TE: new Map<string, number>(),
  };
  for (const pos of SHARE_CARD_POSITIONS) {
    rosters
      .map((r) => ({ id: r.id, value: positionValue(cacheByRoster.get(r.id) ?? null, pos) }))
      .sort((a, b) => b.value - a.value)
      .forEach((entry, i) => {
        if (entry.value > 0) out[pos].set(entry.id, i + 1);
      });
  }
  return out;
}

/**
 * Overall rank honoring the picks toggle, mirroring `loadLeagueTeamCards`:
 * the cached rank when picks count, a players-only re-rank when they don't
 * (starter value breaks ties, the same way the cache does).
 */
function overallRank(
  rosters: RosterLite[],
  cacheByRoster: Map<string, CacheRow>,
  rosterRowId: string,
  includePicks: boolean,
): number | null {
  const own = cacheByRoster.get(rosterRowId);
  if (!own) return null;
  if (includePicks) return own.overall_rank ?? null;
  const ranked = rosters
    .map((r) => ({ id: r.id, row: cacheByRoster.get(r.id) }))
    .filter((e): e is { id: string; row: CacheRow } => !!e.row)
    .map((e) => ({
      id: e.id,
      total: Number(e.row.total_value) - Number(e.row.picks_value),
      starter: Number(e.row.starter_value),
    }))
    .sort((a, b) => b.total - a.total || b.starter - a.starter);
  const idx = ranked.findIndex((e) => e.id === rosterRowId);
  return idx === -1 ? null : idx + 1;
}

function buildPicks(
  raw: DraftPickAsset[],
  ownRosterId: number,
  slotIndex: Awaited<ReturnType<typeof loadLeagueDraftSlots>>,
  rosterIdToHandle: Map<number, string | null>,
  rosterIdToTeamName: Map<number, string>,
  currentSeason: string | null,
  leagueStatus: string | null,
): ShareCardPick[] {
  // Sleeper leaves current-season rookie picks on rosters after the draft ends,
  // so they come off once the league is past pre_draft.
  const stripCurrentSeason =
    leagueStatus != null && leagueStatus !== "pre_draft" && !!currentSeason;
  const filtered = stripCurrentSeason
    ? raw.filter((p) => String(p.season) !== String(currentSeason))
    : raw;

  return filtered
    .map((p) => {
      const slot =
        p.slot ?? slotIndex.slotFor(Number(p.season), Number(p.original_roster_id));
      const pickLabel =
        p.pick_label ??
        (slot != null ? `${Number(p.round)}.${String(slot).padStart(2, "0")}` : null);
      return { ...p, slot: slot ?? null, pick_label: pickLabel };
    })
    .sort((a, b) => {
      const sa = Number(a.season);
      const sb = Number(b.season);
      if (sa !== sb) return sa - sb;
      if (a.round !== b.round) return a.round - b.round;
      const slotA = a.slot ?? Number.MAX_SAFE_INTEGER;
      const slotB = b.slot ?? Number.MAX_SAFE_INTEGER;
      if (slotA !== slotB) return slotA - slotB;
      return (a.original_roster_id ?? 0) - (b.original_roster_id ?? 0);
    })
    .map((p) => {
      const isOwn = p.original_roster_id === ownRosterId;
      const handle = isOwn ? null : rosterIdToHandle.get(p.original_roster_id) ?? null;
      const fallback = isOwn
        ? null
        : rosterIdToTeamName.get(p.original_roster_id) ?? `Team ${p.original_roster_id}`;
      return {
        label: p.pick_label ? `${p.season} R${p.pick_label}` : `${p.season} R${p.round}`,
        attribution: isOwn ? "Own pick" : handle ? `via @${handle}` : `via ${fallback}`,
        isOwn,
      };
    });
}

function asStringArray(value: Json | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}
