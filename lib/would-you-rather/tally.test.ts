import { describe, expect, it } from "vitest";
import { crowdVsModelSentence, tallyOf, type WyrPoolRow } from "./round";
import type { BuilderView } from "@/lib/signal-check/builder-view";
import type { WyrTally } from "./types";

function pool(over: Partial<WyrPoolRow> = {}): WyrPoolRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    league_id: "22222222-2222-4222-8222-222222222222",
    transaction_id: "33333333-3333-4333-8333-333333333333",
    sleeper_transaction_id: "tx1",
    season: 2026,
    week: 3,
    is_startup: false,
    side_a_roster_id: 1,
    side_b_roster_id: 2,
    votes_a: 0,
    votes_b: 0,
    discord_votes_a: 0,
    discord_votes_b: 0,
    served_count: 0,
    graded: null,
    graded_at: null,
    ...over,
  };
}

function view(over: Partial<BuilderView> = {}): BuilderView {
  return {
    featureLabel: "Signal Check",
    resultLabel: "Beacon Verdict",
    verdictLabel: "Team B wins by 20% of total trade value.",
    winnerSide: "b",
    marginPct: 20,
    isNeutral: false,
    isBlowout: false,
    formatDisplay: "Dynasty PPR SF",
    tradeShapeLabel: null,
    confidenceLabel: null,
    confidenceLevel: null,
    explanation: "",
    sides: [],
    hasMissingValues: false,
    hasBlendedPicks: false,
    hasEstimatedPicks: false,
    showRawValues: false,
    adjustmentLabel: null,
    ...over,
  };
}

describe("tallyOf", () => {
  it("sums site votes and Discord votes into one total", () => {
    const t = tallyOf(pool({ votes_a: 6, votes_b: 2, discord_votes_a: 4, discord_votes_b: 8 }));
    expect(t.a).toBe(10);
    expect(t.b).toBe(10);
    expect(t.total).toBe(20);
    // The Discord share is reported separately, so the page can say where the
    // votes came from without a second query.
    expect(t.discordA).toBe(4);
    expect(t.discordB).toBe(8);
  });

  it("reports zeroes rather than dividing by zero on an unvoted trade", () => {
    const t = tallyOf(pool());
    expect(t).toMatchObject({ a: 0, b: 0, total: 0, pctA: 0, pctB: 0 });
  });

  it("always sums the two percentages to 100", () => {
    for (const [a, b] of [
      [1, 0],
      [1, 2],
      [7, 3],
      [1, 999],
      [333, 667],
      [12345, 54321],
    ]) {
      const t = tallyOf(pool({ votes_a: a, votes_b: b }));
      expect(t.pctA + t.pctB).toBe(100);
    }
  });

  it("never prints 50/50 for a split that is not even", () => {
    // 500 to 501 rounds to 50 and 50, which contradicts the counts printed
    // beside it. The bigger side is nudged up so the bar and the numbers agree.
    const t = tallyOf(pool({ votes_a: 500, votes_b: 501 }));
    expect(t.pctA).toBe(49);
    expect(t.pctB).toBe(51);

    const flipped = tallyOf(pool({ votes_a: 501, votes_b: 500 }));
    expect(flipped.pctA).toBe(51);
    expect(flipped.pctB).toBe(49);
  });

  it("does print 50/50 for a genuinely even split", () => {
    const t = tallyOf(pool({ votes_a: 40, votes_b: 40 }));
    expect(t.pctA).toBe(50);
    expect(t.pctB).toBe(50);
  });
});

const TALLY = (a: number, b: number): WyrTally => tallyOf(pool({ votes_a: a, votes_b: b }));

describe("crowdVsModelSentence", () => {
  it("says nothing when there is no verdict to compare against", () => {
    expect(crowdVsModelSentence(TALLY(5, 3), null)).toBeNull();
  });

  it("says nothing before any vote exists", () => {
    expect(crowdVsModelSentence(TALLY(0, 0), view())).toBeNull();
  });

  it("names the reader as the first vote rather than inventing a crowd", () => {
    expect(crowdVsModelSentence(TALLY(1, 0), view())).toContain("first vote");
  });

  it("states agreement with the figure behind it", () => {
    const s = crowdVsModelSentence(TALLY(2, 8), view())!;
    expect(s).toContain("agree");
    expect(s).toContain("Team B");
    expect(s).toContain("80%");
    expect(s).toContain("20%");
  });

  it("states disagreement without softening it", () => {
    const s = crowdVsModelSentence(TALLY(8, 2), view())!;
    expect(s).toContain("disagree");
    expect(s).toContain("Team A");
    expect(s).toContain("Team B");
  });

  it("handles a dead-even room against a decided model", () => {
    const s = crowdVsModelSentence(TALLY(10, 10), view())!;
    expect(s).toContain("split exactly in half");
    expect(s).toContain("Team B");
  });

  it("handles a neutral verdict", () => {
    const s = crowdVsModelSentence(TALLY(6, 4), view({ isNeutral: true, marginPct: 2 }))!;
    expect(s).toContain("even");
    expect(s).toContain("2%");
  });

  it("handles a neutral verdict against a dead-even room", () => {
    const s = crowdVsModelSentence(TALLY(5, 5), view({ isNeutral: true, marginPct: 1 }))!;
    expect(s).toContain("down the middle");
  });

  it("never names a side the reader cannot see on the page", () => {
    // Everything it can say uses Team A and Team B, which are the only two
    // names this surface has for the parties.
    for (const [a, b] of [
      [9, 1],
      [1, 9],
      [5, 5],
      [3, 2],
    ]) {
      const s = crowdVsModelSentence(TALLY(a, b), view()) ?? "";
      expect(s).not.toMatch(/\bSide [AB]\b/);
    }
  });
});
