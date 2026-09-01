import { describe, it, expect } from "vitest";
import type {
  ScheduleMatchup,
  ScheduleMatchupSide,
  ScheduleWeekView,
} from "@/lib/league-schedule/types";
import { orderRecaps, pickMatchups, recapKeyPart } from "./select-matchup";

function side(rosterId: number, over: Partial<ScheduleMatchupSide> = {}): ScheduleMatchupSide {
  return {
    sleeperRosterId: rosterId,
    teamName: `Team ${rosterId}`,
    ownerHandle: null,
    ownerAvatarId: null,
    record: { wins: 0, losses: 0, ties: 0 },
    pulseRank: null,
    actual: null,
    projectedOptimal: null,
    sigma: null,
    pointsLeftOnBench: null,
    won: false,
    ...over,
  } as ScheduleMatchupSide;
}

function game(
  matchupId: number | null,
  home: ScheduleMatchupSide,
  away: ScheduleMatchupSide | null,
  over: Partial<ScheduleMatchup> = {},
): ScheduleMatchup {
  return {
    matchupId,
    week: 5,
    isFinal: false,
    home,
    away,
    homeWinProb: null,
    ...over,
  } as ScheduleMatchup;
}

function week(matchups: ScheduleMatchup[]): ScheduleWeekView {
  return { week: 5, isFinal: false, isCurrent: true, isPlayoffWeek: false, matchups };
}

describe("pickMatchups", () => {
  it("takes the two best teams as the headline", () => {
    const board = week([
      game(1, side(1, { pulseRank: 1 }), side(2, { pulseRank: 2 })),
      game(2, side(3, { pulseRank: 11 }), side(4, { pulseRank: 12 })),
      game(3, side(5, { pulseRank: 6 }), side(6, { pulseRank: 7 })),
    ]);
    const picks = pickMatchups(board, 12, { headline: true, undercard: false });
    expect(picks).toHaveLength(1);
    expect(picks[0].matchup.matchupId).toBe(1);
  });

  it("takes the two worst teams as the undercard", () => {
    const board = week([
      game(1, side(1, { pulseRank: 1 }), side(2, { pulseRank: 2 })),
      game(2, side(3, { pulseRank: 11 }), side(4, { pulseRank: 12 })),
    ]);
    const picks = pickMatchups(board, 12, { headline: false, undercard: true });
    expect(picks[0].matchup.matchupId).toBe(2);
  });

  it("never gives the same fixture twice", () => {
    const board = week([
      game(1, side(1, { pulseRank: 1 }), side(2, { pulseRank: 2 })),
      game(2, side(3, { pulseRank: 3 }), side(4, { pulseRank: 4 })),
    ]);
    const picks = pickMatchups(board, 12, { headline: true, undercard: true });
    expect(picks).toHaveLength(2);
    expect(picks[0].matchup.matchupId).not.toBe(picks[1].matchup.matchupId);
  });

  it("returns only one pick when a week has only one game", () => {
    const board = week([game(1, side(1, { pulseRank: 1 }), side(2, { pulseRank: 2 }))]);
    const picks = pickMatchups(board, 12, { headline: true, undercard: true });
    expect(picks).toHaveLength(1);
    expect(picks[0].slot).toBe("headline");
  });

  it("prefers the coin flip when two games are equally good", () => {
    const board = week([
      game(1, side(1, { pulseRank: 1 }), side(2, { pulseRank: 4 }), { homeWinProb: 0.95 }),
      game(2, side(3, { pulseRank: 2 }), side(4, { pulseRank: 3 }), { homeWinProb: 0.5 }),
    ]);
    const picks = pickMatchups(board, 12, { headline: true, undercard: false });
    expect(picks[0].matchup.matchupId).toBe(2);
  });

  it("skips a roster with no opponent, which has nothing to preview", () => {
    const board = week([
      game(1, side(1, { pulseRank: 1 }), null),
      game(2, side(3, { pulseRank: 8 }), side(4, { pulseRank: 9 })),
    ]);
    const picks = pickMatchups(board, 12, { headline: true, undercard: false });
    expect(picks[0].matchup.matchupId).toBe(2);
  });

  it("still picks a headline when the league has no Power Pulse ranks", () => {
    // An unranked team scores mid-table, not bottom, so a league with no cache
    // gets a game rather than nothing.
    const board = week([game(1, side(1), side(2)), game(2, side(3), side(4))]);
    const picks = pickMatchups(board, 12, { headline: true, undercard: true });
    expect(picks).toHaveLength(2);
  });

  it("returns nothing for an empty week rather than throwing", () => {
    expect(pickMatchups(week([]), 12, { headline: true, undercard: true })).toEqual([]);
  });
});

describe("orderRecaps", () => {
  const final = { isFinal: true };

  it("leads with the closest game, because that is the one still being argued about", () => {
    const board = week([
      game(1, side(1, { actual: 150 }), side(2, { actual: 90 }), final),
      game(2, side(3, { actual: 120 }), side(4, { actual: 118 }), final),
    ]);
    expect(orderRecaps(board).map((m) => m.matchupId)).toEqual([2, 1]);
  });

  it("leaves out games that are not final", () => {
    const board = week([
      game(1, side(1, { actual: 150 }), side(2, { actual: 90 }), final),
      game(2, side(3), side(4)),
    ]);
    expect(orderRecaps(board).map((m) => m.matchupId)).toEqual([1]);
  });

  it("is stable, so a run interrupted at 2pm resumes in the same order at 3pm", () => {
    const board = week([
      game(2, side(3, { actual: 100 }), side(4, { actual: 100 }), final),
      game(1, side(1, { actual: 100 }), side(2, { actual: 100 }), final),
    ]);
    expect(orderRecaps(board).map((m) => m.matchupId)).toEqual([1, 2]);
    expect(orderRecaps(board).map((m) => m.matchupId)).toEqual([1, 2]);
  });
});

describe("recapKeyPart", () => {
  it("keys on the lower roster id, never on the nullable matchup id", () => {
    // matchup_id is null whenever Sleeper leaves a roster unpaired, and a null
    // in a dedupe key is a key that stops deduplicating.
    expect(recapKeyPart(game(null, side(7), side(3)))).toBe(3);
  });

  it("gives the same key whichever side the board lists first", () => {
    expect(recapKeyPart(game(1, side(7), side(3)))).toBe(recapKeyPart(game(1, side(3), side(7))));
  });
});
