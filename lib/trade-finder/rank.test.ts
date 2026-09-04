import { describe, it, expect } from "vitest";
import {
  acceptanceOf,
  measureImpact,
  qualityGapOf,
  qualityRatioOf,
  satisfiesGoal,
  scoreSuggestion,
  valueGapOf,
} from "./rank";
import { DEFAULT_TRADE_QUALITY_CONFIG } from "@/lib/trade-quality";
import { buildTeamProfile } from "./profile";
import { STANDARD_SLOTS, fullRoster, pick, player, pulse, team } from "./_test-kit";
import type { AssetRef } from "./packages";
import type { SideImpact } from "./types";

const BASELINES = { QB: 18, RB: 12, WR: 12, TE: 8 };

const ref = (p: ReturnType<typeof player>): AssetRef => ({ kind: "player", player: p });
const pickRef = (value: number): AssetRef => ({ kind: "pick", pick: pick({ value }) });

const impact = (over: Partial<SideImpact> = {}): SideImpact => ({
  valueDelta: 0,
  lineupDelta: 0,
  winsDelta: null,
  ageDelta: 0,
  pickCountDelta: 0,
  ...over,
});

const profileOf = (statusKey: "competitor" | "rebuilder" | "middle" | null) =>
  buildTeamProfile(team({ players: fullRoster(), statusKey }), STANDARD_SLOTS, BASELINES);

describe("valueGapOf", () => {
  it("is zero for a dead heat and grows with the imbalance", () => {
    expect(valueGapOf([ref(player({ value: 1000 }))], [ref(player({ value: 1000 }))])).toBe(0);
    expect(
      valueGapOf([ref(player({ value: 800 }))], [ref(player({ value: 1000 }))]),
    ).toBeCloseTo(0.2, 5);
  });

  it("treats a worthless side as maximally lopsided rather than dividing by zero", () => {
    expect(valueGapOf([], [])).toBe(1);
  });
});

describe("measureImpact", () => {
  it("reports what leaves and what arrives", () => {
    const roster = fullRoster();
    const mine = buildTeamProfile(team({ players: roster }), STANDARD_SLOTS, BASELINES);
    const incoming = [ref(player({ position: "TE", value: 3000, projPoints: 15 }))];
    const outgoing = [ref(roster[6])];

    const result = measureImpact(mine, STANDARD_SLOTS, incoming, outgoing);
    expect(result.valueDelta).toBe(3000 - roster[6].value);
    expect(result.lineupDelta).not.toBeNull();
    expect(result.pickCountDelta).toBe(0);
  });

  it("counts picks moving in each direction", () => {
    const mine = buildTeamProfile(team({ players: fullRoster() }), STANDARD_SLOTS, BASELINES);
    expect(
      measureImpact(mine, STANDARD_SLOTS, [pickRef(2000), pickRef(1000)], []).pickCountDelta,
    ).toBe(2);
    expect(measureImpact(mine, STANDARD_SLOTS, [], [pickRef(2000)]).pickCountDelta).toBe(-1);
  });
});

