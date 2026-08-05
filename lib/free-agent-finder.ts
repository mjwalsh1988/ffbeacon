import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Is this player available in any of my leagues?
 *
 * The question is one nobody can answer from inside a single league. A manager
 * in fourteen rooms who hears a name on Sunday morning has to open fourteen
 * waiver pages to find the two where he is sitting there unowned. This answers
 * it once, against every league we already hold rosters for.
 *
 * HOW AVAILABILITY IS DECIDED
 *   There is no "free agents" table and there does not need to be one. A league
 *   is a closed world: every player is either on one of its rosters or he is
 *   not, and not-on-a-roster IS free agency. So the test is membership in the
 *   union of that league's rosters, and the answer is the complement.
 *
 *   `rosters.player_ids` is Sleeper's full `players` array, which already
 *   contains the IR and taxi entries (verified against production: of 1386
 *   stored rosters, 294 carry IR players and 969 carry taxi players, and not one
 *   of those ids is missing from `player_ids`). So one containment check settles
 *   it, and the separate reserve and taxi arrays are read only to say WHICH slot
 *   a rostered player is sitting in.
 *
 * READS ONLY, AND NEVER SYNCS. This touches no Sleeper endpoint. It answers from
 * the rosters already stored, so a league nobody has pulsed is not searched and
 * is reported as unanswered rather than guessed at. Reporting a league as "free
 * agent" because we hold no rosters for it would send someone to a waiver page
 * for a player another team has had since August.
 */

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/** Where a rostered player is sitting. Drives how gettable he actually is. */
export type RosterSlot = "starter" | "reserve" | "taxi" | "bench";

export const ROSTER_SLOT_LABEL: Record<RosterSlot, string> = {
  starter: "Starting",
  reserve: "On IR",
  taxi: "Taxi squad",
  bench: "On the bench",
};

export type FreeAgentLeague = {
  sleeperLeagueId: string;
  leagueName: string;
  /** True when no roster in this league holds him. */
  isFreeAgent: boolean;
  /** The manager holding him. Null when he is free, or when the roster has no owner. */
  rosteredBy: string | null;
  /** True when the roster holding him is the reader's own. */
  isYours: boolean;
  /** Null when he is a free agent. */
  slot: RosterSlot | null;
};

export type FreeAgentReport = {
  /** Every synced league, free agents first. */
  leagues: FreeAgentLeague[];
  freeCount: number;
  rosteredCount: number;
  /** Leagues we hold no rosters for, so the search could not answer them. */
  unsyncedCount: number;
};

export const EMPTY_FREE_AGENT_REPORT: FreeAgentReport = {
  leagues: [],
  freeCount: 0,
  rosteredCount: 0,
  unsyncedCount: 0,
};

/** Ceiling on how many leagues one search will look at. */
export const MAX_SEARCHED_LEAGUES = 200;

/**
 * PostgREST's default page size is 1000 rows, and the synced-league probe below
 * reads one row per roster (twelve or so per league). At the league ceiling that
 * is a couple of thousand rows of a single uuid column, so the default would
 * silently truncate it and report synced leagues as unsynced.
 */
const ROSTER_PROBE_LIMIT = 50000;

/** The roster columns the search reads, for the rosters that actually hold him. */
type RosterHit = {
  league_id: string;
  owner_user_id: string | null;
  starter_ids: unknown;
  reserve_ids: unknown;
  taxi_ids: unknown;
};

/** Sleeper writes "0" into an empty roster slot. It is not a player. */
function validPlayerId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id !== "0";
}

function asIdSet(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.filter(validPlayerId) : []);
}

/**
 * Free agents first, then rostered, alphabetical inside each.
 *
 * The whole point of the panel is the leagues where the answer is yes, so they
 * go on top and the reader never scrolls to find them. Name is the tiebreaker
 * rather than anything about the roster, so two searches for two players list
 * the same leagues in the same order and the reader can compare them.
 */
export function compareFreeAgentLeagues(
  a: FreeAgentLeague,
  b: FreeAgentLeague,
): number {
  if (a.isFreeAgent !== b.isFreeAgent) return a.isFreeAgent ? -1 : 1;
  return a.leagueName.localeCompare(b.leagueName, undefined, {
    sensitivity: "base",
  });
}

/**
 * Which slot a rostered player is in.
 *
 * Checked most specific first. IR before taxi before bench, because a player can
 * appear in `player_ids` and one of the special arrays at the same time, and the
 * special array is the more informative answer.
 */
export function resolveSlot(
  sleeperPlayerId: string,
  roster: {
    starter_ids: unknown;
    reserve_ids: unknown;
    taxi_ids: unknown;
  },
): RosterSlot {
  if (asIdSet(roster.starter_ids).has(sleeperPlayerId)) return "starter";
  if (asIdSet(roster.reserve_ids).has(sleeperPlayerId)) return "reserve";
  if (asIdSet(roster.taxi_ids).has(sleeperPlayerId)) return "taxi";
  return "bench";
}

/**
 * Search every synced league for one player.
 *
 * Never throws. A failed lookup degrades to an empty report, which the panel
 * renders as "we could not search", not as "he is free everywhere".
 */
