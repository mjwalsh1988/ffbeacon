import { describe, it, expect } from "vitest";
import {
  buildTradeCaveats,
  buildTradeReasons,
  REASON_THRESHOLDS,
  type ReasonInput,
} from "./reasons";
import type {
  ImpactGaps,
  ResolvedAsset,
  TeamImpact,
  TradeReason,
  TradeReasonKind,
  WeekImpact,
} from "./types";

const WEEKS = [10, 11, 12, 13];

function playerAsset(playerId: string, name: string, value: number): ResolvedAsset {
  return {
    kind: "player",
    playerId,
    sleeperId: playerId,
    name,
    position: "RB",
    team: "BUF",
    value,
    age: 25,
    projPoints: 14,
    isInactive: false,
  };
}

function pickAsset(season: number, round: number, label: string): ResolvedAsset {
  return {
    kind: "pick",
    key: `${season}-${round}-mid`,
    label,
    season,
    round,
    pickPosition: "mid",
    value: 1200,
  };
}

function weekImpacts(overrides: Partial<WeekImpact>[] = []): WeekImpact[] {
  return WEEKS.map((week, i) => ({
    week,
    opponentRosterId: 2,
    opponentName: "Rival",
    beforeMean: 100,
    afterMean: 100,
    delta: 0,
    winProbBefore: 0.5,
    winProbAfter: 0.5,
    ...(overrides[i] ?? {}),
  }));
}

function team(overrides: Partial<TeamImpact> = {}): TeamImpact {
  return {
    rosterId: 1,
    teamName: "My Team",
    statusLabel: null,
    pulseRank: null,
    valueBefore: 20000,
    valueAfter: 20000,
    valueDelta: 0,
    ageDelta: null,
    pickCountDelta: 0,
    lineupBefore: 100,
    lineupAfter: 100,
    lineupDelta: 0,
    weeks: weekImpacts(),
    weeksImproved: 0,
    weeksWorsened: 0,
    incomingStartWeeks: {},
    projectedWinsBefore: null,
    projectedWinsAfter: null,
    playoffOddsBefore: null,
    playoffOddsAfter: null,
    titleOddsBefore: null,
    titleOddsAfter: null,
    positionBefore: {},
    positionAfter: {},
    incoming: [],
    outgoing: [],
    ...overrides,
  };
}

const NO_GAPS: ImpactGaps = { lineup: false, simulation: false, picks: false };

function baseInput(overrides: Partial<ReasonInput> = {}): ReasonInput {
  return {
    mine: team(),
    theirs: team({ rosterId: 2, teamName: "Rival" }),
    gaps: NO_GAPS,
    weeksConsidered: WEEKS.length,
    isDynasty: true,
    grade: null,
    weakestSlot: null,
    depthCost: null,
    ...overrides,
  };
}

function kinds(reasons: TradeReason[]): TradeReasonKind[] {
  return reasons.map((r) => r.kind);
}

function find(reasons: TradeReason[], kind: TradeReasonKind): TradeReason | undefined {
  return reasons.find((r) => r.kind === kind);
}

describe("buildTradeReasons: lineup", () => {
  it("fires lineup-gain above the noise floor", () => {
    const reasons = buildTradeReasons(baseInput({ mine: team({ lineupDelta: 4.3 }) }));
    const reason = find(reasons, "lineup-gain");
    expect(reason?.detail).toBe(
      "Your starting lineup gains 4.3 points a week over your 4 remaining weeks.",
    );
    expect(reason?.tone).toBe("good");
    expect(kinds(reasons)).not.toContain("lineup-loss");
  });

  it("fires lineup-loss below the negative floor", () => {
    const reasons = buildTradeReasons(baseInput({ mine: team({ lineupDelta: -2.1 }) }));
    expect(find(reasons, "lineup-loss")?.detail).toBe(
      "Your starting lineup loses 2.1 points a week over your 4 remaining weeks.",
    );
    expect(find(reasons, "lineup-loss")?.tone).toBe("bad");
  });

  it("fires lineup-flat inside the noise floor", () => {
    const reasons = buildTradeReasons(baseInput({ mine: team({ lineupDelta: 0.2 }) }));
    expect(find(reasons, "lineup-flat")?.tone).toBe("neutral");
    expect(kinds(reasons)).not.toContain("lineup-gain");
  });

  it("produces no lineup reason and no odds reason when lineupDelta is null", () => {
    const reasons = buildTradeReasons(
      baseInput({
        gaps: { ...NO_GAPS, lineup: true },
        mine: team({
          lineupDelta: null,
          lineupBefore: null,
          lineupAfter: null,
          projectedWinsBefore: 6.4,
          projectedWinsAfter: 7.1,
          playoffOddsBefore: 0.41,
          playoffOddsAfter: 0.58,
        }),
      }),
    );
    expect(kinds(reasons)).not.toContain("lineup-gain");
    expect(kinds(reasons)).not.toContain("lineup-loss");
    expect(kinds(reasons)).not.toContain("lineup-flat");
    expect(kinds(reasons)).not.toContain("odds");
  });
});

