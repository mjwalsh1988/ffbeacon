import { describe, expect, it } from "vitest";
import {
  WARM_STALE_ACTOR_BUDGET,
  WARM_UNKNOWN_ACTOR_BUDGET,
  warmBudgetFor,
} from "@/lib/league-endpoint-limits";

const TTL = 60 * 60 * 1000;
const NOW = Date.parse("2026-09-29T12:00:00Z");

describe("warmBudgetFor", () => {
  it("claims the tight budget for a league id we have never stored", () => {
    expect(warmBudgetFor(null, NOW, TTL)).toBe(WARM_UNKNOWN_ACTOR_BUDGET);
  });

  it("claims nothing for a stored league pulsed inside the cache window", () => {
    const row = {
      last_pulsed_at: new Date(NOW - 5 * 60 * 1000).toISOString(),
      pulse_status: "complete",
    };
    expect(warmBudgetFor(row, NOW, TTL)).toBeNull();
  });

  it("claims the stale budget once the cache window has passed", () => {
    const row = {
      last_pulsed_at: new Date(NOW - TTL - 1).toISOString(),
      pulse_status: "complete",
    };
    expect(warmBudgetFor(row, NOW, TTL)).toBe(WARM_STALE_ACTOR_BUDGET);
  });

  it("treats a recent but unfinished pulse as able to reach Sleeper", () => {
    const row = {
      last_pulsed_at: new Date(NOW - 60 * 1000).toISOString(),
      pulse_status: "syncing",
    };
    expect(warmBudgetFor(row, NOW, TTL)).toBe(WARM_STALE_ACTOR_BUDGET);
  });

  it("treats a stored league that never pulsed as stale", () => {
    expect(
      warmBudgetFor({ last_pulsed_at: null, pulse_status: "pending" }, NOW, TTL),
    ).toBe(WARM_STALE_ACTOR_BUDGET);
  });

  it("keeps the never-stored budget tighter than the stale one", () => {
    const perSecondNew = WARM_UNKNOWN_ACTOR_BUDGET.max / WARM_UNKNOWN_ACTOR_BUDGET.windowSeconds;
    const perSecondStale = WARM_STALE_ACTOR_BUDGET.max / WARM_STALE_ACTOR_BUDGET.windowSeconds;
    expect(perSecondNew).toBeLessThan(perSecondStale);
  });
});
