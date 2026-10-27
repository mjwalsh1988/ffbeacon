import "server-only";

/**
 * Every read behind Leaderboards. Nothing here writes and nothing here calls
 * Sleeper: the matchup rows come from the league sync and the stat lines from
 * the nightly stats sync.
 *
 * REUSED, NOT REWRITTEN. The league, the rosters and the players come through
 * lib/power-pulse/load.ts and the settled weeks through
 * lib/manager-ledger/load.ts, the same reads Power Pulse and the Manager Ledger
 * make, so a team name or a week's score cannot differ between those pages and
 * this one.
 *
 * THE STAT LINES ARE CACHED BY WEEK, NOT BY LEAGUE. Every league reads the same
 * NFL week, and scoring it is a dot product per player done here in memory, so
 * one cached week (about half a megabyte) serves every league on the site. A
 * whole season in one entry would pass the 2 MB cache item limit by December.
 * The stats sync busts the `playerStats` tag, and the daily revalidate is the
 * backstop for a night it did not run.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache-tags";
import { createAdminClient, createCachedReadClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { cached } from "@/lib/season-pulse/load";
import { isNonScoringKey } from "@/lib/league-scoring";
import { loadLeague, loadPlayers, loadRosters, NAMING_POSITIONS } from "@/lib/power-pulse/load";
import { buildIneligibleIds, loadSettledWeeks } from "@/lib/manager-ledger/load";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { idpEnabledFrom } from "@/lib/power-pulse/default-settings";
import { buildLeaderboards, type WeekStatLine } from "./build";
import { leaguePositions } from "./positions";
import type { LeaderboardPlayer, LeaderboardsView } from "./types";

type ServiceClient = SupabaseClient<Database>;

/**
 * Sleeper's own point totals and rankings on a line (pts_ppr, pts_idp,
 * pos_rank_ppr...), which a league never scores. NOT every "pts_" key: a team
 * defense's points-allowed buckets (pts_allow_0, pts_allow_1_6 and so on) are
 * real scoring keys, and dropping them scored a free agent defense's shutout
 * ten points low.
 */
function isSleeperDerivedKey(key: string): boolean {
  if (isNonScoringKey(key)) return true;
  return key.startsWith("pts_") && !key.startsWith("pts_allow");
}

type RawLine = {
  id: string;
  stats: Record<string, unknown> | null;
  players: { sleeper_id: string | null } | null;
};

/**
 * One NFL week of actual stat lines, for every player at a position League
 * Pulse can name. `gp > 0` is what makes a row a game: Sleeper stores a row
 * for an inactive player too. Only the scorable numbers are kept, which is
 * what keeps a week inside one cache entry.
 *
 * Exported for the paging test; callers use loadWeekLinesCached.
 */
export async function readWeekLines(season: number, week: number): Promise<WeekStatLine[]> {
  const supabase = createCachedReadClient();
  const raw = await fetchAllRows<RawLine>(`leaderboards week ${week} lines`, (from, to) =>
    supabase
      .from("player_stats")
      .select("id, stats:metadata->stats, players!inner(sleeper_id:external_ids->>sleeper)")
      .eq("season", season)
      .eq("season_type", "regular")
      .eq("week", week)
      .gt("gp", 0)
      .in("players.position", [...NAMING_POSITIONS])
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: RawLine[] | null; error: { message: string } | null }>,
  );

  const out: WeekStatLine[] = [];
  for (const row of raw) {
    const sleeperId = row.players?.sleeper_id;
    if (!sleeperId || !row.stats || typeof row.stats !== "object") continue;
    const stats: Record<string, number> = {};
    for (const [key, value] of Object.entries(row.stats)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value === 0) continue;
      if (isSleeperDerivedKey(key)) continue;
      stats[key] = value;
    }
    out.push({ sleeperId, stats });
  }
  return out;
}

const loadWeekLinesCached = cached("leaderboards-week-lines-v2", readWeekLines, {
  revalidate: CACHE_TTL.daily,
  tags: [CACHE_TAGS.playerStats],
});

/**
 * The whole view for one league, or null when the league row is missing.
 * `week` is a request; the builder falls back to the season when that week has
 * not settled. "latest" is the most recent settled week, which is what the
 * Overview card shows, resolved here so it never computes a season to find it.
 */
