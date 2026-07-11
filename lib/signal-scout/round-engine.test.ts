import { describe, it, expect } from "vitest";
import {
  startRound,
  purchaseHint,
  submitGuess,
  skipRound,
  getRound,
  weighTargetCandidates,
  pickWeightedTarget,
  computeLockedCounts,
  computePurchasesRemaining,
  computeTierCosts,
  isTierDisabled,
  TOP_RANK_THRESHOLD,
  TOP_RANK_WEIGHT,
  TAIL_WEIGHT,
  type RoundIdentity,
  type ActiveRoundDto,
  type CompletedRoundDto,
} from "./round-engine";
import { DEFAULT_SIGNAL_SCOUT_SETTINGS } from "./default-settings";
import { CLUE_DEFINITIONS } from "./clues";
import { currentEasternGameDate } from "./streaks";
import type { SignalScoutSettings } from "./types";

// ---------------------------------------------------------------------------
// Reusable chainable mock (queue-based per table, mirroring clues.test.ts's
// makeMockSupabase but extended with insert/update/upsert and a callLog for
// payload inspection).
// ---------------------------------------------------------------------------

type MockResult = { data: unknown; error: unknown };
type LoggedCall = { table: string; method: string; args: unknown[] };

function makeMockSupabase(responses: Record<string, MockResult[]>) {
  const callCounts: Record<string, number> = {};
  const callLog: LoggedCall[] = [];

  function nextResult(table: string): MockResult {
    const idx = callCounts[table] ?? 0;
    callCounts[table] = idx + 1;
    const list = responses[table] ?? [];
    return list[idx] ?? list[list.length - 1] ?? { data: null, error: null };
  }

  function makeBuilder(table: string) {
    const result = nextResult(table);
    const record = (method: string, args: unknown[]) => callLog.push({ table, method, args });
    const builder: Record<string, unknown> = {
      select: (...a: unknown[]) => {
        record("select", a);
        return builder;
      },
      insert: (...a: unknown[]) => {
        record("insert", a);
        return builder;
      },
      update: (...a: unknown[]) => {
        record("update", a);
        return builder;
      },
      upsert: (...a: unknown[]) => {
        record("upsert", a);
        return builder;
      },
      eq: (...a: unknown[]) => {
        record("eq", a);
        return builder;
      },
      in: (...a: unknown[]) => {
        record("in", a);
        return builder;
      },
      gte: (...a: unknown[]) => {
        record("gte", a);
        return builder;
      },
      order: (...a: unknown[]) => {
        record("order", a);
        return builder;
      },
      limit: (...a: unknown[]) => {
        record("limit", a);
        return builder;
      },
      maybeSingle: () => Promise.resolve(result),
      single: () => Promise.resolve(result),
      then: (resolve: (v: MockResult) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return builder;
  }

  const from = (table: string) => makeBuilder(table);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: { from } as any, callCounts, callLog };
}

function insertArgsFor(callLog: LoggedCall[], table: string, occurrence = 0): unknown {
  const inserts = callLog.filter((c) => c.table === table && c.method === "insert");
  return inserts[occurrence]?.args[0];
}

function upsertArgsFor(callLog: LoggedCall[], table: string, occurrence = 0): unknown {
  const upserts = callLog.filter((c) => c.table === table && c.method === "upsert");
  return upserts[occurrence]?.args[0];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function settingsSnapshot(overrides: Partial<SignalScoutSettings> = {}): SignalScoutSettings {
  return { ...DEFAULT_SIGNAL_SCOUT_SETTINGS, ...overrides };
}

function makeRoundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "round-1",
    user_id: "user-1",
    guest_id: null,
    ip_hash: null,
    target_player_id: "target-1",
    status: "active",
    score_available: 1000,
    score_awarded: 0,
    wrong_guess_count: 0,
    hints_used: 0,
    tier_purchases: {},
    burned_out_at: null,
    settings_snapshot: settingsSnapshot(),
    game_date: "2026-07-09",
    started_at: "2026-07-09T12:00:00.000Z",
    completed_at: null,
    ...overrides,
  };
}

function makeClueRow(overrides: Record<string, unknown> = {}) {
  return {
    round_id: "round-1",
    clue_key: "age_range",
    tier: "starter",
    label: "Age range",
    display_value: "24 to 25 years old",
    specificity: 2,
    cost: 0,
    is_revealed: true,
    reveal_order: 1,
    revealed_at: "2026-07-09T12:00:00.000Z",
    ...overrides,
  };
}

function makePlayerReveal(overrides: Record<string, unknown> = {}) {
  return {
    id: "p-1",
    first_name: "John",
    last_name: "Doe",
    full_name: null,
    position: "WR",
    team: "DAL",
    external_ids: { sleeper: "1234" },
    ...overrides,
  };
}

const userIdentity: RoundIdentity = { kind: "user", userId: "user-1" };
const guestIdentity: RoundIdentity = { kind: "guest", guestId: "guest-1", ipHash: "hash-1" };