describe("buildTradeReasons: starts", () => {
  it("fires starts-often for a player who plays most weeks", () => {
    const reasons = buildTradeReasons(
      baseInput({
        mine: team({
          incoming: [playerAsset("p1", "Chase", 8000)],
          incomingStartWeeks: { p1: 4 },
        }),
      }),
    );
    expect(find(reasons, "starts-often")?.detail).toBe(
      "Chase starts for you in 4 of your 4 remaining weeks.",
    );
    expect(kinds(reasons)).not.toContain("starts-rarely");
  });

  it("fires starts-rarely for a player who barely plays", () => {
    const reasons = buildTradeReasons(
      baseInput({
        mine: team({
          incoming: [playerAsset("p1", "Chase", 8000)],
          incomingStartWeeks: { p1: 1 },
        }),
      }),
    );
    expect(find(reasons, "starts-rarely")?.detail).toContain(
      "Chase only cracks your lineup in 1 of 4",
    );
    expect(kinds(reasons)).not.toContain("starts-often");
  });

  it("stays silent when no incoming player has a projection", () => {
    const reasons = buildTradeReasons(
      baseInput({
        mine: team({ incoming: [playerAsset("p1", "Chase", 8000)] }),
      }),
    );
    expect(kinds(reasons)).not.toContain("starts-often");
    expect(kinds(reasons)).not.toContain("starts-rarely");
  });

  it("can fire both for a two-player deal, once per player", () => {
    const reasons = buildTradeReasons(
      baseInput({
        mine: team({
          incoming: [playerAsset("p1", "Chase", 8000), playerAsset("p2", "Pierce", 900)],
          incomingStartWeeks: { p1: 4, p2: 0 },
        }),
      }),
    );
    expect(find(reasons, "starts-often")?.detail).toContain("Chase");
    expect(find(reasons, "starts-rarely")?.detail).toContain("Pierce");
  });
});

describe("buildTradeReasons: swings and timing", () => {
  it("fires swings-weeks when matchups cross the coin-flip line", () => {
    const reasons = buildTradeReasons(
      baseInput({
        mine: team({
          lineupDelta: 3,
          weeks: weekImpacts([
            { winProbBefore: 0.42, winProbAfter: 0.55 },
            {},
            { winProbBefore: 0.4, winProbAfter: 0.61 },
            {},
          ]),
        }),
      }),
    );
    const reason = find(reasons, "swings-weeks");
    expect(reason?.detail).toBe(
      "It turns 2 projected losses into coin flips, in weeks 10 and 12.",
    );
    expect(reason?.tone).toBe("good");
  });

  it("stays silent when no matchup crosses", () => {
    const reasons = buildTradeReasons(baseInput({ mine: team({ lineupDelta: 3 }) }));
    expect(kinds(reasons)).not.toContain("swings-weeks");
  });

  it("reads as a cost when the crossings go the other way", () => {
    const reasons = buildTradeReasons(
      baseInput({
        mine: team({
          lineupDelta: -3,
          weeks: weekImpacts([{ winProbBefore: 0.62, winProbAfter: 0.4 }, {}, {}, {}]),
        }),
      }),
    );
    expect(find(reasons, "swings-weeks")?.tone).toBe("bad");
    expect(find(reasons, "swings-weeks")?.detail).toBe(
      "It costs you the edge in week 10.",
    );
  });

  it("fires schedule-timing when the gains are concentrated", () => {
    const reasons = buildTradeReasons(
      baseInput({
        mine: team({
          lineupDelta: 2,
          weeks: weekImpacts([
            { delta: 6.2, opponentName: "Sharks" },
            { delta: 0 },
            { delta: 5.8, opponentName: "Wolves" },
            { delta: 0 },
          ]),
        }),
      }),
    );
    expect(find(reasons, "schedule-timing")?.detail).toBe(
      "The biggest gains land in week 10, plus 6.2 points against Sharks, and week 12, plus 5.8 points against Wolves.",
    );
  });

  it("stays silent on schedule-timing when every week gains the same", () => {
    const reasons = buildTradeReasons(
      baseInput({
        mine: team({
          lineupDelta: 3,
          weeks: weekImpacts([{ delta: 3 }, { delta: 3 }, { delta: 3 }, { delta: 3 }]),
        }),
      }),
    );
    expect(kinds(reasons)).not.toContain("schedule-timing");
  });
});

