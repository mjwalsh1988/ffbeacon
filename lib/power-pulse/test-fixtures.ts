/**
 * Shared fixtures for the IDP golden tests (plan IDP-101).
 *
 * A NON-TEST module imported only by tests. It exists so the golden files for
 * every League Pulse engine are built from the same two leagues: the ordinary
 * one lifted from `chopped.test.ts`, and an IDP league with defenders on its
 * rosters. The goldens are captured before any engine changes and must stay
 * green through the IDP build with the switch off, which is what proves the
 * build leaves every existing number alone.
 *
 * Nothing in production imports this file.
 */

import { DEFAULT_POWER_PULSE_SETTINGS } from "./default-settings";
import type { PowerPulseInput } from "./engine";
import type { LeagueRow, PlayerRow, ProjectionRow, RosterRow } from "./load";
import type { PulsePosition, ScheduleWeek } from "./types";

export const FIXTURE_SEASON = 2026;
export const FIXTURE_CURRENT_WEEK = 5;
export const FIXTURE_THROUGH_WEEK = 14;
const TEAM_COUNT = 4;

/** Sleeper's default IDP scoring (plan D-1). Kept literal here on purpose. */
export const FIXTURE_IDP123: Record<string, number> = {
  idp_tkl_solo: 2,
  idp_tkl_ast: 1,
  idp_tkl_loss: 2,
  idp_sack: 6,
  idp_qb_hit: 1,
  idp_pass_def: 3,
  idp_ff: 3,
  idp_fum_rec: 3,
  idp_safe: 3,
  idp_blk_kick: 3,
  idp_int: 6,
  idp_def_td: 6,
};

const OFFENSE_SCORING = { rec: 1, pass_yd: 0.04, rush_yd: 0.1, rec_yd: 0.1 };
const OFFENSE_FIXTURE_POSITIONS: PulsePosition[] = ["QB", "RB", "WR", "TE"];

/** An IDP roster: one DL who is also LB-eligible, one LB, two DBs. */
export const IDP_FIXTURE_ROSTER: { key: string; position: string; eligible: string[] }[] = [
  { key: "DL", position: "DL", eligible: ["DL", "LB"] },
  { key: "LB", position: "LB", eligible: ["LB"] },
  { key: "DB1", position: "DB", eligible: ["DB"] },
  { key: "DB2", position: "DB", eligible: ["DB"] },
];

/** A player row that may carry the eligibility list IDP-122 adds to PlayerRow. */
export type FixturePlayerRow = PlayerRow & { eligible?: string[] };

export function fixtureLeague(overrides: Partial<LeagueRow> = {}): LeagueRow {
  return {
    id: "league-row-1",
    sleeperLeagueId: "sleeper-1",
    name: "Test League",
    season: FIXTURE_SEASON,
    status: "in_season",
    rosterPositions: ["QB", "RB", "WR", "TE", "BN"],
    scoringSettings: OFFENSE_SCORING,
    playoffTeams: 2,
    playoffWeekStart: 15,
    playoffRoundType: 0,
    medianMatch: false,
    chopped: false,
    ...overrides,
  };
}

export function idpFixtureLeague(overrides: Partial<LeagueRow> = {}): LeagueRow {
  return fixtureLeague({
    rosterPositions: ["QB", "RB", "WR", "TE", "DL", "LB", "DB", "IDP_FLEX", "BN"],
    scoringSettings: { ...OFFENSE_SCORING, ...FIXTURE_IDP123 },
    ...overrides,
  });
}

function rosterIds(n: number, idp: boolean): string[] {
  const offense = OFFENSE_FIXTURE_POSITIONS.map((p) => `s-${n}-${p}`);
  if (!idp) return offense;
  return [...offense, ...IDP_FIXTURE_ROSTER.map((p) => `s-${n}-${p.key}`)];
}

function fixtureRoster(n: number, idp: boolean): RosterRow {
  const ids = rosterIds(n, idp);
  return {
    id: `roster-row-${n}`,
    sleeperRosterId: n,
    playerSleeperIds: ids,
    starterSleeperIds: ids,
    reserveSleeperIds: [],
    taxiSleeperIds: [],
    wins: 2,
    losses: 2,
    ties: 0,
    pointsFor: 400 + n * 10,
    teamName: `Team ${n}`,
    ownerUserId: `user-${n}`,
    ownerHandle: `manager${n}`,
    ownerAvatarId: null,
  };
}

function fixturePlayers(idp: boolean): Map<string, PlayerRow> {
  const out = new Map<string, PlayerRow>();
  for (let n = 1; n <= TEAM_COUNT; n += 1) {
    for (const position of OFFENSE_FIXTURE_POSITIONS) {
      const sleeperId = `s-${n}-${position}`;
      out.set(sleeperId, {
        playerId: `p-${n}-${position}`,
        sleeperId,
        name: `Player ${n} ${position}`,
        position,
        team: "BUF",
        injuryStatus: null,
        depthOrder: 1,
      });
    }
    if (!idp) continue;
    for (const def of IDP_FIXTURE_ROSTER) {
      const sleeperId = `s-${n}-${def.key}`;
      const row: FixturePlayerRow = {
        playerId: `p-${n}-${def.key}`,
        sleeperId,
        name: `Player ${n} ${def.key}`,
        position: def.position as PulsePosition,
        team: "DAL",
        injuryStatus: null,
        depthOrder: 1,
        eligible: def.eligible,
      };
      out.set(sleeperId, row);
    }
  }
  return out;
}

