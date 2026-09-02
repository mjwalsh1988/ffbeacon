/**
 * Blending our own projection with Sleeper's.
 *
 * `w = clamp(currentSeasonGames / gamesForMax, 0, 1) * (max - min) + min`
 *
 * In week 1 the beacon projection contributes nothing and the stored row is
 * Sleeper's, rescored. By `gamesForMax` games it reaches `max`, capped at half
 * deliberately: half of a source with no track record is already an
 * aggressive claim. This mirrors 3.8 of the projection engine plan.
 *
 * WHY THE BLEND RUNS ON THE STAT LINE
 *
 * The blend runs component by component on the stat line, not on the point
 * total, so the result stays a real stat line that any league's scoring
 * settings can price through scoreStatMap(), rather than a single number that
 * has forgotten what produced it.
 */

import type { StatLine } from "./types";
import type { ProjectionSettings } from "./default-settings";

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * `gamesForMax` of 0 is a real setting, not an error: it means every player
 * with any current season games at all gets `max` immediately. Dividing by a
 * `gamesForMax` of 0 would otherwise produce a NaN ratio, so that case is
 * handled explicitly rather than left to fall out of the division.
 */
export function blendWeight(currentSeasonGames: number, settings: ProjectionSettings): number {
  const { min, max, gamesForMax } = settings.blend;
  const games = Number.isFinite(currentSeasonGames) && currentSeasonGames > 0 ? currentSeasonGames : 0;

  const ratio = gamesForMax <= 0 ? (games > 0 ? 1 : 0) : games / gamesForMax;
  const weight = min + clamp01(ratio) * (max - min);
  return clamp01(weight);
}

/**
 * Blend two stat lines key by key over the union of their keys.
 *
 * ONE-SIDED KEYS
 *
 * A key present on only one side is neither blended toward an implied zero
 * on the other side nor dropped. Both of those are wrong: if Sleeper projects
 * `pass_sack` and we do not, multiplying Sleeper's real value by `(1 - w)`
 * and adding a zero for our side would pull the number down toward a zero we
 * never asserted, inventing a claim neither source actually made. If we
 * project `rec_tgt` (which Sleeper's own projection does not carry) and
 * dropped the key because Sleeper has no opinion on it, we would throw away
 * real information we do have. So a one-sided key is carried through at its
 * one asserted value, in full, regardless of weight: the side with no
 * opinion simply defers entirely to the side that has one.
 *
 * A non-finite value on either side is treated the same as an absent key.
 */
export function blendStatLines(beacon: StatLine, sleeper: StatLine, weight: number): StatLine {
  const w = clamp01(weight);
  const result: StatLine = {};

  const keys = new Set<string>([...Object.keys(beacon), ...Object.keys(sleeper)]);
  keys.delete("gp");

  for (const key of keys) {
    const b = beacon[key];
    const s = sleeper[key];
    const hasB = typeof b === "number" && Number.isFinite(b);
    const hasS = typeof s === "number" && Number.isFinite(s);

    if (hasB && hasS) {
      result[key] = w * b + (1 - w) * s;
    } else if (hasB) {
      result[key] = b;
    } else if (hasS) {
      result[key] = s;
    }
  }

  // gp is a game count, not a blended quantity: a projection row for one
  // week represents exactly one game either way.
  result.gp = 1;

  return result;
}
