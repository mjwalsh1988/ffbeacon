import { describe, expect, it } from "vitest";
import {
  buildStartSitOgCards,
  cardBadgeLabel,
  cardWidthPx,
  formatConfidencePercent,
  headlineFontSize,
  type StartSitOgCard,
} from "./card-layout";
import type { StartSitCandidate, StartSitProjection } from "@/lib/start-sit/types";

function candidate(overrides: Partial<StartSitCandidate> & { playerId: string }): StartSitCandidate {
  return {
    slug: overrides.playerId,
    sleeperId: null,
    name: overrides.playerId,
    position: "RB",
    team: "ATL",
    injuryStatus: null,
    ...overrides,
  };
}

function projection(overrides: Partial<StartSitProjection> & { playerId: string }): StartSitProjection {
  return {
    week: 3,
    points: null,
    rawPoints: null,
    sigma: null,
    floor: null,
    ceiling: null,
    opponent: null,
    opponentMultiplier: null,
    defenseRankVsPosition: null,
    beatRate: null,
    availabilityRate: null,
    weeksGraded: 0,
    environment: null,
    environmentTier: null,
    onBye: false,
    availability: null,
    ...overrides,
  };
}

describe("buildStartSitOgCards", () => {
  it("orders starters first, then bench, each in the verdict's own order", () => {
    const candidates = [
      candidate({ playerId: "a", name: "Player A" }),
      candidate({ playerId: "b", name: "Player B" }),
      candidate({ playerId: "c", name: "Player C" }),
    ];
    const projections = new Map([
      ["a", projection({ playerId: "a", points: 18 })],
      ["b", projection({ playerId: "b", points: 12 })],
      ["c", projection({ playerId: "c", points: 9 })],
    ]);

    const cards = buildStartSitOgCards({ starters: ["a"], bench: ["b", "c"] }, candidates, projections);

    expect(cards.map((c) => c.playerId)).toEqual(["a", "b", "c"]);
    expect(cards[0].isStarter).toBe(true);
    expect(cards[1].isStarter).toBe(false);
    expect(cards[2].isStarter).toBe(false);
  });

  it("carries points, onBye and availability from the matching projection", () => {
    const candidates = [candidate({ playerId: "a", name: "Player A" })];
    const projections = new Map([
      ["a", projection({ playerId: "a", points: 14.2, onBye: true, availability: "out" })],
    ]);

    const [card] = buildStartSitOgCards({ starters: [], bench: ["a"] }, candidates, projections);
    expect(card.points).toBe(14.2);
    expect(card.onBye).toBe(true);
    expect(card.availability).toBe("out");
  });

  it("defaults to no points and not on bye when a candidate has no matching projection row", () => {
    const candidates = [candidate({ playerId: "a", name: "Player A" })];
    const [card] = buildStartSitOgCards({ starters: [], bench: ["a"] }, candidates, new Map());
    expect(card.points).toBeNull();
    expect(card.onBye).toBe(false);
    expect(card.availability).toBeNull();
  });

  it("skips a verdict playerId with no matching candidate rather than throwing", () => {
    const candidates = [candidate({ playerId: "a", name: "Player A" })];
    const cards = buildStartSitOgCards({ starters: ["a", "ghost"], bench: [] }, candidates, new Map());
    expect(cards.map((c) => c.playerId)).toEqual(["a"]);
  });
});

describe("cardBadgeLabel", () => {
  const base: Pick<StartSitOgCard, "onBye" | "availability" | "isStarter"> = {
    onBye: false,
    availability: null,
    isStarter: false,
  };

  it("labels a starter START", () => {
    expect(cardBadgeLabel({ ...base, isStarter: true })).toBe("START");
  });

  it("labels a benched player SIT", () => {
    expect(cardBadgeLabel({ ...base, isStarter: false })).toBe("SIT");
  });

  it("labels a bye BYE even when somehow marked a starter", () => {
    expect(cardBadgeLabel({ ...base, onBye: true, isStarter: true })).toBe("BYE");
  });

  it("labels an out player OUT ahead of the plain SIT call", () => {
    expect(cardBadgeLabel({ ...base, availability: "out" })).toBe("OUT");
  });

  it("prefers BYE over OUT when somehow both are true", () => {
    expect(cardBadgeLabel({ ...base, onBye: true, availability: "out" })).toBe("BYE");
  });
});

describe("cardWidthPx", () => {
  it("stays within the max width for two players", () => {
    const width = cardWidthPx(2);
    expect(width).toBeLessThanOrEqual(150);
    expect(width).toBeGreaterThanOrEqual(96);
  });

  it("shrinks toward the min width for eight players", () => {
    const width = cardWidthPx(8);
    expect(width).toBe(130);
  });

  it("never exceeds the eight-player width for two players (a smaller row does not read as cramped)", () => {
    expect(cardWidthPx(2)).toBeGreaterThan(cardWidthPx(8));
  });

  it("returns the max width for a degenerate zero count", () => {
    expect(cardWidthPx(0)).toBe(150);
  });
});

describe("headlineFontSize", () => {
  it("uses the largest size for a short verdict", () => {
    expect(headlineFontSize("Start Bijan Robinson.")).toBe(44);
  });

  it("steps down for a medium verdict", () => {
    const text = "Start Bijan Robinson. He projects 2.4 points clear of Josh Jacobs in PPR.";
    expect(text.length).toBeGreaterThan(70);
    expect(headlineFontSize(text)).toBe(38);
  });

  it("uses the smallest size for a long, multi-clause verdict", () => {
    const text =
      "Start Bijan Robinson and Josh Jacobs. The last spot is close: Jacobs is 55 percent to outscore Alvin Kamara this week.";
    expect(text.length).toBeGreaterThan(110);
    expect(headlineFontSize(text)).toBe(32);
  });
});

describe("formatConfidencePercent", () => {
  it("rounds to the nearest whole percent", () => {
    expect(formatConfidencePercent(0.712)).toBe("71%");
    expect(formatConfidencePercent(0.715)).toBe("72%");
  });

  it("renders a dash for a null confidence", () => {
    expect(formatConfidencePercent(null)).toBe("--");
  });

  it("handles the extremes", () => {
    expect(formatConfidencePercent(0)).toBe("0%");
    expect(formatConfidencePercent(1)).toBe("100%");
  });
});
