/**
 * Golden output for computeCurves (plan IDP-101). Captured on untouched code;
 * must hold unchanged while the IDP switch is off.
 */

import { describe, expect, it } from "vitest";
import { startingSlots } from "@/lib/power-pulse/lineup";
import { readGolden } from "@/lib/power-pulse/test-fixtures";
import type { PulsePosition } from "@/lib/power-pulse/types";
import { computeCurves } from "./engine";
import { DEFAULT_WAR_SETTINGS } from "./default-settings";
import type { WarInput, WarPlayerInput } from "./types";

const FROM = 1;
const TO = 8;
const CV: Record<string, number> = { QB: 0.35, RB: 0.55, WR: 0.65, TE: 0.7, K: 0.5, DEF: 0.75, DL: 0.6, LB: 0.45, DB: 0.6 };

function ladder(position: string, count: number, top: number, step: number): WarPlayerInput[] {
  const out: WarPlayerInput[] = [];
  for (let i = 0; i < count; i += 1) {
    const points = Math.max(0.5, top - i * step);
    const byWeek = new Map<number, { points: number; sigma: number }>();
    for (let week = FROM; week <= TO; week += 1) {
      // Every seventh player misses week 3, so replacement level moves on a bye.
      if (week === 3 && i % 7 === 0) continue;
      byWeek.set(week, { points, sigma: points * CV[position] });
    }
    out.push({
      playerId: `${position}-${i + 1}`,
      sleeperId: `s${position}${i + 1}`,
      slug: `${position.toLowerCase()}-${i + 1}`,
      name: `${position}${i + 1}`,
      team: null,
      injuryStatus: null,
      position: position as PulsePosition,
      byWeek,
    });
  }
  return out;
}

function input(rosterPositions: string[], idp: boolean): WarInput {
  const players = [
    ...ladder("QB", 30, 22, 0.4),
    ...ladder("RB", 50, 21, 0.35),
    ...ladder("WR", 60, 20, 0.28),
    ...ladder("TE", 30, 15, 0.32),
    ...ladder("K", 20, 7.5, 0.09),
    ...ladder("DEF", 20, 8.4, 0.12),
    ...(idp ? [...ladder("DL", 40, 12, 0.2), ...ladder("LB", 40, 14, 0.25), ...ladder("DB", 50, 11, 0.15)] : []),
  ];
  return {
    league: { season: 2026, slots: startingSlots(rosterPositions), teamCount: 10, fromWeek: FROM, toWeek: TO },
    players,
    settings: {
      displayDepthMultiple: DEFAULT_WAR_SETTINGS.displayDepthMultiple,
      minDisplayDepth: DEFAULT_WAR_SETTINGS.minDisplayDepth,
      cliffThreshold: DEFAULT_WAR_SETTINGS.cliffThreshold,
      clampBelowReplacement: DEFAULT_WAR_SETTINGS.clampBelowReplacement,
    },
  };
}

const ONE_QB = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN"];
const IDP = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "DL", "LB", "LB", "DB", "IDP_FLEX", "BN"];

describe("computeCurves golden output", () => {
  it("matches the golden for the ordinary league", () => {
    const { actual, expected } = readGolden(__dirname, "war-offense", computeCurves(input(ONE_QB, false)));
    expect(actual).toEqual(expected);
  });

  it("matches the golden for the IDP league", () => {
    const { actual, expected } = readGolden(__dirname, "war-idp", computeCurves(input(IDP, true)));
    expect(actual).toEqual(expected);
  });
});
