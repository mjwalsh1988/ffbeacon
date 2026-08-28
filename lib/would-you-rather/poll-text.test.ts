import { describe, expect, it } from "vitest";
import {
  buildPollAnswer,
  buildPollQuestion,
  compactLeagueFormat,
  POLL_ANSWER_MAX,
  POLL_QUESTION_MAX,
  type PollAsset,
} from "./poll-text";

function player(name: string): PollAsset {
  return { kind: "player", name };
}

function pick(
  season: number,
  round: number,
  slot: "early" | "mid" | "late" | null = null,
): PollAsset {
  return { kind: "pick", season, round, slot, label: `${season} round ${round}` };
}

/** The body of an answer, with the "A: " that ties it to the message removed. */
function body(assets: PollAsset[]): string {
  const answer = buildPollAnswer(assets, "a");
  if (!answer) throw new Error("expected an answer");
  return answer.text.replace(/^A: /, "");
}

describe("compactLeagueFormat", () => {
  const league = (settings: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    metadata: { settings, scoring_settings: { rec: 1 }, roster_positions: [] },
    total_rosters: 12,
    roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "BN", "BN"],
    ...over,
  });

  it("writes a dynasty superflex PPR league in short forms", () => {
    const out = compactLeagueFormat({
      metadata: {
        settings: { type: 2 },
        scoring_settings: { rec: 1 },
        roster_positions: ["QB", "SUPER_FLEX"],
      },
      total_rosters: 12,
      roster_positions: ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "BN"],
    });
    expect(out).toBe("Dynasty 12T SF PPR, start 6");
  });

  it("names TE premium when the league pays it", () => {
    const out = compactLeagueFormat({
      metadata: {
        settings: { type: 2 },
        scoring_settings: { rec: 1, bonus_rec_te: 0.5 },
        roster_positions: ["QB"],
      },
      total_rosters: 10,
      roster_positions: ["QB", "RB", "WR", "TE", "BN"],
    });
    expect(out).toBe("Dynasty 10T PPR TEP, start 4");
  });

  it("says nothing about superflex when a league is not superflex", () => {
    // "SF No" spends characters telling a reader what they already assume.
    const out = compactLeagueFormat(league({ type: 0 }, { roster_positions: ["QB", "RB", "BN"] }));
    expect(out).not.toContain("SF");
    expect(out).toContain("Redraft");
  });

  it("calls a keeper league keeper, not redraft", () => {
    // Keeper leagues PRICE as redraft, which is why the format resolver folds
    // them in. A keeper manager told "Redraft" would think it was another league.
    const out = compactLeagueFormat(league({ type: 1 }));
    expect(out.startsWith("Keeper ")).toBe(true);
  });

  it("marks a best ball room", () => {
    const out = compactLeagueFormat(league({ type: 2, best_ball: 1 }));
    expect(out.startsWith("BB Dynasty ")).toBe(true);
  });

  it("shortens half PPR and standard rather than dropping the scoring", () => {
    const half = compactLeagueFormat({
      metadata: { settings: { type: 0 }, scoring_settings: { rec: 0.5 }, roster_positions: [] },
      total_rosters: 12,
      roster_positions: ["QB", "RB"],
    });
    const std = compactLeagueFormat({
      metadata: { settings: { type: 0 }, scoring_settings: {}, roster_positions: [] },
      total_rosters: 12,
      roster_positions: ["QB", "RB"],
    });
    expect(half).toContain("Half PPR");
    expect(std).toContain("Std");
  });

  it("still says something when the league object was never stored", () => {
    expect(
      compactLeagueFormat({ metadata: null, total_rosters: null, roster_positions: null }),
    ).toBe("Fantasy football");
  });
});

describe("buildPollQuestion", () => {
  it("asks who wins, then the format", () => {
    expect(buildPollQuestion("Dynasty 12T SF PPR TEP, start 9")).toBe(
      "Who wins? Dynasty 12T SF PPR TEP, start 9",
    );
  });

  it("stays inside Discord's 300 characters", () => {
    const q = buildPollQuestion("x".repeat(400));
    expect(q.length).toBeLessThanOrEqual(POLL_QUESTION_MAX);
    expect(q.endsWith("...")).toBe(true);
  });
});

