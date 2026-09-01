import { describe, it, expect } from "vitest";
import {
  EMBED_TOTAL_MAX,
  POLL_ANSWER_MAX,
  compose,
  embedCost,
  fitPollAnswer,
  withinLimits,
  type Section,
} from "./limits";

/**
 * The rule these tests exist to hold: NOTHING IS EVER TRUNCATED.
 *
 * A writeup cut mid-sentence reads as a complete one, and a reader has no way
 * to tell a deliberate ending from a severed one. Every test here is a way of
 * asking "did anything come back shorter than its author wrote it", and the
 * answer has to stay no.
 */

const s = (key: string, text: string, priority: number): Section => ({ key, text, priority });

describe("compose", () => {
  it("keeps every section when they all fit", () => {
    const result = compose([s("a", "one", 0), s("b", "two", 1)], 1000);
    expect(result).not.toBeNull();
    expect(result!.body).toBe("one\n\ntwo");
    expect(result!.dropped).toEqual([]);
  });

  it("drops whole sections rather than cutting one", () => {
    const long = "x".repeat(100);
    const result = compose([s("keep", long, 0), s("drop", long, 5)], 150);
    expect(result).not.toBeNull();
    expect(result!.dropped).toEqual(["drop"]);
    // The survivor is byte-for-byte what was passed in.
    expect(result!.body).toBe(long);
  });

  it("drops the highest priority number first, and the tail among equals", () => {
    const long = "x".repeat(60);
    const result = compose(
      [s("essential", long, 0), s("mid", long, 1), s("tailA", long, 3), s("tailB", long, 3)],
      130,
    );
    expect(result).not.toBeNull();
    // Both priority-3 sections go before the priority-1 one, and the LATER of
    // the two equals goes first, so a squeeze eats the tail rather than
    // punching a hole in the middle.
    expect(result!.dropped).toEqual(["tailB", "tailA"]);
  });

  it("preserves the given order of whatever survives", () => {
    const result = compose(
      [s("first", "AAA", 0), s("droppable", "x".repeat(500), 9), s("last", "BBB", 0)],
      20,
    );
    expect(result!.body).toBe("AAA\n\nBBB");
  });

  it("returns null rather than truncating when the essentials alone overflow", () => {
    // The one case where nothing legal can be built. The caller's contract is
    // to post nothing, never to post a shortened version.
    expect(compose([s("essential", "x".repeat(500), 0)], 100)).toBeNull();
  });

  it("ignores empty sections instead of emitting blank paragraphs", () => {
    const result = compose([s("a", "one", 0), s("blank", "   ", 1), s("b", "two", 1)], 1000);
    expect(result!.body).toBe("one\n\ntwo");
  });
});

describe("embedCost", () => {
  it("counts every visible string the way Discord does", () => {
    expect(
      embedCost({
        title: "ab",
        description: "cde",
        footer: "f",
        fields: [{ name: "gh", value: "ijk" }],
      }),
    ).toBe(2 + 3 + 1 + 2 + 3);
  });
});

describe("withinLimits", () => {
  it("passes an ordinary message", () => {
    expect(withinLimits({ title: "t", description: "d" }).ok).toBe(true);
  });

  it("refuses an embed that busts the combined total even when each part is legal", () => {
    // The limit that actually bites a long writeup: every part inside its own
    // cap, the sum over 6000.
    const result = withinLimits({
      description: "x".repeat(4000),
      fields: Array.from({ length: 3 }, (_, i) => ({
        name: `f${i}`,
        value: "y".repeat(1000),
      })),
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain(String(EMBED_TOTAL_MAX));
  });

  it("refuses an over-long poll answer rather than letting Discord 400 it", () => {
    const result = withinLimits({ pollAnswers: ["z".repeat(POLL_ANSWER_MAX + 1)] });
    expect(result.ok).toBe(false);
  });
});

describe("fitPollAnswer", () => {
  it("leaves a short name exactly as it is", () => {
    expect(fitPollAnswer("Midnight Blitz")).toBe("Midnight Blitz");
  });

  it("drops whole trailing words rather than cutting one in half", () => {
    const name = "The Absolutely Enormous Fighting Mongooses Of Greater Cleveland";
    const fitted = fitPollAnswer(name);
    expect(fitted).not.toBeNull();
    expect(fitted!.length).toBeLessThanOrEqual(POLL_ANSWER_MAX);
    // Whatever survives is a prefix made of complete words.
    expect(name.startsWith(fitted!)).toBe(true);
    expect(fitted!.endsWith(" ")).toBe(false);
    for (const word of fitted!.split(" ")) {
      expect(name.split(" ")).toContain(word);
    }
  });

  it("returns null when even the first word will not fit", () => {
    // The caller's cue to post without a poll. A sliced first word would name
    // a team that does not exist.
    expect(fitPollAnswer("Supercalifragilisticexpialidocious", 10)).toBeNull();
  });

  it("collapses runs of whitespace so a padded name is measured fairly", () => {
    expect(fitPollAnswer("  Team    Name  ")).toBe("Team Name");
  });
});
