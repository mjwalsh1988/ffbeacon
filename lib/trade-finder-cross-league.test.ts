/**
 * The portfolio walk.
 *
 * These tests are about WHICH leagues get searched and how the answers are
 * shared out between them, not about whether any particular trade is good. The
 * engine is exercised properly in lib/trade-finder/engine.test.ts; here it runs
 * for real over tiny synthetic leagues, and the only thing stubbed is the
 * database read that turns a league id into rosters.
 *
 * Both behaviours under test were reported by readers rather than found by
 * anyone looking: a manager in more than three leagues could press Search all
 * day and never see the fourth one, and the deals they did see came mostly from
 * whichever league happened to be first in the list.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { STANDARD_SLOTS, pick, player, team } from "./trade-finder/_test-kit";
import type { FinderTeam } from "./trade-finder/types";

/**
 * Every league is the same shape, so any bias in the results is the walk's and
 * not the fixture's. Values are nudged per league so the scores differ slightly,
 * which is what a merge sorted purely on score would key off.
 */
function leagueTeams(seed: number): FinderTeam[] {
  const bump = seed * 40;
  return [
    team({
      rosterId: 1,
      teamName: `Mine ${seed}`,
      statusKey: "competitor",
      players: [
        player({ playerId: `l${seed}-my-qb`, position: "QB", projPoints: 20, value: 3000 + bump }),
        player({ playerId: `l${seed}-my-rb1`, position: "RB", projPoints: 16, value: 3200 + bump }),
        player({ playerId: `l${seed}-my-rb2`, position: "RB", projPoints: 14, value: 2800 + bump }),
        player({ playerId: `l${seed}-my-rb3`, position: "RB", projPoints: 11, value: 2400, age: 27 }),
        player({ playerId: `l${seed}-my-wr1`, position: "WR", projPoints: 15, value: 3000 }),
        player({ playerId: `l${seed}-my-wr2`, position: "WR", projPoints: 13, value: 2600 }),
        player({ playerId: `l${seed}-my-te`, position: "TE", projPoints: 3, value: 300 }),
        player({ playerId: `l${seed}-my-wr3`, position: "WR", projPoints: 10, value: 2000 }),
        player({ playerId: `l${seed}-my-rb4`, position: "RB", projPoints: 9, value: 1500 }),
        player({ playerId: `l${seed}-my-wr4`, position: "WR", projPoints: 8, value: 1200 }),
      ],
      picks: [pick({ key: `pick:2027:1:l${seed}a`, value: 2600 })],
    }),
    team({
      rosterId: 2,
      teamName: `Theirs ${seed}`,
      statusKey: "rebuilder",
      players: [
        player({ playerId: `l${seed}-th-qb`, position: "QB", projPoints: 18, value: 2600 }),
        player({ playerId: `l${seed}-th-rb1`, position: "RB", projPoints: 9, value: 1400 }),
        player({ playerId: `l${seed}-th-wr1`, position: "WR", projPoints: 14, value: 2800 }),
        player({ playerId: `l${seed}-th-wr2`, position: "WR", projPoints: 12, value: 2400 }),
        player({ playerId: `l${seed}-th-te1`, position: "TE", projPoints: 13, value: 2600 }),
        player({ playerId: `l${seed}-th-te2`, position: "TE", projPoints: 11, value: 2300, age: 23 }),
        player({ playerId: `l${seed}-th-wr3`, position: "WR", projPoints: 10, value: 1900 }),
        player({ playerId: `l${seed}-th-rb3`, position: "RB", projPoints: 7, value: 800 }),
        player({ playerId: `l${seed}-th-wr4`, position: "WR", projPoints: 6, value: 700 }),
        player({ playerId: `l${seed}-th-qb2`, position: "QB", projPoints: 5, value: 400 }),
      ],
      picks: [pick({ key: `pick:2027:1:l${seed}b`, value: 2500 })],
    }),
  ];
}

const loaded: string[] = [];

vi.mock("@/lib/trade-finder-data", () => ({
  loadTradeFinderLeague: vi.fn(
    async (_supabase: unknown, params: { sleeperLeagueId: string }) => {
      loaded.push(params.sleeperLeagueId);
      const seed = Number(params.sleeperLeagueId.replace(/\D/g, "")) || 1;
      return {
        sleeperLeagueId: params.sleeperLeagueId,
        leagueName: `League ${seed}`,
        formatDisplay: "Dynasty Superflex",
        sourceDisplay: "KeepTradeCut",
        pickSourceDisplay: null,
        myRosterId: 1,
        teams: leagueTeams(seed),
        startingSlots: STANDARD_SLOTS,
        isDynasty: true,
        allowPicks: true,
        poolMax: 9900,
        sleeperLeague: {},
      };
    },
  ),
}));

