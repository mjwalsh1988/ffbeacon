/**
 * The signed-in page state (plan 5.1a and 17.1). One loader shared by the
 * page's server render and GET /state, so the two can never disagree.
 *
 * Never generates a puzzle. Heals any completed Hurry-Up whose stats write
 * never landed (plan 12) before it reads the stats.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { addDays } from "@/lib/game-date";
import { buildAttemptDto, buildCompletedDto, findActiveAttempt, type AttemptRow } from "./attempt";
import { dailyRank, loadExclusionSet } from "./rank";
import { recordCompletion } from "./stats";
import { displayedStreak } from "./streaks";
import { loadPlayerInfo } from "./tallies";
import {
  MISS_LETTER,
  TIER_LETTERS,
  type AnswerState,
  type DayRecordDto,
  type LongShotSettings,
  type PageStateDto,
  type StatsDto,
  type Tier,
  type YesterdayDto,
} from "./types";

type Client = SupabaseClient<Database>;

const ATTEMPT_COLUMNS =
  "id, user_id, puzzle_id, game_date, mode, status, current_position, base_points, bonus_points, total_points, timer_seconds, started_at, completed_at, stats_recorded_at, settled_at";

/** Pure: the letter row for one day. A letter per answered prompt, a dash per unanswered one. */
export function dayLetters(
  promptCount: number,
  answers: ReadonlyArray<{ position: number; state: AnswerState; tier: Tier | null }>,
): string[] {
  const out: string[] = [];
  for (let pos = 1; pos <= promptCount; pos++) {
    const a = answers.find((x) => x.position === pos);
    if (!a || a.state === "pending") out.push("-");
    else out.push(a.tier ? TIER_LETTERS[a.tier] : MISS_LETTER);
  }
  return out;
}

async function healStats(admin: Client, userId: string): Promise<void> {
  const { data, error } = await admin
    .from("long_shot_attempts")
    .select("id")
    .eq("user_id", userId)
    .eq("mode", "hurry_up")
    .eq("status", "completed")
    .is("stats_recorded_at", null)
    .order("game_date", { ascending: true })
    .limit(10);
  if (error) throw new Error(`stats heal read failed: ${error.message}`);
  for (const row of data ?? []) {
    if (row.id) await recordCompletion(admin, userId, row.id);
  }
}

async function loadLastSeven(admin: Client, userId: string, today: string): Promise<DayRecordDto[]> {
  const from = addDays(today, -6);
  const { data, error } = await admin
    .from("long_shot_attempts")
    .select("game_date, status, long_shot_puzzles!inner(prompt_count), long_shot_answers(position, state, tier)")
    .eq("user_id", userId)
    .eq("mode", "hurry_up")
    .gte("game_date", from)
    .lte("game_date", today);
  if (error) throw new Error(`last seven read failed: ${error.message}`);
  type Row = {
    game_date: string;
    status: string;
    long_shot_puzzles: { prompt_count: number } | { prompt_count: number }[];
    long_shot_answers: { position: number; state: AnswerState; tier: Tier | null }[];
  };
  const byDate = new Map((data as unknown as Row[]).map((r) => [r.game_date, r]));
  const out: DayRecordDto[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = addDays(today, -i);
    const r = byDate.get(date);
    if (!r || (r.status !== "completed" && r.status !== "abandoned")) {
      out.push({ gameDate: date, status: "none", letters: [] });
      continue;
    }
    const puzzle = Array.isArray(r.long_shot_puzzles) ? r.long_shot_puzzles[0] : r.long_shot_puzzles;
    out.push({
      gameDate: date,
      status: r.status as "completed" | "abandoned",
      letters: dayLetters(puzzle?.prompt_count ?? 5, r.long_shot_answers ?? []),
    });
  }
  return out;
}

async function loadStats(admin: Client, userId: string, today: string): Promise<StatsDto | null> {
  const { data, error } = await admin
    .from("long_shot_user_stats")
    .select(
      "days_played, total_points, best_day_points, long_shots, lone_signals, last_completed_date, current_streak, best_streak",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`stats read failed: ${error.message}`);
  const lastSeven = await loadLastSeven(admin, userId, today);
  if (!data) {
    return lastSeven.some((d) => d.status !== "none")
      ? {
          daysPlayed: 0,
          currentStreak: 0,
          bestStreak: 0,
          totalPoints: 0,
          bestDayPoints: 0,
          longShots: 0,
          loneSignals: 0,
          lastSeven,
        }
      : null;
  }
  return {
    daysPlayed: data.days_played,
    currentStreak: displayedStreak(data, today),
    bestStreak: data.best_streak,
    totalPoints: data.total_points,
    bestDayPoints: data.best_day_points,
    longShots: data.long_shots,
    loneSignals: data.lone_signals,
    lastSeven,
  };
}

