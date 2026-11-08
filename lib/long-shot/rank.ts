/**
 * Daily rank and the board exclusion set, shared by the boards, the
 * completion panel and the Yesterday panel so the three always agree.
 *
 * The exclusion set is every user hidden by moderation plus, when
 * leaderboards.hide_admin_users is on, every admin (owner decision 10).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { LongShotSettings } from "./types";

type Client = SupabaseClient<Database>;

export async function loadExclusionSet(admin: Client, settings: LongShotSettings): Promise<string[]> {
  const [hidden, admins] = await Promise.all([
    fetchAllRows<{ user_id: string }>("long shot hidden users", (from, to) =>
      admin
        .from("long_shot_user_stats")
        .select("user_id")
        .eq("hidden_from_leaderboards", true)
        .order("user_id", { ascending: true })
        .range(from, to),
    ),
    settings.leaderboards.hide_admin_users
      ? fetchAllRows<{ user_id: string }>("long shot admin users", (from, to) =>
          admin
            .from("user_preferences")
            .select("user_id")
            .eq("is_admin", true)
            .order("user_id", { ascending: true })
            .range(from, to),
        )
      : Promise.resolve([] as { user_id: string }[]),
  ]);
  return Array.from(new Set([...hidden, ...admins].map((r) => r.user_id))).sort();
}

/** A PostgREST in-list for a not.in filter. Ids are uuids, so no quoting is needed. */
export function inList(ids: readonly string[]): string {
  return `(${ids.join(",")})`;
}

/**
 * 1-based rank of a completed Hurry-Up on its date's daily board: one more
 * than the number of visible completed attempts that sort ahead of it
 * (total_points desc, completed_at asc).
 */
export async function dailyRank(
  admin: Client,
  gameDate: string,
  totalPoints: number,
  completedAt: string,
  excluded: readonly string[],
): Promise<number> {
  let q = admin
    .from("long_shot_attempts")
    .select("id", { count: "exact", head: true })
    .eq("game_date", gameDate)
    .eq("mode", "hurry_up")
    .eq("status", "completed")
    .or(`total_points.gt.${totalPoints},and(total_points.eq.${totalPoints},completed_at.lt."${completedAt}")`);
  if (excluded.length > 0) q = q.not("user_id", "in", inList(excluded));
  const { count, error } = await q;
  if (error) throw new Error(`daily rank failed: ${error.message}`);
  return (count ?? 0) + 1;
}
