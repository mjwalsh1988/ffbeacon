import { describe, it, expect } from "vitest";
import {
  PULSE_LIMITS,
  pulseSnapshotFor,
  winsDeltaFor,
  winsPerPoint,
  type PulseSnapshot,
} from "./pulse";

/** A coin-flip matchup: both teams project the same, with the same spread. */
function evenWeek(sigma = 25) {
  return { mean: 110, sigma, opponentMean: 110, opponentSigma: sigma };
}

const snapshot = (over: Partial<PulseSnapshot> = {}): PulseSnapshot => ({
  winsPerPoint: 0.1,
  remainingGames: 10,
  ...over,
});

describe("winsPerPoint", () => {
  it("has nothing to say about a season with no games left", () => {
    expect(winsPerPoint([])).toBeNull();
  });

  it("skips a week with no opponent rather than scoring a phantom", () => {
    expect(
      winsPerPoint([{ mean: 110, sigma: 25, opponentMean: null, opponentSigma: null }]),
    ).toBeNull();
  });

  it("lands in the range a real remaining season produces", () => {
    // Ten coin-flip weeks against a combined spread near 35. Production Power
    // Pulse rows sit here, and a rate an order of magnitude away from this would
    // mean the conversion is wrong rather than merely imprecise.
    const rate = winsPerPoint(Array.from({ length: 10 }, () => evenWeek()));
    expect(rate).not.toBeNull();
    expect(rate as number).toBeGreaterThan(0.08);
    expect(rate as number).toBeLessThan(0.15);
  });

  it("is worth more with more games left", () => {
    const few = winsPerPoint(Array.from({ length: 3 }, () => evenWeek())) as number;
    const many = winsPerPoint(Array.from({ length: 12 }, () => evenWeek())) as number;
    expect(many).toBeGreaterThan(few);
  });

  it("is worth more in a close matchup than in a decided one", () => {
    const close = winsPerPoint([evenWeek()]) as number;
    // A 60-point favourite. Another point a week barely moves a game already won.
    const decided = winsPerPoint([
      { mean: 170, sigma: 25, opponentMean: 110, opponentSigma: 25 },
    ]) as number;
    expect(close).toBeGreaterThan(decided);
  });

  it("does not explode when Power Pulse has published no spread", () => {
    // A zero sigma is Power Pulse saying it has no spread yet, not a claim that
    // a team scores the same number every week. Without the floor this divides
    // by zero and hands one week the entire ranking.
    const rate = winsPerPoint([
      { mean: 110, sigma: 0, opponentMean: 110, opponentSigma: 0 },
    ]) as number;
    expect(Number.isFinite(rate)).toBe(true);
    expect(rate).toBeLessThanOrEqual(1 / PULSE_LIMITS.MIN_COMBINED_SIGMA);
  });
});

describe("winsDeltaFor", () => {
  it("converts points a week into games", () => {
    expect(winsDeltaFor(2, snapshot({ winsPerPoint: 0.1 }))).toBeCloseTo(0.2, 6);
  });

  it("keeps the sign of the lineup change", () => {
    expect(winsDeltaFor(-3, snapshot({ winsPerPoint: 0.1 })) as number).toBeLessThan(0);
  });

  it("says nothing rather than zero when there is no lineup figure", () => {
    expect(winsDeltaFor(null, snapshot())).toBeNull();
  });

  it("says nothing rather than zero when Power Pulse has not scored the league", () => {
    expect(winsDeltaFor(2, null)).toBeNull();
    expect(winsDeltaFor(2, snapshot({ winsPerPoint: null }))).toBeNull();
  });
});

describe("pulseSnapshotFor", () => {
  /** Two teams playing each other in weeks 1 and 2. */
  const league = new Map<number, Map<number, { mean: number; sigma: number }>>([
    [
      1,
      new Map([
        [1, { mean: 110, sigma: 25 }],
        [2, { mean: 112, sigma: 25 }],
      ]),
    ],
    [
      2,
      new Map([
        [1, { mean: 105, sigma: 24 }],
        [2, { mean: 108, sigma: 24 }],
      ]),
    ],
  ]);

  const weekly = [
    { week: 1, opponentRosterId: 2, mean: 110, sigma: 25 },
    { week: 2, opponentRosterId: 2, mean: 112, sigma: 25 },
  ];

  it("reads the opponent out of that opponent's own row, week by week", () => {
    // The opponent's week 2 mean (108) is not their week 1 mean (105). Reading
    // the wrong week is the wiring bug this exists to catch, and it would still
    // produce a plausible-looking number.
    const snapshot = pulseSnapshotFor(weekly, league);
    const byHand = winsPerPoint([
      { mean: 110, sigma: 25, opponentMean: 105, opponentSigma: 24 },
      { mean: 112, sigma: 25, opponentMean: 108, opponentSigma: 24 },
    ]);
    expect(snapshot.winsPerPoint).toBeCloseTo(byHand as number, 12);
    expect(snapshot.remainingGames).toBe(2);
  });

  it("drops a week whose opponent is not in the index", () => {
    // A roster Power Pulse never scored is a game we cannot see both sides of.
    // Scoring it against a phantom projecting nothing would read as a free win.
    const snapshot = pulseSnapshotFor(
      [...weekly, { week: 3, opponentRosterId: 99, mean: 111, sigma: 25 }],
      league,
    );
    expect(snapshot.remainingGames).toBe(2);
    expect(snapshot.winsPerPoint).toBeCloseTo(
      pulseSnapshotFor(weekly, league).winsPerPoint as number,
      12,
    );
  });

  it("drops a bye week", () => {
    const snapshot = pulseSnapshotFor(
      [{ week: 1, opponentRosterId: null, mean: 110, sigma: 25 }],
      league,
    );
    expect(snapshot.remainingGames).toBe(0);
    expect(snapshot.winsPerPoint).toBeNull();
  });

  it("says nothing rather than zero when the season is over", () => {
    const snapshot: PulseSnapshot = pulseSnapshotFor([], league);
    expect(snapshot.winsPerPoint).toBeNull();
    expect(snapshot.remainingGames).toBe(0);
  });
});
