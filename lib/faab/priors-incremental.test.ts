import { describe, expect, it } from "vitest";
import {
  PRIOR_LOGIC_VERSION,
  WATERMARK_OVERLAP_MS,
  currentPriorSeason,
  planPass,
  watermarkAfter,
  type PriorBuildState,
} from "./priors-incremental";

const NOW = "2026-11-12T21:00:00.000Z";

function state(over: Partial<PriorBuildState> = {}): PriorBuildState {
  return {
    current_season: 2026,
    logic_version: PRIOR_LOGIC_VERSION,
    watermark: "2026-11-12T19:45:00.000Z",
    pass_since: null,
    pass_full: false,
    pass_started_at: null,
    pass_cursor: null,
    pass_dirty_seasons: [],
    pass_season: null,
    pass_logic_version: null,
    last_pass_completed_at: "2026-11-12T20:05:00.000Z",
    last_cells_built_at: "2026-11-12T20:05:00.000Z",
    ...over,
  };
}

describe("currentPriorSeason", () => {
  it("is the newest league season", () => {
    expect(currentPriorSeason(2026, Date.parse("2026-11-12T12:00:00Z"))).toBe(2026);
  });

  it("is capped at the Eastern calendar year", () => {
    expect(currentPriorSeason(2028, Date.parse("2026-11-12T12:00:00Z"))).toBe(2026);
  });

  it("reads the Eastern year, not UTC, at midnight on New Year's", () => {
    // 03:00 UTC on Jan 1 is still Dec 31 in New York.
    expect(currentPriorSeason(2027, Date.parse("2027-01-01T03:00:00Z"))).toBe(2026);
    expect(currentPriorSeason(2027, Date.parse("2027-01-01T06:00:00Z"))).toBe(2027);
  });

  it("is null with no leagues", () => {
    expect(currentPriorSeason(null, Date.now())).toBeNull();
  });
});

describe("planPass", () => {
  it("starts a full pass with no state", () => {
    const plan = planPass(null, 2026, NOW);
    expect(plan).toMatchObject({ full: true, since: null, cursor: null, startedAt: NOW, resumed: false });
    expect(plan.fullReason).toBe("no previous build");
  });

  it("starts an incremental pass from the watermark", () => {
    const plan = planPass(state(), 2026, NOW);
    expect(plan).toMatchObject({ full: false, since: "2026-11-12T19:45:00.000Z", resumed: false });
    expect(plan.fullReason).toBeNull();
  });

  it("walks everything when the season turns over", () => {
    const plan = planPass(state(), 2027, NOW);
    expect(plan.full).toBe(true);
    expect(plan.fullReason).toBe("the season turned over to 2027");
  });

  it("walks everything when the logic version changes", () => {
    const plan = planPass(state({ logic_version: PRIOR_LOGIC_VERSION - 1 }), 2026, NOW);
    expect(plan.full).toBe(true);
  });

  it("resumes an open pass from its cursor", () => {
    const plan = planPass(
      state({
        pass_since: "2026-11-12T19:45:00.000Z",
        pass_started_at: "2026-11-12T20:25:00.000Z",
        pass_cursor: "00000000-0000-0000-0000-0000000000aa",
        pass_dirty_seasons: [2026],
        pass_season: 2026,
        pass_logic_version: PRIOR_LOGIC_VERSION,
      }),
      2026,
      NOW,
    );
    expect(plan).toMatchObject({
      resumed: true,
      full: false,
      since: "2026-11-12T19:45:00.000Z",
      cursor: "00000000-0000-0000-0000-0000000000aa",
      startedAt: "2026-11-12T20:25:00.000Z",
      dirtySeasons: [2026],
    });
  });

  it("resumes an open full pass that was started for this season", () => {
    const plan = planPass(
      state({
        current_season: 2026,
        pass_full: true,
        pass_started_at: "2027-02-01T00:00:00Z",
        pass_cursor: "x",
        pass_season: 2027,
        pass_logic_version: PRIOR_LOGIC_VERSION,
      }),
      2027,
      NOW,
    );
    expect(plan).toMatchObject({ resumed: true, full: true, since: null, cursor: "x" });
  });

  it("abandons an open full pass started for the previous season", () => {
    const plan = planPass(
      state({
        pass_full: true,
        pass_started_at: "2026-12-31T23:00:00Z",
        pass_cursor: "80",
        pass_season: 2026,
        pass_logic_version: PRIOR_LOGIC_VERSION,
      }),
      2027,
      NOW,
    );
    expect(plan).toMatchObject({ resumed: false, full: true, cursor: null, startedAt: NOW });
  });

  it("abandons an open full pass started under older build logic", () => {
    const plan = planPass(
      state({
        pass_full: true,
        pass_started_at: "2026-11-12T20:00:00Z",
        pass_cursor: "80",
        pass_season: 2026,
        pass_logic_version: PRIOR_LOGIC_VERSION - 1,
      }),
      2026,
      NOW,
    );
    expect(plan).toMatchObject({ resumed: false, full: true, cursor: null });
  });

  it("abandons an open incremental pass when a full one is required", () => {
    const plan = planPass(
      state({ pass_since: "2026-11-12T19:45:00Z", pass_started_at: "2026-11-12T20:25:00Z", pass_cursor: "x" }),
      2027,
      NOW,
    );
    expect(plan).toMatchObject({ resumed: false, full: true, cursor: null, startedAt: NOW });
  });

  it("resumes a valid open full pass when a full rebuild is requested again", () => {
    const plan = planPass(
      state({
        pass_full: true,
        pass_started_at: "2026-11-12T20:25:00Z",
        pass_cursor: "x",
        pass_season: 2026,
        pass_logic_version: PRIOR_LOGIC_VERSION,
      }),
      2026,
      NOW,
      { forceFull: true },
    );
    expect(plan).toMatchObject({ resumed: true, full: true, cursor: "x" });
  });

  it("starts a full pass over an open incremental one when a full rebuild is requested", () => {
    const plan = planPass(
      state({
        pass_since: "2026-11-12T19:45:00Z",
        pass_started_at: "2026-11-12T20:25:00Z",
        pass_cursor: "x",
        pass_season: 2026,
        pass_logic_version: PRIOR_LOGIC_VERSION,
      }),
      2026,
      NOW,
      { forceFull: true },
    );
    expect(plan).toMatchObject({ resumed: false, full: true, cursor: null, startedAt: NOW });
  });
});

describe("watermarkAfter", () => {
  it("overlaps the pass start so a row committed during it is not missed", () => {
    const started = "2026-11-12T20:31:00.000Z";
    expect(Date.parse(watermarkAfter(started))).toBe(Date.parse(started) - WATERMARK_OVERLAP_MS);
  });
});
