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
 * Four guards keep the output honest:
 *   - A week the player was projected for but did not play counts as a MISS in
 *     beat_rate, so an injured stretch drags the number down instead of
 *     vanishing from the denominator.
 *   - Ratios are only taken from games with a meaningful projection, because
 *     dividing an actual score by a 0.4-point projection produces noise, not
 *     signal.
 *   - The multiplier is CENTERED on the player's own position before it is
 *     applied, so it can only ever say "against his positional peers". See
 *     positionBaselineRatio below for why that is a correctness requirement
 *     rather than a nicety.
 *   - The final multiplier is shrunk toward 1.0 by sample size, so a three-game
 *     sample nudges a projection instead of rewriting it.
 *
 * Writes one row per (player, season, scoring, source) plus a blended row with
 * a NULL season, which is what every projection engine reads through
 * lib/power-pulse/load.ts loadAccuracy(). That function takes a `source`
 * parameter (default 'sleeper', so every caller written before ffbeacon
 * projections existed keeps reading exactly what it always read), and
 * lib/projections/read.ts is the one caller that passes the source it
 * actually resolved, so a reader on the ffbeacon source gets reliability
 * measured against ffbeacon, never against sleeper's.
 *
 * WHAT `mean_ratio` IS AND IS NOT. It stays the RAW, uncentered figure, because
 * it is the audit trail: it is what we actually measured, and the breakdown page
 * shows it next to beat_rate and mean_diff. `shrunk_multiplier` is the DERIVED,
 * centered, shrunk number the projection engines apply. Keeping them apart is
 * what lets anyone re-derive one from the other and check this file's arithmetic
 * against the table.
 *
 * THE SOURCE DIMENSION. `player_weekly_projections` can hold more than one
 * source's projections for the same player-week (migration 0240 added `source`
 * to this table for exactly that reason: grading our own projections against
 * Sleeper's on the same table with the same code). Every quantity this file
 * derives is computed WITHIN one source and never pooled across sources: a
 * source's beat rate, mean ratio, multiplier, stdev, availability and mean diff
 * describe that source's own projections against reality, and mixing two
 * sources into one figure would average away the very comparison this table
 * exists to make.
 *
 * That includes the positional baseline. `positionBaselineRatio` centers a
 * player's ratio on his position because the SOURCE marks positions down or up
 * for reasons that have nothing to do with the player (Sleeper: QB about 5%
 * low, TE about 3% high, see the comment on that function). A different source
 * has its own bias, measured on its own projections, and centering a source's
 * players on another source's bias would not remove that source's positional
 * skew, it would replace it with someone else's. So the baseline key moved from
 * `season|scoring|position` to `source|season|scoring|position`, and every
 * baseline pool, and every row centered on it, is built one source at a time.
 *
 * `runCalculateProjectionAccuracy` groups the loaded projections by source and
 * runs the full three-pass grade (grade every player, build one baseline per
 * bucket, write rows) once per source, sharing only the parts that are not
 * source-specific: the actuals, the player positions, and which season counts
 * as "current". The returned `perSource` summary is the scoreboard: for each
 * source, pooled and per-position mean absolute error and mean error (bias)
 * over graded PLAYED weeks in PPR, the only two questions "is this source
 * better" and "is this source biased" actually need answered.
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

/**
 * How many graded players a position needs before its own average means
 * anything. Below this the pool is centered on nothing and the multiplier falls
 * back to the raw ratio, which is the old behaviour and the honest one: with
 * eight quarterbacks measured we cannot claim to know what an average
 * quarterback does against his projection.
 *
 * Twelve is one league's worth of starters at the thinnest position. Every real
 * position clears it comfortably (measured 2026-09-01: 32 DEF, 52 K, 71 QB,
 * 96 TE, 139 RB, 213 WR blended rows).
 */
const MIN_PLAYERS_FOR_BASELINE = 12;