describe("acceptanceOf", () => {
  it("calls a deal that guts them a long shot however well it fits", () => {
    const theirs = impact({ valueDelta: -3000, pickCountDelta: 2 });
    expect(acceptanceOf(theirs, profileOf("rebuilder"), 0.4)).toBe("long-shot");
  });

  it("calls picks to a rebuilder likely", () => {
    const theirs = impact({ valueDelta: 100, pickCountDelta: 1, ageDelta: -0.5 });
    expect(acceptanceOf(theirs, profileOf("rebuilder"), 0.03)).toBe("likely");
  });

  it("calls points to a contender likely", () => {
    const theirs = impact({ valueDelta: 50, lineupDelta: 3 });
    expect(acceptanceOf(theirs, profileOf("competitor"), 0.02)).toBe("likely");
  });

  it("will not call it likely when it costs a CONTENDER real lineup points", () => {
    const theirs = impact({ valueDelta: 500, lineupDelta: -4, pickCountDelta: 1 });
    expect(acceptanceOf(theirs, profileOf("competitor"), 0.03)).toBe("worth-asking");
  });

  it("does not punish a rebuilder for losing points it was never going to use", () => {
    // The most standard dynasty trade there is: a rebuilder sends a productive
    // veteran away for a pick. It costs them points on Sunday, which is the
    // POINT, and an earlier version called exactly this a long shot.
    const theirs = impact({
      valueDelta: -91,
      lineupDelta: -4.7,
      pickCountDelta: 1,
      ageDelta: -0.6,
    });
    expect(acceptanceOf(theirs, profileOf("rebuilder"), 0.014)).toBe("likely");
  });

  it("still calls it a long shot when a contender loses on both counts", () => {
    const theirs = impact({ valueDelta: -203, lineupDelta: -4.7 });
    expect(acceptanceOf(theirs, profileOf("competitor"), 0.057)).toBe("long-shot");
  });

  it("gives an even deal that fits nobody's plan a worth-asking rather than a no", () => {
    const theirs = impact({ valueDelta: 0, lineupDelta: 0 });
    expect(acceptanceOf(theirs, profileOf("competitor"), 0.01)).toBe("worth-asking");
  });

  it("calls a poor fit they also lose value on a long shot", () => {
    const theirs = impact({ valueDelta: -800, lineupDelta: 0 });
    expect(acceptanceOf(theirs, profileOf("competitor"), 0.15)).toBe("long-shot");
  });
});

describe("satisfiesGoal", () => {
  /** A one-for-one of comparable players. Neither side moves up a tier. */
  const shape = { incoming: 1, outgoing: 1, incomingTop: 3000, outgoingTop: 3000 };

  it("lets everything through on open to all trades", () => {
    expect(satisfiesGoal("balanced", impact({ valueDelta: -500 }), shape)).toBe(true);
  });

  it("requires the thing the reader asked for", () => {
    expect(satisfiesGoal("add-picks", impact({ pickCountDelta: 0 }), shape)).toBe(false);
    expect(satisfiesGoal("add-picks", impact({ pickCountDelta: 1 }), shape)).toBe(true);
    expect(satisfiesGoal("get-younger", impact({ ageDelta: 0.4 }), shape)).toBe(false);
    expect(satisfiesGoal("get-younger", impact({ ageDelta: -0.4 }), shape)).toBe(true);
  });

  it("does not reject a trade for a number it could not measure", () => {
    // An unmeasurable age is a reason to say nothing about it, not a reason to
    // throw the trade away.
    expect(satisfiesGoal("get-younger", impact({ ageDelta: null }), shape)).toBe(true);
  });

  it("counts a pick plus a player as adding picks", () => {
    // The goal names what has to come back, not what may not. Refusing this
    // shape would hide the best version of the deal the reader asked for.
    expect(
      satisfiesGoal("add-picks", impact({ pickCountDelta: 1 }), {
        incoming: 2,
        outgoing: 1,
        incomingTop: 3000,
        outgoingTop: 3200,
      }),
    ).toBe(true);
  });

  it("makes consolidating mean moving up a tier, not just sending more bodies", () => {
    const jump = { incoming: 1, outgoing: 2, incomingTop: 5000, outgoingTop: 3000 };
    const sideways = { incoming: 1, outgoing: 2, incomingTop: 3000, outgoingTop: 3000 };
    expect(satisfiesGoal("consolidate", impact(), jump)).toBe(true);
    // Two for one where the piece coming back is no better than what left is a
    // rearrangement, and calling it consolidation would be a lie the reader can
    // see on the card.
    expect(satisfiesGoal("consolidate", impact(), sideways)).toBe(false);
    expect(satisfiesGoal("consolidate", impact(), shape)).toBe(false);
  });

  it("makes splitting assets mean the good player is the one leaving", () => {
    const split = { incoming: 2, outgoing: 1, incomingTop: 3000, outgoingTop: 5000 };
    // Two mid pieces for one better player is consolidation seen from the other
    // seat, and it is the opposite of what this reader asked for.
    const backwards = { incoming: 2, outgoing: 1, incomingTop: 5000, outgoingTop: 3000 };
    expect(satisfiesGoal("split-assets", impact(), split)).toBe(true);
    expect(satisfiesGoal("split-assets", impact(), backwards)).toBe(false);
    expect(satisfiesGoal("split-assets", impact(), shape)).toBe(false);
  });
});

