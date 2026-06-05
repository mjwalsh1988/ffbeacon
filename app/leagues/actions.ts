"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { pulseLeague } from "@/lib/league-pulse";

/**
 * Ensure a Sleeper league is pulsed into our DB, then navigate to its
 * deep view at /leagues/[sleeper_league_id]. Triggered from the "Open
 * league" button on the League Pulse results and dashboard.
 *
 * If a Sleeper username was attached to the form, we forward it as
 * `?username=` so the deep view can default the team-visibility filter
 * to the owner's roster (DPC parity).
 *
 * Uses the service-role client because the leagues/rosters/etc. tables
 * are public-read but service-role-write (RLS).
 */
export async function ensureLeagueAndOpen(formData: FormData): Promise<void> {
  const raw = formData.get("sleeper_league_id");
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("sleeper_league_id required");
  }
  const sleeperLeagueId = raw.trim();

  const rawUsername = formData.get("sleeper_username");
  const sleeperUsername =
    typeof rawUsername === "string" && rawUsername.trim().length > 0
      ? rawUsername.trim()
      : null;

  const supabase = createAdminClient();
  const result = await pulseLeague(supabase, sleeperLeagueId);
  if (!result.ok) {
    // Surface to user via search param on the referrer.
    redirect(`/tools/league-pulse?pulse_error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath(`/leagues/${sleeperLeagueId}`);
  const dest = sleeperUsername
    ? `/leagues/${sleeperLeagueId}?tab=teams&username=${encodeURIComponent(sleeperUsername)}`
    : `/leagues/${sleeperLeagueId}`;
  redirect(dest);
}
