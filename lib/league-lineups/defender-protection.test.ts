import { describe, expect, it } from "vitest";
import { slotEligibility, type PulsePosition } from "@/lib/power-pulse/types";
import { startingSlots } from "@/lib/power-pulse/lineup";
import { protectedDefenderIds, type ProtectionPlayer } from "./defender-protection";
import { buildDropOptions } from "./advice";
import type { LineupPlayer } from "./types";

const ON = slotEligibility(true);
const WEEKS = [5, 6, 7, 8];

function p(sleeperId: string, position: PulsePosition, eligible?: string[]): ProtectionPlayer {
  return { sleeperId, playerId: `p-${sleeperId}`, position, eligible };
}

function points(map: Record<string, number[]>): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  for (const [sid, list] of Object.entries(map)) {
    out.set(`p-${sid}`, new Map(list.map((v, i) => [WEEKS[i], v])));
  }
  return out;
}

describe("protectedDefenderIds (plan R-5)", () => {
  const slots = startingSlots(["QB", "LB", "BN", "BN"], ON);

  it("protects a linebacker the optimiser seats in at least half the remaining weeks", () => {
    const out = protectedDefenderIds({
      isKeeperLeague: true,
      slotTokens: slots,
      slotMap: ON,
      roster: [p("qb", "QB"), p("lb-a", "LB"), p("lb-b", "LB")],
      // lb-a starts weeks 5 and 6, lb-b weeks 7 and 8: both are seated in half.
      pointsByPlayerWeek: points({ qb: [20, 20, 20, 20], "lb-a": [12, 12, 5, 5], "lb-b": [8, 8, 11, 11] }),
      weeks: WEEKS,
    });
    expect(out.has("lb-a")).toBe(true);
    expect(out.has("lb-b")).toBe(true);
  });

  it("protects the top linebacker by rest-of-season points even when a single week favours another", () => {
    const out = protectedDefenderIds({
      isKeeperLeague: true,
      slotTokens: slots,
      slotMap: ON,
      roster: [p("lb-star", "LB"), p("lb-backup", "LB")],
      pointsByPlayerWeek: points({ "lb-star": [14, 14, 14, 0], "lb-backup": [3, 3, 3, 6] }),
      weeks: WEEKS,
    });
    expect(out.has("lb-star")).toBe(true);
    expect(out.has("lb-backup")).toBe(false);
  });

  it("protects nobody in a redraft league", () => {
    const out = protectedDefenderIds({
      isKeeperLeague: false,
      slotTokens: slots,
      slotMap: ON,
      roster: [p("lb-star", "LB")],
      pointsByPlayerWeek: points({ "lb-star": [14, 14, 14, 14] }),
      weeks: WEEKS,
    });
    expect(out.size).toBe(0);
  });

  it("a DL/LB player seated as LB counts as seated", () => {
    const out = protectedDefenderIds({
      isKeeperLeague: true,
      slotTokens: slots,
      slotMap: ON,
      roster: [p("edge", "DL", ["DL", "LB"]), p("lb", "LB")],
      pointsByPlayerWeek: points({ edge: [12, 12, 12, 12], lb: [4, 4, 4, 4] }),
      weeks: WEEKS,
    });
    expect(out.has("edge")).toBe(true);
  });
});

function bench(sleeperId: string, position: string, name = sleeperId): LineupPlayer {
  return {
    sleeperId,
    playerId: `p-${sleeperId}`,
    name,
    position,
    rosterSlot: "bench",
    projected: 3,
  } as unknown as LineupPlayer;
}

describe("buildDropOptions with the IDP switch", () => {
  const base = {
    restOfSeasonPerWeek: new Map([
      ["lb-star", 12],
      ["lb-scrub", 1],
      ["wr", 2],
    ]),
    valueBySleeperId: new Map<string, number>(),
    isKeeperLeague: true,
    seatedSleeperIds: new Set<string>(),
  };
  const benchable = [bench("lb-star", "LB", "Star Linebacker"), bench("lb-scrub", "LB"), bench("wr", "WR")];

  it("never names a protected defender, and says so by name", () => {
    const out = buildDropOptions({
      ...base,
      benchable,
      idpEnabled: true,
      protectedDefenderIds: new Set(["lb-star"]),
    });
    const offered = out.options.map((o) => o.player.sleeperId);
    expect(offered).not.toContain("lb-star");
    expect(offered).toContain("lb-scrub");
    expect(out.unjudged).toContain("Star Linebacker is not listed");
  });

  it("with the switch off, defenders are counted and not judged, as before", () => {
    const out = buildDropOptions({ ...base, benchable });
    expect(out.options.map((o) => o.player.sleeperId)).toEqual(["wr"]);
    expect(out.unjudged).toContain("League Pulse does not project defenders yet");
  });
});
