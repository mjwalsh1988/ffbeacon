import { describe, expect, it } from "vitest";
import {
  WRITE_CHUNK,
  computePartition,
  runPartition,
  type ChangeRow,
  type ExistingSignal,
  type PartitionHistoryRow,
  type PartitionIO,
  type RunStamp,
  type SignalRow,
} from "./run-partition";
import { addDays } from "./bollinger";
import { DEFAULT_MARKET_SIGNAL_SETTINGS as S } from "./default-settings";
import type { Partition } from "./partitions";

const NOW = new Date("2026-10-29T10:30:00Z");
const LAST = "2026-10-28";
const partition: Partition = {
  formatConfigId: "fmt",
  formatSlug: "dynasty-ppr-sflex",
  formatDisplay: "Dynasty SF",
  source: "ktc",
  sourceDisplay: "KTC",
};

/** n players, 30 days each, values steady around base + 100 * index. */
function history(n: number, opts: { breakout?: number } = {}): PartitionHistoryRow[] {
  const rows: PartitionHistoryRow[] = [];
  for (let p = 0; p < n; p += 1) {
    for (let d = 0; d < 30; d += 1) {
      const day = addDays(LAST, d - 29);
      const base = 1000 + 100 * p + (d % 2) * 10;
      const value = d === 29 && p === opts.breakout ? base * 1.5 : base;
      rows.push({
        player_id: `p${String(p).padStart(4, "0")}`,
        value,
        formula_offset: null,
        captured_at: `${day}T09:00:00Z`,
      });
    }
  }
  return rows;
}

function fakeIO(rows: PartitionHistoryRow[], existing: ExistingSignal[] = []) {
  const calls = {
    signals: [] as SignalRow[][],
    changes: [] as ChangeRow[][],
    stamps: [] as RunStamp[],
  };
  const io: PartitionIO = {
    readHistory: async () => rows,
    readExisting: async () => existing,
    upsertSignals: async (c) => void calls.signals.push(c),
    insertChanges: async (c) => void calls.changes.push(c),
    stamp: async (r) => void calls.stamps.push(r),
  };
  return { io, calls };
}

describe("computePartition", () => {
  it("skips a partition with fewer than 25 priced players on its latest day", () => {
    const out = computePartition(partition, history(24), [], S, NOW);
    expect(out.tooThin).toBe(true);
    expect(out.signals).toEqual([]);
  });

  it("writes one row per player and logs the breakout as a change", () => {
    const out = computePartition(
      partition,
      history(30, { breakout: 29 }),
      [{ player_id: "p0029", signal: "hold", signal_since: "2026-10-01" }],
      S,
      NOW,
    );
    expect(out.signals).toHaveLength(30);
    const breakout = out.signals.find((r) => r.player_id === "p0029")!;
    expect(breakout.signal).toBe("sell");
    expect(breakout.previous_signal).toBe("hold");
    expect(breakout.signal_since).toBe(LAST);
    expect(out.changes.find((c) => c.player_id === "p0029")?.from_signal).toBe("hold");
  });

  it("carries signal_since for an unchanged player and logs no change", () => {
    const out = computePartition(
      partition,
      history(30),
      [{ player_id: "p0010", signal: "hold", signal_since: "2026-10-01" }],
      S,
      NOW,
    );
    const row = out.signals.find((r) => r.player_id === "p0010")!;
    expect(row.signal).toBe("hold");
    expect(row.signal_since).toBe("2026-10-01");
    expect(out.changes.some((c) => c.player_id === "p0010")).toBe(false);
  });
});

describe("runPartition", () => {
  it("writes in chunks of 500 and stamps the partition", async () => {
    const { io, calls } = fakeIO(history(1200));
    const result = await runPartition(io, partition, S, NOW);
    expect(WRITE_CHUNK).toBe(500);
    expect(calls.signals.map((c) => c.length)).toEqual([500, 500, 200]);
    expect(calls.stamps).toHaveLength(1);
    expect(calls.stamps[0]).toMatchObject({ as_of_day: LAST, rows_written: 1200 });
    expect(result.rowsWritten).toBe(1200);
  });

  it("stamps a thin partition with zero rows so the admin page shows why", async () => {
    const { io, calls } = fakeIO(history(10));
    const result = await runPartition(io, partition, S, NOW);
    expect(result.tooThin).toBe(true);
    expect(calls.signals).toEqual([]);
    expect(calls.stamps[0]).toMatchObject({ rows_written: 0 });
  });

  it("propagates a write failure without stamping", async () => {
    const { io, calls } = fakeIO(history(30));
    io.upsertSignals = async () => {
      throw new Error("boom");
    };
    await expect(runPartition(io, partition, S, NOW)).rejects.toThrow("boom");
    expect(calls.stamps).toEqual([]);
  });
});
