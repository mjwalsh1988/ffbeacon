/**
 * Game weather sync (library form).
 *
 * Shared by the Vercel cron endpoint (app/api/cron/sync-nfl-weather) and the
 * CLI (scripts/sync-nfl-weather.ts). For every upcoming regular-season game it
 * finds the stadium, and then does one of three things:
 *
 *   a roofed venue (dome or retractable)   writes ONE row, provider
 *                                          'stadium-roof', is_indoor true and
 *                                          every weather column null. No
 *                                          provider call, and never a second
 *                                          row for the same game.
 *   an open-air venue in the US            National Weather Service forecast
 *   an open-air venue anywhere else        MET Norway forecast
 *
 * and APPENDS a snapshot to nfl_game_weather (migration 0337). The table is a
 * history, not a latest-value cache: each fetch is a new row and a game's
 * forecast is its newest one, so "what did we know on Tuesday" stays a query.
 *
 * THE SCHEDULE comes from nfl_game_odds, the only table holding a kickoff time
 * for every game. Its metadata is ESPN's competition object, whose venue id is
 * how a game finds its row in nfl_stadiums (external_ids.espn). There is no
 * nfl_games table yet, so the weather row carries the season, week and both
 * teams itself.
 *
 * TWO SCOPES, one function.
 *   nightly   every game kicking off in the next seven days. Seven because
 *             that is about how far the National Weather Service forecasts.
 *   gameday   only games kicking off in the next 24 hours, which is where a
 *             forecast is materially better than it was at five days. On a day
 *             with no game it returns skipped: true before reading a stadium
 *             or calling a provider.
 *
 * FAILURE POSTURE. The same rule runNflOddsSync follows. A provider request
 * that fails writes nothing for that game, leaves its previous snapshot as the
 * newest, and lists the game in failedGames. The run THROWS only when at least
 * one game needed a provider and not one forecast came back, because a run
 * that returns normally reads as a healthy night in the cron ledger and a
 * total outage would otherwise sit silent. One failed game among successes is
 * reported and tolerated.
 *
 * A game the provider has not published yet (beyondHorizonGames) is not a
 * failure and never counts toward that throw. A game whose stadium cannot be
 * found (unresolvedGames) is skipped: a forecast for the wrong city is worse
 * than none, and a missing forecast is never read as calm.
 *
 * Zero targeted games is a clean skip, not an error: the off-season, a bye in
 * the schedule, a game day with nothing left to play.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";
import { ODDS_SOURCE_SLUG } from "./nfl-game-environment";
import {
  gameKeyFor,
  getMetNorwayKickoffForecast,
  getNwsKickoffForecast,
  lookupNwsGrid,
  type KickoffForecast,
  type KickoffForecastResult,
  type NwsGrid,
  type WeatherStadium,
} from "./nfl-weather";
import { resolveSeasonClock } from "./start-sit/clock";
import { withRetry } from "./supabase/retry";

type WeatherInsert = Database["public"]["Tables"]["nfl_game_weather"]["Insert"];
type StadiumFullRow = Database["public"]["Tables"]["nfl_stadiums"]["Row"];

/** The stadium columns the sync reads. */
export type WeatherStadiumRow = Pick<
  StadiumFullRow,
  | "id"
  | "country"
  | "latitude"
  | "longitude"
  | "elevation_m"
  | "roof"
  | "home_teams"
  | "active_from"
  | "active_to"
  | "external_ids"
  | "nws_office"
  | "nws_grid_x"
  | "nws_grid_y"
  | "nws_grid_checked_at"
>;

const STADIUM_COLUMNS =
  "id, country, latitude, longitude, elevation_m, roof, home_teams, active_from, active_to, external_ids, nws_office, nws_grid_x, nws_grid_y, nws_grid_checked_at";

/** One game off the schedule, as much of it as the sync needs. */
export type WeatherGame = {
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
  /** ESPN's venue id from the schedule row. Null when the row carries none. */
  venueId: string | null;
  neutralSite: boolean;
};

export type NflWeatherSyncScope = "nightly" | "gameday";

export const INDOOR_PROVIDER = "stadium-roof";

const HOUR_MS = 3_600_000;

