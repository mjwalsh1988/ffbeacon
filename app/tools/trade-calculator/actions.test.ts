import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = {
  run: 0,
  save: [] as boolean[],
  analyze: [] as unknown[],
};
let runAllowed = true;
let saveAllowed = true;
let sessionUser: { id: string } | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: sessionUser } }) },
  }),
}));

vi.mock("@/lib/signal-check/run-manual", () => ({
  UNREADABLE_TRADE_MESSAGE: "unreadable",
  SLOW_DOWN_MESSAGE: "slow down",
  parseManualTradeInput: (raw: unknown) =>
    raw && typeof raw === "object" && "formatSlug" in (raw as object) ? raw : null,
  claimSignalCheckRunSlot: async () => {
    calls.run += 1;
    return runAllowed;
  },
  claimSignalCheckSaveSlot: async (signedIn: boolean) => {
    calls.save.push(signedIn);
    return saveAllowed;
  },
  analyzeManualTrade: async (_input: unknown, save: unknown) => {
    calls.analyze.push(save);
    return { ok: true, view: {}, shareId: null, shareUrl: null };
  },
}));

import { runSignalCheck } from "./actions";

const TRADE = { formatSlug: "dynasty-ppr-sflex", sides: { a: [], b: [] } };

beforeEach(() => {
  calls.run = 0;
  calls.save = [];
  calls.analyze = [];
  runAllowed = true;
  saveAllowed = true;
  sessionUser = null;
});

describe("runSignalCheck", () => {
  it("refuses unreadable input before claiming a slot", async () => {
    const res = await runSignalCheck("nope");
    expect(res).toEqual({ ok: false, error: "unreadable" });
    expect(calls.run).toBe(0);
    expect(calls.analyze).toHaveLength(0);
  });

  it("meters every run and does no work when the meter refuses", async () => {
    runAllowed = false;
    const res = await runSignalCheck(TRADE);
    expect(res).toEqual({ ok: false, error: "slow down" });
    expect(calls.run).toBe(1);
    expect(calls.analyze).toHaveLength(0);
  });

  it("a plain run does not save and claims no save slot", async () => {
    await runSignalCheck(TRADE);
    expect(calls.save).toHaveLength(0);
    expect(calls.analyze).toEqual([null]);
  });

  it("a guest can make a public share link on the guest budget", async () => {
    await runSignalCheck(TRADE, { save: true, makePublic: true });
    expect(calls.save).toEqual([false]);
    expect(calls.analyze).toEqual([{ userId: null, isPublic: true }]);
  });

  it("a guest cannot save a private row", async () => {
    const res = await runSignalCheck(TRADE, { save: true, makePublic: false });
    expect(res.ok).toBe(false);
    expect(calls.save).toHaveLength(0);
    expect(calls.analyze).toHaveLength(0);
  });

  it("a signed-in reader saves on the member budget, owned by their session", async () => {
    sessionUser = { id: "user-1" };
    await runSignalCheck(TRADE, { save: true, makePublic: false });
    expect(calls.save).toEqual([true]);
    expect(calls.analyze).toEqual([{ userId: "user-1", isPublic: false }]);
  });

  it("a refused save slot does no work and writes nothing", async () => {
    saveAllowed = false;
    const res = await runSignalCheck(TRADE, { save: true, makePublic: true });
    expect(res.ok).toBe(false);
    expect(calls.analyze).toHaveLength(0);
  });
});
