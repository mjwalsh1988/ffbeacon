import { describe, expect, it } from "vitest";
import { DEFAULT_LONG_SHOT_SETTINGS } from "./default-settings";
import { scoreAnswer, sumPoints } from "./scoring";
import type { AnswerEntry } from "./types";

const points = DEFAULT_LONG_SHOT_SETTINGS.tiers.points;
const answers: AnswerEntry[] = [
  { player_id: "a", tier: "long_shot", rate: 0 },
  { player_id: "b", tier: "chalk", rate: 0.9 },
];

describe("scoreAnswer", () => {
  it("scores a correct answer with its tier and points", () => {
    expect(scoreAnswer(answers, "a", points)).toEqual({ correct: true, tier: "long_shot", points: 100 });
    expect(scoreAnswer(answers, "b", points)).toEqual({ correct: true, tier: "chalk", points: 10 });
  });

  it("scores a wrong player 0", () => {
    expect(scoreAnswer(answers, "z", points)).toEqual({ correct: false, tier: null, points: 0 });
  });

  it("scores a null player 0", () => {
    expect(scoreAnswer(answers, null, points)).toEqual({ correct: false, tier: null, points: 0 });
  });
});

describe("sumPoints", () => {
  it("sums rows and treats null as 0", () => {
    expect(sumPoints([{ points: 10 }, { points: 85 }, { points: null }])).toBe(95);
  });
});