async function loadYesterday(
  admin: Client,
  userId: string,
  today: string,
  excluded: readonly string[],
): Promise<YesterdayDto | null> {
  const date = addDays(today, -1);
  const { data, error } = await admin
    .from("long_shot_attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("user_id", userId)
    .eq("game_date", date)
    .eq("mode", "hurry_up")
    .eq("status", "completed")
    .maybeSingle();
  if (error) throw new Error(`yesterday read failed: ${error.message}`);
  if (!data) return null;
  const attempt = data as AttemptRow;
  const settled = attempt.settled_at !== null;
  let loneSignalPrompts: YesterdayDto["loneSignalPrompts"] = [];
  if (settled && attempt.bonus_points > 0) {
    const { data: lone, error: loneErr } = await admin
      .from("long_shot_answers")
      .select("player_id, long_shot_prompts!inner(prompt_text)")
      .eq("attempt_id", attempt.id)
      .eq("lone_signal", true)
      .order("position", { ascending: true });
    if (loneErr) throw new Error(`lone signal read failed: ${loneErr.message}`);
    type LoneRow = { player_id: string | null; long_shot_prompts: { prompt_text: string } | { prompt_text: string }[] };
    const rows = (lone ?? []) as unknown as LoneRow[];
    const names = await loadPlayerInfo(
      admin,
      rows.map((r) => r.player_id).filter((x): x is string => Boolean(x)),
    );
    loneSignalPrompts = rows.map((r) => {
      const p = Array.isArray(r.long_shot_prompts) ? r.long_shot_prompts[0] : r.long_shot_prompts;
      return { promptText: p?.prompt_text ?? "", playerName: (r.player_id && names.get(r.player_id)?.name) || "" };
    });
  }
  const rank = attempt.completed_at
    ? await dailyRank(admin, date, attempt.total_points, attempt.completed_at, excluded)
    : null;
  return {
    gameDate: date,
    settled,
    basePoints: attempt.base_points,
    bonusPoints: attempt.bonus_points,
    totalPoints: attempt.total_points,
    loneSignalPrompts,
    rank,
  };
}

export async function loadPageState(
  admin: Client,
  userId: string,
  today: string,
  settings: LongShotSettings,
): Promise<PageStateDto> {
  await healStats(admin, userId);

  const [activeRow, hurryRes, puzzleRes, excluded] = await Promise.all([
    findActiveAttempt(admin, userId),
    admin
      .from("long_shot_attempts")
      .select(ATTEMPT_COLUMNS)
      .eq("user_id", userId)
      .eq("game_date", today)
      .eq("mode", "hurry_up")
      .maybeSingle(),
    admin.from("long_shot_puzzles").select("status, prompt_count").eq("game_date", today).maybeSingle(),
    loadExclusionSet(admin, settings),
  ]);
  if (hurryRes.error) throw new Error(`today hurry-up read failed: ${hurryRes.error.message}`);
  if (puzzleRes.error) throw new Error(`today puzzle read failed: ${puzzleRes.error.message}`);
  const hurryRow = (hurryRes.data as AttemptRow | null) ?? null;

  const [active, hurryUpToday, stats, yesterday, todayCompleted] = await Promise.all([
    activeRow ? buildAttemptDto(admin, activeRow) : Promise.resolve(null),
    hurryRow ? buildAttemptDto(admin, hurryRow) : Promise.resolve(null),
    loadStats(admin, userId, today),
    loadYesterday(admin, userId, today, excluded),
    hurryRow && hurryRow.status === "completed"
      ? buildCompletedDto(admin, hurryRow, settings, today)
      : Promise.resolve(null),
  ]);

  return {
    gameDate: today,
    puzzle: puzzleRes.data
      ? { status: puzzleRes.data.status as "ready" | "short", promptCount: puzzleRes.data.prompt_count }
      : null,
    active,
    hurryUpToday,
    stats,
    yesterday,
    todayCompleted,
  };
}