describe("buildPollAnswer", () => {
  it("uses full names and spells out every pick when it all fits", () => {
    expect(body([player("Ja'Marr Chase"), pick(2027, 1, "early")])).toBe(
      "Ja'Marr Chase, 27 1 (E)",
    );
  });

  it("writes a pick as year, round and one letter for the slot", () => {
    expect(body([pick(2027, 2, "late")])).toBe("27 2 (L)");
    expect(body([pick(2028, 3, "mid")])).toBe("28 3 (M)");
  });

  it("leaves the slot off a pick whose slot is unknown", () => {
    expect(body([pick(2027, 1, null)])).toBe("27 1");
  });

  it("puts picks in draft order whatever order the trade listed them", () => {
    expect(body([pick(2028, 1, "early"), pick(2027, 2, "mid")])).toBe("27 2 (M), 28 1 (E)");
  });

  it("prefixes each answer so it ties back to the side in the message", () => {
    expect(buildPollAnswer([player("Puka Nacua")], "a")?.text).toBe("A: Puka Nacua");
    expect(buildPollAnswer([player("Puka Nacua")], "b")?.text).toBe("B: Puka Nacua");
  });

  it("says nothing rather than printing an empty answer", () => {
    expect(buildPollAnswer([], "a")?.text).toBe("A: nothing");
  });

  // -------------------------------------------------------------------------
  // The ladder
  // -------------------------------------------------------------------------

  it("falls back to first initial and surname when full names do not fit", () => {
    const assets = [
      player("Christian McCaffrey"),
      player("Amon-Ra St. Brown"),
      player("Ja'Marr Chase"),
      player("Bijan Robinson"),
    ];
    const out = body(assets);
    expect(out).toBe("C. McCaffrey, A. St. Brown, J. Chase, B. Robinson");
    expect(out.length).toBeLessThanOrEqual(POLL_ANSWER_MAX - 3);
  });

  it("keeps a two-word surname intact when it shortens the first name", () => {
    expect(body([player("Amon-Ra St. Brown")])).toBe("Amon-Ra St. Brown");
    const many = [
      player("Amon-Ra St. Brown"),
      player("Christian McCaffrey"),
      player("Marvin Harrison Jr."),
    ];
    expect(body(many)).toContain("A. St. Brown");
    expect(body(many)).toContain("M. Harrison Jr.");
  });

  it("groups identical picks before it shortens anybody's name", () => {
    // Spelled out this is 53 characters and does not fit. Grouping says exactly
    // the same thing in 37 and keeps the full name, so it happens first.
    const assets = [
      player("Ja'Marr Chase"),
      pick(2027, 1, "early"),
      pick(2027, 1, "early"),
      pick(2027, 2, "mid"),
      pick(2027, 2, "mid"),
    ];
    expect(body(assets)).toBe("Ja'Marr Chase, 2x27 1 (E), 2x27 2 (M)");
  });

  it("drops the slot letters and groups again when grouping alone is not enough", () => {
    const assets = [
      pick(2027, 1, "early"),
      pick(2027, 1, "mid"),
      pick(2027, 1, "late"),
      pick(2028, 1, "early"),
      pick(2028, 1, "mid"),
      pick(2028, 2, "early"),
      pick(2028, 2, "mid"),
      pick(2029, 1, "late"),
    ];
    const out = body(assets);
    expect(out).toBe("3x27 1, 2x28 1, 2x28 2, 29 1");
    expect(out.length).toBeLessThanOrEqual(POLL_ANSWER_MAX - 3);
  });

  it("collapses picks to a count only as a last resort", () => {
    const assets = [
      player("Christian McCaffrey"),
      player("Amon-Ra St. Brown"),
      player("Marvin Harrison Jr."),
      player("Brian Thomas Jr."),
      ...Array.from({ length: 6 }, (_, i) => pick(2027 + (i % 3), (i % 4) + 1, "mid")),
    ];
    const out = body(assets);
    expect(out).toContain("6 picks");
    expect(out.length).toBeLessThanOrEqual(POLL_ANSWER_MAX - 3);
  });

  it("says 1 pick rather than 1 picks", () => {
    // Reached only by a pick with no year or round of its own, whose long label
    // is what the earlier rungs would have to print. A normal "27 1" is four
    // characters and beats "1 pick" every time.
    const assets = [
      player("Christian McCaffrey"),
      player("Amon-Ra St. Brown"),
      player("Marvin Harrison Jr."),
      {
        kind: "pick" as const,
        season: null,
        round: null,
        slot: null,
        label: "2027 first round pick via Miami",
      },
    ];
    const out = body(assets);
    expect(out).toBe("McCaffrey, St. Brown, Harrison, 1 pick");
  });

  it("never squeezes further than it has to", () => {
    // Two names fit in full, so nothing is shortened even though it could be.
    const answer = buildPollAnswer([player("Puka Nacua"), player("Drake London")], "a");
    expect(answer?.rung).toBe(0);
    expect(answer?.text).toBe("A: Puka Nacua, Drake London");
  });

  it("skips a rung that would make two players read the same", () => {
    // Two Browns. Surnames only would give "Brown, Brown", which is not a
    // shorter way of saying the same thing, so both surname rungs are refused
    // and the side is reported as unpostable instead.
    const assets = [
      player("Antonio Brown"),
      player("Marquise Brown"),
      player("Christian McCaffrey"),
      player("Amon-Ra St. Brown"),
      player("Jaxon Smith-Njigba"),
      player("Marvin Harrison Jr."),
    ];
    expect(buildPollAnswer(assets, "a")).toBeNull();
  });

  it("still uses surnames when they are all distinct", () => {
    const assets = [
      player("Christian McCaffrey"),
      player("Amon-Ra St. Brown"),
      player("Marvin Harrison Jr."),
      player("Jaxon Smith-Njigba"),
    ];
    expect(body(assets)).toBe("McCaffrey, St. Brown, Harrison, Smith-Njigba");
  });

  it("refuses rather than dropping anybody from the side", () => {
    // Eight long, distinct names survive no rung. Null tells the caller to take
    // a different trade; a truncated list would describe a different trade.
    const assets = Array.from({ length: 8 }, (_, i) =>
      player(`Christopher Bartholomew Longname${i} Vanderbilt`),
    );
    expect(buildPollAnswer(assets, "a")).toBeNull();
  });

  it("keeps every answer it does produce inside Discord's 55", () => {
    const cases: PollAsset[][] = [
      [player("Ja'Marr Chase")],
      [player("Christian McCaffrey"), player("Amon-Ra St. Brown"), player("Ja'Marr Chase")],
      Array.from({ length: 7 }, (_, i) => pick(2027 + (i % 3), (i % 4) + 1, "early")),
      [
        player("Christian McCaffrey"),
        player("Amon-Ra St. Brown"),
        pick(2027, 1, "early"),
        pick(2027, 1, "mid"),
        pick(2028, 2, "late"),
      ],
    ];
    for (const assets of cases) {
      const answer = buildPollAnswer(assets, "b");
      expect(answer).not.toBeNull();
      expect(answer!.text.length).toBeLessThanOrEqual(POLL_ANSWER_MAX);
    }
  });
});
