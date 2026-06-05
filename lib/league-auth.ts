import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { parseSleeperLeagueSettings } from "@/lib/sleeper-league-settings";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export type LeagueAdminContext = {
  /** auth.users.id, when logged in. */
  userId: string | null;
  /** True when user_preferences.is_admin is set for the current user. */
  isAdmin: boolean;
  /** True when the current user's Sleeper username appears as is_owner=true
   * (Sleeper's commissioner bit) on this league's league_users. Note: we
   * match by sleeper username persisted under
   * user_preferences.sleeper_league_settings.username because
   * user_preferences doesn't yet store sleeper_user_id. */
  isCommissionerForLeague: boolean;
  /** Convenience: admin OR commissioner. Components use this to gate
   * privileged UI. The server-side API endpoint must independently
   * re-validate before honoring the request. */
  canForceRefresh: boolean;
};

/**
 * Compute the league-admin / commissioner context for the current request.
 *
 * Notes:
 * - This is read-side gating. The corresponding API endpoint MUST do its
 *   own check before executing — never trust the client.
 * - Commissioner detection matches sleeper username (display_name on
 *   league_users) against user_preferences.sleeper_league_settings.username.
 *   This handles the typical case where the logged-in FF Beacon user has
 *   linked their Sleeper username via /my-beacon/sleeper-leagues.
 */
export async function getLeagueAdminContext(
  supabase: AnySupabase,
  leagueRowId: string,
): Promise<LeagueAdminContext> {
  const {
    data: { user },
  } = await (supabase as SupabaseClient<Database>).auth.getUser();
  if (!user) {
    return {
      userId: null,
      isAdmin: false,
      isCommissionerForLeague: false,
      canForceRefresh: false,
    };
  }

  const { data: prefs } = await (supabase as SupabaseClient<Database>)
    .from("user_preferences")
    .select("is_admin, sleeper_league_settings")
    .eq("user_id", user.id)
    .maybeSingle();
  const isAdmin = Boolean(prefs?.is_admin);
  const sleeperUsername =
    parseSleeperLeagueSettings(prefs?.sleeper_league_settings).username ?? null;

  let isCommissionerForLeague = false;
  if (sleeperUsername) {
    const { data: commish } = await (supabase as SupabaseClient<Database>)
      .from("league_users")
      .select("sleeper_user_id, is_commissioner")
      .eq("league_id", leagueRowId)
      .eq("display_name", sleeperUsername)
      .eq("is_commissioner", true)
      .maybeSingle();
    isCommissionerForLeague = Boolean(commish);
  }

  return {
    userId: user.id,
    isAdmin,
    isCommissionerForLeague,
    canForceRefresh: isAdmin || isCommissionerForLeague,
  };
}