describe("buildTradeReasons: odds", () => {
  it("fires with wins and playoff odds when the simulation ran", () => {
    const reasons = buildTradeReasons(
      baseInput({
        mine: team({
          lineupDelta: 3,
          projectedWinsBefore: 6.4,
          projectedWinsAfter: 7.1,
          playoffOddsBefore: 0.41,
          playoffOddsAfter: 0.58,
        }),
      }),
    );
    expect(find(reasons, "odds")?.detail).toBe(
      "Projected wins go from 6.4 to 7.1. Playoff odds go from 41 percent to 58 percent.",
    );
  });

  it("stays silent when the league has no remaining games", () => {
    const reasons = buildTradeReasons(
      baseInput({
        gaps: { ...NO_GAPS, simulation: true },
        mine: team({
          lineupDelta: 3,
          playoffOddsBefore: 0.41,
          playoffOddsAfter: 0.58,
        }),
      }),
    );
    expect(kinds(reasons)).not.toContain("odds");
  });

  it("sorts directly after the lineup reason", () => {
    const reasons = buildTradeReasons(
      baseInput({
        mine: team({
          lineupDelta: -3,
          valueDelta: 3000,
          valueBefore: 20000,
          playoffOddsBefore: 0.41,
          playoffOddsAfter: 0.3,
        }),
      }),
    );
    const list = kinds(reasons);
    expect(list.indexOf("odds")).toBe(list.indexOf("lineup-loss") + 1);
  });
});

