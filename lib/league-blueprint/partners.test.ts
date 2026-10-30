import { describe, expect, it } from "vitest";
import { NO_PARTNERS, computePartners, surplusPoints } from "./partners";
import { DEFAULT_LEAGUE_BLUEPRINT_SETTINGS } from "./default-settings";
import type { TeamProfile } from "@/lib/trade-finder/profile";
import type { FinderPlayer } from "@/lib/trade-finder/types";

const s = DEFAULT_LEAGUE_BLUEPRINT_SETTINGS.partners;

function prof(
  rosterId: number,
  direction: TeamProfile["direction"],
  need: Record<string, number>,
  surplus: Array<{ id: string; position: string; cost: number }>,
): TeamProfile {
  const players = surplus.map((x) => ({ playerId: x.id, position: x.position }) as FinderPlayer);
  return {
    team: {
      rosterId,
      teamName: `Team ${rosterId}`,
      ownerHandle: `o${rosterId}`,
      statusKey: null,
      statusLabel: null,
      pulseRank: rosterId,
      valueRank: rosterId,
      pulse: null,
      players,
      picks: [],
    },
    direction,
    isDynasty: true,
    startingTotal: 100,
    starterIds: new Set(),
    positionNeed: need,
    replacementCost: new Map(surplus.map((x) => [x.id, x.cost])),
    surplus: players,
    totalValue: 0,
    meanAge: 26,
  };
}

describe("computePartners", () => {
  const mine = prof(1, "win-now", { RB: 3 }, [{ id: "m-wr", position: "WR", cost: 2 }]);
  const fits = prof(2, "rebuild", { WR: 2 }, [{ id: "a-rb", position: "RB", cost: 4 }]);
  const halfFit = prof(3, "balanced", {}, [{ id: "b-rb", position: "RB", cost: 1 }]);
  const none = prof(4, "win-now", {}, []);

  it("sums replacement cost over surplus at a position", () => {
    expect(surplusPoints(fits, "RB")).toBe(4);
    expect(surplusPoints(fits, "WR")).toBe(0);
  });

  it("ranks by fit and explains the largest term", () => {
    const out = computePartners(mine, [fits, halfFit, none], new Map([[2, "Rebuilder"]]), s);
    expect(out.map((p) => p.rosterId)).toEqual([2, 3]);
    // need 0.4*1 + give 0.3*1 + direction 0.2*1 + tendency 0.1*0.5 = 0.95
    expect(out[0].fit).toBe(0.95);
    expect(out[0].statusLabel).toBe("Rebuilder");
    expect(out[0].reason).toBe(
      "They have RB depth worth 3.0 points a week to you and need WR; you have the opposite.",
    );
  });

  it("normalizes to zero when every fit is zero and breaks ties by roster id", () => {
    const flat = prof(1, "balanced", {}, []);
    const out = computePartners(flat, [prof(9, "balanced", {}, []), prof(5, "balanced", {}, [])], new Map(), s);
    expect(out.map((p) => p.rosterId)).toEqual([5, 9]);
    expect(out[0].fit).toBe(0.15);
  });

  it("names nobody with fewer than two other rosters", () => {
    expect(computePartners(mine, [fits], new Map(), s)).toEqual([]);
    expect(NO_PARTNERS).toBe("Not enough priced rosters to name a partner.");
  });
});
