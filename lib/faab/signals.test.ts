import { describe, it, expect } from "vitest";
import { buildSignals, combinedMultiplier, combinedSpread, type SignalInput } from "./signals";
import { DEFAULT_FAAB_SETTINGS } from "./default-settings";
import type { MarginalWeek } from "./types";

function weeks(count: number, multiplier = 1): MarginalWeek[] {
  return Array.from({ length: count }, (_, i) => ({
    week: i + 5,
    startsForYou: true,
    pointsAdded: 3,
    opponent: "BUF",
    opponentMultiplier: multiplier,
  }));
}

function baseInput(overrides: Partial<SignalInput> = {}): SignalInput {
  return {
    position: "WR",
    accuracy: null,
    gameLogs: [],
    weeks: weeks(4),
    positionalFinishes: [],
    currentSeason: 2026,
    settings: DEFAULT_FAAB_SETTINGS.signals,
    ...overrides,
  };
}

function logs(shares: number[]): SignalInput["gameLogs"] {
  return shares.map((snapPct, i) => ({
    season: 2026,
    week: i + 1,
    snapPct,
    teamSnaps: 65,
    touches: Math.round(snapPct * 20),
  }));
}

describe("opportunity signal", () => {
  it("flags a real role change from snap share", () => {
    // 30% for four games, then 70% for two. That is a job change, and it is the
    // single most predictive thing about a waiver add.
    const signals = buildSignals(
      baseInput({ gameLogs: logs([0.3, 0.28, 0.32, 0.3, 0.7, 0.72]) }),
    );
    const opportunity = signals.find((s) => s.id === "opportunity");
    expect(opportunity).toBeDefined();
    expect(opportunity?.tone).toBe("good");
    expect(opportunity?.multiplier).toBeGreaterThan(1);
  });

  it("flags a collapsing role even when the box score looked fine", () => {
    const signals = buildSignals(
      baseInput({ gameLogs: logs([0.75, 0.7, 0.72, 0.74, 0.3, 0.28]) }),
    );
    const opportunity = signals.find((s) => s.id === "opportunity");
    expect(opportunity?.tone).toBe("bad");
    expect(opportunity?.multiplier).toBeLessThan(1);
  });

  it("stays quiet when the snap share is steady", () => {
    const signals = buildSignals(
      baseInput({ gameLogs: logs([0.6, 0.62, 0.58, 0.61, 0.6, 0.63]) }),
    );
    expect(signals.find((s) => s.id === "opportunity")).toBeUndefined();
  });

  it("ignores games where the snap share is missing", () => {
    const gameLogs = logs([0.3, 0.3, 0.7, 0.72]).map((g, i) =>
      i < 2 ? { ...g, snapPct: null } : g,
    );
    // Only two usable games remain, which is fewer than recentGames + 1.
    expect(buildSignals(baseInput({ gameLogs })).find((s) => s.id === "opportunity")).toBeUndefined();
  });
});

describe("reliability signals", () => {
  it("raises the bid for a player who beats his projection", () => {
    const signals = buildSignals(
      baseInput({
        accuracy: { beatRate: 0.8, availabilityRate: 1, ratioStdev: null, weeksPlayed: 10 },
      }),
    );
    const beat = signals.find((s) => s.id === "beat-rate");
    expect(beat?.tone).toBe("good");
    expect(beat?.multiplier).toBeGreaterThan(1);
  });

  it("skips the beat rate when the sample is too thin to mean anything", () => {
    const signals = buildSignals(
      baseInput({
        accuracy: { beatRate: 0.9, availabilityRate: 1, ratioStdev: null, weeksPlayed: 2 },
      }),
    );
    expect(signals.find((s) => s.id === "beat-rate")).toBeUndefined();
  });

  it("penalizes a player who misses time but never celebrates one who does not", () => {
    const missing = buildSignals(
      baseInput({
        accuracy: { beatRate: null, availabilityRate: 0.5, ratioStdev: null, weeksPlayed: 10 },
      }),
    );
    expect(missing.find((s) => s.id === "availability")?.multiplier).toBeLessThan(1);

    const healthy = buildSignals(
      baseInput({
        accuracy: { beatRate: null, availabilityRate: 1, ratioStdev: null, weeksPlayed: 10 },
      }),
    );
    expect(healthy.find((s) => s.id === "availability")).toBeUndefined();
  });

  it("widens the range for a boom-or-bust player instead of moving it", () => {
    const signals = buildSignals(
      baseInput({
        accuracy: { beatRate: null, availabilityRate: null, ratioStdev: 1.1, weeksPlayed: 10 },
      }),
    );
    const volatility = signals.find((s) => s.id === "volatility");
    expect(volatility).toBeDefined();
    expect(volatility?.multiplier).toBe(1);
    expect(volatility?.spread).toBeGreaterThan(0);
  });
});

describe("matchup signal", () => {
  it("reads the weeks he would actually start", () => {
    const good = buildSignals(baseInput({ weeks: weeks(4, 1.2) }));
    expect(good.find((s) => s.id === "matchup")?.tone).toBe("good");

    const bad = buildSignals(baseInput({ weeks: weeks(4, 0.82) }));
    expect(bad.find((s) => s.id === "matchup")?.tone).toBe("bad");
  });

  it("stays quiet on a neutral run of games", () => {
    expect(
      buildSignals(baseInput({ weeks: weeks(4, 1.01) })).find((s) => s.id === "matchup"),
    ).toBeUndefined();
  });
});

describe("combining", () => {
  it("multiplies the movers and sums the wideners", () => {
    const signals = buildSignals(
      baseInput({
        accuracy: { beatRate: 0.85, availabilityRate: 0.6, ratioStdev: 1.2, weeksPlayed: 12 },
        weeks: weeks(4, 1.2),
      }),
    );
    expect(combinedMultiplier(signals)).toBeGreaterThan(0);
    expect(combinedSpread(signals)).toBeGreaterThan(0);
    expect(combinedSpread(signals)).toBeLessThanOrEqual(0.6);
  });

  it("never moves the number on the ceiling note, which is framing only", () => {
    const signals = buildSignals(
      baseInput({
        positionalFinishes: [{ season: 2025, finish: 31, playersRanked: 90 }],
      }),
    );
    const ceiling = signals.find((s) => s.id === "ceiling");
    expect(ceiling).toBeDefined();
    expect(ceiling?.multiplier).toBe(1);
    expect(ceiling?.spread).toBe(0);
  });
});
