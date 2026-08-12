/**
 * Which end of the round a traded draft pick lands in: early, mid, or late.
 *
 * Sleeper tells us a traded pick's year, round and owner, never its position in
 * the round, because for a future season that position does not exist yet. It is
 * decided by where the pick's ORIGINAL team finishes. Signal Check priced those
 * picks as a blend of early/mid/late, which is honest but blunt, and blunt
 * enough to decide a verdict on its own: a 2027 1st in dynasty superflex TEP ran
 * 6,013 early against 4,182 late on 2026-08-12, and on one real trade that
 * spread moved the answer from "one side by 23.5%" to "Fair Trade".
 *
 * Two sources, best first:
 *
 *   1. THE REAL DRAFT ORDER. If the league already has a draft for that season,
 *      Sleeper publishes slot_to_roster_id and we know the exact slot. Read via
 *      lib/league-pick-slots.ts, which the transaction feed already uses to
 *      label picks "1.04". Not an estimate, so it is not labelled as one.
 *   2. PROJECTED STANDINGS. Otherwise, rank the teams by projected regular
 *      season finish (Power Pulse) and split them into thirds:
 *
 *        top third     -> LATE picks   (good teams draft last)
 *        middle third  -> MID picks
 *        bottom third  -> EARLY picks  (bad teams draft first)
 *
 * Both splits are proportional, so they scale with league size instead of
 * assuming twelve teams: 12 teams split 4/4/4, 10 teams split 3/3/4.
 *
 * Note the two mappings run in OPPOSITE directions and that is not a bug.
 * Finishing 1st earns the LAST pick; holding draft slot 1 IS the first pick.
 *
 * WHERE THIS APPLIES
 * Only where the league is known and the pick descriptor came from Sleeper: the
 * league transactions feed, the player-profile trades tab, and the Sleeper
 * import on /tools/signal-check. The manual builder and On The Clock both send
 * a slot the user chose, and an estimate must never overrule a real choice.
 *
 * WHAT IT REFUSES TO DO
 * A pick for season S is ordered by season S-1's finish, so a 2027 pick needs
 * 2026 projections. Anything further out (a 2028 pick today) has no standings to
 * read and stays on the blend. Same when Power Pulse has not run for the league,
 * when the originating roster is unknown, or when the projection is degenerate
 * (a missing win total, or every team projected identically). Ranking a flat
 * projection would dress a coin flip up as a finish.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { PickPosition } from "@/lib/signal-check/types";
import { compareProjectedFinish } from "@/lib/power-pulse/projected-order";
import { loadLeagueDraftSlots } from "@/lib/league-pick-slots";

type Client = SupabaseClient<Database>;

export interface PickPositionEstimate {
  position: PickPosition;
  /**
   * False when this came from a published draft order (we know), true when it
   * came from projected standings (we inferred). Drives both the wording next
   * to the pick and the confidence penalty.
   */
  estimated: boolean;
}

export interface PickPositionResolver {
  /**
   * Position for a pick ORIGINATING from `originalRosterId` (a Sleeper roster
   * id) in `pickSeason`. Null whenever we cannot say, which leaves the caller on
   * the blend. The originating roster is the one that matters and is frequently
   * neither side of the trade: a pick can change hands more than once.
   */
  resolve(originalRosterId: number, pickSeason: number): PickPositionEstimate | null;
  /** True when at least one season of usable ordering was loaded. */
  ready: boolean;
}

/** The resolver that never resolves. Used when there is no league context. */
export const NO_PICK_POSITIONS: PickPositionResolver = {
  resolve: () => null,
  ready: false,
};

/**
 * Thirds of the league, from a PROJECTED FINISH. 1st is the best team, so 1st
 * sends late picks.
 *
 * floor(N/3) and floor(2N/3) as the cut points, which puts any remainder in the
 * EARLY bucket. That is the right place for it: the bottom of the standings is
 * where the valuable picks come from, and a team on the boundary sits closer to
 * the bucket below than the one above. 12 -> 4/4/4, 10 -> 3/3/4.
 */
export function positionFromProjectedFinish(
  finish: number,
  teamCount: number,
): PickPosition | null {
  if (!Number.isInteger(finish) || !Number.isInteger(teamCount)) return null;
  // Under three teams there are no thirds to speak of.
  if (teamCount < 3 || finish < 1 || finish > teamCount) return null;
  if (finish <= Math.floor(teamCount / 3)) return "late";
  if (finish <= Math.floor((teamCount * 2) / 3)) return "mid";
  return "early";
}

/**
 * Thirds of the league, from a REAL DRAFT SLOT. Slot 1 picks first, so slot 1 is
 * an early pick. The mirror image of the projected-finish mapping above, and it
 * has to stay the mirror image: the same team should land in the same bucket
 * whichever source answered.
 */
