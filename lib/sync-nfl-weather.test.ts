/**
 * Coverage for runNflWeatherSync: which games get an indoor row, which get a
 * provider call and from whom, what is written, and the failure posture (one
 * failed game is reported, a run with no forecast at all throws, a game the
 * provider has not published yet is neither).
 *
 * The provider functions are mocked, so nothing here touches a network. The
 * Supabase fake answers the three tables the sync reads and records every
 * insert and stadium update. It does not filter by kickoff time: the window is
 * the database's job, and the tests assert the bounds the sync asked for.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./nfl-weather", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./nfl-weather")>();
  return {
    ...actual,
    getNwsKickoffForecast: vi.fn(),
    getMetNorwayKickoffForecast: vi.fn(),
    lookupNwsGrid: vi.fn(),
  };
});
vi.mock("./start-sit/clock", () => ({ resolveSeasonClock: vi.fn() }));

import {
  INDOOR_PROVIDER,
  buildIndoorRow,
  buildSnapshotRow,
  leadHours,
  needsGridLookup,
  resolveStadium,
  runNflWeatherSync,
  type WeatherGame,
  type WeatherStadiumRow,
} from "./sync-nfl-weather";
import {
  getMetNorwayKickoffForecast,
  getNwsKickoffForecast,
  lookupNwsGrid,
  type KickoffForecast,
} from "./nfl-weather";
import { resolveSeasonClock } from "./start-sit/clock";
import type { Database } from "./database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

const nwsMock = vi.mocked(getNwsKickoffForecast);
const metMock = vi.mocked(getMetNorwayKickoffForecast);
const gridMock = vi.mocked(lookupNwsGrid);
const clockMock = vi.mocked(resolveSeasonClock);

type WeatherInsert = Database["public"]["Tables"]["nfl_game_weather"]["Insert"];

/** The eleven columns nfl_game_weather_indoor_is_blank requires to be null. */
const WEATHER_COLUMNS = [
  "temp_f",
  "feels_like_f",
  "wind_mph",
  "wind_gust_mph",
  "wind_dir_deg",
  "wind_mph_max_3h",
  "precip_prob_pct",
  "precip_in",
  "snow_in",
  "humidity_pct",
  "conditions",
] as const;

// Saturday October 3 2026, 05:40 UTC.
const NOW = Date.parse("2026-10-03T05:40:00Z");

