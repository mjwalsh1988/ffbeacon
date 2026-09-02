import { describe, it, expect } from "vitest";
import { opponentMultiplier } from "./project";
import { DEFAULT_POWER_PULSE_SETTINGS } from "./default-settings";
import { defenseSeasonsFor } from "@/lib/projections/defense-seasons";
import type { DefenseRow } from "./load";

/**
 * opponentMultiplier's new contract (docs/projection-engine-plan.md 3.1):
 * `seasons` is a list of CANDIDATES, most recent first. The function walks
 * them in order and keeps the first two rows that exist and clear
 * settings.opponent.minGamesSampled, applying currentSeasonWeight to whichever
 * comes first and priorSeasonWeight to whichever comes second. This replaces
 * the old positional-index bug, where seasons[0] (always season - 1, never the
 * season in progress) silently wore the "current season" weight forever.
 */

function row(overrides: Partial<DefenseRow> = {}): DefenseRow {
  return {
    team: "BUF",
    season: 2025,
    position: "WR",
    multiplier: 1.1,
    adjustedMultiplier: 1.08,
    shrunkMultiplier: 1.04,
    gamesSampled: 17,
    ...overrides,
  };
}

function defenseMap(rows: DefenseRow[]): Map<string, DefenseRow> {
  const out = new Map<string, DefenseRow>();
  for (const r of rows) out.set(`${r.team}|${r.season}|${r.position}`, r);
  return out;
}

describe("opponentMultiplier: preseason backward compatibility", () => {
  it("blends the two prior seasons exactly as before when the current season has no row", () => {
    // Candidates are [2026, 2025, 2024]. Nothing exists for 2026, so the walk
    // falls through to 2025 (weight 0.7) and 2024 (weight 0.3), the same pair
    // and the same weights the old hardcoded [season - 1, season - 2] used.
    const defense = defenseMap([
      row({ season: 2025, shrunkMultiplier: 1.1, multiplier: 1.12 }),
      row({ season: 2024, shrunkMultiplier: 0.9, multiplier: 0.88 }),
    ]);
    const result = opponentMultiplier(
      defense,
      defenseSeasonsFor(2026),
      "BUF",
      "WR",
      DEFAULT_POWER_PULSE_SETTINGS,
    );
    const expected = 1.1 * 0.7 + 0.9 * 0.3;
    expect(result).toBeCloseTo(expected, 6);
  });
});

describe("opponentMultiplier: the current season takes the first slot on its own", () => {
  it("weights the in-progress season at currentSeasonWeight once it has a usable row", () => {
    const defense = defenseMap([
      row({ season: 2026, shrunkMultiplier: 1.2, multiplier: 1.25, gamesSampled: 9 }),
      row({ season: 2025, shrunkMultiplier: 0.95, multiplier: 0.9 }),
      row({ season: 2024, shrunkMultiplier: 0.8, multiplier: 0.75 }),
    ]);
    const result = opponentMultiplier(
      defense,
      defenseSeasonsFor(2026),
      "BUF",
      "WR",
      DEFAULT_POWER_PULSE_SETTINGS,
    );
    // 2026 fills the first (currentSeasonWeight) slot, 2025 fills the second
    // (priorSeasonWeight) slot. 2024 is never touched: two usable rows is enough.
    const expected = 1.2 * 0.7 + 0.95 * 0.3;
    expect(result).toBeCloseTo(expected, 6);
  });

  it("skips a candidate season with too few sampled games and keeps walking", () => {
    const settings = DEFAULT_POWER_PULSE_SETTINGS;
    const defense = defenseMap([
      // Below settings.opponent.minGamesSampled (8), so this is skipped rather
      // than counted, which is exactly the early-season case the old
      // hardcoded array could never express: it always trusted seasons[0].
      row({ season: 2026, shrunkMultiplier: 1.5, multiplier: 1.6, gamesSampled: 3 }),
      row({ season: 2025, shrunkMultiplier: 1.1, multiplier: 1.12, gamesSampled: 17 }),
      row({ season: 2024, shrunkMultiplier: 0.9, multiplier: 0.88, gamesSampled: 17 }),
    ]);
    const result = opponentMultiplier(defense, defenseSeasonsFor(2026), "BUF", "WR", settings);
    const expected = 1.1 * 0.7 + 0.9 * 0.3;
    expect(result).toBeCloseTo(expected, 6);
  });
});

