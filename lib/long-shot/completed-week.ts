/**
 * The most recent COMPLETED regular-season week of a season (plan 7.2).
 *
 * A week counts as complete when its player_stats row count is at least 60
 * percent of the week before it, or, for week 1, at least 1,500 rows. A week
 * under that share is in progress (one Thursday game has landed) and the week
 * before it is used. Used by game_line, opponent_line and waiver_wire.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Client = SupabaseClient<Database>;

export const COMPLETE_SHARE = 0.6;
export const WEEK_ONE_MIN_ROWS = 1500;

export interface CompletedWeekResult {
  week: number | null;
  latestWeek: number | null;
  latestCount: number;
  priorCount: number;
}

/** Pure: decide from the latest week and the two row counts. */
export function pickCompletedWeek(
  latestWeek: number | null,
  latestCount: number,
  priorCount: number,
): number | null {
  if (latestWeek === null || latestWeek < 1) return null;
  if (latestWeek === 1) return latestCount >= WEEK_ONE_MIN_ROWS ? 1 : null;
  if (latestCount >= COMPLETE_SHARE * priorCount) return latestWeek;
  return latestWeek - 1;
}

async function countWeek(admin: Client, season: number, week: number): Promise<number> {
  const { count, error } = await admin
    .from("player_stats")
    .select("id", { count: "exact", head: true })
    .eq("season", season)
    .eq("season_type", "regular")
    .eq("week", week);
  if (error) throw new Error(`completed-week count failed: ${error.message}`);
  return count ?? 0;
}

export async function findCompletedWeek(admin: Client, season: number): Promise<CompletedWeekResult> {
  const { data, error } = await admin
    .from("player_stats")
    .select("week")
    .eq("season", season)
    .eq("season_type", "regular")
    .order("week", { ascending: false })
    .limit(1);
  if (error) throw new Error(`completed-week latest failed: ${error.message}`);
  const latestWeek = data?.[0]?.week ?? null;
  if (latestWeek === null) return { week: null, latestWeek: null, latestCount: 0, priorCount: 0 };
  const [latestCount, priorCount] = await Promise.all([
    countWeek(admin, season, latestWeek),
    latestWeek > 1 ? countWeek(admin, season, latestWeek - 1) : Promise.resolve(0),
  ]);
  return { week: pickCompletedWeek(latestWeek, latestCount, priorCount), latestWeek, latestCount, priorCount };
}
