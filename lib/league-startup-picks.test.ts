/**
 * Cover for the startup-pick index.
 *
 * The scenarios here are taken from real production leagues, because the bug
 * this fixes was found in production and the shapes that broke it are not the
 * shapes a made-up fixture would have:
 *
 *   - a completed 23-round startup whose picks are captured (King of Kings)
 *   - a league holding TWO completed 23-round startups for the same season with
 *     different seat maps, which is legal since migration 0029
 *   - a startup draft that has finished but whose picks we have not captured yet,
 *     because capture is capped at five drafts per pulse
 *   - a 22-round startup traded during the draft, with rounds far beyond the
 *     four that draft_pick_values publishes at all
 */

import { describe, it, expect } from "vitest";
import { loadStartupPickIndex, EMPTY_STARTUP_PICK_INDEX } from "./league-startup-picks";
import type { RankedPlayer } from "@/lib/on-the-clock/board-types";

type DraftRow = {
  sleeper_draft_id: string;
  season: number;
  status: string | null;
  type: string | null;
  start_time: string | null;
  settings: Record<string, unknown> | null;
  slot_to_roster_id: Record<string, number> | null;
  metadata: Record<string, unknown> | null;
};

type SelectionRow = {
  sleeper_draft_id: string;
  pick_no: number;
  player_id: string | null;
  sleeper_player_id: string | null;
  player_pool: string | null;
};

/**
 * A Supabase stand-in for the two tables this module reads. It honours .range()
 * so the paging path is genuinely exercised rather than assumed.
 */
function stub(drafts: DraftRow[], selections: SelectionRow[], opts: { selectionsBlocked?: boolean } = {}) {
  let selectionQueries = 0;
  const api = {
    selectionQueryCount: () => selectionQueries,
    from(table: string) {
      if (table === "league_drafts") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: drafts, error: null }),
          }),
        };
      }
      if (table === "draft_selections") {
        selectionQueries += 1;
        const rows = opts.selectionsBlocked ? [] : selections;
        const chain = {
          in: () => chain,
          order: () => chain,
          range: (from: number, to: number) =>
            Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
        };
        return { select: () => chain };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return api as unknown as Parameters<typeof loadStartupPickIndex>[0] & {
    selectionQueryCount: () => number;
  };
}

/** 12 rosters, roster N in seat N. */
const STRAIGHT_SEATS: Record<string, number> = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [String(i + 1), i + 1]),
);

function draft(over: Partial<DraftRow> = {}): DraftRow {
  return {
    sleeper_draft_id: "draft-a",
    season: 2026,
    status: "complete",
    type: "snake",
    start_time: new Date(1_000_000).toISOString(),
    settings: { rounds: 23, teams: 12 },
    slot_to_roster_id: STRAIGHT_SEATS,
    metadata: { start_time: 1_000_000, last_picked: 2_000_000, settings: { rounds: 23, teams: 12 } },
    ...over,
  };
}

function selection(pickNo: number, playerId: string | null, draftId = "draft-a"): SelectionRow {
  return {
    sleeper_draft_id: draftId,
    pick_no: pickNo,
    player_id: playerId,
    sleeper_player_id: playerId ? `s-${playerId}` : null,
    player_pool: "everyone",
  };
}

const DYNASTY = "dynasty-ppr-sflex";

describe("loadStartupPickIndex, gating", () => {
  it("does not query at all for a redraft league", async () => {
    const client = stub([draft()], [selection(1, "gibbs")]);
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: "redraft-ppr",
      picks: [{ season: 2026, round: 1, originalRosterId: 1 }],
    });
    expect(index).toBe(EMPTY_STARTUP_PICK_INDEX);
    expect(client.selectionQueryCount()).toBe(0);
  });

  it("ignores a rookie draft entirely", async () => {
    const rookie = draft({ settings: { rounds: 4, teams: 12 } });
    const client = stub([rookie], []);
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [{ season: 2026, round: 1, originalRosterId: 1 }],
    });
    expect(index.hasStartupDraft).toBe(false);
    expect(index.resolve({ season: 2026, round: 1, originalRosterId: 1 })).toBeNull();
  });

  it("returns null for a season with no startup draft, leaving pick values alone", async () => {
    const client = stub([draft()], [selection(1, "gibbs")]);
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [],
    });
    expect(index.resolve({ season: 2028, round: 1, originalRosterId: 1 })).toBeNull();
  });
});

