import { describe, it, expect } from "vitest";
import {
  buildCaveat,
  buildRationale,
  MAX_RATIONALE_POINTS,
  type RationaleInput,
  type SeasonFinish,
} from "./rationale";
import type { MarginalResult } from "./marginal";
import type { RankedPlayer } from "./board-types";

/**
 * What this file is protecting.
 *
 * The spotlight used to say "Highest FF Beacon value still on the board" and
 * nothing else, so nobody could tell a good recommendation from a confident one.
 * These sentences are now the product, and the failure modes worth a test are
 * all forms of overclaiming: points for a player nobody projected, a verdict off
 * a one-week sample, youth asserted about a 31-year-old, a build the drafter was
 * never offered a choice about, and our own outage described as a fact about him.
 */

let seq = 0;
function rp(over: Partial<RankedPlayer> = {}): RankedPlayer {
  seq += 1;
  return {
    playerId: over.playerId ?? `p${seq}`,
    sleeperId: `s${seq}`,
    name: over.name ?? `Player ${seq}`,
    position: "WR",
    team: "ATL",
    overallRank: seq,
    positionRank: 4,
    tier: 2,
    value: 6400,
    isRookie: false,
    ...over,
  };
}

function marginalResult(over: Partial<MarginalResult> = {}): MarginalResult {
  return {
    playerId: "p1",
    startingAdd: 0,
    insuranceAdd: 0,
    dropoffEdge: 0,
    weeksStarting: 0,
    weeksConsidered: 14,
    effectiveAdd: 0,
    driver: "none",
    displaces: null,
    ...over,
  };
}

function input(over: Partial<RationaleInput> = {}): RationaleInput {
  return {
    kind: "need",
    player: rp(),
    marginal: null,
    mode: "balanced",
    engine: "points",
    projectionsAvailable: true,
    filledSlot: null,
    openSlots: [],
    picksUntilNext: null,
    displacedName: null,
    adpThreshold: 6,
    finishes: [],
    league: { type: "redraft", superflex: false, tep: false },
    rosterKnown: true,
    ...over,
  };
}

const DYNASTY: RationaleInput["league"] = { type: "dynasty", superflex: false, tep: false };
const KEEPER: RationaleInput["league"] = { type: "keeper", superflex: false, tep: false };

const finish = (season: number, f: number): SeasonFinish => ({
  season,
  finish: f,
  playersRanked: 200,
});

function bodyFor(points: ReturnType<typeof buildRationale>, id: string): string {
  return points.find((p) => p.id === id)?.body ?? "";
}

