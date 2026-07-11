import { describe, it, expect } from "vitest";
import {
  evaluatePlayerEligibility,
  loadEligiblePool,
  listEligibilityChecks,
  ELIGIBILITY_CHECKS,
  type PlayerEligibilityInput,
} from "./eligibility";
import { DEFAULT_SIGNAL_SCOUT_SETTINGS } from "./default-settings";

function baseInput(overrides: Partial<PlayerEligibilityInput> = {}): PlayerEligibilityInput {
  return {
    id: "p1",
    position: "RB",
    birth_date: "1998-01-01",
    years_experience: 3,
    height_inches: 70,
    weight_lbs: 210,
    inRankingsWindow: true,
    hiddenOverride: false,
    eligiblePositions: ["QB", "RB", "WR", "TE"],
    clueCoverage: {
      starterCandidates: 5,
      generatableByTier: { weak: 4, clear: 4, ping: 4, scan: 4 },
    },
    ...overrides,
  };
}

function checkFor(result: ReturnType<typeof evaluatePlayerEligibility>, key: string) {
  const check = result.checks.find((c) => c.key === key);
  if (!check) throw new Error(`missing check ${key}`);
  return check;
}

describe("listEligibilityChecks", () => {
  it("returns the full check catalog in evaluation order", () => {
    expect(listEligibilityChecks()).toEqual(ELIGIBILITY_CHECKS);
    expect(listEligibilityChecks().map((c) => c.key)).toEqual([
      "position",
      "rankings_window",
      "required_fields",
      "clue_coverage",
      "not_hidden",
    ]);
  });
});

