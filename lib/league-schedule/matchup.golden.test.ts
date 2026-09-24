/**
 * Golden output for buildMatchupView (plan IDP-101). Captured on untouched
 * code; must hold unchanged while the IDP switch is off.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_POWER_PULSE_SETTINGS } from "@/lib/power-pulse/default-settings";
import type { PlayerRow, ProjectionRow } from "@/lib/power-pulse/load";
import { FIXTURE_IDP123, fixtureIdpLine, readGolden } from "@/lib/power-pulse/test-fixtures";
import type { PulsePosition } from "@/lib/power-pulse/types";
import { buildMatchupView, type BuildMatchupInput, type MatchupSideInput } from "./matchup";
import { alignedStartingSlots } from "./slots";
import type { ScheduleSlot } from "./types";

const WEEK = 5;
type Spec = { id: string; position: string; points: number | null; idpKey?: string };

function side(slots: ScheduleSlot[], rosterId: number, starters: string[], all: string[]): MatchupSideInput {
  return {
    sleeperRosterId: rosterId,
    rosterRowId: `r-${rosterId}`,
    teamName: `Team ${rosterId}`,
    ownerHandle: null,
    ownerAvatarId: null,
    record: { wins: 3, losses: 1, ties: 0 },
    pulseRank: rosterId,
    setLineup: slots.map((slot, i) => ({ slot, sleeperId: starters[i] ?? null, actualPoints: null })),
    allPlayerSleeperIds: all,
    reserveSleeperIds: [],
    taxiSleeperIds: [],
    actualTotal: null,
    officialPoints: null,
    actualByPlayer: new Map(),
  };
}

function build(
  rosterPositions: string[],
  roster: Spec[],
  home: string[],
  away: string[],
  idp: boolean,
): BuildMatchupInput {
  const slots = alignedStartingSlots(rosterPositions);
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
    const key = `${row.playerId}|${WEEK}`;
    if (spec.idpKey) {
      projections.set(key, {
        playerId: row.playerId,
        week: WEEK,
        opponent: "SF",
        statLine: fixtureIdpLine(1, spec.idpKey),
        ppr: null,
        halfPpr: null,
        std: null,
      });
    } else if (spec.points !== null) {
      projections.set(key, {
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
  const homeAll = roster.filter((r) => r.id.endsWith("a")).map((r) => r.id);
  const awayAll = roster.filter((r) => r.id.endsWith("b")).map((r) => r.id);
  return {
    week: WEEK,
    season: 2026,
    currentWeek: WEEK,
    isFinal: false,
    slots,
    home: side(slots, 1, home, homeAll),
    away: side(slots, 2, away, awayAll),
    players,
    projections,
    accuracy: new Map(),
    defense: new Map(),
    defenseSeasons: [],
    scoringSettings: { rec: 1, pass_yd: 0.04, rush_yd: 0.1, rec_yd: 0.1, ...(idp ? FIXTURE_IDP123 : {}) },
    settings: DEFAULT_POWER_PULSE_SETTINGS,
  };
}

function roster(suffix: string, bump: number, idp: boolean): Spec[] {
  const out: Spec[] = [
    { id: `qb${suffix}`, position: "QB", points: 20 + bump },
    { id: `rb${suffix}`, position: "RB", points: 12 + bump },
    { id: `wr${suffix}`, position: "WR", points: 14 },
    { id: `rbx${suffix}`, position: "RB", points: 15 },
  ];
  if (idp) {
    out.push(
      { id: `dl${suffix}`, position: "DL", points: null, idpKey: "DL" },
      { id: `lb${suffix}`, position: "LB", points: null, idpKey: "LB" },
      { id: `db${suffix}`, position: "DB", points: null, idpKey: "DB1" },
    );
  }
  return out;
}

describe("buildMatchupView golden output", () => {
  it("matches the golden for the ordinary league", () => {
    const input = build(
      ["QB", "RB", "WR", "FLEX", "BN"],
      [...roster("a", 0, false), ...roster("b", 3, false)],
      ["qba", "rba", "wra", "0"],
      ["qbb", "rbb", "wrb", "rbxb"],
      false,
    );
    const { actual, expected } = readGolden(__dirname, "matchup-offense", buildMatchupView(input));
    expect(actual).toEqual(expected);
  });

  it("matches the golden for the IDP league", () => {
    const input = build(
      ["QB", "RB", "WR", "FLEX", "DL", "LB", "DB", "IDP_FLEX", "BN"],
      [...roster("a", 0, true), ...roster("b", 3, true)],
      ["qba", "rba", "wra", "rbxa", "dla", "lba", "dba", "0"],
      ["qbb", "rbb", "wrb", "rbxb", "dlb", "lbb", "dbb", "0"],
      true,
    );
    const { actual, expected } = readGolden(__dirname, "matchup-idp", buildMatchupView(input));
    expect(actual).toEqual(expected);
  });
});
