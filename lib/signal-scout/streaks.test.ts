import { describe, it, expect } from "vitest";
import {
  applyRoundOutcomeToStreaks,
  currentEasternGameDate,
  isConsecutiveDay,
  type StreakState,
} from "./streaks";

function baseState(overrides: Partial<StreakState> = {}): StreakState {
  return {
    currentSignalStreak: 0,
    bestSignalStreak: 0,
    currentDailyStreak: 0,
    bestDailyStreak: 0,
    lastPlayedDate: null,
    ...overrides,
  };
}

describe("applyRoundOutcomeToStreaks: signal streak", () => {
  it("won increments the signal streak and raises the best", () => {
    const current = baseState({ currentSignalStreak: 2, bestSignalStreak: 3, lastPlayedDate: "2026-06-01" });
    const result = applyRoundOutcomeToStreaks({ outcome: "won", gameDate: "2026-06-02", current });
    expect(result.currentSignalStreak).toBe(3);
    expect(result.bestSignalStreak).toBe(3);
  });

  it("won past the previous best raises best_signal_streak", () => {
    const current = baseState({ currentSignalStreak: 3, bestSignalStreak: 3, lastPlayedDate: "2026-06-01" });
    const result = applyRoundOutcomeToStreaks({ outcome: "won", gameDate: "2026-06-02", current });
    expect(result.currentSignalStreak).toBe(4);
    expect(result.bestSignalStreak).toBe(4);
  });

  it("solved_late resets the signal streak but still counts the day", () => {
    const current = baseState({
      currentSignalStreak: 5,
      bestSignalStreak: 5,
      currentDailyStreak: 1,
      bestDailyStreak: 1,
      lastPlayedDate: "2026-06-01",
    });
    const result = applyRoundOutcomeToStreaks({ outcome: "solved_late", gameDate: "2026-06-02", current });
    expect(result.currentSignalStreak).toBe(0);
    expect(result.bestSignalStreak).toBe(5);
    expect(result.currentDailyStreak).toBe(2);
    expect(result.lastPlayedDate).toBe("2026-06-02");
  });

  it("failed resets the signal streak and still counts the day", () => {
    const current = baseState({
      currentSignalStreak: 5,
      bestSignalStreak: 5,
      currentDailyStreak: 1,
      bestDailyStreak: 1,
      lastPlayedDate: "2026-06-01",
    });
    const result = applyRoundOutcomeToStreaks({ outcome: "failed", gameDate: "2026-06-02", current });
    expect(result.currentSignalStreak).toBe(0);
    expect(result.currentDailyStreak).toBe(2);
  });

  it("skipped resets the signal streak and still counts the day", () => {
    const current = baseState({
      currentSignalStreak: 5,
      bestSignalStreak: 5,
      currentDailyStreak: 1,
      bestDailyStreak: 1,
      lastPlayedDate: "2026-06-01",
    });
    const result = applyRoundOutcomeToStreaks({ outcome: "skipped", gameDate: "2026-06-02", current });
    expect(result.currentSignalStreak).toBe(0);
    expect(result.currentDailyStreak).toBe(2);
  });
});