const { findCrossLeagueTrade, CROSS_LEAGUE_LIMITS } = await import(
  "./trade-finder-cross-league"
);

const IDS = ["100", "200", "300", "400", "500", "600"];

function walk(cursor: number, ids: string[] = IDS) {
  return findCrossLeagueTrade({} as never, {
    sleeperLeagueIds: ids,
    sleeperUserId: "u1",
    sourceSlug: "ktc",
    cursor,
    excludeByLeague: new Map(),
    sessionExcluded: [],
  });
}

beforeEach(() => {
  loaded.length = 0;
});

describe("findCrossLeagueTrade", () => {
  it("moves on to the next leagues instead of re-reading the first one", async () => {
    // The reported failure. The cursor used to stop on the earliest league in
    // the window that still had a deal in it, which for any real portfolio is
    // league one, every time. Pressing Search repeatedly reopened the same
    // leagues forever and the rest of the portfolio was never searched at all.
    const first = await walk(0);
    expect(first.nextCursor).toBeGreaterThan(0);

    loaded.length = 0;
    await walk(first.nextCursor);
    expect(loaded).not.toContain(IDS[0]);
  });

  it("reaches every league in the portfolio within a few presses", async () => {
    const seen = new Set<string>();
    let cursor = 0;
    for (let press = 0; press < 3; press += 1) {
      loaded.length = 0;
      const result = await walk(cursor);
      for (const id of loaded) seen.add(id);
      cursor = result.nextCursor;
    }
    expect([...seen].sort()).toEqual([...IDS].sort());
  });

  it("returns to the start once the whole portfolio has been walked", async () => {
    let cursor = 0;
    for (let press = 0; press < 2; press += 1) {
      cursor = (await walk(cursor)).nextCursor;
    }
    // Two presses at four leagues a press covers six and wraps. A cursor that
    // parked past the end used to be terminal: the panel returned nothing on
    // every later press until the page was reloaded.
    expect(cursor).toBe(0);
    expect((await walk(cursor)).suggestions.length).toBeGreaterThan(0);
  });

  it("survives a cursor past the end of the list", async () => {
    const result = await walk(999);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it("gives every league in the window an equal share", async () => {
    const { suggestions } = await walk(0);
    const counts = new Map<string, number>();
    for (const s of suggestions) {
      const id = s.league.sleeperLeagueId;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect(counts.size).toBe(CROSS_LEAGUE_LIMITS.LEAGUE_WINDOW);

    // Round-robin, so the shares can differ by at most one. Sorting the whole
    // window by score and walking it, which is what this used to do, let one
    // league supply most of the list whenever its deals happened to score well.
    const shares = [...counts.values()];
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
  });

  it("leads with a different league on each of the first few cards", async () => {
    const { suggestions } = await walk(0);
    const opening = suggestions
      .slice(0, CROSS_LEAGUE_LIMITS.LEAGUE_WINDOW)
      .map((s) => s.league.sleeperLeagueId);
    expect(new Set(opening).size).toBe(opening.length);
  });

  it("does not open more leagues than the window allows", async () => {
    await walk(0);
    expect(loaded.length).toBe(CROSS_LEAGUE_LIMITS.LEAGUE_WINDOW);
  });

  it("says nothing at all rather than looping on an empty portfolio", async () => {
    const result = await findCrossLeagueTrade({} as never, {
      sleeperLeagueIds: [],
      sleeperUserId: "u1",
      sourceSlug: "ktc",
      cursor: 0,
      excludeByLeague: new Map(),
      sessionExcluded: [],
    });
    expect(result.suggestions).toEqual([]);
    expect(result.examined).toBe(0);
  });

  it("carries the league on every suggestion, so a card can say where it is from", async () => {
    const { suggestions } = await walk(0);
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(s.league.name).toBeTruthy();
      expect(IDS).toContain(s.league.sleeperLeagueId);
      // The reasoning travels with it, which is the whole point of showing a
      // deal out of one room rather than another.
      expect(s.rationale.length).toBeGreaterThan(0);
    }
  });
});