describe("buildTradeReasons: value, age, picks", () => {
  it("fires value-gain past the share threshold", () => {
    const reasons = buildTradeReasons(
      baseInput({ mine: team({ valueBefore: 20000, valueDelta: 1240 }) }),
    );
    expect(find(reasons, "value-gain")?.detail).toBe(
      "You come out 1,240 points of trade value ahead, about 6 percent of your roster.",
    );
  });

  it("fires value-loss past the share threshold", () => {
    const reasons = buildTradeReasons(
      baseInput({ mine: team({ valueBefore: 20000, valueDelta: -1240 }) }),
    );
    expect(find(reasons, "value-loss")?.tone).toBe("bad");
    expect(find(reasons, "value-loss")?.detail).toContain("You give up 1,240 points");
  });

  it("stays silent inside the value noise floor", () => {
    const reasons = buildTradeReasons(
      baseInput({ mine: team({ valueBefore: 20000, valueDelta: 200 }) }),
    );
    expect(kinds(reasons)).not.toContain("value-gain");
    expect(kinds(reasons)).not.toContain("value-loss");
  });

  it("fires younger and older only in dynasty", () => {
    const younger = buildTradeReasons(baseInput({ mine: team({ ageDelta: -1.4 }) }));
    // The sentence names what was actually measured. `ageDelta` compares the two
    // PACKAGES, not the two rosters, and the first version of this copy said
    // "your roster gets 1.4 years younger", which is arithmetic no single trade
    // does to a thirty man roster. A reader who notices stops believing the rest
    // of the card, so the wording is asserted here rather than left to drift.
    expect(find(younger, "younger")?.detail).toBe(
      "What you receive is 1.4 years younger than what you send, weighted by value.",
    );
    expect(find(younger, "younger")?.detail).not.toContain("your roster");

    const older = buildTradeReasons(baseInput({ mine: team({ ageDelta: 1.4 }) }));
    expect(find(older, "older")?.tone).toBe("bad");

    const redraft = buildTradeReasons(
      baseInput({ isDynasty: false, mine: team({ ageDelta: -1.4 }) }),
    );
    expect(kinds(redraft)).not.toContain("younger");
  });

  it("stays silent on age inside the noise floor", () => {
    const reasons = buildTradeReasons(baseInput({ mine: team({ ageDelta: -0.1 }) }));
    expect(kinds(reasons)).not.toContain("younger");
    expect(kinds(reasons)).not.toContain("older");
  });

  it("names the picks on both sides", () => {
    const reasons = buildTradeReasons(
      baseInput({
        mine: team({
          incoming: [pickAsset(2027, 1, "2027 1st"), pickAsset(2027, 3, "2027 3rd")],
          outgoing: [pickAsset(2026, 2, "2026 2nd")],
          pickCountDelta: 1,
        }),
      }),
    );
    expect(find(reasons, "picks-in")?.detail).toBe("You add 2027 1st and 2027 3rd.");
    expect(find(reasons, "picks-out")?.detail).toBe("You send 2026 2nd.");
    expect(find(reasons, "picks-out")?.tone).toBe("bad");
  });

  it("stays silent on picks when no pick values are published", () => {
    const reasons = buildTradeReasons(
      baseInput({
        gaps: { ...NO_GAPS, picks: true },
        mine: team({
          incoming: [pickAsset(2027, 1, "2027 1st")],
          pickCountDelta: 1,
        }),
      }),
    );
    expect(kinds(reasons)).not.toContain("picks-in");
  });
});

describe("buildTradeReasons: depth, holes, direction, grade", () => {
  it("fires depth-cost with the next-man-up gap", () => {
    const reasons = buildTradeReasons(
      baseInput({ depthCost: { position: "running back", gap: 6.1 } }),
    );
    expect(find(reasons, "depth-cost")?.detail).toBe(
      "It thins your running back. Your next man up projects 6.1 points a week below the running back you are sending.",
    );
    expect(find(reasons, "depth-cost")?.tone).toBe("bad");
  });

  it("stays silent on depth-cost inside the noise floor", () => {
    const reasons = buildTradeReasons(
      baseInput({ depthCost: { position: "running back", gap: 0.2 } }),
    );
    expect(kinds(reasons)).not.toContain("depth-cost");
  });

  it("fires fills-hole when the weakest slot improves", () => {
    const reasons = buildTradeReasons(
      baseInput({ weakestSlot: { label: "FLEX", before: 8.2, after: 13.9 } }),
    );
    expect(find(reasons, "fills-hole")?.detail).toBe(
      "It fixes your weakest starting slot. Your FLEX goes from 8.2 to 13.9 points a week.",
    );
  });

  it("stays silent on fills-hole when the slot does not improve", () => {
    const reasons = buildTradeReasons(
      baseInput({ weakestSlot: { label: "FLEX", before: 8.2, after: 8.3 } }),
    );
    expect(kinds(reasons)).not.toContain("fills-hole");
  });

  it("fires direction-fit for a competitor whose lineup improves", () => {
    const reasons = buildTradeReasons(
      baseInput({
        mine: team({
          statusLabel: "Competitor",
          pulseRank: 2,
          lineupDelta: 3.4,
        }),
      }),
    );
    expect(find(reasons, "direction-fit")?.detail).toContain(
      "You are ranked 2nd by Power Pulse",
    );
    expect(kinds(reasons)).not.toContain("direction-clash");
  });

  it("fires direction-clash for a competitor whose lineup drops", () => {
    const reasons = buildTradeReasons(
      baseInput({
        mine: team({
          statusLabel: "Competitor",
          pulseRank: 2,
          lineupDelta: -2.1,
        }),
      }),
    );
    expect(find(reasons, "direction-clash")?.detail).toBe(
      "You are ranked 2nd by Power Pulse, and this deal costs you 2.1 points a week. That is the wrong direction for a team trying to win now.",
    );
    expect(kinds(reasons)).not.toContain("direction-fit");
  });

  it("fires direction-fit for a rebuilder gaining value", () => {
    const reasons = buildTradeReasons(
      baseInput({
        mine: team({
          statusLabel: "Rebuilder",
          pulseRank: 9,
          valueBefore: 20000,
          valueDelta: 2400,
          lineupDelta: -1.5,
        }),
      }),
    );
    expect(find(reasons, "direction-fit")?.detail).toContain(
      "which is the trade a rebuilding team wants",
    );
  });

  it("gives a mid-tier team no direction reason", () => {
    const reasons = buildTradeReasons(
      baseInput({
        mine: team({ statusLabel: "Mid Tier", pulseRank: 6, lineupDelta: 4 }),
      }),
    );
    expect(kinds(reasons)).not.toContain("direction-fit");
    expect(kinds(reasons)).not.toContain("direction-clash");
  });

  it("quotes the Signal Check verdict", () => {
    const reasons = buildTradeReasons(
      baseInput({
        grade: {
          verdictLabel: "Even trade",
          favours: "neither",
          confidenceLabel: "High",
          tradeShapeLabel: null,
          explanation: "The two sides land within the even band.",
          formatDisplay: "Dynasty Superflex",
        },
      }),
    );
    expect(find(reasons, "grade")?.detail).toBe(
      "On Dynasty Superflex values, Signal Check returns Even trade.",
    );
    expect(find(reasons, "grade")?.tone).toBe("neutral");
  });

  it("stays silent on grade when Signal Check returned nothing", () => {
    expect(kinds(buildTradeReasons(baseInput()))).not.toContain("grade");
  });
});

