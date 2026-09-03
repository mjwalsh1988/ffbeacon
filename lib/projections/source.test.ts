/**
 * Coverage for lib/projections/source.ts: which projection source a reader
 * gets, and which sources actually have rows for a window.
 *
 * resolveProjectionSource is pure and gets exact-value tests. Its rule matters
 * because it is the ONLY place any caller decides which source it is reading:
 * a settings toggle stuck off must always win, and a source with no rows for
 * the window must never be handed to a caller who would then query nothing.
 */

import { beforeEach, describe, it, expect } from "vitest";
import { __resetProjectionCoverageMemo } from "./source";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  availableProjectionSources,
  resolveProjectionSource,
  resolveProjectionSourceForWindow,
  SLEEPER_SOURCE,
  BEACON_SOURCE,
} from "./source";
import { DEFAULT_PROJECTION_SETTINGS } from "./default-settings";

// The coverage probe is memoized in process (see availableProjectionSources).
// Without this, one test's cached answer is another test's fixture and the
// probe counts below depend on which file ran first.
beforeEach(() => {
  __resetProjectionCoverageMemo();
});

const enabledSettings = { ...DEFAULT_PROJECTION_SETTINGS, enabled: true };
const disabledSettings = { ...DEFAULT_PROJECTION_SETTINGS, enabled: false };

describe("resolveProjectionSource", () => {
  it("returns SLEEPER_SOURCE when the feature is off, even if BEACON_SOURCE is available", () => {
    expect(
      resolveProjectionSource({
        available: [SLEEPER_SOURCE, BEACON_SOURCE],
        settings: disabledSettings,
      }),
    ).toBe(SLEEPER_SOURCE);
  });

  it("returns BEACON_SOURCE when enabled and it covers the window", () => {
    expect(
      resolveProjectionSource({
        available: [SLEEPER_SOURCE, BEACON_SOURCE],
        settings: enabledSettings,
      }),
    ).toBe(BEACON_SOURCE);
  });

  it("falls back to SLEEPER_SOURCE when enabled but BEACON_SOURCE has no rows for the window", () => {
    expect(
      resolveProjectionSource({
        available: [SLEEPER_SOURCE],
        settings: enabledSettings,
      }),
    ).toBe(SLEEPER_SOURCE);
  });

  it("never returns a source outside `available`, falling back to SLEEPER_SOURCE when available is empty", () => {
    expect(
      resolveProjectionSource({
        available: [],
        settings: enabledSettings,
      }),
    ).toBe(SLEEPER_SOURCE);
  });
});

/**
 * A minimal fake covering only what availableProjectionSources calls:
 * from("player_weekly_projections").select("id", {count, head:true}) with
 * eq/gte/lte filters, resolved against a fixed row set.
 */
type Row = Record<string, unknown>;

function makeQuery(rows: Row[]) {
  // Fresh filter dicts per query. A shared object across calls (e.g. reusing
  // one template object and spreading it) would leak one probe's `.eq`
  // filters into the next, which is exactly the bug that would make this fake
  // unable to tell two of availableProjectionSources's concurrent source
  // probes apart.
  const eqFilters: Record<string, unknown> = {};
  const gteFilters: Record<string, unknown> = {};
  const lteFilters: Record<string, unknown> = {};
  const query = {
    select() {
      return query;
    },
    eq(col: string, val: unknown) {
      eqFilters[col] = val;
      return query;
    },
    gte(col: string, val: unknown) {
      gteFilters[col] = val;
      return query;
    },
    lte(col: string, val: unknown) {
      lteFilters[col] = val;
      return query;
    },
    then(
      resolve: (v: { count: number; error: null }) => void,
      _reject?: (e: unknown) => void,
    ) {
      let matched = rows;
      for (const [col, val] of Object.entries(eqFilters)) {
        matched = matched.filter((r) => r[col] === val);
      }
      for (const [col, val] of Object.entries(gteFilters)) {
        matched = matched.filter((r) => Number(r[col]) >= Number(val));
      }
      for (const [col, val] of Object.entries(lteFilters)) {
        matched = matched.filter((r) => Number(r[col]) <= Number(val));
      }
      resolve({ count: matched.length, error: null });
    },
  };
  return query;
}

function fakeClient(rows: Row[]): SupabaseClient<Database> {
  return { from: () => makeQuery(rows) } as unknown as SupabaseClient<Database>;
}

describe("availableProjectionSources", () => {
  it("reports only the sources that actually have rows for the window", async () => {
    const client = fakeClient([
      { source: SLEEPER_SOURCE, season: 2026, season_type: "regular", week: 5 },
      { source: SLEEPER_SOURCE, season: 2026, season_type: "regular", week: 6 },
    ]);
    const available = await availableProjectionSources(client, 2026, 5, 6);
    expect(available).toEqual([SLEEPER_SOURCE]);
  });

  it("reports both sources when both have rows", async () => {
    const client = fakeClient([
      { source: SLEEPER_SOURCE, season: 2026, season_type: "regular", week: 5 },
      { source: BEACON_SOURCE, season: 2026, season_type: "regular", week: 5 },
    ]);
    const available = await availableProjectionSources(client, 2026, 5, 6);
    expect(available.sort()).toEqual([BEACON_SOURCE, SLEEPER_SOURCE].sort());
  });

  it("reports nothing for a window neither source covers", async () => {
    const client = fakeClient([
      { source: SLEEPER_SOURCE, season: 2026, season_type: "regular", week: 1 },
    ]);
    const available = await availableProjectionSources(client, 2026, 5, 6);
    expect(available).toEqual([]);
  });

  it("does not require toWeek, matching an open-ended window", async () => {
    const client = fakeClient([
      { source: SLEEPER_SOURCE, season: 2026, season_type: "regular", week: 12 },
    ]);
    const available = await availableProjectionSources(client, 2026, 5);
    expect(available).toEqual([SLEEPER_SOURCE]);
  });
});