function asActive(round: unknown): ActiveRoundDto {
  return round as ActiveRoundDto;
}
function asCompleted(round: unknown): CompletedRoundDto {
  return round as CompletedRoundDto;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("weighTargetCandidates", () => {
  it("gives top-150-ranked players TOP_RANK_WEIGHT and everyone else TAIL_WEIGHT", () => {
    const pool = [
      { id: "top", position: "WR" },
      { id: "deep-cut", position: "WR" },
      { id: "unranked", position: "WR" },
    ];
    const ranks = new Map([
      ["top", 1],
      ["deep-cut", TOP_RANK_THRESHOLD + 1],
    ]);
    const weighted = weighTargetCandidates(pool, ranks, new Set());
    expect(weighted.find((c) => c.id === "top")?.weight).toBe(TOP_RANK_WEIGHT);
    expect(weighted.find((c) => c.id === "deep-cut")?.weight).toBe(TAIL_WEIGHT);
    expect(weighted.find((c) => c.id === "unranked")?.weight).toBe(TAIL_WEIGHT);
  });

  it("treats a rank exactly at the threshold as top-ranked (inclusive)", () => {
    const pool = [{ id: "edge", position: "WR" }];
    const ranks = new Map([["edge", TOP_RANK_THRESHOLD]]);
    const weighted = weighTargetCandidates(pool, ranks, new Set());
    expect(weighted[0].weight).toBe(TOP_RANK_WEIGHT);
  });

  it("excludes ids in the excluded set (the last-10 rule)", () => {
    const pool = [
      { id: "a", position: "WR" },
      { id: "b", position: "WR" },
    ];
    const weighted = weighTargetCandidates(pool, new Map(), new Set(["a"]));
    expect(weighted.map((c) => c.id)).toEqual(["b"]);
  });
});

describe("pickWeightedTarget", () => {
  it("returns null for an empty candidate list", () => {
    expect(pickWeightedTarget([], () => 0.5)).toBeNull();
  });

  it("picks proportionally to weight via the injected rng", () => {
    const candidates = [
      { id: "a", position: "WR", weight: 4 },
      { id: "b", position: "WR", weight: 1 },
    ];
    // total weight 5; rng()*5 = 0 lands inside a's [0,4) slice
    expect(pickWeightedTarget(candidates, () => 0)?.id).toBe("a");
    // rng()*5 = 4.5 lands inside b's [4,5) slice
    expect(pickWeightedTarget(candidates, () => 0.9)?.id).toBe("b");
  });
});

describe("computeLockedCounts / computePurchasesRemaining / computeTierCosts", () => {
  it("counts only unrevealed rows per tier, ignoring starter rows", () => {
    const rows = [
      makeClueRow({ clue_key: "a", tier: "starter", is_revealed: true }),
      makeClueRow({ clue_key: "b", tier: "weak", is_revealed: false }),
      makeClueRow({ clue_key: "c", tier: "weak", is_revealed: false }),
      makeClueRow({ clue_key: "d", tier: "clear", is_revealed: true }),
    ];
    expect(computeLockedCounts(rows)).toEqual({ weak: 2, clear: 0, ping: 0, scan: 0 });
  });

  it("clamps purchases remaining at 0 and never goes negative", () => {
    const remaining = computePurchasesRemaining(DEFAULT_SIGNAL_SCOUT_SETTINGS.clues.tier_limits, { weak: 99 });
    expect(remaining.weak).toBe(0);
    expect(remaining.clear).toBe(DEFAULT_SIGNAL_SCOUT_SETTINGS.clues.tier_limits.clear);
  });

  it("maps every tier to its configured cost", () => {
    const costs = computeTierCosts(DEFAULT_SIGNAL_SCOUT_SETTINGS.scoring);
    expect(costs).toEqual({ weak: 100, clear: 200, ping: 350, scan: 500 });
  });
});

describe("isTierDisabled", () => {
  it("is false when only some of a tier's clue keys are disabled", () => {
    expect(isTierDisabled("weak", ["age_range"])).toBe(false);
  });

  it("is true only when every clue key of the tier is disabled", () => {
    const weakKeys = CLUE_DEFINITIONS.filter((d) => d.tier === "weak").map((d) => d.key);
    expect(isTierDisabled("weak", weakKeys)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// startRound
// ---------------------------------------------------------------------------

describe("startRound", () => {
  it("returns game_disabled without touching the round tables", async () => {
    const { supabase, callCounts } = makeMockSupabase({
      signal_scout_settings: [{ data: { settings: settingsSnapshot({ game_enabled: false }) }, error: null }],
    });
    const result = await startRound(supabase, userIdentity);
    expect(result).toEqual({ ok: false, code: "game_disabled" });
    expect(callCounts.signal_scout_rounds ?? 0).toBe(0);
  });

  it("returns active_round_exists with the existing round id", async () => {
    const { supabase } = makeMockSupabase({
      signal_scout_settings: [{ data: { settings: settingsSnapshot() }, error: null }],
      signal_scout_rounds: [{ data: { id: "existing-round" }, error: null }],
    });
    const result = await startRound(supabase, userIdentity);
    expect(result).toEqual({ ok: false, code: "active_round_exists", existingRoundId: "existing-round" });
  });

  it("returns pool_empty when the structural pool is empty", async () => {
    const { supabase } = makeMockSupabase({
      signal_scout_settings: [{ data: { settings: settingsSnapshot() }, error: null }],
      signal_scout_rounds: [{ data: null, error: null }],
      players: [{ data: [], error: null }],
    });
    const result = await startRound(supabase, userIdentity);
    expect(result).toEqual({ ok: false, code: "pool_empty" });
  });

  it("returns pool_empty when every candidate fails coverage and the pool is exhausted", async () => {
    const poolPlayers = [
      { id: "player-c", position: "WR", birth_date: "1999-01-01", years_experience: 3, height_inches: 72, weight_lbs: 200 },
      { id: "player-d", position: "WR", birth_date: "1998-01-01", years_experience: 5, height_inches: 74, weight_lbs: 210 },
    ];
    // team: null and no stats rows means only last_name_initial is generatable in the
    // scan tier (1 < MIN_GENERATABLE_PER_TIER of 2), so both candidates fail eligibility.
    const fullC = { id: "player-c", position: "WR", first_name: "Cam", last_name: "Carter", full_name: null, birth_date: "1999-01-01", years_experience: 3, height_inches: 72, weight_lbs: 200, college: "State", team: null, metadata: {}, external_ids: {} };
    const fullD = { id: "player-d", position: "WR", first_name: "Dan", last_name: "Diaz", full_name: null, birth_date: "1998-01-01", years_experience: 5, height_inches: 74, weight_lbs: 210, college: "Tech", team: null, metadata: {}, external_ids: {} };

    const { supabase } = makeMockSupabase({
      signal_scout_settings: [{ data: { settings: settingsSnapshot() }, error: null }],
      signal_scout_rounds: [
        { data: null, error: null }, // findActiveRound
        { data: [], error: null }, // loadRecentTargetIds
      ],
      players: [
        { data: poolPlayers, error: null }, // loadEligiblePool
        { data: fullC, error: null }, // loadFullPlayer(C)
        { data: fullD, error: null }, // loadFullPlayer(D)
      ],
      rankings: [
        { data: [{ player_id: "player-c" }, { player_id: "player-d" }], error: null }, // loadEligiblePool ranked ids
        { data: [], error: null }, // loadLatestOverallRanks
        { data: { overall_rank: 500 }, error: null }, // loadValueFacts(C)
        { data: { overall_rank: 600 }, error: null }, // loadValueFacts(D)
      ],
      signal_scout_player_overrides: [{ data: [], error: null }],
      format_configs: [
        { data: { id: "fmt-1" }, error: null }, // loadLatestOverallRanks
        { data: { id: "fmt-1" }, error: null }, // loadValueFacts(C)
        { data: { id: "fmt-1" }, error: null }, // loadValueFacts(D)
      ],
      player_stats: [
        { data: [], error: null }, // C
        { data: [], error: null }, // D
      ],
      player_value_trends: [
        { data: { current_value: 5000, change_30d_pct: 5, data_points_30d: 10 }, error: null }, // C
        { data: { current_value: 4000, change_30d_pct: 5, data_points_30d: 10 }, error: null }, // D
      ],
      player_market_snapshots: [
        { data: null, error: null }, // C
        { data: null, error: null }, // D
      ],
    });

    const result = await startRound(supabase, userIdentity, { rng: () => 0.1 });
    expect(result).toEqual({ ok: false, code: "pool_empty" });
  });

  it("rerolls past a coverage-failing candidate and inserts starter (cost 0, revealed) and paid (snapshot cost, locked) clue rows", async () => {
    const poolPlayers = [
      { id: "player-a", position: "WR", birth_date: "1999-01-01", years_experience: 3, height_inches: 72, weight_lbs: 200 },
      { id: "player-b", position: "WR", birth_date: "1998-01-01", years_experience: 5, height_inches: 74, weight_lbs: 210 },
    ];
    // Player A: team null, no stats -> scan tier coverage insufficient -> reroll.
    const fullA = { id: "player-a", position: "WR", first_name: "Al", last_name: "Anderson", full_name: null, birth_date: "1999-01-01", years_experience: 3, height_inches: 72, weight_lbs: 200, college: "State", team: null, metadata: {}, external_ids: {} };
    // Player B: team set, adp + 30d movement present -> passes every tier.
    const fullB = { id: "player-b", position: "WR", first_name: "Bob", last_name: "Baker", full_name: null, birth_date: "1998-01-01", years_experience: 5, height_inches: 74, weight_lbs: 210, college: "Tech", team: "DAL", metadata: {}, external_ids: { sleeper: "1002" } };

    const { supabase, callLog } = makeMockSupabase({
      signal_scout_settings: [{ data: { settings: settingsSnapshot() }, error: null }],
      signal_scout_rounds: [
        { data: null, error: null }, // findActiveRound
        { data: [], error: null }, // loadRecentTargetIds
        { data: makeRoundRow({ id: "new-round", target_player_id: "player-b" }), error: null }, // insert
      ],
      players: [
        { data: poolPlayers, error: null }, // loadEligiblePool
        { data: fullA, error: null }, // loadFullPlayer(A)
        { data: fullB, error: null }, // loadFullPlayer(B)
      ],
      rankings: [
        { data: [{ player_id: "player-a" }, { player_id: "player-b" }], error: null }, // loadEligiblePool ranked ids
        { data: [], error: null }, // loadLatestOverallRanks (no ranks -> both tail weight)
        { data: { overall_rank: 500 }, error: null }, // loadValueFacts(A)
        { data: { overall_rank: 20 }, error: null }, // loadValueFacts(B)
      ],
      signal_scout_player_overrides: [{ data: [], error: null }],
      format_configs: [
        { data: { id: "fmt-1" }, error: null }, // loadLatestOverallRanks
        { data: { id: "fmt-1" }, error: null }, // loadValueFacts(A)
        { data: { id: "fmt-1" }, error: null }, // loadValueFacts(B)
      ],
      player_stats: [
        { data: [], error: null }, // A
        { data: [], error: null }, // B
      ],
      nfl_teams: [{ data: { name: "Dallas Cowboys", conference: "NFC", division: "NFC East" }, error: null }], // B only
      player_value_trends: [
        { data: { current_value: 5000, change_30d_pct: 5, data_points_30d: 10 }, error: null }, // A
        { data: { current_value: 9000, change_30d_pct: 15, data_points_30d: 10 }, error: null }, // B
      ],
      player_market_snapshots: [
        { data: null, error: null }, // A
        { data: { adp: { dynasty_2qb: 15 } }, error: null }, // B
      ],
      signal_scout_round_clues: [{ data: null, error: null }],
    });

    const result = await startRound(supabase, userIdentity, { rng: () => 0.1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Reroll happened: three players() calls (pool + A + B), and the inserted
    // round targets player-b, not player-a.
    const roundInsertArgs = insertArgsFor(callLog, "signal_scout_rounds", 0) as { target_player_id: string };
    expect(roundInsertArgs.target_player_id).toBe("player-b");

    const clueInsertArgs = insertArgsFor(callLog, "signal_scout_round_clues", 0) as Array<{
      tier: string;
      cost: number;
      is_revealed: boolean;
      reveal_order: number | null;
    }>;
    const starterRows = clueInsertArgs.filter((r) => r.tier === "starter");
    const paidRows = clueInsertArgs.filter((r) => r.tier !== "starter");

    expect(starterRows.length).toBeGreaterThan(0);
    for (const row of starterRows) {
      expect(row.cost).toBe(0);
      expect(row.is_revealed).toBe(true);
      expect(row.reveal_order).not.toBeNull();
    }
    for (const row of paidRows) {
      expect(row.is_revealed).toBe(false);
      expect(row.reveal_order).toBeNull();
      expect(row.cost).toBe(computeTierCosts(DEFAULT_SIGNAL_SCOUT_SETTINGS.scoring)[row.tier as "weak" | "clear" | "ping" | "scan"]);
    }

    const dto = asActive(result.round);
    expect(dto.guest).toBe(false);
    expect(dto.score).toBe(1000);
    expect(dto.revealedClues.every((c) => c.tier === "starter")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// purchaseHint
// ---------------------------------------------------------------------------

describe("purchaseHint", () => {
  it("returns invalid_tier for an out-of-enum tier value and performs zero DB reads/writes", async () => {
    const { supabase, callCounts } = makeMockSupabase({
      signal_scout_rounds: [{ data: makeRoundRow(), error: null }],
    });
    // A cast simulates an out-of-enum string reaching the engine (e.g. an
    // unvalidated client payload in Phase 3), which the TypeScript type
    // alone cannot prevent at runtime.
    const result = await purchaseHint(supabase, userIdentity, "round-1", "bogus" as unknown as "weak", false);
    expect(result).toEqual({ ok: false, code: "invalid_tier" });
    expect(callCounts.signal_scout_rounds ?? 0).toBe(0);
    expect(callCounts.signal_scout_round_clues ?? 0).toBe(0);
  });

  it("returns not_found when the round belongs to a different identity", async () => {
    const { supabase } = makeMockSupabase({
      signal_scout_rounds: [{ data: makeRoundRow({ user_id: "someone-else" }), error: null }],
    });
    const result = await purchaseHint(supabase, userIdentity, "round-1", "weak", false);
    expect(result).toEqual({ ok: false, code: "not_found" });
  });

  it("returns tier_disabled when every clue key of the tier is admin-disabled in the snapshot", async () => {
    const weakKeys = CLUE_DEFINITIONS.filter((d) => d.tier === "weak").map((d) => d.key);
    const { supabase } = makeMockSupabase({
      signal_scout_rounds: [
        { data: makeRoundRow({ settings_snapshot: settingsSnapshot({ clues: { ...DEFAULT_SIGNAL_SCOUT_SETTINGS.clues, disabled_clue_keys: weakKeys } }) }), error: null },
      ],
    });
    const result = await purchaseHint(supabase, userIdentity, "round-1", "weak", false);
    expect(result).toEqual({ ok: false, code: "tier_disabled" });
  });

  it("passes through tier_limit_reached from evaluateHintPurchase", async () => {
    const { supabase } = makeMockSupabase({
      signal_scout_rounds: [{ data: makeRoundRow({ tier_purchases: { weak: 4 } }), error: null }],
      signal_scout_round_clues: [{ data: [makeClueRow({ clue_key: "weight", tier: "weak", is_revealed: false })], error: null }],
    });
    const result = await purchaseHint(supabase, userIdentity, "round-1", "weak", false);
    expect(result).toEqual({ ok: false, code: "tier_limit_reached" });
  });

  it("rejects a purchase outright when the signal is already burned out", async () => {
    const { supabase } = makeMockSupabase({
      signal_scout_rounds: [{ data: makeRoundRow({ score_available: 0 }), error: null }],
      signal_scout_round_clues: [{ data: [makeClueRow({ clue_key: "weight", tier: "weak", is_revealed: false })], error: null }],
    });
    const result = await purchaseHint(supabase, userIdentity, "round-1", "weak", false);
    expect(result).toEqual({ ok: false, code: "signal_burned" });
  });

  it("reveals exactly one clue, deducts cost, and stamps burned_out_at once when the purchase burns the signal", async () => {
    const clueRows = [
      makeClueRow({ clue_key: "weight", tier: "weak", is_revealed: false, reveal_order: null, revealed_at: null }),
      makeClueRow({ clue_key: "height", tier: "weak", is_revealed: false, reveal_order: null, revealed_at: null }),
    ];
    const round = makeRoundRow({ score_available: 100, hints_used: 0, tier_purchases: {}, burned_out_at: null });
    const revealedRow = { ...clueRows[0], is_revealed: true, reveal_order: 1, revealed_at: "2026-07-09T12:05:00.000Z" };

    const { supabase, callLog } = makeMockSupabase({
      signal_scout_rounds: [
        { data: round, error: null }, // fetchOwnedRound
        { data: { ...round, score_available: 0, hints_used: 1, tier_purchases: { weak: 1 } }, error: null }, // guardedActiveUpdate
      ],
      signal_scout_round_clues: [
        { data: clueRows, error: null }, // fetchRoundClues
        { data: revealedRow, error: null }, // reveal update
      ],
    });

    const result = await purchaseHint(supabase, userIdentity, "round-1", "weak", true, { rng: () => 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clue.clueKey).toBe("weight");
    expect(result.scoreAvailable).toBe(0);
    expect(result.burned).toBe(true);
    expect(result.hintsUsed).toBe(1);

    const updatePatch = callLog.find((c) => c.table === "signal_scout_rounds" && c.method === "update")?.args[0] as {
      burned_out_at: string | null;
    };
    expect(updatePatch.burned_out_at).not.toBeNull();
  });

  it("returns round_not_active when the guarded update misses (concurrent change)", async () => {
    const clueRows = [makeClueRow({ clue_key: "weight", tier: "weak", is_revealed: false })];
    const { supabase } = makeMockSupabase({
      signal_scout_rounds: [
        { data: makeRoundRow({ score_available: 500 }), error: null }, // fetchOwnedRound
        { data: null, error: null }, // guardedActiveUpdate misses
      ],
      signal_scout_round_clues: [{ data: clueRows, error: null }],
    });
    const result = await purchaseHint(supabase, userIdentity, "round-1", "weak", false);
    expect(result).toEqual({ ok: false, code: "round_not_active" });
  });

  it("passes through tier_exhausted when the tier has no unrevealed clues left", async () => {
    const { supabase } = makeMockSupabase({
      signal_scout_rounds: [{ data: makeRoundRow({ score_available: 500, tier_purchases: {} }), error: null }],
      signal_scout_round_clues: [
        { data: [makeClueRow({ clue_key: "weight", tier: "weak", is_revealed: true, reveal_order: 2 })], error: null },
      ],
    });
    const result = await purchaseHint(supabase, userIdentity, "round-1", "weak", false);
    expect(result).toEqual({ ok: false, code: "tier_exhausted" });
  });

  it("passes through burn_confirmation_required when cost >= score and confirmBurn is false", async () => {
    // weak_signal_cost defaults to 100; score_available of exactly 100 hits the burning-purchase boundary.
    const { supabase } = makeMockSupabase({
      signal_scout_rounds: [{ data: makeRoundRow({ score_available: 100, tier_purchases: {} }), error: null }],
      signal_scout_round_clues: [
        { data: [makeClueRow({ clue_key: "weight", tier: "weak", is_revealed: false, reveal_order: null, revealed_at: null })], error: null },
      ],
    });
    const result = await purchaseHint(supabase, userIdentity, "round-1", "weak", false);
    expect(result).toEqual({ ok: false, code: "burn_confirmation_required" });
  });
});

// ---------------------------------------------------------------------------
// submitGuess
// ---------------------------------------------------------------------------

describe("submitGuess", () => {
  it("rejects a duplicate guess for free (no round mutation)", async () => {
    const { supabase, callCounts } = makeMockSupabase({
      signal_scout_rounds: [{ data: makeRoundRow(), error: null }],
      signal_scout_guesses: [{ data: [{ guessed_player_id: "p-1", guess_number: 1 }], error: null }],
    });
    const result = await submitGuess(supabase, userIdentity, "round-1", "p-1");
    expect(result).toEqual({ ok: false, code: "guess_duplicate" });
    expect(callCounts.players ?? 0).toBe(0);
  });

  it("rejects a guess for a player outside the eligible positions", async () => {
    const { supabase } = makeMockSupabase({
      signal_scout_rounds: [{ data: makeRoundRow(), error: null }],
      signal_scout_guesses: [{ data: [], error: null }],
      players: [{ data: [makePlayerReveal({ id: "p-2", position: "K" })], error: null }],
    });
    const result = await submitGuess(supabase, userIdentity, "round-1", "p-2");
    expect(result).toEqual({ ok: false, code: "guess_out_of_pool" });
  });

  it("rejects a guess for a player outside the rankings window", async () => {
    const { supabase } = makeMockSupabase({
      signal_scout_rounds: [{ data: makeRoundRow(), error: null }],
      signal_scout_guesses: [{ data: [], error: null }],
      players: [{ data: [makePlayerReveal({ id: "p-2", position: "WR" })], error: null }],
      rankings: [{ data: null, error: null }],
    });
    const result = await submitGuess(supabase, userIdentity, "round-1", "p-2");
    expect(result).toEqual({ ok: false, code: "guess_out_of_pool" });
  });

  it("a wrong guess under the strike cap deducts score, stays active, and appears in badReads", async () => {
    const round = makeRoundRow({ score_available: 1000, wrong_guess_count: 0 });
    const { supabase } = makeMockSupabase({
      signal_scout_rounds: [
        { data: round, error: null }, // fetchOwnedRound
        { data: { ...round, score_available: 900, wrong_guess_count: 1 }, error: null }, // guardedActiveUpdate
      ],
      signal_scout_guesses: [
        { data: [], error: null }, // existing guesses (dup check)
        { data: null, error: null }, // insertGuess
        { data: [{ guessed_player_id: "p-2", guess_number: 1 }], error: null }, // loadBadReads
      ],
      players: [
        { data: [makePlayerReveal({ id: "p-2", position: "WR" })], error: null }, // pool validation
        { data: [makePlayerReveal({ id: "p-2", position: "WR", first_name: "John", last_name: "Doe" })], error: null }, // loadBadReads join
      ],
      rankings: [{ data: { player_id: "p-2" }, error: null }],
      signal_scout_round_clues: [{ data: [], error: null }],
    });

    const result = await submitGuess(supabase, userIdentity, "round-1", "p-2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dto = asActive(result.round);
    expect(dto.score).toBe(900);
    expect(dto.wrongGuesses).toBe(1);
    expect(dto.burned).toBe(false);
    expect(dto.badReads).toEqual([{ playerId: "p-2", name: "John Doe", position: "WR", team: "DAL" }]);
  });

  it("a third wrong guess fails the round and (for a guest) skips all stats persistence", async () => {
    const round = makeRoundRow({
      user_id: null,
      guest_id: "guest-1",
      ip_hash: "hash-1",
      score_available: 200,
      wrong_guess_count: 2,
      hints_used: 1,
    });
    const completedRound = { ...round, status: "failed", score_awarded: 0, score_available: 100, wrong_guess_count: 3, completed_at: "2026-07-09T13:00:00.000Z" };

    const { supabase, callCounts } = makeMockSupabase({
      signal_scout_rounds: [
        { data: round, error: null }, // fetchOwnedRound
        { data: completedRound, error: null }, // completeRoundTransition
      ],
      signal_scout_guesses: [
        { data: [], error: null }, // dup check
        { data: null, error: null }, // insertGuess
        { data: [{ guessed_player_id: "p-2", guess_number: 3 }], error: null }, // loadBadReads
      ],
      players: [
        { data: [makePlayerReveal({ id: "p-2", position: "WR" })], error: null }, // pool validation
        { data: [makePlayerReveal({ id: "p-2", position: "WR" })], error: null }, // loadBadReads join (buildActiveDto runs before loadPlayerReveal)
        { data: makePlayerReveal({ id: "target-1", position: "WR", first_name: "Target", last_name: "Player" }), error: null }, // target reveal
      ],
      rankings: [{ data: { player_id: "p-2" }, error: null }],
      signal_scout_round_clues: [{ data: [], error: null }],
    });

    const result = await submitGuess(supabase, guestIdentity, "round-1", "p-2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dto = asCompleted(result.round);
    expect(dto.status).toBe("failed");
    expect(dto.scoreAwarded).toBe(0);
    expect(dto.wrongGuesses).toBe(3);
    expect(dto.streaks).toBeUndefined();
    expect(callCounts.signal_scout_user_stats ?? 0).toBe(0);
    expect(callCounts.signal_scout_daily_scores ?? 0).toBe(0);
  });

  it("a correct guess with score remaining wins, awards the score, and updates stats/streaks for a logged-in user", async () => {
    const round = makeRoundRow({ score_available: 500, wrong_guess_count: 0, hints_used: 2, target_player_id: "target-1" });
    const completedRound = { ...round, status: "won", score_awarded: 500, completed_at: "2026-07-09T13:00:00.000Z" };

    const { supabase, callLog } = makeMockSupabase({
      signal_scout_rounds: [
        { data: round, error: null }, // fetchOwnedRound
        { data: completedRound, error: null }, // completeRoundTransition
      ],
      signal_scout_guesses: [
        { data: [], error: null }, // dup check
        { data: null, error: null }, // insertGuess
        { data: [], error: null }, // loadBadReads (empty, returns early)
      ],
      players: [
        { data: [makePlayerReveal({ id: "target-1", position: "WR" })], error: null }, // pool validation
        { data: makePlayerReveal({ id: "target-1", position: "WR", first_name: "Target", last_name: "Player" }), error: null }, // target reveal
      ],
      rankings: [{ data: { player_id: "target-1" }, error: null }],
      signal_scout_user_stats: [
        { data: null, error: null }, // no existing stats
        { data: null, error: null }, // upsert result (unused)
        {
          data: { current_signal_streak: 1, best_signal_streak: 1, current_daily_streak: 1, best_daily_streak: 1 },
          error: null,
        }, // streaks read in buildCompletedDto
      ],
      signal_scout_daily_scores: [
        { data: null, error: null }, // no existing daily row
        { data: null, error: null }, // upsert result (unused)
      ],
      signal_scout_round_clues: [{ data: [], error: null }],
    });

    const result = await submitGuess(supabase, userIdentity, "round-1", "target-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dto = asCompleted(result.round);
    expect(dto.status).toBe("won");
    expect(dto.scoreAwarded).toBe(500);
    expect(dto.target).toEqual({ playerId: "target-1", name: "Target Player", position: "WR", team: "DAL", sleeperId: "1234" });
    expect(dto.streaks).toEqual({ currentSignalStreak: 1, bestSignalStreak: 1, currentDailyStreak: 1, bestDailyStreak: 1 });

    const statsPayload = upsertArgsFor(callLog, "signal_scout_user_stats", 0) as {
      rounds_played: number;
      rounds_won: number;
      total_hints: number;
      total_points: number;
      first_played_at: string;
    };
    expect(statsPayload.rounds_played).toBe(1);
    expect(statsPayload.rounds_won).toBe(1);
    expect(statsPayload.total_hints).toBe(2);
    expect(statsPayload.total_points).toBe(500);
    expect(statsPayload.first_played_at).toBeTruthy();

    const dailyPayload = upsertArgsFor(callLog, "signal_scout_daily_scores", 0) as { points: number; rounds: number; wins: number };
    expect(dailyPayload).toEqual(expect.objectContaining({ points: 500, rounds: 1, wins: 1 }));
  });

  it("a correct guess at score 0 completes as solved_late, awards 0, and resets the signal streak", async () => {
    const round = makeRoundRow({ score_available: 0, wrong_guess_count: 0, hints_used: 1, target_player_id: "target-1" });
    const completedRound = { ...round, status: "solved_late", score_awarded: 0, completed_at: "2026-07-09T13:00:00.000Z" };

    const { supabase, callLog } = makeMockSupabase({
      signal_scout_rounds: [
        { data: round, error: null }, // fetchOwnedRound
        { data: completedRound, error: null }, // completeRoundTransition
      ],
      signal_scout_guesses: [
        { data: [], error: null }, // dup check
        { data: null, error: null }, // insertGuess
        { data: [], error: null }, // loadBadReads (empty, returns early)
      ],
      players: [
        { data: [makePlayerReveal({ id: "target-1", position: "WR" })], error: null }, // pool validation
        { data: makePlayerReveal({ id: "target-1", position: "WR", first_name: "Target", last_name: "Player" }), error: null }, // target reveal
      ],
      rankings: [{ data: { player_id: "target-1" }, error: null }],
      signal_scout_user_stats: [
        // A prior 5-round signal streak exists; solved_late must reset it to 0.
        { data: { current_signal_streak: 5, best_signal_streak: 5, current_daily_streak: 2, best_daily_streak: 2, last_played_date: null, first_played_at: "2026-01-01T00:00:00.000Z" }, error: null },
        { data: null, error: null }, // upsert result (unused)
        { data: { current_signal_streak: 0, best_signal_streak: 5, current_daily_streak: 2, best_daily_streak: 2 }, error: null }, // post-update streaks read
      ],
      signal_scout_daily_scores: [
        { data: null, error: null },
        { data: null, error: null },
      ],
      signal_scout_round_clues: [{ data: [], error: null }],
    });

    const result = await submitGuess(supabase, userIdentity, "round-1", "target-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dto = asCompleted(result.round);
    expect(dto.status).toBe("solved_late");
    expect(dto.scoreAwarded).toBe(0);
    expect(dto.streaks).toEqual({ currentSignalStreak: 0, bestSignalStreak: 5, currentDailyStreak: 2, bestDailyStreak: 2 });

    const statsPayload = upsertArgsFor(callLog, "signal_scout_user_stats", 0) as { current_signal_streak: number; rounds_solved_late: number };
    expect(statsPayload.current_signal_streak).toBe(0);
    expect(statsPayload.rounds_solved_late).toBe(1);
  });

  it("credits daily score and streak to the ET day of COMPLETION, not the round's frozen start-day game_date", async () => {
    // round.game_date is deliberately stale (the round "started" long ago); the
    // daily-scores upsert must key off today's ET date, not this value.
    const staleStartDate = "2020-01-01";
    const round = makeRoundRow({ score_available: 300, wrong_guess_count: 0, hints_used: 0, target_player_id: "target-1", game_date: staleStartDate });
    const completedRound = { ...round, status: "won", score_awarded: 300, completed_at: "2026-07-09T13:00:00.000Z" };

    const { supabase, callLog } = makeMockSupabase({
      signal_scout_rounds: [
        { data: round, error: null },
        { data: completedRound, error: null },
      ],
      signal_scout_guesses: [
        { data: [], error: null },
        { data: null, error: null },
        { data: [], error: null },
      ],
      players: [
        { data: [makePlayerReveal({ id: "target-1", position: "WR" })], error: null },
        { data: makePlayerReveal({ id: "target-1", position: "WR" }), error: null },
      ],
      rankings: [{ data: { player_id: "target-1" }, error: null }],
      signal_scout_user_stats: [
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ],
      signal_scout_daily_scores: [
        { data: null, error: null },
        { data: null, error: null },
      ],
      signal_scout_round_clues: [{ data: [], error: null }],
    });

    const result = await submitGuess(supabase, userIdentity, "round-1", "target-1");
    expect(result.ok).toBe(true);

    const expectedCompletionDate = currentEasternGameDate();
    expect(expectedCompletionDate).not.toBe(staleStartDate);

    const dailyPayload = upsertArgsFor(callLog, "signal_scout_daily_scores", 0) as { game_date: string };
    expect(dailyPayload.game_date).toBe(expectedCompletionDate);
    expect(dailyPayload.game_date).not.toBe(staleStartDate);

    const statsPayload = upsertArgsFor(callLog, "signal_scout_user_stats", 0) as { last_played_date: string };
    expect(statsPayload.last_played_date).toBe(expectedCompletionDate);

    const dailySelectEq = callLog.filter((c) => c.table === "signal_scout_daily_scores" && c.method === "eq");
    expect(dailySelectEq.some((c) => c.args[0] === "game_date" && c.args[1] === expectedCompletionDate)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// skipRound
// ---------------------------------------------------------------------------

describe("skipRound", () => {
  it("completes the round as skipped, awards 0, and creates fresh stats/daily rows on a player's first round", async () => {
    const round = makeRoundRow({ score_available: 700, wrong_guess_count: 1, hints_used: 1 });
    const completedRound = { ...round, status: "skipped", score_awarded: 0, completed_at: "2026-07-09T13:00:00.000Z" };

    const { supabase, callLog } = makeMockSupabase({
      signal_scout_rounds: [
        { data: round, error: null },
        { data: completedRound, error: null },
      ],
      signal_scout_user_stats: [
        { data: null, error: null }, // no existing row
        { data: null, error: null }, // upsert result
        { data: { current_signal_streak: 0, best_signal_streak: 0, current_daily_streak: 1, best_daily_streak: 1 }, error: null },
      ],
      signal_scout_daily_scores: [
        { data: null, error: null },
        { data: null, error: null },
      ],
      signal_scout_round_clues: [{ data: [], error: null }],
      players: [{ data: makePlayerReveal({ id: "target-1" }), error: null }],
      signal_scout_guesses: [{ data: [], error: null }],
    });

    const result = await skipRound(supabase, userIdentity, "round-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.round.status).toBe("skipped");
    expect(result.round.scoreAwarded).toBe(0);

    const statsPayload = upsertArgsFor(callLog, "signal_scout_user_stats", 0) as {
      rounds_played: number;
      rounds_skipped: number;
      current_signal_streak: number;
      first_played_at: string;
    };
    expect(statsPayload.rounds_played).toBe(1);
    expect(statsPayload.rounds_skipped).toBe(1);
    expect(statsPayload.current_signal_streak).toBe(0);
    expect(statsPayload.first_played_at).toBeTruthy();
  });

  it("preserves the original first_played_at/first_play_at and resets an existing streak on skip", async () => {
    const round = makeRoundRow({ score_available: 700, wrong_guess_count: 0, hints_used: 0 });
    const completedRound = { ...round, status: "skipped", score_awarded: 0, completed_at: "2026-07-09T13:00:00.000Z" };
    const existingFirstPlayedAt = "2026-01-01T00:00:00.000Z";
    const existingFirstPlayAt = "2026-07-09T09:00:00.000Z";

    const { supabase, callLog } = makeMockSupabase({
      signal_scout_rounds: [
        { data: round, error: null },
        { data: completedRound, error: null },
      ],
      signal_scout_user_stats: [
        {
          data: {
            user_id: "user-1",
            rounds_played: 5,
            rounds_won: 3,
            rounds_solved_late: 0,
            rounds_failed: 1,
            rounds_skipped: 1,
            rounds_burned: 0,
            total_hints: 4,
            total_wrong_guesses: 2,
            total_points: 3000,
            current_signal_streak: 3,
            best_signal_streak: 3,
            current_daily_streak: 2,
            best_daily_streak: 2,
            last_played_date: "2026-07-08",
            first_played_at: existingFirstPlayedAt,
            hidden_from_leaderboards: false,
            hidden_reason: null,
            hidden_at: null,
            hidden_by: null,
            updated_at: "2026-07-08T00:00:00.000Z",
          },
          error: null,
        },
        { data: null, error: null },
        { data: { current_signal_streak: 0, best_signal_streak: 3, current_daily_streak: 3, best_daily_streak: 3 }, error: null },
      ],
      signal_scout_daily_scores: [
        { data: { user_id: "user-1", game_date: "2026-07-09", points: 200, rounds: 2, wins: 1, first_play_at: existingFirstPlayAt }, error: null },
        { data: null, error: null },
      ],
      signal_scout_round_clues: [{ data: [], error: null }],
      players: [{ data: makePlayerReveal({ id: "target-1" }), error: null }],
      signal_scout_guesses: [{ data: [], error: null }],
    });

    const result = await skipRound(supabase, userIdentity, "round-1");
    expect(result.ok).toBe(true);

    const statsPayload = upsertArgsFor(callLog, "signal_scout_user_stats", 0) as {
      rounds_played: number;
      current_signal_streak: number;
      first_played_at: string;
    };
    expect(statsPayload.rounds_played).toBe(6);
    // Skipping resets the signal streak even though one existed.
    expect(statsPayload.current_signal_streak).toBe(0);
    expect(statsPayload.first_played_at).toBe(existingFirstPlayedAt);

    const dailyPayload = upsertArgsFor(callLog, "signal_scout_daily_scores", 0) as { rounds: number; first_play_at: string };
    expect(dailyPayload.rounds).toBe(3);
    expect(dailyPayload.first_play_at).toBe(existingFirstPlayAt);
  });

  it("returns not_found for an ownership mismatch", async () => {
    const { supabase } = makeMockSupabase({
      signal_scout_rounds: [{ data: makeRoundRow({ user_id: "someone-else" }), error: null }],
    });
    const result = await skipRound(supabase, userIdentity, "round-1");
    expect(result).toEqual({ ok: false, code: "not_found" });
  });

  it("is idempotent: a second completion attempt on an already-completed round returns round_not_active", async () => {
    const { supabase } = makeMockSupabase({
      signal_scout_rounds: [{ data: makeRoundRow({ status: "won" }), error: null }],
    });
    const result = await skipRound(supabase, userIdentity, "round-1");
    expect(result).toEqual({ ok: false, code: "round_not_active" });
  });

  it("returns round_not_active when the guarded completion update misses (lost race)", async () => {
    const { supabase } = makeMockSupabase({
      signal_scout_rounds: [
        { data: makeRoundRow({ status: "active" }), error: null }, // fetchOwnedRound sees it as active
        { data: null, error: null }, // completeRoundTransition guard misses (status changed underneath us)
      ],
    });
    const result = await skipRound(supabase, userIdentity, "round-1");
    expect(result).toEqual({ ok: false, code: "round_not_active" });
  });
});

// ---------------------------------------------------------------------------
// getRound / anti-cheat
// ---------------------------------------------------------------------------

describe("getRound", () => {
  it("returns not_found for an ownership mismatch", async () => {
    const { supabase } = makeMockSupabase({
      signal_scout_rounds: [{ data: makeRoundRow({ guest_id: "someone-elses-cookie", user_id: null }), error: null }],
    });
    const result = await getRound(supabase, guestIdentity, "round-1");
    expect(result).toEqual({ ok: false, code: "not_found" });
  });

  it("ANTI-CHEAT: an active round's serialized DTO never leaks the target id, unrevealed clue content, or the settings snapshot", async () => {
    const round = makeRoundRow({ target_player_id: "SECRET-TARGET-UUID" });
    const clueRows = [
      makeClueRow({ clue_key: "age_range", tier: "starter", label: "Age range", display_value: "24 to 25 years old", is_revealed: true, reveal_order: 1 }),
      makeClueRow({
        clue_key: "college",
        tier: "clear",
        label: "College",
        display_value: "SECRET-COLLEGE-VALUE",
        specificity: 4,
        cost: 200,
        is_revealed: false,
        reveal_order: null,
        revealed_at: null,
      }),
    ];
    const { supabase } = makeMockSupabase({
      signal_scout_rounds: [{ data: round, error: null }],
      signal_scout_round_clues: [{ data: clueRows, error: null }],
      signal_scout_guesses: [{ data: [], error: null }],
    });

    const result = await getRound(supabase, userIdentity, "round-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = JSON.stringify(result.round);
    expect(serialized).not.toContain("SECRET-TARGET-UUID");
    expect(serialized).not.toContain("SECRET-COLLEGE-VALUE");
    expect(serialized).not.toContain("settings_snapshot");
    expect(serialized).not.toContain("specificity");
    expect(serialized).not.toContain('"college"');
  });

  it("ActiveRoundDto carries streaks for a logged-in round with an existing stats row, omits it for guests, and still leaks nothing new", async () => {
    const clueRows = [
      makeClueRow({ clue_key: "age_range", tier: "starter", label: "Age range", display_value: "24 to 25 years old", is_revealed: true, reveal_order: 1 }),
      makeClueRow({
        clue_key: "college",
        tier: "clear",
        label: "College",
        display_value: "SECRET-COLLEGE-VALUE",
        is_revealed: false,
        reveal_order: null,
        revealed_at: null,
      }),
    ];

    // Logged-in round with an existing stats row: streaks should appear.
    const { supabase: userSupabase } = makeMockSupabase({
      signal_scout_rounds: [{ data: makeRoundRow({ target_player_id: "SECRET-TARGET-UUID" }), error: null }],
      signal_scout_round_clues: [{ data: clueRows, error: null }],
      signal_scout_guesses: [{ data: [], error: null }],
      signal_scout_user_stats: [
        { data: { current_signal_streak: 4, best_signal_streak: 7, current_daily_streak: 2, best_daily_streak: 3 }, error: null },
      ],
    });
    const userResult = await getRound(userSupabase, userIdentity, "round-1");
    expect(userResult.ok).toBe(true);
    if (!userResult.ok) return;
    const userDto = asActive(userResult.round);
    expect(userDto.streaks).toEqual({ currentSignalStreak: 4, bestSignalStreak: 7, currentDailyStreak: 2, bestDailyStreak: 3 });

    const serializedUser = JSON.stringify(userDto);
    expect(serializedUser).not.toContain("SECRET-TARGET-UUID");
    expect(serializedUser).not.toContain("SECRET-COLLEGE-VALUE");
    expect(serializedUser).not.toContain("settings_snapshot");
    expect(serializedUser).not.toContain("specificity");

    // Guest round: streaks are never queried or included (plan section 6, session-scoped only).
    const { supabase: guestSupabase, callCounts: guestCallCounts } = makeMockSupabase({
      signal_scout_rounds: [
        { data: makeRoundRow({ user_id: null, guest_id: "guest-1", ip_hash: "hash-1", target_player_id: "SECRET-TARGET-UUID" }), error: null },
      ],
      signal_scout_round_clues: [{ data: clueRows, error: null }],
      signal_scout_guesses: [{ data: [], error: null }],
    });
    const guestResult = await getRound(guestSupabase, guestIdentity, "round-1");
    expect(guestResult.ok).toBe(true);
    if (!guestResult.ok) return;
    const guestDto = asActive(guestResult.round);
    expect(guestDto.streaks).toBeUndefined();
    expect(guestDto.guest).toBe(true);
    expect(guestCallCounts.signal_scout_user_stats ?? 0).toBe(0);
  });

  it("returns the full reveal (target, allClues, status) for a completed round", async () => {
    const round = makeRoundRow({ status: "won", score_awarded: 500, target_player_id: "target-1" });
    const clueRows = [
      makeClueRow({ clue_key: "age_range", tier: "starter", is_revealed: true, reveal_order: 1 }),
      makeClueRow({ clue_key: "college", tier: "clear", label: "College", display_value: "LSU", is_revealed: false, reveal_order: null, revealed_at: null }),
    ];
    const { supabase } = makeMockSupabase({
      signal_scout_rounds: [{ data: round, error: null }],
      signal_scout_round_clues: [{ data: clueRows, error: null }],
      players: [{ data: makePlayerReveal({ id: "target-1", first_name: "Target", last_name: "Player" }), error: null }],
      signal_scout_user_stats: [{ data: { current_signal_streak: 2, best_signal_streak: 4, current_daily_streak: 1, best_daily_streak: 2 }, error: null }],
      signal_scout_guesses: [{ data: [], error: null }],
    });

    const result = await getRound(supabase, userIdentity, "round-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dto = asCompleted(result.round);
    expect(dto.status).toBe("won");
    expect(dto.scoreAwarded).toBe(500);
    expect(dto.target.name).toBe("Target Player");
    expect(dto.allClues.map((c) => c.clueKey).sort()).toEqual(["age_range", "college"]);
    expect(dto.streaks).toEqual({ currentSignalStreak: 2, bestSignalStreak: 4, currentDailyStreak: 1, bestDailyStreak: 2 });
  });
});
