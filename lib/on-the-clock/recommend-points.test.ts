import { describe, it, expect } from "vitest";
import { recommend, youthScore, type RecommendInput } from "./recommend";
import { DEFAULT_ON_THE_CLOCK_SETTINGS } from "./default-settings";
import type { MarginalOutput, MarginalResult } from "./marginal";
import type { RankedPlayer } from "./board-types";

/**
 * The defect this file exists for.
 *
 * The old Team Need engine multiplied by 1.0 whenever a position had an open
 * dedicated slot, 0.7 for a flex, and 0.25 otherwise, then multiplied tight ends
 * again by the TE-premium factor. Most leagues start exactly one tight end and
 * it is the slot people fill last, so tight end held the 1.0 long after every
 * other position had spilled to 0.7, and value could only move the result across
 * a 50-point band. The card said tight end almost every time.
 *
 * The points engine answers a different question, so these tests assert on the
 * answer rather than on the internals: given a roster that is set at tight end
 * and thin at receiver, the recommendation must be the receiver.
 */

let seq = 0;
function rp(over: Partial<RankedPlayer> = {}): RankedPlayer {
  seq += 1;
  return {
    playerId: over.playerId ?? `p${seq}`,
    sleeperId: `s${seq}`,
    name: over.name ?? `Player ${seq}`,
    position: "WR",
    team: "ATL",
    overallRank: seq,
    positionRank: 1,
    tier: 1,
    value: 1000,
    isRookie: false,
    ...over,
  };
}

function marginalResult(over: Partial<MarginalResult> & { playerId: string }): MarginalResult {
  return {
    startingAdd: 0,
    insuranceAdd: 0,
    dropoffEdge: 0,
    weeksStarting: 0,
    weeksConsidered: 14,
    effectiveAdd: 0,
    driver: "none",
    displaces: null,
    ...over,
  };
}

function marginal(
  results: MarginalResult[],
  over: Partial<MarginalOutput> = {},
): MarginalOutput {
  return {
    baseline: 100,
    startersFilled: 4,
    startingSlotCount: 8,
    fullness: 0.5,
    byPlayer: Object.fromEntries(results.map((r) => [r.playerId, r])),
    ...over,
  };
}

const TEP_SETTINGS = { teams: 12, rounds: 15, slots_qb: 1, slots_rb: 2, slots_wr: 3, slots_te: 1, slots_flex: 1 };

function baseInput(over: Partial<RecommendInput> = {}): RecommendInput {
  return {
    available: [],
    pool: "everyone",
    formatSlug: "dynasty-ppr-tep-sflex",
    formatLabel: "Dynasty TE Premium Superflex",
    draftSettings: TEP_SETTINGS,
    myDraftedPositions: [],
    seededPositions: [],
    rosterKnown: true,
    currentRound: 6,
    settings: DEFAULT_ON_THE_CLOCK_SETTINGS,
    ...over,
  };
}

