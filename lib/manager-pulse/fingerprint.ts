/**
 * Manager Pulse: the exact invalidation key.
 *
 * PURE AND CLOCK-FREE. This module never reads Date.now(), never calls
 * Math.random(), and does no I/O. The same input always produces the same
 * hash, in this process or any other, so the caller is responsible for
 * supplying counts and settings that are already as fresh as the caller wants
 * them to be.
 *
 * The fingerprint changes when any of the following change, and on nothing
 * else:
 *
 *   - The season window (seasonFrom, seasonTo).
 *   - The set of league-seasons counted, as (leagueId, season) pairs. Order
 *     does not matter (it is a set), so this module sorts it before hashing.
 *   - The model version.
 *   - The count of transactions, drafts, and settled matchups the report was
 *     built from. A count changing means new rows landed since the report was
 *     last computed, even if nothing else about the request changed.
 *   - The settings groups that affect the OUTPUT: `samples` (every minimum
 *     sample floor the engine gates a figure on), `draft` (the reach
 *     threshold and the early-round cutoff), and `display` (see below).
 *
 * INCLUDED, though it looks like a render-time concern: `display`
 *
 *   `display` (favouritesShown, avoidsShown, tradesShown, leagueRowsShown,
 *   narrativeSentencesMax) used to be excluded here on the theory that
 *   "slicing a list at render time does not require a recompute." That
 *   theory was wrong: `affinity.ts`, `results.ts` and `narrative.ts` all
 *   slice their lists INSIDE `computeFootprint`, and the sliced result, not
 *   the full one, is what gets baked into `manager_pulse_cache`. Raising
 *   `favouritesShown` from 12 to 20 changes nothing for any report already
 *   sitting in the cache, because the fingerprint that would trigger a
 *   recompute never moved. `display` is included for exactly the same reason
 *   `samples` and `draft` are: it is applied during compute, not at render,
 *   so a change to one of its fields genuinely produces a different stored
 *   report and must invalidate the cache that holds the old one.
 *
 * DELIBERATELY EXCLUDED, and why:
 *
 *   - `capture` settings (the season window bounds, the league caps, the
 *     cooldown, the TTLs, includeBestBall). These change what gets FETCHED,
 *     not what the engine does with what it already has. A change here shows
 *     up as a different set of league-seasons counted (or a different
 *     seasonFrom/seasonTo), which is already in the fingerprint through those
 *     two fields. Hashing the raw settings a second time would invalidate on
 *     the same change twice for no benefit.
 *
 *   - `lookup` and `tendency` settings. Rate limits and the Trade Ideas
 *     acceptance-band knobs govern who may ask and how the answer is USED
 *     downstream; neither changes a single figure inside the report itself.
 */

import { createHash } from "node:crypto";
import type { ManagerPulseSettings } from "./default-settings";

/** One league-season the report counted, identified by our internal league id and the season. */
export type ManagerPulseLeagueSeason = {
  leagueId: string;
  season: number;
};

/** The samples, draft and display groups only. See the header above for why the rest is excluded. */
export type ManagerPulseFingerprintSettings = Pick<ManagerPulseSettings, "samples" | "draft" | "display">;

/** Every input that can change a Manager Pulse report. */
export type ManagerPulseFingerprintInput = {
  seasonFrom: number;
  seasonTo: number;
  /** The exact set of league-seasons the report was built from. */
  leagueSeasons: ManagerPulseLeagueSeason[];
  /** mp-N. The manual override for any change not otherwise captured. */
  modelVersion: string;
  counts: {
    transactions: number;
    drafts: number;
    settledMatchups: number;
  };
  settings: ManagerPulseFingerprintSettings;
};

function sortLeagueSeasons(
  seasons: ManagerPulseLeagueSeason[],
): ManagerPulseLeagueSeason[] {
  return [...seasons].sort((a, b) => {
    if (a.leagueId !== b.leagueId) return a.leagueId < b.leagueId ? -1 : 1;
    return a.season - b.season;
  });
}

/**
 * Recursively sort object keys so JSON.stringify cannot depend on insertion
 * order. Two settings documents that differ only in key order (which Postgres
 * jsonb does not preserve) must fingerprint identically.
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

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortForCanonical(value));
}

function buildPayload(input: ManagerPulseFingerprintInput) {
  return {
    // Bumped when the payload's SHAPE changes, so a stored hash cannot be
    // mistaken for one computed from a different field list.
    v: 1,
    seasonFrom: input.seasonFrom,
    seasonTo: input.seasonTo,
    leagueSeasons: sortLeagueSeasons(input.leagueSeasons).map((ls) => [ls.leagueId, ls.season]),
    modelVersion: input.modelVersion,
    counts: {
      transactions: input.counts.transactions,
      drafts: input.counts.drafts,
      settledMatchups: input.counts.settledMatchups,
    },
    settings: sortForCanonical(input.settings),
  };
}

/**
 * The sha256 hex digest of the canonical JSON payload. Deterministic and
 * clock-free.
 */
export function managerPulseFingerprint(input: ManagerPulseFingerprintInput): string {
  return createHash("sha256").update(canonicalJson(buildPayload(input))).digest("hex");
}
