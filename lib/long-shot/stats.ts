/**
 * Recording a completed Hurry-Up into long_shot_user_stats (plan 12).
 *
 * The reads come first; the stats_recorded_at anchor and the stats upsert
 * then land together in the long_shot_record_completion RPC (migration 0369).
 * A failure anywhere leaves the anchor null, so the page-state heal retries
 * it, and the anchor's guard means it can only ever be recorded once. The RPC
 * is also guarded on mode = 'hurry_up', so a Film Room attempt can never
 * reach the stats table (lib/long-shot/film-room-guard.test.ts checks the
 * callers too).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { applyCompletion } from "./streaks";

type Client = SupabaseClient<Database>;

export async function recordCompletion(admin: Client, userId: string, attemptId: string): Promise<boolean> {
  const { data: attempt, error } = await admin
    .from("long_shot_attempts")
    .select("game_date, base_points, completed_at, mode, status, stats_recorded_at")
    .eq("id", attemptId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`stats attempt read failed: ${error.message}`);
  if (!attempt || attempt.status !== "completed" || attempt.stats_recorded_at) return false;
  if (attempt.mode !== "hurry_up") return false;

  const [{ count: longShots, error: lsErr }, { data: prev, error: prevErr }] = await Promise.all([
    admin
      .from("long_shot_answers")
      .select("id", { count: "exact", head: true })
      .eq("attempt_id", attemptId)
      .eq("tier", "long_shot"),
    admin
      .from("long_shot_user_stats")
      .select(
        "days_played, total_points, best_day_points, long_shots, last_completed_date, current_streak, best_streak, first_completed_at",
      )
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (lsErr) throw new Error(`long shot count failed: ${lsErr.message}`);
  if (prevErr) throw new Error(`stats read failed: ${prevErr.message}`);

  // Said again where the streak is computed, which is where film-room-guard.test.ts looks.
  if (!(attempt.mode === "hurry_up")) return false;
  const streak = applyCompletion(
    {
      last_completed_date: prev?.last_completed_date ?? null,
      current_streak: prev?.current_streak ?? 0,
      best_streak: prev?.best_streak ?? 0,
    },
    attempt.game_date,
  );
  // A late heal for an older day must not move the streak date backwards.
  const later = Boolean(prev?.last_completed_date && prev.last_completed_date > attempt.game_date);
  const { data: recorded, error: rpcErr } = await admin.rpc("long_shot_record_completion", {
    p_attempt_id: attemptId,
    p_user_id: userId,
    p_days_played: (prev?.days_played ?? 0) + 1,
    p_total_points: (prev?.total_points ?? 0) + attempt.base_points,
    p_best_day_points: Math.max(prev?.best_day_points ?? 0, attempt.base_points),
    p_long_shots: (prev?.long_shots ?? 0) + (longShots ?? 0),
    p_last_completed_date: later ? prev!.last_completed_date! : streak.last_completed_date!,
    p_current_streak: later ? prev!.current_streak : streak.current_streak,
    p_best_streak: Math.max(prev?.best_streak ?? 0, streak.best_streak),
    p_first_completed_at: prev?.first_completed_at ?? attempt.completed_at ?? new Date().toISOString(),
  });
  if (rpcErr) throw new Error(`stats record failed: ${rpcErr.message}`);
  return Boolean(recorded);
}
