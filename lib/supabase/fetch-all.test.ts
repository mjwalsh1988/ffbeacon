import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CHUNK_CONCURRENCY,
  fetchAllRows,
  fetchAllRowsByKeyset,
  fetchAllRowsInChunks,
  fetchAllRowsInChunksByKeyset,
  mapWithConcurrency,
  SUPABASE_PAGE_SIZE,
} from "./fetch-all";

/** A fake table that caps every request at 1000 rows, like PostgREST. */
function table(n: number, failAt?: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i }));
  const calls: Array<[number, number]> = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    if (failAt !== undefined && from >= failAt) return { data: null, error: { message: "timeout" } };
    return { data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null };
  };
  return { page, calls };
}

describe("fetchAllRows", () => {
  it("reads past the 1000-row cap", async () => {
    const t = table(2500);
    const rows = await fetchAllRows("t", t.page);
    expect(rows).toHaveLength(2500);
    expect(t.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("stops on an exact multiple of the page size", async () => {
    const t = table(2000);
    expect(await fetchAllRows("t", t.page)).toHaveLength(2000);
    expect(t.calls).toHaveLength(3);
  });

  it("throws on a failed page instead of returning a partial set", async () => {
    await expect(fetchAllRows("t", table(2500, 1000).page)).rejects.toThrow(/t: read failed at row 1000/);
  });

  it("chunks long id lists and pages each chunk", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => i);
    const seen: number[] = [];
    const rows = await fetchAllRowsInChunks("c", ids, async (chunk, from) => {
      if (from === 0) seen.push(chunk.length);
      return { data: from === 0 ? chunk.map((id) => ({ id })) : [], error: null };
    });
    expect(seen).toEqual([200, 200, 50]);
    expect(rows).toHaveLength(450);
  });

  it("uses the real cap as its page size", () => {
    expect(SUPABASE_PAGE_SIZE).toBe(1000);
  });

  it("runs chunks in parallel, bounded, and returns rows in chunk order", async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => i);
    let inFlight = 0;
    let peak = 0;
    const rows = await fetchAllRowsInChunks(
      "c",
      ids,
      async (chunk, from) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        // Later chunks finish first, so order would break if results were
        // appended as they arrived.
        await new Promise((r) => setTimeout(r, 20 - chunk[0] / 100));
        inFlight--;
        return { data: from === 0 ? chunk.map((id) => ({ id })) : [], error: null };
      },
      100,
    );
    expect(peak).toBe(CHUNK_CONCURRENCY);
    expect(rows.map((r) => r.id)).toEqual(ids);
  });
});

/** A fake table that honours `id > after` and a limit, capped at 1000. */
function keysetTable(n: number, failAfter?: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
  const calls: Array<number | null> = [];
  const page = async (after: number | null, limit: number) => {
    calls.push(after);
    if (failAfter !== undefined && after !== null && after >= failAfter) {
      return { data: null, error: { message: "timeout" } };
    }
    const start = after === null ? 0 : rows.findIndex((r) => r.id > after);
    const slice = start < 0 ? [] : rows.slice(start, start + Math.min(limit, 1000));
    return { data: slice, error: null };
  };
  return { page, calls };
}

describe("fetchAllRowsByKeyset", () => {
  it("reads past the cap by walking the key", async () => {
    const t = keysetTable(2500);
    const rows = await fetchAllRowsByKeyset("k", t.page, (r) => r.id);
    expect(rows).toHaveLength(2500);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2500);
    expect(t.calls).toEqual([null, 1000, 2000]);
  });

  it("asks once more on an exact multiple of the page size", async () => {
    const t = keysetTable(2000);
    expect(await fetchAllRowsByKeyset("k", t.page, (r) => r.id)).toHaveLength(2000);
    expect(t.calls).toEqual([null, 1000, 2000]);
  });

  it("throws on a failed page instead of returning a partial set", async () => {
    await expect(fetchAllRowsByKeyset("k", keysetTable(2500, 1000).page, (r) => r.id)).rejects.toThrow(
      /k: read failed after key 1000/,
    );
  });

  it("throws when the cursor does not advance", async () => {
    const stuck = async () => ({ data: Array.from({ length: 1000 }, () => ({ id: 7 })), error: null });
    let calls = 0;
    const page = async () => {
      calls++;
      return stuck();
    };
    await expect(fetchAllRowsByKeyset("k", page, (r) => r.id)).rejects.toThrow(/did not advance/);
    expect(calls).toBe(2);
  });

  it("chunks, runs chunks in parallel, and keeps chunk order", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => i);
    const rows = await fetchAllRowsInChunksByKeyset(
      "kc",
      ids,
      async (chunk, after) => ({ data: after === null ? chunk.map((id) => ({ id })) : [], error: null }),
      (r) => r.id,
    );
    expect(rows.map((r) => r.id)).toEqual(ids);
  });
});

describe("mapWithConcurrency", () => {
  it("rejects on the first failure and starts nothing after it", async () => {
    const started: number[] = [];
    await expect(
      mapWithConcurrency([0, 1, 2, 3, 4, 5, 6, 7], 2, async (n) => {
        started.push(n);
        await new Promise((r) => setTimeout(r, 5));
        if (n === 1) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
    await new Promise((r) => setTimeout(r, 30));
    expect(started.length).toBeLessThan(8);
  });
});

/**
 * Guard: a literal .limit() above 1000 on a Supabase query is silently capped
 * and has shipped as a bug several times. Constants are checked by name at
 * their definition in the files that were fixed (see progress.md, RC-T tasks).
 */
describe("no Supabase .limit() above the row cap", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
    return out;
  }
  it("finds none in lib, app, scripts or components", () => {
    const offenders: string[] = [];
    for (const dir of ["lib", "app", "scripts", "components"]) {
      for (const file of walk(join(process.cwd(), dir))) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/\.limit\(\s*([0-9_]+)\s*\)/g)) {
          const line = src.slice(0, m.index).split("\n").length;
          const before = src.slice(Math.max(0, (m.index ?? 0) - 200), m.index);
          if (/^\s*\*|\/\//.test(src.split("\n")[line - 1].trim())) continue;
          if (Number(m[1].replace(/_/g, "")) > 1000 && !before.includes("Array")) offenders.push(`${file}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
