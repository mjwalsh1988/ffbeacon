import { describe, it, expect } from "vitest";
import { validateSignalScoutSettings, loadSignalScoutSettings, clampSignalScoutSettings } from "./settings";
import { DEFAULT_SIGNAL_SCOUT_SETTINGS } from "./default-settings";

describe("validateSignalScoutSettings", () => {
  it("accepts the shipped defaults", () => {
    const res = validateSignalScoutSettings(DEFAULT_SIGNAL_SCOUT_SETTINGS);
    expect(res.ok).toBe(true);
  });

  it("fills missing groups from defaults (empty input)", () => {
    const res = validateSignalScoutSettings({});
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.settings.game_enabled).toBe(true);
      expect(res.settings.scoring.starting_score).toBe(1000);
      expect(res.settings.clues.tier_limits).toEqual({ weak: 4, clear: 3, ping: 2, scan: 1 });
      expect(res.settings.pool.eligible_positions).toEqual(["QB", "RB", "WR", "TE"]);
    }
  });

  it("merges a partial override onto defaults", () => {
    const res = validateSignalScoutSettings({ scoring: { weak_signal_cost: 150 } });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.settings.scoring.weak_signal_cost).toBe(150);
      // untouched fields still come from defaults
      expect(res.settings.scoring.starting_score).toBe(1000);
      expect(res.settings.scoring.clear_signal_cost).toBe(200);
    }
  });

  it("does not add a minimum_correct_score field", () => {
    const res = validateSignalScoutSettings(DEFAULT_SIGNAL_SCOUT_SETTINGS);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((res.settings.scoring as any).minimum_correct_score).toBeUndefined();
    }
  });

  it("respects game_enabled toggling", () => {
    const res = validateSignalScoutSettings({ game_enabled: false });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.settings.game_enabled).toBe(false);
      expect(res.settings.guest_play_enabled).toBe(true);
    }
  });

  it("validates tier_limits shape and rejects a missing tier as wrong type", () => {
    const res = validateSignalScoutSettings({
      clues: { tier_limits: { weak: 4, clear: 3, ping: 2, scan: "one" } },
    });
    expect(res.ok).toBe(false);
  });

  it("rejects a negative cost", () => {
    const res = validateSignalScoutSettings({ scoring: { weak_signal_cost: -50 } });
    expect(res.ok).toBe(false);
  });

  it("rejects a non-positive starting_score", () => {
    const res = validateSignalScoutSettings({ scoring: { starting_score: 0 } });
    expect(res.ok).toBe(false);
  });

  it("rejects an unknown eligible position", () => {
    const res = validateSignalScoutSettings({ pool: { eligible_positions: ["QB", "DEF"] } });
    expect(res.ok).toBe(false);
  });

  it("rejects an empty eligible_positions array", () => {
    const res = validateSignalScoutSettings({ pool: { eligible_positions: [] } });
    expect(res.ok).toBe(false);
  });

  it("rejects wrong types", () => {
    const res = validateSignalScoutSettings({ guest_daily_round_limit: "two" });
    expect(res.ok).toBe(false);
  });

  it("rejects a non-integer max_wrong_guesses", () => {
    const res = validateSignalScoutSettings({ scoring: { max_wrong_guesses: 2.5 } });
    expect(res.ok).toBe(false);
  });
});

// --- loadSignalScoutSettings with a mocked Supabase chain -------------------

/**
 * Minimal chainable Supabase mock matching the shape settings.ts consumes:
 * from().select().eq().maybeSingle(). `row` is the canned "settings" row
 * value; undefined means "no row" (maybeSingle resolves data: null).
 */
function mockSupabase(row: { settings: unknown } | null | undefined, error: unknown = null) {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    maybeSingle: () => Promise.resolve({ data: row ?? null, error }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => b } as any;
}

describe("loadSignalScoutSettings", () => {
  it("falls back to defaults when the row is missing", async () => {
    const supabase = mockSupabase(null);
    const settings = await loadSignalScoutSettings(supabase);
    expect(settings).toEqual(DEFAULT_SIGNAL_SCOUT_SETTINGS);
  });

  it("falls back to defaults when the query errors", async () => {
    const supabase = mockSupabase(null, { message: "boom" });
    const settings = await loadSignalScoutSettings(supabase);
    expect(settings).toEqual(DEFAULT_SIGNAL_SCOUT_SETTINGS);
  });

  it("falls back to defaults when the stored settings fail validation", async () => {
    const supabase = mockSupabase({ settings: { scoring: { weak_signal_cost: -50 } } });
    const settings = await loadSignalScoutSettings(supabase);
    expect(settings).toEqual(DEFAULT_SIGNAL_SCOUT_SETTINGS);
  });

  it("returns a stored row merged with defaults for missing fields", async () => {
    const supabase = mockSupabase({ settings: { game_enabled: false, scoring: { weak_signal_cost: 150 } } });
    const settings = await loadSignalScoutSettings(supabase);
    expect(settings.game_enabled).toBe(false);
    expect(settings.scoring.weak_signal_cost).toBe(150);
    expect(settings.scoring.starting_score).toBe(1000);
    expect(settings.leaderboards).toEqual(DEFAULT_SIGNAL_SCOUT_SETTINGS.leaderboards);
  });

  it("returns the exact defaults when the stored row equals the defaults", async () => {
    const supabase = mockSupabase({ settings: DEFAULT_SIGNAL_SCOUT_SETTINGS });
    const settings = await loadSignalScoutSettings(supabase);
    expect(settings).toEqual(DEFAULT_SIGNAL_SCOUT_SETTINGS);
  });
});

