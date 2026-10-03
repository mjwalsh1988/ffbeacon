import "server-only";

/**
 * Every read behind Season Pulse, and the cache in front of each.
 *
 * NOTHING HERE WRITES AND NOTHING HERE CALLS AN EXTERNAL HOST. The stats, the
 * projections, the lines, the schedule, the points allowed table and the
 * forecasts are all filled by their own syncs; this reads what they stored.
 *
 * WHICH CLIENT. Public tables are read with the cookie-less anon client, so
 * row level security still applies and a mistake here can only ever reach
 * public data. The admin client is used in exactly two places, both for a
 * service-role table: the projection read (it needs
 * league_power_pulse_settings) and the Beacon Brief's recap headlines
 * (brief_editions also carries review material, so only the draft's games are
 * selected and only for a published article).
 *
 * WHY THE WEEK IS THE UNIT OF CACHING. A whole season of stat rows is larger
 * than one cache entry may be by December (unstable_cache refuses an item past
 * 2 MB), and a week is about a twentieth of that. Everything computed FROM the
 * weeks is cached again on top, keyed by what it depends on, so a page render
 * is a handful of cache reads rather than a walk over eleven thousand rows.
 *
 * WHAT INVALIDATES WHAT. The nightly stats sync busts `playerStats`, the
 * projection sync and the odds sync bust `playerProjections`, the weather sync
 * busts `nflWeather`. The revalidate times are the backstop for a night a cron
 * did not run.
 *
 * THE PROJECTION SOURCE IS IN EVERY KEY THAT HOLDS A PROJECTION (CLAUDE.md,
 * Projection Engine Source). Without it a switch of engine would take a day to
 * show up here.
 */

import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache-tags";
import { createAdminClient, createCachedReadClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { OFFENSE_POSITIONS, isOffensePosition } from "@/lib/site";
import { loadAdjustedProjections } from "@/lib/projections/read";
import { deriveWeekResults, type DefenseLine } from "@/lib/brief-desk/week-results";
import { loadGameLines } from "@/lib/brief-desk/game-data";
import type { GameLineInput } from "@/lib/brief-desk/games";
import { draftSchema } from "@/lib/brief-desk/draft-schema";
import { ODDS_SOURCE_SLUG } from "@/lib/nfl-game-environment";
import { scoringSettingsOf } from "./board";
import type { DefenseSplitInput, FinalInput } from "./games";
import { STAT_KEYS, type GameWeather, type PlayerRef, type SeasonScoring, type StatTotals, type WeekStatRow } from "./types";

type ReadClient = SupabaseClient<Database>;

const SEASON_TYPE = "regular";
const ID_BATCH = 300;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** A cached reader keyed by its name and its (primitive) arguments. */
export function cached<A extends (string | number)[], R>(
  name: string,
  read: (...args: A) => Promise<R>,
  options: { revalidate: number; tags: string[] },
): (...args: A) => Promise<R> {
  return (...args: A) => unstable_cache(() => read(...args), [name, ...args.map(String)], options)();
}

/* ---------- Weekly stat rows ---------- */

const WEEK_ROW_SELECT = `id, player_id, week, pts_ppr, pts_half_ppr, pts_std, opponent, team:metadata->>team, snap_pct, ${STAT_KEYS.join(", ")}, players!inner(position)`;

type RawWeekRow = {
  id: string;
  player_id: string;
  week: number;
  pts_ppr: number | null;
  pts_half_ppr: number | null;
  pts_std: number | null;
  opponent: string | null;
  team: string | null;
  snap_pct: number | null;
  players: { position: string | null } | null;
} & Record<(typeof STAT_KEYS)[number], number | null>;

/**
 * One week of lines for everyone who took the field at one of the six
 * positions. `gp > 0` is the filter that makes a row a game: Sleeper stores a
 * row for an inactive player too, and counting those would hand a healthy
 * scratch a game played and a zero.
 */
async function readWeekRows(season: number, week: number): Promise<WeekStatRow[]> {
  const supabase = createCachedReadClient();
  const raw = await fetchAllRows<RawWeekRow>(`season pulse week ${week} rows`, (from, to) =>
    supabase
      .from("player_stats")
      .select(WEEK_ROW_SELECT)
      .eq("season", season)
      .eq("season_type", SEASON_TYPE)
      .eq("week", week)
      .gt("gp", 0)
      .in("players.position", [...OFFENSE_POSITIONS])
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: RawWeekRow[] | null; error: { message: string } | null }>,
  );

  const out: WeekStatRow[] = [];
  for (const r of raw) {
    const position = r.players?.position?.toUpperCase();
    if (!isOffensePosition(position)) continue;
    const stats: StatTotals = {};
    for (const key of STAT_KEYS) {
      const value = num(r[key]);
      if (value) stats[key] = value;
    }
    out.push({
      playerId: r.player_id,
      week: Number(r.week),
      position,
      team: r.team ? r.team.toUpperCase() : null,
      opponent: r.opponent ? r.opponent.toUpperCase() : null,
      ppr: num(r.pts_ppr),
      half: num(r.pts_half_ppr),
      std: num(r.pts_std),
      snapPct: num(r.snap_pct),
      stats,
    });
  }
  return out;
}

