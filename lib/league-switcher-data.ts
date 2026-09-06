import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSleeperLeagues } from "@/lib/sleeper";
import type { Database } from "@/lib/database.types";
import type { SwitcherLeague } from "@/components/league-switcher";
import type { SleeperViewer } from "@/lib/sleeper-handle/types";

/**
 * Load the OTHER leagues the viewer belongs to for a given season, so the deep
 * view's league switcher can hop between them. The current league is filtered
 * out.
 *
 * Resolving the user, in two ways, both of which end at the same gate:
 *
 * - When the viewer carries a `sleeperUserId` (a saved handle, resolved on
 *   Sleeper at save time) that id IS the answer, and no `/user` lookup is
 *   needed. It is still checked against this league's synced membership, for
 *   the reason below.
 * - Otherwise we match the viewer's handle against this league's synced
 *   `league_users.display_name`, because that is exactly what the entry point
 *   forwards via `?username=` (league-results.tsx uses `user.display_name`).
 *   Reading the synced row sidesteps the username-versus-display-name
 *   ambiguity a direct Sleeper /user lookup would hit.
 *
 * MEMBERSHIP IS A PRECONDITION, and not only because the panel is called "your
 * other leagues". The display-name path gated the Sleeper call for free: a
 * handle that is not in this league matched no row, so nothing was fetched.
 * The cached id has no such gate, so without this check every league page view
 * by any signed-in reader with a saved handle would fire an unmetered live
 * Sleeper request, member or not, on ten routes. One indexed query keeps that
 * shut. `rosters.owner_user_id` is checked as well as `league_users`, because a
 * co-owner is a member the members table can miss.
 *
 * Sleeper is hit live for the user's league list. Empty on any failure, so the
 * switcher simply does not render.
 */
/**
 * One Sleeper league-list fetch per (user, season) per request.
 *
 * The deep view renders a shell around a page, and more than one thing in that
 * tree can ask for the switcher. Without the memo each ask is a live Sleeper
 * request drawing on the shared budget in lib/sleeper-budget.ts.
 */
const leaguesForUser = cache(
  async (userId: string, season: string) => getSleeperLeagues(userId, season),
);

/** Is this Sleeper user in this league, as an owner or a co-owner? */
async function isLeagueMember(
  supabase: SupabaseClient<Database>,
  leagueRowId: string,
  sleeperUserId: string,
): Promise<boolean> {
  const { count } = await supabase
    .from("league_users")
    .select("sleeper_user_id", { count: "exact", head: true })
    .eq("league_id", leagueRowId)
    .eq("sleeper_user_id", sleeperUserId);
  if ((count ?? 0) > 0) return true;

  const { data: owned } = await supabase
    .from("rosters")
    .select("id")
    .eq("league_id", leagueRowId)
    .eq("owner_user_id", sleeperUserId)
    .limit(1);
  if ((owned?.length ?? 0) > 0) return true;

  const { data: co } = await supabase
    .from("rosters")
    .select("id")
    .eq("league_id", leagueRowId)
    .contains("co_owners", [sleeperUserId])
    .limit(1);
  return (co?.length ?? 0) > 0;
}

export async function loadUserOtherLeagues(
  supabase: SupabaseClient<Database>,
  currentLeagueRowId: string,
  currentSleeperLeagueId: string,
  viewer: SleeperViewer,
  season: string,
): Promise<SwitcherLeague[]> {
  let userId = viewer.sleeperUserId;

  if (userId) {
    if (!(await isLeagueMember(supabase, currentLeagueRowId, userId))) return [];
  } else {
    const { data: members } = await supabase
      .from("league_users")
      .select("sleeper_user_id")
      .eq("league_id", currentLeagueRowId)
      .eq("display_name", viewer.username)
      .limit(1);
    userId = members?.[0]?.sleeper_user_id ?? null;
  }

  if (!userId) return [];

  const leagues = await leaguesForUser(userId, season);
  return leagues
    .filter((l) => l.league_id !== currentSleeperLeagueId)
    .map((l) => ({
      sleeperLeagueId: l.league_id,
      name: l.name,
      status: l.status ?? null,
      totalRosters: l.total_rosters ?? null,
      season: l.season,
      // Straight off the live Sleeper payload, which is where every other
      // league logo on the site comes from too. No column, and none to add.
      avatar: l.avatar ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