/**
 * The average actual-over-projected ratio for one position, one scoring base,
 * one season bucket. Null when the pool is too thin to be a baseline.
 *
 * WHY CENTERING IS A CORRECTNESS FIX, NOT A REFINEMENT.
 *
 * `mean_ratio` mixes two things that behave completely differently. One is the
 * question we want to ask, "is this player better than his peers against the
 * projection". The other is a property of the SOURCE at that position, and it
 * is large. Measured against 2024 and 2025 player_stats on 2026-09-01, the pool
 * average of the applied multiplier was:
 *
 *     QB 0.948   RB 1.004   WR 0.993   TE 1.029
 *
 * So every quarterback in the game was being marked down about 5% and every
 * tight end marked up about 3%, for no football reason at all. Positional WAR
 * exists to answer "which position should I spend on", and an 8-point tilt
 * between two positions is a direct corruption of that answer rather than a
 * rounding error in it.
 *
 * The gap is mostly structural. Receivers and tight ends post a genuine zero
 * far more often than quarterbacks do (measured: 30% of played WR weeks and 43%
 * of played TE weeks carry no PPR points at all, against 4% for QB), and a
 * ratio has a hard floor at 0 with only RATIO_CAP of headroom above. Dividing
 * by the position's own average removes exactly that shared component and
 * leaves the per-player part, which is the only part we ever meant to apply.
 *
 * Weighted by ratioWeight rather than by player, so the baseline is the average
 * GRADED WEEK at the position and a two-game sample cannot move it.
 */
export function positionBaselineRatio(
  entries: ReadonlyArray<{ ratioSum: number; ratioWeight: number }>,
  minPlayers: number = MIN_PLAYERS_FOR_BASELINE,
): number | null {
  let sum = 0;
  let weight = 0;
  let players = 0;
  for (const entry of entries) {
    if (!(entry.ratioWeight > 0)) continue;
    sum += entry.ratioSum;
    weight += entry.ratioWeight;
    players += 1;
  }
  if (players < minPlayers || weight <= 0) return null;
  const baseline = sum / weight;
  if (!Number.isFinite(baseline) || baseline <= 0) return null;
  return baseline;
}

/**
 * The multiplier the projection engines actually apply: the player's ratio,
 * expressed against his position's baseline, then shrunk toward 1.0 by his own
 * effective sample size, then clamped.
 *
 * A player exactly average for his position lands on exactly 1.0 whatever the
 * source's positional bias happens to be, which is the property the raw ratio
 * did not have.
 *
 * `baseline` null means the pool was too thin to center on, so the raw ratio is
 * used. That is a deliberate fall-back to the previous behaviour rather than a
 * fall-back to neutral: with no baseline we still know the player's own figure,
 * we just cannot separate his part from his position's.
 */
export function centeredShrunkMultiplier(params: {
  meanRatio: number | null;
  ratioWeight: number;
  baseline: number | null;
  priorGames: number;
  minMultiplier: number;
  maxMultiplier: number;
}): number | null {
  const { meanRatio, ratioWeight, baseline, priorGames, minMultiplier, maxMultiplier } = params;
  if (meanRatio === null || !Number.isFinite(meanRatio)) return null;

  const centered = baseline === null ? meanRatio : meanRatio / baseline;
  if (!Number.isFinite(centered)) return null;

  const n = Math.max(0, ratioWeight);
  const denominator = n + priorGames;
  // priorGames is admin-editable and its floor is zero, so a player with no
  // ratio weight and no prior would divide by zero. He is neutral by definition.
  const raw = denominator > 0 ? (n * centered + priorGames) / denominator : 1;

  return Math.min(maxMultiplier, Math.max(minMultiplier, raw));
}

