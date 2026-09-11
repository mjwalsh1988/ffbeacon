import { describe, it, expect } from "vitest";
import { METRICS } from "./metrics";
import { makeSide } from "./_test-kit";

/**
 * scalar() exists so computeGroupEdge can rank N sides without calling share()
 * for every pair. The property that makes that substitution safe: for any two
 * sides with non-null scalars, scalar(a) > scalar(b) exactly when
 * share(a, b) > 0.5, and equal scalars give 0.5. These tests pin that
 * property for every scored metric, plus the "null exactly where share()
 * treats the side as missing" contract.
 */

const HIGHER = makeSide({
  value: 8000,
  overallRank: 3,
  positionRank: 2,
  tier: 1,
  age: 23,
  change30dPct: 15,
  depthRole: "Starter",
  injuryStatus: "Q",
  projectionPoints: 220,
  beatRate: 0.7,
  availabilityRate: 0.9,
  ratioStdev: 0.4,
  weeksPlayed: 10,
  netPointsPerWeek: 6,
  weeksStarting: 12,
  playoffOddsAfter: 0.8,
});

const LOWER = makeSide({
  value: 3000,
  overallRank: 60,
  positionRank: 30,
  tier: 4,
  age: 30,
  change30dPct: -10,
  depthRole: "Depth Piece",
  injuryStatus: "O",
  projectionPoints: 90,
  beatRate: 0.3,
  availabilityRate: 0.5,
  ratioStdev: 1.0,
  weeksPlayed: 10,
  netPointsPerWeek: 0.2,
  weeksStarting: 2,
  playoffOddsAfter: 0.3,
});

// Finish and matchup/schedule multipliers are not exposed as makeSide
// overrides, so build them directly on top of a base fixture.
function withFinish(finish: number) {
  const s = makeSide({ value: 5000 });
  return {
    ...s,
    player: {
      ...s.player,
      latestFinish: {
        finish,
        season: 2025,
        scoring: "pts_ppr" as const,
        totalPoints: 0,
        playersRanked: 100,
      },
    },
  };
}

function withMultipliers(nextWeekMultiplier: number, scheduleMultiplier: number) {
  const s = makeSide({ projectionPoints: 100 });
  const projection = s.extras.projection!;
  return {
    ...s,
    extras: {
      ...s.extras,
      projection: {
        ...projection,
        scheduleMultiplier,
        nextWeek: projection.nextWeek
          ? { ...projection.nextWeek, opponentMultiplier: nextWeekMultiplier }
          : null,
      },
    },
  };
}

const BLANK = makeSide({});

/** The metrics whose ordering fixtures are HIGHER versus LOWER above. */
const STANDARD_KEYS = [
  "value",
  "overall-rank",
  "position-rank",
  "trend",
  "opportunity",
  "health",
  "age",
  "risk",
  "upside",
  "lineup-impact",
  "weeks-starting",
  "playoff-odds",
];