describe("buildTradeReasons: their side and ordering", () => {
  it("always ends with their-side", () => {
    const reasons = buildTradeReasons(baseInput());
    expect(reasons[reasons.length - 1].kind).toBe("their-side");
    expect(kinds(reasons).filter((k) => k === "their-side")).toHaveLength(1);
  });

  it("says what the other team gets", () => {
    const reasons = buildTradeReasons(
      baseInput({
        theirs: team({
          rosterId: 2,
          teamName: "Rival",
          valueDelta: 900,
          lineupDelta: -1.8,
        }),
      }),
    );
    expect(find(reasons, "their-side")?.detail).toBe(
      "For Rival it is plus 900 points of value and minus 1.8 points a week in their lineup, which is why they might say yes.",
    );
  });

  it("does not pretend they benefit when they do not", () => {
    const reasons = buildTradeReasons(
      baseInput({
        theirs: team({
          rosterId: 2,
          teamName: "Rival",
          valueDelta: -900,
          lineupDelta: -1.8,
        }),
      }),
    );
    expect(find(reasons, "their-side")?.detail).toContain(
      "so you will need a reason for them to take it",
    );
  });

  it("orders good, then neutral, then bad, with their-side last", () => {
    const reasons = buildTradeReasons(
      baseInput({
        mine: team({
          lineupDelta: 4.3,
          valueBefore: 20000,
          valueDelta: -2400,
          ageDelta: 1.4,
          incoming: [playerAsset("p1", "Chase", 8000)],
          incomingStartWeeks: { p1: 4 },
        }),
        depthCost: { position: "running back", gap: 6.1 },
      }),
    );
    const rank = { good: 0, neutral: 1, bad: 2 } as const;
    const body = reasons.slice(0, -1).filter((r) => r.kind !== "odds");
    for (let i = 1; i < body.length; i += 1) {
      expect(rank[body[i].tone]).toBeGreaterThanOrEqual(rank[body[i - 1].tone]);
    }
    expect(reasons[reasons.length - 1].kind).toBe("their-side");
  });

  it("never drops a cost reason to make room for the good news", () => {
    const reasons = buildTradeReasons(
      baseInput({
        mine: team({
          lineupDelta: 4.3,
          valueBefore: 20000,
          valueDelta: -2400,
          ageDelta: 1.4,
          statusLabel: "Rebuilder",
          pulseRank: 11,
          outgoing: [pickAsset(2027, 1, "2027 1st")],
          pickCountDelta: -1,
        }),
        depthCost: { position: "running back", gap: 6.1 },
      }),
    );
    const list = kinds(reasons);
    for (const kind of [
      "value-loss",
      "older",
      "picks-out",
      "depth-cost",
      "direction-clash",
    ] as TradeReasonKind[]) {
      expect(list).toContain(kind);
    }
  });
});

