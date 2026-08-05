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

/** One league a player is rostered in, carrying enough to link to its deep view. */
export type ExposureLeague = {
  sleeperLeagueId: string;
  name: string;
};

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
  /** Those leagues, alphabetical, for the row's expandable detail. */
  leagues: ExposureLeague[];
  /** leagueCount / totalLeagues as a percentage, 0 to 100, rounded. */
  sharePct: number;
  /** 1-based standing on leagueCount. Ties share a number (1, 2, 2, 4). */
  rank: number;
  /** True when at least one other player holds the same rank. Shown as "T2". */
  tied: boolean;
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

    const leagueById = new Map<string, ExposureLeague>(
      leagueRows.map((l) => [
        l.id,
        {
          sleeperLeagueId: l.sleeper_league_id,
          name: l.name ?? "Untitled league",
        },
      ]),
    );

    // owner_user_id holds the Sleeper user id verbatim (see lib/league-pulse.ts),
    // so this finds the manager's own roster without joining league_users.
    const { data: rosterRows } = await supabase
      .from("rosters")
      .select("league_id, player_ids")
      .in("league_id", [...leagueById.keys()])
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
    const leaguesBySleeperId = new Map<string, ExposureLeague[]>();
    for (const roster of rosterRows) {
      const league = leagueById.get(roster.league_id);
      if (!league) continue;
      for (const id of new Set(asIdArray(roster.player_ids))) {
        countBySleeperId.set(id, (countBySleeperId.get(id) ?? 0) + 1);
        const owned = leaguesBySleeperId.get(id) ?? [];
        owned.push(league);
        leaguesBySleeperId.set(id, owned);
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

    const unranked = [...countBySleeperId.entries()].map(
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
          leagues: (leaguesBySleeperId.get(sleeperPlayerId) ?? []).sort(
            (a, b) =>
              a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
          ),
          sharePct: Math.round((leagueCount / totalLeagues) * 100),
        };
      },
    );

    unranked.sort(compareExposure);

    return {
      totalLeagues,
      unsyncedLeagues: Math.max(0, sleeperLeagueIds.length - totalLeagues),
      rows: assignExposureRanks(unranked),
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

/**
 * Number the sorted rows, ties included.
 *
 * Competition ranking, the one every scoreboard uses: two players on nine
 * leagues are both 2nd and the next player is 4th. Sequential numbering would
 * put one of those two ahead of the other on nothing but alphabetical order,
 * which is a real claim the data does not support.
 *
 * The rank is assigned to the whole list once, on the server, so a search in the
 * panel narrows what is on screen without renumbering it. A player who is 3rd
 * stays 3rd when you filter down to him.
 *
 * Expects rows already ordered by compareExposure.
 */
export function assignExposureRanks<T extends { leagueCount: number }>(
  rows: T[],
): (T & { rank: number; tied: boolean })[] {
  let rank = 0;
  return rows.map((row, i) => {
    // Only a new count advances the number, so a run of equal counts keeps the
    // rank of the row that opened it and the next distinct count skips ahead.
    if (i === 0 || rows[i - 1].leagueCount !== row.leagueCount) rank = i + 1;
    const tied =
      rows[i - 1]?.leagueCount === row.leagueCount ||
      rows[i + 1]?.leagueCount === row.leagueCount;
    return { ...row, rank, tied };
  });
}

/** What a query hit on one row. Rows that hit nothing are not returned. */
export type ExposureMatch = {
  row: PlayerExposureRow;
  /** The query hit the player's own name, position, or team. */
  matchedPlayer: boolean;
  /** Leagues of theirs whose name contains the query. */
  matchedLeagues: number;
};

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Narrow the table to a typed query.
 *
 * Matches the player and the leagues he is in, because both are things a
 * manager types into this box: "Nacua" to find one player, "Dynasty" to find
 * everyone on one roster. A row that matched only on a league name reports that
 * separately so the panel can say why an unrelated-looking player is on screen.
 *
 * Substring, not fuzzy. Someone typing three letters of a surname wants the
 * players containing those letters, and a fuzzy matcher would hand back a
 * ranked list they then have to read past.
 */
export function searchExposureRows(
  rows: PlayerExposureRow[],
  query: string,
): ExposureMatch[] {
  const q = normalizeQuery(query);
  if (!q) {
    return rows.map((row) => ({
      row,
      matchedPlayer: false,
      matchedLeagues: 0,
    }));
  }

  const matches: ExposureMatch[] = [];
  for (const row of rows) {
    const matchedPlayer = [row.name, row.position, row.team].some(
      (field) => field && field.toLowerCase().includes(q),
    );
    const matchedLeagues = row.leagues.filter((l) =>
      l.name.toLowerCase().includes(q),
    ).length;
    if (matchedPlayer || matchedLeagues > 0) {
      matches.push({ row, matchedPlayer, matchedLeagues });
    }
  }
  return matches;
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
