/**
 * Settlement (plan 10), the I/O half. The arithmetic is settle-math.ts.
 *
 * For one puzzle whose game date has ended:
 *  1. Every Hurry-Up still active is set abandoned (guarded on active), and
 *     its pending prompts are recorded as timed out (recordTimeout, closing).
 *  2. Lone Signal is planned over every completed and abandoned Hurry-Up.
 *  3. Each attempt gets ONE guarded update (settled_at is null). Only when it
 *     returns a row are the answer rows marked and the stats moved, so a
 *     rerun finishes the remainder and pays nobody twice.
 *  4. The puzzle is stamped only once every attempt carries settled_at.
 *  5. The streak reset zeroes everyone whose last day is before the date.
 *
 * Stops before the next attempt when the deadline passes; the next run
 * picks up where this one stopped.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { loadAnswers, recordTimeout, type AttemptRow } from "./attempt";
import { planSettlement, type SettleAnswer } from "./settle-math";
import type { LongShotSettings } from "./types";

type Client = SupabaseClient<Database>;

const ATTEMPT_COLUMNS =
  "id, user_id, puzzle_id, game_date, mode, status, current_position, base_points, bonus_points, total_points, timer_seconds, started_at, completed_at, stats_recorded_at, settled_at";

export interface SettleSummary {
  gameDate: string;
  abandoned: number;
  settledNow: number;
  bonusesPaid: number;
  room: number;
  stamped: boolean;
  partial: boolean;
  streaksReset: number;
}

export async function settlePuzzle(
  admin: Client,
  puzzle: { id: string; game_date: string; prompt_count: number },
  settings: LongShotSettings,
  deadline: number,
): Promise<SettleSummary> {
  const summary: SettleSummary = {
    gameDate: puzzle.game_date,
    abandoned: 0,
    settledNow: 0,
    bonusesPaid: 0,
    room: 0,
    stamped: false,
    partial: false,
    streaksReset: 0,
  };

  // 1. Close every Hurry-Up still running for the date.
  const active = (await fetchAllRows("long shot active attempts", (from, to) =>
    admin
      .from("long_shot_attempts")
      .select(ATTEMPT_COLUMNS)
      .eq("puzzle_id", puzzle.id)
      .eq("mode", "hurry_up")
      .eq("status", "active")
      .order("id", { ascending: true })
      .range(from, to),
  )) as unknown as AttemptRow[];
  for (const a of active) {
    const { data: closed, error } = await admin
      .from("long_shot_attempts")
      .update({ status: "abandoned" })
      .eq("id", a.id)
      .eq("status", "active")
      .select(ATTEMPT_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(`abandon failed: ${error.message}`);
    if (!closed) continue;
    summary.abandoned++;
    const row = closed as AttemptRow;
    for (const ans of (await loadAnswers(admin, row.id)).filter((x) => x.state === "pending")) {
      await recordTimeout(admin, row, ans, puzzle.prompt_count, { closing: true });
    }
  }

  // 2. Plan Lone Signal over every completed and abandoned Hurry-Up.
  const attempts = (await fetchAllRows("long shot settle attempts", (from, to) =>
    admin
      .from("long_shot_attempts")
      .select(ATTEMPT_COLUMNS)
      .eq("puzzle_id", puzzle.id)
      .eq("mode", "hurry_up")
      .in("status", ["completed", "abandoned"])
      .order("id", { ascending: true })
      .range(from, to),
  )) as unknown as AttemptRow[];
  const answersByAttempt = new Map<string, SettleAnswer[]>();
  for (let i = 0; i < attempts.length; i += 150) {
    const ids = attempts.slice(i, i + 150).map((a) => a.id);
    const rows = await fetchAllRows<SettleAnswer & { attempt_id: string }>("long shot settle answers", (from, to) =>
      admin
        .from("long_shot_answers")
        .select("id, attempt_id, prompt_id, player_id, correct")
        .in("attempt_id", ids)
        .order("id", { ascending: true })
        .range(from, to),
    );
    for (const r of rows) {
      const list = answersByAttempt.get(r.attempt_id) ?? [];
      list.push({ id: r.id, prompt_id: r.prompt_id, player_id: r.player_id, correct: r.correct });
      answersByAttempt.set(r.attempt_id, list);
    }
  }
  const { data: prompts, error: pErr } = await admin
    .from("long_shot_prompts")
    .select("id, answered_total")
    .eq("puzzle_id", puzzle.id);
  if (pErr) throw new Error(`settle prompts read failed: ${pErr.message}`);
  const answeredTotal = new Map((prompts ?? []).map((p) => [p.id, p.answered_total]));
  const tallies = new Map<string, Map<string, number>>();
  for (const p of prompts ?? []) {
    const rows = await fetchAllRows<{ player_id: string; count: number }>("long shot settle tallies", (from, to) =>
      admin
        .from("long_shot_answer_tallies")
        .select("player_id, count")
        .eq("prompt_id", p.id)
        .order("player_id", { ascending: true })
        .range(from, to),
    );
    tallies.set(p.id, new Map(rows.map((r) => [r.player_id, r.count])));
  }
  const plan = planSettlement(
    attempts.map((a) => ({ id: a.id, user_id: a.user_id, status: a.status, answers: answersByAttempt.get(a.id) ?? [] })),
    tallies,
    answeredTotal,
    settings,
  );
  summary.room = attempts.filter((a) => a.status === "completed").length;

  // 3. One guarded update per attempt; secondary writes only when it lands.
  const byId = new Map(attempts.map((a) => [a.id, a]));
  for (const s of plan) {
    const a = byId.get(s.attemptId)!;
    if (a.settled_at) continue;
    if (Date.now() > deadline) {
      summary.partial = true;
      return summary;
    }
    // One transaction: the settled_at guard, the Lone Signal marks and the
    // stats bonus (migration 0369). A rerun finds settled_at set and pays nothing.
    const { data: landed, error } = await admin.rpc("long_shot_settle_attempt", {
      p_attempt_id: a.id,
      p_bonus: s.bonusPoints,
      p_lone_ids: s.loneAnswerIds,
      p_pay_stats: a.status === "completed",
    });
    if (error) throw new Error(`settle failed: ${error.message}`);
    if (!landed) continue;
    summary.settledNow++;
    if (s.loneAnswerIds.length === 0 || a.status !== "completed") continue;
    summary.bonusesPaid++;
  }

  // 4. Stamp only when nothing is left unsettled.
  const { count: left, error: leftErr } = await admin
    .from("long_shot_attempts")
    .select("id", { count: "exact", head: true })
    .eq("puzzle_id", puzzle.id)
    .eq("mode", "hurry_up")
    .in("status", ["completed", "abandoned"])
    .is("settled_at", null);
  if (leftErr) throw new Error(`settle remainder count failed: ${leftErr.message}`);
  if ((left ?? 0) > 0) {
    summary.partial = true;
    return summary;
  }
  const { error: stampErr } = await admin
    .from("long_shot_puzzles")
    .update({ settled_at: new Date().toISOString() })
    .eq("id", puzzle.id);
  if (stampErr) throw new Error(`puzzle stamp failed: ${stampErr.message}`);
  summary.stamped = true;

  // 5. Everyone who did not complete this date has broken their streak.
  const { data: reset, error: resetErr } = await admin
    .from("long_shot_user_stats")
    .update({ current_streak: 0 })
    .gt("current_streak", 0)
    .lt("last_completed_date", puzzle.game_date)
    .select("user_id");
  if (resetErr) throw new Error(`streak reset failed: ${resetErr.message}`);
  summary.streaksReset = reset?.length ?? 0;
  return summary;
}