describe("buildTradeReasons: every kind is reachable and clean", () => {
  /** One fixture per kind, each built to trip exactly that trigger. */
  const fixtures: { kind: TradeReasonKind; input: ReasonInput }[] = [
    {
      kind: "lineup-gain",
      input: baseInput({ mine: team({ lineupDelta: 4.3 }) }),
    },
    {
      kind: "lineup-loss",
      input: baseInput({ mine: team({ lineupDelta: -4.3 }) }),
    },
    {
      kind: "lineup-flat",
      input: baseInput({ mine: team({ lineupDelta: 0.1 }) }),
    },
    {
      kind: "starts-often",
      input: baseInput({
        mine: team({
          incoming: [playerAsset("p1", "Chase", 8000)],
          incomingStartWeeks: { p1: 4 },
        }),
      }),
    },
    {
      kind: "starts-rarely",
      input: baseInput({
        mine: team({
          incoming: [playerAsset("p1", "Chase", 8000)],
          incomingStartWeeks: { p1: 0 },
        }),
      }),
    },
    {
      kind: "swings-weeks",
      input: baseInput({
        mine: team({
          lineupDelta: 3,
          weeks: weekImpacts([{ winProbBefore: 0.42, winProbAfter: 0.55 }, {}, {}, {}]),
        }),
      }),
    },
    {
      kind: "schedule-timing",
      input: baseInput({
        mine: team({
          lineupDelta: 2,
          weeks: weekImpacts([{ delta: 7 }, { delta: 0 }, { delta: 0 }, { delta: 0 }]),
        }),
      }),
    },
    {
      kind: "odds",
      input: baseInput({
        mine: team({
          lineupDelta: 3,
          projectedWinsBefore: 6.4,
          projectedWinsAfter: 7.1,
          playoffOddsBefore: 0.41,
          playoffOddsAfter: 0.58,
          titleOddsBefore: 0.04,
          titleOddsAfter: 0.11,
        }),
      }),
    },
    {
      kind: "value-gain",
      input: baseInput({
        mine: team({ valueBefore: 20000, valueDelta: 1240 }),
      }),
    },
    {
      kind: "value-loss",
      input: baseInput({
        mine: team({ valueBefore: 20000, valueDelta: -1240 }),
      }),
    },
    { kind: "younger", input: baseInput({ mine: team({ ageDelta: -1.4 }) }) },
    { kind: "older", input: baseInput({ mine: team({ ageDelta: 1.4 }) }) },
    {
      kind: "picks-in",
      input: baseInput({
        mine: team({ incoming: [pickAsset(2027, 1, "2027 1st")] }),
      }),
    },
    {
      kind: "picks-out",
      input: baseInput({
        mine: team({ outgoing: [pickAsset(2027, 1, "2027 1st")] }),
      }),
    },
    {
      kind: "depth-cost",
      input: baseInput({ depthCost: { position: "running back", gap: 6.1 } }),
    },
    {
      kind: "fills-hole",
      input: baseInput({
        weakestSlot: { label: "FLEX", before: 8.2, after: 13.9 },
      }),
    },
    {
      kind: "direction-fit",
      input: baseInput({
        mine: team({
          statusLabel: "Competitor",
          pulseRank: 2,
          lineupDelta: 3.4,
        }),
      }),
    },
    {
      kind: "direction-clash",
      input: baseInput({
        mine: team({
          statusLabel: "Competitor",
          pulseRank: 2,
          lineupDelta: -3.4,
        }),
      }),
    },
    {
      kind: "grade",
      input: baseInput({
        grade: {
          verdictLabel: "Slight edge to you",
          favours: "you",
          confidenceLabel: null,
          tradeShapeLabel: null,
          explanation: "",
          formatDisplay: "Dynasty Superflex",
        },
      }),
    },
    { kind: "their-side", input: baseInput() },
  ];

  for (const fixture of fixtures) {
    it(`reaches ${fixture.kind}`, () => {
      expect(kinds(buildTradeReasons(fixture.input))).toContain(fixture.kind);
    });
  }

  it("never emits undefined or NaN in any fixture", () => {
    for (const fixture of fixtures) {
      for (const reason of buildTradeReasons(fixture.input)) {
        expect(reason.label).not.toMatch(/undefined|NaN/);
        expect(reason.detail).not.toMatch(/undefined|NaN/);
        expect(reason.detail.length).toBeGreaterThan(0);
      }
    }
  });

  it("survives a completely empty impact without inventing anything", () => {
    const reasons = buildTradeReasons(
      baseInput({
        gaps: { lineup: true, simulation: true, picks: true },
        mine: team({ lineupDelta: null, valueBefore: 0, valueAfter: 0 }),
        theirs: team({ rosterId: 2, teamName: "Rival", lineupDelta: null }),
        weeksConsidered: 0,
      }),
    );
    expect(kinds(reasons)).toEqual(["their-side"]);
    expect(reasons[0].detail).not.toMatch(/undefined|NaN/);
  });
});

