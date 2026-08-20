/**
 * Read layer for the Competitor / Rebuilder tag on the league list, and for the
 * figure that now sits beside it.
 *
 * The list at /tools/league-pulse and on My Beacon shows every league a Sleeper
 * handle belongs to, which can be twenty rooms or more. Calculating Power Pulse
 * for all of them on a page load is not something we will ever do: the model
 * needs projections, a schedule, and a simulation per league. So this reads only
 * what is already in the cache and reports "not yet synced" for the rest, which
 * is exactly the contract in CLAUDE.md for the entry point (no DB writes there).
 *
 * Two numbers come back per league beyond the tag itself:
 *
 *   - The projected finish. Ordered by expected wins across the whole league,
 *     the same order the Projected final standings table on the Power Pulse page
 *     uses, because that is the number that answers "where do I end up". It is
 *     NOT pulse_rank: a strong roster with a hard schedule finishes below where
 *     its Power Pulse sits, and that gap is the point.
 *   - The roster's total trade value and its rank, for rebuilders, whose story
 *     is what they own rather than what they will win.
 *
 * Query shape. The value read stays filtered to the searched user's own rosters,
 * which matters: `league_power_rankings_cache` holds a row per (league, roster,
 * format, source), so one roster is the difference between a few dozen rows and
 * several thousand. The Power Pulse read cannot be, because a finish is a
 * position among the league's other teams, so it pulls every roster's row for
 * these leagues. That table holds exactly one row per (league, roster, season),
 * so the cost is teams-per-league, not formats times sources.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { classifyTeamStatus, type TeamStatus } from "@/lib/league-team-status";
import { compareProjectedFinish } from "@/lib/power-pulse/projected-order";

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
  /**
   * Projected finish, 1 for the projected champion. Ordered by expected wins,
   * matching components/power-pulse/projected-standings.tsx. Null when this
   * league has no Power Pulse rows.
   */
  projectedSeed: number | null;
  /** How many teams that finish is out of, counting only teams we ranked. */
  rankedTeamCount: number | null;
  /** Trade-value rank within the league. Null when no cached row applies. */
  valueRank: number | null;
  /** Total roster trade value backing that rank. */
  totalValue: number | null;
  /**
   * True when the value figures come from a row matching BOTH the league's own
   * derived format and the reader's source.
   *
   * False means we fell back. Around a fifth of synced leagues have no
   * `format_config_id` at all (Sleeper scoring that maps to none of the active
   * formats, the "Unmatched" case), and those can never produce an exact match.
   *
   * The number is shown either way. Withholding it was the wrong call: a
   * Rebuilder's whole story is what the roster is worth, and a fifth of them
   * were getting a projected finish instead, which is the one number a rebuild
   * is not measured by. The tag beside it was already quoting a rank from this
   * same fallback, so refusing to print the value only meant naming a rank whose
   * number was hidden. Callers use this to say the figure is our closest match
   * rather than an exact one.
   */
  valueIsExact: boolean;
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

    const [pulseRows, valueRes] = await Promise.all([
      // Every roster in these leagues, not just ours: a projected finish is a
      // position among the others. Paged, because a heavy Sleeper user across
      // twenty-plus leagues clears the 1000-row default in one query.
      fetchAllPulseRows(supabase, [...leagueById.keys()], season),
      supabase
        .from("league_power_rankings_cache")
        .select("roster_id, format_config_id, source, overall_rank, total_value")
        .in("roster_id", rosterIds),
    ]);

    // Group by league, then order by expected wins. Same comparator as the
    // Projected final standings table, so a reader who opens the league sees the
    // same number this row promised them.
    const pulseByLeague = new Map<string, PulseRow[]>();
    for (const row of pulseRows) {
      const list = pulseByLeague.get(row.league_id) ?? [];
      list.push(row);
      pulseByLeague.set(row.league_id, list);
    }
    const seedByRoster = new Map<string, { seed: number; of: number }>();
    const pulseRankByRoster = new Map<string, number | null>();
    for (const [, rows] of pulseByLeague) {
      const ordered = [...rows].sort((a, b) =>
        compareProjectedFinish(
          {
            projectedWins: a.projected_wins,
            expectedPointsPerWeek: a.expected_points_per_week,
            rosterId: a.roster_id,
          },
          {
            projectedWins: b.projected_wins,
            expectedPointsPerWeek: b.expected_points_per_week,
            rosterId: b.roster_id,
          },
        ),
      );
      ordered.forEach((row, i) => {
        seedByRoster.set(row.roster_id, { seed: i + 1, of: ordered.length });
        pulseRankByRoster.set(row.roster_id, row.pulse_rank);
      });
    }

    // Value rows for the roster, keyed so we can tell an exact
    // format-and-source match from a near miss. The near miss still backs the
    // tag; only the exact match is allowed to print a number.
    const valueRowsByRoster = new Map<
      string,
      Array<{
        format_config_id: string;
        source: string;
        overall_rank: number | null;
        total_value: number | null;
      }>
    >();
    for (const row of valueRes.data ?? []) {
      const list = valueRowsByRoster.get(row.roster_id) ?? [];
      list.push({
        format_config_id: row.format_config_id,
        source: row.source,
        overall_rank: row.overall_rank,
        total_value: row.total_value,
      });
      valueRowsByRoster.set(row.roster_id, list);
    }

    for (const roster of rosterRows) {
      const league = leagueById.get(roster.league_id);
      if (!league) continue;

      const pulseRank = pulseRankByRoster.get(roster.id) ?? null;
      const candidates = valueRowsByRoster.get(roster.id) ?? [];

      // Sorted before the search so the last-resort pick is stable. Without it
      // the "anything" branch returns whatever PostgREST happened to order
      // first, which can differ between two renders of the same row.
      const sorted = [...candidates].sort(
        (a, b) =>
          a.source.localeCompare(b.source) ||
          a.format_config_id.localeCompare(b.format_config_id),
      );

      const exact =
        sorted.find(
          (c) =>
            c.format_config_id === league.format_config_id &&
            c.source === sourceSlug,
        ) ?? null;

      // ONE row now backs both the tag and the printed figure. They used to
      // disagree: the tag walked this chain while the figure insisted on
      // `exact`, so a row could say "3rd by value" and then decline to show the
      // value it had just ranked.
      //
      // League format first, then the reader's source, then anything at all,
      // because an Unmatched league (no format_config_id) can never match on
      // format and still deserves its number.
      const chosen =
        exact ??
        sorted.find((c) => c.format_config_id === league.format_config_id) ??
        sorted.find((c) => c.source === sourceSlug) ??
        sorted[0] ??
        null;

      const seed = seedByRoster.get(roster.id) ?? null;

      out.set(league.sleeper_league_id, {
        sleeperLeagueId: league.sleeper_league_id,
        sleeperRosterId: roster.sleeper_roster_id,
        projectedSeed: seed?.seed ?? null,
        rankedTeamCount: seed?.of ?? null,
        valueRank: chosen?.overall_rank ?? null,
        totalValue: chosen?.total_value ?? null,
        valueIsExact: chosen !== null && chosen === exact,
        status: classifyTeamStatus({
          pulseRank,
          valueRank: chosen?.overall_rank ?? null,
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

type PulseRow = {
  league_id: string;
  roster_id: string;
  pulse_rank: number | null;
  projected_wins: number | null;
  expected_points_per_week: number | null;
};

/**
 * Every Power Pulse row for these leagues in this season, paged.
 *
 * Supabase caps an unpaged select at 1000 rows and says nothing when it
 * truncates. One row per (league, roster, season) means a user in ninety
 * twelve-team leagues would silently lose the tail, and a missing row does not
 * read as missing: it reads as a wrong finish, because the seeds below the cut
 * shift up. Hence the explicit range walk.
 */
async function fetchAllPulseRows(
  supabase: AnySupabase,
  leagueRowIds: string[],
  season: number,
): Promise<PulseRow[]> {
  const rows: PulseRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("league_power_pulse_cache")
      .select("league_id, roster_id, pulse_rank, projected_wins, expected_points_per_week")
      .eq("season", season)
      .in("league_id", leagueRowIds)
      // A stable total order is what makes paging sound. Without it Postgres is
      // free to return rows in a different order per page, which drops some and
      // repeats others.
      .order("league_id", { ascending: true })
      .order("roster_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}
