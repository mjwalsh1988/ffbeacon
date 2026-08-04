import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * How much of each player one manager actually owns, across their leagues.
 *
 * The question this answers is the one you cannot answer from inside a single
 * league: if this player tears an ACL on Sunday, how much of my season goes with
 * him. Someone in twelve leagues who took the same running back in nine of them
 * has a concentration problem they cannot see from any one roster page.
 *
 * READS ONLY. This never triggers a sync and never writes. It counts the rosters
 * already in the database, so a league nobody has synced simply is not in the
 * denominator, and a league synced tomorrow joins it with no code change and no
 * cache to bust. That is the contract the whole My Sleeper Leagues page runs
 * under: the entry list does not sync, Sync all does.
 *
 * THE DENOMINATOR IS SYNCED LEAGUES, NOT ALL LEAGUES
 *   Counting against every league Sleeper reports would divide by rooms we have
 *   no roster for, so every share would read low and would silently move every
 *   time an unrelated league got synced. The count and the denominator are both
 *   reported so the caller can say which leagues it is talking about.
 */

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export type PlayerExposureRow = {
  /** Sleeper's player id. The only id guaranteed to exist for a rostered player. */
  sleeperPlayerId: string;
  /** FF Beacon player slug, for a profile link. Null when we cannot resolve him. */
  slug: string | null;
  /** Display name. Falls back to the Sleeper id when the player is unknown to us. */
  name: string;
  position: string | null;
  team: string | null;
  /** Leagues, of the synced ones, where this manager rosters him. */
  leagueCount: number;
  /** Those leagues by name, for the row's detail line. */
  leagueNames: string[];
  /** leagueCount / totalLeagues as a percentage, 0 to 100, rounded. */
  sharePct: number;
};

export type PlayerExposure = {
  /** Synced leagues we found this manager's roster in. The denominator. */
  totalLeagues: number;
  /** Leagues Sleeper reports that we hold no roster for yet. */
  unsyncedLeagues: number;
  rows: PlayerExposureRow[];
};

export const EMPTY_PLAYER_EXPOSURE: PlayerExposure = {
  totalLeagues: 0,
  unsyncedLeagues: 0,
  rows: [],
};

const PAGE = 1000;
const RESOLVE_CHUNK = 200;

/** Sleeper writes "0" into an empty roster slot. It is not a player. */
function validPlayerId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id !== "0";
}

function asIdArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(validPlayerId) : [];
}

/**
 * Count this manager's players across every league of theirs we have synced.
 *
 * Never throws. A failed lookup degrades to an empty exposure, which the panel
 * renders as "nothing synced yet", the same thing a first-time visitor sees.
 */