describe("evaluatePlayerEligibility", () => {
  it("passes every check and is eligible when all inputs are valid", () => {
    const result = evaluatePlayerEligibility(baseInput());
    expect(result.eligible).toBe(true);
    expect(result.checks).toHaveLength(5);
    for (const check of result.checks) {
      expect(check.pass).toBe(true);
    }
  });

  describe("position check", () => {
    it("fails when position is not in eligiblePositions", () => {
      const result = evaluatePlayerEligibility(
        baseInput({ position: "K", eligiblePositions: ["QB", "RB", "WR", "TE"] }),
      );
      expect(result.eligible).toBe(false);
      const check = checkFor(result, "position");
      expect(check.pass).toBe(false);
      expect(check.detail).toBe("Position K is not in the eligible pool (QB, RB, WR, TE).");
    });

    it("fails when the pool has been narrowed to exclude this player's position", () => {
      const result = evaluatePlayerEligibility(
        baseInput({ position: "QB", eligiblePositions: ["RB", "WR", "TE"] }),
      );
      expect(result.eligible).toBe(false);
      const check = checkFor(result, "position");
      expect(check.pass).toBe(false);
      expect(check.detail).toBe("Position QB is not in the eligible pool (RB, WR, TE).");
    });

    it("passes with a passing detail when position is in the pool", () => {
      const result = evaluatePlayerEligibility(baseInput({ position: "RB" }));
      const check = checkFor(result, "position");
      expect(check.pass).toBe(true);
      expect(check.detail).toBe("Position RB is in the eligible pool (QB, RB, WR, TE).");
    });
  });

  describe("rankings_window check", () => {
    it("fails when the player is not in the rankings window", () => {
      const result = evaluatePlayerEligibility(baseInput({ inRankingsWindow: false }));
      expect(result.eligible).toBe(false);
      const check = checkFor(result, "rankings_window");
      expect(check.pass).toBe(false);
      expect(check.detail).toBe("Player has not appeared in rankings within the last 90 days.");
    });
  });

  describe("required_fields check", () => {
    it("fails and lists a single missing field", () => {
      const result = evaluatePlayerEligibility(baseInput({ birth_date: null }));
      expect(result.eligible).toBe(false);
      const check = checkFor(result, "required_fields");
      expect(check.pass).toBe(false);
      expect(check.detail).toBe("Missing required field: birth date.");
    });

    it("fails and lists multiple missing fields", () => {
      const result = evaluatePlayerEligibility(
        baseInput({ years_experience: null, height_inches: null }),
      );
      const check = checkFor(result, "required_fields");
      expect(check.pass).toBe(false);
      expect(check.detail).toBe("Missing required fields: years of experience, height.");
    });

    it("fails when weight is missing", () => {
      const result = evaluatePlayerEligibility(baseInput({ weight_lbs: null }));
      const check = checkFor(result, "required_fields");
      expect(check.pass).toBe(false);
      expect(check.detail).toBe("Missing required field: weight.");
    });

    it("treats years_experience of 0 as present, not missing", () => {
      const result = evaluatePlayerEligibility(baseInput({ years_experience: 0 }));
      const check = checkFor(result, "required_fields");
      expect(check.pass).toBe(true);
      expect(check.detail).toBe(
        "Birth date, years of experience, height, and weight are all present.",
      );
      expect(result.eligible).toBe(true);
    });
  });

  describe("clue_coverage check", () => {
    it("fails with the not-computed detail when coverage is null", () => {
      const result = evaluatePlayerEligibility(baseInput({ clueCoverage: null }));
      expect(result.eligible).toBe(false);
      const check = checkFor(result, "clue_coverage");
      expect(check.pass).toBe(false);
      expect(check.detail).toBe("Clue coverage not computed");
    });

    it("passes at exactly 3 starter candidates", () => {
      const result = evaluatePlayerEligibility(
        baseInput({
          clueCoverage: {
            starterCandidates: 3,
            generatableByTier: { weak: 2, clear: 2, ping: 2, scan: 2 },
          },
        }),
      );
      const check = checkFor(result, "clue_coverage");
      expect(check.pass).toBe(true);
      expect(result.eligible).toBe(true);
    });

    it("fails at 2 starter candidates", () => {
      const result = evaluatePlayerEligibility(
        baseInput({
          clueCoverage: {
            starterCandidates: 2,
            generatableByTier: { weak: 4, clear: 4, ping: 4, scan: 4 },
          },
        }),
      );
      const check = checkFor(result, "clue_coverage");
      expect(check.pass).toBe(false);
      expect(check.detail).toContain("only 2 starter candidates (need at least 3)");
    });

    it("fails when a single paid tier is under the minimum even if the others are high", () => {
      const result = evaluatePlayerEligibility(
        baseInput({
          clueCoverage: {
            starterCandidates: 10,
            generatableByTier: { weak: 9, clear: 9, ping: 9, scan: 1 },
          },
        }),
      );
      const check = checkFor(result, "clue_coverage");
      expect(check.pass).toBe(false);
      expect(check.detail).toBe("Clue coverage is insufficient: not enough generatable clues in tier: scan (1).");
    });

    it("lists every short tier when more than one is under the minimum", () => {
      const result = evaluatePlayerEligibility(
        baseInput({
          clueCoverage: {
            starterCandidates: 10,
            generatableByTier: { weak: 0, clear: 9, ping: 1, scan: 9 },
          },
        }),
      );
      const check = checkFor(result, "clue_coverage");
      expect(check.pass).toBe(false);
      expect(check.detail).toBe(
        "Clue coverage is insufficient: not enough generatable clues in tiers: weak (0), ping (1).",
      );
    });
  });

  describe("not_hidden check", () => {
    it("fails when the player has an admin-hidden override", () => {
      const result = evaluatePlayerEligibility(baseInput({ hiddenOverride: true }));
      expect(result.eligible).toBe(false);
      const check = checkFor(result, "not_hidden");
      expect(check.pass).toBe(false);
      expect(check.detail).toBe("Player is hidden by an admin override.");
    });
  });
});

// --- loadEligiblePool with a mocked Supabase chain --------------------------

/**
 * Minimal chainable Supabase mock matching the three queries loadEligiblePool
 * issues: players.select().in().limit(), rankings.select().gte().limit(), and
 * signal_scout_player_overrides.select().eq(). Mirrors the mocking style in
 * lib/signal-scout/settings.test.ts (one canned resolved value per table).
 */