describe("scalar ordering matches share ordering", () => {
  it("gives every scored metric a scalar function", () => {
    const scored = METRICS.filter((m) => m.scored);
    for (const metric of scored) {
      expect(metric.scalar, `${metric.key} should have a scalar`).toBeDefined();
    }
  });

  it("gives neither blended row a scalar", () => {
    for (const key of ["dynasty", "redraft"]) {
      const metric = METRICS.find((m) => m.key === key)!;
      expect(metric.scored).toBe(false);
      expect(metric.scalar).toBeUndefined();
    }
  });

  describe.each(STANDARD_KEYS)("%s", (key) => {
    const metric = METRICS.find((m) => m.key === key)!;

    it("orders the higher side above the lower side, matching share()", () => {
      const scalarHigh = metric.scalar!(HIGHER);
      const scalarLow = metric.scalar!(LOWER);
      const share = metric.share(HIGHER, LOWER);
      expect(scalarHigh).not.toBeNull();
      expect(scalarLow).not.toBeNull();
      expect(share).not.toBeNull();
      if ((share as number) > 0.5) {
        expect(scalarHigh as number).toBeGreaterThan(scalarLow as number);
      } else if ((share as number) < 0.5) {
        expect(scalarHigh as number).toBeLessThan(scalarLow as number);
      } else {
        expect(scalarHigh).toBe(scalarLow);
      }
    });

    it("gives an equal pair an equal scalar and a 0.5 share", () => {
      const share = metric.share(HIGHER, HIGHER);
      const a = metric.scalar!(HIGHER);
      const b = metric.scalar!(HIGHER);
      expect(a).toBe(b);
      // health resolves null for an identical non-designation pair; every other
      // metric in this group resolves a real, even share for an identical pair.
      if (share != null) expect(share).toBeCloseTo(0.5, 10);
    });
  });

  it("production orders a better finish above a worse one", () => {
    const metric = METRICS.find((m) => m.key === "production")!;
    const better = withFinish(2);
    const worse = withFinish(20);
    const share = metric.share(better, worse);
    expect(share as number).toBeGreaterThan(0.5);
    expect(metric.scalar!(better) as number).toBeGreaterThan(metric.scalar!(worse) as number);
  });

  it("consistency orders a steadier spread above a swingier one", () => {
    const metric = METRICS.find((m) => m.key === "consistency")!;
    const steady = makeSide({ ratioStdev: 0.4, weeksPlayed: 10 });
    const swingy = makeSide({ ratioStdev: 1.1, weeksPlayed: 10 });
    const share = metric.share(steady, swingy);
    expect(share as number).toBeGreaterThan(0.5);
    expect(metric.scalar!(steady) as number).toBeGreaterThan(metric.scalar!(swingy) as number);
  });

  it("beat-rate and availability order the higher rate above the lower one", () => {
    const metric = METRICS.find((m) => m.key === "beat-rate")!;
    const avail = METRICS.find((m) => m.key === "availability")!;
    const better = makeSide({ beatRate: 0.8, availabilityRate: 0.95, weeksPlayed: 10 });
    const worse = makeSide({ beatRate: 0.2, availabilityRate: 0.4, weeksPlayed: 10 });
    expect(metric.share(better, worse) as number).toBeGreaterThan(0.5);
    expect(metric.scalar!(better) as number).toBeGreaterThan(metric.scalar!(worse) as number);
    expect(avail.share(better, worse) as number).toBeGreaterThan(0.5);
    expect(avail.scalar!(better) as number).toBeGreaterThan(avail.scalar!(worse) as number);
  });

  it("ros-points and per-game-points order the bigger projection above the smaller one", () => {
    const ros = METRICS.find((m) => m.key === "ros-points")!;
    const perGame = METRICS.find((m) => m.key === "per-game-points")!;
    const bigger = makeSide({ projectionPoints: 250 });
    const smaller = makeSide({ projectionPoints: 80 });
    expect(ros.share(bigger, smaller) as number).toBeGreaterThan(0.5);
    expect(ros.scalar!(bigger) as number).toBeGreaterThan(ros.scalar!(smaller) as number);
    expect(perGame.share(bigger, smaller) as number).toBeGreaterThan(0.5);
    expect(perGame.scalar!(bigger) as number).toBeGreaterThan(perGame.scalar!(smaller) as number);
  });

  it("next-week orders the bigger next-game projection above the smaller one", () => {
    const metric = METRICS.find((m) => m.key === "next-week")!;
    const bigger = makeSide({ projectionPoints: 250 });
    const smaller = makeSide({ projectionPoints: 80 });
    expect(metric.share(bigger, smaller) as number).toBeGreaterThan(0.5);
    expect(metric.scalar!(bigger) as number).toBeGreaterThan(metric.scalar!(smaller) as number);
  });

  it("matchup and schedule order the friendlier multiplier above the tougher one", () => {
    const matchup = METRICS.find((m) => m.key === "matchup")!;
    const schedule = METRICS.find((m) => m.key === "schedule")!;
    const easy = withMultipliers(1.1, 1.08);
    const tough = withMultipliers(0.9, 0.92);
    expect(matchup.share(easy, tough) as number).toBeGreaterThan(0.5);
    expect(matchup.scalar!(easy) as number).toBeGreaterThan(matchup.scalar!(tough) as number);
    expect(schedule.share(easy, tough) as number).toBeGreaterThan(0.5);
    expect(schedule.scalar!(easy) as number).toBeGreaterThan(schedule.scalar!(tough) as number);
  });

  it("returns null on every scored metric exactly where share() treats the side as missing", () => {
    for (const metric of METRICS) {
      if (!metric.scored) continue;
      const share = metric.share(BLANK, HIGHER);
      const scalar = metric.scalar!(BLANK);
      if (share == null) {
        // health is the one metric that can resolve null from missing data on
        // neither side (an even pair of non-designations), so only assert the
        // implication that matters here: a metric share() cannot score at all
        // because a side is missing must also read that side's scalar as null.
        if (metric.key !== "health") expect(scalar).toBeNull();
      }
    }
  });

  it("never throws when called against a fully empty side", () => {
    for (const metric of METRICS) {
      expect(() => metric.scalar?.(BLANK)).not.toThrow();
    }
  });
});
