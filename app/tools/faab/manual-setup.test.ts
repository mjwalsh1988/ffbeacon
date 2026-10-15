import { describe, expect, it } from "vitest";
import { biddersFor, parseManualSeed } from "./manual-setup";

describe("parseManualSeed", () => {
  it("reads the league type from the link, and a kind spread last wins", () => {
    const params = { kind: "redraft", start: "12", alive: "9", danger: "near" };
    expect(parseManualSeed(params).leagueType).toBe("redraft");

    // The guillotine page passes `{ ...params, kind: "chopped" }`, so whatever
    // the URL said, the page is always chopped.
    const seed = parseManualSeed({ ...params, kind: "chopped" });
    expect(seed).toEqual({
      leagueType: "chopped",
      startCount: 12,
      aliveCount: 9,
      danger: "nearCut",
    });
  });

  it("drops a teams-alive figure above the starting field", () => {
    expect(parseManualSeed({ start: "12", alive: "14" }).aliveCount).toBeNull();
  });

  it("drops a teams-alive figure when the link gives no starting field", () => {
    expect(parseManualSeed({ alive: "9" }).aliveCount).toBeNull();
  });

  it("never reads a danger answer off the object prototype", () => {
    for (const danger of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(parseManualSeed({ danger }).danger).toBeNull();
    }
  });

  it("ignores repeated parameters, unknown kinds and counts out of range", () => {
    expect(
      parseManualSeed({ kind: ["chopped"], start: ["12"], alive: ["9"], danger: ["near"] }),
    ).toEqual({ leagueType: null, startCount: null, aliveCount: null, danger: null });
    expect(parseManualSeed({ kind: "guillotine" }).leagueType).toBeNull();
    for (const start of ["1", "33", "1e1", "-3", " 12"]) {
      expect(parseManualSeed({ start }).startCount).toBeNull();
    }
    expect(parseManualSeed({ start: "2" }).startCount).toBe(2);
    expect(parseManualSeed({ start: "32" }).startCount).toBe(32);
  });
});

describe("biddersFor", () => {
  it("crowds the room in a chopped league with half the field alive", () => {
    expect(biddersFor("auto", 0.5, { aliveFraction: 0.6 })).toBe("4p");
  });
});
