import { describe, it, expect } from "vitest";
import {
  acceptanceOf,
  measureImpact,
  qualityGapOf,
  qualityRatioOf,
  satisfiesGoal,
  valueGapOf,
} from "./rank";
import { DEFAULT_TRADE_QUALITY_CONFIG } from "@/lib/trade-quality";
import { buildTeamProfile } from "./profile";
import { STANDARD_SLOTS, fullRoster, pick, player, team } from "./_test-kit";
import type { AssetRef } from "./packages";
import type { SideImpact } from "./types";

const BASELINES = { QB: 18, RB: 12, WR: 12, TE: 8 };

const ref = (p: ReturnType<typeof player>): AssetRef => ({ kind: "player", player: p });
const pickRef = (value: number): AssetRef => ({ kind: "pick", pick: pick({ value }) });

const impact = (over: Partial<SideImpact> = {}): SideImpact => ({
  valueDelta: 0,
  lineupDelta: 0,
  ageDelta: 0,
  pickCountDelta: 0,
  ...over,
});

const profileOf = (statusKey: "competitor" | "rebuilder" | "middle" | null) =>
  buildTeamProfile(team({ players: fullRoster(), statusKey }), STANDARD_SLOTS, BASELINES);

describe("valueGapOf", () => {
  it("is zero for a dead heat and grows with the imbalance", () => {
    expect(valueGapOf([ref(player({ value: 1000 }))], [ref(player({ value: 1000 }))])).toBe(0);
    expect(
      valueGapOf([ref(player({ value: 800 }))], [ref(player({ value: 1000 }))]),
    ).toBeCloseTo(0.2, 5);
  });

  it("treats a worthless side as maximally lopsided rather than dividing by zero", () => {
    expect(valueGapOf([], [])).toBe(1);
  });
});

describe("measureImpact", () => {
  it("reports what leaves and what arrives", () => {
    const roster = fullRoster();
    const mine = buildTeamProfile(team({ players: roster }), STANDARD_SLOTS, BASELINES);
    const incoming = [ref(player({ position: "TE", value: 3000, projPoints: 15 }))];
    const outgoing = [ref(roster[6])];

    const result = measureImpact(mine, STANDARD_SLOTS, incoming, outgoing);
    expect(result.valueDelta).toBe(3000 - roster[6].value);
    expect(result.lineupDelta).not.toBeNull();
    expect(result.pickCountDelta).toBe(0);
  });

  it("counts picks moving in each direction", () => {
    const mine = buildTeamProfile(team({ players: fullRoster() }), STANDARD_SLOTS, BASELINES);
    expect(
      measureImpact(mine, STANDARD_SLOTS, [pickRef(2000), pickRef(1000)], []).pickCountDelta,
    ).toBe(2);
    expect(measureImpact(mine, STANDARD_SLOTS, [], [pickRef(2000)]).pickCountDelta).toBe(-1);
  });
});

describe("acceptanceOf", () => {
  it("calls a deal that guts them a long shot however well it fits", () => {
    const theirs = impact({ valueDelta: -3000, pickCountDelta: 2 });
    expect(acceptanceOf(theirs, profileOf("rebuilder"), 0.4)).toBe("long-shot");
  });

  it("calls picks to a rebuilder likely", () => {
    const theirs = impact({ valueDelta: 100, pickCountDelta: 1, ageDelta: -0.5 });
    expect(acceptanceOf(theirs, profileOf("rebuilder"), 0.03)).toBe("likely");
  });

  it("calls points to a contender likely", () => {
    const theirs = impact({ valueDelta: 50, lineupDelta: 3 });
    expect(acceptanceOf(theirs, profileOf("competitor"), 0.02)).toBe("likely");
  });

  it("will not call it likely when it costs a CONTENDER real lineup points", () => {
    const theirs = impact({ valueDelta: 500, lineupDelta: -4, pickCountDelta: 1 });
    expect(acceptanceOf(theirs, profileOf("competitor"), 0.03)).toBe("worth-asking");
  });

  it("does not punish a rebuilder for losing points it was never going to use", () => {
    // The most standard dynasty trade there is: a rebuilder sends a productive
    // veteran away for a pick. It costs them points on Sunday, which is the
    // POINT, and an earlier version called exactly this a long shot.
    const theirs = impact({
      valueDelta: -91,
      lineupDelta: -4.7,
      pickCountDelta: 1,
      ageDelta: -0.6,
    });
    expect(acceptanceOf(theirs, profileOf("rebuilder"), 0.014)).toBe("likely");
  });

  it("still calls it a long shot when a contender loses on both counts", () => {
    const theirs = impact({ valueDelta: -203, lineupDelta: -4.7 });
    expect(acceptanceOf(theirs, profileOf("competitor"), 0.057)).toBe("long-shot");
  });

  it("gives an even deal that fits nobody's plan a worth-asking rather than a no", () => {
    const theirs = impact({ valueDelta: 0, lineupDelta: 0 });
    expect(acceptanceOf(theirs, profileOf("competitor"), 0.01)).toBe("worth-asking");
  });

  it("calls a poor fit they also lose value on a long shot", () => {
    const theirs = impact({ valueDelta: -800, lineupDelta: 0 });
    expect(acceptanceOf(theirs, profileOf("competitor"), 0.15)).toBe("long-shot");
  });
});

