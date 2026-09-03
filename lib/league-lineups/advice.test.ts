/**
 * Coverage for lib/league-lineups/advice.ts.
 *
 * Two rules carry the weight here, and both are about not giving bad advice
 * rather than about arithmetic:
 *
 *   1. A DYNASTY ROSTER IS NEVER TOLD TO CUT A VALUABLE PLAYER. Losing him for
 *      nothing to a waiver claim is the worst outcome this page could talk
 *      somebody into, and it is irreversible.
 *   2. NOBODY THE OPTIMISER SEATS IS OFFERED AS A CUT. Two panels on one screen
 *      telling a reader to start a player and to release him is not a bug they
 *      can reason their way past.
 */

import { describe, it, expect } from "vitest";
import { classifyTeamStatus, type TeamStatus } from "@/lib/league-team-status";
import {
  buildDropOptions,
  buildWaiverSuggestions,
  goalBrief,
  DYNASTY_KEEP_VALUE,
  type WaiverCandidate,
} from "./advice";
import type { LineupPlayer, RosterSlotKind } from "./types";

function lineupPlayer(
  sleeperId: string,
  overrides: Partial<LineupPlayer> = {},
): LineupPlayer {
  return {
    playerId: `p-${sleeperId}`,
    sleeperId,
    name: sleeperId,
    position: "WR",
    team: "BUF",
    injuryStatus: null,
    nflOpponent: "SF",
    nflIsHome: null,
    opponentMultiplier: null,
    beatRate: null,
    availability: null,
    reliability: null,
    projected: 8,
    sigma: 5,
    actual: null,
    isInactive: false,
    rosterSlot: "bench" as RosterSlotKind,
    startingSlotLabel: null,
    startingSlotOrder: null,
    positionalWar: null,
    positionalWarRank: null,
    positionalWarPoolSize: null,
    environment: null,
    environmentTier: null,
    ...overrides,
  };
}

const CONTENDER: TeamStatus = classifyTeamStatus({
  pulseRank: 1,
  valueRank: 1,
  teamCount: 12,
  variant: "dynasty",
}) as TeamStatus;

const REBUILDER: TeamStatus = classifyTeamStatus({
  pulseRank: 12,
  valueRank: 1,
  teamCount: 12,
  variant: "dynasty",
}) as TeamStatus;

const REDRAFT_LONGSHOT: TeamStatus = classifyTeamStatus({
  pulseRank: 12,
  valueRank: 12,
  teamCount: 12,
  variant: "redraft",
}) as TeamStatus;

describe("classify fixtures are what the tests below assume", () => {
  it("produces a contender, a rebuilder and a redraft longshot", () => {
    expect(CONTENDER.key).toBe("competitor");
    expect(REBUILDER.key).toBe("rebuilder");
    expect(REDRAFT_LONGSHOT.variant).toBe("redraft");
  });
});

describe("buildDropOptions", () => {
  it("names the emptiest seats first, cheapest at the top", () => {
    const a = lineupPlayer("a");
    const b = lineupPlayer("b");
    const c = lineupPlayer("c");
    const result = buildDropOptions({
      benchable: [a, b, c],
      restOfSeasonPerWeek: new Map([
        ["a", 6],
        ["b", 1.2],
        ["c", 9],
      ]),
      valueBySleeperId: new Map(),
      isKeeperLeague: false,
      seatedSleeperIds: new Set(),
    });
    expect(result.options.map((o) => o.player.sleeperId)).toEqual(["b", "a", "c"]);
    expect(result.note).toBeNull();
  });

  it("puts a player with no projection left at the very top, without calling it zero", () => {
    const result = buildDropOptions({
      benchable: [lineupPlayer("a"), lineupPlayer("b")],
      restOfSeasonPerWeek: new Map([["a", 3]]),
      valueBySleeperId: new Map(),
      isKeeperLeague: false,
      seatedSleeperIds: new Set(),
    });
    expect(result.options[0].player.sleeperId).toBe("b");
    expect(result.options[0].restOfSeasonPerWeek).toBeNull();
    expect(result.options[0].note).toContain("No projection left");
  });

  it("never offers somebody the optimiser is seating this week", () => {
    const result = buildDropOptions({
      benchable: [lineupPlayer("a"), lineupPlayer("b")],
      restOfSeasonPerWeek: new Map([
        ["a", 1],
        ["b", 2],
      ]),
      valueBySleeperId: new Map(),
      isKeeperLeague: false,
      seatedSleeperIds: new Set(["a"]),
    });
    expect(result.options.map((o) => o.player.sleeperId)).toEqual(["b"]);
  });

  it("refuses to name a valuable player in a dynasty league, and says why", () => {
    const result = buildDropOptions({
      benchable: [lineupPlayer("star")],
      restOfSeasonPerWeek: new Map([["star", 0.4]]),
      valueBySleeperId: new Map([["star", DYNASTY_KEEP_VALUE + 500]]),
      isKeeperLeague: true,
      seatedSleeperIds: new Set(),
    });
    expect(result.options).toEqual([]);
    expect(result.note).toContain("worth too much to give away");
    expect(result.note).toContain("star");
  });

  it("does name that same player in a redraft league, where a cut costs one season", () => {
    const result = buildDropOptions({
      benchable: [lineupPlayer("star")],
      restOfSeasonPerWeek: new Map([["star", 0.4]]),
      valueBySleeperId: new Map([["star", DYNASTY_KEEP_VALUE + 500]]),
      isKeeperLeague: false,
      seatedSleeperIds: new Set(),
    });
    expect(result.options).toHaveLength(1);
    expect(result.options[0].player.sleeperId).toBe("star");
  });

  it("says the roster has nothing to spare rather than returning an empty list silently", () => {
    const result = buildDropOptions({
      benchable: [lineupPlayer("a")],
      restOfSeasonPerWeek: new Map([["a", 10]]),
      valueBySleeperId: new Map(),
      isKeeperLeague: false,
      seatedSleeperIds: new Set(["a"]),
    });
    expect(result.options).toEqual([]);
    expect(result.note).toContain("Nothing to cut");
  });

  it("caps the list rather than printing the whole bench", () => {
    const benchable = Array.from({ length: 10 }, (_, i) => lineupPlayer(`p${i}`));
    const result = buildDropOptions({
      benchable,
      restOfSeasonPerWeek: new Map(benchable.map((p, i) => [p.sleeperId, i])),
      valueBySleeperId: new Map(),
      isKeeperLeague: false,
      seatedSleeperIds: new Set(),
    });
    expect(result.options).toHaveLength(4);
  });

  it("explains an injured reserve player as not taking a bench spot", () => {
    const ir = lineupPlayer("ir", { rosterSlot: "reserve", isInactive: true });
    const result = buildDropOptions({
      benchable: [ir],
      restOfSeasonPerWeek: new Map(),
      valueBySleeperId: new Map(),
      isKeeperLeague: false,
      seatedSleeperIds: new Set(),
    });
    expect(result.options[0].note).toContain("injured reserve");
  });
});