describe("opponentMultiplier: reading shrunkMultiplier versus the raw multiplier", () => {
  it("reads shrunkMultiplier when opponent.useAdjusted is on", () => {
    const settings = {
      ...DEFAULT_POWER_PULSE_SETTINGS,
      opponent: { ...DEFAULT_POWER_PULSE_SETTINGS.opponent, currentSeasonWeight: 1, priorSeasonWeight: 0 },
    };
    const defense = defenseMap([row({ season: 2025, shrunkMultiplier: 1.03, multiplier: 1.4 })]);
    const result = opponentMultiplier(defense, [2025], "BUF", "WR", settings);
    expect(result).toBeCloseTo(1.03, 6);
  });

  it("falls back to the raw multiplier when shrunkMultiplier is null", () => {
    const settings = {
      ...DEFAULT_POWER_PULSE_SETTINGS,
      opponent: { ...DEFAULT_POWER_PULSE_SETTINGS.opponent, currentSeasonWeight: 1, priorSeasonWeight: 0 },
    };
    const defense = defenseMap([
      row({ season: 2025, shrunkMultiplier: null, adjustedMultiplier: null, multiplier: 1.07 }),
    ]);
    const result = opponentMultiplier(defense, [2025], "BUF", "WR", settings);
    expect(result).toBeCloseTo(1.07, 6);
  });

  it("reads the raw multiplier when opponent.useAdjusted is off, ignoring shrunkMultiplier entirely", () => {
    const settings = {
      ...DEFAULT_POWER_PULSE_SETTINGS,
      opponent: {
        ...DEFAULT_POWER_PULSE_SETTINGS.opponent,
        useAdjusted: false,
        currentSeasonWeight: 1,
        priorSeasonWeight: 0,
      },
    };
    const defense = defenseMap([row({ season: 2025, shrunkMultiplier: 1.03, multiplier: 1.11 })]);
    const result = opponentMultiplier(defense, [2025], "BUF", "WR", settings);
    expect(result).toBeCloseTo(1.11, 6);
  });
});

describe("opponentMultiplier: neutral fallbacks", () => {
  it("returns exactly 1 when zero candidate seasons have a usable row", () => {
    const result = opponentMultiplier(
      defenseMap([]),
      defenseSeasonsFor(2026),
      "BUF",
      "WR",
      DEFAULT_POWER_PULSE_SETTINGS,
    );
    expect(result).toBe(1);
  });

  it("returns 1 when the opponent is null", () => {
    const defense = defenseMap([row({ season: 2025 })]);
    const result = opponentMultiplier(
      defense,
      defenseSeasonsFor(2026),
      null,
      "WR",
      DEFAULT_POWER_PULSE_SETTINGS,
    );
    expect(result).toBe(1);
  });

  it("returns 1 when the opponent adjustment is disabled", () => {
    const settings = {
      ...DEFAULT_POWER_PULSE_SETTINGS,
      opponent: { ...DEFAULT_POWER_PULSE_SETTINGS.opponent, enabled: false },
    };
    const defense = defenseMap([row({ season: 2025 })]);
    const result = opponentMultiplier(defense, defenseSeasonsFor(2026), "BUF", "WR", settings);
    expect(result).toBe(1);
  });

  it("clamps the blended result to opponent.minMultiplier and maxMultiplier", () => {
    const settings = {
      ...DEFAULT_POWER_PULSE_SETTINGS,
      opponent: {
        ...DEFAULT_POWER_PULSE_SETTINGS.opponent,
        currentSeasonWeight: 1,
        priorSeasonWeight: 0,
        minMultiplier: 0.85,
        maxMultiplier: 1.15,
      },
    };
    const defense = defenseMap([row({ season: 2025, shrunkMultiplier: 2 })]);
    const result = opponentMultiplier(defense, [2025], "BUF", "WR", settings);
    expect(result).toBe(1.15);
  });
});
