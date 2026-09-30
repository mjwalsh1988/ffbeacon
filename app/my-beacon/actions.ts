"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseSleeperLeagueSettings } from "@/lib/sleeper-league-settings";
import { writeSleeperLeagueSettings } from "@/lib/sleeper-league-settings-write";

/**
 * Pin a specific Sleeper league to the user's profile, or clear the
 * pin entirely (`null`). Featured is mutually exclusive across the
 * user's leagues, calling this overwrites any prior featured pick.
 *
 * The dashboard UI uses optimistic state and revalidates this path
 * after the write so subsequent renders reflect the new pin even if
 * the tab is dragged back from elsewhere.
 */
export async function setFeaturedLeague(
  sleeperLeagueId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  // Light-touch validation, Sleeper league IDs are numeric strings.
  if (
    sleeperLeagueId !== null &&
    !/^[a-zA-Z0-9_-]{1,64}$/.test(sleeperLeagueId)
  ) {
    return { ok: false, error: "Invalid league id" };
  }

  const result = await writeSleeperLeagueSettings(user.id, {
    featured_league_id: sleeperLeagueId,
  });
  if (!result.ok) return result;

  revalidatePath("/my-beacon");
  revalidatePath("/my-beacon/sleeper-leagues");
  return { ok: true };
}

/**
 * Toggle whether a league appears on the user's public profile. Stored
 * as a deduped set under `shown_league_ids`. Independent across
 * leagues, multiple can be shown at once.
 */
export async function setLeagueShownOnProfile(
  sleeperLeagueId: string,
  shown: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(sleeperLeagueId)) {
    return { ok: false, error: "Invalid league id" };
  }

  const { data: existing } = await supabase
    .from("user_preferences")
    .select("sleeper_league_settings")
    .eq("user_id", user.id)
    .maybeSingle();

  const current = parseSleeperLeagueSettings(existing?.sleeper_league_settings);
  // Use a Set to dedupe, the UI might double-fire under a fast double
  // tap, and we don't want phantom duplicates accumulating in the array.
  const set = new Set(current.shown_league_ids ?? []);
  if (shown) set.add(sleeperLeagueId);
  else set.delete(sleeperLeagueId);

  const result = await writeSleeperLeagueSettings(user.id, {
    shown_league_ids: Array.from(set),
  });
  if (!result.ok) return result;

  revalidatePath("/my-beacon");
  revalidatePath("/my-beacon/sleeper-leagues");
  return { ok: true };
}
