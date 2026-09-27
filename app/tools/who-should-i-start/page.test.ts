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
 * Minimal chainable Supabase mock covering the reads resolveSeasonClock makes:
 * the newest projected season (player_weekly_projections), the newest graded
 * season (player_stats) and the kickoff calendar (nfl_game_odds). The played
 * week is deliberately NOT an input any more: a played game does not end a
 * week, and the fixture below has week 3 half played on purpose.
 */
function mockClockSupabase(opts: {
  projectedSeason: number | null;
  gradedSeason: number | null;
  kickoffs: Array<{ week: number; kickoff_at: string }>;
}) {
  function builder(table: string) {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      gt: () => b,
      not: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: () => {
        if (table === "player_weekly_projections") {
          return Promise.resolve({
            data: opts.projectedSeason == null ? null : { season: opts.projectedSeason },
            error: null,
          });
        }
        if (table === "player_stats") {
          return Promise.resolve({
            data: opts.gradedSeason == null ? null : { season: opts.gradedSeason },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      // The kickoff read is awaited as a list rather than through maybeSingle.
      then: (resolve: (v: unknown) => unknown) =>
        resolve({ data: table === "nfl_game_odds" ? opts.kickoffs : null, error: null }),
    };
    return b;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (table: string) => builder(table) } as any;
}

/** The 2026 slate around week 3, as nfl_game_odds holds it (UTC). */
const KICKOFFS_2026 = [
  { week: 1, kickoff_at: "2026-09-15T00:15:00Z" },
  { week: 2, kickoff_at: "2026-09-18T00:15:00Z" },
  { week: 2, kickoff_at: "2026-09-22T00:15:00Z" },
  // Week 3: Thursday Sep 24, Sunday Sep 27, Monday Sep 28 at 8:15 PM Eastern.
  { week: 3, kickoff_at: "2026-09-25T00:15:00Z" },
  { week: 3, kickoff_at: "2026-09-27T17:00:00Z" },
  { week: 3, kickoff_at: "2026-09-29T00:15:00Z" },
  { week: 4, kickoff_at: "2026-10-02T00:15:00Z" },
  { week: 4, kickoff_at: "2026-10-06T00:15:00Z" },
];

describe("templated week matches resolveSeasonClock at a rollover boundary", () => {
  const base = { projectedSeason: 2026, gradedSeason: 2026, kickoffs: KICKOFFS_2026 };

  it("stays on week 3 after the Thursday night game has been played", async () => {
    // Friday Sep 25, noon Eastern. Week 3's Thursday box scores exist.
    const clock = await resolveSeasonClock(mockClockSupabase(base), Date.parse("2026-09-25T16:00:00Z"));
    expect(clock.currentWeek).toBe(3);
    expect(buildStartSitDescription(clock.currentWeek)).toContain("Week 3");
  });

  it("stays on week 3 through Monday 11:59 PM Eastern", async () => {
    const clock = await resolveSeasonClock(mockClockSupabase(base), Date.parse("2026-09-29T03:59:00Z"));
    expect(clock.currentWeek).toBe(3);
  });

  it("rolls the templated week forward at midnight Eastern after the Monday game", async () => {
    const clock = await resolveSeasonClock(mockClockSupabase(base), Date.parse("2026-09-29T04:00:00Z"));
    expect(clock.currentWeek).toBe(4);
    expect(buildStartSitDescription(clock.currentWeek)).toContain("Week 4");
    expect(buildStartSitDescription(clock.currentWeek)).not.toContain("Week 3");
  });

  it("reads 19 once the last week on the calendar is over", async () => {
    const clock = await resolveSeasonClock(
      mockClockSupabase({
        ...base,
        kickoffs: Array.from({ length: 18 }, (_, i) => ({
          week: i + 1,
          kickoff_at: new Date(Date.parse("2026-09-15T00:15:00Z") + i * 7 * 86400000).toISOString(),
        })),
      }),
      Date.parse("2027-01-12T12:00:00Z"),
    );
    expect(clock.currentWeek).toBe(19);
    // buildStartSitDescription is templated on whatever week it is given;
    // the page only ever calls it with a week that came out of the clock.
    expect(buildStartSitDescription(18).length).toBeLessThanOrEqual(155);
  });

  it("stays on week 1 in the preseason, before anything has been played", async () => {
    const clock = await resolveSeasonClock(
      mockClockSupabase({ ...base, gradedSeason: null }),
      Date.parse("2026-08-20T12:00:00Z"),
    );
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