type ProjectionRow = {
  playerId: string;
  season: number;
  week: number;
  source: string;
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

/**
 * Per-position figures within one source, over graded PLAYED weeks in PPR
 * (see the header comment for why PPR only: this is a glance-at-it scoreboard,
 * not another slice of the full per-scoring table).
 */
export type ProjectionAccuracyPositionSummary = {
  position: string;
  playersScored: number;
  weeksGraded: number;
  /** mean(|actual - projected|) over graded played weeks. Lower is better. */
  meanAbsoluteError: number | null;
  /** mean(actual - projected) over graded played weeks. The bias; 0 is unbiased. */
  meanError: number | null;
};

/**
 * One source's scoreboard line: pooled across every position, plus the same
 * four figures broken out per position. `rowsWritten` counts every row this
 * run inserted for this source (every season bucket and scoring basis, plus
 * the blended row), which is a different, larger number than `weeksGraded`
 * (graded PLAYED weeks in PPR only) on purpose: one is "how much we stored",
 * the other is "how much evidence backs the headline numbers".
 */
export type ProjectionAccuracySourceSummary = {
  source: string;
  playersScored: number;
  rowsWritten: number;
  weeksGraded: number;
  meanAbsoluteError: number | null;
  meanError: number | null;
  byPosition: ProjectionAccuracyPositionSummary[];
};

export type ProjectionAccuracyResult = {
  playersScored: number;
  rowsWritten: number;
  currentSeason: number;
  durationMs: number;
  /** One entry per source graded this run, e.g. 'sleeper' today, 'ffbeacon' once it ships. */
  perSource: ProjectionAccuracySourceSummary[];
};

export async function runCalculateProjectionAccuracy(
  supabase: ServiceClient,
  options: { currentSeason?: number } = {},
): Promise<ProjectionAccuracyResult> {
  const started = Date.now();

  const settings = await loadSettings(supabase);
  const projections = await loadProjections(supabase);
  if (projections.length === 0) {
    return {
      playersScored: 0,
      rowsWritten: 0,
      currentSeason: 0,
      durationMs: Date.now() - started,
      perSource: [],
    };
  }

  // "Current season" is not a per-source concept, it is a calendar fact, so it
  // is picked once from every source's projections pooled together.
  const seasons = [...new Set(projections.map((p) => p.season))].sort((a, b) => b - a);
  const currentSeason = options.currentSeason ?? seasons[0];

  // Actuals and positions are not source-specific either: a player's real
  // stat line and his position do not depend on whose projection is being
  // graded against them, so both are loaded once and shared by every source.
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

  // Group every projection row by source. Everything past this point runs
  // once PER SOURCE: the grading, the positional baseline, the shrunk
  // multiplier, all of it, because a figure measured against one source's
  // projections is only meaningful applied to that same source's rows.
  const bySource = new Map<string, ProjectionRow[]>();
  for (const p of projections) {
    const list = bySource.get(p.source) ?? [];
    list.push(p);
    bySource.set(p.source, list);
  }

  const allPlayers = new Set(projections.map((p) => p.playerId));
  const allInserts: Database["public"]["Tables"]["player_projection_accuracy"]["Insert"][] = [];
  const perSource: ProjectionAccuracySourceSummary[] = [];

  for (const [source, sourceRows] of [...bySource].sort(([a], [b]) => a.localeCompare(b))) {
    // Within the current season only, older weeks decay. Scoped to this
    // source's own rows: a source that has not published as many weeks yet
    // must not have its decay curve set by a different source's coverage.
    const latestWeekBySeason = new Map<number, number>();
    for (const p of sourceRows) {
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

    // Group this source's rows by player.
    const byPlayer = new Map<string, ProjectionRow[]>();
    for (const p of sourceRows) {
      const list = byPlayer.get(p.playerId) ?? [];
      list.push(p);
      byPlayer.set(p.playerId, list);
    }

    /**
     * PASS ONE: grade every player, within this source. Nothing is turned
     * into a row yet, because a row's shrunk_multiplier depends on its
     * position's baseline, and a baseline cannot be known until every player
     * at that position, in this source, has been graded.
     */
    type Graded = {
      playerId: string;
      season: number | null;
      scoring: ScoringBase;
      position: string | null;
      acc: Accumulated;
    };
    const graded: Graded[] = [];

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
          graded.push({ playerId, season, scoring, position, acc: stats });
        }

        // Blended row, recency-weighted. This is what the engine reads.
        const blended = accumulate(rows, actualByKey, scoring, (row) =>
          seasonWeightFor(row.season) * weekWeightFor(row.season, row.week),
        );
        if (blended.weeksProjected === 0) continue;
        graded.push({ playerId, season: null, scoring, position, acc: blended });
      }
    }

    /**
     * PASS TWO: one baseline per (source, season bucket, scoring, position).
     *
     * Bucketed by SOURCE first, because the positional bias being corrected
     * for is a property of the source, not of football: bucketed by SEASON,
     * because that bias is not constant across years even within one source;
     * and a per-season row centered on a blended baseline would be centered
     * on the wrong thing. The blended rows get their own blended baseline,
     * computed from the same recency-weighted numbers that built them.
     *
     * A null position gets no baseline. We cannot center a player on a
     * position we do not know he plays, and inventing one is worse than
     * leaving his raw ratio alone.
     */
    const baselineKey = (g: {
      season: number | null;
      scoring: ScoringBase;
      position: string | null;
    }) => (g.position === null ? null : `${source}|${g.season ?? "blended"}|${g.scoring}|${g.position}`);

    const pools = new Map<string, Accumulated[]>();
    for (const g of graded) {
      const key = baselineKey(g);
      if (key === null) continue;
      const pool = pools.get(key);
      if (pool) pool.push(g.acc);
      else pools.set(key, [g.acc]);
    }

    const baselines = new Map<string, number | null>();
    for (const [key, pool] of pools) baselines.set(key, positionBaselineRatio(pool));

    /** PASS THREE: rows, for this source. */
    const sourceInserts = graded.map((g) => {
      const key = baselineKey(g);
      const baseline = key === null ? null : (baselines.get(key) ?? null);
      return toInsert(g.playerId, g.season, g.scoring, g.position, g.acc, baseline, source, settings);
    });
    allInserts.push(...sourceInserts);

    perSource.push(
      summarizeSource(source, sourceRows, actualByKey, positions, byPlayer.size, sourceInserts.length),
    );
  }

  // Replace wholesale so players who fall out of the projection feed do not
  // keep a stale reliability score forever. Every source is rebuilt on every
  // run, so this clears the whole table rather than one source's slice.
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
  for (let i = 0; i < allInserts.length; i += CHUNK) {
    const chunk = allInserts.slice(i, i + CHUNK);
    await withRetry(
      async () => {
        const { error } = await supabase.from("player_projection_accuracy").insert(chunk);
        if (error) throw error;
      },
      { label: `player_projection_accuracy insert ${i}` },
    );
  }

  return {
    playersScored: allPlayers.size,
    rowsWritten: allInserts.length,
    currentSeason,
    durationMs: Date.now() - started,
    perSource,
  };
}