describe("clampSignalScoutSettings", () => {
  it("leaves the shipped defaults unchanged", () => {
    const out = clampSignalScoutSettings(DEFAULT_SIGNAL_SCOUT_SETTINGS);
    expect(out).toEqual(DEFAULT_SIGNAL_SCOUT_SETTINGS);
    // The clamped output must still pass full validation.
    expect(validateSignalScoutSettings(out).ok).toBe(true);
  });

  it("raises below-range numbers up to the minimum", () => {
    const s = structuredClone(DEFAULT_SIGNAL_SCOUT_SETTINGS);
    s.guest_daily_round_limit = -5;
    s.scoring.starting_score = 0;
    s.scoring.weak_signal_cost = -100;
    s.scoring.max_wrong_guesses = 0;
    s.clues.starter_clue_count = 0;
    s.clues.tier_limits.weak = -1;
    const out = clampSignalScoutSettings(s);
    expect(out.guest_daily_round_limit).toBe(0);
    expect(out.scoring.starting_score).toBe(100);
    expect(out.scoring.weak_signal_cost).toBe(0);
    expect(out.scoring.max_wrong_guesses).toBe(1);
    expect(out.clues.starter_clue_count).toBe(1);
    expect(out.clues.tier_limits.weak).toBe(0);
  });

  it("lowers above-range numbers down to the maximum", () => {
    const s = structuredClone(DEFAULT_SIGNAL_SCOUT_SETTINGS);
    s.guest_daily_round_limit = 999;
    s.scoring.starting_score = 999999;
    s.scoring.full_scan_cost = 999999;
    s.scoring.max_wrong_guesses = 999;
    s.clues.starter_clue_count = 999;
    s.clues.tier_limits.scan = 999;
    const out = clampSignalScoutSettings(s);
    expect(out.guest_daily_round_limit).toBe(20);
    expect(out.scoring.starting_score).toBe(10000);
    expect(out.scoring.full_scan_cost).toBe(5000);
    expect(out.scoring.max_wrong_guesses).toBe(10);
    expect(out.clues.starter_clue_count).toBe(6);
    expect(out.clues.tier_limits.scan).toBe(10);
  });

  it("coerces a non-finite number to its default rather than throwing", () => {
    const s = structuredClone(DEFAULT_SIGNAL_SCOUT_SETTINGS) as unknown as {
      guest_daily_round_limit: unknown;
      scoring: { starting_score: unknown };
    };
    s.guest_daily_round_limit = "two";
    s.scoring.starting_score = NaN;
    const out = clampSignalScoutSettings(s as unknown as typeof DEFAULT_SIGNAL_SCOUT_SETTINGS);
    expect(out.guest_daily_round_limit).toBe(DEFAULT_SIGNAL_SCOUT_SETTINGS.guest_daily_round_limit);
    expect(out.scoring.starting_score).toBe(DEFAULT_SIGNAL_SCOUT_SETTINGS.scoring.starting_score);
  });

  it("restores the default pool when eligible_positions would end up empty", () => {
    const s = structuredClone(DEFAULT_SIGNAL_SCOUT_SETTINGS);
    // @ts-expect-error deliberately testing an out-of-enum, gets filtered to empty
    s.pool.eligible_positions = ["DEF", "K"];
    const out = clampSignalScoutSettings(s);
    expect(out.pool.eligible_positions).toEqual(DEFAULT_SIGNAL_SCOUT_SETTINGS.pool.eligible_positions);
  });

  it("intersects and dedupes eligible_positions against the known set", () => {
    const s = structuredClone(DEFAULT_SIGNAL_SCOUT_SETTINGS);
    // @ts-expect-error deliberately testing an out-of-enum mixed with dupes
    s.pool.eligible_positions = ["QB", "QB", "RB", "DEF"];
    const out = clampSignalScoutSettings(s);
    expect(out.pool.eligible_positions).toEqual(["QB", "RB"]);
  });

  it("filters disabled_clue_keys to known catalog keys and dedupes", () => {
    const s = structuredClone(DEFAULT_SIGNAL_SCOUT_SETTINGS);
    s.clues.disabled_clue_keys = ["age_range", "age_range", "not_a_real_key"];
    const out = clampSignalScoutSettings(s);
    expect(out.clues.disabled_clue_keys).toEqual(["age_range"]);
  });

  it("passes booleans through untouched", () => {
    const s = structuredClone(DEFAULT_SIGNAL_SCOUT_SETTINGS);
    s.game_enabled = false;
    s.guest_play_enabled = false;
    s.leaderboards.require_login = false;
    const out = clampSignalScoutSettings(s);
    expect(out.game_enabled).toBe(false);
    expect(out.guest_play_enabled).toBe(false);
    expect(out.leaderboards.require_login).toBe(false);
  });
});
