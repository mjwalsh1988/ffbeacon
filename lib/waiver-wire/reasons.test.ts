import { describe, it, expect } from "vitest";
import { boardScore, buildReason, topPickup, type ReasonInput } from "./reasons";
import type { Opportunity, RosterRate } from "./types";

const NO_OPPORTUNITY: Opportunity = {
  lastTouches: null,
  lastWeek: null,
  priorTouches: null,
  touchDelta: null,
  snapPct: null,
  snapWeek: null,
  lastPoints: null,
  weeksPlayed: 0,
};

function rate(over: Partial<RosterRate> = {}): RosterRate {
  return {
    rostered: 40,
    total: 400,
    pct: 10,
    dynastyRostered: 30,
    dynastyTotal: 250,
    dynastyPct: 12,
    redraftRostered: 10,
    redraftTotal: 150,
    redraftPct: 6.7,
    ...over,
  };
}

function input(over: Partial<ReasonInput> = {}): ReasonInput {
  return {
    position: "RB",
    opportunity: NO_OPPORTUNITY,
    rosterRate: null,
    projectedPoints: null,
    pointsAboveReplacement: null,
    opponent: null,
    isPast: false,
    ...over,
  };
}

describe("buildReason", () => {
  it("leads on the role change, which is why a claim exists at all", () => {
    const reason = buildReason(
      input({
        opportunity: {
          ...NO_OPPORTUNITY,
          lastTouches: 17,
          lastWeek: 3,
          priorTouches: 4.5,
          touchDelta: 12.5,
        },
      }),
    );
    expect(reason).toBe("17 touches in week 3, +12.5 on his 4.5 average before it.");
  });

  it("says when usage held steady rather than implying a jump", () => {
    const reason = buildReason(
      input({
        opportunity: {
          ...NO_OPPORTUNITY,
          lastTouches: 8,
          lastWeek: 4,
          priorTouches: 7.5,
          touchDelta: 0.5,
        },
      }),
    );
    expect(reason).toContain("in line with his 7.5 average");
  });

  it("says when usage fell, because that is the reason not to bid", () => {
    const reason = buildReason(
      input({
        opportunity: {
          ...NO_OPPORTUNITY,
          lastTouches: 3,
          lastWeek: 4,
          priorTouches: 11,
          touchDelta: -8,
        },
      }),
    );
    expect(reason).toContain("down from 11.0");
  });

  it("quotes the projection against replacement, not the raw number alone", () => {
    const reason = buildReason(
      input({ projectedPoints: 12.2, pointsAboveReplacement: 3.4, opponent: "NYJ" }),
    );
    expect(reason).toContain("rojects for 12.2 points against NYJ");
    expect(reason).toContain("3.4 more than the last startable running back");
  });

  it("says nothing about replacement when the figure is negative, because that clause would fire on every row", () => {
    const reason = buildReason(
      input({ projectedPoints: 5.1, pointsAboveReplacement: -2.2 }),
    );
    expect(reason).toContain("rojects for 5.1 points");
    expect(reason).not.toContain("replacement");
    expect(reason).not.toContain("startable");
  });

  it("leaves room for the availability clause once the replacement one is gone", () => {
    const reason = buildReason(
      input({ projectedPoints: 5.1, pointsAboveReplacement: -2.2, rosterRate: rate({ pct: 45 }) }),
    );
    expect(reason).toContain("ostered in 45 percent");
  });

  it("switches to the past tense for a week that has been played", () => {
    const reason = buildReason(input({ projectedPoints: 9, isPast: true }));
    expect(reason).toContain("rojected for 9.0 points");
    expect(reason).not.toContain("rojects for");
  });

  it("frames a barely-rostered player as free rather than as 2 percent rostered", () => {
    expect(buildReason(input({ rosterRate: rate({ pct: 2 }) }))).toContain(
      "ree in 98 percent of the leagues we track",
    );
  });

  it("frames a widely-held player as rostered", () => {
    expect(buildReason(input({ rosterRate: rate({ pct: 41 }) }))).toContain(
      "ostered in 41 percent of the leagues we track",
    );
  });

  it("adds snap share only when it is high enough to be the story on its own", () => {
    const busy = {
      ...NO_OPPORTUNITY,
      lastTouches: 9,
      lastWeek: 3,
      priorTouches: 8,
      touchDelta: 1,
    };
    expect(buildReason(input({ opportunity: { ...busy, snapPct: 30, snapWeek: 2 } }))).not.toContain(
      "percent of his team's snaps",
    );
    expect(buildReason(input({ opportunity: { ...busy, snapPct: 78, snapWeek: 2 } }))).toContain(
      "on 78.0 percent of his team's snaps in week 2",
    );
  });

  it("never runs past three clauses, because a paragraph in a table cell is not read", () => {
    const reason = buildReason(
      input({
        opportunity: {
          lastTouches: 14,
          lastWeek: 3,
          priorTouches: 3,
          touchDelta: 11,
          snapPct: 82,
          snapWeek: 2,
          lastPoints: 19,
          weeksPlayed: 3,
        },
        projectedPoints: 13,
        pointsAboveReplacement: 4,
        opponent: "DAL",
        rosterRate: rate({ pct: 9 }),
      }),
    );
    expect(reason.split(";")).toHaveLength(3);
  });

  describe("kickers and defenses, which touch nothing", () => {
    const scored = {
      ...NO_OPPORTUNITY,
      lastTouches: 0,
      lastWeek: 2,
      priorTouches: 0,
      touchDelta: 0,
      lastPoints: 11.4,
      weeksPlayed: 2,
    };

    it("never claims a defense had touches", () => {
      const reason = buildReason(
        input({ position: "DEF", opportunity: scored, projectedPoints: 10.3 }),
      );
      expect(reason).not.toContain("touches");
      expect(reason).not.toContain("average");
    });

    it("never uses a pronoun for a football team", () => {
      const reason = buildReason(
        input({ position: "DEF", opportunity: scored, projectedPoints: 10.3 }),
      );
      expect(reason).not.toContain("his");
    });

    it("leads on what it scored instead", () => {
      const reason = buildReason(input({ position: "K", opportunity: scored }));
      expect(reason).toContain("cored 11.4 in week 2");
    });

    it("spells the position out rather than leaving an acronym in a sentence", () => {
      const reason = buildReason(
        input({ position: "DEF", projectedPoints: 10, pointsAboveReplacement: 3 }),
      );
      expect(reason).toContain("the last startable defense");
    });
  });

  it("says what is missing rather than rendering an empty cell", () => {
    expect(buildReason(input())).toBe(
      "Ranked here, but we hold no usage or projection for him yet this season.",
    );
  });

  it("always ends in a full stop and starts capitalised", () => {
    const reason = buildReason(input({ projectedPoints: 8 }));
    expect(reason.endsWith(".")).toBe(true);
    expect(reason[0]).toBe(reason[0].toUpperCase());
  });
});