export const loadWeekRowsCached = cached("season-pulse-week-rows", readWeekRows, {
  revalidate: CACHE_TTL.daily,
  tags: [CACHE_TAGS.playerStats],
});

/** Weeks 1 to throughWeek, every row. Reads the per-week entries in parallel. */
export async function loadSeasonRows(season: number, throughWeek: number): Promise<WeekStatRow[]> {
  const weeks = Array.from({ length: Math.max(0, throughWeek) }, (_, i) => i + 1);
  const perWeek = await Promise.all(weeks.map((week) => loadWeekRowsCached(season, week)));
  return perWeek.flat();
}

/* ---------- Players ---------- */

type PlayerRow = {
  id: string;
  slug: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  team: string | null;
  external_ids: unknown;
};

function sleeperIdOf(externalIds: unknown): string | null {
  const v = (externalIds as { sleeper?: unknown } | null)?.sleeper;
  const text = typeof v === "number" ? String(v) : typeof v === "string" ? v : "";
  return /^[0-9A-Za-z]{1,12}$/.test(text) ? text : null;
}

async function readPlayerRefs(season: number, throughWeek: number): Promise<PlayerRef[]> {
  const rows = await loadSeasonRows(season, throughWeek);
  const ids = [...new Set(rows.map((r) => r.playerId))];
  const supabase = createCachedReadClient();
  const out: PlayerRef[] = [];
  for (const batch of chunk(ids, ID_BATCH)) {
    const { data, error } = await supabase
      .from("players")
      .select("id, slug, full_name, first_name, last_name, position, team, external_ids")
      .in("id", batch);
    if (error) throw new Error(`season pulse players: ${error.message}`);
    for (const p of (data ?? []) as PlayerRow[]) {
      const position = p.position?.toUpperCase();
      if (!isOffensePosition(position)) continue;
      out.push({
        id: p.id,
        slug: p.slug,
        name: p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
        position,
        team: p.team ? p.team.toUpperCase() : null,
        sleeperId: sleeperIdOf(p.external_ids),
      });
    }
  }
  return out;
}

/** Everyone with a game this season, keyed for the builders. */
export const loadPlayerRefsCached = cached("season-pulse-player-refs", readPlayerRefs, {
  revalidate: CACHE_TTL.daily,
  tags: [CACHE_TAGS.playerStats, CACHE_TAGS.playerDepth],
});

/* ---------- Projections ---------- */

export type SeasonProjections = {
  /** The projection source the played weeks were read from, for the report's heading. */
  source: string;
  /** The source the live week was read from. It can differ: see readSeasonProjections. */
  liveSource: string;
  /**
   * The engine's own published number per player per week, index 0 is week 1.
   * Null is a week with no projection, never a zero.
   */
  raw: Record<string, (number | null)[]>;
  /** Our adjusted projection for the live week only, for the players to watch. */
  live: Record<string, number>;
};