/** How far ahead each scope looks. */
export const SCOPE_HORIZON_HOURS: Record<NflWeatherSyncScope, number> = {
  nightly: 7 * 24,
  gameday: 24,
};

/** A cached forecast grid is looked up again after this long: cells can move. */
export const NWS_GRID_MAX_AGE_MS = 30 * 24 * HOUR_MS;

/** The gap between one game's provider requests and the next game's. */
const DEFAULT_PAUSE_MS = 250;

export type NflWeatherSyncOptions = {
  scope: NflWeatherSyncScope;
  /** The clock, in epoch milliseconds. Defaults to Date.now(). */
  now?: number;
  /**
   * Stop starting provider requests after this instant (epoch milliseconds).
   * Games not reached are listed in failedGames. The cron route sets it short
   * of its maxDuration so a slow provider ends in a recorded run, not a kill.
   */
  deadlineMs?: number;
  /** Override the pause between games. Tests pass 0. */
  pauseMs?: number;
};

export type WeatherGameStatus =
  | "indoor-written"
  | "indoor-exists"
  | "snapshot"
  | "failed"
  | "beyond-horizon"
  | "unresolved";

export type NflWeatherSyncResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  scope: NflWeatherSyncScope;
  season: number | null;
  targetedGames: number;
  indoorRowsWritten: number;
  snapshotsWritten: number;
  /** Game keys whose provider request failed. Their previous snapshot stands. */
  failedGames: string[];
  /** Game keys whose stadium could not be found. */
  unresolvedGames: string[];
  /** Game keys the provider answered for without having published the kickoff hour. */
  beyondHorizonGames: string[];
  /** Every provider a row was written under this run. */
  providers: string[];
  perGame: Array<{
    game: string;
    stadium: string | null;
    provider: string | null;
    status: WeatherGameStatus;
  }>;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

/**
 * The stadium a game is played in. Pure.
 *
 * ESPN's venue id on the schedule row is the answer whenever it is there. When
 * the row carries NO venue id and the game is not at a neutral site, the home
 * team's own stadium for that season is used. A venue id we do not recognise
 * resolves to nothing: it says the game is somewhere, and that somewhere is
 * not in nfl_stadiums, so the home stadium would be a guess (a relocated game
 * is exactly the case where it is wrong).
 */
export function resolveStadium<T extends Pick<WeatherStadiumRow, "home_teams" | "active_from" | "active_to" | "external_ids">>(
  game: Pick<WeatherGame, "season" | "homeTeam" | "venueId" | "neutralSite">,
  stadiums: ReadonlyArray<T>,
): T | null {
  if (game.venueId) {
    return stadiums.find((s) => espnVenueId(s.external_ids) === game.venueId) ?? null;
  }
  if (game.neutralSite) return null;
  const homes = stadiums
    .filter(
      (s) =>
        s.home_teams.includes(game.homeTeam) &&
        (s.active_from === null || s.active_from <= game.season) &&
        (s.active_to === null || s.active_to >= game.season),
    )
    .sort((a, b) => (b.active_from ?? 0) - (a.active_from ?? 0));
  return homes[0] ?? null;
}

function espnVenueId(externalIds: Json): string | null {
  if (!externalIds || typeof externalIds !== "object" || Array.isArray(externalIds)) return null;
  const id = externalIds.espn;
  if (typeof id === "string" && id.length > 0) return id;
  return typeof id === "number" ? String(id) : null;
}

/** Hours from the fetch to kickoff, to two decimals. */
export function leadHours(kickoffIso: string, fetchedAtMs: number): number {
  return Math.round(((Date.parse(kickoffIso) - fetchedAtMs) / HOUR_MS) * 100) / 100;
}

function baseRow(game: WeatherGame, stadiumId: string, fetchedAtMs: number) {
  return {
    game_key: gameKeyFor(game.season, game.week, game.awayTeam, game.homeTeam),
    season: game.season,
    season_type: "regular",
    week: game.week,
    home_team: game.homeTeam,
    away_team: game.awayTeam,
    kickoff_at: game.kickoffAt,
    stadium_id: stadiumId,
    fetched_at: new Date(fetchedAtMs).toISOString(),
    lead_hours: leadHours(game.kickoffAt, fetchedAtMs),
  } satisfies Partial<WeatherInsert>;
}

