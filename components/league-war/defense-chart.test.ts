/**
 * The Defense chart's supporting pieces (plan IDP-309): the overlay names a
 * reader's own defender past the chart's depth once a defensive curve exists,
 * and the OG card points at the page rather than drawing the defensive lines.
 */

import { describe, expect, it } from "vitest";
import { splitUnmatchedOwners } from "./overlay";
import { hasDefensiveCurve, DEFENSIVE_CURVE_NOTE } from "@/app/api/og/war/[league_id]/card";

const info = new Map([
  ["lb1", { name: "Test Linebacker", position: "LB" }],
  ["wr1", { name: "Test Receiver", position: "WR" }],
]);

describe("splitUnmatchedOwners with a Defense chart", () => {
  it("counts a defender as unplotted by default, as before", () => {
    const out = splitUnmatchedOwners(["lb1", "wr1"], info as never);
    expect(out.pastDepth.map((p) => p.sleeperId)).toEqual(["wr1"]);
    expect(out.noProjectionCount).toBe(1);
  });

  it("names him once the page plots his position", () => {
    const out = splitUnmatchedOwners(["lb1", "wr1"], info as never, new Set(["WR", "LB"]));
    expect(out.pastDepth.map((p) => p.sleeperId).sort()).toEqual(["lb1", "wr1"]);
    expect(out.noProjectionCount).toBe(0);
  });
});

describe("the OG card and defensive curves", () => {
  const row = (position: string, points: number) => ({
    position,
    structural_demand: 10,
    war_rank_1: 1,
    war_at_demand: 0.1,
    cliff_rank: null,
    curve: Array.from({ length: points }, (_, i) => ({ positionRank: i + 1 })),
  });

  it("carries the note only when a defensive curve has players", () => {
    expect(hasDefensiveCurve([row("QB", 3)])).toBe(false);
    expect(hasDefensiveCurve([row("QB", 3), row("LB", 0)])).toBe(false);
    expect(hasDefensiveCurve([row("QB", 3), row("LB", 4)])).toBe(true);
    expect(DEFENSIVE_CURVE_NOTE).toMatch(/league page/);
  });
});