async function readSeasonProjections(
  season: number,
  throughWeek: number,
  currentWeek: number,
  scoringBase: string,
  tePremium: number,
  // Part of the cache key only: the read below resolves its own source for the
  // same window and returns it, and that returned value is what gets shown.
  _sourceKey: string,
): Promise<SeasonProjections> {
  void _sourceKey;
  const refs = await loadPlayerRefsCached(season, throughWeek);
  const scoring = {
    base: scoringBase as SeasonScoring["base"],
    tePremium,
    label: "",
    key: `${scoringBase}|${tePremium}`,
  };
  const shared = {
    supabase: createAdminClient(),
    playerIds: refs.map((r) => r.id),
    season,
    scoringSettings: scoringSettingsOf(scoring),
    positionByPlayer: new Map(refs.map((r) => [r.id, r.position])),
    currentWeek,
  };
  const hasLiveWeek = currentWeek >= 1 && currentWeek <= throughWeek;

  // TWO WINDOWS, BECAUSE THE SOURCE IS RESOLVED PER WINDOW. Our own engine
  // writes the live week forward and nothing behind it, so with it switched on
  // the whole-season window can resolve to Sleeper while the live week resolves
  // to FF Beacon. Reading the live week inside the season window would show
  // Sleeper's number here for a week Start/Sit shows ours for.
  const [history, liveWeek] = await Promise.all([
    loadAdjustedProjections({ ...shared, fromWeek: 1, toWeek: throughWeek }),
    hasLiveWeek
      ? loadAdjustedProjections({ ...shared, fromWeek: currentWeek, toWeek: currentWeek })
      : Promise.resolve(null),
  ]);

  const raw: SeasonProjections["raw"] = {};
  const live: SeasonProjections["live"] = {};
  const round2 = (n: number) => Math.round(n * 100) / 100;
  for (const [playerId, summary] of history.byPlayer) {
    const weeks = new Array<number | null>(throughWeek).fill(null);
    for (const [week, projection] of summary.byWeek) {
      if (week < 1 || week > throughWeek || (hasLiveWeek && week === currentWeek)) continue;
      weeks[week - 1] = round2(projection.rawPoints);
    }
    raw[playerId] = weeks;
  }
  for (const [playerId, summary] of liveWeek?.byPlayer ?? []) {
    const projection = summary.byWeek.get(currentWeek);
    if (!projection) continue;
    const weeks = raw[playerId] ?? new Array<number | null>(throughWeek).fill(null);
    weeks[currentWeek - 1] = round2(projection.rawPoints);
    raw[playerId] = weeks;
    live[playerId] = Math.round(projection.points * 10) / 10;
  }
  return { source: history.source, liveSource: liveWeek?.source ?? history.source, raw, live };
}

export const loadSeasonProjectionsCached = cached("season-pulse-projections", readSeasonProjections, {
  revalidate: CACHE_TTL.hourly,
  tags: [CACHE_TAGS.playerProjections, CACHE_TAGS.playerStats],
});

/* ---------- Finals ---------- */

type DefenseStatRow = {
  player_id: string;
  week: number;
  opponent: string | null;
  stats: Record<string, unknown> | null;
  date: string | null;
};

/**
 * Every final of the season, both sides of each game.
 *
 * No table stores a score. lib/brief-desk/week-results.ts derives one from the
 * two team-defense stat lines of a game and has been checked against every
 * final of weeks 1 to 3 of 2026; this reads the whole season's defense lines
 * in one paged query and runs the same derivation a week at a time.
 */