/**
 * The row that says a game is played under a roof. Pure.
 *
 * Every weather column is written as an explicit null rather than left out, so
 * the row can never be read as a forecast and the table's own check constraint
 * (nfl_game_weather_indoor_is_blank) has nothing to refuse.
 */
export function buildIndoorRow(game: WeatherGame, stadiumId: string, fetchedAtMs: number): WeatherInsert {
  return {
    ...baseRow(game, stadiumId, fetchedAtMs),
    provider: INDOOR_PROVIDER,
    is_indoor: true,
    temp_f: null,
    feels_like_f: null,
    wind_mph: null,
    wind_gust_mph: null,
    wind_dir_deg: null,
    wind_mph_max_3h: null,
    precip_prob_pct: null,
    precip_in: null,
    snow_in: null,
    humidity_pct: null,
    conditions: null,
    metadata: null,
  };
}

/** One forecast snapshot. Pure. `metadata` is the provider's slice, verbatim. */
export function buildSnapshotRow(
  game: WeatherGame,
  stadiumId: string,
  forecast: KickoffForecast,
  fetchedAtMs: number,
): WeatherInsert {
  const { provider, hourly, ...figures } = forecast;
  return {
    ...baseRow(game, stadiumId, fetchedAtMs),
    provider,
    is_indoor: false,
    ...figures,
    metadata: hourly as Json,
  };
}

/** The grid cell cached on a stadium row, when all three parts are there. */
function cachedGrid(stadium: WeatherStadiumRow): NwsGrid | null {
  if (!stadium.nws_office || stadium.nws_grid_x === null || stadium.nws_grid_y === null) return null;
  return { office: stadium.nws_office, gridX: stadium.nws_grid_x, gridY: stadium.nws_grid_y };
}

/** True when the cached grid is missing or was last checked over 30 days ago. Pure. */
export function needsGridLookup(stadium: WeatherStadiumRow, nowMs: number): boolean {
  if (!cachedGrid(stadium)) return true;
  const checked = stadium.nws_grid_checked_at ? Date.parse(stadium.nws_grid_checked_at) : NaN;
  return !Number.isFinite(checked) || nowMs - checked > NWS_GRID_MAX_AGE_MS;
}

/**
 * The forecast grid for a US stadium, looked up and cached on the row when it
 * is missing or stale. A lookup that fails falls back to the stale cell rather
 * than dropping the game: cells move rarely, and the next run checks again. A
 * failed cache WRITE is logged and ignored, because the forecast it was
 * fetched for is still good.
 */
async function ensureNwsGrid(
  supabase: SupabaseClient<Database>,
  stadium: WeatherStadiumRow,
  nowMs: number,
): Promise<NwsGrid | null> {
  const cached = cachedGrid(stadium);
  if (!needsGridLookup(stadium, nowMs)) return cached;

  const found = await lookupNwsGrid(stadium.latitude, stadium.longitude);
  if (!found) return cached;

  const checkedAt = new Date(nowMs).toISOString();
  const { error } = await supabase
    .from("nfl_stadiums")
    .update({
      nws_office: found.office,
      nws_grid_x: found.gridX,
      nws_grid_y: found.gridY,
      nws_grid_checked_at: checkedAt,
      updated_at: checkedAt,
    })
    .eq("id", stadium.id);
  if (error) console.warn(`  ${stadium.id}: could not cache the forecast grid (${error.message})`);

  // Two games at one stadium in a run share the lookup.
  stadium.nws_office = found.office;
  stadium.nws_grid_x = found.gridX;
  stadium.nws_grid_y = found.gridY;
  stadium.nws_grid_checked_at = checkedAt;
  return found;
}

type ScheduleRow = {
  season: number;
  week: number;
  home_team: string;
  away_team: string;
  kickoff_at: string | null;
  venue_id: string | null;
  neutral_site: boolean | null;
};

/**
 * Regular-season games of one season kicking off after `fromMs` and no later
 * than `toMs`, in kickoff order. Only two keys are read out of the stored ESPN
 * object, so sixteen competition documents are not pulled to read sixteen ids.
 */
