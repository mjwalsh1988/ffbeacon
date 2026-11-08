import { describe, expect, it } from "vitest";
import { teamTonesFor, tooClose, trailTones } from "./team-colors";

describe("trailTones", () => {
  it("returns primary and secondary when they differ", () => {
    expect(trailTones("#E31837", "#FFB81C", "#000000")).toEqual({ upper: "#E31837", lower: "#FFB81C" });
  });

  it("swaps in the tertiary when both channels are within 24", () => {
    expect(tooClose("#101820", "#1A2228")).toBe(true);
    expect(trailTones("#101820", "#1A2228", "#FB4F14")).toEqual({ upper: "#101820", lower: "#FB4F14" });
  });

  it("returns null for a missing team or missing colors", () => {
    expect(trailTones(null, "#FFFFFF", null)).toBeNull();
    expect(teamTonesFor(null, [])).toBeNull();
    expect(teamTonesFor("KC", [])).toBeNull();
  });

  it("builds the DTO for a known code, and a miss carries null", () => {
    const rows = [{ abbreviation: "KC", primary_color: "#e31837", secondary_color: "#ffb81c", tertiary_color: null }];
    expect(teamTonesFor("KC", rows)).toEqual({ code: "KC", primary: "#E31837", secondary: "#FFB81C", tertiary: null });
    // The answer route passes a null team code for a miss or timeout.
    expect(teamTonesFor(null, rows)).toBeNull();
  });
});
