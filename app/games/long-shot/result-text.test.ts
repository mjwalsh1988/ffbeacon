import { describe, expect, it } from "vitest";
import { resultSentence, roomLine } from "./result-text";

describe("resultSentence", () => {
  it("covers a hit, a miss, a timeout and a skip", () => {
    expect(resultSentence({ state: "answered", tier: "deep", points: 60, playerName: "Jaylen Warren" })).toBe(
      "Jaylen Warren: Deep, 60 points.",
    );
    expect(resultSentence({ state: "answered", tier: null, points: 0, playerName: "Tom Brady" })).toBe(
      "Tom Brady is not an answer to this prompt. 0 points.",
    );
    expect(resultSentence({ state: "timed_out", tier: null, points: 0, playerName: null })).toBe("Time ran out. 0 points.");
    expect(resultSentence({ state: "skipped", tier: null, points: 0, playerName: null })).toBe("Skipped. 0 points.");
  });
});

describe("roomLine", () => {
  it("prefixes by mode and says first-answer under 5", () => {
    expect(roomLine({ state: "answered", roomCount: 3, roomTotal: 40 }, "hurry_up")).toBe(
      "Today: 3 of 40 players gave this answer.",
    );
    expect(roomLine({ state: "answered", roomCount: 3, roomTotal: 40 }, "film_room")).toBe(
      "In that day's Hurry-Up room, 3 of 40 players gave this answer.",
    );
    expect(roomLine({ state: "answered", roomCount: 1, roomTotal: 4 }, "hurry_up")).toBe(
      "You are among the first to answer this prompt.",
    );
  });
});
