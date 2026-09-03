/**
 * THE single adjusted read path for every consumer of
 * player_weekly_projections.
 *
 * Before this file, seven surfaces routed through projectPlayerWeek() and
 * got the FF Beacon adjustment layer (opponent strength, reliability,
 * availability, injury); six read the raw Sleeper column and got none of
 * it. This is the fix: resolve which source a reader gets, load the rows
 * lib/power-pulse/load.ts already knows how to load, and hand them to
 * projectPlayerWeek() exactly the way Power Pulse does. No caller reads a
 * points column directly, and no caller picks a source for itself.
 *
 * See docs/projection-engine-plan.md, section "3.9 Which source a reader
 * gets" and Part 4.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { closestScoringBase, type ScoringSettings } from "@/lib/league-scoring";
import {
  loadAccuracy,
  loadDefenseSplits,
  loadProjections,
  type ProjectionRow,
} from "@/lib/power-pulse/load";
import { projectPlayerWeek, reliabilityMultiplier } from "@/lib/power-pulse/project";
import { PULSE_POSITIONS, type PulsePosition } from "@/lib/power-pulse/types";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { defenseSeasonsFor } from "./defense-seasons";
import {
  resolveProjectionSourceForWindow,
  SLEEPER_SOURCE,
  type AnySupabase,
} from "./source";

export type AdjustedProjection = {
  playerId: string;
  week: number;
  /** Adjusted points in the league's own scoring. */
  points: number;
  /** Before our multipliers. */
  rawPoints: number;
  opponent: string | null;
};

export type AdjustedProjectionSummary = {
  /** Sum over the weeks that carried a projection. */
  total: number;
  /** How many weeks carried one. NEVER the window length. */
  weeks: number;
  /** total / weeks. Null when weeks is 0. */
  perWeek: number | null;
  byWeek: Map<number, AdjustedProjection>;
};

/**
 * A player-position string outside the six Sleeper actually projects
 * (QB/RB/WR/TE/K/DEF, see lib/power-pulse/types.ts PULSE_POSITIONS) has no
 * opponent split, no accuracy row shaped for it, and no meaningful adjusted
 * projection to produce. Null here reads the same as "no rows at all" to the
 * caller: absent from byPlayer rather than a fabricated zero.
 */
function toPulsePosition(position: string | undefined | null): PulsePosition | null {
  const upper = (position ?? "").toUpperCase();
  return (PULSE_POSITIONS as readonly string[]).includes(upper)
    ? (upper as PulsePosition)
    : null;
}

/**
 * Load every adjusted projection for a set of players over one window, in
 * one league's own scoring.
 *
 * Returns the source that was actually used (SLEEPER_SOURCE or
 * BEACON_SOURCE, see ./source.ts) alongside the projections, so a caller can
 * label what it is showing without re-resolving anything itself.
 */