async function readSeasonFinals(season: number, throughWeek: number): Promise<FinalInput[]> {
  if (throughWeek < 1) return [];
  const supabase = createCachedReadClient();
  const { data: defenses, error } = await supabase.from("players").select("id, team").eq("position", "DEF");
  if (error) throw new Error(`season pulse defenses: ${error.message}`);
  const teamById = new Map((defenses ?? []).filter((d) => d.team).map((d) => [d.id, String(d.team).toUpperCase()]));
  if (teamById.size === 0) return [];

  const rows = await fetchAllRows<DefenseStatRow>("season pulse finals", (from, to) =>
    supabase
      .from("player_stats")
      .select("player_id, week, opponent, stats:metadata->stats, date:metadata->>date")
      .eq("season", season)
      .eq("season_type", SEASON_TYPE)
      .lte("week", throughWeek)
      .in("player_id", [...teamById.keys()])
      .order("week", { ascending: true })
      .order("player_id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: DefenseStatRow[] | null; error: { message: string } | null }>,
  );

  const byWeek = new Map<number, DefenseLine[]>();
  for (const r of rows) {
    const team = teamById.get(r.player_id);
    if (!team || !r.stats) continue;
    const week = Number(r.week);
    byWeek.set(week, [
      ...(byWeek.get(week) ?? []),
      { team, opponent: r.opponent, game_date: r.date, stats: r.stats },
    ]);
  }

  const out: FinalInput[] = [];
  for (const [week, lines] of byWeek) {
    for (const [team, result] of deriveWeekResults(lines)) {
      out.push({
        week,
        team,
        opponent: result.opponent,
        pointsFor: result.points_for,
        pointsAgainst: result.points_against,
      });
    }
  }
  return out;
}

export const loadSeasonFinalsCached = cached("season-pulse-finals", readSeasonFinals, {
  revalidate: CACHE_TTL.daily,
  tags: [CACHE_TAGS.playerStats],
});

/* ---------- Teams ---------- */

export type TeamInfo = { code: string; name: string; color: string | null };

async function readTeams(): Promise<TeamInfo[]> {
  const supabase = createCachedReadClient();
  const { data, error } = await supabase.from("nfl_teams").select("abbreviation, name, primary_color");
  if (error) throw new Error(`season pulse teams: ${error.message}`);
  return (data ?? []).map((t) => ({ code: t.abbreviation, name: t.name, color: t.primary_color }));
}

export const loadTeamsCached = cached("season-pulse-teams", readTeams, {
  revalidate: CACHE_TTL.daily,
  tags: [CACHE_TAGS.playerDepth],
});

/* ---------- Lines and schedule ---------- */

async function readGameLines(season: number, week: number): Promise<GameLineInput[]> {
  return loadGameLines(createCachedReadClient() as ReadClient, season, SEASON_TYPE, week);
}

/** The settled line per game of a week, the same read the Beacon Brief's cards use. */
export const loadGameLinesCached = cached("season-pulse-game-lines", readGameLines, {
  revalidate: CACHE_TTL.hourly,
  tags: [CACHE_TAGS.playerProjections],
});

export type ScheduledGame = {
  home: string;
  away: string;
  kickoffAt: string | null;
  total: number | null;
  homeSpread: number | null;
  homeImplied: number | null;
  awayImplied: number | null;
  /** The venue name on the schedule row, for a game with no forecast row. */
  venue: string | null;
};

type OddsRow = {
  home_team: string;
  away_team: string;
  kickoff_at: string | null;
  game_total: number | null;
  home_spread: number | null;
  home_implied_total: number | null;
  away_implied_total: number | null;
  venue: string | null;
};

async function readWeekSchedule(season: number, week: number): Promise<ScheduledGame[]> {
  const supabase = createCachedReadClient();
  const { data, error } = (await supabase
    .from("nfl_game_odds")
    .select(
      "home_team, away_team, kickoff_at, game_total, home_spread, home_implied_total, away_implied_total, venue:metadata->venue->>fullName",
    )
    .eq("source", ODDS_SOURCE_SLUG)
    .eq("season", season)
    .eq("season_type", SEASON_TYPE)
    .eq("week", week)
    .order("kickoff_at", { ascending: true })
    .order("home_team", { ascending: true })) as unknown as {
    data: OddsRow[] | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(`season pulse schedule: ${error.message}`);
  return (data ?? []).map((r) => ({
    home: r.home_team.toUpperCase(),
    away: r.away_team.toUpperCase(),
    kickoffAt: r.kickoff_at,
    total: num(r.game_total),
    homeSpread: num(r.home_spread),
    homeImplied: num(r.home_implied_total),
    awayImplied: num(r.away_implied_total),
    venue: r.venue,
  }));
}

export const loadWeekScheduleCached = cached("season-pulse-schedule", readWeekSchedule, {
  revalidate: CACHE_TTL.hourly,
  tags: [CACHE_TAGS.playerProjections],
});

/* ---------- Weather ---------- */

type WeatherRow = {
  home_team: string;
  provider: string;
  fetched_at: string;
  lead_hours: number;
  is_indoor: boolean;
  temp_f: number | null;
  feels_like_f: number | null;
  wind_mph: number | null;
  wind_gust_mph: number | null;
  wind_dir_deg: number | null;
  wind_mph_max_3h: number | null;
  precip_prob_pct: number | null;
  precip_in: number | null;
  snow_in: number | null;
  humidity_pct: number | null;
  conditions: string | null;
  nfl_stadiums: { name: string; city: string | null; roof: string } | null;
};

function roofOf(value: string | undefined): GameWeather["roof"] {
  return value === "outdoors" || value === "dome" || value === "retractable" ? value : null;
}

/**
 * The newest forecast row per game of a week, keyed by home team.
 *
 * The table is append-only, so a game has one row per fetch; rows arrive
 * newest first and the first one seen for a game wins. A game with no row is
 * simply absent from the result, and every reader treats absent as unknown.
 */
async function readWeekWeather(season: number, week: number): Promise<Record<string, GameWeather>> {
  const supabase = createCachedReadClient();
  const rows = await fetchAllRows<WeatherRow>("season pulse weather", (from, to) =>
    supabase
      .from("nfl_game_weather")
      .select(
        "id, home_team, provider, fetched_at, lead_hours, is_indoor, temp_f, feels_like_f, wind_mph, wind_gust_mph, wind_dir_deg, wind_mph_max_3h, precip_prob_pct, precip_in, snow_in, humidity_pct, conditions, nfl_stadiums(name, city, roof)",
      )
      .eq("season", season)
      .eq("season_type", SEASON_TYPE)
      .eq("week", week)
      .order("fetched_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: WeatherRow[] | null; error: { message: string } | null }>,
  );

  const out: Record<string, GameWeather> = {};
  for (const r of rows) {
    const home = r.home_team.toUpperCase();
    const existing = out[home];
    // A forecast always outranks the "this venue has a roof" row, whichever
    // was written last: an outdoor game can never have both, and an indoor one
    // only ever has the roof row.
    if (existing && !(existing.isIndoor && !r.is_indoor)) continue;
    out[home] = {
      isIndoor: r.is_indoor,
      roof: roofOf(r.nfl_stadiums?.roof),
      stadium: r.nfl_stadiums?.name ?? null,
      city: r.nfl_stadiums?.city ?? null,
      provider: r.provider,
      fetchedAt: r.fetched_at,
      leadHours: num(r.lead_hours),
      tempF: num(r.temp_f),
      feelsLikeF: num(r.feels_like_f),
      windMph: num(r.wind_mph),
      windGustMph: num(r.wind_gust_mph),
      windDirDeg: num(r.wind_dir_deg),
      windMphMax3h: num(r.wind_mph_max_3h),
      precipProbPct: num(r.precip_prob_pct),
      precipIn: num(r.precip_in),
      snowIn: num(r.snow_in),
      humidityPct: num(r.humidity_pct),
      conditions: r.conditions,
    };
  }
  return out;
}

export const loadWeekWeatherCached = cached("season-pulse-weather", readWeekWeather, {
  revalidate: CACHE_TTL.hourly,
  tags: [CACHE_TAGS.nflWeather],
});

export type StadiumInfo = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  country: string;
  roof: NonNullable<GameWeather["roof"]>;
  homeTeams: string[];
};

async function readStadiums(): Promise<StadiumInfo[]> {
  const supabase = createCachedReadClient();
  const { data, error } = await supabase
    .from("nfl_stadiums")
    .select("id, name, city, region, country, roof, home_teams")
    .order("name", { ascending: true });
  if (error) throw new Error(`season pulse stadiums: ${error.message}`);
  return (data ?? []).flatMap((s) => {
    const roof = roofOf(s.roof);
    return roof
      ? [{ id: s.id, name: s.name, city: s.city, region: s.region, country: s.country, roof, homeTeams: s.home_teams ?? [] }]
      : [];
  });
}

export const loadStadiumsCached = cached("season-pulse-stadiums", readStadiums, {
  revalidate: CACHE_TTL.daily,
  tags: [CACHE_TAGS.nflWeather],
});

/* ---------- Points allowed by position ---------- */

async function readDefenseSplits(season: number, scoringBase: string): Promise<DefenseSplitInput[]> {
  const supabase = createCachedReadClient();
  const { data, error } = await supabase
    .from("nfl_defense_vs_position")
    .select("team, position, points_allowed_per_game, games_sampled")
    .eq("season", season)
    .eq("scoring", scoringBase)
    .order("team", { ascending: true })
    .order("position", { ascending: true });
  if (error) throw new Error(`season pulse defense splits: ${error.message}`);
  return (data ?? []).flatMap((r) => {
    const perGame = num(r.points_allowed_per_game);
    return perGame === null
      ? []
      : [{ team: r.team.toUpperCase(), position: r.position, perGame, games: Number(r.games_sampled ?? 0) }];
  });
}

export const loadDefenseSplitsCached = cached("season-pulse-defense-splits", readDefenseSplits, {
  revalidate: CACHE_TTL.daily,
  tags: [CACHE_TAGS.playerStats],
});

/* ---------- Beacon Brief recaps ---------- */

export type WeekRecaps = {
  /** The published edition's slug, for the link. */
  slug: string;
  /** Keyed by game key, "ATL-GB". */
  games: Record<string, { headline: string; teaser: string }>;
};

/** Markdown down to plain words, cut at a sentence end near `max` characters. */
export function recapTeaser(markdown: string, max = 220): string {
  const plain = markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const stop = cut.lastIndexOf(". ");
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}...`;
}

/**
 * The Beacon Brief's headline and opening for each game of a week, when a
 * weekly edition for it is published.
 *
 * brief_editions is service-role only because it also holds review notes and
 * the research log. This selects draft_payload alone, for an article the
 * public client has already confirmed is published, and returns two short
 * strings per game. Nothing else from the row leaves this function.
 */
async function readWeekRecaps(season: number, week: number): Promise<WeekRecaps | null> {
  const supabase = createCachedReadClient();
  const { data: article, error: articleError } = await supabase
    .from("articles")
    .select("id, slug")
    .eq("article_type", "brief")
    .eq("status", "published")
    .eq("season", season)
    .eq("week", week)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Thrown, not swallowed: unstable_cache does not store a rejection, so a
  // failed read is retried on the next request instead of being remembered as
  // "this week has no recap".
  if (articleError) throw new Error(`season pulse recaps: ${articleError.message}`);
  if (!article) return null;

  const { data: edition, error: editionError } = await createAdminClient()
    .from("brief_editions")
    .select("draft_payload")
    .eq("article_id", article.id)
    .eq("cadence", "weekly")
    .maybeSingle();
  if (editionError) throw new Error(`season pulse recaps: ${editionError.message}`);
  const parsed = edition ? draftSchema.safeParse(edition.draft_payload) : null;
  if (!parsed?.success) return null;

  const games: WeekRecaps["games"] = {};
  for (const g of parsed.data.games) {
    games[g.game_key] = { headline: g.headline, teaser: recapTeaser(g.recap_md) };
  }
  return Object.keys(games).length > 0 ? { slug: article.slug, games } : null;
}

// Five minutes, not an hour: the owner can edit a published recap or withdraw
// an edition, and nothing busts this tag when that happens.
export const loadWeekRecapsCached = cached("season-pulse-recaps", readWeekRecaps, {
  revalidate: CACHE_TTL.fiveMinutes,
  tags: [CACHE_TAGS.playerArticles],
});
