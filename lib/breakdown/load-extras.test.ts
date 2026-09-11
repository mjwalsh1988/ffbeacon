import { describe, it, expect } from "vitest";
import { adpKeyPreference, scoringSettingsForContext, type ExtrasContext } from "./load-extras";
import { projectPlayerWeek } from "@/lib/power-pulse/project";
import { DEFAULT_POWER_PULSE_SETTINGS } from "@/lib/power-pulse/default-settings";
import type { ProjectionRow } from "@/lib/power-pulse/load";

/**
 * Sleeper keys its ADP map WITHOUT a prefix: `ppr`, `half_ppr`, `std`, `2qb`,
 * and the `dynasty_*` variants. The first cut of this reader guessed `adp_ppr`
 * and silently rendered a dash for every player, which is exactly the failure a
 * test catches and a page render does not: a missing number looks like missing
 * data, not like a bug.
 */
describe("ADP flavour preference", () => {
  it("asks for the dynasty superflex key first in a dynasty superflex format", () => {
    expect(adpKeyPreference("pts_ppr", true, true)[0]).toBe("dynasty_2qb");
  });

  it("asks for dynasty PPR first in a dynasty one-quarterback format", () => {
    expect(adpKeyPreference("pts_ppr", true, false)[0]).toBe("dynasty_ppr");
  });

  it("asks for redraft superflex first in a redraft superflex format", () => {
    expect(adpKeyPreference("pts_ppr", false, true)[0]).toBe("2qb");
  });

  it("matches the scoring base in a redraft one-quarterback format", () => {
    expect(adpKeyPreference("pts_half_ppr", false, false)[0]).toBe("half_ppr");
    expect(adpKeyPreference("pts_std", false, false)[0]).toBe("std");
    expect(adpKeyPreference("pts_ppr", false, false)[0]).toBe("ppr");
  });

  it("prefers every dynasty key over every redraft key in a dynasty format", () => {
    const order = adpKeyPreference("pts_ppr", true, false);
    const lastDynasty = Math.max(
      ...order.map((k, i) => (k.startsWith("dynasty_") ? i : -1)),
    );
    const firstRedraft = Math.min(
      ...order.map((k, i) => (k.startsWith("dynasty_") ? Number.MAX_SAFE_INTEGER : i)),
    );
    expect(firstRedraft).toBeLessThan(lastDynasty);
    // And the dynasty block leads.
    expect(order[0].startsWith("dynasty_")).toBe(true);
  });

  it("never repeats a key, so a fallback cannot be tried twice", () => {
    for (const dynasty of [true, false]) {
      for (const superflex of [true, false]) {
        for (const scoring of ["pts_ppr", "pts_half_ppr", "pts_std"] as const) {
          const order = adpKeyPreference(scoring, dynasty, superflex);
          expect(new Set(order).size).toBe(order.length);
        }
      }
    }
  });

  it("always offers a fallback, so an unusual format still shows a number", () => {
    const order = adpKeyPreference("pts_std", true, true);
    expect(order.length).toBeGreaterThanOrEqual(6);
    expect(order).toContain("ppr");
  });
});

/**
 * The latent defect from plan section 2.1: projectPlayerWeek used to be
 * called with `scoringSettings: null`, and closestScoringBase(null) always
 * picks pts_std, so a PPR reader saw the standard-scoring column. Section
 * 2.6's fix is scoringSettingsForContext, which builds the same minimal
 * `{ rec }` map lib/league-scoring.ts scoringSettingsForFormat produces, from
 * the ExtrasContext loadBreakdownExtras already holds. These tests pin the
 * fix at the exact seam loadBreakdownExtras uses it at: feeding the built
 * map straight into projectPlayerWeek and checking which stored column comes
 * back.
 */
describe("scoringSettingsForContext feeding projectPlayerWeek", () => {
  const baseContext: ExtrasContext = {
    scoringKey: "pts_ppr",
    formatConfigId: "fmt-1",
    valueSource: "ktc",
    isDynasty: false,
    isSuperflex: false,
    tePremiumPerReception: 0,
  };

  // Distinct per column so a wrong column selection cannot pass by accident.
  const projection: ProjectionRow = {
    playerId: "p1",
    week: 1,
    opponent: null, // neutral: opponentMultiplier(defense, [], null, ...) is 1
    statLine: null,
    ppr: 20,
    halfPpr: 15,
    std: 10,
  };

  function projectWr(context: ExtrasContext) {
    return projectPlayerWeek({
      projection,
      subject: { position: "WR", injuryStatus: null },
      accuracy: null,
      reliability: 1,
      scoringSettings: scoringSettingsForContext(context),
      defense: new Map(),
      defenseSeasons: [],
      week: 1,
      currentWeek: 1,
      settings: DEFAULT_POWER_PULSE_SETTINGS,
    });
  }

  it("a PPR format reads the pts_ppr column, not pts_std", () => {
    const projected = projectWr(baseContext);
    expect(projected?.rawPoints).toBe(20);
    expect(projected?.points).toBe(20);
  });

  it("a half-PPR format reads the pts_half_ppr column", () => {
    const projected = projectWr({ ...baseContext, scoringKey: "pts_half_ppr" });
    expect(projected?.rawPoints).toBe(15);
  });

  it("a standard format reads the pts_std column", () => {
    const projected = projectWr({ ...baseContext, scoringKey: "pts_std" });
    expect(projected?.rawPoints).toBe(10);
  });

  it("never accidentally falls to pts_std for a PPR reader", () => {
    const projected = projectWr(baseContext);
    expect(projected?.rawPoints).not.toBe(projection.std);
  });
});
