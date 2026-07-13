import { describe, it, expect, vi } from "vitest";

// sleeper-sync.ts is "server-only"; neutralize for the node test.
vi.mock("server-only", () => ({}));

import { resolveAuthoritativeBinding } from "@/lib/on-the-clock/sleeper-sync";

/**
 * FFB-SEC-003: the Sleeper draft object is authoritative for a draft's league binding.
 * These cover the decision the sync path makes before fetching users/rosters/traded
 * picks and upserting the shared cache. Because every sync runs through this resolver,
 * a resync always self-heals a previously poisoned cache row.
 */
describe("resolveAuthoritativeBinding", () => {
  it("uses the draft object's league/season when the hint matches", () => {
    const b = resolveAuthoritativeBinding({ league_id: "111", season: "2026" }, "111", "2026");
    expect(b).toEqual({ leagueId: "111", season: "2026", mismatched: false });
  });

  it("IGNORES a mismatched client league_id (uses the draft's true league)", () => {
    const b = resolveAuthoritativeBinding({ league_id: "111", season: "2026" }, "999", "2026");
    expect(b.leagueId).toBe("111");
    expect(b.mismatched).toBe(true);
  });

  it("ignores a mismatched client season", () => {
    const b = resolveAuthoritativeBinding({ league_id: "111", season: "2026" }, "111", "1999");
    expect(b.season).toBe("2026");
  });

  it("uses the draft object even when no hint is supplied (empty hints)", () => {
    const b = resolveAuthoritativeBinding({ league_id: "111", season: "2026" }, "", "");
    expect(b).toEqual({ leagueId: "111", season: "2026", mismatched: false });
  });

  it("falls back to the hint only when the draft object omits the league id", () => {
    const b = resolveAuthoritativeBinding({ league_id: null, season: null }, "222", "2026");
    expect(b.leagueId).toBe("222");
    expect(b.season).toBe("2026");
    expect(b.mismatched).toBe(false); // no draft value to disagree with
  });
});
