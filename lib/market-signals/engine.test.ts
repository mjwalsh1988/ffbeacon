import { describe, expect, it } from "vitest";
import {
  DEADLINE_MARGIN_MS,
  pruneCutoffs,
  runMarketSignals,
  type EngineDeps,
} from "./engine";
import type { PlannedPartition } from "./partitions";

function planned(n: number, freshIdx: number[] = []): PlannedPartition[] {
  return Array.from({ length: n }, (_, i) => ({
    formatConfigId: `f${i}`,
    formatSlug: `fmt-${i}`,
    formatDisplay: `Format ${i}`,
    source: "ktc",
    sourceDisplay: "KTC",
    latestDay: "2026-10-28",
    fresh: freshIdx.includes(i),
  }));
}

/** A fake clock where each partition run costs `costMs`. */
function deps(parts: PlannedPartition[], costMs: number, failIdx: number[] = []) {
  let clock = 0;
  const ran: string[] = [];
  let pruned = 0;
  const d: EngineDeps = {
    now: () => clock,
    plan: async () => parts,
    run: async (p) => {
      clock += costMs;
      const i = Number(p.formatConfigId.slice(1));
      if (failIdx.includes(i)) throw new Error(`read failed ${i}`);
      ran.push(p.formatSlug);
      return { partition: p, asOfDay: "2026-10-28", rowsWritten: 10, changesWritten: 1, durationMs: costMs, tooThin: false };
    },
    prune: async () => {
      pruned += 1;
      return { changesDeleted: 0, runsDeleted: 0 };
    },
  };
  return { d, ran, prunedCount: () => pruned };
}

describe("runMarketSignals", () => {
  it("runs every partition and prunes on a complete run", async () => {
    const { d, ran, prunedCount } = deps(planned(5), 10_000);
    const out = await runMarketSignals(d, { budgetMs: 280_000, enabled: true });
    expect(ran).toHaveLength(5);
    expect(out.partial).toBe(false);
    expect(out.failedSteps).toBeUndefined();
    expect(prunedCount()).toBe(1);
    expect(out.wroteAny).toBe(true);
  });

  it("stops BEFORE a partition that would pass the deadline, partial without failedSteps", async () => {
    // 60s each, budget 280s, margin 10s: after 4 (240s) the next would end at 300s.
    const { d, ran, prunedCount } = deps(planned(8), 60_000);
    const out = await runMarketSignals(d, { budgetMs: 280_000, enabled: true });
    expect(ran).toHaveLength(4);
    expect(out.partial).toBe(true);
    expect(out.remaining).toEqual(["ktc/fmt-4", "ktc/fmt-5", "ktc/fmt-6", "ktc/fmt-7"]);
    expect(out.failedSteps).toBeUndefined();
    expect(prunedCount()).toBe(0);
    expect(DEADLINE_MARGIN_MS).toBe(10_000);
  });

  it("records a throwing partition in failedSteps and runs the next", async () => {
    const { d, ran, prunedCount } = deps(planned(3), 1_000, [1]);
    const out = await runMarketSignals(d, { budgetMs: 280_000, enabled: true });
    expect(ran).toEqual(["fmt-0", "fmt-2"]);
    expect(out.failedSteps).toEqual(["ktc/fmt-1: read failed 1"]);
    expect(prunedCount()).toBe(0);
  });

  it("skips stamped partitions on the catch-up entry", async () => {
    const { d, ran } = deps(planned(4, [0, 1, 2]), 1_000);
    const out = await runMarketSignals(d, { budgetMs: 280_000, enabled: true });
    expect(ran).toEqual(["fmt-3"]);
    expect(out.fresh).toBe(3);
  });

  it("does nothing when disabled", async () => {
    const { d, ran } = deps(planned(2), 1_000);
    const out = await runMarketSignals(d, { budgetMs: 280_000, enabled: false });
    expect(out.disabled).toBe(true);
    expect(ran).toEqual([]);
  });
});

describe("pruneCutoffs", () => {
  it("keeps 730 days of changes and 90 of runs", () => {
    expect(pruneCutoffs(new Date("2026-10-29T10:30:00Z"))).toEqual({
      changesBefore: "2024-10-29",
      runsBefore: "2026-07-31",
    });
  });
});
