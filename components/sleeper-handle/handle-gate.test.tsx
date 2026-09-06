import { describe, expect, it } from "vitest";
import { gateRenderPlan } from "./handle-gate";
import type { SavedSleeperHandle } from "@/lib/sleeper-handle/types";

const handle: SavedSleeperHandle = {
  username: "beacon",
  sleeperUserId: "111",
  displayName: "Beacon Mike",
  avatar: "abc",
  verifiedAt: "2026-09-05T00:00:00.000Z",
};

describe("gateRenderPlan", () => {
  it("gives a guest the form and the sign-in notice", () => {
    expect(gateRenderPlan({ kind: "guest" })).toEqual({
      card: false,
      form: true,
      notice: "guest",
      saveByDefault: false,
    });
  });

  it("gives a signed-in reader with nothing saved the form, the notice, and a ticked box", () => {
    expect(gateRenderPlan({ kind: "member-unsaved" })).toEqual({
      card: false,
      form: true,
      notice: "member-unsaved",
      saveByDefault: true,
    });
  });

  it("gives a saved reader the card and no form on screen", () => {
    expect(gateRenderPlan({ kind: "member-saved", handle })).toEqual({
      card: true,
      form: false,
      notice: null,
      saveByDefault: false,
    });
  });

  it("gives an overridden reader the card too", () => {
    const plan = gateRenderPlan({
      kind: "member-overridden",
      handle,
      viewer: {
        username: "rival",
        sleeperUserId: null,
        displayName: null,
        avatar: null,
        source: "url",
      },
    });
    expect(plan.card).toBe(true);
    expect(plan.form).toBe(false);
  });

  it("never shows the card and the notice at once", () => {
    const states = [
      { kind: "guest" } as const,
      { kind: "member-unsaved" } as const,
      { kind: "member-saved", handle } as const,
    ];
    for (const state of states) {
      const plan = gateRenderPlan(state);
      expect(plan.card && plan.notice !== null).toBe(false);
    }
  });

  it("only ever ticks the save box for a reader who has saved nothing", () => {
    expect(gateRenderPlan({ kind: "member-unsaved" }).saveByDefault).toBe(true);
    expect(gateRenderPlan({ kind: "guest" }).saveByDefault).toBe(false);
    expect(gateRenderPlan({ kind: "member-saved", handle }).saveByDefault).toBe(
      false,
    );
  });
});
