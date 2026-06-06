import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { SwitcherLeague } from "@/components/league-switcher";
import { loadUserOtherLeagues } from "@/lib/league-switcher-data";
import { getLeagueAdminContext } from "@/lib/league-auth";
import { currentNflSeason } from "@/lib/sleeper";

/**
 * Load the two pieces of data the shared `LeagueHeaderActions` cluster needs
 * on every deep-view surface: the searched user's OTHER leagues (for the
 * in-view switcher) and whether the current viewer can force-refresh (admin
 * or commissioner of this league).
 *
 * `searchedUsername` is the handle forwarded via `?username=`. When it's null
 * we skip the Sleeper call entirely and the switcher won't render. The admin
 * check always runs so the Refresh button can appear for privileged viewers
 * regardless of how they reached the page.
 */
export async function loadLeagueHeaderActions(
  supabase: SupabaseClient<Database>,
  leagueRowId: string,
  sleeperLeagueId: string,
  searchedUsername: string | null,
  season: string | null,
): Promise<{ otherLeagues: SwitcherLeague[]; canForceRefresh: boolean }> {
  const [otherLeagues, adminCtx] = await Promise.all([
    searchedUsername
      ? loadUserOtherLeagues(
          supabase,
          leagueRowId,
          sleeperLeagueId,
          searchedUsername,
          season ?? currentNflSeason(),
        )
      : Promise.resolve([] as SwitcherLeague[]),
    getLeagueAdminContext(supabase, leagueRowId),
  ]);
  return { otherLeagues, canForceRefresh: adminCtx.canForceRefresh };
}
