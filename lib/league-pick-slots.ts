import { loadLeagueDrafts, chooseDraftPerSeason } from "@/lib/league-drafts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/**
 * Look up draft slot labels for a league.
 *
 * Returns:
 *   labelFor(season, originalRosterId, round) → "1.04" | null
 *   slotFor(season, originalRosterId)         → 4      | null
 *
 * Sleeper publishes `slot_to_roster_id` on the /draft/{draft_id} payload as
 * `{slot → roster_id}`. We invert it once per season so the caller can ask
 * "what slot does this team's pick fall on" in O(1).
 *
 * When the season's draft is not yet scheduled / completed, the mapping is
 * empty and we return null, the UI should fall back to a `2026 R1` label.
 *
 * ONE DRAFT PER SEASON IS A CHOICE, NOT A GIVEN.
 * Migration 0029 dropped the unique (league_id, season) constraint because
 * leagues really do hold more than one draft for a season, and one production
 * league carries two completed 23-round 2026 startups whose seat maps DISAGREE.
 * This used to keep whichever row the database returned last, so the slot a pick
 * was labelled with could change between two renders of the same page. Both the
 * read and the tiebreak now live in lib/league-drafts.ts and are shared with
 * lib/league-startup-picks.ts, so a pick's label and its valuation can never be
 * read off two different drafts.
 */
export type LeagueDraftSlotIndex = {
  labelFor: (season: number, originalRosterId: number, round: number) => string | null;
  slotFor: (season: number, originalRosterId: number) => number | null;
  /** Direct access to the inverted map for callers that want to iterate. */
  rosterToSlotBySeason: Map<number, Map<number, number>>;
};

export async function loadLeagueDraftSlots(
  supabase: AnySupabase,
  leagueRowId: string,
): Promise<LeagueDraftSlotIndex> {
  const drafts = await loadLeagueDrafts(supabase, leagueRowId);
  const chosen = chooseDraftPerSeason(drafts);

  const rosterToSlotBySeason = new Map<number, Map<number, number>>();
  for (const [season, draft] of chosen) {
    rosterToSlotBySeason.set(season, draft.rosterToSeat);
  }

  function slotFor(season: number, originalRosterId: number): number | null {
    return rosterToSlotBySeason.get(season)?.get(originalRosterId) ?? null;
  }

  function labelFor(
    season: number,
    originalRosterId: number,
    round: number,
  ): string | null {
    const slot = slotFor(season, originalRosterId);
    if (slot == null || !Number.isFinite(round)) return null;
    return `${round}.${String(slot).padStart(2, "0")}`;
  }

  return { labelFor, slotFor, rosterToSlotBySeason };
}