async function loadUpcomingGames(
  supabase: SupabaseClient<Database>,
  season: number,
  fromMs: number,
  toMs: number,
): Promise<WeatherGame[]> {
  const rows = await withRetry(
    async () => {
      const { data, error } = await supabase
        .from("nfl_game_odds")
        .select(
          "season, week, home_team, away_team, kickoff_at, venue_id:metadata->venue->>id, neutral_site:metadata->neutralSite",
        )
        .eq("source", ODDS_SOURCE_SLUG)
        .eq("season", season)
        .eq("season_type", "regular")
        .gt("kickoff_at", new Date(fromMs).toISOString())
        .lte("kickoff_at", new Date(toMs).toISOString())
        .order("kickoff_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ScheduleRow[];
    },
    { label: "nfl_game_odds upcoming games" },
  );

  const games: WeatherGame[] = [];
  for (const row of rows) {
    if (!row.kickoff_at || !Number.isFinite(Date.parse(row.kickoff_at))) continue;
    games.push({
      season: Number(row.season),
      week: Number(row.week),
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      kickoffAt: row.kickoff_at,
      venueId: typeof row.venue_id === "string" && row.venue_id.length > 0 ? row.venue_id : null,
      neutralSite: row.neutral_site === true,
    });
  }
  return games;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runNflWeatherSync(
  supabase: SupabaseClient<Database>,
  opts: NflWeatherSyncOptions,
): Promise<NflWeatherSyncResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const scope: NflWeatherSyncScope = opts.scope === "gameday" ? "gameday" : "nightly";
  const clock = () => opts.now ?? Date.now();
  const nowMs = clock();
  const pauseMs = opts.pauseMs ?? DEFAULT_PAUSE_MS;

  const failedGames: string[] = [];
  const unresolvedGames: string[] = [];
  const beyondHorizonGames: string[] = [];
  const perGame: NflWeatherSyncResult["perGame"] = [];
  const providers = new Set<string>();
  let indoorRowsWritten = 0;
  let snapshotsWritten = 0;
  let season: number | null = null;
  let targetedGames = 0;

  const finish = (partial: { skipped: boolean; reason?: string }): NflWeatherSyncResult => {
    const finished = Date.now();
    return {
      ok: true,
      scope,
      season,
      targetedGames,
      indoorRowsWritten,
      snapshotsWritten,
      failedGames,
      unresolvedGames,
      beyondHorizonGames,
      providers: [...providers].sort(),
      perGame,
      startedAt,
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      ...partial,
    };
  };

  const seasonClock = await resolveSeasonClock(supabase, nowMs);
  season = seasonClock.season;
  if (season === null) {
    return finish({ skipped: true, reason: "no current season: no regular-season projections are stored" });
  }

  const horizonMs = nowMs + SCOPE_HORIZON_HOURS[scope] * HOUR_MS;
  const games = await loadUpcomingGames(supabase, season, nowMs, horizonMs);
  targetedGames = games.length;
  if (games.length === 0) {
    return finish({
      skipped: true,
      reason: `no ${season} regular-season game kicks off in the next ${SCOPE_HORIZON_HOURS[scope]} hours`,
    });
  }

  const stadiums = await withRetry(
    async () => {
      const { data, error } = await supabase.from("nfl_stadiums").select(STADIUM_COLUMNS);
      if (error) throw error;
      return (data ?? []) as WeatherStadiumRow[];
    },
    { label: "nfl_stadiums read" },
  );

  const keyOf = (game: WeatherGame) => gameKeyFor(game.season, game.week, game.awayTeam, game.homeTeam);

  // Which targeted games already have their one indoor row.
  const hasIndoorRow = new Set<string>();
  await withRetry(
    async () => {
      const { data, error } = await supabase
        .from("nfl_game_weather")
        .select("game_key")
        .eq("provider", INDOOR_PROVIDER)
        .in("game_key", games.map(keyOf));
      if (error) throw error;
      for (const row of data ?? []) hasIndoorRow.add(row.game_key);
    },
    { label: "nfl_game_weather indoor rows read" },
  );

  const insertRow = async (row: WeatherInsert) => {
    await withRetry(
      async () => {
        const { error } = await supabase.from("nfl_game_weather").insert(row);
        if (error) throw error;
      },
      { label: `nfl_game_weather insert ${row.game_key} ${row.provider}` },
    );
    providers.add(row.provider);
  };

  let providerCalls = 0;
  for (const game of games) {
    const key = keyOf(game);
    const stadium = resolveStadium(game, stadiums);

    if (!stadium) {
      unresolvedGames.push(key);
      perGame.push({ game: key, stadium: null, provider: null, status: "unresolved" });
      console.warn(
        `  ${key}: no stadium (ESPN venue ${game.venueId ?? "missing"}${game.neutralSite ? ", neutral site" : ""}), skipped`,
      );
      continue;
    }

    // A retractable roof is read as closed: no feed says whether it will open.
    if (stadium.roof !== "outdoors") {
      if (hasIndoorRow.has(key)) {
        perGame.push({ game: key, stadium: stadium.id, provider: INDOOR_PROVIDER, status: "indoor-exists" });
        continue;
      }
      await insertRow(buildIndoorRow(game, stadium.id, clock()));
      hasIndoorRow.add(key);
      indoorRowsWritten += 1;
      perGame.push({ game: key, stadium: stadium.id, provider: INDOOR_PROVIDER, status: "indoor-written" });
      console.log(`  ${key}: ${stadium.id} has a roof, indoor row written`);
      continue;
    }

    const provider = stadium.country === "US" ? "nws" : "met-norway";

    if (opts.deadlineMs !== undefined && Date.now() > opts.deadlineMs) {
      failedGames.push(key);
      perGame.push({ game: key, stadium: stadium.id, provider, status: "failed" });
      console.warn(`  ${key}: out of time before its ${provider} request, existing snapshot left as the newest`);
      continue;
    }

    if (providerCalls > 0 && pauseMs > 0) await pause(pauseMs);
    providerCalls += 1;

    let result: KickoffForecastResult;
    if (provider === "nws") {
      const grid = await ensureNwsGrid(supabase, stadium, nowMs);
      const target: WeatherStadium = {
        latitude: stadium.latitude,
        longitude: stadium.longitude,
        elevationM: stadium.elevation_m,
        nwsGrid: grid,
      };
      // No grid means the lookup failed and nothing was cached: a failed
      // request, said once here rather than repeated inside the adapter.
      result = grid ? await getNwsKickoffForecast(target, game.kickoffAt) : { status: "failed" };
    } else {
      result = await getMetNorwayKickoffForecast(
        {
          latitude: stadium.latitude,
          longitude: stadium.longitude,
          elevationM: stadium.elevation_m,
          nwsGrid: null,
        },
        game.kickoffAt,
      );
    }

    if (result.status === "failed") {
      failedGames.push(key);
      perGame.push({ game: key, stadium: stadium.id, provider, status: "failed" });
      console.warn(`  ${key}: ${provider} request failed, existing snapshot left as the newest`);
      continue;
    }
    if (result.status === "outside-horizon") {
      beyondHorizonGames.push(key);
      perGame.push({ game: key, stadium: stadium.id, provider, status: "beyond-horizon" });
      console.log(`  ${key}: ${provider} has not published the kickoff hour yet`);
      continue;
    }

    await insertRow(buildSnapshotRow(game, stadium.id, result.forecast, clock()));
    snapshotsWritten += 1;
    perGame.push({ game: key, stadium: stadium.id, provider, status: "snapshot" });
    console.log(
      `  ${key}: ${provider} ${result.forecast.temp_f ?? "?"} F, wind ${result.forecast.wind_mph ?? "?"} mph, ${result.forecast.conditions ?? "no description"}`,
    );
  }

  // At least one game needed a provider and not one forecast came back: an
  // outage, and it has to be said in the ledger. See the header.
  if (failedGames.length > 0 && snapshotsWritten === 0) {
    throw new Error(
      `Weather provider requests failed for ${failedGames.length} game(s) (${failedGames.join(", ")}) and no forecast came back for any game, ${scope} scope; treating this as an outage rather than a healthy run.`,
    );
  }

  return finish({ skipped: false });
}
