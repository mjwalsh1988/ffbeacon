import { describe, expect, it } from "vitest";
import { buildLeagueFormatTags, leagueHasIdp } from "./league-format-tags";

describe("leagueHasIdp (plan R-28)", () => {
  it("is true for any starting IDP token", () => {
    for (const slot of ["DL", "LB", "DB", "IDP_FLEX"]) {
      expect(leagueHasIdp(["QB", "RB", slot, "BN"])).toBe(true);
    }
  });

  it("is false for an offense-only league and ignores bench slots", () => {
    expect(leagueHasIdp(["QB", "RB", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN"])).toBe(false);
    expect(leagueHasIdp(null)).toBe(false);
  });
});

describe("buildFormatTags with IDP slots", () => {
  it("emits the IDP position tags, and none for an offense-only league", () => {
    const idp = buildLeagueFormatTags({ rosterPositions: ["QB", "RB", "WR", "TE", "DL", "LB", "DB", "IDP_FLEX", "BN"], scoringSettings: {}, teamCount: 12 });
    const labels = idp.map((t) => t.label).join(" ");
    expect(labels).toMatch(/DL/);
    expect(labels).toMatch(/LB/);
    expect(labels).toMatch(/DB/);
    expect(labels).toMatch(/IDP/);
    const plain = buildLeagueFormatTags({ rosterPositions: ["QB", "RB", "WR", "TE", "FLEX", "BN"], scoringSettings: {}, teamCount: 12 });
    expect(plain.map((t) => t.label).join(" ")).not.toMatch(/IDP|DL|LB|\bDB\b/);
  });
});
