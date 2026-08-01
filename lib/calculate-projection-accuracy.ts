/**
 * Rebuild player_projection_accuracy: how reliable each player is against their
 * own projection.
 *
 * Recency is the whole point. A player's current season is the strongest signal
 * available, because roles, offenses, and coaching change between years. A
 * breakout from two seasons ago should inform the estimate, not dominate it. So
 * every graded game carries a weight:
 *
 *     weight = seasonWeight(season) * withinSeasonDecay(week)
 *
 * `seasonWeight` steps down sharply by season distance (1.0, 0.45, 0.2, 0.08 by
 * default). `withinSeasonDecay` applies only to the current season and halves a
 * game's weight every `currentSeasonHalfLifeWeeks`, so a week 1 dud stops
 * anchoring a player by week 12. Both are admin-tunable.
 *
 * Three guards keep the output honest:
 *   - A week the player was projected for but did not play counts as a MISS in
 *     beat_rate, so an injured stretch drags the number down instead of
 *     vanishing from the denominator.
 *   - Ratios are only taken from games with a meaningful projection, because
 *     dividing an actual score by a 0.4-point projection produces noise, not
 *     signal.
 *   - The final multiplier is shrunk toward 1.0 by sample size, so a three-game
 *     sample nudges a projection instead of rewriting it.
 *
 * Writes one row per (player, season, scoring) plus a blended row with a NULL
 * season, which is what the Power Pulse engine reads.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { DEFAULT_POWER_PULSE_SETTINGS, mergePowerPulseSettings } from "./power-pulse/default-settings";
import { withRetry } from "./supabase/retry";

type ServiceClient = SupabaseClient<Database>;

const PAGE = 1000;

const SCORING_BASES = ["pts_ppr", "pts_half_ppr", "pts_std"] as const;
type ScoringBase = (typeof SCORING_BASES)[number];

/**
 * Minimum projected points before a week contributes a ratio. Below this, the
 * denominator is small enough that a single touchdown produces a 900% "beat".
 */
const MIN_PROJECTION_FOR_RATIO = 3;

/** Ratio outliers are capped before averaging so one 6x week cannot dominate. */
const RATIO_CAP = 3;

type ProjectionRow = {
  playerId: string;
  season: number;
  week: number;
  ppr: number | null;
  halfPpr: number | null;
  std: number | null;
};

type ActualRow = {
  playerId: string;
  season: number;
  week: number;
  gp: number;
  ppr: number | null;
  halfPpr: number | null;
  std: number | null;
};

export type ProjectionAccuracyResult = {
  playersScored: number;
  rowsWritten: number;
  currentSeason: number;
  durationMs: number;
};

