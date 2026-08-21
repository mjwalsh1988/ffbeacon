import { describe, it, expect } from "vitest";
import {
  alignedStartingSlots,
  isProjectableSlot,
  orderSlotsForDisplay,
  slotDescription,
  slotGroupOf,
  slotLabel,
  SLOT_GROUP_ORDER,
} from "./slots";

const STANDARD = [
  "QB",
  "RB",
  "RB",
  "WR",
  "WR",
  "TE",
  "FLEX",
  "K",
  "DEF",
  "BN",
  "BN",
  "BN",
  "BN",
  "IR",
];

const SUPERFLEX = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "BN", "BN", "TAXI"];

const IDP = ["QB", "RB", "WR", "TE", "FLEX", "DL", "LB", "DB", "IDP_FLEX", "BN", "IR", "NA"];

function nonBench(positions: string[]): number {
  return positions.filter((p) => !["BN", "IR", "TAXI", "NA"].includes(p)).length;
}

describe("alignedStartingSlots", () => {
  it("keeps a standard league's starting slots in Sleeper's own order", () => {
    const slots = alignedStartingSlots(STANDARD);
    expect(slots.map((s) => s.token)).toEqual([
      "QB",
      "RB",
      "RB",
      "WR",
      "WR",
      "TE",
      "FLEX",
      "K",
      "DEF",
    ]);
    expect(slots.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("keeps the superflex slot and labels it in words", () => {
    const slots = alignedStartingSlots(SUPERFLEX);
    const superflex = slots.find((s) => s.token === "SUPER_FLEX");
    expect(superflex?.label).toBe("SUPERFLEX");
    expect(superflex?.group).toBe("SUPERFLEX");
    expect(superflex?.projectable).toBe(true);
  });

  it("keeps IDP slots, which Power Pulse drops, and marks them unprojectable", () => {
    // lib/power-pulse/lineup.ts startingSlots() removes these on purpose. The
    // schedule view renders a lineup a human set, so it has to keep them.
    const slots = alignedStartingSlots(IDP);
    expect(slots.map((s) => s.token)).toEqual([
      "QB",
      "RB",
      "WR",
      "TE",
      "FLEX",
      "DL",
      "LB",
      "DB",
      "IDP_FLEX",
    ]);
    const idp = slots.filter((s) => s.group === "IDP");
    expect(idp).toHaveLength(4);
    expect(idp.every((s) => s.projectable === false)).toBe(true);
  });

  it("keeps an unrecognised token rather than shifting every slot below it", () => {
    const slots = alignedStartingSlots(["QB", "EDGE", "RB", "BN"]);
    expect(slots.map((s) => s.token)).toEqual(["QB", "EDGE", "RB"]);
    // The RB has to stay at index 2, because Sleeper's starters array puts them
    // there. Dropping EDGE would put the RB in the EDGE's place.
    expect(slots[2].order).toBe(2);
    expect(slots[1].label).toBe("EDGE");
    expect(slots[1].group).toBe("IDP");
    expect(slots[1].projectable).toBe(false);
  });

  it("returns one slot per roster position that is not bench, IR, taxi, or NA", () => {
    for (const positions of [STANDARD, SUPERFLEX, IDP]) {
      expect(alignedStartingSlots(positions)).toHaveLength(nonBench(positions));
    }
  });

  it("returns nothing for an all-bench roster shape", () => {
    expect(alignedStartingSlots(["BN", "BN", "IR", "TAXI", "NA"])).toEqual([]);
  });
});

describe("slotLabel and slotGroupOf", () => {
  it("collapses the flex spellings onto their visible labels", () => {
    expect(slotLabel("WR_TE")).toBe("W/T");
    expect(slotLabel("REC_FLEX")).toBe("W/T");
    expect(slotLabel("WRRB_FLEX")).toBe("W/R");
    expect(slotLabel("WRRB_WRT")).toBe("FLEX");
    expect(slotLabel("Q_FLEX")).toBe("SUPERFLEX");
    expect(slotLabel("DST")).toBe("DEF");
  });

  it("groups every flex spelling under FLEX and both superflex spellings under SUPERFLEX", () => {
    for (const token of ["FLEX", "REC_FLEX", "WR_TE", "WRRB_FLEX", "WRRB_WRT"]) {
      expect(slotGroupOf(token)).toBe("FLEX");
    }
    expect(slotGroupOf("SUPER_FLEX")).toBe("SUPERFLEX");
    expect(slotGroupOf("Q_FLEX")).toBe("SUPERFLEX");
    expect(slotGroupOf("DST")).toBe("DEF");
    expect(slotGroupOf("EDGE")).toBe("IDP");
  });

  it("spells the slot out for a screen reader", () => {
    expect(slotDescription("WR_TE")).toBe("wide receiver or tight end flex");
    expect(slotDescription("IDP_FLEX")).toBe("individual defensive player flex");
    expect(slotDescription("EDGE")).toBe("EDGE");
  });
});

describe("isProjectableSlot", () => {
  it("is true for the slots Sleeper publishes projections for", () => {
    expect(isProjectableSlot("QB")).toBe(true);
    expect(isProjectableSlot("SUPER_FLEX")).toBe(true);
    expect(isProjectableSlot("K")).toBe(true);
    expect(isProjectableSlot("DEF")).toBe(true);
  });

  it("is false for IDP slots and anything we do not recognise", () => {
    expect(isProjectableSlot("IDP_FLEX")).toBe(false);
    expect(isProjectableSlot("LB")).toBe(false);
    expect(isProjectableSlot("EDGE")).toBe(false);
  });
});

describe("orderSlotsForDisplay", () => {
  it("groups by SLOT_GROUP_ORDER and keeps RB1 above RB2 inside a group", () => {
    const slots = alignedStartingSlots(["RB", "RB", "QB", "DEF", "K", "FLEX", "WR", "BN"]);
    const entries = slots.map((slot) => ({ slot }));
    const ordered = orderSlotsForDisplay(entries);
    expect(ordered.map((e) => e.slot.token)).toEqual([
      "QB",
      "RB",
      "RB",
      "WR",
      "FLEX",
      "K",
      "DEF",
    ]);
    const rbs = ordered.filter((e) => e.slot.token === "RB");
    expect(rbs[0].slot.order).toBeLessThan(rbs[1].slot.order);
  });

  it("does not mutate the input, because both sides read the same slot list", () => {
    const slots = alignedStartingSlots(["DEF", "QB", "BN"]);
    const entries = slots.map((slot) => ({ slot }));
    const before = entries.map((e) => e.slot.token);
    orderSlotsForDisplay(entries);
    expect(entries.map((e) => e.slot.token)).toEqual(before);
  });

  it("puts an unknown token in the IDP block rather than off the end", () => {
    const slots = alignedStartingSlots(["EDGE", "QB"]);
    const ordered = orderSlotsForDisplay(slots.map((slot) => ({ slot })));
    expect(ordered.map((e) => e.slot.token)).toEqual(["QB", "EDGE"]);
    expect(SLOT_GROUP_ORDER.indexOf("IDP")).toBeGreaterThan(SLOT_GROUP_ORDER.indexOf("QB"));
  });
});
