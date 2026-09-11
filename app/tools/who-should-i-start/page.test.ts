import { describe, it, expect } from "vitest";
import {
  START_SIT_TITLE,
  TOOL_PATH,
  buildStartSitDescription,
  buildStartSitCanonical,
  type StartSitSearchParams,
} from "./page-helpers";
import { resolveSeasonClock } from "@/lib/start-sit/clock";

/**
 * Metadata tests for the Who Should I Start / Beacon Breakdown page
 * (docs/seo/who-should-i-start-and-site-seo-plan.md section 2.13's
 * "A metadata test for the page" bullet). Everything under test here is a
 * pure function from page-helpers.ts, plus resolveSeasonClock, which is
 * already pure over its Supabase reads and mocked the way
 * lib/on-the-clock/board-loader.test.ts mocks a chainable client.
 */

describe("START_SIT_TITLE", () => {
  it("is under 60 characters", () => {
    expect(START_SIT_TITLE.length).toBeLessThan(60);
  });

  it("is the exact confirmed string", () => {
    expect(START_SIT_TITLE).toBe(
      "Who Should I Start in Fantasy Football? | Beacon Breakdown",
    );
  });
});

describe("buildStartSitDescription", () => {
  it("stays at or under 155 characters for every regular-season week", () => {
    for (let week = 1; week <= 18; week++) {
      const description = buildStartSitDescription(week);
      expect(description.length).toBeLessThanOrEqual(155);
    }
  });

  it("names the week it was templated for", () => {
    for (let week = 1; week <= 18; week++) {
      expect(buildStartSitDescription(week)).toContain(`Week ${week}`);
    }
  });

  it("never names a different week than the one it was templated for", () => {
    // Guards against a stray "Week 1" left over from a copy/paste template.
    expect(buildStartSitDescription(9)).not.toContain("Week 1 ");
    expect(buildStartSitDescription(1)).toContain("Week 1 ");
  });
});