export async function runCalculateProjectionAccuracy(
  supabase: ServiceClient,
  options: { currentSeason?: number } = {},
): Promise<ProjectionAccuracyResult> {
  const started = Date.now();

  const settings = await loadSettings(supabase);
  const projections = await loadProjections(supabase);
  if (projections.length === 0) {
    return { playersScored: 0, rowsWritten: 0, currentSeason: 0, durationMs: Date.now() - started };
  }

  const seasons = [...new Set(projections.map((p) => p.season))].sort((a, b) => b - a);
  const currentSeason = options.currentSeason ?? seasons[0];

  const actuals = await loadActuals(supabase, seasons);
  const positions = await loadPositions(supabase);

  // Index actuals for O(1) join.
  const actualByKey = new Map<string, ActualRow>();
  for (const a of actuals) actualByKey.set(`${a.playerId}|${a.season}|${a.week}`, a);

  const seasonWeightFor = (season: number): number => {
    const distance = currentSeason - season;
    if (distance <= 0) return settings.recency.currentSeason;
    if (distance === 1) return settings.recency.oneSeasonBack;
    if (distance === 2) return settings.recency.twoSeasonsBack;
    return settings.recency.olderSeasons;
  };

  // Within the current season only, older weeks decay.
  const latestWeekBySeason = new Map<number, number>();
  for (const p of projections) {
    const seen = latestWeekBySeason.get(p.season) ?? 0;
    if (p.week > seen) latestWeekBySeason.set(p.season, p.week);
  }
  const weekWeightFor = (season: number, week: number): number => {
    if (season !== currentSeason) return 1;
    const halfLife = Math.max(1, settings.recency.currentSeasonHalfLifeWeeks);
    const latest = latestWeekBySeason.get(season) ?? week;
    const age = Math.max(0, latest - week);
    return 0.5 ** (age / halfLife);
  };

  // Group every graded week by player.
  const byPlayer = new Map<string, ProjectionRow[]>();
  for (const p of projections) {
    const list = byPlayer.get(p.playerId) ?? [];
    list.push(p);
    byPlayer.set(p.playerId, list);
  }

  const inserts: Database["public"]["Tables"]["player_projection_accuracy"]["Insert"][] = [];

  for (const [playerId, rows] of byPlayer) {
    const position = positions.get(playerId) ?? null;

    for (const scoring of SCORING_BASES) {
      // Per-season rows.
      const bySeason = new Map<number, ProjectionRow[]>();
      for (const row of rows) {
        const list = bySeason.get(row.season) ?? [];
        list.push(row);
        bySeason.set(row.season, list);
      }

      for (const [season, seasonRows] of bySeason) {
        const stats = accumulate(seasonRows, actualByKey, scoring, () => 1);
        if (stats.weeksProjected === 0) continue;
        inserts.push(
          toInsert(playerId, season, scoring, position, stats, settings.reliability.priorGames, settings),
        );
      }

      // Blended row, recency-weighted. This is what the engine reads.
      const blended = accumulate(rows, actualByKey, scoring, (row) =>
        seasonWeightFor(row.season) * weekWeightFor(row.season, row.week),
      );
      if (blended.weeksProjected === 0) continue;
      inserts.push(
        toInsert(playerId, null, scoring, position, blended, settings.reliability.priorGames, settings),
      );
    }
  }

  // Replace wholesale so players who fall out of the projection feed do not
  // keep a stale reliability score forever.
  await withRetry(
    async () => {
      const { error } = await supabase
        .from("player_projection_accuracy")
        .delete()
        .not("id", "is", null);
      if (error) throw error;
    },
    { label: "player_projection_accuracy clear" },
  );

  // Chunked with retry: this is a long run over tens of thousands of rows and
  // Supabase's edge proxy occasionally drops a socket mid-stream.
  const CHUNK = 500;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const chunk = inserts.slice(i, i + CHUNK);
    await withRetry(
      async () => {
        const { error } = await supabase.from("player_projection_accuracy").insert(chunk);
        if (error) throw error;
      },
      { label: `player_projection_accuracy insert ${i}` },
    );
  }

  return {
    playersScored: byPlayer.size,
    rowsWritten: inserts.length,
    currentSeason,
    durationMs: Date.now() - started,
  };
}

type Accumulated = {
  weeksProjected: number;
  weeksPlayed: number;
  weeksBeat: number;
  weightProjected: number;
  weightPlayed: number;
  weightBeat: number;
  ratioSum: number;
  ratioWeight: number;
  ratioSqSum: number;
  diffSum: number;
  diffWeight: number;
};

function accumulate(
  rows: ProjectionRow[],
  actualByKey: Map<string, ActualRow>,
  scoring: ScoringBase,
  weightOf: (row: ProjectionRow) => number,
): Accumulated {
  const acc: Accumulated = {
    weeksProjected: 0,
    weeksPlayed: 0,
    weeksBeat: 0,
    weightProjected: 0,
    weightPlayed: 0,
    weightBeat: 0,
    ratioSum: 0,
    ratioWeight: 0,
    ratioSqSum: 0,
    diffSum: 0,
    diffWeight: 0,
  };

  for (const row of rows) {
    const projected = pick(row, scoring);
    if (projected === null || projected <= 0) continue;

    const actualRow = actualByKey.get(`${row.playerId}|${row.season}|${row.week}`);
    // No stat row at all means the week has not been played yet, so it is not
    // gradeable in either direction. Skip it entirely.
    if (!actualRow) continue;

    const weight = weightOf(row);
    if (weight <= 0) continue;

    acc.weeksProjected += 1;
    acc.weightProjected += weight;

    const played = actualRow.gp > 0;
    const actual = played ? (pick(actualRow, scoring) ?? 0) : 0;

    if (played) {
      acc.weeksPlayed += 1;
      acc.weightPlayed += weight;
    }
    // A projected week the player missed counts as a miss, not as absent.
    if (played && actual >= projected) {
      acc.weeksBeat += 1;
      acc.weightBeat += weight;
    }

    if (played) {
      acc.diffSum += (actual - projected) * weight;
      acc.diffWeight += weight;
      if (projected >= MIN_PROJECTION_FOR_RATIO) {
        const ratio = Math.min(RATIO_CAP, actual / projected);
        acc.ratioSum += ratio * weight;
        acc.ratioSqSum += ratio * ratio * weight;
        acc.ratioWeight += weight;
      }
    }
  }

  return acc;
}

