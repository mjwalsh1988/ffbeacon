import type { SupabaseClient } from "@supabase/supabase-js";
import { getSleeperLeagues } from "@/lib/sleeper";
import type { Database } from "@/lib/database.types";
import type { SwitcherLeague } from "@/components/league-switcher";

/**
 * Load the OTHER leagues the originally-searched Sleeper user belongs to for a
 * given season, so the deep view's league switcher can hop between them. The
 * current league is filtered out.
 *
 * Resolving the user: we match `searchedUsername` against this league's synced
 * `league_users.display_name`, because that's exactly what the entry point
 * forwards via ?username= (lib/.../league-results uses `user.display_name`).
 * Reading the synced row sidesteps the username-vs-display_name ambiguity a
 * direct Sleeper /user lookup would hit. The searched user is always a member
 * of this league (they clicked in from their own list), so the row exists.
 *
 * Sleeper is hit live for the user's league list. Null/empty on any failure —
 * the switcher simply doesn't render when this returns [].
 */
export async function loadUserOtherLeagues(
  supabase: SupabaseClient<Database>,
  currentLeagueRowId: string,
  currentSleeperLeagueId: string,
  searchedUsername: string,
  season: string,
): Promise<SwitcherLeague[]> {
  const { data: members } = await supabase
    .from("league_users")
    .select("sleeper_user_id")
    .eq("league_id", currentLeagueRowId)
    .eq("display_name", searchedUsername)
    .limit(1);

  const userId = members?.[0]?.sleeper_user_id;
  if (!userId) return [];

  const leagues = await getSleeperLeagues(userId, season);
  return leagues
    .filter((l) => l.league_id !== currentSleeperLeagueId)
    .map((l) => ({
      sleeperLeagueId: l.league_id,
      name: l.name,
      status: l.status ?? null,
      totalRosters: l.total_rosters ?? null,
      season: l.season,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
