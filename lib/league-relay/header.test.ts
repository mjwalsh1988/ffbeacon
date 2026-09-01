import { describe, it, expect } from "vitest";
import { buildRelayHeader, describeStartingSlots } from "./header";
import type { SleeperLeague } from "@/lib/sleeper";

/**
 * The header is the one line on every message a reader is entitled to trust
 * completely, because it is what tells them which league they are looking at
 * and on what terms the numbers underneath were calculated. So the tests here
 * are mostly about what it must NOT do: guess, or state a rule nobody read.
 */

function sleeperLeague(over: Partial<SleeperLeague> = {}): SleeperLeague {
  return {
    league_id: "1",
    name: "Test",
    season: "2026",
    total_rosters: 12,
    roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"],
    // A realistic map. `isUsableScoring` requires both a yardage key and a TD
    // key before it will describe a league's scoring, which is the right bar:
    // a map with only `rec` in it is not a scoring system.
    scoring_settings: { rec: 1, pass_td: 4, pass_yd: 0.04, rush_yd: 0.1, rec_yd: 0.1 },
    settings: { type: 2 },
    ...over,
  } as unknown as SleeperLeague;
}

describe("describeStartingSlots", () => {
  it("counts adjacent repeats", () => {
    expect(describeStartingSlots(["QB", "RB", "RB", "WR", "WR", "WR", "TE"])).toBe(
      "QB, 2 RB, 3 WR, TE",
    );
  });

  it("drops only the slots that can never hold a starter", () => {
    expect(describeStartingSlots(["QB", "BN", "RB", "IR", "TAXI", "NA", "WR"])).toBe("QB, RB, WR");
  });

  it("keeps IDP slots, because a league that starts them should say so", () => {
    expect(describeStartingSlots(["QB", "DL", "LB", "DB"])).toContain("DL");
  });

  it("turns Sleeper's storage tokens into words a manager would use", () => {
    expect(describeStartingSlots(["QB", "SUPER_FLEX", "WRRB_FLEX"])).toBe("QB, SFLEX, W/R");
  });

  it("keeps the league's own order rather than tidying it", () => {
    // A league listing RB, WR, RB means that; collapsing it into "2 RB, WR"
    // would describe a different lineup screen to the one the manager sees.
    expect(describeStartingSlots(["RB", "WR", "RB"])).toBe("RB, WR, RB");
  });

  it("says so plainly when there is nothing to describe", () => {
    expect(describeStartingSlots(["BN", "BN"])).toBe("no starting slots published");
  });
});

describe("buildRelayHeader", () => {
  const base = {
    leagueName: "Light Your Beacons",
    season: 2026,
    totalRosters: 12,
    rosterPositions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"],
  };

  it("names the league, the season, the size, the lineup and the scoring", () => {
    const header = buildRelayHeader({ ...base, sleeperLeague: sleeperLeague() });
    expect(header.leagueName).toBe("Light Your Beacons");
    expect(header.contextLine).toContain("2026, 12 teams");
    expect(header.contextLine).toContain("starting QB, 2 RB, 2 WR, TE, FLEX");
    expect(header.contextLine).toContain("Full PPR");
  });

  it("says dynasty when the league is one", () => {
    // Sleeper's settings.type 2 is dynasty.
    const header = buildRelayHeader({ ...base, sleeperLeague: sleeperLeague() });
    expect(header.contextLine).toContain("dynasty");
  });

  it("says superflex when a superflex slot is started", () => {
    const header = buildRelayHeader({
      ...base,
      rosterPositions: ["QB", "SUPER_FLEX", "RB", "WR", "BN"],
      sleeperLeague: sleeperLeague({
        roster_positions: ["QB", "SUPER_FLEX", "RB", "WR", "BN"],
      } as Partial<SleeperLeague>),
    });
    expect(header.contextLine).toContain("superflex");
  });

  it("still produces a header when the Sleeper object was never captured", () => {
    // A league synced before the raw payload was preserved. The format and
    // scoring halves drop out; the message still says which league it is.
    const header = buildRelayHeader({ ...base, sleeperLeague: null });
    expect(header.leagueName).toBe("Light Your Beacons");
    expect(header.contextLine).toContain("12 teams");
    expect(header.contextLine).toContain("starting QB");
  });

  it("never claims a scoring rule it could not read", () => {
    // describeLeagueScoring says "settings unavailable" when it cannot read
    // them. Putting that inside a header would be noise where a fact belongs.
    const header = buildRelayHeader({
      ...base,
      sleeperLeague: sleeperLeague({ scoring_settings: {} } as Partial<SleeperLeague>),
    });
    expect(header.contextLine).not.toContain("unavailable");
  });

  it("renders as one italic line, so it reads as a standing note", () => {
    const header = buildRelayHeader({ ...base, sleeperLeague: sleeperLeague() });
    expect(header.contextLine.startsWith("_")).toBe(true);
    expect(header.contextLine.endsWith("_")).toBe(true);
    expect(header.contextLine).not.toContain("\n");
  });
});
