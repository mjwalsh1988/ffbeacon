import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { SwitcherLeague } from "@/components/league-switcher";
import { loadUserOtherLeagues } from "@/lib/league-switcher-data";
import { currentNflSeason } from "@/lib/sleeper";
import type { SleeperViewer } from "@/lib/sleeper-handle/types";

/**
 * Load the data the shared `LeagueHeaderActions` cluster needs on every deep-view
 * surface: the viewer's OTHER leagues (for the in-view switcher).
 *
 * `viewer` is whoever the page is acting for: the handle from `?username=` when
 * there is one, otherwise the reader's saved handle
 * (`lib/sleeper-handle/resolve.ts`). When it is null there is nobody to list
 * leagues for, so the Sleeper call is skipped and the switcher does not render.
 *
 * The Refresh button is public (no per-viewer gate), so this no longer computes a
 * commissioner/admin flag. See app/api/leagues/[league_id]/refresh/route.ts and the
 * FFB-SEC-004 reclassification.
 */
export async function loadLeagueHeaderActions(
  supabase: SupabaseClient<Database>,
  leagueRowId: string,
  sleeperLeagueId: string,
  viewer: SleeperViewer | null,
  season: string | null,
): Promise<{ otherLeagues: SwitcherLeague[] }> {
  const otherLeagues = viewer
    ? await loadUserOtherLeagues(
        supabase,
        leagueRowId,
        sleeperLeagueId,
        viewer,
        season ?? currentNflSeason(),
      )
    : ([] as SwitcherLeague[]);
  return { otherLeagues };
}
