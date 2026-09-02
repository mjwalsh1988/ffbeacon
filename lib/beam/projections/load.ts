/**
 * Projections and projection accuracy, for BEAM.
 *
 * Two different questions live here and they are routinely confused, so the
 * split is deliberate:
 *
 *   OUTLOOK    what a player is projected to score from here on
 *              (player_weekly_projections, via the FF Beacon adjustment layer)
 *   RELIABILITY how often the projection has been too low
 *              (player_projection_accuracy, pooled)
 *
 * OUTLOOK is routed through lib/projections/read.ts loadAdjustedProjections
 * rather than summed off the raw Sleeper columns, so a BEAM answer like "Bijan
 * Robinson is projected for 240 points" carries the same opponent-strength,
 * reliability, availability and injury adjustments the rest of the site
 * applies (and, once enabled, the ffbeacon source), instead of a plainer
 * number that quietly disagreed with everything else BEAM can already cite.
 *
 * RELIABILITY reads the same table the Beacon Breakdown reliability tab reads,
 * through the same scoring key, so BEAM's "beats his projection 76% of the
 * time" and the number on the player profile are the same measurement rather
 * than two plausible ones.
 *
 * POOLING, NOT AVERAGING. A beat rate over several seasons is
 * sum(weeks beaten) / sum(weeks played), never the mean of the per-season rates.
 * Averaging two seasons of 14 and 22 weeks equally would let a short season
 * carry the same weight as a full one, which is how a four-week cameo ends up
 * deciding whether a player is reliable.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ScoringKey } from "@/lib/player-profile";
import { loadAdjustedProjections } from "@/lib/projections/read";
import { canonicalScoringForFormat } from "@/lib/draft-value/default-settings";
import type { ScoringSettings } from "@/lib/league-scoring";

type Client = SupabaseClient<Database>;

/**
 * A canonical (no TE premium) ScoringSettings map for each of the three bases
 * we store denormalized columns for, built once per module load. BEAM has a
 * scoring key but no league, so there is nothing to build a real dot product
 * from; this mirrors lib/projections/engine.ts's own CANONICAL_SCORING, which
 * is private to that file and so cannot be imported directly.
 */
const CANONICAL_SCORING: Record<ScoringKey, ScoringSettings> = {
  pts_ppr: canonicalScoringForFormat({ scoringType: "ppr", tePremiumBonus: 0 }),
  pts_half_ppr: canonicalScoringForFormat({ scoringType: "half_ppr", tePremiumBonus: 0 }),
  pts_std: canonicalScoringForFormat({ scoringType: "standard", tePremiumBonus: 0 }),
};

export type ProjectionOutlook = {
  playerId: string;
  season: number;
  /** First week counted. 1 in the preseason, the live week once games start. */
  fromWeek: number;
  /** Projected points from `fromWeek` to the end of the regular season. */
  remainingPoints: number;
  /** How many weeks carried a projection at or after `fromWeek`. */
  remainingWeeks: number;
  /** Every week of the season, whether or not it has been played. */
  seasonPoints: number;
  seasonWeeks: number;
  /** The nearest projected week, for a "next up" line. */
  next: { week: number; opponent: string | null; points: number } | null;
};

/**
 * Weekly projections, adjusted, summed for one or two players.
 *
 * One call into lib/projections/read.ts loadAdjustedProjections for the whole
 * season (fromWeek 1, no toWeek), then split locally into the season total and
 * the remaining-weeks total: the same single read the raw version made, just
 * scored through the shared adjustment layer instead of read off a column.
 */
export async function loadProjectionOutlook(
  db: Client,
  playerIds: string[],
  season: number,
  fromWeek: number,
  scoringKey: ScoringKey,
): Promise<Map<string, ProjectionOutlook>> {
  const out = new Map<string, ProjectionOutlook>();
  if (playerIds.length === 0) return out;

  for (const playerId of playerIds) {
    out.set(playerId, {
      playerId,
      season,
      fromWeek,
      remainingPoints: 0,
      remainingWeeks: 0,
      seasonPoints: 0,
      seasonWeeks: 0,
      next: null,
    });
  }

  const { data: playerRows, error: playerErr } = await db
    .from("players")
    .select("id, position")
    .in("id", playerIds);
  if (playerErr) {
    console.error("[beam] player position read failed", playerErr);
    return out;
  }
  const positionByPlayer = new Map<string, string>();
  for (const row of playerRows ?? []) {
    positionByPlayer.set(row.id, (row.position ?? "").toUpperCase());
  }

  const { byPlayer } = await loadAdjustedProjections({
    supabase: db,
    playerIds,
    season,
    fromWeek: 1,
    scoringSettings: CANONICAL_SCORING[scoringKey],
    positionByPlayer,
    // BEAM asks about a player with no roster and no per-player injury
    // designation of its own, so fromWeek doubles as "the live week" for the
    // injury multiplier's week-to-week discount, matching how both callers
    // (player-projection.ts, player-compare-projection.ts) already treat it.
    currentWeek: fromWeek,
  });

  for (const [playerId, summary] of byPlayer) {
    const outlook = out.get(playerId);
    if (!outlook) continue;

    let next: ProjectionOutlook["next"] = null;
    for (const [week, projected] of summary.byWeek) {
      outlook.seasonPoints += projected.points;
      outlook.seasonWeeks += 1;

      if (week >= fromWeek) {
        outlook.remainingPoints += projected.points;
        outlook.remainingWeeks += 1;
        if (!next || week < next.week) {
          next = { week, opponent: projected.opponent, points: projected.points };
        }
      }
    }
    outlook.next = next;
  }

  return out;
}

