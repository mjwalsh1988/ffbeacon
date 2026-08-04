import { describe, expect, it } from "vitest";
import { resolveTeamReference, teamCity, teamNickname } from "./match";

/**
 * Tests for team reference resolution.
 *
 * The behaviour that matters is the tier ORDER and the refusal to guess. Before
 * this, only an exact abbreviation or exact full name auto-linked, so "Falcons"
 * and "Commanders" (how reporters actually write) went to manual review every
 * time: 68 team rows were approved by hand. Nicknames are unique across the 32
 * teams so they are safe to accept; cities are not, and an ambiguous city must
 * still reach a human rather than fall through to a lower-confidence guess.
 */

const team = (id: string, abbreviation: string, name: string) => ({
  id,
  abbreviation,
  name,
  discord_role_ids: null,
});

const TEAMS = [
  team("atl", "ATL", "Atlanta Falcons"),
  team("was", "WAS", "Washington Commanders"),
  team("sf", "SF", "San Francisco 49ers"),
  team("nyg", "NYG", "New York Giants"),
  team("nyj", "NYJ", "New York Jets"),
  team("lar", "LAR", "Los Angeles Rams"),
  team("lac", "LAC", "Los Angeles Chargers"),
  team("ne", "NE", "New England Patriots"),
];

describe("teamNickname / teamCity", () => {
  it("splits a team name into its city and nickname", () => {
    expect(teamNickname("Washington Commanders")).toBe("commanders");
    expect(teamCity("Washington Commanders")).toBe("washington");
    expect(teamNickname("San Francisco 49ers")).toBe("49ers");
    expect(teamCity("San Francisco 49ers")).toBe("san francisco");
    expect(teamCity("New England Patriots")).toBe("new england");
  });
});

describe("resolveTeamReference", () => {
  it("matches an exact abbreviation", () => {
    expect(resolveTeamReference("ATL", TEAMS)?.id).toBe("atl");
    expect(resolveTeamReference("atl", TEAMS)?.id).toBe("atl");
  });

  it("matches an exact full name", () => {
    expect(resolveTeamReference("Atlanta Falcons", TEAMS)?.id).toBe("atl");
  });

  it("matches a bare nickname, which is what reporters write", () => {
    expect(resolveTeamReference("Falcons", TEAMS)?.id).toBe("atl");
    expect(resolveTeamReference("Commanders", TEAMS)?.id).toBe("was");
    expect(resolveTeamReference("49ers", TEAMS)?.id).toBe("sf");
    expect(resolveTeamReference("Jets", TEAMS)?.id).toBe("nyj");
  });

  it("matches an unambiguous city", () => {
    expect(resolveTeamReference("Washington", TEAMS)?.id).toBe("was");
    expect(resolveTeamReference("New England", TEAMS)?.id).toBe("ne");
  });

  it("refuses an ambiguous city rather than guessing", () => {
    // Two teams each. These must reach a human, not silently pick one.
    expect(resolveTeamReference("New York", TEAMS)).toBeNull();
    expect(resolveTeamReference("Los Angeles", TEAMS)).toBeNull();
  });

  it("ignores punctuation and case around a nickname", () => {
    expect(resolveTeamReference("#Falcons", TEAMS)?.id).toBe("atl");
    expect(resolveTeamReference("  falcons  ", TEAMS)?.id).toBe("atl");
  });

  it("returns null for something that is not a team", () => {
    expect(resolveTeamReference("Niners", TEAMS)).toBeNull();
    expect(resolveTeamReference("", TEAMS)).toBeNull();
  });

  it("never matches a substring of a real name", () => {
    // "Falcon" is not "Falcons"; a substring guess is how the wrong team gets
    // linked to an article that then ranks for it.
    expect(resolveTeamReference("Falcon", TEAMS)).toBeNull();
    expect(resolveTeamReference("New", TEAMS)).toBeNull();
  });
});