describe("loadStartupPickIndex, completed startup", () => {
  it("resolves a first-round pick to the player actually taken", async () => {
    // Seat 1 round 1 is pick 1; seat 11 round 1 is pick 11.
    const client = stub([draft()], [selection(1, "gibbs"), selection(11, "taylor")]);
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [],
    });

    const first = index.resolve({ season: 2026, round: 1, originalRosterId: 1 })!;
    expect(first.substitution).toEqual({ kind: "player", playerId: "gibbs", simulated: false });
    expect(first.label).toBe("1.01");
    expect(first.used).toBe(true);

    const eleventh = index.resolve({ season: 2026, round: 1, originalRosterId: 11 })!;
    expect(eleventh.substitution).toEqual({ kind: "player", playerId: "taylor", simulated: false });
    expect(eleventh.label).toBe("1.11");
  });

  it("resolves a deep round the rookie pick table does not publish at all", async () => {
    // Round 12 reverses under snake: seat 1 picks last, overall 144.
    const client = stub([draft()], [selection(144, "deep-guy")]);
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [],
    });
    const out = index.resolve({ season: 2026, round: 12, originalRosterId: 1 })!;
    expect(out.pickNo).toBe(144);
    expect(out.substitution).toEqual({ kind: "player", playerId: "deep-guy", simulated: false });
  });

  it("reports a finished draft whose picks are not captured as unresolved, never as a rookie pick", async () => {
    const client = stub([draft()], []);
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [],
    });
    const out = index.resolve({ season: 2026, round: 1, originalRosterId: 1 })!;
    expect(out.substitution).toEqual({ kind: "unresolved", reason: "not-captured" });
    expect(out.used).toBe(true);
  });

  it("reports unresolved when draft_selections is unreadable, rather than mispricing", async () => {
    const client = stub([draft()], [selection(1, "gibbs")], { selectionsBlocked: true });
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [],
    });
    expect(index.resolve({ season: 2026, round: 1, originalRosterId: 1 })!.substitution).toEqual({
      kind: "unresolved",
      reason: "not-captured",
    });
  });

  it("is unresolved when the pick has no recorded origin", async () => {
    const client = stub([draft()], [selection(1, "gibbs")]);
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [],
    });
    const out = index.resolve({ season: 2026, round: 1, originalRosterId: null })!;
    expect(out.substitution).toEqual({ kind: "unresolved", reason: "no-seat" });
  });

  it("is unresolved when the roster holds no seat in the draft", async () => {
    const client = stub([draft()], [selection(1, "gibbs")]);
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [],
    });
    expect(index.resolve({ season: 2026, round: 1, originalRosterId: 99 })!.substitution).toEqual({
      kind: "unresolved",
      reason: "no-seat",
    });
  });
});