describe("boardScore", () => {
  it("ranks the bigger upgrade over replacement above the bigger raw projection", () => {
    const te = boardScore({
      position: "TE",
      pointsAboveReplacement: 5,
      projectedPoints: 9,
      opportunitySwing: 0,
      rosterPct: 10,
    });
    const wr = boardScore({
      position: "WR",
      pointsAboveReplacement: 1,
      projectedPoints: 13,
      opportunitySwing: 0,
      rosterPct: 10,
    });
    expect(te).toBeGreaterThan(wr);
  });

  it("lifts a player whose role just changed above an equal one whose did not", () => {
    const moved = boardScore({
      position: "RB",
      pointsAboveReplacement: 2,
      projectedPoints: 10,
      opportunitySwing: 1,
      rosterPct: 10,
    });
    const flat = boardScore({
      position: "RB",
      pointsAboveReplacement: 2,
      projectedPoints: 10,
      opportunitySwing: 0,
      rosterPct: 10,
    });
    expect(moved).toBeGreaterThan(flat);
  });

  it("prefers the player fewer leagues already have, all else equal", () => {
    const free = boardScore({
      position: "RB",
      pointsAboveReplacement: 2,
      projectedPoints: 10,
      opportunitySwing: 0,
      rosterPct: 3,
    });
    const held = boardScore({
      position: "RB",
      pointsAboveReplacement: 2,
      projectedPoints: 10,
      opportunitySwing: 0,
      rosterPct: 60,
    });
    expect(free).toBeGreaterThan(held);
  });

  it("keeps a streaming position below a starter with the same edge, because the upgrade lasts one week", () => {
    const rb = boardScore({
      position: "RB",
      pointsAboveReplacement: 3,
      projectedPoints: 11,
      opportunitySwing: 0,
      rosterPct: 20,
    });
    const def = boardScore({
      position: "DEF",
      pointsAboveReplacement: 3,
      projectedPoints: 11,
      opportunitySwing: 0,
      rosterPct: 20,
    });
    expect(rb).toBeGreaterThan(def);
  });

  it("still lets a far better streamer outrank a marginal starter, so the board is not position-locked", () => {
    const marginalRb = boardScore({
      position: "RB",
      pointsAboveReplacement: 0.2,
      projectedPoints: 7,
      opportunitySwing: 0,
      rosterPct: 20,
    });
    const strongDef = boardScore({
      position: "DEF",
      pointsAboveReplacement: 6,
      projectedPoints: 12,
      opportunitySwing: 0,
      rosterPct: 20,
    });
    expect(strongDef).toBeGreaterThan(marginalRb);
  });

  it("puts a player we know nothing about below every player we know something about", () => {
    const unknown = boardScore({
      position: "RB",
      pointsAboveReplacement: null,
      projectedPoints: null,
      opportunitySwing: 0,
      rosterPct: 0,
    });
    const worstKnown = boardScore({
      position: "RB",
      pointsAboveReplacement: -8,
      projectedPoints: 1,
      opportunitySwing: 0,
      rosterPct: 69,
    });
    expect(unknown).toBeLessThan(worstKnown);
  });
});

describe("topPickup", () => {
  const row = (position: ReasonInput["position"], score: number) => ({ position, score });

  it("leads on the best of the positions people actually claim", () => {
    const rows = [row("DEF", 9), row("K", 8), row("RB", 3), row("WR", 5)];
    expect(topPickup(rows)).toEqual(row("WR", 5));
  });

  it("never leads on a streamer while any skill player is on the board", () => {
    const rows = [row("DEF", 100), row("TE", 0.1)];
    expect(topPickup(rows)?.position).toBe("TE");
  });

  it("falls back to the whole board rather than showing an empty frame", () => {
    const rows = [row("K", 2), row("DEF", 4)];
    expect(topPickup(rows)).toEqual(row("DEF", 4));
  });

  it("is null on an empty board", () => {
    expect(topPickup([])).toBeNull();
  });
});