export type Reliability = {
  playerId: string;
  /** Share of played weeks where he outscored his own projection. */
  beatRate: number | null;
  weeksBeat: number;
  weeksPlayed: number;
  weeksProjected: number;
  /** Share of projected weeks he was available for. */
  availabilityRate: number | null;
  /** Points above or below projection per played week. */
  meanDiff: number | null;
  /** Week-to-week swing. Only meaningful from a single row, so null when pooled. */
  ratioStdev: number | null;
  /** Which seasons actually contributed. Never assume the ones asked for. */
  seasons: number[];
};

/**
 * Projection accuracy for one or two players.
 *
 * `seasons` null reads the career row (season is null), which is the table's own
 * all-seasons aggregate. A list reads those seasons and pools them. The seasons
 * that came back are returned, because the ones asked for and the ones we hold
 * are different sets and the answer has to say which it used.
 */
export async function loadReliability(
  db: Client,
  playerIds: string[],
  scoringKey: ScoringKey,
  seasons: number[] | null,
): Promise<Map<string, Reliability>> {
  const out = new Map<string, Reliability>();
  if (playerIds.length === 0) return out;

  let query = db
    .from("player_projection_accuracy")
    .select(
      "player_id, season, weeks_projected, weeks_played, weeks_beat, beat_rate, availability_rate, mean_diff, ratio_stdev",
    )
    .eq("scoring", scoringKey)
    .in("player_id", playerIds);

  query = seasons === null ? query.is("season", null) : query.in("season", seasons);

  const { data, error } = await query;
  if (error) {
    console.error("[beam] projection accuracy read failed", error);
    return out;
  }

  type Row = {
    player_id: string;
    season: number | null;
    weeks_projected: number | null;
    weeks_played: number | null;
    weeks_beat: number | null;
    beat_rate: number | string | null;
    availability_rate: number | string | null;
    mean_diff: number | string | null;
    ratio_stdev: number | string | null;
  };

  const rowsByPlayer = new Map<string, Row[]>();
  for (const row of (data ?? []) as unknown as Row[]) {
    const list = rowsByPlayer.get(row.player_id) ?? [];
    list.push(row);
    rowsByPlayer.set(row.player_id, list);
  }

  for (const playerId of playerIds) {
    const rows = rowsByPlayer.get(playerId) ?? [];
    if (rows.length === 0) continue;

    let weeksBeat = 0;
    let weeksPlayed = 0;
    let weeksProjected = 0;
    let diffWeighted = 0;
    const contributing: number[] = [];

    for (const row of rows) {
      const played = numeric(row.weeks_played) ?? 0;
      weeksBeat += numeric(row.weeks_beat) ?? 0;
      weeksPlayed += played;
      weeksProjected += numeric(row.weeks_projected) ?? 0;
      const diff = numeric(row.mean_diff);
      if (diff !== null) diffWeighted += diff * played;
      if (row.season !== null) contributing.push(row.season);
    }

    out.set(playerId, {
      playerId,
      beatRate: weeksPlayed > 0 ? weeksBeat / weeksPlayed : null,
      weeksBeat,
      weeksPlayed,
      weeksProjected,
      availabilityRate: weeksProjected > 0 ? weeksPlayed / weeksProjected : null,
      meanDiff: weeksPlayed > 0 ? diffWeighted / weeksPlayed : null,
      // Standard deviation does not pool by averaging, and the honest options
      // are to recompute it from the weekly rows or not to claim it. One row in,
      // one number out; otherwise nothing.
      ratioStdev: rows.length === 1 ? numeric(rows[0].ratio_stdev) : null,
      seasons: contributing.sort((a, b) => a - b),
    });
  }

  return out;
}

function numeric(value: number | string | null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
