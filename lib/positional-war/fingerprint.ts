/**
 * The Positional WAR cross-league cache key.
 *
 * Section 6 of docs/league-pulse-positional-war-plan.md derives the result as a
 * pure function of a short, enumerable list of inputs (season, the startable
 * slot multiset, team count, normalized scoring, the reliability/availability/
 * injury/opponent/variance/recency blocks of the resolved Power Pulse settings,
 * the WAR display settings, the model version, and an hour-truncated
 * projections snapshot). Two leagues whose fingerprints match are guaranteed to
 * produce the same curve, and the inputs digest in warInputsDigest() is the
 * collision guard that catches a hash collision anyway (section 15.4.3).
 *
 * This module is pure and clock-free on purpose: no Date.now(), no
 * Math.random(), no I/O. It must be importable from both server code and a
 * test with no setup. The caller is responsible for supplying an already
 * hour-truncated projectionsSnapshot; computing "now" here would make the
 * fingerprint change on every call.
 *
 * Deliberately absent: source slug, format_config_id, rosters.player_ids,
 * league_matchups, playoff_teams, league name, and every non-scoring league
 * setting. None of those are read by the model (section 6.1's exclusion
 * table), so none of them belong in the cache key.
 */

import { createHash } from "node:crypto";
import {
  closestScoringBase,
  isNonScoringKey,
  isUsableScoring,
  type ScoringBase,
  type ScoringSettings,
} from "@/lib/league-scoring";
import { startingSlots } from "@/lib/power-pulse/lineup";
import type { PowerPulseSettings } from "@/lib/power-pulse/default-settings";
import type { WarSettings } from "@/lib/positional-war/default-settings";

/**
 * The exact set of entries scoreStatMap can ever read from a scoring map,
 * normalized so two leagues that mean the same thing produce the same value:
 * float noise killed by rounding to six decimals, and a stable key order so the
 * fingerprint does not depend on Object.entries() iteration order.
 *
 * This is provable rather than heuristic (plan section 6.2): scoreStatMap skips
 * an entry exactly when the value is not a finite number, the value is exactly
 * 0, or isNonScoringKey(key) is true. Filtering on those same three conditions
 * here means two leagues with identical normalizedScoring output score every
 * player identically, as a property of the code rather than an assumption.
 */
export function normalizedScoring(s: ScoringSettings | null): Array<[string, number]> {
  if (!s) return [];
  return Object.entries(s)
    .filter(
      ([k, v]) => typeof v === "number" && Number.isFinite(v) && v !== 0 && !isNonScoringKey(k),
    )
    .map(([k, v]) => [k, Number(v.toFixed(6))] as [string, number])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

function sortStrings(values: string[]): string[] {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The reliability, availability, injury, opponent, variance, and recency blocks. */
type FingerprintedPulseSettings = Pick<
  PowerPulseSettings,
  "reliability" | "availability" | "injury" | "opponent" | "variance" | "recency"
>;

/** displayDepthMultiple, minDisplayDepth, cliffThreshold, clampBelowReplacement only. */
type FingerprintedWarSettings = Pick<
  WarSettings,
  "displayDepthMultiple" | "minDisplayDepth" | "cliffThreshold" | "clampBelowReplacement"
>;

/** Every input that can change a Positional WAR curve. Section 6.1. */
export type WarFingerprintInput = {
  season: number;
  fromWeek: number;
  toWeek: number;
  teamCount: number;
  /** Raw roster_positions. startingSlots() runs and sorts inside this module. */
  rosterPositions: string[];
  scoringSettings: ScoringSettings | null;
  pulseSettings: FingerprintedPulseSettings;
  warSettings: FingerprintedWarSettings;
  /** war-N. The manual override for any change not otherwise captured. */
  modelVersion: string;
  /**
   * max(updated_at) of player_weekly_projections for the relevant window,
   * ALREADY truncated to the hour by the caller. This module never computes a
   * timestamp itself.
   */
  projectionsSnapshot: string;
};

/**
 * Recursively sort object keys so JSON.stringify cannot depend on insertion
 * order. Arrays keep their given order: slots and normalizedScoring are already
 * sorted by the caller, and order there is meaningful (a differently-ordered
 * scoring array would still be the same set, but we sort it once in
 * normalizedScoring rather than twice).
 */
function sortForCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForCanonical);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      out[key] = sortForCanonical(source[key]);
    }
    return out;
  }
  return value;
}

/** JSON.stringify with every object's keys sorted, recursively. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortForCanonical(value));
}

function buildPayload(input: WarFingerprintInput) {
  return {
    v: 1,
    season: input.season,
    fromWeek: input.fromWeek,
    toWeek: input.toWeek,
    teamCount: input.teamCount,
    slots: sortStrings(startingSlots(input.rosterPositions)),
    scoring: normalizedScoring(input.scoringSettings),
    scoringUsable: isUsableScoring(input.scoringSettings),
    scoringBase: closestScoringBase(input.scoringSettings),
    pulseSettings: input.pulseSettings,
    warSettings: input.warSettings,
    modelVersion: input.modelVersion,
    projectionsSnapshot: input.projectionsSnapshot,
  };
}

/**
 * The sha256 hex digest of the canonical JSON payload. Deterministic and
 * clock-free: the same input always produces the same hash, in this process or
 * any other.
 */
export function warFingerprint(input: WarFingerprintInput): string {
  return createHash("sha256").update(canonicalJson(buildPayload(input))).digest("hex");
}

/** The nine-field collision guard, section 15.4.3. Human-readable, not hashed. */
export type WarInputsDigest = {
  season: number;
  fromWeek: number;
  toWeek: number;
  teamCount: number;
  slots: string[];
  scoringBase: ScoringBase;
  scoringUsable: boolean;
  scoringKeyCount: number;
  modelVersion: string;
};

/**
 * Recompute the nine human-readable values a fingerprint hash stands for, so a
 * cache hit can be checked field by field before its rows are reused. Cheap on
 * purpose: nine comparisons on a row already read, not a second fingerprint.
 */
export function warInputsDigest(input: WarFingerprintInput): WarInputsDigest {
  return {
    season: input.season,
    fromWeek: input.fromWeek,
    toWeek: input.toWeek,
    teamCount: input.teamCount,
    slots: sortStrings(startingSlots(input.rosterPositions)),
    scoringBase: closestScoringBase(input.scoringSettings),
    scoringUsable: isUsableScoring(input.scoringSettings),
    scoringKeyCount: normalizedScoring(input.scoringSettings).length,
    modelVersion: input.modelVersion,
  };
}

const DIGEST_FIELDS: Array<keyof WarInputsDigest> = [
  "season",
  "fromWeek",
  "toWeek",
  "teamCount",
  "slots",
  "scoringBase",
  "scoringUsable",
  "scoringKeyCount",
  "modelVersion",
];

function digestFieldsEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, i) => value === b[i]);
  }
  return a === b;
}

/**
 * Compare two inputs digests field by field, naming the FIRST field that
 * differs so the collision log (section 15.4.3) can say which one moved.
 */
export function digestsMatch(
  a: WarInputsDigest,
  b: WarInputsDigest,
): { ok: true } | { ok: false; field: string } {
  for (const field of DIGEST_FIELDS) {
    if (!digestFieldsEqual(a[field], b[field])) {
      return { ok: false, field };
    }
  }
  return { ok: true };
}
