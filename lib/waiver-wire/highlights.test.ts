import { describe, it, expect } from "vitest";
import { cardHighlights } from "./highlights";
import type { BoardRow } from "./types";

function row(over: Partial<BoardRow> = {}): BoardRow {
  return {
    playerId: "p1",
    slug: "p1",
    sleeperId: "1",
    name: "Test Player",
    position: "RB",
    team: "NYG",
    overallRank: 150,
    positionRank: 40,
    value: null,
    rosterRate: null,
    opportunity: {
      lastTouches: null,
      lastWeek: null,
      priorTouches: null,
      touchDelta: null,
      snapPct: null,
      snapWeek: null,
      lastPoints: null,
      weeksPlayed: 0,
    },
    projection: null,
    pointsAboveReplacement: null,
    market: null,
    bid: null,
    reason: "",
    score: 0,
    ...over,
  };
}

describe("cardHighlights", () => {
  it("says nothing when no figure clears its bar", () => {
    expect(cardHighlights(row())).toEqual([]);
  });

  it("leads with a role change and never shows more than two chips", () => {
    const chips = cardHighlights(
      row({
        opportunity: { ...row().opportunity, touchDelta: 5.4, snapPct: 80 },
        market: {
          auctions: 20,
          leagues: 18,
          avgBidders: 2,
          contestedShare: 0.5,
          p25: 1,
          p50: 5,
          p75: 9,
          p90: 14,
          latestWeek: 3,
        },
        rosterRate: {
          rostered: 10,
          total: 100,
          pct: 10,
          dynastyRostered: 0,
          dynastyTotal: 0,
          dynastyPct: null,
          redraftRostered: 0,
          redraftTotal: 0,
          redraftPct: null,
        },
      }),
    );
    expect(chips.map((c) => c.kind)).toEqual(["role", "claimed"]);
    expect(chips[0].text).toBe("Touches up 5");
    expect(chips[1].text).toBe("Claimed in 18 leagues");
  });

  it("states availability as the free share, from the rostered share", () => {
    const chips = cardHighlights(
      row({
        rosterRate: {
          rostered: 15,
          total: 100,
          pct: 15,
          dynastyRostered: 0,
          dynastyTotal: 0,
          dynastyPct: null,
          redraftRostered: 0,
          redraftTotal: 0,
          redraftPct: null,
        },
      }),
    );
    expect(chips).toEqual([{ kind: "available", text: "Free in 85% of leagues" }]);
  });

  it("only calls a player an upgrade when he projects above a starter", () => {
    expect(cardHighlights(row({ pointsAboveReplacement: -0.3 }))).toEqual([]);
    expect(cardHighlights(row({ pointsAboveReplacement: 1.44 }))[0].text).toBe(
      "1.4 points over a starter",
    );
  });
});
