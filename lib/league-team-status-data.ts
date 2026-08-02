/**
 * Read layer for the Competitor / Rebuilder tag on the league list.
 *
 * The list at /tools/league-pulse and on My Beacon shows every league a Sleeper
 * handle belongs to, which can be twenty rooms or more. Calculating Power Pulse
 * for all of them on a page load is not something we will ever do: the model
 * needs projections, a schedule, and a simulation per league. So this reads only
 * what is already in the cache and reports "not yet synced" for the rest, which
 * is exactly the contract in CLAUDE.md for the entry point (no DB writes there).
 *
 * Only the searched user's own team is looked up. That keeps the query to one
 * roster per league, which matters: `league_power_rankings_cache` holds a row
 * per (league, roster, format, source), so filtering to a single roster is the
 * difference between a few dozen rows and several thousand.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { classifyTeamStatus, type TeamStatus } from "@/lib/league-team-status";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export type LeagueTeamStatusSummary = {
  /** Sleeper league id, so callers can key straight off the Sleeper payload. */
  sleeperLeagueId: string;
  /** Null when we hold no Power Pulse row for this user's roster. */
  status: TeamStatus | null;
  /** Sleeper roster id of the searched user's team, when we know it. */
  sleeperRosterId: number | null;
};

const PAGE = 1000;

/**
 * Map of Sleeper league id to the searched user's standing in that league.
 * Leagues we have never pulsed are simply absent from the map, and the UI
 * renders the pending state for them.
 *
 * Never throws. A failed lookup degrades to "nothing synced", which is the same
 * thing the reader sees before their first visit to a league.
 */
export async function loadSearchedTeamStatuses(
  supabase: AnySupabase,
  sleeperLeagueIds: string[],
  sleeperUserId: string,
  season: number,
  sourceSlug: string | null,
): Promise<Map<string, LeagueTeamStatusSummary>> {
  const out = new Map<string, LeagueTeamStatusSummary>();
  if (sleeperLeagueIds.length === 0 || !sleeperUserId) return out;

  try {
    const { data: leagueRows } = await supabase
      .from("leagues")
      .select("id, sleeper_league_id, total_rosters, format_config_id")
      .in("sleeper_league_id", sleeperLeagueIds.slice(0, PAGE));
    if (!leagueRows || leagueRows.length === 0) return out;

    const leagueById = new Map(leagueRows.map((l) => [l.id, l]));

    // The searched user's roster in each league. owner_user_id holds the
    // Sleeper user id verbatim (see lib/league-pulse.ts), so this matches
    // without a join through league_users.
    const { data: rosterRows } = await supabase
      .from("rosters")
      .select("id, league_id, sleeper_roster_id")
      .in("league_id", [...leagueById.keys()])
      .eq("owner_user_id", sleeperUserId);
    if (!rosterRows || rosterRows.length === 0) return out;

    const rosterIds = rosterRows.map((r) => r.id);

    const [pulseRes, valueRes] = await Promise.all([
      supabase
        .from("league_power_pulse_cache")
        .select("roster_id, pulse_rank")
        .eq("season", season)
        .in("roster_id", rosterIds),
      supabase
        .from("league_power_rankings_cache")
        .select("roster_id, format_config_id, source, overall_rank")
        .in("roster_id", rosterIds),
    ]);

    const pulseByRoster = new Map(
      (pulseRes.data ?? []).map((r) => [r.roster_id, r.pulse_rank]),
    );

    // Value rank for the roster, preferring the row that matches both the
    // league's own derived format and the reader's source. A league whose
    // format the source does not cover falls back to any cached row rather than
    // dropping the tag: the rank is close enough for a one-word label, and the
    // full picture is one click away inside the league.
    const valueRowsByRoster = new Map<
      string,
      Array<{ format_config_id: string; source: string; overall_rank: number | null }>
    >();
    for (const row of valueRes.data ?? []) {
      const list = valueRowsByRoster.get(row.roster_id) ?? [];
      list.push({
        format_config_id: row.format_config_id,
        source: row.source,
        overall_rank: row.overall_rank,
      });
      valueRowsByRoster.set(row.roster_id, list);
    }

    for (const roster of rosterRows) {
      const league = leagueById.get(roster.league_id);
      if (!league) continue;

      const pulseRank = pulseByRoster.get(roster.id) ?? null;
      const candidates = valueRowsByRoster.get(roster.id) ?? [];
      const valueRank =
        candidates.find(
          (c) =>
            c.format_config_id === league.format_config_id && c.source === sourceSlug,
        )?.overall_rank ??
        candidates.find((c) => c.format_config_id === league.format_config_id)
          ?.overall_rank ??
        candidates.find((c) => c.source === sourceSlug)?.overall_rank ??
        candidates[0]?.overall_rank ??
        null;

      out.set(league.sleeper_league_id, {
        sleeperLeagueId: league.sleeper_league_id,
        sleeperRosterId: roster.sleeper_roster_id,
        status: classifyTeamStatus({
          pulseRank,
          valueRank,
          teamCount: Number(league.total_rosters ?? 0),
        }),
      });
    }
  } catch (err) {
    console.warn(
      "[league-team-status] summary lookup failed:",
      (err as Error).message,
    );
  }

  return out;
}
