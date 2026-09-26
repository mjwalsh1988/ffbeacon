import { describe, expect, it } from "vitest";
import { foldRun, type RunSetup } from "./builder";
import { announcement, nextQuestionText, resultLine } from "./runner-text";

const cards = {
  a: { name: "Bijan Robinson", position: "RB" },
  b: { name: "Jahmyr Gibbs", position: "RB" },
  c: { name: "Garrett Wilson", position: "WR" },
  d: { name: "Chris Olave", position: "WR" },
  e: { name: "Marvin Harrison Jr.", position: "WR" },
};

const setup: RunSetup = {
  seed: ["a", "b", "c", "d", "e"],
  secondPass: [],
  initialBoard: [],
  startRank: 1,
  depth: 5,
  winsBeforePrompt: 3,
  cap: null,
  initialBreaks: [],
};

const comparison = {
  label: "vs FF Beacon",
  subject: "FF Beacon",
  fallbackFormatDisplay: null,
  basis: "overall" as const,
  ranks: {
    a: { overall: 1, position: 1 },
    b: { overall: 2, position: 2 },
    c: { overall: 7, position: 1 },
    d: { overall: 3, position: 2 },
    e: { overall: 5, position: 3 },
  },
};

describe("runner text", () => {
  it("names the first question", () => {
    const s = foldRun(setup, []).state;
    expect(nextQuestionText(s, cards)).toBe("Next: Jahmyr Gibbs or Bijan Robinson.");
  });

  it("reports a placement with the FF Beacon gap, then the next question", () => {
    const s = foldRun(setup, [{ a: "keep" }, { a: "keep" }]).state;
    const line = resultLine(s, cards, comparison);
    expect(line.text).toBe("Wilson placed 3rd. 4 spots higher than FF Beacon, who has him 7th.");
    expect(announcement(s, cards, comparison)).toContain("Next: Chris Olave or Garrett Wilson.");
  });

  it("uses the surname, not a suffix", () => {
    const s = foldRun(setup, [{ a: "keep" }, { a: "keep" }, { a: "keep" }, { a: "keep" }]).state;
    expect(resultLine(s, cards, null).text).toBe("Harrison placed 5th.");
  });

  it("announces the three-win prompt", () => {
    const s = foldRun({ ...setup, winsBeforePrompt: 2 }, [
      { a: "keep" },
      { a: "keep" },
      { a: "keep" },
      { a: "prefer" },
      { a: "prefer" },
    ]).state;
    expect(nextQuestionText(s, cards)).toBe(
      "Harrison has won 2 in a row. Place him at a rank, or keep comparing?",
    );
  });

  it("asks the tier question with both ranks", () => {
    const done = [{ a: "keep" }, { a: "keep" }, { a: "keep" }, { a: "keep" }] as const;
    const s = foldRun(setup, [...done, { a: "tiers" }]).state;
    expect(nextQuestionText(s, cards)).toBe(
      "Is there a real drop-off between Bijan Robinson (1st) and Jahmyr Gibbs (2nd)?",
    );
  });
});