describe("qualityRatioOf and qualityGapOf", () => {
  const QUALITY = { config: DEFAULT_TRADE_QUALITY_CONFIG, poolMax: 9900 };

  it("reads under 1 when the reader pays with depth for a starter", () => {
    const incoming = [ref(player({ value: 4000 }))];
    const outgoing = [ref(player({ value: 2200 })), ref(player({ value: 2000 }))];
    // Raw values are all but level, so the old gap says this is fair.
    expect(valueGapOf(incoming, outgoing)).toBeLessThan(0.06);
    expect(qualityRatioOf(incoming, outgoing, QUALITY)).toBeLessThan(0.85);
  });

  it("reads about 1 for a like-for-like swap", () => {
    const incoming = [ref(player({ value: 4000 }))];
    const outgoing = [ref(player({ value: 4050 }))];
    expect(qualityRatioOf(incoming, outgoing, QUALITY)).toBeGreaterThan(0.95);
  });

  it("expresses the gap as a share of the larger side, like valueGapOf", () => {
    expect(qualityGapOf(1)).toBe(0);
    expect(qualityGapOf(0.8)).toBeCloseTo(0.2, 6);
    expect(qualityGapOf(1.25)).toBeCloseTo(0.2, 6);
    expect(qualityGapOf(0)).toBe(1);
  });
});

describe("acceptanceOf on the consolidation curve", () => {
  const QUALITY = { config: DEFAULT_TRADE_QUALITY_CONFIG, poolMax: 9900 };

  it("calls a raw-even package-for-starter deal a long shot", () => {
    const incoming = [ref(player({ value: 4000 }))];
    const outgoing = [ref(player({ value: 1400 })), ref(player({ value: 1350 })), ref(player({ value: 1300 }))];
    const gap = valueGapOf(incoming, outgoing);
    const ratio = qualityRatioOf(incoming, outgoing, QUALITY);

    // The counterparty is handed three bodies for one player. Raw value says it
    // is fine; the reason this feature was rebuilt is that it is not.
    const theirs = impact({ valueDelta: 50, lineupDelta: -0.2 });
    expect(acceptanceOf(theirs, profileOf("middle"), gap, ratio)).toBe("long-shot");
  });

  it("still reads a genuine one-for-one as worth asking or better", () => {
    const incoming = [ref(player({ value: 4000 }))];
    const outgoing = [ref(player({ value: 4100 }))];
    const gap = valueGapOf(incoming, outgoing);
    const ratio = qualityRatioOf(incoming, outgoing, QUALITY);

    const theirs = impact({ valueDelta: 100, lineupDelta: 0.8 });
    expect(acceptanceOf(theirs, profileOf("competitor"), gap, ratio)).not.toBe("long-shot");
  });

  it("falls back to raw value when no quality ratio is supplied", () => {
    const theirs = impact({ valueDelta: 400, lineupDelta: 1.2 });
    expect(acceptanceOf(theirs, profileOf("competitor"), 0.02)).toBe("likely");
  });
});

