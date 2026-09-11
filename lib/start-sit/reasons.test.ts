import { describe, expect, it } from "vitest";
import {
  buildStartSitReasons,
  buildStartSitVerdictLine,
  MAX_START_SIT_REASONS,
  MIN_GRADED_WEEKS,
  type StartSitReasonInput,
} from "./reasons";
import type { StartSitCandidate, StartSitProjection } from "./types";

/* -------------------------------------------------------------------------- */
/* Fixture builders                                                           */
/* -------------------------------------------------------------------------- */

function candidate(overrides: Partial<StartSitCandidate> & { playerId: string; name: string }): StartSitCandidate {
  return {
    playerId: overrides.playerId,
    slug: overrides.slug ?? overrides.playerId,
    sleeperId: overrides.sleeperId ?? null,
    name: overrides.name,
    position: overrides.position ?? "RB",
    team: overrides.team ?? "ATL",
    injuryStatus: overrides.injuryStatus ?? null,
  };
}

function projection(playerId: string, overrides: Partial<StartSitProjection> = {}): StartSitProjection {
  return {
    playerId,
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

/** Two players, nothing populated. Every template must stay silent against this. */
function baseInput(): StartSitReasonInput {
  const a = candidate({ playerId: "a", name: "Bijan Robinson" });
  const b = candidate({ playerId: "b", name: "Josh Jacobs" });
  return {
    candidates: [a, b],
    projections: {
      a: projection("a"),
      b: projection("b"),
    },
    starters: ["a"],
    bench: ["b"],
    confidence: null,
    formatDisplay: "PPR",
  };
}

/** Everything a single template needs to fire, and nothing more, per template. */
function withMargin(input: StartSitReasonInput): StartSitReasonInput {
  return {
    ...input,
    projections: {
      ...input.projections,
      a: { ...input.projections.a, points: 20.4 },
      b: { ...input.projections.b, points: 18 },
    },
  };
}

function withMatchup(input: StartSitReasonInput): StartSitReasonInput {
  return {
    ...input,
    projections: {
      ...input.projections,
      a: { ...input.projections.a, defenseRankVsPosition: 4, opponent: "CAR" },
      b: { ...input.projections.b, defenseRankVsPosition: 18, opponent: "SEA" },
    },
  };
}

function withReliability(input: StartSitReasonInput): StartSitReasonInput {
  return {
    ...input,
    projections: {
      ...input.projections,
      a: { ...input.projections.a, beatRate: 0.75, weeksGraded: 8 },
      b: { ...input.projections.b, beatRate: 0.375, weeksGraded: 8 },
    },
  };
}

function withEnvironment(input: StartSitReasonInput): StartSitReasonInput {
  return {
    ...input,
    projections: {
      ...input.projections,
      a: {
        ...input.projections.a,
        environment: {
          team: "ATL",
          opponent: "CAR",
          isHome: true,
          gameTotal: 47,
          spread: -3,
          impliedTotal: 25,
          impliedRank: 5,
          rankedTeams: 32,
          kickoffAt: null,
          provider: "test",
        },
      },
      b: {
        ...input.projections.b,
        environment: {
          team: "LV",
          opponent: "SEA",
          isHome: false,
          gameTotal: 38,
          spread: 6,
          impliedTotal: 16,
          impliedRank: 30,
          rankedTeams: 32,
          kickoffAt: null,
          provider: "test",
        },
      },
    },
  };
}

function withFloor(input: StartSitReasonInput): StartSitReasonInput {
  return {
    ...input,
    confidence: 0.71,
    projections: {
      ...input.projections,
      a: { ...input.projections.a, floor: 12.1, ceiling: 28.7 },
      b: { ...input.projections.b, floor: 8.1, ceiling: 21.6 },
    },
  };
}

function withCeiling(input: StartSitReasonInput): StartSitReasonInput {
  return {
    ...input,
    confidence: 0.4,
    projections: {
      ...input.projections,
      a: { ...input.projections.a, floor: 12.1, ceiling: 28.7 },
      b: { ...input.projections.b, floor: 8.1, ceiling: 21.6 },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Each template, fired individually and stayed silent otherwise              */
/* -------------------------------------------------------------------------- */

describe("buildStartSitReasons", () => {
  it("fires nothing against a fully null board", () => {
    expect(buildStartSitReasons(baseInput())).toEqual([]);
  });

  it("projection margin fires only with both points present", () => {
    const fired = buildStartSitReasons(withMargin(baseInput()));
    expect(fired).toEqual(["Bijan Robinson projects 2.4 points clear of Josh Jacobs in PPR."]);

    const missingOne: StartSitReasonInput = {
      ...baseInput(),
      projections: { ...baseInput().projections, a: projection("a", { points: 20.4 }) },
    };
    expect(buildStartSitReasons(missingOne)).toEqual([]);
  });

  it("matchup fires only with both defense ranks present and names the better one", () => {
    const fired = buildStartSitReasons(withMatchup(baseInput()));
    expect(fired).toEqual([
      "Bijan Robinson has the better matchup: CAR allows the fourth-most points to running backs.",
    ]);

    const missingOne: StartSitReasonInput = {
      ...baseInput(),
      projections: {
        ...baseInput().projections,
        a: projection("a", { defenseRankVsPosition: 4, opponent: "CAR" }),
      },
    };
    expect(buildStartSitReasons(missingOne)).toEqual([]);
  });

  it("matchup reads rank 1 as 'the most', not 'the first-most'", () => {
    const input: StartSitReasonInput = {
      ...baseInput(),
      projections: {
        ...baseInput().projections,
        a: projection("a", { defenseRankVsPosition: 1, opponent: "CAR" }),
        b: projection("b", { defenseRankVsPosition: 20, opponent: "SEA" }),
      },
    };
    expect(buildStartSitReasons(input)[0]).toBe(
      "Bijan Robinson has the better matchup: CAR allows the most points to running backs.",
    );
  });

  it("matchup reads a rank beyond 10 as a numeric ordinal", () => {
    const input: StartSitReasonInput = {
      ...baseInput(),
      projections: {
        ...baseInput().projections,
        a: projection("a", { defenseRankVsPosition: 12, opponent: "CAR" }),
        b: projection("b", { defenseRankVsPosition: 25, opponent: "SEA" }),
      },
    };
    expect(buildStartSitReasons(input)[0]).toBe(
      "Bijan Robinson has the better matchup: CAR allows the 12th-most points to running backs.",
    );
  });

  it("matchup stays silent on a tied rank", () => {
    const input: StartSitReasonInput = {
      ...baseInput(),
      projections: {
        ...baseInput().projections,
        a: projection("a", { defenseRankVsPosition: 10, opponent: "CAR" }),
        b: projection("b", { defenseRankVsPosition: 10, opponent: "SEA" }),
      },
    };
    expect(buildStartSitReasons(input)).toEqual([]);
  });

  it("reliability fires only when both sides clear MIN_GRADED_WEEKS", () => {
    const fired = buildStartSitReasons(withReliability(baseInput()));
    expect(fired).toEqual([
      "Bijan Robinson has beaten the projection in 6 of 8 graded weeks; Josh Jacobs in 3 of 8.",
    ]);

    const underThreshold: StartSitReasonInput = {
      ...baseInput(),
      projections: {
        ...baseInput().projections,
        a: projection("a", { beatRate: 0.75, weeksGraded: MIN_GRADED_WEEKS - 1 }),
        b: projection("b", { beatRate: 0.5, weeksGraded: 8 }),
      },
    };
    expect(buildStartSitReasons(underThreshold)).toEqual([]);
  });

  it("environment fires only when every candidate on the board has an implied total", () => {
    const fired = buildStartSitReasons(withEnvironment(baseInput()));
    expect(fired).toEqual(["Josh Jacobs's game has the lowest implied total of the 2, at 16.0."]);

    const oneMissing: StartSitReasonInput = {
      ...baseInput(),
      projections: {
        ...baseInput().projections,
        a: withEnvironment(baseInput()).projections.a,
      },
    };
    expect(buildStartSitReasons(oneMissing)).toEqual([]);
  });

  it("floor fires when the confidence favours the last starter", () => {
    const fired = buildStartSitReasons(withFloor(baseInput()));
    expect(fired).toEqual(["If you need a safe floor, Bijan Robinson's is 12.1 points to Josh Jacobs's 8.1."]);
  });

  it("ceiling fires instead of floor when the confidence favours the bench player", () => {
    const fired = buildStartSitReasons(withCeiling(baseInput()));
    expect(fired).toEqual([
      "If you're chasing upside, Bijan Robinson's ceiling is 28.7 points to Josh Jacobs's 21.6.",
    ]);
  });

  it("floor and ceiling stay silent with no confidence figure", () => {
    const input: StartSitReasonInput = {
      ...baseInput(),
      confidence: null,
      projections: {
        ...baseInput().projections,
        a: projection("a", { floor: 12.1, ceiling: 28.7 }),
        b: projection("b", { floor: 8.1, ceiling: 21.6 }),
      },
    };
    expect(buildStartSitReasons(input)).toEqual([]);
  });

  it("a bye fires its own sentence and takes priority over an injury note on the same candidate", () => {
    const input: StartSitReasonInput = {
      ...baseInput(),
      candidates: [
        candidate({ playerId: "a", name: "Bijan Robinson" }),
        candidate({ playerId: "b", name: "Josh Jacobs", injuryStatus: "Questionable" }),
      ],
      projections: {
        a: projection("a"),
        b: projection("b", { onBye: true }),
      },
    };
    expect(buildStartSitReasons(input)).toEqual(["Josh Jacobs is on bye."]);
  });

  it("an injury fires its own sentence when there is no bye", () => {
    const input: StartSitReasonInput = {
      ...baseInput(),
      candidates: [
        candidate({ playerId: "a", name: "Bijan Robinson" }),
        candidate({ playerId: "b", name: "Josh Jacobs", injuryStatus: "Questionable" }),
      ],
    };
    expect(buildStartSitReasons(input)).toEqual(["Josh Jacobs is listed Questionable."]);
  });

  it("the mixed-position note fires only when the board holds more than one position", () => {
    const mixed: StartSitReasonInput = {
      ...baseInput(),
      candidates: [
        candidate({ playerId: "a", name: "Bijan Robinson", position: "RB" }),
        candidate({ playerId: "b", name: "Josh Jacobs", position: "WR" }),
      ],
    };
    expect(buildStartSitReasons(mixed)).toEqual([
      "Points are compared directly across positions here; a flex slot is the usual reason to do that.",
    ]);

    const samePosition: StartSitReasonInput = {
      ...baseInput(),
      candidates: [
        candidate({ playerId: "a", name: "Bijan Robinson", position: "RB" }),
        candidate({ playerId: "b", name: "Josh Jacobs", position: "RB" }),
      ],
    };
    expect(buildStartSitReasons(samePosition)).toEqual([]);
  });

  /* -------------------------------------------------------------------------- */
  /* Priority order and the cap                                                 */
  /* -------------------------------------------------------------------------- */

  it("orders every firing template by priority and caps the list at MAX_START_SIT_REASONS", () => {
    // Three players so a bye reason is available as a sixth candidate, past
    // the cap of five: margin, matchup, reliability, environment and floor
    // all fire on the borderline pair (a, b), and c is on bye.
    let input = baseInput();
    input = withMargin(input);
    input = withMatchup(input);
    input = withReliability(input);
    input = withEnvironment(input);
    input = withFloor(input);
    input.candidates = [...input.candidates, candidate({ playerId: "c", name: "Alvin Kamara" })];
    input.projections = { ...input.projections, c: projection("c", { onBye: true }) };
    input.bench = ["b", "c"];

    const fired = buildStartSitReasons(input);
    expect(fired).toHaveLength(MAX_START_SIT_REASONS);
    expect(fired).toEqual([
      "Bijan Robinson projects 2.4 points clear of Josh Jacobs in PPR.",
      "Bijan Robinson has the better matchup: CAR allows the fourth-most points to running backs.",
      "Bijan Robinson has beaten the projection in 6 of 8 graded weeks; Josh Jacobs in 3 of 8.",
      "If you need a safe floor, Bijan Robinson's is 12.1 points to Josh Jacobs's 8.1.",
      "Alvin Kamara is on bye.",
    ]);
    // Environment needs every candidate on the board priced, and Kamara's
    // implied total was never supplied here, so it never reaches the cap.
    expect(fired.join(" ")).not.toContain("implied total");
  });
});

/* -------------------------------------------------------------------------- */
/* The verdict line                                                           */
/* -------------------------------------------------------------------------- */

describe("buildStartSitVerdictLine", () => {
  it("K = 1: states the margin and the confidence together, exactly as section 2.5's example", () => {
    const input = withFloor(withMargin(baseInput()));
    expect(buildStartSitVerdictLine(input)).toBe(
      "Start Bijan Robinson. Robinson projects 2.4 points clear of Josh Jacobs in PPR, 71 percent to outscore Jacobs.",
    );
  });

  it("K = 1: states only the margin when confidence is null", () => {
    const input = withMargin(baseInput());
    expect(buildStartSitVerdictLine(input)).toBe(
      "Start Bijan Robinson. Robinson projects 2.4 points clear of Josh Jacobs in PPR.",
    );
  });

  it("K = 1: states only the confidence when the margin is null", () => {
    const input: StartSitReasonInput = { ...baseInput(), confidence: 0.71 };
    expect(buildStartSitVerdictLine(input)).toBe(
      "Start Bijan Robinson. Robinson is 71 percent to outscore Josh Jacobs.",
    );
  });

  it("K = 1: is just the start clause when nothing else is measurable", () => {
    expect(buildStartSitVerdictLine(baseInput())).toBe("Start Bijan Robinson.");
  });

  it("K greater than 1: names every starter and adds the close-call clause when confidence exists", () => {
    const input: StartSitReasonInput = {
      candidates: [
        candidate({ playerId: "a", name: "Bijan Robinson" }),
        candidate({ playerId: "b", name: "Josh Jacobs" }),
        candidate({ playerId: "c", name: "Alvin Kamara" }),
      ],
      projections: {
        a: projection("a"),
        b: projection("b"),
        c: projection("c"),
      },
      starters: ["a", "b"],
      bench: ["c"],
      confidence: 0.55,
      formatDisplay: "PPR",
    };
    expect(buildStartSitVerdictLine(input)).toBe(
      "Start Bijan Robinson and Josh Jacobs. The last spot is close: Jacobs is 55 percent to outscore Alvin Kamara.",
    );
  });

  it("K greater than 1: omits the close-call clause when confidence is null", () => {
    const input: StartSitReasonInput = {
      candidates: [
        candidate({ playerId: "a", name: "Bijan Robinson" }),
        candidate({ playerId: "b", name: "Josh Jacobs" }),
        candidate({ playerId: "c", name: "Alvin Kamara" }),
      ],
      projections: { a: projection("a"), b: projection("b"), c: projection("c") },
      starters: ["a", "b"],
      bench: ["c"],
      confidence: null,
      formatDisplay: "PPR",
    };
    expect(buildStartSitVerdictLine(input)).toBe("Start Bijan Robinson and Josh Jacobs.");
  });

  it("returns an empty string with no starters", () => {
    const input: StartSitReasonInput = { ...baseInput(), starters: [] };
    expect(buildStartSitVerdictLine(input)).toBe("");
  });
});

/* -------------------------------------------------------------------------- */
/* Cross-cutting: banned characters and the pronoun ban, across every string   */
/* -------------------------------------------------------------------------- */

describe("plain ASCII and no pronouns", () => {
  const banned = [
    "—", // em dash
    "–", // en dash
    "“", // left curly double quote
    "”", // right curly double quote
    "‘", // left curly single quote
    "’", // right curly single quote
    "…", // ellipsis character
    "·", // middle dot
    " ", // non-breaking space
  ];

  function pronounWords(text: string): string[] {
    const found: string[] = [];
    for (const word of ["he", "his", "him"]) {
      const re = new RegExp(`\\b${word}\\b`, "i");
      if (re.test(text)) found.push(word);
    }
    return found;
  }

  it("sweeps every template and both verdict-line shapes for banned characters and he/his/him", () => {
    let manyReasons = baseInput();
    manyReasons = withMargin(manyReasons);
    manyReasons = withMatchup(manyReasons);
    manyReasons = withReliability(manyReasons);
    manyReasons = withEnvironment(manyReasons);
    manyReasons = withFloor(manyReasons);
    manyReasons.candidates = [
      ...manyReasons.candidates,
      candidate({ playerId: "c", name: "Alvin Kamara", injuryStatus: "Questionable", position: "WR" }),
    ];
    manyReasons.projections = { ...manyReasons.projections, c: projection("c") };
    manyReasons.bench = ["b", "c"];

    const texts = [
      ...buildStartSitReasons(manyReasons),
      buildStartSitVerdictLine(manyReasons),
      buildStartSitVerdictLine({ ...manyReasons, starters: ["a", "b"], bench: ["c"] }),
      buildStartSitVerdictLine(withCeiling(baseInput())),
    ];

    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      for (const char of banned) {
        expect(text.includes(char)).toBe(false);
      }
      expect(pronounWords(text)).toEqual([]);
    }
  });
});
