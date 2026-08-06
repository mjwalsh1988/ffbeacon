/**
 * Who can you actually bid on in this league?
 *
 * The calculator used to search the page's ranked list, which is the top 300
 * players by overall rank with no availability filter. That is close to the
 * worst possible list for a FAAB tool for two reasons at once:
 *
 *   - In any real league those 300 are almost all rostered, so nearly every
 *     name you can find is one you cannot bid on.
 *   - The players FAAB actually exists for (the backup who just inherited a
 *     job, the streamer with a good matchup) rank well below 300, so they were
 *     not in the box at all.
 *
 * A league is a closed world: every player is either on one of its rosters or
 * he is not, and not-on-a-roster IS free agency. So this walks the full ranked
 * universe for the reader's format and source, subtracts the union of the
 * league's rosters, and returns what is left. Same reasoning as
 * lib/free-agent-finder.ts, run in the other direction.
 *
 * READ ONLY. Reads stored rosters and never touches Sleeper, so a league nobody
 * has synced returns nothing rather than reporting everyone as available.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { startingSlots } from "@/lib/power-pulse/lineup";
import { PULSE_SLOT_ELIGIBILITY } from "@/lib/power-pulse/types";
import { loadRankedUniverseCached } from "./player-list";

type ServiceClient = SupabaseClient<Database>;

export type FreeAgentOption = {
  slug: string;
  player_id: string;
  name: string;
  position: string;
  team: string | null;
  sleeper_id: string | null;
  overall_rank: number;
  position_rank: number;
  value: number | null;
};

/** Sleeper writes "0" into an empty roster slot. It is not a player. */
function validPlayerId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id !== "0";
}

/**
 * Every rostered Sleeper player id in one league.
 *
 * `rosters.player_ids` is Sleeper's full players array, which already contains
 * the IR and taxi entries, so this one read settles ownership for the whole
 * league. Returns null when we hold no rosters at all: "we do not know" and
 * "nobody owns anyone" must not look the same to the caller.
 */
async function rosteredSleeperIds(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<Set<string> | null> {
  const { data, error } = await supabase
    .from("rosters")
    .select("player_ids")
    .eq("league_id", leagueRowId);
  if (error || !data || data.length === 0) return null;

  const owned = new Set<string>();
  for (const row of data) {
    const ids = Array.isArray(row.player_ids) ? row.player_ids : [];
    for (const id of ids) if (validPlayerId(id)) owned.add(id);
  }
  return owned;
}

export type FreeAgentListResult = {
  players: FreeAgentOption[];
  /** How many ranked players we considered before subtracting rosters. */
  considered: number;
  /** How many were already owned. */
  rostered: number;
  /** The positions this league actually starts, in a stable display order. */
  positions: string[];
};

/** Display order for the position summary, so it never reads shuffled. */
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];

/**
 * Which positions this league can actually start.
 *
 * Read from the league's own `roster_positions`, so a league with no kicker
 * slot never sees a kicker in the search box. Offering one is worse than
 * useless: it invites a bid on a player who can never enter a lineup, and the
 * calculator would then correctly price him at zero, which reads like a bug.
 *
 * Returns null when the shape is unreadable. That means "do not filter" rather
 * than "no positions", because an empty list would hide every player and look
 * far more broken than showing a kicker to a league that does not want one.
 */
function startablePositions(rosterPositions: unknown): Set<string> | null {
  if (!Array.isArray(rosterPositions) || rosterPositions.length === 0) return null;
  const tokens = rosterPositions.filter((t): t is string => typeof t === "string");
  if (tokens.length === 0) return null;

  const positions = new Set<string>();
  for (const slot of startingSlots(tokens)) {
    for (const position of PULSE_SLOT_ELIGIBILITY[slot] ?? []) positions.add(position);
  }
  return positions.size > 0 ? positions : null;
}

/**
 * The players available to bid on, best first.
 *
 * `formatConfigId` and `source` come from the reader's own resolved format and
 * ranking source, so the ranks shown here match the rest of the page.
 */
export async function loadLeagueFreeAgents(
  supabase: ServiceClient,
  {
    leagueRowId,
    formatConfigId,
    source,
  }: { leagueRowId: string; formatConfigId: string; source: string },
): Promise<FreeAgentListResult | null> {
  const [owned, { data: leagueRow }] = await Promise.all([
    rosteredSleeperIds(supabase, leagueRowId),
    supabase.from("leagues").select("roster_positions").eq("id", leagueRowId).maybeSingle(),
  ]);
  if (owned === null) return null;

  const allowed = startablePositions(leagueRow?.roster_positions);

  // Cached: the same for every reader on this format and source, refreshed
  // nightly. Ownership above is always read live, so a waiver that cleared five
  // minutes ago is still reflected.
  const rows = await loadRankedUniverseCached({ formatConfigId, source });

  const players: FreeAgentOption[] = [];
  let rostered = 0;

  for (const row of rows) {
    // A player with no Sleeper mapping cannot be matched against a roster, and
    // league mode cannot price him either, so he is not offered here at all.
    if (!row.sleeperId) continue;

    // A position this league never starts is not a bid, whatever his ranking
    // says. Filtered before the ownership check so an unstartable position does
    // not inflate the "already rostered" count either.
    if (allowed && !allowed.has(row.position)) continue;

    if (owned.has(row.sleeperId)) {
      rostered += 1;
      continue;
    }
    players.push({
      slug: row.slug,
      player_id: row.playerId,
      name: row.name,
      position: row.position,
      team: row.team,
      sleeper_id: row.sleeperId,
      overall_rank: row.overallRank,
      position_rank: row.positionRank,
      value: null,
    });
  }

  // When the shape was unreadable we filtered nothing, so report what actually
  // came back rather than claiming a lineup we did not read.
  const positions = allowed
    ? POSITION_ORDER.filter((p) => allowed.has(p))
    : POSITION_ORDER.filter((p) => players.some((entry) => entry.position === p));

  return { players, considered: rows.length, rostered, positions };
}