describe("loadStartupPickIndex, two drafts in one season", () => {
  // The real King of Kings shape: two complete 23-round 2026 startups whose seat
  // maps disagree. The later one is the live one.
  const earlier = draft({
    sleeper_draft_id: "1381744430708428800",
    slot_to_roster_id: { "1": 5, "11": 7 },
    start_time: new Date(1_786_150_880_861).toISOString(),
    metadata: { start_time: 1_786_150_880_861, last_picked: 1_786_158_473_921 },
  });
  const later = draft({
    sleeper_draft_id: "1394068769269088256",
    slot_to_roster_id: { "1": 7, "11": 5 },
    start_time: new Date(1_786_824_304_091).toISOString(),
    metadata: { start_time: 1_786_824_304_091, last_picked: 1_786_832_131_461 },
  });

  it("picks the draft that started later, deterministically, whatever the row order", async () => {
    for (const rows of [
      [earlier, later],
      [later, earlier],
    ]) {
      const client = stub(rows, [selection(1, "gibbs", "1394068769269088256")]);
      const index = await loadStartupPickIndex(client, {
        leagueRowId: "L",
        formatSlug: DYNASTY,
        picks: [],
      });
      // In the later draft, roster 7 holds seat 1.
      const out = index.resolve({ season: 2026, round: 1, originalRosterId: 7 })!;
      expect(out.seat).toBe(1);
      expect(out.substitution).toEqual({ kind: "player", playerId: "gibbs", simulated: false });
    }
  });

  it("sorts on the start_time COLUMN, not only the raw metadata epoch", async () => {
    // A row whose metadata predates the raw-object upsert, or is the '{}' column
    // default from migration 0027, still has the timestamptz column. Reading only
    // metadata sorted that row last here and first in the slot labeller, which is
    // how the label and the valuation came off two different drafts.
    const laterNoMeta = { ...later, metadata: {} };
    const client = stub([laterNoMeta, earlier], [selection(1, "gibbs", "1394068769269088256")]);
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [],
    });
    expect(index.resolve({ season: 2026, round: 1, originalRosterId: 7 })!.seat).toBe(1);
  });
});

describe("loadStartupPickIndex, a season running BOTH a startup and a rookie draft", () => {
  // The real "Price Check Army - Golf Squad" shape, and the normal first-year
  // dynasty shape generally: a 32-round startup in March, a 4-round rookie draft
  // in May, both stamped season 2026. Sleeper's pick descriptor carries no draft
  // id, so "2026 round 1" is ambiguous and "2026 round 12" is not.
  const STARTUP_ENDED = 1_774_132_395_830;
  const startup = draft({
    sleeper_draft_id: "startup-1",
    settings: { rounds: 32, teams: 12 },
    start_time: new Date(1_773_671_493_195).toISOString(),
    metadata: { start_time: 1_773_671_493_195, last_picked: STARTUP_ENDED },
  });
  const rookie = draft({
    sleeper_draft_id: "rookie-1",
    type: "linear",
    settings: { rounds: 4, teams: 12 },
    start_time: new Date(1_778_070_661_414).toISOString(),
    metadata: { start_time: 1_778_070_661_414, last_picked: 1_778_191_177_677 },
  });
  const rows = [startup, rookie];
  const sels = [
    { ...selection(1, "gibbs", "startup-1"), player_pool: "everyone" },
    { ...selection(144, "deepGuy", "startup-1"), player_pool: "everyone" },
    { ...selection(1, "rookieGuy", "rookie-1"), player_pool: "rookies" },
  ];

  async function build() {
    return loadStartupPickIndex(stub(rows, sels), {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [],
    });
  }

  it("keeps the startup rather than abandoning the season", async () => {
    const index = await build();
    expect(index.hasStartupDraft).toBe(true);
    expect(index.draftForSeason(2026)?.siblingRookieRounds).toBe(4);
  });

  it("resolves a round deeper than the rookie draft with no need for a date", async () => {
    const index = await build();
    // Round 12 cannot be a 4-round rookie draft's pick under any reading.
    // Round 12 is even, so it reverses: seat 1 picks last, overall 144.
    const out = index.resolve({ season: 2026, round: 12, originalRosterId: 1 })!;
    expect(out.pickNo).toBe(144);
    expect(out.substitution).toEqual({ kind: "player", playerId: "deepGuy", simulated: false });
  });

  it("treats an ambiguous round traded BEFORE the startup finished as a startup pick", async () => {
    const index = await build();
    const out = index.resolve({
      season: 2026,
      round: 1,
      originalRosterId: 1,
      tradedAtMs: STARTUP_ENDED - 60_000,
    })!;
    expect(out.substitution).toEqual({ kind: "player", playerId: "gibbs", simulated: false });
  });

  it("treats an ambiguous round traded AFTER the startup finished as a rookie pick", async () => {
    const index = await build();
    // Those startup seats are spent, so Sleeper's "2026 1st" now means the
    // rookie draft. Returning null leaves it on the existing pick valuation.
    expect(
      index.resolve({
        season: 2026,
        round: 1,
        originalRosterId: 1,
        tradedAtMs: STARTUP_ENDED + 60_000,
      }),
    ).toBeNull();
  });

  it("refuses an ambiguous round with no trade date rather than guessing", async () => {
    const index = await build();
    expect(index.resolve({ season: 2026, round: 1, originalRosterId: 1 })).toBeNull();
    expect(
      index.resolve({ season: 2026, round: 4, originalRosterId: 1, tradedAtMs: null }),
    ).toBeNull();
  });

  it("uses the DEEPEST rookie draft when a season ran more than one", async () => {
    const secondRookie = draft({
      sleeper_draft_id: "rookie-2",
      type: "linear",
      settings: { rounds: 6, teams: 12 },
      start_time: new Date(1_778_170_661_414).toISOString(),
      metadata: { start_time: 1_778_170_661_414, last_picked: 1_778_191_177_677 },
    });
    const index = await loadStartupPickIndex(stub([...rows, secondRookie], sels), {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [],
    });
    expect(index.draftForSeason(2026)?.siblingRookieRounds).toBe(6);
    // Round 6 is now inside the ambiguous band, so it needs a date.
    expect(index.resolve({ season: 2026, round: 6, originalRosterId: 1 })).toBeNull();
  });
});