describe("acceptanceOf, the tendency band shift (Manager Pulse, section 8.3)", () => {
  it("returns exactly today's answer when no tendency adjustment is passed", () => {
    const theirs = impact({ valueDelta: 0, lineupDelta: 0 });
    const withoutArg = acceptanceOf(theirs, profileOf("competitor"), 0.01);
    const withUndefined = acceptanceOf(theirs, profileOf("competitor"), 0.01, undefined, undefined);
    const withZero = acceptanceOf(theirs, profileOf("competitor"), 0.01, undefined, 0);
    expect(withoutArg).toBe("worth-asking");
    expect(withUndefined).toBe(withoutArg);
    expect(withZero).toBe(withoutArg);
  });

  it("moves a worth-asking deal to likely on a +1 step", () => {
    const theirs = impact({ valueDelta: 0, lineupDelta: 0 });
    const base = acceptanceOf(theirs, profileOf("competitor"), 0.01);
    expect(base).toBe("worth-asking");
    expect(acceptanceOf(theirs, profileOf("competitor"), 0.01, undefined, 1)).toBe("likely");
  });

  it("moves a worth-asking deal to long-shot on a -1 step", () => {
    const theirs = impact({ valueDelta: 0, lineupDelta: 0 });
    const base = acceptanceOf(theirs, profileOf("competitor"), 0.01);
    expect(base).toBe("worth-asking");
    expect(acceptanceOf(theirs, profileOf("competitor"), 0.01, undefined, -1)).toBe("long-shot");
  });

  it("never moves a band past its neighbour, whatever step size is passed", () => {
    const theirs = impact({ valueDelta: 50, lineupDelta: 3 });
    const base = acceptanceOf(theirs, profileOf("competitor"), 0.02);
    expect(base).toBe("likely");
    // "likely" is already the top of the order; a further +1 (and anything
    // beyond the defensive +-1 clamp) has nowhere left to move it.
    expect(acceptanceOf(theirs, profileOf("competitor"), 0.02, undefined, 1)).toBe("likely");
    expect(acceptanceOf(theirs, profileOf("competitor"), 0.02, undefined, 5)).toBe("likely");
  });

  it("clamps a step size beyond +-1, the largest Manager Pulse may ever pass", () => {
    const theirs = impact({ valueDelta: 0, lineupDelta: 0 });
    // From "worth-asking", a clamped -5 must land on "long-shot" (one step
    // down), never skip past it into some band that does not exist.
    expect(acceptanceOf(theirs, profileOf("competitor"), 0.01, undefined, -5)).toBe(
      "long-shot",
    );
  });
});

describe("scoreSuggestion, weighted by the reader's own footing", () => {
  /**
   * The same deal, scored for each of the three kinds of team.
   *
   * One trade that adds real points on Sunday and gives up real trade value to
   * do it, which is the deal that genuinely SHOULD split a league: it is what a
   * contender is looking for and the last thing a rebuilder wants.
   */
  const winNowDeal = impact({ lineupDelta: 3, winsDelta: 0.33, valueDelta: -900 });
  /** Its mirror: value and youth and draft capital, at a cost on the field. */
  const rebuildDeal = impact({
    lineupDelta: -3,
    winsDelta: -0.33,
    valueDelta: 900,
    ageDelta: -1.5,
    pickCountDelta: 2,
  });

  const scoreFor = (
    statusKey: "competitor" | "rebuilder" | "middle" | null,
    mine: SideImpact,
  ) =>
    scoreSuggestion({
      mine,
      myProfile: buildTeamProfile(
        team({ players: fullRoster(), statusKey, pulse: pulse() }),
        STANDARD_SLOTS,
        BASELINES,
      ),
      acceptance: "worth-asking",
      goal: "balanced",
    });

  it("puts the win-now deal in front of a contender and the rebuild deal behind it", () => {
    expect(scoreFor("competitor", winNowDeal)).toBeGreaterThan(
      scoreFor("competitor", rebuildDeal),
    );
  });

  it("reverses that for a rebuilder", () => {
    expect(scoreFor("rebuilder", rebuildDeal)).toBeGreaterThan(
      scoreFor("rebuilder", winNowDeal),
    );
  });

  it("values the win-now deal more to a contender than to a rebuilder", () => {
    expect(scoreFor("competitor", winNowDeal)).toBeGreaterThan(
      scoreFor("rebuilder", winNowDeal),
    );
  });

  it("leaves a team in the pack, and a league with no Power Pulse, exactly where they were", () => {
    // The middle band is the neutral multiplier by design, and a team with no
    // status at all is read as the middle. A league Power Pulse has not scored
    // must rank the way it did before any of this existed.
    expect(scoreFor("middle", winNowDeal)).toBeCloseTo(scoreFor(null, winNowDeal), 10);
  });

  it("scores a league with no Power Pulse exactly as it did before any of this", () => {
    // Pinned to the arithmetic rather than to a comparison, because a
    // comparison passes even when both sides have drifted. These are the
    // pre-refactor balanced weights: lineup 1.3, value 1, youth 0.4, picks 0.3,
    // with the acceptance discount of 0.75 for "worth asking".
    const profile = buildTeamProfile(
      team({ players: fullRoster(), statusKey: null }),
      STANDARD_SLOTS,
      BASELINES,
    );
    const valueDelta = -900;
    const expected =
      (3 * 1.3 + (valueDelta / profile.totalValue) * 100 * 1) * 0.75;

    const noPulse = scoreSuggestion({
      mine: impact({ lineupDelta: 3, winsDelta: null, valueDelta }),
      myProfile: profile,
      acceptance: "worth-asking",
      goal: "balanced",
    });
    expect(noPulse).toBeCloseTo(expected, 10);
  });

  it("adds the wins term on top rather than replacing the lineup term", () => {
    // Same deal twice, the second with a projected-wins figure attached. The
    // difference has to be exactly the wins term at the balanced weighting, or
    // the two readings of the same gain are being conflated.
    const profile = buildTeamProfile(
      team({ players: fullRoster(), statusKey: null, pulse: pulse() }),
      STANDARD_SLOTS,
      BASELINES,
    );
    const base = { lineupDelta: 3, valueDelta: 0 };
    const without = scoreSuggestion({
      mine: impact({ ...base, winsDelta: null }),
      myProfile: profile,
      acceptance: "likely",
      goal: "balanced",
    });
    const with_ = scoreSuggestion({
      mine: impact({ ...base, winsDelta: 0.33 }),
      myProfile: profile,
      acceptance: "likely",
      goal: "balanced",
    });
    expect(with_ - without).toBeCloseTo(0.33 * 10 * 1.3, 10);
  });

  it("counts a longer remaining season for more than a shorter one", () => {
    const early = scoreSuggestion({
      mine: impact({ lineupDelta: 3, winsDelta: 0.33 }),
      myProfile: buildTeamProfile(
        team({ players: fullRoster(), statusKey: "competitor" }),
        STANDARD_SLOTS,
        BASELINES,
      ),
      acceptance: "worth-asking",
      goal: "balanced",
    });
    const late = scoreSuggestion({
      mine: impact({ lineupDelta: 3, winsDelta: 0.09 }),
      myProfile: buildTeamProfile(
        team({ players: fullRoster(), statusKey: "competitor" }),
        STANDARD_SLOTS,
        BASELINES,
      ),
      acceptance: "worth-asking",
      goal: "balanced",
    });
    expect(early).toBeGreaterThan(late);
  });
});