export async function loadLeaderboards(
  admin: ServiceClient,
  leagueRowId: string,
  opts: { week: number | null | "latest" },
): Promise<LeaderboardsView | null> {
  const [league, settings, rosters] = await Promise.all([
    loadLeague(admin, leagueRowId),
    loadPowerPulseSettings(admin),
    loadRosters(admin, leagueRowId),
  ]);
  if (!league) return null;

  // IR and the taxi squad, so "Bench heroes" never lists a player the manager
  // could not have started. These are today's lists (Sleeper keeps no weekly
  // history of them), the same limitation the Manager Ledger states.
  const weeks = await loadSettledWeeks(admin, leagueRowId, league.season, buildIneligibleIds(rosters));
  const settled = [...new Set(weeks.map((w) => w.week))].sort((a, b) => a - b);
  const week = opts.week === "latest" ? (settled[settled.length - 1] ?? null) : opts.week;
  // Only the weeks in scope are scored, so one week reads one cached week.
  const needed = week !== null && settled.includes(week) ? [week] : settled;
  const { positions, dedicatedSlots } = leaguePositions(
    league.rosterPositions,
    idpEnabledFrom(settings),
    league.scoringSettings,
  );

  const lines = await Promise.all(needed.map((w) => loadWeekLinesCached(league.season, w)));
  const statLines = new Map(needed.map((w, i) => [w, lines[i]]));

  const currentRosters = new Map<string, number>();
  for (const roster of rosters) {
    for (const sid of roster.playerSleeperIds) currentRosters.set(sid, roster.sleeperRosterId);
  }

  const ids = new Set<string>(currentRosters.keys());
  for (const w of weeks) {
    if (!needed.includes(w.week)) continue;
    for (const sid of w.playerPoints.keys()) ids.add(sid);
  }
  for (const list of lines) for (const line of list) ids.add(line.sleeperId);
  const rows = await loadPlayers(admin, [...ids], { positions });
  const players = new Map<string, LeaderboardPlayer>();
  for (const [sid, row] of rows) {
    players.set(sid, {
      sleeperId: sid,
      name: row.name,
      slug: row.slug ?? null,
      position: row.position,
      nflTeam: row.team,
    });
  }

  return buildLeaderboards({
    season: league.season,
    weeks,
    statLines,
    players,
    teams: rosters.map((r) => ({
      sleeperRosterId: r.sleeperRosterId,
      teamName: r.teamName,
      ownerHandle: r.ownerHandle,
      avatarId: r.ownerAvatarId,
    })),
    currentRosters,
    scoring: league.scoringSettings,
    positions,
    dedicatedSlots,
    // A chopped league has no bracket. Every other league has one, at
    // Sleeper's default week when the commissioner never set it.
    playoffWeekStart: league.chopped ? null : league.playoffWeekStart,
    bestBall: league.bestBall === true,
    week,
  });
}

/**
 * Whether one week has final results in this league, read live.
 *
 * Asked BEFORE a single week's view is built. The builder falls back to the
 * whole season for a week that has not settled and would cache that season
 * under the week's key, so a link to week 20 would buy a season build per
 * cache window. This is one head-only count, never cached, so a week that
 * settled a minute ago is never refused because a cached view has not caught
 * up yet. The same filter as loadSettledWeeks: league, season, week, final.
 */
export async function isWeekSettled(leagueRowId: string, season: number, week: number): Promise<boolean> {
  const { count, error } = await createAdminClient()
    .from("league_matchups")
    .select("id", { count: "exact", head: true })
    .eq("league_id", leagueRowId)
    .eq("season", season)
    .eq("week", week)
    .eq("is_final", true);
  // On a failed count, let the build decide rather than refusing a real week.
  if (error) return true;
  return (count ?? 0) > 0;
}

/** How long an assembled view is reused. Owners change with every claim, so short. */
export const LEADERBOARDS_VIEW_TTL_S = 600;

type WeekKey = "season" | "latest" | number;

async function readView(leagueRowId: string, weekKey: WeekKey): Promise<LeaderboardsView | null> {
  const week = weekKey === "season" ? null : weekKey;
  return loadLeaderboards(createAdminClient(), leagueRowId, { week });
}

const readViewCached = cached("leaderboards-view", readView, {
  revalidate: LEADERBOARDS_VIEW_TTL_S,
  tags: [CACHE_TAGS.playerStats],
});

/**
 * The assembled view, cached per (league, week) for ten minutes.
 *
 * A season view reads every settled week and scores a few thousand lines, so
 * without this a reader paging between weeks, or a crawler fetching share
 * images, would rebuild it on every request. Ten minutes is the staleness a
 * reader can see in "whose roster is he on today" after a waiver claim; the
 * points themselves only move when a week settles.
 */
export function loadLeaderboardsCached(
  leagueRowId: string,
  week: number | null | "latest",
): Promise<LeaderboardsView | null> {
  return readViewCached(leagueRowId, week === null ? "season" : week);
}