export async function loadPlayerExposure(
  supabase: AnySupabase,
  sleeperLeagueIds: string[],
  sleeperUserId: string,
): Promise<PlayerExposure> {
  if (sleeperLeagueIds.length === 0 || !sleeperUserId) {
    return EMPTY_PLAYER_EXPOSURE;
  }

  try {
    const { data: leagueRows } = await supabase
      .from("leagues")
      .select("id, sleeper_league_id, name")
      .in("sleeper_league_id", sleeperLeagueIds.slice(0, PAGE));
    if (!leagueRows || leagueRows.length === 0) {
      return {
        ...EMPTY_PLAYER_EXPOSURE,
        unsyncedLeagues: sleeperLeagueIds.length,
      };
    }

    const leagueNameById = new Map(
      leagueRows.map((l) => [l.id, l.name ?? "Untitled league"]),
    );

    // owner_user_id holds the Sleeper user id verbatim (see lib/league-pulse.ts),
    // so this finds the manager's own roster without joining league_users.
    const { data: rosterRows } = await supabase
      .from("rosters")
      .select("league_id, player_ids")
      .in("league_id", [...leagueNameById.keys()])
      .eq("owner_user_id", sleeperUserId);
    if (!rosterRows || rosterRows.length === 0) {
      return {
        ...EMPTY_PLAYER_EXPOSURE,
        unsyncedLeagues: sleeperLeagueIds.length,
      };
    }

    const totalLeagues = rosterRows.length;

    // One league can only contribute once to a player, so the per-league set is
    // deduped before counting. A roster carrying a duplicate id (Sleeper has
    // shipped that) would otherwise push a share above 100%.
    const countBySleeperId = new Map<string, number>();
    const leaguesBySleeperId = new Map<string, string[]>();
    for (const roster of rosterRows) {
      const leagueName =
        leagueNameById.get(roster.league_id) ?? "Untitled league";
      for (const id of new Set(asIdArray(roster.player_ids))) {
        countBySleeperId.set(id, (countBySleeperId.get(id) ?? 0) + 1);
        const names = leaguesBySleeperId.get(id) ?? [];
        names.push(leagueName);
        leaguesBySleeperId.set(id, names);
      }
    }
    if (countBySleeperId.size === 0) {
      return {
        totalLeagues,
        unsyncedLeagues: Math.max(0, sleeperLeagueIds.length - totalLeagues),
        rows: [],
      };
    }

    const meta = await resolvePlayers(supabase, [...countBySleeperId.keys()]);

    const rows: PlayerExposureRow[] = [...countBySleeperId.entries()].map(
      ([sleeperPlayerId, leagueCount]) => {
        const player = meta.get(sleeperPlayerId);
        return {
          sleeperPlayerId,
          slug: player?.slug ?? null,
          // A player we cannot resolve still counts. Dropping him would quietly
          // shrink a manager's exposure because our player table lagged Sleeper's.
          name: player?.name ?? `Unknown player ${sleeperPlayerId}`,
          position: player?.position ?? null,
          team: player?.team ?? null,
          leagueCount,
          leagueNames: (leaguesBySleeperId.get(sleeperPlayerId) ?? []).sort(
            (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }),
          ),
          sharePct: Math.round((leagueCount / totalLeagues) * 100),
        };
      },
    );

    rows.sort(compareExposure);

    return {
      totalLeagues,
      unsyncedLeagues: Math.max(0, sleeperLeagueIds.length - totalLeagues),
      rows,
    };
  } catch (err) {
    console.warn("[player-exposure] lookup failed:", (err as Error).message);
    return EMPTY_PLAYER_EXPOSURE;
  }
}

/**
 * Most-owned first, then alphabetical.
 *
 * Sorted on the raw count rather than the rounded percentage: 7 of 9 and 8 of 11
 * both round to 78% and are not the same amount of exposure. Ties really are
 * ties, and there the name decides, so the order is stable between renders
 * instead of depending on Map insertion.
 */
export function compareExposure(
  a: Pick<PlayerExposureRow, "leagueCount" | "name">,
  b: Pick<PlayerExposureRow, "leagueCount" | "name">,
): number {
  if (b.leagueCount !== a.leagueCount) return b.leagueCount - a.leagueCount;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

type PlayerMeta = {
  slug: string;
  name: string;
  position: string | null;
  team: string | null;
};

/**
 * Sleeper ids to our player rows.
 *
 * Primary match is external_ids.sleeper; the fallback matches the slug tail,
 * because sync-sleeper-players embeds the Sleeper id there, so a row whose
 * external_ids lost its key still resolves. Same two-way lookup as
 * lib/league-power-rankings.ts, and for the same reason.
 */
async function resolvePlayers(
  supabase: AnySupabase,
  sleeperIds: string[],
): Promise<Map<string, PlayerMeta>> {
  const map = new Map<string, PlayerMeta>();

  for (let i = 0; i < sleeperIds.length; i += RESOLVE_CHUNK) {
    const chunk = sleeperIds.slice(i, i + RESOLVE_CHUNK);
    const ors = chunk
      .flatMap((id) => [`external_ids->>sleeper.eq.${id}`, `slug.like.*-${id}`])
      .join(",");
    const { data, error } = await supabase
      .from("players")
      .select(
        "slug, full_name, first_name, last_name, position, team, external_ids",
      )
      .or(ors);
    if (error) continue;

    for (const p of data ?? []) {
      const ext = (p.external_ids as Record<string, unknown>) ?? {};
      const fromExternal = typeof ext.sleeper === "string" ? ext.sleeper : null;
      const tail = p.slug.match(/-(\d+)$/)?.[1] ?? null;
      const sid = fromExternal ?? tail;
      if (!sid || !chunk.includes(sid) || map.has(sid)) continue;
      map.set(sid, {
        slug: p.slug,
        name:
          p.full_name?.trim() ||
          `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() ||
          p.slug,
        position: p.position ?? null,
        team: p.team ?? null,
      });
    }
  }
  return map;
}
