import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { loadLeagueDraftSlots } from "@/lib/league-pick-slots";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export type ResolvedPlayer = {
  id: string;
  sleeper_id: string;
  full_name: string;
  position: string;
  team: string | null;
};

export type TrendLite = {
  current_value: number;
  change_7d: number | null;
  change_7d_pct: number | null;
  trend_7d: "up" | "down" | "stable" | null;
};

export type DraftPickAsset = {
  season: number;
  round: number;
  original_roster_id: number;
  current_roster_id: number;
  pick_position?: string;
  /** Resolved draft slot (1..N) from league_drafts.slot_to_roster_id. Null
   * until the season's draft is scheduled and the mapping is published. */
  slot?: number | null;
  /** "{round}.{slot padded 2}" label like "1.04". Null when slot unknown. */
  pick_label?: string | null;
};

export type CacheRow = {
  starter_value: number;
  bench_value: number;
  picks_value: number;
  total_value: number;
  overall_rank: number | null;
  starter_rank: number | null;
  positional_breakdowns: Json;
};

export type ValuedPosition = "QB" | "RB" | "WR" | "TE";

export type TeamCardData = {
  rosterRowId: string;
  sleeperRosterId: number;
  teamName: string;
  /** Sleeper handle (display_name on league_users). Used to match the searched username against the team's owner. */
  ownerSleeperUsername: string | null;
  ownerDisplayName: string | null;
  /** Sleeper avatar id (the raw string Sleeper returns; build the URL as
   * `https://sleepercdn.com/avatars/{id}`). null when the user has no avatar set. */
  ownerAvatarId: string | null;
  record: { wins: number; losses: number; ties: number; pointsFor: number };
  cacheRow: CacheRow | null;
  players: ResolvedPlayer[];
  /** Keyed by player.id (uuid). Plain Record so this struct survives the
   * server → client component boundary (Maps don't serialize via Next.js). */
  trends: Record<string, TrendLite>;
  draftPicks: DraftPickAsset[];
  /** player.id (uuid) of every starter. */
  starterIds: string[];
  /** Sleeper roster_id → owner-facing team name. Used for "via Team X" pick attribution. */
  rosterIdToTeamName: Record<number, string>;
  /** Sleeper roster_id → owner's Sleeper username (display_name). Preferred over
   * team name for pick attribution because users recognize handles faster than
   * custom team names that may rotate season to season. */
  rosterIdToOwnerUsername: Record<number, string | null>;
  /** Total value of this team's players at each position (starter + bench).
   * Derived from positional_breakdowns; falls back to zero when the cache row is missing. */
  positionValues: Record<ValuedPosition, number>;
  /** This team's rank across the league for each position (1 = highest combined value).
   * null when there are no other teams to compare against or every team has zero value. */
  positionRanks: Record<ValuedPosition, number | null>;
  /** Total team count in the league. Used by TeamCard to render "Nth of M" labels. */
  teamCount: number;
  /** Whether draft pick values are counted in this team's totals and league
   * ranking. Driven by the "Include draft picks in power rankings" toggle
   * (dynasty only) and forced false for redraft leagues, which have no pick
   * values. When false, `displayTotalValue` / `displayOverallRank` exclude
   * picks and the picks column / tile is hidden. */
  includePicks: boolean;
  /** Total team value to display, honoring `includePicks`: `total_value` when
   * picks are included, `total_value - picks_value` when excluded. Null when
   * no cache row exists for this (format, source). */
  displayTotalValue: number | null;
  /** League rank (1 = highest `displayTotalValue`) honoring `includePicks`.
   * Equals `cacheRow.overall_rank` when picks are included; recomputed by
   * players-only total when excluded. Null when no cache row exists. */
  displayOverallRank: number | null;
  /** This team's league rank for each of the four header stat chips
   * (Starters / Bench / Picks / Total). 1 = best, null when the value is
   * zero or the cache row is missing. Drives the top-3 / bottom-3
   * tier highlight on the value chips. */
  statRanks: {
    starter: number | null;
    bench: number | null;
    picks: number | null;
    total: number | null;
  };
};

