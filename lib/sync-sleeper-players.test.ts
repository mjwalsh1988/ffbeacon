import { describe, it, expect } from "vitest";
import { deriveStatus, pickPrimaryPosition, slugifyPlayer } from "./sync-sleeper-players";
import type { SleeperPlayer } from "./sleeper";

function player(p: Partial<SleeperPlayer>): SleeperPlayer {
  return { player_id: "1", first_name: "A", last_name: "B", ...p };
}

/**
 * deriveStatus reads two Sleeper fields that answer different questions, and the
 * order matters. The original version read the `active` boolean first and
 * returned early, throwing away the far more specific `status` string whenever
 * the two disagreed.
 *
 * The measured result on production, 2026-08-25: 53 players whose Sleeper status
 * read "Injured Reserve" came out as "inactive", while 39 with the identical
 * string came out as "ir". Same input, two different answers, decided by an
 * unrelated flag. Most of the specific branches this function exists to produce
 * never fired at all.
 */
describe("deriveStatus", () => {
  it("reports a named situation even when the roster flag disagrees", () => {
    // The regression. Both of these are on injured reserve and must agree.
    expect(deriveStatus(player({ status: "Injured Reserve", active: false }))).toBe("ir");
    expect(deriveStatus(player({ status: "Injured Reserve", active: true }))).toBe("ir");
  });

  it.each([
    ["Injured Reserve", "ir"],
    ["IR", "ir"],
    ["Practice Squad", "practice_squad"],
    ["Suspended", "suspended"],
    ["Physically Unable to Perform", "pup"],
    ["PUP", "pup"],
    ["Non Football Injury", "nfi"],
    ["NFI", "nfi"],
    ["Retired", "retired"],
  ])("maps %s to %s regardless of the roster flag", (raw, expected) => {
    expect(deriveStatus(player({ status: raw, active: false }))).toBe(expected);
    expect(deriveStatus(player({ status: raw, active: true }))).toBe(expected);
  });

  it("falls back to the roster flag when the string names nothing specific", () => {
    // Eli Manning: Sleeper still reports status "Active" for him and the boolean
    // is the only field that knows he left the league. With no named situation
    // to prefer, the boolean is the better witness.
    expect(deriveStatus(player({ status: "Active", active: false }))).toBe("inactive");
  });

  it("reads a plain active player as active", () => {
    expect(deriveStatus(player({ status: "Active", active: true }))).toBe("active");
    expect(deriveStatus(player({ status: "Active" }))).toBe("active");
  });

  it("reads Sleeper's Inactive as inactive", () => {
    // What Sleeper reports for a player off the active 53, which is what an IR
    // player looks like when the status string is not more specific.
    expect(deriveStatus(player({ status: "Inactive", active: true }))).toBe("inactive");
  });

  it("defaults to active when Sleeper says nothing at all", () => {
    expect(deriveStatus(player({}))).toBe("active");
  });

  it("is case insensitive", () => {
    expect(deriveStatus(player({ status: "INJURED RESERVE" }))).toBe("ir");
    expect(deriveStatus(player({ status: "practice squad" }))).toBe("practice_squad");
  });
});

describe("slugifyPlayer", () => {
  it("produces the slug shape the rest of the site parses a Sleeper id out of", () => {
    expect(slugifyPlayer("Patrick-Mahomes-4046")).toBe("patrick-mahomes-4046");
  });

  it("strips accents and punctuation rather than encoding them", () => {
    expect(slugifyPlayer("Amon-Ra St. Brown-7547")).toBe("amon-ra-st-brown-7547");
    expect(slugifyPlayer("D'Andre Swift-6790")).toBe("dandre-swift-6790");
  });
});

describe("pickPrimaryPosition", () => {
  it("prefers a fantasy position over the raw NFL position", () => {
    expect(
      pickPrimaryPosition(player({ position: "DB", fantasy_positions: ["WR"] })),
    ).toBe("WR");
  });

  it("keeps an unrecognized position verbatim rather than dropping the player", () => {
    expect(pickPrimaryPosition(player({ position: "XYZ" }))).toBe("XYZ");
  });

  it("returns null when there is nothing to go on", () => {
    expect(pickPrimaryPosition(player({}))).toBeNull();
  });
});
