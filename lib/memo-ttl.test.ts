import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoTtl, bustMemo } from "./memo-ttl";

/**
 * memoTtl backs the reference and settings reads named in the site speed
 * plan (4.2, 4.13): format_configs, source_registry and nine admin-editable
 * settings rows, all read far more often than an admin ever saves them.
 * These tests pin the four behaviors the rest of the codebase leans on: a
 * hit inside the window is free, an expired entry goes back to the
 * database, a failed read is never the thing that gets cached, and a bust
 * only touches the prefix it names.
 */

// The store inside lib/memo-ttl.ts is one module-level Map, exactly like it is
// in production: every caller across the whole process shares it. That means
// tests share it too unless each test uses its own keys, so every key below is
// suffixed with a counter that increments per test rather than reusing a
// literal like "settings:beam" more than once.
let keyCounter = 0;
function uniqueKey(base: string): string {
  keyCounter += 1;
  return `${base}:${keyCounter}`;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("memoTtl", () => {
  it("returns the same promise on a hit inside the TTL, without calling fn again", async () => {
    const fn = vi.fn().mockResolvedValue("value");

    const first = memoTtl("k1", 1000, fn);
    const second = memoTtl("k1", 1000, fn);

    expect(second).toBe(first);
    await expect(first).resolves.toBe("value");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("calls fn again once the TTL has expired", async () => {
    const fn = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");

    const first = await memoTtl("k2", 1000, fn);
    expect(first).toBe("first");

    vi.advanceTimersByTime(1001);

    const second = await memoTtl("k2", 1000, fn);
    expect(second).toBe("second");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not call fn again while still inside the TTL window", async () => {
    const fn = vi.fn().mockResolvedValue("value");

    await memoTtl("k3", 1000, fn);
    vi.advanceTimersByTime(500);
    await memoTtl("k3", 1000, fn);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("evicts a rejected promise so the next call retries instead of serving the failure", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("db unreachable"))
      .mockResolvedValueOnce("recovered");

    await expect(memoTtl("k4", 1000, fn)).rejects.toThrow("db unreachable");

    // No time has passed at all; a plain TTL check would still call this a
    // hit. Eviction on rejection is what makes this call go back to fn.
    const second = await memoTtl("k4", 1000, fn);
    expect(second).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("keys are independent: a miss on one key never reads another's entry", async () => {
    const fnA = vi.fn().mockResolvedValue("a");
    const fnB = vi.fn().mockResolvedValue("b");

    await expect(memoTtl("k5a", 1000, fnA)).resolves.toBe("a");
    await expect(memoTtl("k5b", 1000, fnB)).resolves.toBe("b");
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);
  });
});

describe("bustMemo", () => {
  it("removes every key starting with the given prefix", async () => {
    const run = uniqueKey("run");
    const beamKey = `${run}:settings:beam`;
    const fn = vi.fn().mockResolvedValue("value");

    await memoTtl(beamKey, 60_000, fn);
    expect(fn).toHaveBeenCalledTimes(1);

    bustMemo(beamKey);

    // Busted key: fn runs again.
    await memoTtl(beamKey, 60_000, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("leaves keys outside the prefix untouched", async () => {
    const run = uniqueKey("run");
    const beamKey = `${run}:settings:beam`;
    const faabKey = `${run}:settings:faab`;
    const beamFn = vi.fn().mockResolvedValue("beam");
    const faabFn = vi.fn().mockResolvedValue("faab");

    await memoTtl(beamKey, 60_000, beamFn);
    await memoTtl(faabKey, 60_000, faabFn);

    bustMemo(beamKey);

    // Untouched key: still a hit, fn does not run again.
    await memoTtl(faabKey, 60_000, faabFn);
    expect(faabFn).toHaveBeenCalledTimes(1);
  });

  it("matches a whole-key prefix, not a substring in the middle", async () => {
    const run = uniqueKey("run");
    const formatsKey = `${run}:ref:formats`;
    const sourcesKey = `${run}:ref:sources`;
    const fn = vi.fn().mockResolvedValue("v");

    await memoTtl(formatsKey, 60_000, fn);
    bustMemo(sourcesKey);

    // sourcesKey is not a prefix of formatsKey, so this must still be a hit.
    await memoTtl(formatsKey, 60_000, fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