function mockSupabase(opts: {
  players?: Array<{
    id: string;
    position: string;
    birth_date: string | null;
    years_experience: number | null;
    height_inches: number | null;
    weight_lbs: number | null;
  }>;
  playersError?: unknown;
  rankedPlayerIds?: string[];
  rankingsError?: unknown;
  hiddenPlayerIds?: string[];
  hiddenError?: unknown;
}) {
  const tables: Record<string, unknown> = {
    players: {
      select: () => ({
        in: () => ({
          limit: () =>
            Promise.resolve({ data: opts.players ?? [], error: opts.playersError ?? null }),
        }),
      }),
    },
    rankings: {
      select: () => ({
        gte: () => ({
          limit: () =>
            Promise.resolve({
              data: (opts.rankedPlayerIds ?? []).map((id) => ({ player_id: id })),
              error: opts.rankingsError ?? null,
            }),
        }),
      }),
    },
    signal_scout_player_overrides: {
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: (opts.hiddenPlayerIds ?? []).map((id) => ({ player_id: id })),
            error: opts.hiddenError ?? null,
          }),
      }),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => tables[table] } as any;
}

describe("loadEligiblePool", () => {
  it("returns an empty array when there are no candidate players", async () => {
    const supabase = mockSupabase({ players: [] });
    const pool = await loadEligiblePool(supabase, DEFAULT_SIGNAL_SCOUT_SETTINGS);
    expect(pool).toEqual([]);
  });

  it("marks players in the rankings window and leaves others out", async () => {
    const supabase = mockSupabase({
      players: [
        {
          id: "p1",
          position: "RB",
          birth_date: "1998-01-01",
          years_experience: 3,
          height_inches: 70,
          weight_lbs: 210,
        },
        {
          id: "p2",
          position: "WR",
          birth_date: null,
          years_experience: 1,
          height_inches: 72,
          weight_lbs: 190,
        },
      ],
      rankedPlayerIds: ["p1"],
      hiddenPlayerIds: [],
    });

    const pool = await loadEligiblePool(supabase, DEFAULT_SIGNAL_SCOUT_SETTINGS);
    expect(pool).toHaveLength(2);

    const p1 = pool.find((p) => p.id === "p1")!;
    expect(p1.inRankingsWindow).toBe(true);
    expect(p1.hiddenOverride).toBe(false);
    expect(p1.eligiblePositions).toEqual(DEFAULT_SIGNAL_SCOUT_SETTINGS.pool.eligible_positions);
    expect("clueCoverage" in p1).toBe(false);

    const p2 = pool.find((p) => p.id === "p2")!;
    expect(p2.inRankingsWindow).toBe(false);
    expect(p2.birth_date).toBeNull();
  });

  it("marks players in the hidden override set", async () => {
    const supabase = mockSupabase({
      players: [
        {
          id: "p1",
          position: "QB",
          birth_date: "1995-05-05",
          years_experience: 5,
          height_inches: 74,
          weight_lbs: 225,
        },
      ],
      rankedPlayerIds: ["p1"],
      hiddenPlayerIds: ["p1"],
    });

    const pool = await loadEligiblePool(supabase, DEFAULT_SIGNAL_SCOUT_SETTINGS);
    expect(pool[0].hiddenOverride).toBe(true);
  });

  it("throws when the players query errors", async () => {
    const supabase = mockSupabase({ playersError: { message: "boom" } });
    await expect(loadEligiblePool(supabase, DEFAULT_SIGNAL_SCOUT_SETTINGS)).rejects.toBeTruthy();
  });

  it("throws when the rankings query errors", async () => {
    const supabase = mockSupabase({
      players: [
        {
          id: "p1",
          position: "QB",
          birth_date: "1995-05-05",
          years_experience: 5,
          height_inches: 74,
          weight_lbs: 225,
        },
      ],
      rankingsError: { message: "boom" },
    });
    await expect(loadEligiblePool(supabase, DEFAULT_SIGNAL_SCOUT_SETTINGS)).rejects.toBeTruthy();
  });

  it("throws when the hidden overrides query errors", async () => {
    const supabase = mockSupabase({
      players: [
        {
          id: "p1",
          position: "QB",
          birth_date: "1995-05-05",
          years_experience: 5,
          height_inches: 74,
          weight_lbs: 225,
        },
      ],
      hiddenError: { message: "boom" },
    });
    await expect(loadEligiblePool(supabase, DEFAULT_SIGNAL_SCOUT_SETTINGS)).rejects.toBeTruthy();
  });
});