describe("measureImpact and projected wins", () => {
  it("reports the wins a lineup change is worth against the remaining schedule", () => {
    const profile = buildTeamProfile(
      team({ players: fullRoster(), pulse: pulse({ winsPerPoint: 0.1 }) }),
      STANDARD_SLOTS,
      BASELINES,
    );
    const incoming = [ref(player({ position: "TE", value: 3000, projPoints: 18 }))];
    const outgoing: AssetRef[] = [];
    const result = measureImpact(profile, STANDARD_SLOTS, incoming, outgoing);
    expect(result.lineupDelta).not.toBeNull();
    expect(result.winsDelta).toBeCloseTo((result.lineupDelta as number) * 0.1, 10);
  });

  it("leaves projected wins null on a league Power Pulse has not scored", () => {
    const profile = buildTeamProfile(
      team({ players: fullRoster(), pulse: null }),
      STANDARD_SLOTS,
      BASELINES,
    );
    const incoming = [ref(player({ position: "TE", value: 3000, projPoints: 18 }))];
    expect(measureImpact(profile, STANDARD_SLOTS, incoming, []).winsDelta).toBeNull();
  });
});

describe("scoreSuggestion, horizon weight (Part 4: rest-of-season horizon)", () => {
  /**
   * Two candidate packages that disagree on purpose: one wins on the field and
   * gives up a little trade value to do it, the other gives up a little on the
   * field for a real gain in trade value. Which one leads the ranking is
   * exactly the question this table answers.
   */
  const winsPackage = impact({ lineupDelta: 3, winsDelta: 0.3, valueDelta: -200 });
  const valuePackage = impact({ lineupDelta: -0.5, winsDelta: -0.02, valueDelta: 1200 });

  const profileFor = (
    isDynasty: boolean,
    statusKey: "competitor" | "rebuilder" | "middle" | null,
  ) =>
    buildTeamProfile(
      team({ players: fullRoster(), statusKey }),
      STANDARD_SLOTS,
      BASELINES,
      { isDynasty },
    );

  it("orders a redraft league by projected wins when trade value disagrees", () => {
    // A redraft league always resolves to the "contender" strategy (see
    // resolveStrategy in ./types), so the test states it explicitly rather
    // than relying on the fallback this function carries for direct callers.
    const profile = profileFor(false, null);
    const scoreWins = scoreSuggestion({
      mine: winsPackage,
      myProfile: profile,
      acceptance: "worth-asking",
      goal: "balanced",
      strategy: "contender",
    });
    const scoreValue = scoreSuggestion({
      mine: valuePackage,
      myProfile: profile,
      acceptance: "worth-asking",
      goal: "balanced",
      strategy: "contender",
    });
    expect(scoreWins).toBeGreaterThan(scoreValue);
  });

  it("orders a dynasty contender by projected wins the same way", () => {
    const profile = profileFor(true, "competitor");
    const scoreWins = scoreSuggestion({
      mine: winsPackage,
      myProfile: profile,
      acceptance: "worth-asking",
      goal: "balanced",
    });
    const scoreValue = scoreSuggestion({
      mine: valuePackage,
      myProfile: profile,
      acceptance: "worth-asking",
      goal: "balanced",
    });
    expect(scoreWins).toBeGreaterThan(scoreValue);
  });

  it("orders a dynasty rebuilder by trade value, and that order never moves for any projected-wins number", () => {
    const profile = profileFor(true, "rebuilder");
    const scoreWinsPkg = scoreSuggestion({
      mine: winsPackage,
      myProfile: profile,
      acceptance: "worth-asking",
      goal: "balanced",
    });
    const scoreValuePkg = scoreSuggestion({
      mine: valuePackage,
      myProfile: profile,
      acceptance: "worth-asking",
      goal: "balanced",
    });
    // Reversed from the two readings above: a rebuilder ranks the value
    // package over the wins package.
    expect(scoreValuePkg).toBeGreaterThan(scoreWinsPkg);

    // THE ONE HARD RULE (docs/projection-engine-plan.md, Part 4). Same two
    // packages, lineupDelta and winsDelta swapped out for unrelated numbers on
    // both sides, everything else held fixed. If the rebuilder branch read the
    // projection at all, at least one of these four totals would move off the
    // value it started at.
    const rewound = (mine: SideImpact, lineupDelta: number, winsDelta: number | null) =>
      scoreSuggestion({
        mine: { ...mine, lineupDelta, winsDelta },
        myProfile: profile,
        acceptance: "worth-asking",
        goal: "balanced",
      });

    expect(rewound(winsPackage, 99, 4)).toBeCloseTo(scoreWinsPkg, 10);
    expect(rewound(winsPackage, -40, -6)).toBeCloseTo(scoreWinsPkg, 10);
    expect(rewound(valuePackage, 12, 1.1)).toBeCloseTo(scoreValuePkg, 10);
    expect(rewound(valuePackage, -8, null)).toBeCloseTo(scoreValuePkg, 10);
  });

  it("weighs a dynasty balanced league between the contender and rebuilder readings", () => {
    // One deal, wins-positive and value-negative, so the two terms disagree
    // and the horizon is what decides how loudly each one speaks.
    const deal = impact({ lineupDelta: 2, winsDelta: 0.2, valueDelta: -400 });
    const scoreFor = (statusKey: "competitor" | "middle" | "rebuilder") =>
      scoreSuggestion({
        mine: deal,
        myProfile: profileFor(true, statusKey),
        acceptance: "worth-asking",
        goal: "balanced",
      });

    const contenderScore = scoreFor("competitor");
    const balancedScore = scoreFor("middle");
    const rebuilderScore = scoreFor("rebuilder");

    expect(contenderScore).toBeGreaterThan(balancedScore);
    expect(balancedScore).toBeGreaterThan(rebuilderScore);
  });
});
