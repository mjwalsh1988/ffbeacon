/**
 * Golden output for buildLineup (plan IDP-101). Captured on untouched code;
 * must hold unchanged while the IDP switch is off.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_POWER_PULSE_SETTINGS } from "@/lib/power-pulse/default-settings";
import type { AccuracyRow, DefenseRow, PlayerRow, ProjectionRow } from "@/lib/power-pulse/load";
import { FIXTURE_IDP123, fixtureIdpLine, readGolden } from "@/lib/power-pulse/test-fixtures";
import type { PulsePosition } from "@/lib/power-pulse/types";
import { alignedStartingSlots } from "@/lib/league-schedule/slots";
import { EMPTY_GAME_ENVIRONMENT } from "@/lib/nfl-game-environment";
import { buildLineup, type BuildLineupInput } from "./build";

const WEEK = 5;
type Spec = { id: string; position: string; points: number | null; idpKey?: string };

function build(rosterPositions: string[], roster: Spec[], starters: string[], idp: boolean): BuildLineupInput {
  const players = new Map<string, PlayerRow>();
  const projections = new Map<string, ProjectionRow>();
  for (const spec of roster) {
    const row: PlayerRow = {
      playerId: `p-${spec.id}`,
      sleeperId: spec.id,
      name: spec.id,
      position: spec.position as PulsePosition,
      team: "BUF",
      injuryStatus: null,
      depthOrder: null,
    };
    players.set(spec.id, row);
    if (spec.idpKey) {
      projections.set(row.playerId, {
        playerId: row.playerId,
        week: WEEK,
        opponent: "SF",
        statLine: fixtureIdpLine(2, spec.idpKey),
        ppr: null,
        halfPpr: null,
        std: null,
      });
    } else if (spec.points !== null) {
      projections.set(row.playerId, {
        playerId: row.playerId,
        week: WEEK,
        opponent: "SF",
        statLine: null,
        ppr: spec.points,
        halfPpr: spec.points,
        std: spec.points,
      });
    }
  }
  return {
    week: WEEK,
    season: 2026,
    currentWeek: WEEK,
    isFinal: false,
    actualsVisible: false,
    slots: alignedStartingSlots(rosterPositions),
    setStarterIds: starters,
    allPlayerSleeperIds: roster.map((r) => r.id),
    reserveSleeperIds: [],
    taxiSleeperIds: [],
    players,
    projections,
    accuracy: new Map<string, AccuracyRow>(),
    defense: new Map<string, DefenseRow>(),
    defenseSeasons: [2026],
    scoringSettings: { rec: 1, pass_yd: 0.04, rush_yd: 0.1, rec_yd: 0.1, ...(idp ? FIXTURE_IDP123 : {}) },
    settings: DEFAULT_POWER_PULSE_SETTINGS,
    actualByPlayer: new Map(),
    officialActualTotal: null,
    homeAwayByTeamWeek: null,
    environment: EMPTY_GAME_ENVIRONMENT,
    positionalWar: new Map(),
  };
}

const OFFENSE: Spec[] = [
  { id: "qb1", position: "QB", points: 22 },
  { id: "rb1", position: "RB", points: 18 },
  { id: "rb2", position: "RB", points: 9 },
  { id: "wr1", position: "WR", points: 16 },
  { id: "wr2", position: "WR", points: 11 },
  { id: "te1", position: "TE", points: 8 },
  { id: "rb3", position: "RB", points: 14 },
  { id: "wr3", position: "WR", points: null },
];

describe("buildLineup golden output", () => {
  it("matches the golden for the ordinary league", () => {
    const input = build(
      ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN", "BN"],
      OFFENSE,
      ["qb1", "rb1", "rb2", "wr1", "wr2", "te1", "wr3"],
      false,
    );
    const { actual, expected } = readGolden(__dirname, "lineup-offense", buildLineup(input));
    expect(actual).toEqual(expected);
  });

  it("matches the golden for the IDP league", () => {
    const roster: Spec[] = [
      ...OFFENSE,
      { id: "dl1", position: "DL", points: null, idpKey: "DL" },
      { id: "lb1", position: "LB", points: null, idpKey: "LB" },
      { id: "db1", position: "DB", points: null, idpKey: "DB1" },
      { id: "db2", position: "DB", points: null, idpKey: "DB2" },
    ];
    const input = build(
      ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DL", "LB", "DB", "IDP_FLEX", "BN", "BN"],
      roster,
      ["qb1", "rb1", "rb2", "wr1", "wr2", "te1", "wr3", "dl1", "lb1", "db1", "0"],
      true,
    );
    const { actual, expected } = readGolden(__dirname, "lineup-idp", buildLineup(input));
    expect(actual).toEqual(expected);
  });
});
