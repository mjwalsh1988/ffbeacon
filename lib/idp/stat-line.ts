/**
 * Individual defensive player (IDP) stat lines: the one normaliser, and the
 * one way to score a line under a preset (plan R-8).
 *
 * THE RULES.
 *   Projected line: keep ONLY idp_* keys. Sleeper attaches team-defense keys to
 *   some defenders' projections (def_pr_yd, def_pr_td, def_kr_yd, def_fum_td,
 *   pass_int_td) and ADP keys to all of them; a league that scores team defense
 *   would otherwise credit a linebacker with his team's punt returns. When a
 *   projected line carries solo and assisted tackles but no combined figure,
 *   derive idp_tkl = solo + assisted (Sleeper usually projects it, so this is a
 *   fallback).
 *   Actual line: score everything Sleeper emitted for the player EXCEPT its own
 *   derived figures (pts_*, pos_rank_*, adp_*) and the games-played counters.
 *   Actual lines carry no team-defense keys, and they do carry the threshold
 *   bonuses and special-teams keys Sleeper credits to the player.
 *
 * Never reads a stored points column. lib/idp/points-guard.test.ts fails the
 * suite if any module under lib/idp/ names one.
 *
 * Client-safe: no imports beyond the presets.
 */

import type { IdpScoringMap } from "./scoring-presets";

export type StatLine = Record<string, number>;

function finiteEntries(stats: Record<string, unknown> | null | undefined): [string, number][] {
  if (!stats || typeof stats !== "object") return [];
  const out: [string, number][] = [];
  for (const [key, value] of Object.entries(stats)) {
    if (typeof value === "number" && Number.isFinite(value)) out.push([key, value]);
  }
  return out;
}

/** True when a line holds at least one finite idp_* figure. */
export function hasIdpStats(stats: Record<string, unknown> | null | undefined): boolean {
  return finiteEntries(stats).some(([key]) => key.startsWith("idp_"));
}

/** A projected defender line: idp_* keys only, combined tackles derived if absent. */
export function normalizeProjectedIdpLine(stats: Record<string, unknown> | null | undefined): StatLine {
  const out: StatLine = {};
  for (const [key, value] of finiteEntries(stats)) {
    if (key.startsWith("idp_")) out[key] = value;
  }
  if (out.idp_tkl === undefined && (out.idp_tkl_solo !== undefined || out.idp_tkl_ast !== undefined)) {
    out.idp_tkl = (out.idp_tkl_solo ?? 0) + (out.idp_tkl_ast ?? 0);
  }
  return out;
}

const ACTUAL_DROP_PREFIXES = ["pts_", "pos_rank_", "adp_"];
const ACTUAL_DROP_KEYS = new Set(["gp", "gs", "gms_active"]);

/** An actual defender line: everything Sleeper credited, minus its own derived figures. */
export function normalizeActualIdpLine(stats: Record<string, unknown> | null | undefined): StatLine {
  const out: StatLine = {};
  for (const [key, value] of finiteEntries(stats)) {
    if (ACTUAL_DROP_KEYS.has(key)) continue;
    if (ACTUAL_DROP_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    out[key] = value;
  }
  return out;
}

/** Points for a normalised line under a scoring map. A plain dot product. */
export function scoreIdpLine(line: StatLine, scoring: IdpScoringMap): number {
  let total = 0;
  for (const [key, weight] of Object.entries(scoring)) {
    if (!weight) continue;
    const value = line[key];
    if (typeof value === "number" && Number.isFinite(value)) total += value * weight;
  }
  return total;
}
