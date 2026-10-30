import { describe, expect, it } from "vitest";
import { SHAPE_LABEL, bestByShape, buildStrategy, classifyShape, readerVerdict } from "./strategy";
import type { SuggestionAsset, TradeFinderResult, TradeSuggestion } from "@/lib/trade-finder/types";

const pl = (id: string, position: string, value: number): SuggestionAsset => ({
  kind: "player",
  playerId: id,
  sleeperId: null,
  name: id,
  position,
  team: null,
  value,
  age: 25,
  projPoints: 10,
});

function sug(key: string, outgoing: SuggestionAsset[], incoming: SuggestionAsset[], score = 1): TradeSuggestion {
  const impact = { valueDelta: 100, lineupDelta: 1, winsDelta: 0.2, ageDelta: 0, pickCountDelta: 0 };
  return {
    key,
    counterparty: { rosterId: 7, teamName: "Team 7", ownerHandle: "owner7", statusLabel: null, direction: "balanced" },
    incoming,
    outgoing,
    mine: impact,
    theirs: impact,
    valueGap: 0,
    qualityRatio: 1,
    acceptance: "worth-asking",
    score,
    headline: `Deal ${key}`,
    rationale: "",
    whyYou: "",
    whyThem: "",
    tendencyNotes: [],
    pitch: "",
    caveats: [],
  };
}

const result = (suggestions: TradeSuggestion[]): TradeFinderResult => ({
  suggestions,
  consideredTeams: 11,
  lineupUnavailable: false,
  notice: null,
});

describe("classifyShape", () => {
  it("names each shape", () => {
    expect(classifyShape(sug("d", [pl("a", "WR", 8000)], [pl("b", "RB", 4000), pl("c", "TE", 4000)]), 0.12)).toBe("downtier");
    expect(classifyShape(sug("u", [pl("a", "WR", 4000), pl("b", "WR", 3500)], [pl("c", "RB", 4600)]), 0.12)).toBe("uptier");
    expect(classifyShape(sug("u2", [pl("a", "WR", 4000), pl("b", "WR", 3500)], [pl("c", "RB", 4500)]), 0.12)).toBeNull();
    expect(classifyShape(sug("p", [pl("a", "WR", 5000)], [pl("b", "RB", 5500)]), 0.12)).toBe("pivot");
    expect(classifyShape(sug("p2", [pl("a", "WR", 5000)], [pl("b", "RB", 5700)]), 0.12)).toBeNull();
    expect(classifyShape(sug("p3", [pl("a", "WR", 5000)], [pl("b", "WR", 5100)]), 0.12)).toBeNull();
  });

  it("keeps the highest score per shape", () => {
    const best = bestByShape(
      [
        sug("p1", [pl("a", "WR", 5000)], [pl("b", "RB", 5100)], 1),
        sug("p2", [pl("c", "WR", 5000)], [pl("d", "RB", 5100)], 3),
      ],
      0.12,
    );
    expect(best.pivot?.key).toBe("p2");
  });
});

describe("buildStrategy", () => {
  const grade = async (s: TradeSuggestion[]) =>
    s.map(() => ({
      verdictLabel: "Even trade",
      favours: "neither" as const,
      confidenceLabel: "High confidence",
      tradeShapeLabel: null,
      explanation: "",
      formatDisplay: "",
    }));

  it("caps finder runs at three and fills empty shapes from goal runs", async () => {
    const goals: Array<string | undefined> = [];
    const out = await buildStrategy({
      run: (goal) => {
        goals.push(goal);
        if (goal === "split-assets") return result([sug("d", [pl("a", "WR", 8000)], [pl("b", "RB", 4000), pl("c", "TE", 4000)])]);
        return result([]);
      },
      grade,
      myRosterId: 1,
      picks: new Map(),
      maxRuns: 3,
      pivotGapPct: 0.12,
    });
    expect(goals).toEqual([undefined, "split-assets", "consolidate"]);
    expect(out.runs).toBe(3);
    expect(out.entries.find((e) => e.shape === "downtier")?.card?.verdictLabel).toBe("Even trade");
    expect(out.entries.find((e) => e.shape === "downtier")?.card?.proposal).toEqual({
      myRosterId: 1,
      theirRosterId: 7,
      incoming: [
        { kind: "player", playerId: "b" },
        { kind: "player", playerId: "c" },
      ],
      outgoing: [{ kind: "player", playerId: "a" }],
    });
  });

  it("never sends a Build around player, and says which one it declined to send", async () => {
    const out = await buildStrategy({
      run: (goal) => {
        if (goal === undefined) {
          return result([
            // The best downtier sends the core player; the second does not.
            sug("d-core", [pl("core", "WR", 9000)], [pl("b", "RB", 4500), pl("c", "TE", 4500)], 5),
            sug("d-ok", [pl("star", "WR", 8000)], [pl("e", "RB", 4000), pl("f", "TE", 4000)], 2),
            // Every pivot sends him.
            sug("p-core", [pl("core", "WR", 9000)], [pl("g", "RB", 9100)], 4),
          ]);
        }
        return result([]);
      },
      grade,
      myRosterId: 1,
      picks: new Map(),
      maxRuns: 3,
      pivotGapPct: 0.12,
      protectedIds: new Set(["core"]),
    });
    const down = out.entries.find((e) => e.shape === "downtier")!;
    expect(down.card?.outgoing.map((a) => a.playerId)).toEqual(["star"]);
    expect(out.playerIds).not.toContain("core");
    const pivot = out.entries.find((e) => e.shape === "pivot")!;
    expect(pivot.card).toBeNull();
    expect(pivot.emptyText).toBe(
      "No pivot that keeps the core: the best one sends core, a Build around call, so it is not proposed.",
    );
  });

  it("renders the empty sentence for a shape with nothing", async () => {
    const out = await buildStrategy({
      run: () => result([]),
      grade,
      myRosterId: 1,
      picks: new Map(),
      maxRuns: 1,
      pivotGapPct: 0.12,
    });
    expect(out.runs).toBe(1);
    expect(out.entries.map((e) => e.emptyText)).toEqual([
      "No downtier worth proposing this week.",
      "No uptier worth proposing this week.",
      "No pivot worth proposing this week.",
    ]);
    expect(out.entries[0].label).toBe(SHAPE_LABEL.downtier);
  });
});

describe("readerVerdict", () => {
  it("renames the Signal Check sides for the reader", () => {
    expect(readerVerdict("Side A wins by 5.3% of total trade value.")).toBe("You win by 5.3% of total trade value.");
    expect(readerVerdict("Side B wins by 18.6% of total trade value.")).toBe("They win by 18.6% of total trade value.");
    expect(readerVerdict("Leans Side B")).toBe("Leans them");
    expect(readerVerdict("Fair Trade")).toBe("Fair Trade");
  });

  it("holds no control characters, so the word boundaries are real", () => {
    expect([...readerVerdict.toString()].some((c) => c.charCodeAt(0) < 9)).toBe(false);
  });
});
