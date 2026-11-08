import { describe, expect, it } from "vitest";
import { DEFAULT_LONG_SHOT_SETTINGS } from "./default-settings";
import { settlePuzzle } from "./settle";
import { makeFakeClient, type FakeDb } from "./test-fake-client";

const DATE = "2026-11-07";

function seed(): FakeDb {
  const attempts = [];
  const answers = [];
  const stats = [];
  for (let i = 0; i < 25; i++) {
    const id = `att-${i}`;
    attempts.push({
      id, user_id: `u${i}`, puzzle_id: "pz", game_date: DATE, mode: "hurry_up", status: "completed",
      current_position: 2, base_points: i === 0 ? 100 : 10, bonus_points: 0, total_points: i === 0 ? 100 : 10,
      timer_seconds: 30, started_at: "2026-11-07T12:00:00Z", completed_at: "2026-11-07T12:01:00Z",
      stats_recorded_at: "2026-11-07T12:01:00Z", settled_at: null,
    });
    answers.push({
      id: `ans-${i}`, attempt_id: id, prompt_id: "pr", position: 1, state: "answered",
      player_id: i === 0 ? "rare" : "common", correct: true, tier: i === 0 ? "long_shot" : "chalk", points: i === 0 ? 100 : 10, lone_signal: false,
    });
    stats.push({ user_id: `u${i}`, total_points: i === 0 ? 100 : 10, lone_signals: 0, current_streak: 1, last_completed_date: DATE });
  }
  // One player still mid-attempt when the day ended.
  attempts.push({
    id: "att-open", user_id: "u-open", puzzle_id: "pz", game_date: DATE, mode: "hurry_up", status: "active",
    current_position: 1, base_points: 0, bonus_points: 0, total_points: 0, timer_seconds: 30,
    started_at: "2026-11-07T23:58:00Z", completed_at: null, stats_recorded_at: null, settled_at: null,
  });
  answers.push({
    id: "ans-open", attempt_id: "att-open", prompt_id: "pr", position: 1, state: "pending",
    served_at: "2026-11-07T23:59:00Z", player_id: null, correct: null, tier: null, points: 0, lone_signal: false,
  });
  stats.push({ user_id: "u-missed", total_points: 50, lone_signals: 0, current_streak: 4, last_completed_date: "2026-11-06" });
  return {
    rpcCalls: [],
    tables: {
      long_shot_puzzles: [{ id: "pz", game_date: DATE, prompt_count: 1, settled_at: null, completed_attempts: 25 }],
      long_shot_prompts: [{ id: "pr", puzzle_id: "pz", position: 1, answered_total: 25 }],
      long_shot_attempts: attempts,
      long_shot_answers: answers,
      long_shot_answer_tallies: [
        { prompt_id: "pr", player_id: "rare", count: 1 },
        { prompt_id: "pr", player_id: "common", count: 24 },
      ],
      long_shot_user_stats: stats,
    },
  };
}

describe("settlePuzzle", () => {
  it("abandons the open attempt, pays Lone Signal once and stamps the puzzle", async () => {
    const db = seed();
    const admin = makeFakeClient(db);
    const puzzle = { id: "pz", game_date: DATE, prompt_count: 1 };
    const first = await settlePuzzle(admin, puzzle, DEFAULT_LONG_SHOT_SETTINGS, Date.now() + 60_000);
    expect(first).toMatchObject({ abandoned: 1, room: 25, stamped: true, bonusesPaid: 1 });
    const open = db.tables.long_shot_attempts.find((a) => a.id === "att-open")!;
    expect(open.status).toBe("abandoned");
    expect(db.tables.long_shot_answers.find((a) => a.id === "ans-open")!.state).toBe("timed_out");
    const winner = db.tables.long_shot_attempts.find((a) => a.id === "att-0")!;
    expect(winner).toMatchObject({ bonus_points: 15, total_points: 115 });
    expect(db.tables.long_shot_user_stats.find((s) => s.user_id === "u0")).toMatchObject({ total_points: 115, lone_signals: 1 });
    expect(db.tables.long_shot_answers.find((a) => a.id === "ans-0")!.lone_signal).toBe(true);

    // A second run over the same rows pays nothing: every guard returns no row.
    const second = await settlePuzzle(admin, puzzle, DEFAULT_LONG_SHOT_SETTINGS, Date.now() + 60_000);
    expect(second).toMatchObject({ settledNow: 0, bonusesPaid: 0 });
    expect(db.tables.long_shot_user_stats.find((s) => s.user_id === "u0")).toMatchObject({ total_points: 115, lone_signals: 1 });
  });

  it("zeroes only the streaks of users whose last day is before the settled date", async () => {
    const db = seed();
    await settlePuzzle(makeFakeClient(db), { id: "pz", game_date: DATE, prompt_count: 1 }, DEFAULT_LONG_SHOT_SETTINGS, Date.now() + 60_000);
    expect(db.tables.long_shot_user_stats.find((s) => s.user_id === "u-missed")!.current_streak).toBe(0);
    expect(db.tables.long_shot_user_stats.find((s) => s.user_id === "u1")!.current_streak).toBe(1);
  });

  it("stops before the next attempt when the deadline has passed and does not stamp", async () => {
    const db = seed();
    const res = await settlePuzzle(makeFakeClient(db), { id: "pz", game_date: DATE, prompt_count: 1 }, DEFAULT_LONG_SHOT_SETTINGS, Date.now() - 1);
    expect(res).toMatchObject({ partial: true, stamped: false });
    expect(db.tables.long_shot_puzzles[0].settled_at).toBeNull();
  });
});
