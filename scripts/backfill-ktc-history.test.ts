import { describe, expect, it } from "vitest";
import { inWindow, parseRunArgs } from "./backfill-ktc-history";

describe("backfill-ktc-history arguments", () => {
  it("requires a window unless --all is passed, because a full rerun duplicates synced days", () => {
    expect(() => parseRunArgs([])).toThrow(/--from/);
    expect(() => parseRunArgs(["--from", "2026-09-08"])).toThrow();
    expect(() => parseRunArgs(["--from", "2026-09-24", "--to", "2026-09-08"])).toThrow();
    expect(() => parseRunArgs(["--from", "9/8/2026", "--to", "2026-09-24"])).toThrow();
  });

  it("reads a window and the dry-run flag", () => {
    expect(parseRunArgs(["--from", "2026-09-08", "--to", "2026-09-24", "--dry-run"])).toEqual({
      window: { from: "2026-09-08", to: "2026-09-24" },
      dryRun: true,
    });
    expect(parseRunArgs(["--all"])).toEqual({ window: null, dryRun: false });
  });

  it("filters dates inclusively, and keeps everything with no window", () => {
    const w = { from: "2026-09-08", to: "2026-09-24" };
    expect(inWindow("2026-09-07", w)).toBe(false);
    expect(inWindow("2026-09-08", w)).toBe(true);
    expect(inWindow("2026-09-24", w)).toBe(true);
    expect(inWindow("2026-09-25", w)).toBe(false);
    expect(inWindow("2020-01-01", null)).toBe(true);
  });
});
