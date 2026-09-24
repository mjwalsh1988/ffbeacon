import { describe, expect, it } from "vitest";
import {
  IDP_SLOT_ELIGIBILITY,
  PULSE_POSITIONS,
  PULSE_SLOT_ELIGIBILITY,
  slotEligibility,
} from "./types";

describe("the IDP switch's slot maps (IDP-120, plan R-25)", () => {
  it("returns the very same OFF map object when the switch is off", () => {
    expect(slotEligibility(false)).toBe(PULSE_SLOT_ELIGIBILITY);
  });

  it("keeps the OFF map exactly as it was: no IDP token seats anyone", () => {
    expect(PULSE_SLOT_ELIGIBILITY.IDP_FLEX).toEqual([]);
    expect(PULSE_SLOT_ELIGIBILITY.DL).toBeUndefined();
    expect(PULSE_SLOT_ELIGIBILITY.LB).toBeUndefined();
    expect(PULSE_SLOT_ELIGIBILITY.DB).toBeUndefined();
  });

  it("seats defenders under the ON map and leaves every offensive token alone", () => {
    const on = slotEligibility(true);
    expect(on).toBe(IDP_SLOT_ELIGIBILITY);
    expect(on.DL).toEqual(["DL"]);
    expect(on.IDP_FLEX).toEqual(["DL", "LB", "DB"]);
    for (const [token, list] of Object.entries(PULSE_SLOT_ELIGIBILITY)) {
      if (token === "IDP_FLEX") continue;
      expect(on[token]).toEqual(list);
    }
    expect(Object.isFrozen(on)).toBe(true);
  });

  it("lists nine positions, offense first", () => {
    expect(PULSE_POSITIONS).toEqual(["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"]);
  });
});
