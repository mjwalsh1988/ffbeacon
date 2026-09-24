/**
 * The defender profile's data (plan IDP-202, R-14, R-16).
 *
 * A defender's page is not the offensive page with zeros in it. It reads the
 * typed IDP columns on player_stats (migration 0296), the season rows in
 * player_idp_seasons (0299), the idp123 finishes (0298), the defender's own
 * projection lines, and the idp123 accuracy record.
 *
 * IT RETURNS STAT LINES, NEVER POINTS. Points depend on scoring, and the page
 * lets a reader pick the scoring (Sleeper default, Big 3, FantasyPros, ESPN,
 * or one of their own IDP leagues), so every figure is scored in the browser
 * from the lines through lib/idp/stat-line.ts scoreIdpLine. The one exception
 * is the stored finish, which the nightly rebuild ranks on idp123 and which
 * the page labels as such.
 *
 * Never names a stored points column: lib/idp/points-guard.test.ts scans every
 * file under lib/player-profile/ whose name starts with "defender". Offensive
 * point columns are meaningless on a defender row.
 *
 * Reader leagues (R-16) are read OUTSIDE any shared cache, through the saved
 * Sleeper handle, because they belong to one reader.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { normalizeProjectedIdpLine, type StatLine } from "@/lib/idp/stat-line";
import { IDP_SCORING_KEYS } from "@/lib/idp/scoring-presets";
import { fetchAllRows, fetchAllRowsInChunks } from "@/lib/supabase/fetch-all";

type Db = SupabaseClient<Database>;

/** The stat columns a defender row carries, in display order. */
export const DEFENDER_LINE_KEYS = [
  ...IDP_SCORING_KEYS,
  "bonus_tkl_10p",
  "bonus_sack_2p",
] as const;

const LINE_SELECT = DEFENDER_LINE_KEYS.join(", ");

/** One week in the game log. */
export type DefenderWeek = {
  week: number;
  opponent: string | null;
  /**
   * played: a stat row with defensive snaps. special: a stat row with no
   * defensive snap (special teams only). bye: the team did not play.
   * upcoming: not played yet. missed: the team played and he has no row, or
   * his row is Sleeper's inactive placeholder (gp 0, no snaps).
   */
  status: "played" | "special" | "bye" | "upcoming" | "missed";
  snaps: number | null;
  teamSnaps: number | null;
  snapPct: number | null;
  line: StatLine;
  /** The published projection for the week, idp_* keys only, or null. */
  projected: StatLine | null;
};

/** One regular season from player_idp_seasons. */
export type DefenderSeason = {
  season: number;
  position: string;
  games: number;
  games20: number;
  avgSnapPct: number | null;
  line: StatLine;
};

export type DefenderFinish = {
  season: number;
  finish: number;
  totalPoints: number;
  playersRanked: number;
};

export type DefenderAccuracy = {
  season: number | null;
  weeksPlayed: number;
  weeksBeat: number;
  beatRate: number;
};

