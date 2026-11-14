import { describe, it, expect } from "vitest";
import { chopProbability, chopWeekFor, survivalDeltaFor } from "./pulse";
import { inferStrategy, strategyLabel, tradeLeagueKindOf } from "./types";

describe("chopped survival math", () => {
  it("gives each of n identical teams a 1 in n chance of the cut", () => {
    const team = { mean: 110, sigma: 20 };
    const p = chopProbability({ own: team, others: [team, team, team] });
    expect(p).toBeCloseTo(0.25, 2);
  });

  it("raises survival odds when the lineup gains points, and lowers them when it loses", () => {
    const pulse = {
      winsPerPoint: null,
      remainingGames: 0,
      chopWeek: {
        own: { mean: 100, sigma: 18 },
        others: [
          { mean: 105, sigma: 18 },
          { mean: 110, sigma: 18 },
          { mean: 120, sigma: 18 },
        ],
      },
    };
    const gain = survivalDeltaFor(4, pulse);
    const loss = survivalDeltaFor(-4, pulse);
    expect(gain).not.toBeNull();
    expect(gain!).toBeGreaterThan(0);
    expect(loss!).toBeLessThan(0);
  });

  it("is null outside a chopped league", () => {
    expect(survivalDeltaFor(4, { winsPerPoint: 0.1, remainingGames: 5 })).toBeNull();
    expect(survivalDeltaFor(null, null)).toBeNull();
  });

  it("reads the first remaining week's field", () => {
    const byRoster = new Map([
      [1, new Map([[9, { mean: 100, sigma: 15 }], [10, { mean: 90, sigma: 15 }]])],
      [2, new Map([[9, { mean: 110, sigma: 15 }]])],
      [3, new Map([[10, { mean: 80, sigma: 15 }]])],
    ]);
    const week = chopWeekFor(1, byRoster);
    expect(week?.own.mean).toBe(100);
    expect(week?.others).toEqual([{ mean: 110, sigma: 15 }]);
  });
});

describe("which mode a league opens on", () => {
  it("is always Compete in redraft and chopped", () => {
    expect(inferStrategy("redraft", "rebuilder").strategy).toBe("contender");
    expect(inferStrategy("chopped", "rebuilder").strategy).toBe("contender");
    expect(inferStrategy("chopped", null).reason).toContain("cut");
  });

  it("opens a dynasty Rebuilder on Rebuild and everyone else on Compete, with one line why", () => {
    expect(inferStrategy("dynasty", "rebuilder")).toEqual({
      strategy: "value",
      reason: "Rebuild, because Power Pulse has your team out of the race.",
    });
    for (const key of ["competitor", "loaded", "middle", null] as const) {
      const inferred = inferStrategy("dynasty", key);
      expect(inferred.strategy).toBe("contender");
      expect(inferred.reason.startsWith("Compete")).toBe(true);
    }
  });

  it("names the modes Compete and Rebuild and files the kinds", () => {
    expect(strategyLabel("contender")).toBe("Compete");
    expect(strategyLabel("value")).toBe("Rebuild");
    expect(tradeLeagueKindOf("chopped", false)).toBe("chopped");
    expect(tradeLeagueKindOf("best-ball-dynasty", true)).toBe("dynasty");
    expect(tradeLeagueKindOf("best-ball-redraft", false)).toBe("redraft");
  });
});
