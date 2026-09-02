/**
 * The projection source slugs, and nothing else.
 *
 * Split out from ./source.ts so the BUILDER can name the source it writes
 * without importing the READER's selection logic. lib/build-beacon-projections
 * runs server side against the service role; the reader path is called from
 * page renders. Keeping the constants in a leaf module with no imports of its
 * own means neither side can drag the other's dependencies along.
 *
 * These are stored values. They appear in `player_weekly_projections.source`
 * and in `player_projection_accuracy.source`, so changing one is a data
 * migration, not a rename.
 */

/** Sleeper's own published projection. The default, and the fallback. */
export const SLEEPER_SOURCE = "sleeper";

/** Our own, from lib/projections/. Blended with Sleeper, never replacing it. */
export const BEACON_SOURCE = "ffbeacon";

export const PROJECTION_SOURCES = [SLEEPER_SOURCE, BEACON_SOURCE] as const;
export type ProjectionSourceSlug = (typeof PROJECTION_SOURCES)[number];
