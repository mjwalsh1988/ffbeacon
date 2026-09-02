import { describe, expect, it } from "vitest";
import { validatePowerPulseSettings } from "@/lib/power-pulse/validate";
import {
  DEFAULT_POWER_PULSE_SETTINGS,
  DEFAULT_WAR_SETTINGS,
  mergePowerPulseSettings,
} from "@/lib/power-pulse/default-settings";
import { WAR_SETTING_BOUNDS } from "@/lib/positional-war/default-settings";

/**
 * Positional WAR settings (section 15.7): the war block bounds server-side
 * validation, and the merge fallback that lets a settings document written
 * before this shipped degrade to defaults instead of failing.
 */
describe("powerPulseSettingsSchema: war bounds", () => {
  const validWith = (war: Partial<typeof DEFAULT_WAR_SETTINGS>) => ({
    ...DEFAULT_POWER_PULSE_SETTINGS,
    war: { ...DEFAULT_WAR_SETTINGS, ...war },
  });

  it("accepts the code defaults", () => {
    const result = validatePowerPulseSettings(DEFAULT_POWER_PULSE_SETTINGS);
    expect(result.ok).toBe(true);
  });

  it("modelVersion: rejects an empty string and a string over 32 characters", () => {
    expect(validatePowerPulseSettings(validWith({ modelVersion: "" })).ok).toBe(false);
    expect(
      validatePowerPulseSettings(validWith({ modelVersion: "x".repeat(33) })).ok,
    ).toBe(false);
    expect(
      validatePowerPulseSettings(validWith({ modelVersion: "x".repeat(32) })).ok,
    ).toBe(true);
  });

  it("displayDepthMultiple: rejects below 1 and above 6", () => {
    expect(validatePowerPulseSettings(validWith({ displayDepthMultiple: 0.99 })).ok).toBe(
      false,
    );
    expect(validatePowerPulseSettings(validWith({ displayDepthMultiple: 6.01 })).ok).toBe(
      false,
    );
    expect(validatePowerPulseSettings(validWith({ displayDepthMultiple: 1 })).ok).toBe(true);
    expect(validatePowerPulseSettings(validWith({ displayDepthMultiple: 6 })).ok).toBe(true);
  });

  it("minDisplayDepth: rejects below 6, above 200, and non-integers", () => {
    expect(validatePowerPulseSettings(validWith({ minDisplayDepth: 5 })).ok).toBe(false);
    expect(validatePowerPulseSettings(validWith({ minDisplayDepth: 201 })).ok).toBe(false);
    expect(validatePowerPulseSettings(validWith({ minDisplayDepth: 24.5 })).ok).toBe(false);
    expect(validatePowerPulseSettings(validWith({ minDisplayDepth: 6 })).ok).toBe(true);
    expect(validatePowerPulseSettings(validWith({ minDisplayDepth: 200 })).ok).toBe(true);
  });

  it("cliffThreshold: rejects below 0.05 and above 0.95", () => {
    expect(validatePowerPulseSettings(validWith({ cliffThreshold: 0.04 })).ok).toBe(false);
    expect(validatePowerPulseSettings(validWith({ cliffThreshold: 0.96 })).ok).toBe(false);
    expect(validatePowerPulseSettings(validWith({ cliffThreshold: 0.05 })).ok).toBe(true);
    expect(validatePowerPulseSettings(validWith({ cliffThreshold: 0.95 })).ok).toBe(true);
  });

  it("clampBelowReplacement: rejects a non-boolean value", () => {
    const settings = {
      ...DEFAULT_POWER_PULSE_SETTINGS,
      war: { ...DEFAULT_WAR_SETTINGS, clampBelowReplacement: "true" as unknown as boolean },
    };
    expect(validatePowerPulseSettings(settings).ok).toBe(false);
    expect(validatePowerPulseSettings(validWith({ clampBelowReplacement: false })).ok).toBe(
      true,
    );
  });
});

/**
 * Drift guard: the zod schema reads its numeric bounds from
 * lib/positional-war/default-settings.ts WAR_SETTING_BOUNDS, and the admin
 * form's min/max/step attributes read the same object. This asserts the
 * schema actually enforces those bounds (one step outside each edge is
 * rejected, the edge itself is accepted), so a future edit to the schema
 * that stops reading WAR_SETTING_BOUNDS breaks this test rather than
 * silently letting the form and the server disagree.
 */