describe("loadStartupPickIndex, refusing to guess", () => {
  it("ignores an auction draft, whose pick numbers follow nomination order", async () => {
    // pick_no in an auction has no relationship to (round, seat), so the seat
    // maths would return a real player at the wrong slot with full confidence.
    const auction = draft({ type: "auction" });
    const client = stub([auction], [selection(1, "gibbs")]);
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [],
    });
    expect(index.hasStartupDraft).toBe(false);
    expect(index.resolve({ season: 2026, round: 1, originalRosterId: 1 })).toBeNull();
  });

  it("leaves a round past the end of the draft on the existing pick valuation", async () => {
    const client = stub([draft()], [selection(1, "gibbs")]);
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [],
    });
    // The draft runs 23 rounds. Round 40 would otherwise place at a pick number
    // beyond the draft and report a plausible-looking miss.
    expect(index.resolve({ season: 2026, round: 40, originalRosterId: 1 })).toBeNull();
    expect(index.resolve({ season: 2026, round: 23, originalRosterId: 1 })).not.toBeNull();
  });

  it("does not read selections for a dynasty league that only ever ran rookie drafts", async () => {
    const rookie = draft({ settings: { rounds: 4, teams: 12 } });
    const client = stub([rookie], []);
    await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [],
    });
    // The round count alone rules it out, so the selections query never runs.
    expect(client.selectionQueryCount()).toBe(0);
  });

  it("demotes a long rookie draft when the capture says it was rookies only", async () => {
    // A 7-round taxi or rookie draft clears ROOKIE_DRAFT_MAX_ROUNDS, so the round
    // count reads it as a startup. The captured player_pool is the better evidence.
    const long = draft({ settings: { rounds: 8, teams: 12 } });
    const rookieSelections: SelectionRow[] = [
      { ...selection(1, "gibbs"), player_pool: "rookies" },
    ];
    const client = stub([long], rookieSelections);
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [],
    });
    expect(index.hasStartupDraft).toBe(false);
  });
});