export async function loadAdjustedProjections(params: {
  supabase: AnySupabase;
  playerIds: string[];
  season: number;
  fromWeek: number;
  toWeek?: number;
  /** The league's literal scoring_settings, or null. */
  scoringSettings: ScoringSettings | null;
  positionByPlayer: Map<string, string>;
  /** Sleeper injury_status per player. Absent is treated as healthy. */
  injuryByPlayer?: Map<string, string | null>;
  /** The live NFL week, for the week-to-week injury discount. */
  currentWeek: number;
}): Promise<{
  source: string;
  byPlayer: Map<string, AdjustedProjectionSummary>;
}> {
  const {
    supabase,
    playerIds,
    season,
    fromWeek,
    toWeek,
    scoringSettings,
    positionByPlayer,
    injuryByPlayer,
    currentWeek,
  } = params;

  // No players to project means no data to gather. resolveProjectionSource
  // with an empty `available` always answers SLEEPER_SOURCE (see ./source.ts),
  // so that is returned directly rather than spending a settings round trip
  // and two count probes on an empty answer.
  if (playerIds.length === 0) {
    return { source: SLEEPER_SOURCE, byPlayer: new Map() };
  }

  const dbClient = supabase as SupabaseClient<Database>;

  // Both settings documents live in the same league_power_pulse_settings row
  // (see the settings block in docs/projection-engine-plan.md Part 2), and
  // loadPowerPulseSettings already merges beaconProjections as part of the
  // one document it returns, so there is nothing left for this file to load
  // or merge a second time. A missing row, an unreadable row, or a query
  // error all degrade to the code defaults inside that function: a league
  // page must never break because an admin has not saved settings yet.
  //
  // Settings load FIRST, before either availability probe fires.
  // resolveProjectionSourceForWindow makes no query at all while the feature
  // is disabled, which is the default and the current production state, so
  // every caller of this file pays nothing for the probes until an admin turns
  // it on.
  const pulseSettings = await loadPowerPulseSettings(dbClient);
  const projectionSettings = pulseSettings.beaconProjections;

  const source = await resolveProjectionSourceForWindow({
    supabase,
    season,
    fromWeek,
    toWeek,
    settings: projectionSettings,
  });

  const scoringBase = closestScoringBase(scoringSettings);
  const defenseSeasons = defenseSeasonsFor(season);

  const [projections, accuracy, defense] = await Promise.all([
    loadProjections(dbClient, playerIds, season, fromWeek, toWeek, source),
    // Scoped to the SAME source the projections themselves were resolved to,
    // per migration 0240: a multiplier measured against Sleeper's projection
    // is only meaningful applied to Sleeper's projection. See the comment on
    // loadAccuracy in lib/power-pulse/load.ts.
    loadAccuracy(dbClient, playerIds, scoringBase, source),
    loadDefenseSplits(dbClient, scoringBase, defenseSeasons),
  ]);

  // Grouped by player, then by week, before any scoring happens. A player who
  // shows up here at all HAS rows; a player who never shows up here has none,
  // which is exactly the "no rows at all" case that must come back absent
  // from byPlayer rather than as a zero.
  const byPlayerWeek = new Map<string, Map<number, ProjectionRow>>();
  for (const row of projections) {
    const weekMap = byPlayerWeek.get(row.playerId) ?? new Map<number, ProjectionRow>();
    weekMap.set(row.week, row);
    byPlayerWeek.set(row.playerId, weekMap);
  }

  const byPlayer = new Map<string, AdjustedProjectionSummary>();

  for (const [playerId, weekMap] of byPlayerWeek) {
    const position = toPulsePosition(positionByPlayer.get(playerId));
    if (!position) continue;

    const accuracyRow = accuracy.get(playerId) ?? null;
    // Computed once per player, matching lib/power-pulse/engine.ts, rather
    // than recomputed on every week of the window.
    const reliability = reliabilityMultiplier(accuracyRow, pulseSettings);
    const injuryStatus = injuryByPlayer?.get(playerId) ?? null;

    const byWeek = new Map<number, AdjustedProjection>();
    let total = 0;
    let weeks = 0;

    for (const [week, projection] of weekMap) {
      // Null is an ABSENT week: a bye, a player Sleeper does not publish, or
      // a stat line that could not be scored. It is not counted in `weeks`
      // and contributes nothing to `total`, so a bye inside the window never
      // drags the average down. A stored "out" zero is a real week and IS
      // counted; projectPlayerWeek returns it as points: 0 rather than null.
      const projected = projectPlayerWeek({
        projection,
        subject: { position, injuryStatus },
        accuracy: accuracyRow,
        reliability,
        scoringSettings,
        defense,
        defenseSeasons,
        week,
        currentWeek,
        settings: pulseSettings,
      });
      if (!projected) continue;

      byWeek.set(week, {
        playerId,
        week,
        points: projected.points,
        rawPoints: projected.rawPoints,
        opponent: projected.opponent,
      });
      total += projected.points;
      weeks += 1;
    }

    byPlayer.set(playerId, {
      total,
      weeks,
      perWeek: weeks > 0 ? total / weeks : null,
      byWeek,
    });
  }

  return { source, byPlayer };
}