describe("Team Need, points engine", () => {
  it("stops recommending a replacement tight end just because the slot is open", () => {
    // A roster full of backs and receivers with no tight end, in a TE-premium
    // superflex league: every condition that used to force a tight end.
    // A realistic board, because the defect needs one: the tight end sits just
    // below the best receiver in value, and the rest of the pool spreads the
    // value scale out so that slot fit is what separates the top two.
    const te = rp({ playerId: "te", name: "Fine TE", position: "TE", value: 2800 });
    const wr = rp({ playerId: "wr", name: "Real Starter", position: "WR", value: 3000 });
    const filler = [
      rp({ position: "RB", value: 1000 }),
      rp({ position: "RB", value: 900 }),
      rp({ position: "WR", value: 800 }),
      rp({ position: "QB", value: 700 }),
    ];
    const pool = [wr, te, ...filler];

    const heuristicOnly = recommend(
      baseInput({
        available: pool,
        myDraftedPositions: ["RB", "RB", "WR", "WR", "WR", "QB"],
      }),
    );
    // The old behaviour, still reachable when there are no projections: the open
    // tight end slot wins. This is the defect, pinned so a regression is loud.
    expect(heuristicOnly.engine).toBe("heuristic");
    expect(heuristicOnly.need.player?.playerId).toBe("te");

    // With projections, the tight end adds 2 points a week and the receiver adds
    // 7, so the receiver wins.
    const withPoints = recommend(
      baseInput({
        available: pool,
        myDraftedPositions: ["RB", "RB", "WR", "WR", "WR", "QB"],
        marginal: marginal([
          marginalResult({ playerId: "te", startingAdd: 2, effectiveAdd: 2, driver: "starter" }),
          marginalResult({ playerId: "wr", startingAdd: 7, effectiveAdd: 7, driver: "upgrade" }),
        ]),
      }),
    );
    expect(withPoints.engine).toBe("points");
    expect(withPoints.need.player?.playerId).toBe("wr");
  });

  it("still takes the tight end when the tight end is actually the biggest add", () => {
    const te = rp({ playerId: "te", position: "TE", value: 2200 });
    const wr = rp({ playerId: "wr", position: "WR", value: 2400 });
    const result = recommend(
      baseInput({
        available: [te, wr],
        marginal: marginal([
          marginalResult({ playerId: "te", startingAdd: 9, effectiveAdd: 9, driver: "starter" }),
          marginalResult({ playerId: "wr", startingAdd: 1, effectiveAdd: 1, driver: "upgrade" }),
        ]),
      }),
    );
    expect(result.need.player?.playerId).toBe("te");
  });

  it("hands the decision back to value once the starting lineup is full", () => {
    // Nobody adds anything to a full lineup. With the points weight decayed, the
    // more valuable asset wins instead of an arbitrary tie among zeroes.
    const cheap = rp({ playerId: "cheap", position: "RB", value: 400 });
    const rich = rp({ playerId: "rich", position: "WR", value: 3000 });
    const result = recommend(
      baseInput({
        available: [cheap, rich],
        marginal: marginal(
          [
            marginalResult({ playerId: "cheap", effectiveAdd: 0.2, insuranceAdd: 0.2 }),
            marginalResult({ playerId: "rich", effectiveAdd: 0.1, insuranceAdd: 0.1 }),
          ],
          { fullness: 1, startersFilled: 8 },
        ),
      }),
    );
    expect(result.need.player?.playerId).toBe("rich");
    expect(result.pointsWeight).toBeCloseTo(
      DEFAULT_ON_THE_CLOCK_SETTINGS.buildMode.pointsWeightFull,
      5,
    );
  });

  it("never buries a player who simply has no projection", () => {
    // The rookie carries no marginal entry. He must be judged on value alone
    // rather than scored as if he were projected to contribute nothing.
    const rookie = rp({ playerId: "rookie", position: "RB", value: 5000, isRookie: true });
    const veteran = rp({ playerId: "vet", position: "RB", value: 800 });
    const result = recommend(
      baseInput({
        available: [rookie, veteran],
        marginal: marginal([
          marginalResult({ playerId: "vet", startingAdd: 5, effectiveAdd: 5, driver: "starter" }),
        ]),
      }),
    );
    expect(result.need.player?.playerId).toBe("rookie");
  });

  it("caps the points weight in rebuild mode however empty the lineup is", () => {
    const result = recommend(
      baseInput({
        available: [rp({ playerId: "a", value: 1000 })],
        mode: "rebuild",
        marginal: marginal(
          [marginalResult({ playerId: "a", effectiveAdd: 5 })],
          { fullness: 0, startersFilled: 0 },
        ),
      }),
    );
    expect(result.pointsWeight).toBeLessThanOrEqual(
      DEFAULT_ON_THE_CLOCK_SETTINGS.buildMode.rebuildPointsCap,
    );
    expect(result.mode).toBe("rebuild");
  });
});

describe("Best Value, tilted by mode", () => {
  const older = rp({ playerId: "older", position: "RB", value: 3000, ageDecimal: 29 });
  const younger = rp({ playerId: "younger", position: "RB", value: 2800, ageDecimal: 22 });

  it("takes the highest raw value in balanced mode", () => {
    const result = recommend(baseInput({ available: [older, younger], mode: "balanced" }));
    expect(result.best.player?.playerId).toBe("older");
    expect(result.best.title).toBeUndefined();
  });

  it("prefers the younger asset in rebuild mode and says so on the card", () => {
    const result = recommend(baseInput({ available: [older, younger], mode: "rebuild" }));
    expect(result.best.player?.playerId).toBe("younger");
    expect(result.best.title).toBe("Best value for a rebuild");
  });

  it("labels the contender card without abandoning FF Beacon value", () => {
    const result = recommend(
      baseInput({
        available: [older, younger],
        mode: "compete",
        projections: {
          older: { ppw: 16, br: 0.6 },
          younger: { ppw: 8, br: 0.4 },
        },
      }),
    );
    expect(result.best.player?.playerId).toBe("older");
    expect(result.best.title).toBe("Best value for a contender");
  });
});

describe("youthScore", () => {
  it("adjusts by position, so a 26-year-old back is not a 26-year-old quarterback", () => {
    const rb = youthScore(rp({ position: "RB", ageDecimal: 26 }));
    const qb = youthScore(rp({ position: "QB", ageDecimal: 26 }));
    expect(qb).toBeGreaterThan(rb);
  });

  it("floors at zero rather than going negative for an old player", () => {
    expect(youthScore(rp({ position: "RB", ageDecimal: 36 }))).toBe(0);
  });

  it("is neutral, not punishing, when the age is unknown", () => {
    expect(youthScore(rp({ position: "WR", ageDecimal: undefined, age: undefined }))).toBe(50);
  });
});
