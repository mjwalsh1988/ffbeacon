/**
 * Team play volume, and how a game's odds line modulates it. Plan section
 * 3.4 "Game environment from odds".
 *
 * Sleeper's own weekly projection carries no matchup at all: measured on the
 * live 2026 board, one receiver's projected points spanned 3% across seven
 * different opponents, with projected targets byte-identical for five of
 * them. A game total and a spread are the two numbers that move fantasy
 * scoring most and that a season average cannot carry, which is the entire
 * justification for this module.
 *
 * Pure. No Supabase client, no Date, no fetch, no Math.random. Plain data in,
 * plain data out, the same contract as lib/positional-war/engine.ts.
 */

import type { ProjectionSettings } from "./default-settings";
import type { GameEnvironment, TeamVolume } from "./types";
import { recencyWeight, type PlayerStatRow } from "./usage";

export type EnvironmentEffect = {
  /** Multiplier on play counts. */
  volume: number;
  /** Multiplier on touchdown RATES. Moves harder than volume, on purpose. */
  scoring: number;
  /** Share of total plays moved from passing to rushing. Negative moves the other way. */
  rushShift: number;
};

const NEUTRAL_EFFECT: EnvironmentEffect = { volume: 1, scoring: 1, rushShift: 0 };

/**
 * A non-finite input returns `min` rather than propagating, matching
 * clampMultiplier in ./adjust.ts and clamp in lib/power-pulse/math.ts.
 * `Math.min(max, Math.max(min, NaN))` is NaN, and a NaN game-environment
 * multiplier would silently zero out every projection it touched.
 */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * The volume, scoring and script effect one game's odds line implies for one
 * team, all three clamped and all three admin-tunable.
 *
 * The guards here matter more than the arithmetic. A missing line is an
 * adjustment we did NOT make, never a neutral game we asserted, so every path
 * that lacks the input it needs returns the neutral multiplier for exactly
 * the piece it cannot compute, rather than guessing or propagating NaN.
 */
export function environmentEffect(env: GameEnvironment | null, settings: ProjectionSettings): EnvironmentEffect {
  // No game to look at, or the feature is off: no adjustment is made at all.
  if (!settings.environment.enabled || !env) return NEUTRAL_EFFECT;

  let volume = 1;
  let scoring = 1;
  if (env.impliedTotal !== null) {
    const ratio = env.impliedTotal / settings.environment.leagueAverageImpliedTotal;
    // A ratio that is not a finite positive number (a zero or negative
    // league average, or a zero or negative implied total) has no meaningful
    // exponent to take: raising it to a fractional power like the default
    // totalWeight of 0.5 is NaN, but raising it to an INTEGER power (which
    // totalWeight * 2 becomes at the default 0.5) is finite and simply
    // wrong, a plausible-looking number computed from a nonsensical input.
    // Guarding on the ratio itself, before either power is taken, catches
    // both rather than letting one slip through as a false finite result.
    if (Number.isFinite(ratio) && ratio > 0) {
      const rawVolume = ratio ** settings.environment.totalWeight;
      // Scoring moves on TWICE volume's exponent: a richer scoring
      // environment produces more touchdowns per play, not merely more
      // plays, so the touchdown-rate multiplier is deliberately the more
      // sensitive of the two.
      const rawScoring = ratio ** (settings.environment.totalWeight * 2);
      volume = Number.isFinite(rawVolume)
        ? clamp(rawVolume, settings.environment.totalMin, settings.environment.totalMax)
        : 1;
      scoring = Number.isFinite(rawScoring)
        ? clamp(rawScoring, settings.environment.totalMin, settings.environment.totalMax)
        : 1;
    }
  }

  let rushShift = 0;
  if (env.spread !== null) {
    // A NEGATIVE spread means this team is FAVOURED, and a favourite runs
    // more, so the sign flip below is deliberate. Get this backwards and
    // every game script in the model inverts silently: it never shows up in
    // a total, only in which side of the pass/rush split moves.
    const rawShift = -env.spread * settings.environment.spreadWeight;
    rushShift = Number.isFinite(rawShift)
      ? clamp(rawShift, -settings.environment.scriptMax, settings.environment.scriptMax)
      : 0;
  }

  return { volume, scoring, rushShift };
}

