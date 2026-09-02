/**
 * The one rule this file exists to hold: a stored settings document can never
 * pin modelVersion.
 *
 * Found in production on 2026-09-01, the global row read "pp-2" while the code
 * had moved to pp-6 through four model changes. Every one of those bumps was
 * written to force leagues to rescore, and every one of them would have done
 * nothing, because the merged settings handed the cache the stored string.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_POWER_PULSE_SETTINGS,
  effectiveModelVersion,
  mergePowerPulseSettings,
} from "./default-settings";

const CODE = DEFAULT_POWER_PULSE_SETTINGS.modelVersion;

describe("effectiveModelVersion", () => {
  it("returns the code version when nothing is stored", () => {
    expect(effectiveModelVersion(CODE, null)).toBe(CODE);
    expect(effectiveModelVersion(CODE, undefined)).toBe(CODE);
  });

  it("never returns a stored version string on its own", () => {
    const version = effectiveModelVersion(CODE, { modelVersion: "pp-2" });
    expect(version).not.toBe("pp-2");
    expect(version.startsWith(CODE)).toBe(true);
  });

  it("ignores modelVersion when fingerprinting, so a version bump alone does not churn the key", () => {
    const a = effectiveModelVersion(CODE, {
      modelVersion: "pp-2",
      weights: { points: 0.55 },
    });
    const b = effectiveModelVersion(CODE, {
      modelVersion: "pp-99",
      weights: { points: 0.55 },
    });
    expect(a).toBe(b);
  });

  it("changes when an admin actually edits a value", () => {
    const before = effectiveModelVersion(CODE, { weights: { points: 0.55 } });
    const after = effectiveModelVersion(CODE, { weights: { points: 0.6 } });
    expect(before).not.toBe(after);
  });

  it("is stable across key order, because jsonb does not preserve it", () => {
    const a = effectiveModelVersion(CODE, {
      weights: { points: 0.55, schedule: 0.25 },
      opponent: { enabled: true, minGamesSampled: 8 },
    });
    const b = effectiveModelVersion(CODE, {
      opponent: { minGamesSampled: 8, enabled: true },
      weights: { schedule: 0.25, points: 0.55 },
    });
    expect(a).toBe(b);
  });

  it("is stable across repeated calls", () => {
    const doc = { weights: { points: 0.55 }, injury: { enabled: true } };
    expect(effectiveModelVersion(CODE, doc)).toBe(effectiveModelVersion(CODE, doc));
  });
});

describe("mergePowerPulseSettings and the stale production row", () => {
  // The exact shape found in production on 2026-09-01, trimmed to the parts
  // that mattered. Kept verbatim so this test documents the real case.
  const staleRow = {
    modelVersion: "pp-2",
    reliability: {
      enabled: true,
      priorGames: 10,
      maxMultiplier: 1.15,
      minMultiplier: 0.85,
    },
    opponent: {
      enabled: true,
      maxMultiplier: 1.15,
      minMultiplier: 0.85,
      minGamesSampled: 8,
      priorSeasonWeight: 0.3,
      currentSeasonWeight: 0.7,
    },
  };

  it("does not let the stale row pin the model version", () => {
    const merged = mergePowerPulseSettings(staleRow);
    expect(merged.modelVersion).not.toBe("pp-2");
    expect(merged.modelVersion.startsWith(CODE)).toBe(true);
  });

  it("still lets the stored row win on values it actually carries", () => {
    // This is the behaviour an admin expects and it is NOT what was fixed. The
    // stale clamps really are in effect until someone re-saves the settings,
    // and that is a product decision rather than a code bug.
    const merged = mergePowerPulseSettings(staleRow);
    expect(merged.reliability.priorGames).toBe(10);
    expect(merged.reliability.minMultiplier).toBe(0.85);
  });

  it("fills in sections the stale row has never heard of", () => {
    const merged = mergePowerPulseSettings(staleRow);
    // Added long after this row was written. A partial save must not drop them.
    expect(merged.opponent.positionReliability.WR).toBe(
      DEFAULT_POWER_PULSE_SETTINGS.opponent.positionReliability.WR,
    );
    expect(merged.opponent.useAdjusted).toBe(true);
    expect(merged.beaconProjections.enabled).toBe(false);
    expect(merged.war).toEqual(DEFAULT_POWER_PULSE_SETTINGS.war);
  });
});
