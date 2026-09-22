/**
 * Building the weekly game log, in one place.
 *
 * WHY THIS IS SHARED. The log renders on two tabs now: the Statistics tab,
 * where it sits under the accuracy charts with a season picker, and the
 * Overview tab, where it is the current season alone under the depth chart.
 * Those are different surfaces with different framing and the SAME rows, and
 * two copies of "which weeks exist and what is in them" would drift the first
 * time one of them was touched.
 *
 * WHAT IT DECIDES. Three kinds of week, and the distinction is the point:
 *
 *   PLAYED    a stat line exists. Real numbers.
 *   BYE       the team has no game that week. Rendered as a real, dimmed row
 *             saying BYE WEEK, not omitted. An absent row reads as missing
 *             data, and a reader cannot tell it from a week we failed to sync.
 *   UPCOMING  a game with no stat line yet. Opponent plus dashes, and a marker
 *             when it is being played today.
 *
 * A BYE IS ONLY CLAIMED WHEN THE SLATE CAN SUPPORT IT. `byeWeeksFor` answers
 * from weeks the odds feed actually holds, so a week the feed has not reached
 * yields no bye rather than a confident wrong one. A week that is neither
 * played, nor a known bye, nor projected simply does not appear, which is the
 * honest outcome for "we do not know what happens that week".
 *
 * Pure. Every caller passes the data it already loaded.
 */

import {
  activePointsFromStatRow,
  pointsFromProjectedSet,
  type ProjectedPointsSet,
  type ScoringKey,
  type WeeklyStatRow,
} from "@/lib/player-profile";
import { byeWeeksFor, kickoffKey, type SeasonSchedule } from "@/lib/season-schedule";
import type {
  PendingWeekRow,
  WeeklyGameRow,
} from "@/components/player-profile/stat-shaping";

/** One projected week, as the weekly projections loader returns it. */
export type ProjectionWeek = {
  week: number;
  opponent: string | null;
  team: string | null;
};

/** Turn a stored stat row into the shape the table renders. */
export function toGameRow(
  r: WeeklyStatRow,
  projMap: Map<string, ProjectedPointsSet>,
  scoringKey: ScoringKey,
  tePremiumBonus: number,
): WeeklyGameRow {
  const projected = projMap.get(`${r.season}-${r.week}`);
  return {
    season: r.season,
    week: r.week,
    opponent: r.opponent,
    snap_pct: r.snap_pct,
    gp: r.gp,
    pass_cmp: r.pass_cmp ?? 0,
    pass_att: r.pass_att ?? 0,
    pass_yd: r.pass_yd ?? 0,
    pass_td: r.pass_td ?? 0,
    pass_int: r.pass_int ?? 0,
    rush_att: r.rush_att ?? 0,
    rush_yd: r.rush_yd ?? 0,
    rush_td: r.rush_td ?? 0,
    rec: r.rec ?? 0,
    rec_tgt: r.rec_tgt ?? 0,
    rec_yd: r.rec_yd ?? 0,
    rec_td: r.rec_td ?? 0,
    pts_ppr: r.pts_ppr ?? 0,
    pts_active: activePointsFromStatRow(r, r.rec, scoringKey, tePremiumBonus),
    proj_active: pointsFromProjectedSet(projected, scoringKey, tePremiumBonus),
    proj_line: projected?.line ?? null,
  };
}

/**
 * Every week of one season that is not already a played row.
 *
 * Byes first, then projected games, then sorted, so the caller renders one
 * ordered list and the table is the season top to bottom.
 */
export function buildPendingWeeks(params: {
  /** Weeks that already have a stat line, so they are not duplicated. */
  playedWeeks: Set<number>;
  /** The projected slate, which covers every week the team plays. */
  projectionWeeks: readonly ProjectionWeek[];
  schedule: SeasonSchedule;
  /** The player's team, for the bye lookup. */
  team: string | null;
}): PendingWeekRow[] {
  const { playedWeeks, projectionWeeks, schedule, team } = params;

  const rows: PendingWeekRow[] = [];
  const seen = new Set<number>();

  for (const week of byeWeeksFor(schedule, team)) {
    // A bye the player somehow has a stat line for is not a bye. Trust the
    // stat line: it is a record of something that happened, and the schedule
    // read is an inference from another feed's coverage.
    if (playedWeeks.has(week)) continue;
    seen.add(week);
    rows.push({ week, opponent: null, team, kickoffAt: null, isBye: true });
  }

  for (const r of projectionWeeks) {
    if (playedWeeks.has(r.week) || seen.has(r.week)) continue;
    seen.add(r.week);
    rows.push({
      week: r.week,
      opponent: r.opponent,
      team: r.team,
      kickoffAt: schedule.kickoffs[kickoffKey(r.week, r.team) ?? ""] ?? null,
      isBye: false,
    });
  }

  return rows.sort((a, b) => a.week - b.week);
}
