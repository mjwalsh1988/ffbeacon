import { describe, expect, it } from "vitest";
import {
  isSettledLeagueSeason,
  managerPulseNeedsCapture,
  type LeagueCaptureState,
} from "./freshness";
import { DEFAULT_MANAGER_PULSE_SETTINGS } from "./default-settings";

const CURRENT_SEASON = 2026;
const NOW_MS = Date.parse("2026-09-05T12:00:00Z");
const STALE_AFTER_DAYS = DEFAULT_MANAGER_PULSE_SETTINGS.capture.captureStaleAfterDays;

const RECENT_ISO = new Date(NOW_MS - 1 * 86_400_000).toISOString();
const OLD_ISO = new Date(NOW_MS - (STALE_AFTER_DAYS + 1) * 86_400_000).toISOString();

function state(overrides: Partial<LeagueCaptureState>): LeagueCaptureState {
  return {
    capture_completed_at: null,
    status: null,
    season: CURRENT_SEASON,
    ...overrides,
  };
}

describe("isSettledLeagueSeason", () => {
  it("is settled when Sleeper marks the league complete", () => {
    expect(isSettledLeagueSeason(state({ status: "complete" }), CURRENT_SEASON)).toBe(true);
  });

  it("is settled when the season is in the past", () => {
    expect(
      isSettledLeagueSeason(state({ status: "in_progress", season: CURRENT_SEASON - 1 }), CURRENT_SEASON),
    ).toBe(true);
  });

  it("is not settled for the current season with no completion status", () => {
    expect(
      isSettledLeagueSeason(state({ status: "in_progress", season: CURRENT_SEASON }), CURRENT_SEASON),
    ).toBe(false);
  });

  it("is not settled when season is null and status is not complete", () => {
    expect(isSettledLeagueSeason(state({ status: "in_progress", season: null }), CURRENT_SEASON)).toBe(
      false,
    );
  });
});

describe("managerPulseNeedsCapture: the five rows of the freshness table", () => {
  it("settled and complete: never needs recapture", () => {
    const row = state({
      status: "complete",
      season: CURRENT_SEASON - 1,
      capture_completed_at: OLD_ISO,
    });
    expect(managerPulseNeedsCapture(row, DEFAULT_MANAGER_PULSE_SETTINGS, NOW_MS, CURRENT_SEASON)).toBe(
      false,
    );
  });

  it("settled and incomplete: needs capture", () => {
    const row = state({
      status: "complete",
      season: CURRENT_SEASON - 1,
      capture_completed_at: null,
    });
    expect(managerPulseNeedsCapture(row, DEFAULT_MANAGER_PULSE_SETTINGS, NOW_MS, CURRENT_SEASON)).toBe(
      true,
    );
  });

  it("unsettled and complete: needs capture only once older than captureStaleAfterDays", () => {
    const fresh = state({
      status: "in_progress",
      season: CURRENT_SEASON,
      capture_completed_at: RECENT_ISO,
    });
    expect(
      managerPulseNeedsCapture(fresh, DEFAULT_MANAGER_PULSE_SETTINGS, NOW_MS, CURRENT_SEASON),
    ).toBe(false);

    const stale = state({
      status: "in_progress",
      season: CURRENT_SEASON,
      capture_completed_at: OLD_ISO,
    });
    expect(
      managerPulseNeedsCapture(stale, DEFAULT_MANAGER_PULSE_SETTINGS, NOW_MS, CURRENT_SEASON),
    ).toBe(true);
  });

  it("unsettled and incomplete: needs capture", () => {
    const row = state({
      status: "in_progress",
      season: CURRENT_SEASON,
      capture_completed_at: null,
    });
    expect(managerPulseNeedsCapture(row, DEFAULT_MANAGER_PULSE_SETTINGS, NOW_MS, CURRENT_SEASON)).toBe(
      true,
    );
  });

  it("no row at all: needs capture", () => {
    expect(managerPulseNeedsCapture(null, DEFAULT_MANAGER_PULSE_SETTINGS, NOW_MS, CURRENT_SEASON)).toBe(
      true,
    );
    expect(
      managerPulseNeedsCapture(undefined, DEFAULT_MANAGER_PULSE_SETTINGS, NOW_MS, CURRENT_SEASON),
    ).toBe(true);
  });
});