describe("buildWaiverSuggestions", () => {
  function candidate(
    sleeperId: string,
    pointsAdded: number,
    overallRank: number | null,
  ): WaiverCandidate {
    return {
      player: lineupPlayer(sleeperId),
      pointsAdded,
      slotLabel: pointsAdded > 0 ? "FLEX" : null,
      overallRank,
    };
  }

  it("ranks a contender on what helps this week", () => {
    const out = buildWaiverSuggestions(
      [candidate("helper", 4, 300), candidate("prospect", 0, 40)],
      CONTENDER,
    );
    expect(out[0].player.sleeperId).toBe("helper");
    expect(out[0].fit).toBe("start-now");
  });

  it("ranks a dynasty rebuilder on who is worth holding", () => {
    const out = buildWaiverSuggestions(
      [candidate("helper", 4, 300), candidate("prospect", 0, 40)],
      REBUILDER,
    );
    expect(out[0].player.sleeperId).toBe("prospect");
    expect(out[0].fit).toBe("upside");
  });

  it("still labels the start-now pickup honestly for a rebuilder", () => {
    const out = buildWaiverSuggestions(
      [candidate("helper", 4, 300), candidate("prospect", 0, 40)],
      REBUILDER,
    );
    const helper = out.find((s) => s.player.sleeperId === "helper");
    expect(helper?.fit).toBe("start-now");
    expect(helper?.note).toContain("rebuild is not usually won");
  });

  it("calls a non-starter bench cover in a redraft league, not a stash", () => {
    const out = buildWaiverSuggestions([candidate("depth", 0, 200)], REDRAFT_LONGSHOT);
    expect(out[0].fit).toBe("depth");
    expect(out[0].note).toContain("Bench cover");
  });

  it("does not promote a gain under the noise floor to a start-now pickup", () => {
    const out = buildWaiverSuggestions([candidate("marginal", 0.2, 200)], CONTENDER);
    expect(out[0].fit).not.toBe("start-now");
  });

  it("falls back to what helps this week when Power Pulse has not run", () => {
    const out = buildWaiverSuggestions(
      [candidate("helper", 4, 300), candidate("prospect", 0, 40)],
      null,
    );
    expect(out[0].player.sleeperId).toBe("helper");
  });

  it("sorts an unranked player last for a rebuilder rather than first", () => {
    const out = buildWaiverSuggestions(
      [candidate("unranked", 0, null), candidate("ranked", 0, 90)],
      REBUILDER,
    );
    expect(out[0].player.sleeperId).toBe("ranked");
  });

  it("caps the list", () => {
    const many = Array.from({ length: 12 }, (_, i) => candidate(`p${i}`, 12 - i, 100 + i));
    expect(buildWaiverSuggestions(many, CONTENDER)).toHaveLength(5);
  });
});

describe("goalBrief", () => {
  it("says a redraft league is always playing for this week", () => {
    expect(goalBrief(REDRAFT_LONGSHOT)).toContain("no next season in a redraft league");
  });

  it("says a dynasty rebuilder is ranked on who is worth holding", () => {
    expect(goalBrief(REBUILDER)).toContain("worth holding");
  });

  it("says a contender is ranked on points this week", () => {
    expect(goalBrief(CONTENDER)).toContain("this week");
  });

  it("names the missing model rather than inventing a goal", () => {
    expect(goalBrief(null)).toContain("Power Pulse has not run");
  });
});