export type DefenderProfileData = {
  /** The season the game log shows. */
  season: number;
  weeks: DefenderWeek[];
  seasons: DefenderSeason[];
  /** idp123 finishes, newest first. */
  finishes: DefenderFinish[];
  /** The next unplayed week with a published projection, or null. */
  nextWeek: DefenderWeek | null;
  /** Career idp123 accuracy (all seasons blended), or null when none exists. */
  accuracy: DefenderAccuracy | null;
  /** Which projection engine the lines came from. */
  projectionSource: string;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The typed IDP columns of a row as a line, absent columns left out. */
export function lineFromColumns(row: Record<string, unknown>): StatLine {
  const out: StatLine = {};
  for (const key of DEFENDER_LINE_KEYS) {
    const value = num(row[key]);
    if (value !== null) out[key] = value;
  }
  return out;
}

type StatWeekRow = {
  week: number;
  opponent: string | null;
  snaps: number | null;
  teamSnaps: number | null;
  snapPct: number | null;
  line: StatLine;
  /**
   * Sleeper's gp for the row. Sleeper writes a row for an INACTIVE player too
   * (team snap counts only, no gp), so a row alone is not a game played. Absent
   * means unknown and is read as played, which keeps older callers unchanged.
   */
  gamesPlayed?: number | null;
};

type ProjectionWeekRow = { week: number; opponent: string | null; line: StatLine | null };

/**
 * Every regular-season week of one season, in order, from the pieces the
 * loader read. Pure, so the status rules are testable without a database.
 *
 * `teamWeeks` is the team's slate: week to opponent for every week the team
 * has a game. A week absent from it is a bye only when the slate reaches
 * that week at all (`slateWeeks`), the same rule lib/season-schedule.ts uses
 * so an unsynced week never reads as a bye.
 */
export function buildDefenderWeeks(input: {
  stats: StatWeekRow[];
  projections: ProjectionWeekRow[];
  teamWeeks: Map<number, string | null>;
  slateWeeks: Set<number>;
  /** Weeks at or below this have been played by his team (league-wide when the team is unknown). */
  lastPlayedWeek: number;
  maxWeek?: number;
}): DefenderWeek[] {
  const maxWeek = input.maxWeek ?? 18;
  const statByWeek = new Map(input.stats.map((s) => [s.week, s]));
  const projByWeek = new Map(input.projections.map((p) => [p.week, p]));
  const out: DefenderWeek[] = [];
  for (let week = 1; week <= maxWeek; week++) {
    const stat = statByWeek.get(week);
    const proj = projByWeek.get(week);
    const opponent =
      stat?.opponent ?? proj?.opponent ?? input.teamWeeks.get(week) ?? null;
    const projected = proj?.line && Object.keys(proj.line).length > 0 ? proj.line : null;
    if (stat) {
      const onField = stat.snaps !== null && stat.snaps > 0;
      const dressed = stat.gamesPlayed === undefined || stat.gamesPlayed === null || stat.gamesPlayed > 0;
      out.push({
        week,
        opponent,
        status: onField ? "played" : dressed ? "special" : "missed",
        snaps: stat.snaps,
        teamSnaps: stat.teamSnaps,
        snapPct: stat.snapPct,
        line: stat.line,
        projected,
      });
      continue;
    }
    const teamPlays = input.teamWeeks.has(week);
    const isBye = !teamPlays && input.slateWeeks.has(week) && !proj;
    let status: DefenderWeek["status"];
    if (isBye) status = "bye";
    else if (week <= input.lastPlayedWeek) status = "missed";
    else status = "upcoming";
    out.push({
      week,
      opponent: isBye ? null : opponent,
      status,
      snaps: null,
      teamSnaps: null,
      snapPct: null,
      line: {},
      projected,
    });
  }
  return out;
}

/** The first week still to come that carries a projection. */
export function nextProjectedWeek(weeks: DefenderWeek[]): DefenderWeek | null {
  return weeks.find((w) => w.status === "upcoming" && w.projected !== null) ?? null;
}

/**
 * Load everything the defender page shows. Every read names its season,
 * position scope and, for projections and accuracy, its source (CLAUDE.md,
 * projection engine source rule).
 */
export async function loadDefenderProfile(
  supabase: Db,
  player: { id: string; team: string | null },
  opts: { season: number; projectionSource: string },
): Promise<DefenderProfileData> {
  const { season, projectionSource } = opts;

  const emptySlate = {
    teamWeeks: new Map<number, string | null>(),
    slateWeeks: new Set<number>(),
  };
  const [statsRes, projRes, seasonsRes, finishesRes, accuracyRes, playedRes, teamPlayedRes, slate] = await Promise.all([
    supabase
      .from("player_stats")
      .select(`week, opponent, gp, def_snp, tm_def_snp, def_snap_pct, ${LINE_SELECT}`)
      .eq("player_id", player.id)
      .eq("season", season)
      .eq("season_type", "regular")
      .order("week", { ascending: true }),
    supabase
      .from("player_weekly_projections")
      .select("week, opponent, stat_line")
      .eq("player_id", player.id)
      .eq("season", season)
      .eq("season_type", "regular")
      .eq("source", projectionSource)
      .order("week", { ascending: true }),
    supabase
      .from("player_idp_seasons")
      .select(`season, position, games, games_20_snaps, avg_def_snap_pct, ${LINE_SELECT}`)
      .eq("player_id", player.id)
      .eq("season_type", "regular")
      .order("season", { ascending: false }),
    supabase
      .from("player_positional_finishes")
      .select("season, finish, total_points, players_ranked")
      .eq("player_id", player.id)
      .eq("scoring", "idp123")
      .order("season", { ascending: false }),
    supabase
      .from("player_projection_accuracy")
      .select("season, weeks_played, weeks_beat, beat_rate")
      .eq("player_id", player.id)
      .eq("scoring", "idp123")
      .eq("source", projectionSource)
      .is("season", null)
      .maybeSingle(),
    // The latest regular-season week anyone has a stat row for this season:
    // weeks at or below it have been played, so a missing row there is a
    // missed game rather than a game to come.
    supabase
      .from("player_stats")
      .select("week")
      .eq("season", season)
      .eq("season_type", "regular")
      .order("week", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // The latest week HIS TEAM has a stat row for. Sleeper writes a row for
    // every rostered player once a game is final (inactive ones included), so
    // this is the week his team last played. Without it, a Thursday game puts
    // the league-wide latest week ahead of every Sunday team and each of their
    // defenders reads "Did not play" until the next sync. Uses
    // idx_stats_week backwards; measured at 4 ms.
    player.team
      ? supabase
          .from("player_stats")
          .select("week")
          .eq("season", season)
          .eq("season_type", "regular")
          .filter("metadata->>team", "eq", player.team)
          .order("week", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    player.team ? loadTeamSlate(supabase, player.team, season, projectionSource) : Promise.resolve(emptySlate),
  ]);

  const stats: StatWeekRow[] = (statsRes.data ?? []).map((r) => {
    const row = r as unknown as Record<string, unknown>;
    return {
      week: Number(row.week),
      opponent: (row.opponent as string | null) ?? null,
      snaps: num(row.def_snp),
      teamSnaps: num(row.tm_def_snp),
      snapPct: num(row.def_snap_pct),
      line: lineFromColumns(row),
      gamesPlayed: num(row.gp),
    };
  });

  const projections: ProjectionWeekRow[] = (projRes.data ?? []).map((r) => ({
    week: Number(r.week),
    opponent: r.opponent ?? null,
    line: r.stat_line
      ? normalizeProjectedIdpLine(r.stat_line as Record<string, unknown>)
      : null,
  }));

  const weeks = buildDefenderWeeks({
    stats,
    projections,
    teamWeeks: slate.teamWeeks,
    slateWeeks: slate.slateWeeks,
    lastPlayedWeek: num(teamPlayedRes.data?.week) ?? num(playedRes.data?.week) ?? 0,
  });

  const seasons: DefenderSeason[] = (seasonsRes.data ?? []).map((r) => {
    const row = r as unknown as Record<string, unknown>;
    return {
      season: Number(row.season),
      position: String(row.position),
      games: Number(row.games ?? 0),
      games20: Number(row.games_20_snaps ?? 0),
      avgSnapPct: num(row.avg_def_snap_pct),
      line: lineFromColumns(row),
    };
  });

  const finishes: DefenderFinish[] = (finishesRes.data ?? []).map((r) => ({
    season: Number(r.season),
    finish: Number(r.finish),
    totalPoints: Number(r.total_points),
    playersRanked: Number(r.players_ranked),
  }));

  const acc = accuracyRes.data;
  const accuracy: DefenderAccuracy | null =
    acc && num(acc.beat_rate) !== null && Number(acc.weeks_played) > 0
      ? {
          season: acc.season,
          weeksPlayed: Number(acc.weeks_played),
          weeksBeat: Number(acc.weeks_beat),
          beatRate: Number(acc.beat_rate),
        }
      : null;

  return {
    season,
    weeks,
    seasons,
    finishes,
    nextWeek: nextProjectedWeek(weeks),
    accuracy,
    projectionSource,
  };
}

/**
 * The team's slate for one season, from its players' projection rows.
 *
 * nfl_game_odds only covers weeks a book has priced, so it cannot say which
 * week is a bye in week 3. The projection feed covers the whole regular
 * season for every team, so "does anyone on this team have a row in week N"
 * is the slate. `slateWeeks` is every week ANY team has a row, which is what
 * lets an absent week read as a bye rather than as a hole in the feed.
 */
async function loadTeamSlate(
  supabase: Db,
  team: string,
  season: number,
  source: string,
): Promise<{ teamWeeks: Map<number, string | null>; slateWeeks: Set<number> }> {
  const teamWeeks = new Map<number, string | null>();
  let rows;
  try {
    rows = await fetchAllRows(`team slate ${team} ${season}`, (from, to) =>
      supabase
        .from("player_weekly_projections")
        .select("week, opponent")
        .eq("team", team)
        .eq("season", season)
        .eq("season_type", "regular")
        .eq("source", source)
        .not("opponent", "is", null)
        .order("week", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (err) {
    // An empty slate claims no byes. A partial one would label every week
    // after the failed page a bye.
    console.error("[defender] team slate read failed", err);
    return { teamWeeks, slateWeeks: new Set<number>() };
  }
  for (const row of rows) {
    if (!teamWeeks.has(Number(row.week))) teamWeeks.set(Number(row.week), row.opponent);
  }
  // Every team shares the season's week range, so the weeks this team plays
  // plus the gaps between them is the slate's reach. A gap inside the range is
  // a bye; weeks past the last one the feed holds are unknown.
  const slateWeeks = new Set<number>();
  const played = [...teamWeeks.keys()];
  if (played.length > 0) {
    const last = Math.max(...played);
    for (let w = 1; w <= last; w++) slateWeeks.add(w);
  }
  return { teamWeeks, slateWeeks };
}

/** A reader's own IDP league, offered in the scoring selector (R-16). */
export type ReaderIdpLeague = {
  id: string;
  /** The league deep view is keyed on this, for the This week links (IDP-314). */
  sleeperLeagueId: string;
  name: string;
  scoring: Record<string, number>;
};

const IDP_TOKENS = ["DL", "LB", "DB", "IDP_FLEX"];

/**
 * The idp_* part of a league's scoring map, with the two threshold bonuses.
 * Offensive keys are dropped: a defender's line has none, and the page must
 * never pretend a league's passing rules touch a linebacker.
 */
export function idpPartOfScoring(scoring: Record<string, unknown> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!scoring) return out;
  for (const [key, value] of Object.entries(scoring)) {
    if (!(key.startsWith("idp_") || key === "bonus_tkl_10p" || key === "bonus_sack_2p")) continue;
    const n = num(value);
    if (n !== null && n !== 0) out[key] = n;
  }
  return out;
}

/**
 * The reader's synced IDP leagues for the season, by Sleeper user id. The
 * caller resolves that id through lib/sleeper-handle/resolve.ts; this reads
 * only public league tables. A league whose scoring has no nonzero idp rule
 * is left out, because it cannot score a defender at all.
 */
export async function loadReaderIdpLeagues(
  supabase: Db,
  sleeperUserId: string,
  season: number,
): Promise<ReaderIdpLeague[]> {
  // Every membership, paged. A capped, unordered read kept an arbitrary 200,
  // so a reader in many leagues across seasons could lose this season's. A
  // failed read throws; the caller renders no selector.
  const memberships = await fetchAllRows(`league memberships ${sleeperUserId}`, (from, to) =>
    supabase
      .from("league_users")
      .select("league_id")
      .eq("sleeper_user_id", sleeperUserId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const ids = [...new Set(memberships.map((m) => m.league_id))];
  if (ids.length === 0) return [];
  const leagues = await fetchAllRowsInChunks(`reader leagues ${sleeperUserId}`, ids, (chunk, from, to) =>
    supabase
      .from("leagues")
      .select("id, sleeper_league_id, name, season, roster_positions, scoring_settings")
      .in("id", chunk)
      .eq("season", season)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const out: ReaderIdpLeague[] = [];
  for (const league of leagues) {
    const slots = Array.isArray(league.roster_positions)
      ? (league.roster_positions as unknown[]).map(String)
      : [];
    if (!slots.some((s) => IDP_TOKENS.includes(s))) continue;
    const scoring = idpPartOfScoring(league.scoring_settings as Record<string, unknown> | null);
    if (Object.keys(scoring).length === 0) continue;
    out.push({
      id: league.id,
      sleeperLeagueId: league.sleeper_league_id,
      name: league.name ?? "Your league",
      scoring,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