/** A defender's projected line: Sleeper projects idp_* keys and no pts_* worth reading. */
export function fixtureIdpLine(n: number, key: string): Record<string, number> {
  const base = 3 + n;
  return {
    idp_tkl: base + 2,
    idp_tkl_solo: base,
    idp_tkl_ast: 2,
    idp_tkl_loss: key === "DL" ? 0.6 : 0.2,
    idp_sack: key === "DL" ? 0.5 : 0.1,
    idp_qb_hit: key === "DL" ? 1.1 : 0.2,
    idp_pass_def: key.startsWith("DB") ? 0.8 : 0.2,
    idp_int: key.startsWith("DB") ? 0.1 : 0.02,
  };
}

function fixtureProjections(throughWeek: number, idp: boolean): ProjectionRow[] {
  const out: ProjectionRow[] = [];
  for (let n = 1; n <= TEAM_COUNT; n += 1) {
    for (let week = FIXTURE_CURRENT_WEEK; week <= throughWeek; week += 1) {
      for (const position of OFFENSE_FIXTURE_POSITIONS) {
        const points = 10 + n * 2;
        out.push({
          playerId: `p-${n}-${position}`,
          week,
          opponent: "MIA",
          statLine: null,
          ppr: points,
          halfPpr: points,
          std: points,
          availability: "projected",
          injuryStatus: null,
        });
      }
      if (!idp) continue;
      for (const def of IDP_FIXTURE_ROSTER) {
        out.push({
          playerId: `p-${n}-${def.key}`,
          week,
          opponent: "MIA",
          statLine: fixtureIdpLine(n, def.key),
          ppr: null,
          halfPpr: null,
          std: null,
          availability: "projected",
          injuryStatus: null,
        });
      }
    }
  }
  return out;
}

function fixtureSchedule(throughWeek: number): ScheduleWeek[] {
  const weeks: ScheduleWeek[] = [];
  for (let week = FIXTURE_CURRENT_WEEK; week <= throughWeek; week += 1) {
    weeks.push({
      week,
      isFinal: false,
      opponents: new Map([
        [1, 2],
        [2, 1],
        [3, 4],
        [4, 3],
      ]),
    });
  }
  return weeks;
}

/** The ordinary league from chopped.test.ts, as a full engine input. */
export function fixturePowerPulseInput(overrides: Partial<PowerPulseInput> = {}): PowerPulseInput {
  return buildInput(false, overrides);
}

/** The IDP league: IDP slots, IDP123 merged into scoring, four defenders a roster. */
export function idpFixturePowerPulseInput(
  overrides: Partial<PowerPulseInput> = {},
): PowerPulseInput {
  return buildInput(true, overrides);
}

function buildInput(idp: boolean, overrides: Partial<PowerPulseInput>): PowerPulseInput {
  return {
    league: idp ? idpFixtureLeague() : fixtureLeague(),
    rosters: [1, 2, 3, 4].map((n) => fixtureRoster(n, idp)),
    players: fixturePlayers(idp),
    projections: fixtureProjections(FIXTURE_THROUGH_WEEK, idp),
    accuracy: new Map(),
    defense: new Map(),
    defenseSeasons: [FIXTURE_SEASON],
    schedule: fixtureSchedule(FIXTURE_THROUGH_WEEK),
    setLineups: new Map(),
    results: new Map(),
    currentWeek: FIXTURE_CURRENT_WEEK,
    settings: DEFAULT_POWER_PULSE_SETTINGS,
    ...overrides,
  };
}

/** Keys holding a model or cache version. Stripped so a version bump is not a diff. */
const VERSION_KEYS = new Set(["modelVersion", "model_version", "version", "cacheShapeVersion"]);

/**
 * A JSON string with sorted keys, Maps as sorted entry objects and Sets as
 * sorted arrays, and every version field removed. Two runs of a pure engine on
 * the same input produce the same string, and a real change produces a diff a
 * person can read.
 */
export function goldenJson(value: unknown): string {
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

function normalize(value: unknown): unknown {
  if (value instanceof Map) {
    const entries = [...value.entries()].map(([k, v]) => [String(k), normalize(v)] as const);
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return { __map: Object.fromEntries(entries) };
  }
  if (value instanceof Set) {
    const items = [...value].map(normalize);
    items.sort((a, b) => {
      const sa = JSON.stringify(a);
      const sb = JSON.stringify(b);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
    return { __set: items };
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    return value;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (VERSION_KEYS.has(key)) continue;
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = normalize(v);
    }
    return out;
  }
  return value;
}

/**
 * Read a golden file and return it beside the freshly computed value, both
 * parsed, so the caller asserts `toEqual`. A missing golden is written only
 * when UPDATE_GOLDENS=1 is set; otherwise it is a failure, so a golden cannot
 * quietly regenerate itself around a regression.
 */
export function readGolden(
  dir: string,
  name: string,
  value: unknown,
): { actual: unknown; expected: unknown } {
  // Required lazily so a test that never touches a golden never loads fs.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  const file = path.join(dir, "golden", `${name}.json`);
  const text = goldenJson(value);
  if (process.env.UPDATE_GOLDENS === "1") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  if (!fs.existsSync(file)) {
    throw new Error(`golden ${file} is missing; capture it with UPDATE_GOLDENS=1 on untouched code`);
  }
  return { actual: JSON.parse(text), expected: JSON.parse(fs.readFileSync(file, "utf8")) };
}