describe("buildRationale", () => {
  it("never shows more points than the cap, and never repeats one", () => {
    const points = buildRationale(
      input({
        marginal: marginalResult({ driver: "starter", startingAdd: 4.2, dropoffEdge: 2.1 }),
        picksUntilNext: 9,
        finishes: [finish(2025, 6), finish(2024, 14)],
        player: rp({ adp: 41, beaconPick: 22, beatRate: 0.46, accuracyWeeks: 30 }),
      }),
    );
    expect(points.length).toBeLessThanOrEqual(MAX_RATIONALE_POINTS);
    expect(new Set(points.map((p) => p.id)).size).toBe(points.length);
  });

  it("leads with the lineup on Team Need and with the board on Best Available", () => {
    const shared = {
      marginal: marginalResult({ driver: "starter", startingAdd: 4.2 }),
      player: rp({ adp: 41, beaconPick: 22 }),
    };
    expect(buildRationale(input({ kind: "need", ...shared }))[0].id).toBe("lineup");
    expect(buildRationale(input({ kind: "best", ...shared }))[0].id).toBe("value");
  });

  it("names the starter a pick would displace", () => {
    const points = buildRationale(
      input({
        marginal: marginalResult({ driver: "upgrade", startingAdd: 3.4, weeksStarting: 11 }),
        displacedName: "Chris Olave",
      }),
    );
    expect(bodyFor(points, "lineup")).toContain("Chris Olave");
    expect(bodyFor(points, "lineup")).toContain("3.4 points");
    expect(bodyFor(points, "lineup")).toContain("11 of the 14 weeks");
  });

  it("leaves no double space when there is no starting-weeks line to add", () => {
    const points = buildRationale(
      input({ marginal: marginalResult({ driver: "starter", startingAdd: 4.2, weeksStarting: 0 }) }),
    );
    expect(bodyFor(points, "lineup")).not.toMatch(/\s{2}|\s$/);
  });

  it("names the backed-up starter rather than saying the man ahead of him", () => {
    const points = buildRationale(
      input({
        marginal: marginalResult({ driver: "insurance", insuranceAdd: 2.2 }),
        displacedName: "Chris Olave",
      }),
    );
    expect(bodyFor(points, "lineup")).toContain("If Chris Olave misses time");
  });

  it("keeps the open-slot sentence free of parenthetical asides", () => {
    const points = buildRationale(input({ openSlots: ["RB", "Flex", "TE"] }));
    const body = bodyFor(points, "lineup");
    expect(body).toContain("You still need RB, Flex, and TE");
    expect(body).not.toContain("(");
  });

  it("says the market is late when he lasts past our pick, and early when he does not", () => {
    const late = buildRationale(input({ kind: "best", player: rp({ adp: 44, beaconPick: 21 }) }));
    expect(bodyFor(late, "value")).toContain("23 picks later than he is worth");

    const early = buildRationale(input({ kind: "best", player: rp({ adp: 12, beaconPick: 35 }) }));
    expect(bodyFor(early, "value")).toContain("paying up for him");
  });

  it("treats a zero or non-finite ADP as absent rather than as pick zero", () => {
    for (const adp of [0, Number.NaN]) {
      const body = bodyFor(buildRationale(input({ kind: "best", player: rp({ adp }) })), "value");
      expect(body).not.toContain("pick 0");
      expect(body).not.toContain("NaN");
    }
  });

  it("says nothing about the market when there is no ADP, and translates the rank", () => {
    const points = buildRationale(input({ kind: "best", player: rp({ adp: null }) }));
    const body = bodyFor(points, "value");
    expect(body).not.toContain("pick");
    expect(body).toContain("4th ranked receiver on our board");
  });

  it("prices the wait from the dropoff, with the verb before the long clause", () => {
    const points = buildRationale(
      input({
        marginal: marginalResult({ driver: "scarcity", dropoffEdge: 3.7 }),
        picksUntilNext: 17,
      }),
    );
    const body = bodyFor(points, "timing");
    expect(body.startsWith("Waiting costs you about 3.7 points a week.")).toBe(true);
    expect(body).toContain("17 picks");
  });

  it("drops the timing point entirely when the next pick is close and nothing was measured", () => {
    const points = buildRationale(input({ picksUntilNext: 1 }));
    expect(points.some((p) => p.id === "timing")).toBe(false);
  });

  it("reads finishes as ordinals against the depth that position actually starts", () => {
    const wr = buildRationale(input({ kind: "best", finishes: [finish(2025, 8), finish(2024, 19)] }));
    const body = bodyFor(wr, "track");
    expect(body).toContain("8th among receivers in 2025");
    expect(body).toContain("19th in 2024");
    expect(body).toContain("top-36 season in every one of them");

    const qb = buildRationale(
      input({
        kind: "best",
        player: rp({ position: "QB", positionRank: 5 }),
        finishes: [finish(2025, 8), finish(2024, 19)],
      }),
    );
    expect(bodyFor(qb, "track")).toContain("1 top-12 season out of 2");
  });

  it("admits a rookie has no track record instead of inventing one", () => {
    const points = buildRationale(
      input({ kind: "best", player: rp({ isRookie: true }), finishes: [] }),
    );
    expect(bodyFor(points, "track")).toContain("never played an NFL snap");
  });

  it("states a beat rate but withholds the verdict on a thin sample", () => {
    const thin = buildRationale(
      input({ kind: "best", player: rp({ beatRate: 1, accuracyWeeks: 1 }) }),
    );
    const thinBody = bodyFor(thin, "track");
    expect(thinBody).toContain("too small a sample");
    expect(thinBody).not.toContain("well above average");

    const solid = buildRationale(
      input({ kind: "best", player: rp({ beatRate: 0.52, accuracyWeeks: 26 }) }),
    );
    expect(bodyFor(solid, "track")).toContain("well above average");
  });

  it("keeps lineup claims honest when we cannot see the roster", () => {
    const points = buildRationale(input({ rosterKnown: false }));
    expect(bodyFor(points, "lineup")).toContain("cannot see your team");
  });

  it("never tells a redraft league it set a build, because it was never asked", () => {
    // Redraft forces compete mode with the selector hidden, so "you set this
    // team to win now" would be describing a choice the UI never offered.
    const body = bodyFor(
      buildRationale(input({ kind: "best", mode: "compete" })),
      "build",
    );
    expect(body).not.toContain("You set");
    expect(body).toContain("one-year redraft league");
  });

  it("uses the compete copy in a dynasty startup, where the mode really was chosen", () => {
    const body = bodyFor(
      buildRationale(input({ kind: "best", mode: "compete", league: DYNASTY })),
      "build",
    );
    expect(body).toContain("dynasty team to win now");
  });

  it("calls a dynasty league a dynasty league, never a keeper league", () => {
    for (const mode of ["balanced", "compete", "rebuild"] as const) {
      const body = bodyFor(buildRationale(input({ kind: "best", mode, league: DYNASTY })), "build");
      expect(body).not.toContain("keeper");
      expect(body).toContain("dynasty");
    }
  });

  it("explains superflex on a quarterback and stays quiet about it on a receiver", () => {
    const sflex = { ...DYNASTY, superflex: true };
    const qb = bodyFor(
      buildRationale(input({ kind: "best", league: sflex, player: rp({ position: "QB" }) })),
      "build",
    );
    expect(qb).toContain("starts a second quarterback");

    const wr = bodyFor(buildRationale(input({ kind: "best", league: sflex })), "build");
    expect(wr).not.toContain("quarterback");
  });

  it("says one quarterback is easy to fill late, but only on Best Available", () => {
    const onBest = bodyFor(
      buildRationale(input({ kind: "best", league: DYNASTY, player: rp({ position: "QB" }) })),
      "build",
    );
    expect(onBest).toContain("Only one quarterback starts here");

    // On a Team Need card the lineup point may have just told the reader to
    // cover quarterback. Two cards arguing opposite sides of one pick is worse
    // than one card fewer.
    const onNeed = bodyFor(
      buildRationale(
        input({
          kind: "need",
          league: DYNASTY,
          filledSlot: "QB",
          player: rp({ position: "QB" }),
        }),
      ),
      "build",
    );
    expect(onNeed).not.toContain("easiest on the board to fill late");
  });

  it("keeps the league sentence on the Team Need card even when every point fires", () => {
    // Five points are built and four are shown, so one is always cut in a live
    // draft. It must not be the one naming the league: the finish strip and the
    // beat-rate tile carry the track record elsewhere on the card, and nothing
    // else on the page says what kind of league this is.
    const points = buildRationale(
      input({
        kind: "need",
        league: DYNASTY,
        marginal: marginalResult({ driver: "starter", startingAdd: 4.2, dropoffEdge: 2.1 }),
        picksUntilNext: 12,
        finishes: [finish(2025, 6), finish(2024, 14)],
        player: rp({ adp: 41, beaconPick: 22, beatRate: 0.46, accuracyWeeks: 30 }),
      }),
    );
    expect(points).toHaveLength(MAX_RATIONALE_POINTS);
    expect(points.map((p) => p.id)).toContain("build");
  });

  it("never runs the format sentence and the projection sentence together", () => {
    // Both are true, and four sentences in one spoken body is past what a
    // listener can hold under a draft clock. The projection is in a tile above.
    const withFormat = bodyFor(
      buildRationale(
        input({
          kind: "best",
          league: { type: "dynasty", superflex: true, tep: false },
          player: rp({ position: "QB", projPointsPerWeek: 21.4 }),
        }),
      ),
      "build",
    );
    expect(withFormat).toContain("starts a second quarterback");
    expect(withFormat).not.toContain("We project him");

    const withoutFormat = bodyFor(
      buildRationale(input({ kind: "best", player: rp({ projPointsPerWeek: 13.1 }) })),
      "build",
    );
    expect(withoutFormat).toContain("We project him for 13.1 points a week");
  });

  it("drops the build claim from the heading in a league with no build to fit", () => {
    const titleFor = (over: Partial<RationaleInput>) =>
      buildRationale(input({ kind: "best", ...over })).find((p) => p.id === "build")?.title ?? "";
    expect(titleFor({})).toBe("How he fits your league");
    expect(titleFor({ league: KEEPER })).toBe("How he fits your league");
    expect(titleFor({ league: DYNASTY })).toBe("How he fits your league and your build");
  });

  it("calls a keeper league a keeper league, not a one-year league", () => {
    const body = bodyFor(buildRationale(input({ kind: "best", league: KEEPER })), "build");
    expect(body).toContain("keeper league");
    expect(body).not.toContain("one-year redraft league");
    expect(body).not.toContain("dynasty");
    // The mode is forced in a keeper league, so it must not claim the drafter
    // chose one.
    expect(body).not.toContain("You set");
  });

  it("explains the tight end premium only where the league actually pays one", () => {
    const tep = { ...DYNASTY, tep: true };
    const withTep = bodyFor(
      buildRationale(input({ kind: "best", league: tep, player: rp({ position: "TE" }) })),
      "build",
    );
    expect(withTep).toContain("Tight end premium is in play here");

    const without = bodyFor(
      buildRationale(input({ kind: "best", league: DYNASTY, player: rp({ position: "TE" }) })),
      "build",
    );
    expect(without).not.toContain("Tight end premium");
  });

  it("only calls a player young when the engine's own youth curve agrees", () => {
    const young = bodyFor(
      buildRationale(
        input({ kind: "best", league: DYNASTY, mode: "balanced", player: rp({ ageDecimal: 23.4 }) }),
      ),
      "build",
    );
    expect(young).toContain("He is 23, young enough");

    const old = bodyFor(
      buildRationale(
        input({ kind: "best", league: DYNASTY, mode: "balanced", player: rp({ ageDecimal: 31.2 }) }),
      ),
      "build",
    );
    expect(old).not.toContain("young enough");
    expect(old).toContain("He is 31");
  });

  it("speaks ages in whole years, never in decimals", () => {
    const body = bodyFor(
      buildRationale(
        input({ kind: "best", league: DYNASTY, mode: "rebuild", player: rp({ ageDecimal: 23.4 }) }),
      ),
      "build",
    );
    expect(body).toContain("He is 23,");
    expect(body).not.toContain("23.4");
  });
});