describe("applyRoundOutcomeToStreaks: daily scout streak", () => {
  it("first-ever round sets daily streak to 1 and stamps lastPlayedDate", () => {
    const current = baseState();
    const result = applyRoundOutcomeToStreaks({ outcome: "won", gameDate: "2026-06-01", current });
    expect(result.currentDailyStreak).toBe(1);
    expect(result.bestDailyStreak).toBe(1);
    expect(result.lastPlayedDate).toBe("2026-06-01");
  });

  it("increments across consecutive ET days", () => {
    const current = baseState({ currentDailyStreak: 4, bestDailyStreak: 4, lastPlayedDate: "2026-06-01" });
    const result = applyRoundOutcomeToStreaks({ outcome: "failed", gameDate: "2026-06-02", current });
    expect(result.currentDailyStreak).toBe(5);
    expect(result.bestDailyStreak).toBe(5);
  });

  it("a same-day second round leaves the daily streak unchanged", () => {
    const current = baseState({ currentDailyStreak: 4, bestDailyStreak: 4, lastPlayedDate: "2026-06-02" });
    const result = applyRoundOutcomeToStreaks({ outcome: "won", gameDate: "2026-06-02", current });
    expect(result.currentDailyStreak).toBe(4);
    expect(result.bestDailyStreak).toBe(4);
    expect(result.lastPlayedDate).toBe("2026-06-02");
  });

  it("a same-day second round does not double-increment even after the first already advanced it", () => {
    // Round 1 of the day advances the streak; round 2 the same day must not advance it again.
    const afterFirstRound = applyRoundOutcomeToStreaks({
      outcome: "won",
      gameDate: "2026-06-02",
      current: baseState({ currentDailyStreak: 4, bestDailyStreak: 4, lastPlayedDate: "2026-06-01" }),
    });
    expect(afterFirstRound.currentDailyStreak).toBe(5);

    const afterSecondRound = applyRoundOutcomeToStreaks({
      outcome: "skipped",
      gameDate: "2026-06-02",
      current: afterFirstRound,
    });
    expect(afterSecondRound.currentDailyStreak).toBe(5);
    expect(afterSecondRound.bestDailyStreak).toBe(5);
  });

  it("a gap resets the daily streak to 1", () => {
    const current = baseState({ currentDailyStreak: 7, bestDailyStreak: 7, lastPlayedDate: "2026-06-01" });
    const result = applyRoundOutcomeToStreaks({ outcome: "won", gameDate: "2026-06-05", current });
    expect(result.currentDailyStreak).toBe(1);
    expect(result.bestDailyStreak).toBe(7);
    expect(result.lastPlayedDate).toBe("2026-06-05");
  });

  it("best daily streak never decreases across a reset", () => {
    const current = baseState({ currentDailyStreak: 10, bestDailyStreak: 10, lastPlayedDate: "2026-06-01" });
    const result = applyRoundOutcomeToStreaks({ outcome: "won", gameDate: "2026-08-01", current });
    expect(result.currentDailyStreak).toBe(1);
    expect(result.bestDailyStreak).toBe(10);
  });

  it("best signal streak never decreases across a reset", () => {
    const current = baseState({ currentSignalStreak: 9, bestSignalStreak: 9, lastPlayedDate: "2026-06-01" });
    const result = applyRoundOutcomeToStreaks({ outcome: "failed", gameDate: "2026-06-02", current });
    expect(result.currentSignalStreak).toBe(0);
    expect(result.bestSignalStreak).toBe(9);
  });
});

describe("currentEasternGameDate: DST boundaries", () => {
  it("maps 2026-03-08T06:30:00Z (1:30 AM EST, spring-forward night) to 2026-03-08", () => {
    expect(currentEasternGameDate(new Date("2026-03-08T06:30:00Z"))).toBe("2026-03-08");
  });

  it("maps 2026-11-01T05:30:00Z (1:30 AM EDT, just before fall-back) to 2026-11-01", () => {
    expect(currentEasternGameDate(new Date("2026-11-01T05:30:00Z"))).toBe("2026-11-01");
  });

  it("EST midnight boundary: 04:59Z stays the prior day, 05:01Z rolls to the new day", () => {
    // America/New_York is EST (UTC-5) in mid-January; local midnight is 05:00Z.
    expect(currentEasternGameDate(new Date("2026-01-15T04:59:00Z"))).toBe("2026-01-14");
    expect(currentEasternGameDate(new Date("2026-01-15T05:01:00Z"))).toBe("2026-01-15");
  });

  it("EDT midnight boundary: 03:59Z stays the prior day, 04:01Z rolls to the new day", () => {
    // America/New_York is EDT (UTC-4) in mid-July; local midnight is 04:00Z.
    expect(currentEasternGameDate(new Date("2026-07-15T03:59:00Z"))).toBe("2026-07-14");
    expect(currentEasternGameDate(new Date("2026-07-15T04:01:00Z"))).toBe("2026-07-15");
  });
});

describe("isConsecutiveDay", () => {
  it("true for adjacent calendar days in a normal month", () => {
    expect(isConsecutiveDay("2026-06-01", "2026-06-02")).toBe(true);
  });

  it("false for the same day", () => {
    expect(isConsecutiveDay("2026-06-02", "2026-06-02")).toBe(false);
  });

  it("false for a gap of more than one day", () => {
    expect(isConsecutiveDay("2026-06-01", "2026-06-03")).toBe(false);
  });

  it("false when next is before prev", () => {
    expect(isConsecutiveDay("2026-06-02", "2026-06-01")).toBe(false);
  });

  it("holds across the spring-forward date pair 2026-03-08 to 2026-03-09", () => {
    expect(isConsecutiveDay("2026-03-08", "2026-03-09")).toBe(true);
  });

  it("holds across the fall-back date pair 2026-10-31 to 2026-11-01", () => {
    expect(isConsecutiveDay("2026-10-31", "2026-11-01")).toBe(true);
  });

  it("holds across a Feb 28 to Mar 1 non-leap-year rollover", () => {
    // 2026 is not a leap year, so February has 28 days.
    expect(isConsecutiveDay("2026-02-28", "2026-03-01")).toBe(true);
  });

  it("holds across a month with 31 days rolling into the next month", () => {
    expect(isConsecutiveDay("2026-07-31", "2026-08-01")).toBe(true);
  });

  it("holds across a year boundary", () => {
    expect(isConsecutiveDay("2026-12-31", "2027-01-01")).toBe(true);
  });
});
