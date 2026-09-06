import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/*
 * MPS-T040: the render path never loads or computes a report. These mocks
 * exist so a test that accidentally exercised the old "everything needed is
 * present" branch would fail loudly (an unmocked call throwing) rather than
 * silently passing against dead code.
 */
vi.mock("./settings", () => ({ loadManagerPulseSettings: vi.fn() }));
vi.mock("./capture", () => ({
  startManagerCapture: vi.fn(),
  readCaptureProgress: vi.fn(),
  findOpenRun: vi.fn(),
}));
// MPS-T001: service.ts must key its season window on this shared, pure
// clock, never on a private copy. Mocked to a fixed season the same way
// capture.test.ts mocks the sibling copy re-exported from "@/lib/sleeper".
vi.mock("@/lib/nfl-season", () => ({ currentNflSeason: vi.fn(() => "2026") }));

import { loadManagerPulseSettings } from "./settings";
import { startManagerCapture, findOpenRun, type CaptureOutcome } from "./capture";
import { getManagerFootprint } from "./service";
import { DEFAULT_MANAGER_PULSE_SETTINGS } from "./default-settings";
import type { CaptureProgress, ManagerReport } from "./types";

const mockLoadSettings = vi.mocked(loadManagerPulseSettings);
const mockStartCapture = vi.mocked(startManagerCapture);
const mockFindOpenRun = vi.mocked(findOpenRun);

/** adminBypassThrottle off, so canBypassThrottle short-circuits before any query. */
const SETTINGS_NO_BYPASS = {
  ...DEFAULT_MANAGER_PULSE_SETTINGS,
  capture: { ...DEFAULT_MANAGER_PULSE_SETTINGS.capture, adminBypassThrottle: false },
};

/* -------------------------------------------------------------------------- */
/* A minimal fake PostgREST client                                            */
/* -------------------------------------------------------------------------- */

type FakeResponse = { data: unknown; error: { message: string } | null };

function makeFakeAdmin(cacheResponse: FakeResponse = { data: null, error: null }) {
  class Chain implements PromiseLike<FakeResponse> {
    constructor(private readonly resolve: () => FakeResponse) {}
    select() {
      return this;
    }
    eq() {
      return this;
    }
    ilike() {
      return this;
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }
    maybeSingle() {
      return Promise.resolve(this.resolve());
    }
    update() {
      return this;
    }
    then<A, B>(
      onOk?: ((value: FakeResponse) => A | PromiseLike<A>) | null,
      onErr?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      return Promise.resolve(this.resolve()).then(onOk, onErr);
    }
  }

  const updateCalls: unknown[] = [];

  const admin = {
    updateCalls,
    from(table: string) {
      if (table === "manager_pulse_cache") {
        return { select: () => new Chain(() => cacheResponse) };
      }
      if (table === "manager_pulse_runs") {
        return {
          update: (payload: unknown) => {
            updateCalls.push(payload);
            return new Chain(() => ({ data: null, error: null }));
          },
        };
      }
      throw new Error(`fake admin: no handler for table ${table}`);
    },
  };

  return admin as unknown as SupabaseClient<Database> & { updateCalls: unknown[] };
}

const PROGRESS: CaptureProgress = {
  runId: "run-1",
  status: "computing",
  requestedAt: "2026-09-05T00:00:00.000Z",
  leaguesTotal: 4,
  leaguesDone: 4,
  leaguesFailed: 0,
  leaguesProcessing: 0,
  queueAhead: 0,
  workerSeenAt: "2026-09-05T00:01:00.000Z",
  partialVersion: 0,
  detail: null,
};

beforeEach(() => {
  mockLoadSettings.mockReset();
  mockStartCapture.mockReset();
  mockFindOpenRun.mockReset();
  mockLoadSettings.mockResolvedValue(SETTINGS_NO_BYPASS);
  mockFindOpenRun.mockResolvedValue(null);
});

