/**
 * Positional WAR with the IDP switch (plan IDP-308).
 *
 * engine.golden.test.ts pins the OFF path. These pin the ON path: the
 * defensive slots are filled, a curve is drawn per defensive position, a
 * dual-eligible player is drawn on his primary's curve only, and an ordinary
 * league is untouched by the switch.
 */

import { describe, expect, it } from "vitest";
import { startingSlots } from "@/lib/power-pulse/lineup";
import { readGolden } from "@/lib/power-pulse/test-fixtures";
import { slotEligibility, type PulsePosition } from "@/lib/power-pulse/types";
import { computeCurves } from "./engine";
import { DEFAULT_WAR_SETTINGS } from "./default-settings";
import { buildMergedFill } from "./replacement";
import type { WarInput, WarPlayerInput } from "./types";

const FROM = 1;
const TO = 8;

function ladder(
  position: string,
  count: number,
  top: number,
  step: number,
  eligible?: string[],
): WarPlayerInput[] {
  const out: WarPlayerInput[] = [];
  for (let i = 0; i < count; i += 1) {
    const points = Math.max(0.5, top - i * step);
    const byWeek = new Map<number, { points: number; sigma: number }>();
    for (let week = FROM; week <= TO; week += 1) {
      if (week === 3 && i % 7 === 0) continue;
      byWeek.set(week, { points, sigma: points * 0.5 });
    }
    out.push({
      playerId: `${position}-${i + 1}`,
      sleeperId: `s${position}${i + 1}`,
      slug: `${position.toLowerCase()}-${i + 1}`,
      name: `${position}${i + 1}`,
      team: null,
      injuryStatus: null,
      position: position as PulsePosition,
      ...(eligible ? { eligible } : {}),
      byWeek,
    });
  }
  return out;
}

const SETTINGS = {
  displayDepthMultiple: DEFAULT_WAR_SETTINGS.displayDepthMultiple,
  minDisplayDepth: DEFAULT_WAR_SETTINGS.minDisplayDepth,
  cliffThreshold: DEFAULT_WAR_SETTINGS.cliffThreshold,
  clampBelowReplacement: DEFAULT_WAR_SETTINGS.clampBelowReplacement,
};

const IDP = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "DL", "LB", "LB", "DB", "IDP_FLEX", "BN"];
const ONE_QB = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN"];
const DEFENSIVE = new Set(["DL", "LB", "DB"]);

function universe(): WarPlayerInput[] {
  return [
    ...ladder("QB", 30, 22, 0.4),
    ...ladder("RB", 50, 21, 0.35),
    ...ladder("WR", 60, 20, 0.28),
    ...ladder("TE", 30, 15, 0.32),
    ...ladder("K", 20, 7.5, 0.09),
    ...ladder("DEF", 20, 8.4, 0.12),
    ...ladder("DL", 40, 12, 0.2, ["DL", "LB"]),
    ...ladder("LB", 40, 14, 0.25, ["LB"]),
    ...ladder("DB", 50, 11, 0.15, ["DB"]),
  ];
}

function input(rosterPositions: string[], idpEnabled: boolean, players = universe()): WarInput {
  return {
    league: {
      season: 2026,
      slots: startingSlots(rosterPositions, slotEligibility(idpEnabled)),
      teamCount: 10,
      fromWeek: FROM,
      toWeek: TO,
      idpEnabled,
    },
    players,
    settings: SETTINGS,
  };
}

describe("computeCurves with the IDP switch", () => {
  it("draws a curve for each defensive position when on, and none when off", () => {
    const on = computeCurves(input(IDP, true));
    const off = computeCurves(input(IDP, false));
    expect(on.curves.map((c) => c.position)).toEqual(expect.arrayContaining(["DL", "LB", "DB"]));
    expect(off.curves.map((c) => c.position)).not.toContain("LB");
  });

  it("matches the switch-on golden for the IDP league", () => {
    const { actual, expected } = readGolden(__dirname, "war-idp-on", computeCurves(input(IDP, true)));
    expect(actual).toEqual(expected);
  });

  it("draws each player on his primary's curve only", () => {
    const on = computeCurves(input(IDP, true));
    const lbCurve = on.curves.find((c) => c.position === "LB")!;
    expect(lbCurve.curve.every((point) => point.playerId.startsWith("LB-"))).toBe(true);
    const dlCurve = on.curves.find((c) => c.position === "DL")!;
    expect(dlCurve.curve.every((point) => point.playerId.startsWith("DL-"))).toBe(true);
  });

  it("changes nothing for an ordinary league when the switch is on, defenders in the universe or not", () => {
    const offensive = universe().filter((p) => !DEFENSIVE.has(p.position));
    const off = computeCurves(input(ONE_QB, false, offensive));
    const on = computeCurves(input(ONE_QB, true));
    expect(on).toEqual(off);
  });
});

describe("buildMergedFill with dual eligibility (plan R-3)", () => {
  it("credits a DL/LB player seated in an LB slot to LB, and benches a dual player at both", () => {
    const fill = buildMergedFill({
      slots: ["DL", "LB"],
      teamCount: 1,
      week: 1,
      eligibility: slotEligibility(true),
      candidates: [
        { playerId: "dl-top", position: "DL", points: 15, sigma: 1 },
        { playerId: "edge", position: "DL", eligible: ["DL", "LB"], points: 12, sigma: 1 },
        { playerId: "lb-weak", position: "LB", points: 6, sigma: 1 },
        { playerId: "edge-2", position: "DL", eligible: ["DL", "LB"], points: 5, sigma: 1 },
      ],
    });
    expect(fill.seatedByPosition.get("DL")).toEqual([15]);
    expect(fill.seatedByPosition.get("LB")).toEqual([12]);
    expect(fill.benchedByPosition.get("DL")).toContain(5);
    expect(fill.benchedByPosition.get("LB")).toEqual(expect.arrayContaining([6, 5]));
    // The invariant: nobody benched and eligible outscores a seat.
    const maxBenchedLb = Math.max(...(fill.benchedByPosition.get("LB") ?? []));
    expect(maxBenchedLb).toBeLessThanOrEqual(Math.min(...(fill.seatedByPosition.get("LB") ?? [])));
  });
});
