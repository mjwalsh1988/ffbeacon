import { describe, it, expect } from "vitest";
import { adpKeyPreference } from "./load-extras";

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
