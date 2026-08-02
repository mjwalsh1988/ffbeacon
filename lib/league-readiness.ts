/**
 * Whether a league has enough of a season yet for Power Pulse to mean anything.
 *
 * Power Pulse projects a starting lineup against a schedule. Take either away
 * and every number it produces is technically valid and completely useless:
 * a league that has not drafted scores every team at zero and then ranks the
 * ties, and a league with no head-to-head slate gives every team the same 0%
 * playoff odds. Both used to render as a full table of real-looking numbers.
 *
 * Two independent things can be missing, and the season a league is in decides
 * which one bites:
 *
 *   - Empty rosters. A redraft league before its draft. Nothing to project.
 *   - No schedule. Sleeper has not paired anyone up yet. Rosters may be full,
 *     as in a dynasty league waiting on its rookie draft, but there is no
 *     opponent to beat so wins, playoff odds, and strength of schedule are all
 *     guesses about a schedule that does not exist.
 *
 * A dynasty league that has full rosters AND a published slate is NOT gated,
 * even with a rookie draft still pending. Everything Power Pulse needs is
 * there; it simply does not know about players nobody has drafted yet, which is
 * true of every projection in the sport.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/** Sleeper statuses that mean a draft has not finished. */
const DRAFT_PENDING = new Set(["pre_draft", "drafting"]);

export type LeagueReadiness = {
  /** Sleeper's league status, verbatim. */
  status: string | null;
  /** The league is at or before its draft. */
  draftPending: boolean;
  /** At least one roster holds players. */
  rostersFilled: boolean;
  /** Sleeper has published head-to-head pairings for this season. */
  hasSchedule: boolean;
  /**
   * True when Power Pulse should not show numbers at all. Every consumer gates
   * on this one field rather than re-deriving the rule.
   */
  preDraft: boolean;
};

export function isDraftPending(status: string | null | undefined): boolean {
  return DRAFT_PENDING.has((status ?? "").toLowerCase());
}

/**
 * Decide readiness from already-loaded pieces. Split out from the query so the
 * Power Pulse calculation can reuse the rule against data it holds in memory.
 */
export function resolveReadiness({
  status,
  rostersFilled,
  hasSchedule,
}: {
  status: string | null;
  rostersFilled: boolean;
  hasSchedule: boolean;
}): LeagueReadiness {
  const draftPending = isDraftPending(status);
  return {
    status,
    draftPending,
    rostersFilled,
    hasSchedule,
    preDraft: draftPending && (!rostersFilled || !hasSchedule),
  };
}

function countsAsFilled(playerIds: Json | null | undefined): boolean {
  if (!Array.isArray(playerIds)) return false;
  // Sleeper writes "0" into empty slots, so a roster of placeholders is empty.
  return playerIds.some((id) => typeof id === "string" && id.length > 0 && id !== "0");
}

/**
 * Read readiness for one league. Two small queries, both scoped to the league,
 * so this is cheap enough to run on every league page render.
 */
export async function loadLeagueReadiness(
  supabase: AnySupabase,
  leagueRowId: string,
  season: number,
  status: string | null,
): Promise<LeagueReadiness> {
  // Skip the round trips entirely when the draft is done: nothing here can
  // gate a league that is past its draft.
  if (!isDraftPending(status)) {
    return resolveReadiness({ status, rostersFilled: true, hasSchedule: true });
  }

  const [rosterRes, matchupRes] = await Promise.all([
    supabase.from("rosters").select("player_ids").eq("league_id", leagueRowId),
    supabase
      .from("league_matchups")
      .select("week")
      .eq("league_id", leagueRowId)
      .eq("season", season)
      .not("matchup_id", "is", null)
      .limit(1),
  ]);

  const rostersFilled = (rosterRes.data ?? []).some((r) => countsAsFilled(r.player_ids));
  const hasSchedule = (matchupRes.data ?? []).length > 0;

  return resolveReadiness({ status, rostersFilled, hasSchedule });
}

/**
 * Plain-language explanation of what is missing, for the empty states. Kept
 * here so the Power Pulse tab and the overview rankings say the same thing.
 */
export function describeReadinessGap(readiness: LeagueReadiness): string {
  if (!readiness.rostersFilled && !readiness.hasSchedule) {
    return "Rosters are empty and Sleeper has not paired anyone up for week 1 yet.";
  }
  if (!readiness.rostersFilled) {
    return "Nobody has been drafted yet, so there are no lineups to score.";
  }
  return "Rosters are set, but Sleeper has not published this season's matchups yet.";
}