function stadium(overrides: Partial<WeatherStadiumRow> & { id: string }): WeatherStadiumRow {
  return {
    country: "US",
    latitude: 40.8135075,
    longitude: -74.0743424,
    elevation_m: 2,
    roof: "outdoors",
    home_teams: [],
    active_from: 2010,
    active_to: null,
    external_ids: {},
    nws_office: "OKX",
    nws_grid_x: 30,
    nws_grid_y: 46,
    nws_grid_checked_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

const METLIFE = () => stadium({ id: "NYC01", home_teams: ["NYG", "NYJ"], external_ids: { espn: "3839" } });
const TOTTENHAM = () =>
  stadium({
    id: "LON02",
    country: "GB",
    latitude: 51.6042151,
    longitude: -0.0662246,
    elevation_m: 13,
    external_ids: { espn: "5534" },
    nws_office: null,
    nws_grid_x: null,
    nws_grid_y: null,
    nws_grid_checked_at: null,
  });
const US_BANK = () => stadium({ id: "MIN01", roof: "dome", home_teams: ["MIN"], external_ids: { espn: "5239" } });
const NRG = () => stadium({ id: "HOU00", roof: "retractable", home_teams: ["HOU"], external_ids: { espn: "3891" } });

type ScheduleRow = {
  season: number;
  week: number;
  home_team: string;
  away_team: string;
  kickoff_at: string | null;
  venue_id: string | null;
  neutral_site: boolean | null;
};

function scheduleRow(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    season: 2026,
    week: 4,
    home_team: "NYG",
    away_team: "ARI",
    kickoff_at: "2026-10-04T17:00:00Z",
    venue_id: "3839",
    neutral_site: false,
    ...overrides,
  };
}

const NYG = () => scheduleRow();
const LONDON = () =>
  scheduleRow({
    home_team: "WAS",
    away_team: "IND",
    kickoff_at: "2026-10-04T13:30:00Z",
    venue_id: "5534",
    neutral_site: true,
  });
const MIN = () =>
  scheduleRow({ home_team: "MIN", away_team: "MIA", kickoff_at: "2026-10-04T20:05:00Z", venue_id: "5239" });
const HOU = () => scheduleRow({ home_team: "HOU", away_team: "DAL", venue_id: "3891" });

function forecast(overrides: Partial<KickoffForecast> = {}): KickoffForecast {
  return {
    provider: "nws",
    temp_f: 66,
    feels_like_f: 66,
    wind_mph: 9,
    wind_gust_mph: 15,
    wind_dir_deg: 110,
    wind_mph_max_3h: 9,
    precip_prob_pct: 43,
    precip_in: 0.05,
    snow_in: 0,
    humidity_pct: 63,
    conditions: "Mostly Cloudy",
    hourly: { periods: [{ startTime: "2026-10-04T13:00:00-04:00" }] },
    ...overrides,
  };
}

function fakeSupabase(state: { games?: ScheduleRow[]; stadiums?: WeatherStadiumRow[]; indoorKeys?: string[] }) {
  const inserts: WeatherInsert[] = [];
  const stadiumUpdates: Array<{ id: unknown; values: Record<string, unknown> }> = [];
  const scheduleFilters: Array<{ op: string; column: string; value: unknown }> = [];
  const reads: string[] = [];

  const client = {
    from(table: string) {
      let op: "select" | "insert" | "update" = "select";
      let payload: unknown = null;
      const builder = {
        select: () => builder,
        order: () => builder,
        in: () => builder,
        eq: (column: string, value: unknown) => {
          if (op === "update" && column === "id") {
            stadiumUpdates.push({ id: value, values: payload as Record<string, unknown> });
          }
          if (table === "nfl_game_odds") scheduleFilters.push({ op: "eq", column, value });
          return builder;
        },
        gt: (column: string, value: unknown) => {
          scheduleFilters.push({ op: "gt", column, value });
          return builder;
        },
        lte: (column: string, value: unknown) => {
          scheduleFilters.push({ op: "lte", column, value });
          return builder;
        },
        insert: (row: unknown) => {
          op = "insert";
          payload = row;
          return builder;
        },
        update: (values: unknown) => {
          op = "update";
          payload = values;
          return builder;
        },
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
          let result: unknown;
          if (op === "insert") {
            inserts.push(payload as WeatherInsert);
            result = { error: null };
          } else if (op === "update") {
            result = { error: null };
          } else {
            reads.push(table);
            if (table === "nfl_game_odds") result = { data: state.games ?? [], error: null };
            else if (table === "nfl_stadiums") result = { data: state.stadiums ?? [], error: null };
            else result = { data: (state.indoorKeys ?? []).map((game_key) => ({ game_key })), error: null };
          }
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
  };

  return {
    client: client as unknown as SupabaseClient<Database>,
    inserts,
    stadiumUpdates,
    scheduleFilters,
    reads,
  };
}

beforeEach(() => {
  nwsMock.mockReset();
  metMock.mockReset();
  gridMock.mockReset();
  clockMock.mockReset();
  clockMock.mockResolvedValue({ season: 2026, currentWeek: 4, gradedSeason: 2026 });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const game = (row: ScheduleRow): WeatherGame => ({
  season: row.season,
  week: row.week,
  homeTeam: row.home_team,
  awayTeam: row.away_team,
  kickoffAt: row.kickoff_at as string,
  venueId: row.venue_id,
  neutralSite: row.neutral_site === true,
});

describe("resolveStadium", () => {
  const stadiums = [METLIFE(), TOTTENHAM(), US_BANK()];

  it("matches ESPN's venue id", () => {
    expect(resolveStadium(game(NYG()), stadiums)?.id).toBe("NYC01");
    expect(resolveStadium(game(LONDON()), stadiums)?.id).toBe("LON02");
  });

  it("prefers the venue id to the home team, which is how a game abroad resolves", () => {
    // Washington is the home team and the game is in London.
    const washington = stadium({ id: "WAS00", home_teams: ["WAS"], external_ids: { espn: "3719" } });
    expect(resolveStadium(game(LONDON()), [washington, ...stadiums])?.id).toBe("LON02");
  });

  it("falls back to the home team's stadium when the row carries no venue id", () => {
    expect(resolveStadium(game(scheduleRow({ venue_id: null })), stadiums)?.id).toBe("NYC01");
  });

  it("does not fall back at a neutral site", () => {
    expect(resolveStadium(game(scheduleRow({ venue_id: null, neutral_site: true })), stadiums)).toBeNull();
  });

  it("does not guess the home stadium for a venue id it does not know", () => {
    expect(resolveStadium(game(scheduleRow({ venue_id: "99999" })), stadiums)).toBeNull();
  });

  it("picks the stadium that was in use that season", () => {
    const old = stadium({ id: "BUF00", home_teams: ["BUF"], active_from: 1973, active_to: 2025 });
    const current = stadium({ id: "BUF01", home_teams: ["BUF"], active_from: 2026 });
    const buffalo = game(scheduleRow({ home_team: "BUF", away_team: "NE", venue_id: null }));
    expect(resolveStadium(buffalo, [old, current])?.id).toBe("BUF01");
    expect(resolveStadium({ ...buffalo, season: 2024 }, [old, current])?.id).toBe("BUF00");
  });
});

describe("the rows", () => {
  it("builds an indoor row with null in every weather column", () => {
    const row = buildIndoorRow(game(MIN()), "MIN01", NOW);
    expect(row.provider).toBe("stadium-roof");
    expect(row.is_indoor).toBe(true);
    for (const column of WEATHER_COLUMNS) {
      expect(row, column).toHaveProperty(column, null);
    }
    expect(row.metadata).toBeNull();
    expect(row.game_key).toBe("2026_04_MIA_MIN");
    expect(row.stadium_id).toBe("MIN01");
  });

  it("builds a snapshot row from a forecast, with the provider's slice as metadata", () => {
    const row = buildSnapshotRow(game(NYG()), "NYC01", forecast(), NOW);
    expect(row).toEqual({
      game_key: "2026_04_ARI_NYG",
      season: 2026,
      season_type: "regular",
      week: 4,
      home_team: "NYG",
      away_team: "ARI",
      kickoff_at: "2026-10-04T17:00:00Z",
      stadium_id: "NYC01",
      fetched_at: "2026-10-03T05:40:00.000Z",
      lead_hours: 35.33,
      provider: "nws",
      is_indoor: false,
      temp_f: 66,
      feels_like_f: 66,
      wind_mph: 9,
      wind_gust_mph: 15,
      wind_dir_deg: 110,
      wind_mph_max_3h: 9,
      precip_prob_pct: 43,
      precip_in: 0.05,
      snow_in: 0,
      humidity_pct: 63,
      conditions: "Mostly Cloudy",
      metadata: { periods: [{ startTime: "2026-10-04T13:00:00-04:00" }] },
    });
  });

  it("measures lead in hours from the fetch to kickoff", () => {
    expect(leadHours("2026-10-04T17:00:00Z", NOW)).toBe(35.33);
    expect(leadHours("2026-10-03T06:40:00Z", NOW)).toBe(1);
    expect(leadHours("2026-10-10T05:40:00Z", NOW)).toBe(168);
  });
});

describe("needsGridLookup", () => {
  it("is false for a grid checked inside 30 days", () => {
    expect(needsGridLookup(METLIFE(), NOW)).toBe(false);
  });

  it("is true for a missing grid, a missing check time, or a check over 30 days old", () => {
    expect(needsGridLookup(stadium({ id: "X", nws_office: null }), NOW)).toBe(true);
    expect(needsGridLookup(stadium({ id: "X", nws_grid_x: null }), NOW)).toBe(true);
    expect(needsGridLookup(stadium({ id: "X", nws_grid_checked_at: null }), NOW)).toBe(true);
    expect(needsGridLookup(stadium({ id: "X", nws_grid_checked_at: "2026-09-02T00:00:00Z" }), NOW)).toBe(true);
    expect(needsGridLookup(stadium({ id: "X", nws_grid_checked_at: "2026-09-04T00:00:00Z" }), NOW)).toBe(false);
  });
});

describe("runNflWeatherSync", () => {
  it("writes an indoor row, an NWS snapshot and a MET Norway snapshot for a mixed slate", async () => {
    nwsMock.mockResolvedValue({ status: "ok", forecast: forecast() });
    metMock.mockResolvedValue({
      status: "ok",
      forecast: forecast({ provider: "met-norway", wind_gust_mph: null, precip_prob_pct: null, snow_in: null }),
    });
    const db = fakeSupabase({
      games: [LONDON(), NYG(), HOU(), MIN()],
      stadiums: [METLIFE(), TOTTENHAM(), US_BANK(), NRG()],
    });

    const result = await runNflWeatherSync(db.client, { scope: "nightly", now: NOW, pauseMs: 0 });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.scope).toBe("nightly");
    expect(result.season).toBe(2026);
    expect(result.targetedGames).toBe(4);
    expect(result.indoorRowsWritten).toBe(2);
    expect(result.snapshotsWritten).toBe(2);
    expect(result.failedGames).toEqual([]);
    expect(result.unresolvedGames).toEqual([]);
    expect(result.providers).toEqual(["met-norway", "nws", "stadium-roof"]);
    expect(result.perGame).toEqual([
      { game: "2026_04_IND_WAS", stadium: "LON02", provider: "met-norway", status: "snapshot" },
      { game: "2026_04_ARI_NYG", stadium: "NYC01", provider: "nws", status: "snapshot" },
      { game: "2026_04_DAL_HOU", stadium: "HOU00", provider: "stadium-roof", status: "indoor-written" },
      { game: "2026_04_MIA_MIN", stadium: "MIN01", provider: "stadium-roof", status: "indoor-written" },
    ]);

    expect(db.inserts.map((row) => [row.game_key, row.provider, row.is_indoor])).toEqual([
      ["2026_04_IND_WAS", "met-norway", false],
      ["2026_04_ARI_NYG", "nws", false],
      ["2026_04_DAL_HOU", "stadium-roof", true],
      ["2026_04_MIA_MIN", "stadium-roof", true],
    ]);
    // One provider call per open-air game and none for a roof.
    expect(nwsMock).toHaveBeenCalledTimes(1);
    expect(metMock).toHaveBeenCalledTimes(1);
  });

  it("writes null in every weather column of an indoor row, dome and retractable alike", async () => {
    const db = fakeSupabase({ games: [HOU(), MIN()], stadiums: [US_BANK(), NRG()] });
    await runNflWeatherSync(db.client, { scope: "nightly", now: NOW, pauseMs: 0 });

    expect(db.inserts).toHaveLength(2);
    for (const row of db.inserts) {
      expect(row.provider).toBe(INDOOR_PROVIDER);
      expect(row.is_indoor).toBe(true);
      for (const column of WEATHER_COLUMNS) {
        expect(row, `${row.game_key} ${column}`).toHaveProperty(column, null);
      }
      expect(row.metadata).toBeNull();
    }
    expect(nwsMock).not.toHaveBeenCalled();
    expect(metMock).not.toHaveBeenCalled();
    expect(gridMock).not.toHaveBeenCalled();
  });

  it("never writes a second indoor row for a game that has one", async () => {
    const db = fakeSupabase({
      games: [HOU(), MIN()],
      stadiums: [US_BANK(), NRG()],
      indoorKeys: ["2026_04_MIA_MIN"],
    });
    const result = await runNflWeatherSync(db.client, { scope: "nightly", now: NOW, pauseMs: 0 });

    expect(result.indoorRowsWritten).toBe(1);
    expect(db.inserts.map((row) => row.game_key)).toEqual(["2026_04_DAL_HOU"]);
    expect(result.perGame.map((g) => g.status)).toEqual(["indoor-written", "indoor-exists"]);
    expect(result.skipped).toBe(false);
  });

  it("sends a US stadium to the National Weather Service with its cached grid", async () => {
    nwsMock.mockResolvedValue({ status: "ok", forecast: forecast() });
    const db = fakeSupabase({ games: [NYG()], stadiums: [METLIFE()] });
    await runNflWeatherSync(db.client, { scope: "nightly", now: NOW, pauseMs: 0 });

    expect(nwsMock).toHaveBeenCalledWith(
      {
        latitude: 40.8135075,
        longitude: -74.0743424,
        elevationM: 2,
        nwsGrid: { office: "OKX", gridX: 30, gridY: 46 },
      },
      "2026-10-04T17:00:00Z",
    );
    expect(gridMock).not.toHaveBeenCalled();
    expect(db.stadiumUpdates).toEqual([]);
    expect(metMock).not.toHaveBeenCalled();
  });

  it("sends a stadium abroad to MET Norway with its elevation", async () => {
    metMock.mockResolvedValue({ status: "ok", forecast: forecast({ provider: "met-norway" }) });
    const db = fakeSupabase({ games: [LONDON()], stadiums: [TOTTENHAM()] });
    await runNflWeatherSync(db.client, { scope: "nightly", now: NOW, pauseMs: 0 });

    expect(metMock).toHaveBeenCalledWith(
      { latitude: 51.6042151, longitude: -0.0662246, elevationM: 13, nwsGrid: null },
      "2026-10-04T13:30:00Z",
    );
    expect(nwsMock).not.toHaveBeenCalled();
    expect(gridMock).not.toHaveBeenCalled();
  });

  it("looks up and caches the grid for a stadium that has none", async () => {
    gridMock.mockResolvedValue({ office: "OKX", gridX: 30, gridY: 46 });
    nwsMock.mockResolvedValue({ status: "ok", forecast: forecast() });
    const uncached = stadium({
      id: "NYC01",
      external_ids: { espn: "3839" },
      nws_office: null,
      nws_grid_x: null,
      nws_grid_y: null,
      nws_grid_checked_at: null,
    });
    const db = fakeSupabase({ games: [NYG()], stadiums: [uncached] });
    await runNflWeatherSync(db.client, { scope: "nightly", now: NOW, pauseMs: 0 });

    expect(gridMock).toHaveBeenCalledWith(40.8135075, -74.0743424);
    expect(db.stadiumUpdates).toEqual([
      {
        id: "NYC01",
        values: {
          nws_office: "OKX",
          nws_grid_x: 30,
          nws_grid_y: 46,
          nws_grid_checked_at: "2026-10-03T05:40:00.000Z",
          updated_at: "2026-10-03T05:40:00.000Z",
        },
      },
    ]);
    expect(nwsMock.mock.calls[0][0].nwsGrid).toEqual({ office: "OKX", gridX: 30, gridY: 46 });
  });

  it("looks the grid up once for two games at one stadium", async () => {
    gridMock.mockResolvedValue({ office: "OKX", gridX: 30, gridY: 46 });
    nwsMock.mockResolvedValue({ status: "ok", forecast: forecast() });
    const uncached = stadium({ id: "NYC01", external_ids: { espn: "3839" }, nws_grid_checked_at: null });
    const jets = scheduleRow({ home_team: "NYJ", away_team: "DEN", kickoff_at: "2026-10-05T00:20:00Z" });
    const db = fakeSupabase({ games: [NYG(), jets], stadiums: [uncached] });
    await runNflWeatherSync(db.client, { scope: "nightly", now: NOW, pauseMs: 0 });

    expect(gridMock).toHaveBeenCalledTimes(1);
    expect(nwsMock).toHaveBeenCalledTimes(2);
  });

  it("re-checks a grid cached over 30 days ago and keeps the old cell when the lookup fails", async () => {
    gridMock.mockResolvedValue(null);
    nwsMock.mockResolvedValue({ status: "ok", forecast: forecast() });
    const stale = stadium({ id: "NYC01", external_ids: { espn: "3839" }, nws_grid_checked_at: "2026-08-01T00:00:00Z" });
    const db = fakeSupabase({ games: [NYG()], stadiums: [stale] });
    const result = await runNflWeatherSync(db.client, { scope: "nightly", now: NOW, pauseMs: 0 });

    expect(gridMock).toHaveBeenCalledTimes(1);
    expect(db.stadiumUpdates).toEqual([]);
    expect(nwsMock.mock.calls[0][0].nwsGrid).toEqual({ office: "OKX", gridX: 30, gridY: 46 });
    expect(result.snapshotsWritten).toBe(1);
  });

  it("counts a game as failed when its grid lookup fails and nothing is cached", async () => {
    gridMock.mockResolvedValue(null);
    metMock.mockResolvedValue({ status: "ok", forecast: forecast({ provider: "met-norway" }) });
    const uncached = stadium({ id: "NYC01", external_ids: { espn: "3839" }, nws_office: null });
    const db = fakeSupabase({ games: [LONDON(), NYG()], stadiums: [uncached, TOTTENHAM()] });
    const result = await runNflWeatherSync(db.client, { scope: "nightly", now: NOW, pauseMs: 0 });

    expect(result.failedGames).toEqual(["2026_04_ARI_NYG"]);
    expect(nwsMock).not.toHaveBeenCalled();
    expect(result.snapshotsWritten).toBe(1);
  });

  it("skips a game whose stadium it cannot find, and says which", async () => {
    nwsMock.mockResolvedValue({ status: "ok", forecast: forecast() });
    const elsewhere = scheduleRow({ home_team: "JAX", away_team: "TEN", venue_id: "424242", neutral_site: true });
    const db = fakeSupabase({ games: [elsewhere, NYG()], stadiums: [METLIFE()] });
    const result = await runNflWeatherSync(db.client, { scope: "nightly", now: NOW, pauseMs: 0 });

    expect(result.unresolvedGames).toEqual(["2026_04_TEN_JAX"]);
    expect(result.targetedGames).toBe(2);
    expect(result.snapshotsWritten).toBe(1);
    expect(db.inserts.map((row) => row.game_key)).toEqual(["2026_04_ARI_NYG"]);
  });

  it("asks for the next seven days on a nightly run and the next 24 hours on game day", async () => {
    const nightly = fakeSupabase({ games: [] });
    await runNflWeatherSync(nightly.client, { scope: "nightly", now: NOW, pauseMs: 0 });
    expect(nightly.scheduleFilters).toEqual([
      { op: "eq", column: "source", value: "espn" },
      { op: "eq", column: "season", value: 2026 },
      { op: "eq", column: "season_type", value: "regular" },
      { op: "gt", column: "kickoff_at", value: "2026-10-03T05:40:00.000Z" },
      { op: "lte", column: "kickoff_at", value: "2026-10-10T05:40:00.000Z" },
    ]);

    const gameday = fakeSupabase({ games: [] });
    await runNflWeatherSync(gameday.client, { scope: "gameday", now: NOW, pauseMs: 0 });
    expect(gameday.scheduleFilters.slice(3)).toEqual([
      { op: "gt", column: "kickoff_at", value: "2026-10-03T05:40:00.000Z" },
      { op: "lte", column: "kickoff_at", value: "2026-10-04T05:40:00.000Z" },
    ]);
  });
});

describe("runNflWeatherSync skips", () => {
  it("skips a game day with no game before reading a stadium or calling a provider", async () => {
    const db = fakeSupabase({ games: [], stadiums: [METLIFE()] });
    const result = await runNflWeatherSync(db.client, { scope: "gameday", now: NOW, pauseMs: 0 });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.scope).toBe("gameday");
    expect(result.targetedGames).toBe(0);
    expect(result.reason).toBe("no 2026 regular-season game kicks off in the next 24 hours");
    expect(db.reads).toEqual(["nfl_game_odds"]);
    expect(db.inserts).toEqual([]);
    expect(nwsMock).not.toHaveBeenCalled();
    expect(metMock).not.toHaveBeenCalled();
    expect(gridMock).not.toHaveBeenCalled();
  });

  it("treats a nightly run with no upcoming game as a clean skip, not an error", async () => {
    const db = fakeSupabase({ games: [] });
    const result = await runNflWeatherSync(db.client, { scope: "nightly", now: NOW, pauseMs: 0 });
    expect(result.skipped).toBe(true);
    expect(result.failedGames).toEqual([]);
    expect(result.reason).toBe("no 2026 regular-season game kicks off in the next 168 hours");
  });

  it("skips when there is no current season at all", async () => {
    clockMock.mockResolvedValue({ season: null, currentWeek: 1, gradedSeason: null });
    const db = fakeSupabase({ games: [NYG()], stadiums: [METLIFE()] });
    const result = await runNflWeatherSync(db.client, { scope: "nightly", now: NOW, pauseMs: 0 });
    expect(result.skipped).toBe(true);
    expect(result.season).toBeNull();
    expect(db.reads).toEqual([]);
  });

  it("drops a schedule row with no kickoff time", async () => {
    const db = fakeSupabase({ games: [scheduleRow({ kickoff_at: null })], stadiums: [METLIFE()] });
    const result = await runNflWeatherSync(db.client, { scope: "nightly", now: NOW, pauseMs: 0 });
    expect(result.targetedGames).toBe(0);
    expect(result.skipped).toBe(true);
  });
});

describe("runNflWeatherSync failure posture", () => {
  const buffaloStadium = () => stadium({ id: "BUF01", home_teams: ["BUF"], external_ids: { espn: "11938" } });
  const BUF = () => scheduleRow({ home_team: "BUF", away_team: "NE", venue_id: "11938" });

  it("reports one failed game among successes without throwing, and writes nothing for it", async () => {
    nwsMock.mockImplementation(async (_stadium, kickoff) =>
      kickoff === "2026-10-04T17:00:00Z" ? { status: "failed" } : { status: "ok", forecast: forecast() },
    );
    const late = scheduleRow({ home_team: "BUF", away_team: "NE", venue_id: "11938", kickoff_at: "2026-10-04T20:25:00Z" });
    const db = fakeSupabase({ games: [NYG(), late], stadiums: [METLIFE(), buffaloStadium()] });

    const result = await runNflWeatherSync(db.client, { scope: "nightly", now: NOW, pauseMs: 0 });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.failedGames).toEqual(["2026_04_ARI_NYG"]);
    expect(result.snapshotsWritten).toBe(1);
    expect(db.inserts.map((row) => row.game_key)).toEqual(["2026_04_NE_BUF"]);
  });

  it("throws when every game that needed a provider failed, so the ledger records an error", async () => {
    nwsMock.mockResolvedValue({ status: "failed" });
    metMock.mockResolvedValue({ status: "failed" });
    const db = fakeSupabase({
      games: [LONDON(), NYG(), MIN()],
      stadiums: [METLIFE(), TOTTENHAM(), US_BANK()],
    });

    await expect(runNflWeatherSync(db.client, { scope: "nightly", now: NOW, pauseMs: 0 })).rejects.toThrow(
      "Weather provider requests failed for 2 game(s) (2026_04_IND_WAS, 2026_04_ARI_NYG) and no forecast came back for any game, nightly scope; treating this as an outage rather than a healthy run.",
    );
    // The indoor row needs no provider and is still written before the throw.
    expect(db.inserts.map((row) => row.provider)).toEqual(["stadium-roof"]);
  });

  it("does not throw when the only games are indoors", async () => {
    const db = fakeSupabase({ games: [MIN()], stadiums: [US_BANK()], indoorKeys: ["2026_04_MIA_MIN"] });
    const result = await runNflWeatherSync(db.client, { scope: "gameday", now: NOW, pauseMs: 0 });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.indoorRowsWritten).toBe(0);
    expect(result.snapshotsWritten).toBe(0);
  });

  it("does not call a game the provider has not published a failure", async () => {
    nwsMock.mockResolvedValue({ status: "outside-horizon" });
    const db = fakeSupabase({ games: [NYG(), BUF()], stadiums: [METLIFE(), buffaloStadium()] });
    const result = await runNflWeatherSync(db.client, { scope: "nightly", now: NOW, pauseMs: 0 });

    expect(result.ok).toBe(true);
    expect(result.failedGames).toEqual([]);
    expect(result.beyondHorizonGames).toEqual(["2026_04_ARI_NYG", "2026_04_NE_BUF"]);
    expect(db.inserts).toEqual([]);
  });

  it("stops calling providers past its deadline and reports the games it did not reach", async () => {
    nwsMock.mockResolvedValue({ status: "ok", forecast: forecast() });
    const db = fakeSupabase({ games: [NYG()], stadiums: [METLIFE()] });
    await expect(
      runNflWeatherSync(db.client, { scope: "nightly", now: NOW, pauseMs: 0, deadlineMs: Date.now() - 1 }),
    ).rejects.toThrow(/no forecast came back for any game/);
    expect(nwsMock).not.toHaveBeenCalled();
  });
});