describe("powerPulseSettingsSchema: war bounds match WAR_SETTING_BOUNDS", () => {
  const validWith = (war: Partial<typeof DEFAULT_WAR_SETTINGS>) => ({
    ...DEFAULT_POWER_PULSE_SETTINGS,
    war: { ...DEFAULT_WAR_SETTINGS, ...war },
  });

  it("modelVersion: accepts the bound lengths and rejects one character outside", () => {
    const { minLength, maxLength } = WAR_SETTING_BOUNDS.modelVersion;
    expect(validatePowerPulseSettings(validWith({ modelVersion: "x".repeat(minLength) })).ok).toBe(
      true,
    );
    expect(
      validatePowerPulseSettings(validWith({ modelVersion: "x".repeat(minLength - 1) })).ok,
    ).toBe(false);
    expect(validatePowerPulseSettings(validWith({ modelVersion: "x".repeat(maxLength) })).ok).toBe(
      true,
    );
    expect(
      validatePowerPulseSettings(validWith({ modelVersion: "x".repeat(maxLength + 1) })).ok,
    ).toBe(false);
  });

  (
    ["displayDepthMultiple", "minDisplayDepth", "cliffThreshold"] as const
  ).forEach((field) => {
    it(`${field}: accepts the bound edges and rejects one step outside`, () => {
      const { min, max, step } = WAR_SETTING_BOUNDS[field];
      expect(validatePowerPulseSettings(validWith({ [field]: min })).ok).toBe(true);
      expect(validatePowerPulseSettings(validWith({ [field]: max })).ok).toBe(true);
      expect(validatePowerPulseSettings(validWith({ [field]: min - step })).ok).toBe(false);
      expect(validatePowerPulseSettings(validWith({ [field]: max + step })).ok).toBe(false);
    });
  });
});

describe("mergePowerPulseSettings: war fallback", () => {
  it("loads the war defaults when the stored document has no war key", () => {
    const stored = { modelVersion: "pp-2" };
    const merged = mergePowerPulseSettings(stored);
    expect(merged.war).toEqual(DEFAULT_WAR_SETTINGS);
  });

  it("merges a partial war object over the defaults rather than dropping the missing fields", () => {
    const stored = { war: { cliffThreshold: 0.42 } };
    const merged = mergePowerPulseSettings(stored);
    expect(merged.war).toEqual({ ...DEFAULT_WAR_SETTINGS, cliffThreshold: 0.42 });
  });
});

/**
 * Opponent strength (3.1 and 3.3 of docs/projection-engine-plan.md): the
 * current-season lookup and the shrunk-multiplier read are both settings
 * values now, so a partial admin save must not silently drop a position's
 * reliability the way a partial war save must not drop a field.
 */
describe("mergePowerPulseSettings: opponent.positionReliability merges one level deep", () => {
  it("loads the position reliability defaults when the stored document has no opponent key", () => {
    const stored = { modelVersion: "pp-5" };
    const merged = mergePowerPulseSettings(stored);
    expect(merged.opponent.positionReliability).toEqual(
      DEFAULT_POWER_PULSE_SETTINGS.opponent.positionReliability,
    );
  });

  it("merges a partial positionReliability object over the defaults rather than dropping the missing positions", () => {
    const stored = { opponent: { positionReliability: { WR: 0.2 } } };
    const merged = mergePowerPulseSettings(stored);
    expect(merged.opponent.positionReliability).toEqual({
      ...DEFAULT_POWER_PULSE_SETTINGS.opponent.positionReliability,
      WR: 0.2,
    });
  });

  it("keeps the other opponent fields at their defaults when only positionReliability is stored", () => {
    const stored = { opponent: { positionReliability: { QB: 0.5 } } };
    const merged = mergePowerPulseSettings(stored);
    expect(merged.opponent.useAdjusted).toBe(true);
    expect(merged.opponent.priorGames).toBe(6);
    expect(merged.opponent.currentSeasonWeight).toBe(
      DEFAULT_POWER_PULSE_SETTINGS.opponent.currentSeasonWeight,
    );
  });
});

describe("powerPulseSettingsSchema: opponent bounds", () => {
  const validWith = (opponent: Partial<typeof DEFAULT_POWER_PULSE_SETTINGS.opponent>) => ({
    ...DEFAULT_POWER_PULSE_SETTINGS,
    opponent: { ...DEFAULT_POWER_PULSE_SETTINGS.opponent, ...opponent },
  });

  it("priorGames: rejects below 0 and above 100", () => {
    expect(validatePowerPulseSettings(validWith({ priorGames: -1 })).ok).toBe(false);
    expect(validatePowerPulseSettings(validWith({ priorGames: 101 })).ok).toBe(false);
    expect(validatePowerPulseSettings(validWith({ priorGames: 0 })).ok).toBe(true);
    expect(validatePowerPulseSettings(validWith({ priorGames: 100 })).ok).toBe(true);
  });

  it("useAdjusted: rejects a non-boolean value", () => {
    const settings = {
      ...DEFAULT_POWER_PULSE_SETTINGS,
      opponent: {
        ...DEFAULT_POWER_PULSE_SETTINGS.opponent,
        useAdjusted: "true" as unknown as boolean,
      },
    };
    expect(validatePowerPulseSettings(settings).ok).toBe(false);
  });

  it("positionReliability: rejects a position value outside 0 to 1", () => {
    expect(
      validatePowerPulseSettings(
        validWith({
          positionReliability: {
            ...DEFAULT_POWER_PULSE_SETTINGS.opponent.positionReliability,
            WR: 1.1,
          },
        }),
      ).ok,
    ).toBe(false);
    expect(
      validatePowerPulseSettings(
        validWith({
          positionReliability: {
            ...DEFAULT_POWER_PULSE_SETTINGS.opponent.positionReliability,
            DEF: -0.01,
          },
        }),
      ).ok,
    ).toBe(false);
  });

  it("positionReliability: accepts the documented defaults", () => {
    expect(validatePowerPulseSettings(DEFAULT_POWER_PULSE_SETTINGS).ok).toBe(true);
  });
});
