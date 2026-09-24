import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeDraftGrades, defensivePickCounts } from "./draft-grade";
import { DEFAULT_ON_THE_CLOCK_SETTINGS } from "./default-settings";
import type { ShapedPick } from "./types";
import type { TeamRollup } from "./rosters";
import type { DraftPulseTeam } from "./draft-pulse";
import { toStealPosition } from "@/lib/draft-value/build";
import { normalizePositionColor, positionColorKey } from "./position-colors";

/**
 * Plan R-11 and IDP-211: draft tools stay offense-only, and a defender pick is
 * shown honestly rather than graded on nothing.
 */

function pick(over: Partial<ShapedPick>): ShapedPick {
  return {
    pickNo: 1,
    round: 1,
    draftSlot: 1,
    rosterId: 1,
    pickedBy: "u1",
    sleeperPlayerId: "s1",
    playerId: "p1",
    isKeeper: false,
    firstName: "A",
    lastName: "B",
    position: "WR",
    team: "DAL",
    ...over,
  };
}

describe("defensive picks in draft grades", () => {
  it("counts made, non-keeper defender picks per roster", () => {
    const counts = defensivePickCounts([
      pick({ rosterId: 1, position: "LB" }),
      pick({ rosterId: 1, position: "DB" }),
      pick({ rosterId: 1, position: "LB", isKeeper: true }),
      pick({ rosterId: 2, position: "WR" }),
      pick({ rosterId: null, position: "DL" }),
    ]);
    expect(counts.get(1)).toBe(2);
    expect(counts.has(2)).toBe(false);
  });

  it("says the market component graded N of M picks", () => {
    const rollup = {
      rosterId: 1,
      ownerName: "owner-1",
      teamName: null,
      isYou: false,
      players: {},
      positionTotals: {},
      playersValue: 0,
      playerCount: 15,
      futurePicks: [],
      futurePicksValue: 0,
      totalValue: 0,
      rank: 1,
    } as unknown as TeamRollup;
    const pulse: DraftPulseTeam = {
      rosterId: 1,
      meanStartingPoints: 100,
      sigma: 25,
      rank: 1,
      score: 50,
      positionPoints: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 },
      weakestSlot: null,
      starterBeatRate: null,
      starterAvailability: null,
      starterWeeksPlayed: null,
      projectedCount: 15,
      unprojectedCount: 0,
      unprojectedIdpCount: 0,
      unprojectedOtherCount: 0,
      startersFilled: 9,
      waiverFilledSlots: 0,
      waiverPointsShare: 0,
      assumedSignings: [],
      worstByeWeek: null,
      scheduleStrength: null,
    };
    const grades = computeDraftGrades({
      rollups: [rollup],
      pulseTeams: [pulse],
      pickSurpluses: [
        {
          pickNo: 1,
          rosterId: 1,
          playerId: "p1",
          playerName: "A B",
          position: "WR",
          value: 5000,
          marketValue: 4000,
          surplus: 1000,
        },
      ],
      tradeMarginByRoster: new Map(),
      startingSlotCount: 9,
      isDynasty: true,
      settings: DEFAULT_ON_THE_CLOCK_SETTINGS.grades,
      inProgress: false,
      picks: [pick({ rosterId: 1 }), pick({ pickNo: 2, rosterId: 1, position: "LB" })],
    });
    const market = grades[0].components.find((c) => c.key === "market");
    expect(market?.evidence).toContain("Graded on 1 of 2 picks; 1 defensive pick has no value.");
  });
});

describe("offense-only filters hold for defenders", () => {
  it("the draft tracker and board coercion drop a defender; the chip key keeps him", () => {
    expect(normalizePositionColor("LB")).toBeNull();
    expect(positionColorKey("LB")).toBe("LB");
    expect(toStealPosition("DL")).toBeNull();
    expect(toStealPosition("RB")).toBe("RB");
  });

  it("the live room gives a defender pick no ADP value mark", () => {
    const board = readFileSync(join(process.cwd(), "app/tools/on-the-clock/draft-board.tsx"), "utf8");
    const list = readFileSync(join(process.cwd(), "app/tools/on-the-clock/pick-list.tsx"), "utf8");
    expect(board).toContain("!isDefender(pick.position)");
    expect(list).toContain('"Defensive pick, not graded"');
  });
});