describe("loadStartupPickIndex, a live draft whose picks we do not hold", () => {
  // The dangerous case. League Pulse captures picks for COMPLETED drafts only,
  // so a startup that is mid-flight and was never opened in the On The Clock
  // room has zero selections while dozens of players are already gone.
  // Simulating there assumes an untouched board and would confidently name a
  // player who was drafted forty picks ago. Sleeper's last_picked is the tell.
  const midFlight = draft({
    status: "drafting",
    metadata: { start_time: 1_000_000, last_picked: 1_500_000 },
  });

  function board(): RankedPlayer[] {
    return [
      {
        playerId: "top",
        sleeperId: "s-top",
        name: "Top Guy",
        position: "RB",
        team: "ATL",
        overallRank: 1,
        positionRank: 1,
        tier: 1,
        value: 9000,
        isRookie: false,
        adp: 1,
      },
    ];
  }

  it("does not simulate, and does not load the board", async () => {
    let loads = 0;
    const client = stub([midFlight], []);
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [{ season: 2026, round: 1, originalRosterId: 1 }],
      loadBoard: async () => {
        loads += 1;
        return board();
      },
    });
    expect(loads).toBe(0);
    expect(index.resolve({ season: 2026, round: 1, originalRosterId: 1 })!.substitution).toEqual({
      kind: "unresolved",
      reason: "not-captured",
    });
  });

  it("still reports the seats it DOES hold, and refuses only the rest", async () => {
    // Partial capture is a normal state: On The Clock records a live draft only
    // while somebody has the room open, so holding picks 1 to 50 of a draft that
    // has reached 120 is ordinary. A held seat is a fact; an unheld one is not
    // evidence that the seat is still open.
    const client = stub([midFlight], [selection(1, "gibbs")]);
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [{ season: 2026, round: 1, originalRosterId: 2 }],
      loadBoard: async () => board(),
    });
    expect(index.resolve({ season: 2026, round: 1, originalRosterId: 1 })!.substitution).toEqual({
      kind: "player",
      playerId: "gibbs",
      simulated: false,
    });
    expect(index.resolve({ season: 2026, round: 1, originalRosterId: 2 })!.substitution).toEqual({
      kind: "unresolved",
      reason: "not-captured",
    });
  });

  it("treats a drafting status as started even when last_picked is still null", async () => {
    // league_drafts is refreshed only on the full-sync path behind a 60-minute
    // cache, so last_picked can be an hour stale. Status is the second signal.
    const statusOnly = draft({
      status: "drafting",
      metadata: { start_time: 1_000_000, last_picked: null },
    });
    const client = stub([statusOnly], []);
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [{ season: 2026, round: 1, originalRosterId: 1 }],
      loadBoard: async () => board(),
    });
    expect(index.resolve({ season: 2026, round: 1, originalRosterId: 1 })!.substitution).toEqual({
      kind: "unresolved",
      reason: "not-captured",
    });
  });
});