type TeamWeekVolume = {
  team: string;
  season: number;
  week: number;
  passAttempts: number;
  rushAttempts: number;
  /** Maximum off_snp on the team-week. Null when no row carried a value. */
  snaps: number | null;
};

/**
 * Team-week totals, using the SAME aggregation rule as usage.ts: the maximum
 * off_snp is the snap denominator (the quarterback in almost every case, and
 * the right denominator when it is not), while pass attempts and rush
 * attempts are summed across every player on the team-week.
 */
function buildTeamWeekVolume(rows: readonly PlayerStatRow[]): Map<string, TeamWeekVolume> {
  const totals = new Map<string, TeamWeekVolume>();
  for (const row of rows) {
    if (row.team === null) continue;
    const key = `${row.team}|${row.season}|${row.week}`;
    const existing = totals.get(key) ?? {
      team: row.team,
      season: row.season,
      week: row.week,
      passAttempts: 0,
      rushAttempts: 0,
      snaps: null,
    };
    existing.passAttempts += row.passAttempts;
    existing.rushAttempts += row.carries;
    if (row.offSnaps !== null) {
      existing.snaps = existing.snaps === null ? row.offSnaps : Math.max(existing.snaps, row.offSnaps);
    }
    totals.set(key, existing);
  }
  return totals;
}

/**
 * A recency-weighted per-game baseline of team offensive volume: mean pass
 * attempts, mean rush attempts, and mean offensive snaps per team-week.
 *
 * Snaps are averaged only over the team-weeks that actually carried a snap
 * count. A team-week with no snap data anywhere in the input is thin data for
 * that one component, not a team-week that ran zero snaps, so it is excluded
 * from the snap average rather than pulling it toward zero.
 */
export function computeTeamVolume(
  rows: readonly PlayerStatRow[],
  params: { currentSeason: number; latestWeek: number },
  settings: ProjectionSettings,
): Map<string, TeamVolume> {
  const teamWeeks = buildTeamWeekVolume(rows);

  const byTeam = new Map<
    string,
    { weightedPass: number; weightedRush: number; weight: number; weightedSnaps: number; snapWeight: number }
  >();

  for (const teamWeek of teamWeeks.values()) {
    const weight = recencyWeight(teamWeek, params, settings);
    const bucket = byTeam.get(teamWeek.team) ?? {
      weightedPass: 0,
      weightedRush: 0,
      weight: 0,
      weightedSnaps: 0,
      snapWeight: 0,
    };
    bucket.weightedPass += weight * teamWeek.passAttempts;
    bucket.weightedRush += weight * teamWeek.rushAttempts;
    bucket.weight += weight;
    if (teamWeek.snaps !== null) {
      bucket.weightedSnaps += weight * teamWeek.snaps;
      bucket.snapWeight += weight;
    }
    byTeam.set(teamWeek.team, bucket);
  }

  const result = new Map<string, TeamVolume>();
  for (const [team, bucket] of byTeam) {
    result.set(team, {
      team,
      passAttempts: bucket.weight > 0 ? bucket.weightedPass / bucket.weight : 0,
      rushAttempts: bucket.weight > 0 ? bucket.weightedRush / bucket.weight : 0,
      offensiveSnaps: bucket.snapWeight > 0 ? bucket.weightedSnaps / bucket.snapWeight : 0,
    });
  }
  return result;
}

/**
 * Modulate a team's baseline volume by one game's environment effect.
 *
 * `rushShift` moves that fraction of total plays from passing to rushing (a
 * negative shift moves the other way), and the result is then scaled by
 * `effect.volume`. Both counts are floored at 0 afterward so an extreme,
 * clamped-in-theory-but-still-large shift on a small baseline can never
 * produce a negative attempt count.
 */
export function applyEnvironment(base: TeamVolume, effect: EnvironmentEffect): TeamVolume {
  const totalPlays = base.passAttempts + base.rushAttempts;
  const shiftedPlays = effect.rushShift * totalPlays;

  const passAttempts = Math.max(0, (base.passAttempts - shiftedPlays) * effect.volume);
  const rushAttempts = Math.max(0, (base.rushAttempts + shiftedPlays) * effect.volume);
  const offensiveSnaps = Math.max(0, base.offensiveSnaps * effect.volume);

  return { team: base.team, passAttempts, rushAttempts, offensiveSnaps };
}