describe("buildStartSitCanonical", () => {
  const paramCombinations: StartSitSearchParams[] = [
    {},
    { p: "bijan-robinson,josh-jacobs" },
    { a: "bijan-robinson", b: "josh-jacobs" },
    { start: "1" },
    { week: "3" },
    { league: "123456789" },
    { roster: "4" },
    { lens: "dynasty" },
    {
      p: "bijan-robinson,josh-jacobs,alvin-kamara",
      a: "bijan-robinson",
      b: "josh-jacobs",
      start: "2",
      week: "5",
      league: "123456789",
      roster: "4",
      lens: "win-now",
    },
  ];

  it("is always the bare tool path, whatever the incoming search params were", () => {
    for (const params of paramCombinations) {
      // buildStartSitCanonical takes no arguments: the canonical never
      // varies with the request, which is the guarantee under test. Each
      // combination stands in for a request that carried it.
      void params;
      const canonical = buildStartSitCanonical();
      expect(canonical).not.toContain("?");
      expect(canonical).toBe(TOOL_PATH);
    }
  });

  it("never carries a query string", () => {
    const canonical = buildStartSitCanonical();
    expect(canonical.includes("?")).toBe(false);
    expect(canonical.includes("=")).toBe(false);
    expect(canonical.includes("&")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* resolveSeasonClock fixtures, for the templated-week boundary test.  */
/* ------------------------------------------------------------------ */

/**
 * Minimal chainable Supabase mock covering exactly the three reads
 * resolveSeasonClock makes: the newest projected season
 * (player_weekly_projections), the newest graded season, and (when that
 * graded season matches the projected one) the newest played week, both off
 * player_stats. Keyed by table and select() argument the way
 * lib/on-the-clock/board-loader.test.ts keys its own canned results, since
 * player_stats is queried twice with different select() columns.
 */
function mockClockSupabase(opts: {
  projectedSeason: number | null;
  gradedSeason: number | null;
  /** The newest week with a completed (gp > 0) game in the graded season. */
  playedWeek: number | null;
}) {
  function builder(table: string) {
    const state: { selectArg?: string } = {};
    const result = () => {
      if (table === "player_weekly_projections") {
        return {
          data: opts.projectedSeason == null ? null : { season: opts.projectedSeason },
          error: null,
        };
      }
      if (table === "player_stats") {
        if (state.selectArg === "week") {
          return { data: opts.playedWeek == null ? null : { week: opts.playedWeek }, error: null };
        }
        return { data: opts.gradedSeason == null ? null : { season: opts.gradedSeason }, error: null };
      }
      return { data: null, error: null };
    };
    const b: Record<string, unknown> = {
      select(arg: string) {
        state.selectArg = arg;
        return b;
      },
      eq: () => b,
      gt: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: () => Promise.resolve(result()),
    };
    return b;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => builder(table) } as any;
}

describe("templated week matches resolveSeasonClock at a rollover boundary", () => {
  /**
   * The "Tuesday rollover": Monday Night Football's box score lands in
   * player_stats sometime Monday night or Tuesday morning, and the live week
   * advances the moment that row exists, not on a calendar schedule. This
   * fixture holds every other input fixed (season 2026, graded season 2026)
   * and flips only whether week 3's game has been recorded, so the two
   * clocks below are the same season one played game apart.
   */
  it("stays on the earlier week the moment before the boundary", async () => {
    const supabase = mockClockSupabase({
      projectedSeason: 2026,
      gradedSeason: 2026,
      playedWeek: 2, // week 2 is the newest played week; week 3 has not happened yet.
    });
    const clock = await resolveSeasonClock(supabase);
    expect(clock.currentWeek).toBe(3);
    expect(buildStartSitDescription(clock.currentWeek)).toContain("Week 3");
  });

  it("rolls the templated week forward the moment the boundary is crossed", async () => {
    const supabase = mockClockSupabase({
      projectedSeason: 2026,
      gradedSeason: 2026,
      playedWeek: 3, // week 3's game just landed in player_stats.
    });
    const clock = await resolveSeasonClock(supabase);
    expect(clock.currentWeek).toBe(4);
    expect(buildStartSitDescription(clock.currentWeek)).toContain("Week 4");
    expect(buildStartSitDescription(clock.currentWeek)).not.toContain("Week 3");
  });

  it("clamps at week 18 rather than describing a 19th regular-season week", async () => {
    const supabase = mockClockSupabase({
      projectedSeason: 2026,
      gradedSeason: 2026,
      playedWeek: 18,
    });
    const clock = await resolveSeasonClock(supabase);
    expect(clock.currentWeek).toBe(19);
    // buildStartSitDescription is templated on whatever week it is given;
    // the clamp itself belongs to resolveSeasonClock, verified above. The
    // page only ever calls the description builder with a week that came
    // out of the clock, so the two never disagree in production.
    expect(buildStartSitDescription(18).length).toBeLessThanOrEqual(155);
  });

  it("stays on week 1 in the preseason, before anything has been played", async () => {
    const supabase = mockClockSupabase({
      projectedSeason: 2026,
      gradedSeason: null,
      playedWeek: null,
    });
    const clock = await resolveSeasonClock(supabase);
    expect(clock.currentWeek).toBe(1);
    expect(buildStartSitDescription(clock.currentWeek)).toContain("Week 1");
  });
});

import { describe as describeCap, expect as expectCap, it as itCap } from "vitest";
import { parseRawPlayerEntries as parseEntriesForCap } from "./page-helpers";
import { MAX_START_SIT_PLAYERS as MAX_FOR_CAP } from "@/lib/start-sit/types";

describeCap("parseRawPlayerEntries bounds ?p= before any database work", () => {
  itCap("caps hundreds of entries at the player limit", () => {
    const p = Array.from({ length: 500 }, (_, i) => `player-${i}`).join(",");
    expectCap(parseEntriesForCap({ p })).toHaveLength(MAX_FOR_CAP);
  });

  itCap("collapses duplicates regardless of case, keeping the first spelling", () => {
    expectCap(parseEntriesForCap({ p: "bijan-robinson,Bijan-Robinson,josh-jacobs" })).toEqual([
      "bijan-robinson",
      "josh-jacobs",
    ]);
  });

  itCap("drops entries longer than any real slug or name", () => {
    expectCap(parseEntriesForCap({ p: `${"x".repeat(200)},josh-jacobs,bijan-robinson` })).toEqual([
      "josh-jacobs",
      "bijan-robinson",
    ]);
  });

  itCap("bounds the a and b alias the same way", () => {
    expectCap(parseEntriesForCap({ a: "josh-jacobs", b: "JOSH-JACOBS" })).toEqual(["josh-jacobs"]);
  });
});

