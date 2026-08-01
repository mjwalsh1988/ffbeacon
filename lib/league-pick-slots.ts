import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/**
 * Look up draft slot labels for a league.
 *
 * Returns:
 *   labelFor(season, originalRosterId) → "1.04" | null
 *   slotFor(season, originalRosterId)  → 4     | null
 *
 * Sleeper publishes `slot_to_roster_id` on the /draft/{draft_id} payload as
 * `{slot → roster_id}`. We invert it once per (season) so the caller can ask
 * "what slot does this team's pick fall on" in O(1).
 *
 * When the season's draft is not yet scheduled / completed, the mapping is
 * empty and we return null, the UI should fall back to a `2026 R1` label.
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
  const { data: rows } = await (supabase as SupabaseClient<Database>)
    .from("league_drafts")
    .select("season, slot_to_roster_id")
    .eq("league_id", leagueRowId);

  const rosterToSlotBySeason = new Map<number, Map<number, number>>();
  for (const row of rows ?? []) {
    const season = Number(row.season);
    if (!Number.isFinite(season)) continue;
    const raw = row.slot_to_roster_id;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const m = new Map<number, number>();
    for (const [slotStr, rosterIdRaw] of Object.entries(
      raw as Record<string, unknown>,
    )) {
      const slot = parseInt(slotStr, 10);
      const rid = Number(rosterIdRaw);
      if (!Number.isFinite(slot) || !Number.isFinite(rid)) continue;
      m.set(rid, slot);
    }
    if (m.size > 0) rosterToSlotBySeason.set(season, m);
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
