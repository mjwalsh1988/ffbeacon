import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { SwitcherLeague } from "@/components/league-switcher";
import { loadUserOtherLeagues } from "@/lib/league-switcher-data";
import { currentNflSeason } from "@/lib/sleeper";

/**
 * Load the data the shared `LeagueHeaderActions` cluster needs on every deep-view
 * surface: the searched user's OTHER leagues (for the in-view switcher).
 *
 * `searchedUsername` is the handle forwarded via `?username=`. When it's null we
 * skip the Sleeper call entirely and the switcher won't render.
 *
 * The Refresh button is public (no per-viewer gate), so this no longer computes a
 * commissioner/admin flag. See app/api/leagues/[league_id]/refresh/route.ts and the
 * FFB-SEC-004 reclassification.
 */
export async function loadLeagueHeaderActions(
  supabase: SupabaseClient<Database>,
  leagueRowId: string,
  sleeperLeagueId: string,
  searchedUsername: string | null,
  season: string | null,
): Promise<{ otherLeagues: SwitcherLeague[] }> {
  const otherLeagues = searchedUsername
    ? await loadUserOtherLeagues(
        supabase,
        leagueRowId,
        sleeperLeagueId,
        searchedUsername,
        season ?? currentNflSeason(),
      )
    : ([] as SwitcherLeague[]);
  return { otherLeagues };
}
