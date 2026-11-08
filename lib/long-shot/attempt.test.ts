import { beforeEach, describe, expect, it } from "vitest";
import { loadAnswers, loadAttempt, serveNext, startAttempt, submitAnswer, type AttemptRow } from "./attempt";
import { DEFAULT_LONG_SHOT_SETTINGS } from "./default-settings";
import { makeFakeClient, type FakeDb } from "./test-fake-client";

const settings = DEFAULT_LONG_SHOT_SETTINGS;
const TODAY = "2026-11-08";
const USER = "user-1";
const claim = async () => true;

function seed(promptCount: number): FakeDb {
  const prompts = Array.from({ length: promptCount }, (_, i) => ({
    id: `prompt-${i + 1}`,
    puzzle_id: "puzzle-1",
    position: i + 1,
    prompt_text: `Secret prompt ${i + 1}`,
    answers: [
      { player_id: "rare", tier: "long_shot", rate: 0 },
      { player_id: "common", tier: "chalk", rate: 0.9 },
    ],
    answered_total: 0,
  }));
  return {
    rpcCalls: [],
    tables: {
      long_shot_puzzles: [
        { id: "puzzle-1", game_date: TODAY, status: promptCount < 5 ? "short" : "ready", prompt_count: promptCount, completed_attempts: 0 },
      ],
      long_shot_prompts: prompts,
      long_shot_attempts: [],
      long_shot_answers: [],
      long_shot_answer_tallies: [],
      long_shot_user_stats: [],
      user_preferences: [],
      players: [
        { id: "rare", full_name: "Rare Player", slug: "rare-player", team: "KC", external_ids: { sleeper: "1" } },
        { id: "common", full_name: "Common Player", slug: "common-player", team: null, external_ids: null },
      ],
      nfl_teams: [],
    },
  };
}

let db: FakeDb;
let admin: never;

beforeEach(() => {
  db = seed(5);
  admin = makeFakeClient(db);
});

async function attemptRow(): Promise<AttemptRow> {
  const id = db.tables.long_shot_attempts[0].id as string;
  return loadAttempt(admin, id, USER);
}