/**
 * Load every TeamCardData for a league in a single batched pass. Used by
 * both the inline league view (renders N TeamCards) and the team detail
 * page (renders one, filtered by sleeper_roster_id). Centralizing the
 * fetch logic keeps the two surfaces in sync.
 */
export async function loadLeagueTeamCards(
  supabase: AnySupabase,
  leagueRowId: string,
  formatConfigId: string | null,
  sourceSlug: string | null,
  /** League season (e.g. "2026"). When provided alongside a non-`pre_draft`
   * status, current-season rookie picks are filtered out because Sleeper
   * leaves them on rosters even after the rookie draft is complete. Without
   * this filter, "In Season" leagues would show phantom 2026 picks that no
   * longer exist as tradeable assets. */
  currentSeason?: string | null,
  /** League status from Sleeper. Only `pre_draft` keeps the current-season picks visible. */
  leagueStatus?: string | null,
  /** Whether draft pick values count toward team totals and the league
   * ranking. Defaults to true (picks included). Pass false to rank teams by
   * players only, which the dynasty "Include draft picks" toggle does when
   * turned off, and which redraft leagues always do (no pick values exist). */
  includePicks = true,
): Promise<TeamCardData[]> {
  const [rostersRes, usersRes, cacheRes, slotIndex] = await Promise.all([
    supabase
      .from("rosters")
      .select(
        "id, sleeper_roster_id, owner_user_id, player_ids, starter_ids, draft_pick_assets, wins, losses, ties, points_for",
      )
      .eq("league_id", leagueRowId)
      .order("sleeper_roster_id", { ascending: true }),
    supabase
      .from("league_users")
      .select("sleeper_user_id, display_name, team_name, avatar")
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
  const users = usersRes.data ?? [];
  const cache = (cacheRes.data ?? []) as Array<{ roster_id: string } & CacheRow>;

  const usersById = new Map(users.map((u) => [u.sleeper_user_id, u]));
  const cacheByRoster = new Map(cache.map((c) => [c.roster_id, c]));
  const rosterIdToTeamName: Record<number, string> = {};
  const rosterIdToOwnerUsername: Record<number, string | null> = {};
  for (const r of rosters) {
    const u = r.owner_user_id ? usersById.get(r.owner_user_id) : null;
    rosterIdToTeamName[r.sleeper_roster_id] =
      u?.team_name || u?.display_name || `Team ${r.sleeper_roster_id}`;
    rosterIdToOwnerUsername[r.sleeper_roster_id] = u?.display_name ?? null;
  }

  // Sleeper leaves the current-season rookie picks on rosters even after the
  // draft completes, so drop them once the league is past pre_draft.
  const stripCurrentSeasonPicks =
    leagueStatus != null && leagueStatus !== "pre_draft" && !!currentSeason;
  const filterPicks = (picks: DraftPickAsset[]): DraftPickAsset[] => {
    const filtered = stripCurrentSeasonPicks
      ? picks.filter((p) => String(p.season) !== String(currentSeason))
      : picks;
    // Stamp every emitted pick with its resolved slot + pick_label, even if
    // it was synced before the slot mapping landed. Sort so picks read in
    // chronological order (season → round → slot) which mirrors how DPC
    // sorts and how users intuitively scan a draft sheet.
    const stamped = filtered.map((p) => {
      const slot =
        p.slot ??
        slotIndex.slotFor(Number(p.season), Number(p.original_roster_id));
      const pick_label =
        p.pick_label ??
        (slot != null
          ? `${Number(p.round)}.${String(slot).padStart(2, "0")}`
          : null);
      return { ...p, slot: slot ?? null, pick_label };
    });
    stamped.sort((a, b) => {
      const sa = Number(a.season);
      const sb = Number(b.season);
      if (sa !== sb) return sa - sb;
      if (a.round !== b.round) return a.round - b.round;
      const slotA = a.slot ?? Number.MAX_SAFE_INTEGER;
      const slotB = b.slot ?? Number.MAX_SAFE_INTEGER;
      if (slotA !== slotB) return slotA - slotB;
      return (a.original_roster_id ?? 0) - (b.original_roster_id ?? 0);
    });
    return stamped;
  };

  // Single players + trends batch across all rosters
  const allSleeperIds = new Set<string>();
  for (const r of rosters) {
    for (const id of asStringArray(r.player_ids)) allSleeperIds.add(id);
  }
  const allPlayers = await resolvePlayers(supabase, Array.from(allSleeperIds));

  const allPlayerIds = Array.from(new Set([...allPlayers.values()].map((p) => p.id)));
  const allTrends: Record<string, TrendLite> =
    formatConfigId && sourceSlug
      ? await loadTrends(supabase, allPlayerIds, formatConfigId, sourceSlug)
      : {};

  const out: TeamCardData[] = [];
  for (const r of rosters) {
    const user = r.owner_user_id ? usersById.get(r.owner_user_id) : null;
    const teamName = user?.team_name || user?.display_name || `Team ${r.sleeper_roster_id}`;
    const ownerDisplayName =
      user?.display_name && user.team_name && user.team_name !== user.display_name
        ? user.display_name
        : null;

    const sleeperIds = asStringArray(r.player_ids);
    const players: ResolvedPlayer[] = [];
    const starterSet = new Set(asStringArray(r.starter_ids));
    const starterIds: string[] = [];
    for (const sid of sleeperIds) {
      const p = allPlayers.get(sid);
      if (!p) continue;
      players.push(p);
      if (starterSet.has(sid)) starterIds.push(p.id);
    }

    const cache = cacheByRoster.get(r.id) ?? null;
    out.push({
      rosterRowId: r.id,
      sleeperRosterId: r.sleeper_roster_id,
      teamName,
      ownerSleeperUsername: user?.display_name ?? null,
      ownerDisplayName,
      ownerAvatarId: user?.avatar ?? null,
      record: {
        wins: r.wins,
        losses: r.losses,
        ties: r.ties,
        pointsFor: Number(r.points_for),
      },
      cacheRow: cache,
      players,
      trends: allTrends,
      draftPicks: filterPicks(((r.draft_pick_assets ?? []) as DraftPickAsset[]) || []),
      starterIds,
      rosterIdToTeamName,
      rosterIdToOwnerUsername,
      positionValues: extractPositionValues(cache),
      positionRanks: { QB: null, RB: null, WR: null, TE: null },
      teamCount: rosters.length,
      includePicks,
      displayTotalValue: null,
      displayOverallRank: null,
      statRanks: { starter: null, bench: null, picks: null, total: null },
    });
  }

  // Compute per-position rank across the league (1 = highest combined value).
  // Done in a second pass so each team's positionRanks reflects the full set.
  const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
  for (const pos of POSITIONS) {
    const sorted = [...out]
      .map((t) => ({ team: t, value: t.positionValues[pos] }))
      .sort((a, b) => b.value - a.value);
    sorted.forEach((entry, i) => {
      entry.team.positionRanks[pos] = entry.value > 0 ? i + 1 : null;
    });
  }

  // Effective team total honoring the picks toggle: full total when picks are
  // included, players-only (total minus picks) when excluded.
  const effectiveTotal = (c: CacheRow | null): number =>
    c ? Number(c.total_value) - (includePicks ? 0 : Number(c.picks_value)) : 0;

  // Compute per-stat rank for the four header chips. Reuses cacheRow values
  // (starter/bench/picks) so the rank lines up with what the chip shows; the
  // total chip ranks on the effective total so it tracks the picks toggle.
  const STAT_GETTERS: {
    key: "starter" | "bench" | "picks" | "total";
    valueOf: (t: TeamCardData) => number;
  }[] = [
    { key: "starter", valueOf: (t) => (t.cacheRow ? Number(t.cacheRow.starter_value) : 0) },
    { key: "bench", valueOf: (t) => (t.cacheRow ? Number(t.cacheRow.bench_value) : 0) },
    { key: "picks", valueOf: (t) => (t.cacheRow ? Number(t.cacheRow.picks_value) : 0) },
    { key: "total", valueOf: (t) => effectiveTotal(t.cacheRow) },
  ];
  for (const { key, valueOf } of STAT_GETTERS) {
    const sorted = [...out]
      .map((t) => ({ team: t, value: valueOf(t) }))
      .sort((a, b) => b.value - a.value);
    sorted.forEach((entry, i) => {
      entry.team.statRanks[key] = entry.value > 0 ? i + 1 : null;
    });
  }

  // Display total + overall rank honoring the picks toggle. With picks
  // included this mirrors the cached total_value / overall_rank; excluded, it
  // re-ranks every team that has a cache row by players-only total (starter
  // value breaks ties, matching the cache's own ranking tiebreak). Teams
  // without a cache row keep the null defaults.
  if (includePicks) {
    for (const t of out) {
      t.displayTotalValue = t.cacheRow ? Number(t.cacheRow.total_value) : null;
      t.displayOverallRank = t.cacheRow?.overall_rank ?? null;
    }
  } else {
    const ranked = out
      .filter((t) => t.cacheRow)
      .map((t) => ({
        team: t,
        total: Number(t.cacheRow!.total_value) - Number(t.cacheRow!.picks_value),
        starter: Number(t.cacheRow!.starter_value),
      }))
      .sort((a, b) => b.total - a.total || b.starter - a.starter);
    ranked.forEach((entry, i) => {
      entry.team.displayTotalValue = entry.total;
      entry.team.displayOverallRank = i + 1;
    });
  }

  return out;
}

function extractPositionValues(
  cacheRow: CacheRow | null,
): Record<"QB" | "RB" | "WR" | "TE", number> {
  const out = { QB: 0, RB: 0, WR: 0, TE: 0 };
  if (!cacheRow || !cacheRow.positional_breakdowns) return out;
  const breakdowns = cacheRow.positional_breakdowns as Record<
    string,
    { value?: number | null } | undefined
  >;
  for (const pos of ["QB", "RB", "WR", "TE"] as const) {
    const v = breakdowns[pos]?.value;
    if (typeof v === "number") out[pos] = v;
  }
  return out;
}

function asStringArray(value: Json | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

async function resolvePlayers(
  supabase: AnySupabase,
  sleeperIds: string[],
): Promise<Map<string, ResolvedPlayer>> {
  const map = new Map<string, ResolvedPlayer>();
  if (sleeperIds.length === 0) return map;
  const CHUNK = 200;
  for (let i = 0; i < sleeperIds.length; i += CHUNK) {
    const chunk = sleeperIds.slice(i, i + CHUNK);
    const ors = chunk
      .flatMap((id) => [
        `external_ids->>sleeper.eq.${id}`,
        `slug.like.*-${id}`,
      ])
      .join(",");
    const { data } = await supabase
      .from("players")
      .select("id, slug, first_name, last_name, full_name, position, team, external_ids")
      .or(ors);
    for (const p of data ?? []) {
      const ext = (p.external_ids as Record<string, unknown>) ?? {};
      const fromExternal = typeof ext.sleeper === "string" ? ext.sleeper : null;
      const tail = (p.slug as string).match(/-(\d+)$/)?.[1] ?? null;
      const sid = fromExternal ?? tail;
      if (!sid || !chunk.includes(sid)) continue;
      if (!map.has(sid)) {
        map.set(sid, {
          id: p.id,
          sleeper_id: sid,
          full_name: p.full_name ?? `${p.first_name} ${p.last_name}`.trim(),
          position: p.position,
          team: p.team,
        });
      }
    }
  }
  return map;
}

async function loadTrends(
  supabase: AnySupabase,
  playerIds: string[],
  formatConfigId: string,
  source: string,
): Promise<Record<string, TrendLite>> {
  const out: Record<string, TrendLite> = {};
  if (playerIds.length === 0) return out;
  const CHUNK = 300;
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    const chunk = playerIds.slice(i, i + CHUNK);
    const { data } = await supabase
      .from("player_value_trends")
      .select("player_id, current_value, change_7d, change_7d_pct, trend_7d")
      .eq("format_config_id", formatConfigId)
      .eq("source", source)
      .in("player_id", chunk);
    for (const row of data ?? []) {
      out[row.player_id] = {
        current_value: Number(row.current_value),
        change_7d: row.change_7d != null ? Number(row.change_7d) : null,
        change_7d_pct: row.change_7d_pct != null ? Number(row.change_7d_pct) : null,
        trend_7d: (row.trend_7d as TrendLite["trend_7d"]) ?? null,
      };
    }
  }
  return out;
}