describe("getManagerFootprint", () => {
  it("returns building, with no load and no compute, for a warm run", async () => {
    mockStartCapture.mockResolvedValue({ status: "warm", runId: "run-1", progress: PROGRESS });
    const admin = makeFakeAdmin();

    const result = await getManagerFootprint(admin, "user-1", { sleeperUserId: "u1", handle: "someone" });

    expect(result).toEqual({ status: "building", progress: PROGRESS });
  });

  it("returns building, with no load and no compute, for a run still capturing", async () => {
    const capturing: CaptureProgress = { ...PROGRESS, status: "capturing", leaguesDone: 1 };
    mockStartCapture.mockResolvedValue({ status: "started", runId: "run-1", progress: capturing });
    const admin = makeFakeAdmin();

    const result = await getManagerFootprint(admin, "user-1", { sleeperUserId: "u1", handle: "someone" });

    expect(result).toEqual({ status: "building", progress: capturing });
  });

  /*
   * MPS-T002's guarantee, kept after T040 moved the compute step out: a run
   * that reaches "started" or "warm" (so openRunId is set) and then hits an
   * unexpected throw before this function returns is still closed as error
   * rather than left open forever. Nothing in the current happy path throws
   * after that point, so this forces it via a throwing getter on the
   * outcome's `progress` property, the one thing still read after the hoist.
   */
  it("closes the run as error when something throws after the run is open", async () => {
    const throwingCapture = {
      status: "started" as const,
      runId: "run-1",
      get progress(): CaptureProgress {
        throw new Error("boom");
      },
    };
    mockStartCapture.mockResolvedValue(throwingCapture as unknown as CaptureOutcome);
    const admin = makeFakeAdmin();

    const result = await getManagerFootprint(admin, "user-1", { sleeperUserId: "u1", handle: "someone" });

    expect(result).toEqual({ status: "error", detail: "The report could not be built." });
    expect(admin.updateCalls).toHaveLength(1);
    expect(admin.updateCalls[0]).toMatchObject({ status: "error", detail: "The report could not be built." });
  });

  it("does not set openRunId, and closes nothing, when capture never opens a run", async () => {
    mockStartCapture.mockResolvedValue({ status: "not_found" });
    const admin = makeFakeAdmin();

    const result = await getManagerFootprint(admin, "user-1", { sleeperUserId: "u1", handle: "someone" });

    expect(result).toEqual({ status: "not_found", handle: "someone" });
    expect(admin.updateCalls).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* MPS-T001: resolveWindow's clock, exercised through a warm-cache read.      */
/* -------------------------------------------------------------------------- */

/*
 * Finding F14: service.ts used to define its OWN currentSeason(), reading
 * getUTCMonth()/getUTCFullYear(), while capture.ts computed the same window
 * from currentNflSeason() (local time). Two copies of one rollover rule
 * disagree for a few hours around every March rollover on a non-UTC runtime,
 * so the cache read here and the run row capture.ts wrote could land on
 * different season_to values and never meet.
 *
 * This test cannot observe resolveWindow directly (it is not exported), so it
 * proves the fix through the one place its output is externally visible: the
 * season_to/season_from filters a warm-cache read applies. currentNflSeason is
 * mocked to "2026" (the same fixture capture.test.ts uses for its own copy),
 * and the fake admin only answers with a cached report when the read is keyed
 * on exactly that season. If service.ts still computed the window from a
 * private clock, this mock would have no effect, the filters would carry
 * whatever the real system clock produces, and the fake would return no row,
 * so the assertion on `result` would fail here rather than merely lacking
 * coverage.
 */
describe("resolveWindow keys the cache read on currentNflSeason(), not a private clock", () => {
  it("reads the warm cache at season_to = 2026 / season_from = 2023 when currentNflSeason() is 2026", async () => {
    const recordedEq: Array<[string, unknown]> = [];

    class Chain implements PromiseLike<FakeResponse> {
      constructor(private readonly resolve: () => FakeResponse) {}
      select() {
        return this;
      }
      eq(column: string, value: unknown) {
        recordedEq.push([column, value]);
        return this;
      }
      ilike() {
        return this;
      }
      order() {
        return this;
      }
      limit() {
        return this;
      }
      maybeSingle() {
        return Promise.resolve(this.resolve());
      }
      update() {
        return this;
      }
      then<A, B>(
        onOk?: ((value: FakeResponse) => A | PromiseLike<A>) | null,
        onErr?: ((reason: unknown) => B | PromiseLike<B>) | null,
      ): PromiseLike<A | B> {
        return Promise.resolve(this.resolve()).then(onOk, onErr);
      }
    }

    const report = { fake: "MPS-T001 report" } as unknown as ManagerReport;
    const generatedAt = new Date().toISOString();

    const admin = {
      from(table: string) {
        if (table === "manager_pulse_cache") {
          return {
            select: () =>
              new Chain(() => {
                // Only a read keyed on the season currentNflSeason() reports
                // finds a row. A read keyed on any other season (a private
                // clock disagreeing with the mock) finds nothing, which
                // would surface below as "building" rather than "ready".
                const seasonTo = recordedEq.find(([col]) => col === "season_to")?.[1];
                const seasonFrom = recordedEq.find(([col]) => col === "season_from")?.[1];
                if (seasonTo === 2026 && seasonFrom === 2023) {
                  return {
                    data: { report, fingerprint: "fp-1", generated_at: generatedAt },
                    error: null,
                  };
                }
                return { data: null, error: null };
              }),
          };
        }
        throw new Error(`fake admin: no handler for table ${table}`);
      },
    };

    const result = await getManagerFootprint(
      admin as unknown as SupabaseClient<Database>,
      "user-1",
      { sleeperUserId: "u1", handle: "someone" },
    );

    expect(recordedEq).toEqual(
      expect.arrayContaining([
        ["season_to", 2026],
        ["season_from", 2023],
      ]),
    );
    expect(result).toEqual({ status: "ready", report, generatedAt, stale: false });
  });
});

/* -------------------------------------------------------------------------- */
/* MPS-T040 source guarantee: the render path never loads or computes.       */
/* -------------------------------------------------------------------------- */

describe("service.ts never imports the compute path", () => {
  it("contains no reference to computeFootprint, loadManagerPulseInput, buildTendency, or the fingerprint", () => {
    const source = readFileSync(
      path.resolve(__dirname, "service.ts"),
      "utf8",
    );
    expect(source).not.toContain("computeFootprint");
    expect(source).not.toContain("loadManagerPulseInput");
    expect(source).not.toContain("buildTendency");
    expect(source).not.toContain("managerPulseFingerprint");
    expect(source).not.toContain("PartialReport");
  });
});