describe("attempt engine", () => {
  it("start serves position 1 and creates its pending row", async () => {
    const res = await startAttempt(admin, USER, "hurry_up", settings, TODAY);
    expect(res.kind).toBe("prompt");
    if (res.kind !== "prompt") return;
    expect(res.position).toBe(1);
    expect(res.promptText).toBe("Secret prompt 1");
    expect(res.remainingMs).toBeGreaterThan(29_000);
    expect(db.tables.long_shot_answers).toHaveLength(1);
    expect(db.tables.long_shot_answers[0]).toMatchObject({ position: 1, state: "pending" });
  });

  it("the answer response carries no next prompt text and creates no next row", async () => {
    await startAttempt(admin, USER, "hurry_up", settings, TODAY);
    const result = await submitAnswer(
      admin,
      await attemptRow(),
      { position: 1, playerId: "rare", timedOut: false, skipped: false },
      settings,
      TODAY,
      claim,
    );
    expect(result).toMatchObject({ correct: true, tier: "long_shot", points: 100, basePoints: 100 });
    expect(JSON.stringify(result)).not.toContain("Secret prompt 2");
    expect(result.next).toEqual({ kind: "next", position: 2, promptCount: 5 });
    expect(db.tables.long_shot_answers).toHaveLength(1);
    // The tally moved for a Hurry-Up answer.
    expect(db.rpcCalls.some((c) => c.fn === "long_shot_increment_tally")).toBe(true);
  });

  it("/next creates the pending row for the next position", async () => {
    await startAttempt(admin, USER, "hurry_up", settings, TODAY);
    await submitAnswer(admin, await attemptRow(), { position: 1, playerId: "common", timedOut: false, skipped: false }, settings, TODAY, claim);
    const next = await serveNext(admin, await attemptRow(), settings, TODAY);
    expect(next.kind).toBe("prompt");
    if (next.kind === "prompt") expect(next.promptText).toBe("Secret prompt 2");
    expect(db.tables.long_shot_answers.filter((a) => a.state === "pending")).toHaveLength(1);
  });

  it("serving the same pending prompt twice keeps served_at", async () => {
    await startAttempt(admin, USER, "hurry_up", settings, TODAY);
    const before = db.tables.long_shot_answers[0].served_at;
    await serveNext(admin, await attemptRow(), settings, TODAY, new Date(Date.now() + 5_000));
    expect(db.tables.long_shot_answers).toHaveLength(1);
    expect(db.tables.long_shot_answers[0].served_at).toBe(before);
  });

  it("the repair path advances a behind attempt and recomputes base_points", async () => {
    await startAttempt(admin, USER, "hurry_up", settings, TODAY);
    // Simulate a crash after the answer row was settled but before the attempt advanced.
    Object.assign(db.tables.long_shot_answers[0], { state: "answered", player_id: "rare", correct: true, tier: "long_shot", points: 100 });
    const next = await serveNext(admin, await attemptRow(), settings, TODAY);
    expect(next.kind).toBe("prompt");
    if (next.kind === "prompt") expect(next.position).toBe(2);
    const a = await attemptRow();
    expect(a.current_position).toBe(2);
    expect(a.base_points).toBe(100);
  });

  it("an answer past the deadline is recorded timed out whatever the body carried", async () => {
    await startAttempt(admin, USER, "hurry_up", settings, TODAY);
    const late = new Date(Date.now() + 33_000);
    const result = await submitAnswer(admin, await attemptRow(), { position: 1, playerId: "rare", timedOut: false, skipped: false }, settings, TODAY, claim, late);
    expect(result).toMatchObject({ state: "timed_out", points: 0, correct: false });
    expect((await loadAnswers(admin, (await attemptRow()).id))[0].player_id).toBeNull();
  });

  it("a stale position answers stale_prompt", async () => {
    await startAttempt(admin, USER, "hurry_up", settings, TODAY);
    await expect(
      submitAnswer(admin, await attemptRow(), { position: 2, playerId: "rare", timedOut: false, skipped: false }, settings, TODAY, claim),
    ).rejects.toMatchObject({ code: "stale_prompt" });
  });

  it("skip is refused in Hurry-Up", async () => {
    await startAttempt(admin, USER, "hurry_up", settings, TODAY);
    await expect(
      submitAnswer(admin, await attemptRow(), { position: 1, playerId: null, timedOut: false, skipped: true }, settings, TODAY, claim),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("completion fires at prompt_count on a short puzzle and records stats", async () => {
    db = seed(3);
    admin = makeFakeClient(db);
    await startAttempt(admin, USER, "hurry_up", settings, TODAY);
    let last;
    for (let pos = 1; pos <= 3; pos++) {
      if (pos > 1) await serveNext(admin, await attemptRow(), settings, TODAY);
      last = await submitAnswer(admin, await attemptRow(), { position: pos, playerId: "rare", timedOut: false, skipped: false }, settings, TODAY, claim);
    }
    expect(last!.next.kind).toBe("completed");
    const a = await attemptRow();
    expect(a.status).toBe("completed");
    expect(a.total_points).toBe(300);
    expect(db.tables.long_shot_user_stats[0]).toMatchObject({ days_played: 1, total_points: 300, long_shots: 3, current_streak: 1 });
  });

  it("refuses a second start while one is active", async () => {
    await startAttempt(admin, USER, "hurry_up", settings, TODAY);
    await expect(startAttempt(admin, USER, "film_room", settings, TODAY)).rejects.toMatchObject({ code: "attempt_active" });
  });

  it("Film Room writes no tally and no stats", async () => {
    // Today's Hurry-Up is over, so Film Room plays today's puzzle.
    db.tables.long_shot_attempts.push({
      id: "hu-done", user_id: USER, puzzle_id: "puzzle-1", game_date: TODAY, mode: "hurry_up", status: "completed",
      current_position: 6, base_points: 0, bonus_points: 0, total_points: 0, timer_seconds: 30,
      started_at: new Date().toISOString(), completed_at: new Date().toISOString(), stats_recorded_at: new Date().toISOString(), settled_at: null,
    });
    const res = await startAttempt(admin, USER, "film_room", settings, TODAY);
    expect(res.kind).toBe("prompt");
    if (res.kind !== "prompt") return;
    expect(res.remainingMs).toBeNull();
    const fr = await loadAttempt(admin, res.attemptId, USER);
    await submitAnswer(admin, fr, { position: 1, playerId: "rare", timedOut: false, skipped: false }, settings, TODAY, claim);
    expect(db.rpcCalls.filter((c) => c.fn === "long_shot_increment_tally")).toHaveLength(0);
    expect(db.tables.long_shot_user_stats).toHaveLength(0);
  });
});