export function positionFromDraftSlot(slot: number, teamCount: number): PickPosition | null {
  if (!Number.isInteger(slot) || !Number.isInteger(teamCount)) return null;
  if (teamCount < 3 || slot < 1 || slot > teamCount) return null;
  // Defined by reversal rather than by its own cut points. Written out
  // separately, the remainder lands at the wrong end: in an 8-team league the
  // finish split is 2 late / 3 mid / 3 early, so the slots must be 3 early /
  // 3 mid / 2 late, and independent floor() cuts give 2 early / 3 mid / 3 late.
  // A team would then sit in a different bucket depending on which source
  // answered. A test pins the two together.
  return positionFromProjectedFinish(teamCount - slot + 1, teamCount);
}

type PulseRow = {
  roster_id: string;
  season: number;
  projected_wins: number | null;
  expected_points_per_week: number | null;
};

/**
 * Rank one season's teams and hand each a position.
 *
 * Returns an empty map when the projection cannot support a ranking: a missing
 * projected_wins anywhere, or no spread at all across the league. Either would
 * produce an order that looks authoritative and is arbitrary.
 */
function positionsForSeason(
  rows: PulseRow[],
  sleeperIdByRosterUuid: Map<string, number>,
): Map<number, PickPosition> {
  const out = new Map<number, PickPosition>();
  if (rows.length < 3) return out;
  if (rows.some((r) => typeof r.projected_wins !== "number" || !Number.isFinite(r.projected_wins))) {
    return out;
  }
  if (new Set(rows.map((r) => r.projected_wins)).size < 2) return out;

  const ordered = [...rows].sort((a, b) =>
    compareProjectedFinish(
      { projectedWins: a.projected_wins, expectedPointsPerWeek: a.expected_points_per_week },
      { projectedWins: b.projected_wins, expectedPointsPerWeek: b.expected_points_per_week },
    ),
  );

  ordered.forEach((row, index) => {
    const position = positionFromProjectedFinish(index + 1, ordered.length);
    const sleeperRosterId = sleeperIdByRosterUuid.get(row.roster_id);
    if (position && sleeperRosterId != null) out.set(sleeperRosterId, position);
  });
  return out;
}

/**
 * Build the resolver for one league. A roster read, a Power Pulse read, and the
 * draft-slot index; all are a handful of rows per league, so no paging here.
 *
 * Never throws. A league with no Power Pulse row is the normal case for a league
 * nobody has opened yet, and it must degrade to the blend rather than fail the
 * grade of every trade on the page.
 */
export async function buildPickPositionResolver(
  admin: Client,
  leagueRowId: string,
): Promise<PickPositionResolver> {
  try {
    const [{ data: rosters }, { data: pulse }, draftSlots] = await Promise.all([
      admin.from("rosters").select("id, sleeper_roster_id").eq("league_id", leagueRowId),
      admin
        .from("league_power_pulse_cache")
        .select("roster_id, season, projected_wins, expected_points_per_week")
        .eq("league_id", leagueRowId),
      loadLeagueDraftSlots(admin, leagueRowId),
    ]);

    const sleeperIdByRosterUuid = new Map((rosters ?? []).map((r) => [r.id, r.sleeper_roster_id]));

    const bySeason = new Map<number, PulseRow[]>();
    for (const row of pulse ?? []) {
      const list = bySeason.get(row.season);
      if (list) list.push(row);
      else bySeason.set(row.season, [row]);
    }

    // Keyed by the season whose standings set the order, NOT by the pick season.
    const projected = new Map<number, Map<number, PickPosition>>();
    for (const [season, rows] of bySeason) {
      const positions = positionsForSeason(rows, sleeperIdByRosterUuid);
      if (positions.size > 0) projected.set(season, positions);
    }

    const ready = projected.size > 0 || draftSlots.rosterToSlotBySeason.size > 0;
    if (!ready) return NO_PICK_POSITIONS;

    return {
      ready,
      resolve(originalRosterId: number, pickSeason: number): PickPositionEstimate | null {
        if (!Number.isInteger(pickSeason) || !Number.isInteger(originalRosterId)) return null;

        // 1. A published draft order for that season is not a guess.
        const slot = draftSlots.slotFor(pickSeason, originalRosterId);
        const teamCount = draftSlots.rosterToSlotBySeason.get(pickSeason)?.size ?? 0;
        if (slot != null) {
          const position = positionFromDraftSlot(slot, teamCount);
          if (position) return { position, estimated: false };
        }

        // 2. Otherwise project it: a 2027 pick is ordered by the 2026 finish.
        const position = projected.get(pickSeason - 1)?.get(originalRosterId);
        return position ? { position, estimated: true } : null;
      },
    };
  } catch (err) {
    console.error("[pick-position] resolver build failed", leagueRowId, err);
    return NO_PICK_POSITIONS;
  }
}