describe("satisfiesGoal", () => {
  const shape = { incoming: 1, outgoing: 1 };

  it("lets everything through on best available", () => {
    expect(satisfiesGoal("balanced", impact({ valueDelta: -500 }), shape)).toBe(true);
  });

  it("requires the thing the reader asked for", () => {
    expect(satisfiesGoal("add-picks", impact({ pickCountDelta: 0 }), shape)).toBe(false);
    expect(satisfiesGoal("add-picks", impact({ pickCountDelta: 1 }), shape)).toBe(true);
    expect(satisfiesGoal("win-now", impact({ lineupDelta: -1 }), shape)).toBe(false);
    expect(satisfiesGoal("get-younger", impact({ ageDelta: 0.4 }), shape)).toBe(false);
    expect(satisfiesGoal("get-younger", impact({ ageDelta: -0.4 }), shape)).toBe(true);
  });

  it("does not reject a trade for a number it could not measure", () => {
    // An unmeasurable lineup is a reason to say nothing about it, not a reason
    // to throw the trade away.
    expect(satisfiesGoal("win-now", impact({ lineupDelta: null }), shape)).toBe(true);
    expect(satisfiesGoal("get-younger", impact({ ageDelta: null }), shape)).toBe(true);
  });

  it("enforces the shape goals", () => {
    expect(satisfiesGoal("consolidate", impact(), { incoming: 1, outgoing: 2 })).toBe(true);
    expect(satisfiesGoal("consolidate", impact(), { incoming: 1, outgoing: 1 })).toBe(false);
    expect(satisfiesGoal("add-depth", impact(), { incoming: 2, outgoing: 1 })).toBe(true);
    expect(satisfiesGoal("add-depth", impact(), { incoming: 1, outgoing: 1 })).toBe(false);
  });
});

describe("qualityRatioOf and qualityGapOf", () => {
  const QUALITY = { config: DEFAULT_TRADE_QUALITY_CONFIG, poolMax: 9900 };

  it("reads under 1 when the reader pays with depth for a starter", () => {
    const incoming = [ref(player({ value: 4000 }))];
    const outgoing = [ref(player({ value: 2200 })), ref(player({ value: 2000 }))];
    // Raw values are all but level, so the old gap says this is fair.
    expect(valueGapOf(incoming, outgoing)).toBeLessThan(0.06);
    expect(qualityRatioOf(incoming, outgoing, QUALITY)).toBeLessThan(0.85);
  });

  it("reads about 1 for a like-for-like swap", () => {
    const incoming = [ref(player({ value: 4000 }))];
    const outgoing = [ref(player({ value: 4050 }))];
    expect(qualityRatioOf(incoming, outgoing, QUALITY)).toBeGreaterThan(0.95);
  });

  it("expresses the gap as a share of the larger side, like valueGapOf", () => {
    expect(qualityGapOf(1)).toBe(0);
    expect(qualityGapOf(0.8)).toBeCloseTo(0.2, 6);
    expect(qualityGapOf(1.25)).toBeCloseTo(0.2, 6);
    expect(qualityGapOf(0)).toBe(1);
  });
});

describe("acceptanceOf on the consolidation curve", () => {
  const QUALITY = { config: DEFAULT_TRADE_QUALITY_CONFIG, poolMax: 9900 };

  it("calls a raw-even package-for-starter deal a long shot", () => {
    const incoming = [ref(player({ value: 4000 }))];
    const outgoing = [ref(player({ value: 1400 })), ref(player({ value: 1350 })), ref(player({ value: 1300 }))];
    const gap = valueGapOf(incoming, outgoing);
    const ratio = qualityRatioOf(incoming, outgoing, QUALITY);

    // The counterparty is handed three bodies for one player. Raw value says it
    // is fine; the reason this feature was rebuilt is that it is not.
    const theirs = impact({ valueDelta: 50, lineupDelta: -0.2 });
    expect(acceptanceOf(theirs, profileOf("middle"), gap, ratio)).toBe("long-shot");
  });

  it("still reads a genuine one-for-one as worth asking or better", () => {
    const incoming = [ref(player({ value: 4000 }))];
    const outgoing = [ref(player({ value: 4100 }))];
    const gap = valueGapOf(incoming, outgoing);
    const ratio = qualityRatioOf(incoming, outgoing, QUALITY);

    const theirs = impact({ valueDelta: 100, lineupDelta: 0.8 });
    expect(acceptanceOf(theirs, profileOf("competitor"), gap, ratio)).not.toBe("long-shot");
  });

  it("falls back to raw value when no quality ratio is supplied", () => {
    const theirs = impact({ valueDelta: 400, lineupDelta: 1.2 });
    expect(acceptanceOf(theirs, profileOf("competitor"), 0.02)).toBe("likely");
  });
});
