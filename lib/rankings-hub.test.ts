import { describe, expect, it } from "vitest";
import {
  RANKINGS_HUB_HREF,
  rankingsBoardQuery,
  wantsRankingsHub,
} from "./rankings-hub";

describe("wantsRankingsHub", () => {
  it("is true only for the hub flag", () => {
    expect(wantsRankingsHub("formats")).toBe(true);
    expect(wantsRankingsHub(["formats", "x"])).toBe(true);
    expect(wantsRankingsHub(undefined)).toBe(false);
    expect(wantsRankingsHub("board")).toBe(false);
    expect(wantsRankingsHub("")).toBe(false);
  });

  it("matches the href the breadcrumb uses", () => {
    expect(RANKINGS_HUB_HREF).toBe("/rankings?view=formats");
  });
});

describe("rankingsBoardQuery", () => {
  it("is empty when there is nothing to carry", () => {
    expect(rankingsBoardQuery({})).toBe("");
  });

  it("carries source and position, in that order", () => {
    expect(rankingsBoardQuery({ position: "WR", source: "ktc" })).toBe(
      "?source=ktc&position=WR",
    );
  });

  it("takes the first of a repeated value", () => {
    expect(rankingsBoardQuery({ source: ["ktc", "fantasycalc"] })).toBe(
      "?source=ktc",
    );
  });

  it("encodes anything a visitor typed", () => {
    expect(rankingsBoardQuery({ source: "a&b=c/../x" })).toBe(
      "?source=a%26b%3Dc%2F..%2Fx",
    );
  });
});
