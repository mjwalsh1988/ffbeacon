import { describe, it, expect } from "vitest";
import { lineupRealismFactor } from "./engine";
import { DEFAULT_POWER_PULSE_SETTINGS, type PowerPulseSettings } from "./default-settings";

const settings = (over: Partial<PowerPulseSettings["lineupRealism"]>): PowerPulseSettings => ({
  ...DEFAULT_POWER_PULSE_SETTINGS,
  lineupRealism: { ...DEFAULT_POWER_PULSE_SETTINGS.lineupRealism, ...over },
});

describe("lineupRealismFactor", () => {
  it("is off by default, so the shipped model is unchanged", () => {
    expect(DEFAULT_POWER_PULSE_SETTINGS.lineupRealism.enabled).toBe(false);
    expect(
      lineupRealismFactor(DEFAULT_POWER_PULSE_SETTINGS, { efficiency: 0.7, weeksGraded: 12 }),
    ).toBe(1);
  });

  it("changes nothing for a roster with no measurement", () => {
    expect(lineupRealismFactor(settings({ enabled: true }), undefined)).toBe(1);
  });

  it("changes nothing until there are enough graded weeks to be evidence", () => {
    const s = settings({ enabled: true, minWeeks: 4 });
    expect(lineupRealismFactor(s, { efficiency: 0.8, weeksGraded: 3 })).toBe(1);
    expect(lineupRealismFactor(s, { efficiency: 0.8, weeksGraded: 4 })).toBeLessThan(1);
  });

  it("blends halfway between a perfect lineup and the measured share", () => {
    const s = settings({ enabled: true, blend: 0.5, minWeeks: 1, floor: 0 });
    // 1 - 0.5 * (1 - 0.8) = 0.9
    expect(lineupRealismFactor(s, { efficiency: 0.8, weeksGraded: 10 })).toBeCloseTo(0.9, 6);
  });

  it("applies the measured share in full at a blend of 1", () => {
    const s = settings({ enabled: true, blend: 1, minWeeks: 1, floor: 0 });
    expect(lineupRealismFactor(s, { efficiency: 0.76, weeksGraded: 10 })).toBeCloseTo(0.76, 6);
  });

  it("never discounts below the floor", () => {
    const s = settings({ enabled: true, blend: 1, minWeeks: 1, floor: 0.85 });
    expect(lineupRealismFactor(s, { efficiency: 0.5, weeksGraded: 10 })).toBe(0.85);
  });

  it("never rewards a measurement above one", () => {
    const s = settings({ enabled: true, blend: 1, minWeeks: 1, floor: 0.85 });
    expect(lineupRealismFactor(s, { efficiency: 1.4, weeksGraded: 10 })).toBe(1);
  });

  it("ignores a measurement that is not a usable number", () => {
    const s = settings({ enabled: true, blend: 1, minWeeks: 1 });
    expect(lineupRealismFactor(s, { efficiency: Number.NaN, weeksGraded: 10 })).toBe(1);
    expect(lineupRealismFactor(s, { efficiency: 0, weeksGraded: 10 })).toBe(1);
  });
});
