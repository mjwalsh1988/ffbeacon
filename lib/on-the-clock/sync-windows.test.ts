import { describe, it, expect } from "vitest";
import { syncWindows } from "./sync-windows";

const NOW = Date.parse("2026-08-20T18:00:00.000Z");
const OPTS = { manualCooldownSeconds: 30, autoRefreshSeconds: 60, nowMs: NOW };

function stampAgo(seconds: number): string {
  return new Date(NOW - seconds * 1000).toISOString();
}

describe("syncWindows", () => {
  it("opens both windows for a draft that has never synced", () => {
    expect(syncWindows(null, OPTS)).toEqual({
      manualRemainingSeconds: 0,
      autoRemainingSeconds: 0,
    });
  });

  it("opens both windows for an unparseable stamp rather than stranding the room", () => {
    expect(syncWindows("not a date", OPTS)).toEqual({
      manualRemainingSeconds: 0,
      autoRemainingSeconds: 0,
    });
  });

  it("counts both windows down from the same stamp", () => {
    expect(syncWindows(stampAgo(0), OPTS)).toEqual({
      manualRemainingSeconds: 30,
      autoRemainingSeconds: 60,
    });
    expect(syncWindows(stampAgo(10), OPTS)).toEqual({
      manualRemainingSeconds: 20,
      autoRemainingSeconds: 50,
    });
  });

  it("opens the manual window while the automatic one is still closed", () => {
    // The point of two windows: a press is allowed at 30s, the room's unattended
    // refresh is not due until 60s.
    expect(syncWindows(stampAgo(40), OPTS)).toEqual({
      manualRemainingSeconds: 0,
      autoRemainingSeconds: 20,
    });
  });

  it("holds at zero once both windows have elapsed", () => {
    expect(syncWindows(stampAgo(600), OPTS)).toEqual({
      manualRemainingSeconds: 0,
      autoRemainingSeconds: 0,
    });
  });

  it("never reports longer than the window itself for a stamp in the future", () => {
    // Sub-second skew between the database that writes the stamp and the server
    // that formats it, or a genuinely wrong clock. Either way the countdown is
    // capped at the window instead of stranding the room for an hour.
    const windows = syncWindows(stampAgo(-3600), OPTS);
    expect(windows.manualRemainingSeconds).toBe(30);
    expect(windows.autoRemainingSeconds).toBe(60);
  });

  it("treats a zero or missing window as open", () => {
    expect(
      syncWindows(stampAgo(1), { manualCooldownSeconds: 0, autoRefreshSeconds: 0, nowMs: NOW }),
    ).toEqual({ manualRemainingSeconds: 0, autoRemainingSeconds: 0 });
  });

  it("rounds up, so a countdown never shows zero while the window is still shut", () => {
    expect(syncWindows(stampAgo(29.5), OPTS).manualRemainingSeconds).toBe(1);
  });
});
