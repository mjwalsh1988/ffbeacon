import { describe, expect, it } from "vitest";
import { DEFAULT_LONG_SHOT_SETTINGS } from "./default-settings";
import { loneSignals, planSettlement, streakResetUsers, type SettleAnswer } from "./settle-math";

const settings = DEFAULT_LONG_SHOT_SETTINGS;
const tallies = new Map([
  [
    "p1",
    new Map([
      ["rare", 4],
      ["edge", 5],
      ["common", 60],
    ]),
  ],
]);
const totals = new Map([["p1", 100]]);
const ans = (id: string, player: string, correct = true): SettleAnswer => ({
  id,
  prompt_id: "p1",
  player_id: player,
  correct,
});

describe("loneSignals", () => {
  it("pays nothing under min_room", () => {
    expect(loneSignals([ans("a1", "rare")], tallies, totals, settings, 19)).toEqual([]);
  });

  it("qualifies under lone_share and not at the boundary", () => {
    expect(loneSignals([ans("a1", "rare"), ans("a2", "edge")], tallies, totals, settings, 20)).toEqual(["a1"]);
  });

  it("never pays a wrong answer", () => {
    expect(loneSignals([ans("a1", "rare", false)], tallies, totals, settings, 20)).toEqual([]);
  });
});

describe("planSettlement", () => {
  const completed = (id: string, answers: SettleAnswer[]) => ({ id, user_id: `u-${id}`, status: "completed", answers });
  const room = Array.from({ length: 19 }, (_, i) => completed(`c${i}`, [ans(`x${i}`, "common")]));

  it("settles every attempt at 0 under min_room", () => {
    const plan = planSettlement([completed("me", [ans("a1", "rare")]), ...room.slice(0, 5)], tallies, totals, settings);
    expect(plan.every((p) => p.bonusPoints === 0)).toBe(true);
    expect(plan).toHaveLength(6);
  });

  it("sums the bonus per attempt", () => {
    const tallies2 = new Map([
      ["p1", new Map([["rare", 1]])],
      ["p2", new Map([["rare2", 1]])],
    ]);
    const totals2 = new Map([
      ["p1", 100],
      ["p2", 100],
    ]);
    const me = completed("me", [ans("a1", "rare"), { id: "a2", prompt_id: "p2", player_id: "rare2", correct: true }]);
    const plan = planSettlement([me, ...room], tallies2, totals2, settings);
    expect(plan[0]).toMatchObject({ bonusPoints: 30, loneAnswerIds: ["a1", "a2"] });
  });

  it("gives an abandoned attempt no bonus and does not count it in the room", () => {
    const abandoned = { id: "ab", user_id: "u-ab", status: "abandoned", answers: [ans("a9", "rare")] };
    const plan = planSettlement([abandoned, ...room], tallies, totals, settings);
    expect(plan[0].bonusPoints).toBe(0);
    expect(plan.every((p) => p.bonusPoints === 0)).toBe(true);
  });
});

describe("streakResetUsers", () => {
  it("zeroes only users whose last date is before the target", () => {
    expect(
      streakResetUsers(
        [
          { user_id: "missed", current_streak: 3, last_completed_date: "2026-11-06" },
          { user_id: "played", current_streak: 3, last_completed_date: "2026-11-07" },
          { user_id: "zero", current_streak: 0, last_completed_date: "2026-11-01" },
        ],
        "2026-11-07",
      ),
    ).toEqual(["missed"]);
  });
});