function toInsert(
  playerId: string,
  season: number | null,
  scoring: ScoringBase,
  position: string | null,
  acc: Accumulated,
  priorGames: number,
  settings: ReturnType<typeof mergePowerPulseSettings>,
): Database["public"]["Tables"]["player_projection_accuracy"]["Insert"] {
  const meanRatio = acc.ratioWeight > 0 ? acc.ratioSum / acc.ratioWeight : null;

  // Weighted population variance of the ratio.
  let ratioStdev: number | null = null;
  if (meanRatio !== null && acc.ratioWeight > 0) {
    const meanSq = acc.ratioSqSum / acc.ratioWeight;
    const variance = Math.max(0, meanSq - meanRatio * meanRatio);
    ratioStdev = Math.sqrt(variance);
  }

  // Empirical Bayes shrinkage toward neutral, by effective sample size.
  let shrunk: number | null = null;
  if (meanRatio !== null) {
    const n = acc.ratioWeight;
    const raw = (n * meanRatio + priorGames * 1) / (n + priorGames);
    shrunk = Math.min(
      settings.reliability.maxMultiplier,
      Math.max(settings.reliability.minMultiplier, raw),
    );
  }

  return {
    player_id: playerId,
    season,
    scoring,
    position,
    weeks_projected: acc.weeksProjected,
    weeks_played: acc.weeksPlayed,
    weeks_beat: acc.weeksBeat,
    beat_rate: acc.weightProjected > 0 ? round(acc.weightBeat / acc.weightProjected, 4) : null,
    mean_ratio: meanRatio === null ? null : round(meanRatio, 4),
    shrunk_multiplier: shrunk === null ? null : round(shrunk, 4),
    mean_diff: acc.diffWeight > 0 ? round(acc.diffSum / acc.diffWeight, 3) : null,
    ratio_stdev: ratioStdev === null ? null : round(ratioStdev, 4),
    availability_rate:
      acc.weightProjected > 0 ? round(acc.weightPlayed / acc.weightProjected, 4) : null,
    sample_weight: round(acc.weightProjected, 3),
    computed_at: new Date().toISOString(),
  };
}

function pick(row: { ppr: number | null; halfPpr: number | null; std: number | null }, scoring: ScoringBase): number | null {
  if (scoring === "pts_half_ppr") return row.halfPpr;
  if (scoring === "pts_std") return row.std;
  return row.ppr;
}

async function loadSettings(supabase: ServiceClient) {
  try {
    const { data } = await supabase
      .from("league_power_pulse_settings")
      .select("settings")
      .eq("id", "global")
      .maybeSingle();
    if (data?.settings) return mergePowerPulseSettings(data.settings);
  } catch {
    // Fall through to defaults.
  }
  return DEFAULT_POWER_PULSE_SETTINGS;
}

async function loadProjections(supabase: ServiceClient): Promise<ProjectionRow[]> {
  const out: ProjectionRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await withRetry(
      async () =>
        await supabase
          .from("player_weekly_projections")
      .select("player_id, season, week, projected_pts_ppr, projected_pts_half_ppr, projected_pts_std")
      .eq("season_type", "regular")
      .not("player_id", "is", null)
      .range(from, from + PAGE - 1),
      { label: `accuracy projections page ${from}` },
    );
    if (error) throw new Error(`accuracy projection load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (!row.player_id) continue;
      out.push({
        playerId: row.player_id,
        season: Number(row.season),
        week: Number(row.week),
        ppr: numOrNull(row.projected_pts_ppr),
        halfPpr: numOrNull(row.projected_pts_half_ppr),
        std: numOrNull(row.projected_pts_std),
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

async function loadActuals(supabase: ServiceClient, seasons: number[]): Promise<ActualRow[]> {
  const out: ActualRow[] = [];
  if (seasons.length === 0) return out;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await withRetry(
      async () =>
        await supabase
          .from("player_stats")
      .select("player_id, season, week, gp, pts_ppr, pts_half_ppr, pts_std")
      .eq("season_type", "regular")
      .in("season", seasons)
      .range(from, from + PAGE - 1),
      { label: `accuracy actuals page ${from}` },
    );
    if (error) throw new Error(`accuracy actual load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (!row.player_id) continue;
      out.push({
        playerId: row.player_id,
        season: Number(row.season),
        week: Number(row.week),
        gp: Number(row.gp ?? 0),
        ppr: numOrNull(row.pts_ppr),
        halfPpr: numOrNull(row.pts_half_ppr),
        std: numOrNull(row.pts_std),
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

async function loadPositions(supabase: ServiceClient): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await withRetry(
      async () =>
        await supabase.from("players").select("id, position").range(from, from + PAGE - 1),
      { label: `accuracy positions page ${from}` },
    );
    if (error) throw new Error(`accuracy position load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) out.set(row.id, row.position);
    if (data.length < PAGE) break;
  }
  return out;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