describe("buildCaveat", () => {
  it("blames our own projection outage on us, not on the player", () => {
    const caveat = buildCaveat(input({ projectionsAvailable: false, player: rp() }));
    expect(caveat).toContain("Weekly projections are unavailable");
    expect(caveat).not.toContain("Nobody publishes");
  });

  it("flags a thin sample before it flags anything computed from that sample", () => {
    const caveat = buildCaveat(
      input({ player: rp({ availability: 0.1, accuracyWeeks: 3, projPointsPerWeek: 11 }) }),
    );
    expect(caveat).toContain("3 graded weeks");
  });

  it("flags a player who has missed the weeks he was projected for", () => {
    expect(
      buildCaveat(
        input({ player: rp({ availability: 0.62, accuracyWeeks: 24, projPointsPerWeek: 14 }) }),
      ),
    ).toContain("62%");
  });

  it("says so when nobody projects one player inside a working service", () => {
    expect(
      buildCaveat(input({ player: rp({ availability: 0.95, accuracyWeeks: 30 }) })),
    ).toContain("Nobody publishes a weekly projection for him");
  });

  it("stays quiet when there is nothing to flag", () => {
    expect(
      buildCaveat(
        input({ player: rp({ availability: 0.95, accuracyWeeks: 30, projPointsPerWeek: 13.2 }) }),
      ),
    ).toBeNull();
  });
});