export async function findFreeAgentLeagues(
  supabase: AnySupabase,
  {
    sleeperPlayerId,
    sleeperLeagueIds,
    sleeperUserId,
  }: {
    sleeperPlayerId: string;
    sleeperLeagueIds: string[];
    /** The reader's own Sleeper id, so their own roster reads as theirs. */
    sleeperUserId: string | null;
  },
): Promise<FreeAgentReport> {
  const wanted = sleeperLeagueIds.slice(0, MAX_SEARCHED_LEAGUES);
  if (wanted.length === 0 || !sleeperPlayerId) return EMPTY_FREE_AGENT_REPORT;

  try {
    const { data: leagueRows } = await supabase
      .from("leagues")
      .select("id, sleeper_league_id, name")
      .in("sleeper_league_id", wanted);
    if (!leagueRows || leagueRows.length === 0) {
      return { ...EMPTY_FREE_AGENT_REPORT, unsyncedCount: wanted.length };
    }

    const leagueByRowId = new Map(
      leagueRows.map((l) => [
        l.id,
        {
          sleeperLeagueId: l.sleeper_league_id,
          name: l.name ?? "Untitled league",
        },
      ]),
    );

    // A league row on its own does not mean we can answer for it. Only stored
    // rosters make the closed-world test valid, so this is what "synced" means
    // here: we hold at least one roster.
    const { data: probeRows } = await supabase
      .from("rosters")
      .select("league_id")
      .in("league_id", [...leagueByRowId.keys()])
      .limit(ROSTER_PROBE_LIMIT);
    const syncedRowIds = new Set((probeRows ?? []).map((r) => r.league_id));
    if (syncedRowIds.size === 0) {
      return { ...EMPTY_FREE_AGENT_REPORT, unsyncedCount: wanted.length };
    }

    // The one query that finds him. `contains` must be handed a JSON STRING for
    // a jsonb column: passing a JS array makes supabase-js emit a Postgres array
    // literal (`cs.{11569}`) and PostgREST answers "invalid input syntax for
    // type json". Verified against production before this shipped.
    const { data: hitRows } = await supabase
      .from("rosters")
      .select("league_id, owner_user_id, starter_ids, reserve_ids, taxi_ids")
      .in("league_id", [...syncedRowIds])
      .contains("player_ids", JSON.stringify([sleeperPlayerId]));

    // One roster per league. A player on two rosters in the same league is a
    // Sleeper data glitch, and either answer to "who has him" is equally true.
    const hitByLeagueRowId = new Map<string, RosterHit>();
    for (const row of hitRows ?? []) {
      if (!hitByLeagueRowId.has(row.league_id)) {
        hitByLeagueRowId.set(row.league_id, row);
      }
    }

    const ownerNames = await resolveOwnerNames(supabase, [
      ...hitByLeagueRowId.entries(),
    ]);

    const leagues: FreeAgentLeague[] = [];
    for (const rowId of syncedRowIds) {
      const league = leagueByRowId.get(rowId);
      if (!league) continue;
      const hit = hitByLeagueRowId.get(rowId);
      leagues.push({
        sleeperLeagueId: league.sleeperLeagueId,
        leagueName: league.name,
        isFreeAgent: !hit,
        rosteredBy: hit ? (ownerNames.get(rowId) ?? null) : null,
        isYours: Boolean(
          hit && sleeperUserId && hit.owner_user_id === sleeperUserId,
        ),
        slot: hit ? resolveSlot(sleeperPlayerId, hit) : null,
      });
    }

    leagues.sort(compareFreeAgentLeagues);

    return {
      leagues,
      freeCount: leagues.filter((l) => l.isFreeAgent).length,
      rosteredCount: leagues.filter((l) => !l.isFreeAgent).length,
      unsyncedCount: Math.max(0, wanted.length - leagues.length),
    };
  } catch (err) {
    console.warn("[free-agent-finder] lookup failed:", (err as Error).message);
    return EMPTY_FREE_AGENT_REPORT;
  }
}

/**
 * The manager holding him, per league, by league row id.
 *
 * Only for the leagues where he was actually found, so this reads a handful of
 * rows rather than every member of every league. `display_name` leads because
 * `team_name` is null on most stored rows; the pair is checked in that order
 * rather than assuming either one is present.
 */
async function resolveOwnerNames(
  supabase: AnySupabase,
  hits: [string, { owner_user_id: string | null }][],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const leagueRowIds = hits
    .filter(([, hit]) => hit.owner_user_id)
    .map(([rowId]) => rowId);
  if (leagueRowIds.length === 0) return names;

  const { data } = await supabase
    .from("league_users")
    .select("league_id, sleeper_user_id, display_name, team_name")
    .in("league_id", leagueRowIds);
  if (!data) return names;

  const byLeagueAndUser = new Map(
    data.map((u) => [
      `${u.league_id}:${u.sleeper_user_id}`,
      u.display_name?.trim() || u.team_name?.trim() || null,
    ]),
  );
  for (const [rowId, hit] of hits) {
    if (!hit.owner_user_id) continue;
    const name = byLeagueAndUser.get(`${rowId}:${hit.owner_user_id}`);
    if (name) names.set(rowId, name);
  }
  return names;
}