/**
 * The scoreboard line for one source: PPR, graded PLAYED weeks only, mean
 * absolute error and mean error (bias), pooled and per position.
 *
 * Deliberately a flat, unweighted pass over the raw comparisons rather than a
 * reuse of the recency-weighted `Accumulated` figures above. Those exist to
 * build the shrunk_multiplier the projection engines apply, which is meant to
 * emphasize recent games on purpose. This summary answers a different
 * question, "how has this source actually done", and an honest answer to that
 * counts every graded week once, not decayed by how long ago it happened.
 */
function summarizeSource(
  source: string,
  rows: ProjectionRow[],
  actualByKey: Map<string, ActualRow>,
  positions: Map<string, string>,
  playersScored: number,
  rowsWritten: number,
): ProjectionAccuracySourceSummary {
  type Bucket = { players: Set<string>; weeksGraded: number; absDiffSum: number; diffSum: number };
  const newBucket = (): Bucket => ({ players: new Set(), weeksGraded: 0, absDiffSum: 0, diffSum: 0 });

  const pooled = newBucket();
  const byPosition = new Map<string, Bucket>();

  for (const row of rows) {
    const projected = row.ppr;
    if (projected === null || projected <= 0) continue;

    const actualRow = actualByKey.get(`${row.playerId}|${row.season}|${row.week}`);
    if (!actualRow || actualRow.gp <= 0) continue; // not played, or not yet played: not gradeable

    const actual = actualRow.ppr ?? 0;
    const diff = actual - projected;
    const abs = Math.abs(diff);

    pooled.players.add(row.playerId);
    pooled.weeksGraded += 1;
    pooled.absDiffSum += abs;
    pooled.diffSum += diff;

    const position = positions.get(row.playerId);
    if (position) {
      const bucket = byPosition.get(position) ?? newBucket();
      bucket.players.add(row.playerId);
      bucket.weeksGraded += 1;
      bucket.absDiffSum += abs;
      bucket.diffSum += diff;
      byPosition.set(position, bucket);
    }
  }

  const summarize = (b: Bucket): Omit<ProjectionAccuracyPositionSummary, "position"> => ({
    playersScored: b.players.size,
    weeksGraded: b.weeksGraded,
    meanAbsoluteError: b.weeksGraded > 0 ? round(b.absDiffSum / b.weeksGraded, 3) : null,
    meanError: b.weeksGraded > 0 ? round(b.diffSum / b.weeksGraded, 3) : null,
  });

  // `playersScored` at the top level is the source's coverage: every player it
  // published a projection for. The pooled bucket's own player count (how many
  // actually contributed a graded week) is a narrower, different number, so it
  // is taken by name rather than spread, to avoid silently overwriting coverage
  // with evidence.
  const pooledSummary = summarize(pooled);
  return {
    source,
    playersScored,
    rowsWritten,
    weeksGraded: pooledSummary.weeksGraded,
    meanAbsoluteError: pooledSummary.meanAbsoluteError,
    meanError: pooledSummary.meanError,
    byPosition: [...byPosition.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([position, bucket]) => ({ position, ...summarize(bucket) })),
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
  /** His position's average ratio, or null when the pool was too thin to use. */
  baseline: number | null,
  source: string,
  settings: ReturnType<typeof mergePowerPulseSettings>,
): Database["public"]["Tables"]["player_projection_accuracy"]["Insert"] {
  const meanRatio = acc.ratioWeight > 0 ? acc.ratioSum / acc.ratioWeight : null;

  // Weighted population variance of the ratio. Measured on the RAW ratio, since
  // centering divides every week by the same constant and would rescale a
  // spread that lib/power-pulse/project.ts reads as a coefficient of variation
  // of points. Volatility is a property of the player, not of his peers.
  let ratioStdev: number | null = null;
  if (meanRatio !== null && acc.ratioWeight > 0) {
    const meanSq = acc.ratioSqSum / acc.ratioWeight;
    const variance = Math.max(0, meanSq - meanRatio * meanRatio);
    ratioStdev = Math.sqrt(variance);
  }

  // Centered on his position, then empirical Bayes shrinkage toward neutral by
  // effective sample size, then clamped.
  const shrunk = centeredShrunkMultiplier({
    meanRatio,
    ratioWeight: acc.ratioWeight,
    baseline,
    priorGames: settings.reliability.priorGames,
    minMultiplier: settings.reliability.minMultiplier,
    maxMultiplier: settings.reliability.maxMultiplier,
  });

  return {
    player_id: playerId,
    season,
    scoring,
    position,
    source,
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
      .select("player_id, season, week, source, projected_pts_ppr, projected_pts_half_ppr, projected_pts_std")
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
        source: row.source,
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
