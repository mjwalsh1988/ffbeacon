import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fetchAllRows, fetchAllRowsInChunks, SUPABASE_PAGE_SIZE } from "./fetch-all";

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