describe("REASON_THRESHOLDS", () => {
  it("keeps the often and rarely bands from overlapping", () => {
    expect(REASON_THRESHOLDS.startsRarelyPct).toBeLessThan(
      REASON_THRESHOLDS.startsOftenPct,
    );
    expect(REASON_THRESHOLDS.lineupNoise).toBeGreaterThan(0);
    expect(REASON_THRESHOLDS.valueNoisePct).toBeGreaterThan(0);
    expect(REASON_THRESHOLDS.ageNoise).toBeGreaterThan(0);
  });
});

describe("buildTradeCaveats", () => {
  function caveatInput(overrides: Partial<Parameters<typeof buildTradeCaveats>[0]> = {}) {
    return {
      ...baseInput(),
      unpricedNames: [],
      pickSourceDisplay: null,
      inactiveNames: [],
      ...overrides,
    };
  }

  it("returns nothing when there is nothing to say", () => {
    expect(buildTradeCaveats(caveatInput())).toEqual([]);
  });

  it("names players with no projection", () => {
    const out = buildTradeCaveats(caveatInput({ unpricedNames: ["Chase"] }));
    expect(out).toContain(
      "No projection published for Chase, so he is priced on value only.",
    );
  });

  it("trims a long unpriced list to three names plus a count", () => {
    const out = buildTradeCaveats(
      caveatInput({ unpricedNames: ["A", "B", "C", "D", "E"] }),
    );
    expect(out[0]).toContain("A, B, and C and 2 more");
  });

  it("says when the odds are unavailable", () => {
    const out = buildTradeCaveats(
      caveatInput({ gaps: { lineup: false, simulation: true, picks: false } }),
    );
    expect(out).toContain(
      "This league has no remaining games, so the odds figures are unavailable.",
    );
  });

  it("says when the whole lineup read is missing", () => {
    const out = buildTradeCaveats(
      caveatInput({ gaps: { lineup: true, simulation: false, picks: false } }),
    );
    expect(out[0]).toContain("measured on trade value alone");
  });

  it("flags an inactive player", () => {
    const out = buildTradeCaveats(caveatInput({ inactiveNames: ["Chase"] }));
    expect(out).toContain(
      "Chase is on IR or taxi and cannot start without a roster move.",
    );
  });

  it("names the pick source only when picks are in the deal", () => {
    const without = buildTradeCaveats(caveatInput({ pickSourceDisplay: "KTC" }));
    expect(without).toEqual([]);

    const withPicks = buildTradeCaveats(
      caveatInput({
        pickSourceDisplay: "KTC",
        mine: team({ incoming: [pickAsset(2027, 1, "2027 1st")] }),
      }),
    );
    expect(withPicks).toContain(
      "Pick values come from KTC. Your chosen source does not publish them.",
    );
  });

  it("says when picks in the deal have no published values", () => {
    const out = buildTradeCaveats(
      caveatInput({
        gaps: { lineup: false, simulation: false, picks: true },
        mine: team({ outgoing: [pickAsset(2027, 1, "2027 1st")] }),
      }),
    );
    expect(out[0]).toContain("No pick values are published for this league");
  });
});
