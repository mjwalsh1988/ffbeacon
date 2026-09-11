import { describe, expect, it } from "vitest";
import { buildPlayerSummary, type PlayerSummaryFacts } from "./summary";

/** A fully-populated fixture; individual tests null out fields off this base. */
function fullFacts(overrides: Partial<PlayerSummaryFacts> = {}): PlayerSummaryFacts {
  return {
    playerName: "Justin Jefferson",
    playerSurname: "Jefferson",
    position: "WR",
    formatDisplay: "Dynasty Superflex PPR",
    positionRank: 2,
    trendDirection: "up",
    trendPct: 8.4,
    nextProjectionWeek: 3,
    nextProjectionPoints: 18.6,
    projectionEngineDisplay: "Sleeper",
    lastThreeFinishes: [
      { season: 2025, finish: 4 },
      { season: 2024, finish: 1 },
      { season: 2023, finish: 7 },
    ],
    ...overrides,
  };
}

// Banned punctuation per project style rules: em dash, en dash, curly quotes,
// curly apostrophe, ellipsis character, middle dot, non-breaking space.
const BANNED_CHARS = /[—–‘’“”…· ]/;

describe("buildPlayerSummary", () => {
  it("renders both sentences from a full fact set", () => {
    const summary = buildPlayerSummary(fullFacts());
    expect(summary).toBe(
      "Justin Jefferson is the 2nd wide receiver in Dynasty Superflex PPR and has risen 8.4% in value over the last 30 days. " +
        "Jefferson is projected for 18.6 points in Week 3 by Sleeper, and finished WR4, WR1, and WR7 over the last three seasons.",
    );
  });

  it("drops a null fact's clause instead of a placeholder", () => {
    const summary = buildPlayerSummary(
      fullFacts({ trendDirection: null, trendPct: null, nextProjectionWeek: null, nextProjectionPoints: null }),
    );
    expect(summary).toBe(
      "Justin Jefferson is the 2nd wide receiver in Dynasty Superflex PPR. " +
        "Jefferson finished WR4, WR1, and WR7 over the last three seasons.",
    );
  });

  it("opens with the full name, not the surname, when the first sentence has no facts", () => {
    const summary = buildPlayerSummary(
      fullFacts({ positionRank: null, trendDirection: null, trendPct: null }),
    );
    expect(summary).toBe(
      "Justin Jefferson is projected for 18.6 points in Week 3 by Sleeper, and finished WR4, WR1, and WR7 over the last three seasons.",
    );
  });

  it("renders a single remaining fact as one short sentence", () => {
    const summary = buildPlayerSummary(
      fullFacts({
        trendDirection: null,
        trendPct: null,
        nextProjectionWeek: null,
        nextProjectionPoints: null,
        lastThreeFinishes: [],
      }),
    );
    expect(summary).toBe("Justin Jefferson is the 2nd wide receiver in Dynasty Superflex PPR.");
  });

  it("words a stable trend without a percentage", () => {
    const summary = buildPlayerSummary(
      fullFacts({ trendDirection: "stable", trendPct: 0.2, positionRank: null }),
    );
    expect(summary).toContain("has held steady in value over the last 30 days");
    expect(summary).not.toContain("0.2%");
  });

  it("words a falling trend with the down verb", () => {
    const summary = buildPlayerSummary(
      fullFacts({ trendDirection: "down", trendPct: -5.1, positionRank: null }),
    );
    expect(summary).toContain("has fallen 5.1% in value over the last 30 days");
  });

  it("joins two finishes with a plain and, no oxford comma needed", () => {
    const summary = buildPlayerSummary(
      fullFacts({
        positionRank: null,
        trendDirection: null,
        trendPct: null,
        nextProjectionWeek: null,
        nextProjectionPoints: null,
        lastThreeFinishes: [
          { season: 2025, finish: 4 },
          { season: 2024, finish: 1 },
        ],
      }),
    );
    expect(summary).toBe("Justin Jefferson finished WR4 and WR1 over the last three seasons.");
  });

  it("renders nothing when every fact is null", () => {
    const summary = buildPlayerSummary(
      fullFacts({
        positionRank: null,
        trendDirection: null,
        trendPct: null,
        nextProjectionWeek: null,
        nextProjectionPoints: null,
        projectionEngineDisplay: null,
        lastThreeFinishes: [],
      }),
    );
    expect(summary).toBeNull();
  });

  it("never omits the resolved projection engine name when a projection is named", () => {
    // No engine name means the projection clause is withheld entirely rather
    // than falling back to a hardcoded word.
    const summary = buildPlayerSummary(fullFacts({ projectionEngineDisplay: null, positionRank: null, trendDirection: null, trendPct: null }));
    expect(summary).not.toContain("points in Week");
    expect(summary).toContain("finished WR4, WR1, and WR7");
  });

  it("never contains banned AI-tell punctuation across every fixture above", () => {
    const fixtures: PlayerSummaryFacts[] = [
      fullFacts(),
      fullFacts({ trendDirection: "down", trendPct: -12.7 }),
      fullFacts({ trendDirection: "stable", trendPct: 0 }),
      fullFacts({ positionRank: null }),
      fullFacts({ lastThreeFinishes: [{ season: 2025, finish: 11 }] }),
      fullFacts({
        positionRank: null,
        trendDirection: null,
        trendPct: null,
        nextProjectionWeek: null,
        nextProjectionPoints: null,
        projectionEngineDisplay: null,
        lastThreeFinishes: [],
      }),
    ];
    for (const facts of fixtures) {
      const summary = buildPlayerSummary(facts);
      if (summary !== null) {
        expect(summary).not.toMatch(BANNED_CHARS);
      }
    }
  });
});