/**
 * Regression coverage for the finding this rewrite fixes: a cron miss that
 * leaves a gap inside the window must never let BEACON_SOURCE be selected for
 * the whole window. Before this, the check was existence ("does ffbeacon have
 * ANY row here"), and a source with rows for SOME of the window but not all of
 * it would still be handed to every reader, silently dropping the weeks it
 * never got.
 */
describe("availableProjectionSources: coverage against a cron miss", () => {
  it("selects BEACON_SOURCE when it fully covers the window (one row per Sleeper row)", async () => {
    const client = fakeClient([
      { source: SLEEPER_SOURCE, season: 2026, season_type: "regular", week: 5 },
      { source: SLEEPER_SOURCE, season: 2026, season_type: "regular", week: 6 },
      { source: SLEEPER_SOURCE, season: 2026, season_type: "regular", week: 7 },
      { source: BEACON_SOURCE, season: 2026, season_type: "regular", week: 5 },
      { source: BEACON_SOURCE, season: 2026, season_type: "regular", week: 6 },
      { source: BEACON_SOURCE, season: 2026, season_type: "regular", week: 7 },
    ]);
    const available = await availableProjectionSources(client, 2026, 5, 7);
    expect(available.sort()).toEqual([BEACON_SOURCE, SLEEPER_SOURCE].sort());
  });

  it("excludes BEACON_SOURCE when a cron miss left a gap inside the window, and keeps SLEEPER_SOURCE", async () => {
    const client = fakeClient([
      { source: SLEEPER_SOURCE, season: 2026, season_type: "regular", week: 5 },
      { source: SLEEPER_SOURCE, season: 2026, season_type: "regular", week: 6 },
      { source: SLEEPER_SOURCE, season: 2026, season_type: "regular", week: 7 },
      // The cron never ran on the day week 6 was live: no beacon row for it.
      { source: BEACON_SOURCE, season: 2026, season_type: "regular", week: 5 },
      { source: BEACON_SOURCE, season: 2026, season_type: "regular", week: 7 },
    ]);
    const available = await availableProjectionSources(client, 2026, 5, 7);
    expect(available).toEqual([SLEEPER_SOURCE]);
  });

  it("excludes BEACON_SOURCE when it has no rows in the window at all", async () => {
    const client = fakeClient([
      { source: SLEEPER_SOURCE, season: 2026, season_type: "regular", week: 5 },
      { source: SLEEPER_SOURCE, season: 2026, season_type: "regular", week: 6 },
    ]);
    const available = await availableProjectionSources(client, 2026, 5, 6);
    expect(available).toEqual([SLEEPER_SOURCE]);
  });
});

/**
 * resolveProjectionSourceForWindow is the function every consumer outside
 * lib/projections/read.ts actually calls, so the two properties that make it
 * safe to wire into a hot page get their own coverage: the disabled path must
 * cost NOTHING, and the answer must match what the pure resolver would give.
 */
describe("resolveProjectionSourceForWindow", () => {
  /** A client that fails the test if anything queries it. */
  function forbiddenClient(): SupabaseClient<Database> {
    return {
      from: () => {
        throw new Error("no query should be issued while the feature is disabled");
      },
    } as unknown as SupabaseClient<Database>;
  }

  it("issues no query at all and answers Sleeper when the feature is disabled", async () => {
    await expect(
      resolveProjectionSourceForWindow({
        supabase: forbiddenClient(),
        season: 2026,
        fromWeek: 5,
        toWeek: 7,
        settings: disabledSettings,
      }),
    ).resolves.toBe(SLEEPER_SOURCE);
  });

  it("treats a missing settings document as disabled rather than throwing", async () => {
    await expect(
      resolveProjectionSourceForWindow({
        supabase: forbiddenClient(),
        season: 2026,
        fromWeek: 5,
        settings: null,
      }),
    ).resolves.toBe(SLEEPER_SOURCE);
  });

  it("answers BEACON_SOURCE when enabled and the window is fully covered", async () => {
    const client = fakeClient([
      { source: SLEEPER_SOURCE, season: 2026, season_type: "regular", week: 5 },
      { source: SLEEPER_SOURCE, season: 2026, season_type: "regular", week: 6 },
      { source: BEACON_SOURCE, season: 2026, season_type: "regular", week: 5 },
      { source: BEACON_SOURCE, season: 2026, season_type: "regular", week: 6 },
    ]);
    await expect(
      resolveProjectionSourceForWindow({
        supabase: client,
        season: 2026,
        fromWeek: 5,
        toWeek: 6,
        settings: enabledSettings,
      }),
    ).resolves.toBe(BEACON_SOURCE);
  });

  it("falls back to Sleeper when enabled but a week inside the window is missing", async () => {
    const client = fakeClient([
      { source: SLEEPER_SOURCE, season: 2026, season_type: "regular", week: 5 },
      { source: SLEEPER_SOURCE, season: 2026, season_type: "regular", week: 6 },
      { source: BEACON_SOURCE, season: 2026, season_type: "regular", week: 5 },
    ]);
    await expect(
      resolveProjectionSourceForWindow({
        supabase: client,
        season: 2026,
        fromWeek: 5,
        toWeek: 6,
        settings: enabledSettings,
      }),
    ).resolves.toBe(SLEEPER_SOURCE);
  });
});