describe("loadStartupPickIndex, a startup draft that has not begun", () => {
  // The case simulation exists for: a trade agreed BEFORE the startup draft
  // opens. The board really is untouched, so the ADP projection is honest.
  const live = draft({
    status: "pre_draft",
    start_time: new Date(1_000_000).toISOString(),
    metadata: { start_time: 1_000_000, last_picked: null },
  });

  function board(): RankedPlayer[] {
    return [
      {
        playerId: "top",
        sleeperId: "s-top",
        name: "Top Guy",
        position: "RB",
        team: "ATL",
        overallRank: 1,
        positionRank: 1,
        tier: 1,
        value: 9000,
        isRookie: false,
        adp: 1,
      },
      {
        playerId: "next",
        sleeperId: "s-next",
        name: "Next Guy",
        position: "WR",
        team: "BUF",
        overallRank: 2,
        positionRank: 1,
        tier: 1,
        value: 8000,
        isRookie: false,
        adp: 2,
      },
    ];
  }

  it("simulates an undrafted seat and flags it as an estimate", async () => {
    const client = stub([live], []);
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [{ season: 2026, round: 1, originalRosterId: 1 }],
      loadBoard: async () => board(),
    });
    const out = index.resolve({ season: 2026, round: 1, originalRosterId: 1 })!;
    expect(out.substitution).toEqual({ kind: "player", playerId: "top", simulated: true });
    expect(out.used).toBe(false);
  });

  it("still prefers the real selection for a seat that has already gone", async () => {
    const client = stub([live], [selection(1, "gibbs")]);
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [{ season: 2026, round: 1, originalRosterId: 2 }],
      loadBoard: async () => board(),
    });
    expect(index.resolve({ season: 2026, round: 1, originalRosterId: 1 })!.substitution).toEqual({
      kind: "player",
      playerId: "gibbs",
      simulated: false,
    });
  });

  it("never loads the board for a completed draft", async () => {
    let loads = 0;
    const client = stub([draft()], [selection(1, "gibbs")]);
    await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [{ season: 2026, round: 1, originalRosterId: 1 }],
      loadBoard: async () => {
        loads += 1;
        return board();
      },
    });
    expect(loads).toBe(0);
  });

  it("never loads the board when no referenced pick needs simulating", async () => {
    let loads = 0;
    const client = stub([live], []);
    await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      // A pick in a season with no startup draft.
      picks: [{ season: 2029, round: 1, originalRosterId: 1 }],
      loadBoard: async () => {
        loads += 1;
        return board();
      },
    });
    expect(loads).toBe(0);
  });

  it("loads the board once even when many seats need simulating", async () => {
    let loads = 0;
    const client = stub([live], []);
    await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [
        { season: 2026, round: 1, originalRosterId: 1 },
        { season: 2026, round: 2, originalRosterId: 4 },
        { season: 2026, round: 9, originalRosterId: 7 },
      ],
      loadBoard: async () => {
        loads += 1;
        return board();
      },
    });
    expect(loads).toBe(1);
  });

  it("reports board exhaustion rather than inventing a player", async () => {
    const client = stub([live], []);
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [{ season: 2026, round: 20, originalRosterId: 6 }],
      loadBoard: async () => board(),
    });
    // A two-player board cannot reach a round-20 seat.
    expect(index.resolve({ season: 2026, round: 20, originalRosterId: 6 })!.substitution).toEqual({
      kind: "unresolved",
      reason: "board-exhausted",
    });
  });
});

describe("timingFor", () => {
  it("places a trade before, during, and after the startup draft", async () => {
    const client = stub([draft()], [selection(1, "gibbs")]);
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [],
    });
    const iso = (ms: number) => new Date(ms).toISOString();
    expect(index.timingFor(2026, iso(999_999))).toBe("before-draft");
    expect(index.timingFor(2026, iso(1_500_000))).toBe("during-draft");
    expect(index.timingFor(2026, iso(2_500_000))).toBe("after-draft");
    expect(index.timingFor(2026, null)).toBe("unknown");
    expect(index.timingFor(2029, iso(1_500_000))).toBe("unknown");
  });
});

describe("loadStartupPickIndex, paging", () => {
  it("reads past the 1000-row PostgREST cap", async () => {
    // A 12-team 33-round startup is 396 picks; three drafts blow the cap.
    const big = draft({ settings: { rounds: 33, teams: 12 } });
    const rows: SelectionRow[] = [];
    for (let pickNo = 1; pickNo <= 1200; pickNo += 1) {
      rows.push(selection(pickNo, `p-${pickNo}`));
    }
    const client = stub([big], rows);
    const index = await loadStartupPickIndex(client, {
      leagueRowId: "L",
      formatSlug: DYNASTY,
      picks: [],
    });
    // Round 33 is odd, so it runs forward under snake and seat 1 leads it: 385.
    const out = index.resolve({ season: 2026, round: 33, originalRosterId: 1 })!;
    expect(out.pickNo).toBe(385);
    expect(out.substitution).toEqual({ kind: "player", playerId: "p-385", simulated: false });
    // And a row beyond the first page is present.
    expect(index.resolve({ season: 2026, round: 1, originalRosterId: 1 })!.substitution).toEqual({
      kind: "player",
      playerId: "p-1",
      simulated: false,
    });
  });
});
