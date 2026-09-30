import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  mergeSleeperLeagueSettings,
  parseSleeperLeagueSettings,
  type SleeperLeagueSettings,
} from "@/lib/sleeper-league-settings";

/**
 * The one writer of `user_preferences.sleeper_league_settings`.
 *
 * Migration 0323 takes the column's INSERT and UPDATE grants away from `anon`
 * and `authenticated`. Before it, an account owner could PATCH this jsonb
 * straight through PostgREST and put any Sleeper user id in it, which walked
 * past the Sleeper verification `saveSleeperHandle` does and made every check
 * built on the saved id (the Signal Check import's league ownership test among
 * them) agree with whatever the owner asserted. Now the browser can read the
 * column and nothing else, and every write comes through here, from a server
 * action that has already established WHO the user is from their own session.
 *
 * The caller passes `userId` from `supabase.auth.getUser()` on the reader's
 * session, never from a request. The service role is used only because the
 * grant is gone; the row it writes is still that one user's.
 *
 * Read-merge-write so the sibling keys survive, and the merged value goes back
 * through the parser before it is stored, so a malformed id or avatar is
 * dropped here rather than stored and dropped at every read.
 */
export async function writeSleeperLeagueSettings(
  userId: string,
  patch: SleeperLeagueSettings,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof userId !== "string" || userId.length === 0) {
    return { ok: false, error: "No user." };
  }
  try {
    const admin = createAdminClient();
    const { data: existing, error: readError } = await admin
      .from("user_preferences")
      .select("sleeper_league_settings")
      .eq("user_id", userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);

    const merged = parseSleeperLeagueSettings(
      mergeSleeperLeagueSettings(
        parseSleeperLeagueSettings(existing?.sleeper_league_settings),
        patch,
      ),
    );

    const { error } = await admin.from("user_preferences").upsert(
      {
        user_id: userId,
        sleeper_league_settings: merged,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (err) {
    console.error("[sleeper-league-settings] write failed", err);
    return { ok: false, error: "Could not save that just now." };
  }
}
