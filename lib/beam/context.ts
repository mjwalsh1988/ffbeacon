/**
 * Build the one context object every BEAM request runs against.
 *
 * Format and source come from the site-wide resolver chain, the same one the
 * rankings board, the player profile, and Beacon Breakdown use: URL parameter,
 * then the signed-in user's saved preference, then cookie, then the registry
 * default. That is not optional politeness. A reader who set their format to
 * Dynasty Superflex and then asked BEAM what a player is worth would otherwise
 * get a number from a different league than every other page they had open.
 *
 * The source additionally goes through resolveSourceForFormat, because not every
 * source covers every format: KTC publishes no best-ball values, so a reader on
 * a best-ball format gets the fall-through source rather than an empty answer.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import {
  describeSource,
  getActiveFormats,
  getAvailableSources,
  resolveSourceForFormat,
} from "@/lib/source";
import { scoringKeyForType } from "@/lib/player-profile";
import { resolveBeamClock } from "./clock";
import { loadBeamSettings } from "./settings";
import type { BeamSettings } from "./default-settings";
import type { BeamContext } from "./types";

export type BuildContextOptions = {
  /** Optional overrides from the request URL, for a shareable answer link. */
  formatParam?: string;
  sourceParam?: string;
  /** Already-loaded settings, so one request never reads that row twice. */
  settings?: BeamSettings;
};

export async function buildBeamContext(
  supabase: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  options: BuildContextOptions = {},
): Promise<BeamContext> {
  // Settings can be handed in. The ask route has to read them BEFORE it can
  // enforce the admin-configured rate limits, and reading them twice for one
  // request would be paying for the same single row on the same request.
  // One wave. Every one of these is either request-cached (formats, sources) or
  // memoised in-process (the clock), so a second BEAM question in the same
  // session pays for almost none of it again.
  const [formatResolution, sourceResolution, registry, activeFormats, clock, settings] =
    await Promise.all([
      resolveFormatSlug(supabase, options.formatParam),
      resolveSourceSlug(supabase, options.sourceParam),
      getAvailableSources(supabase),
      getActiveFormats(supabase),
      resolveBeamClock(supabase),
      options.settings ? Promise.resolve(options.settings) : loadBeamSettings(admin),
    ]);

  const formatConfig =
    activeFormats.find((f) => f.slug === formatResolution.slug) ?? activeFormats[0] ?? null;

  const formatSlug = formatConfig?.slug ?? formatResolution.slug;
  const formatDisplay = formatConfig?.display_name ?? formatSlug;

  const valueResolution = formatConfig
    ? resolveSourceForFormat(
        registry,
        "player_value_history",
        formatConfig.slug,
        sourceResolution.slug,
      )
    : { source: null, requested: sourceResolution.slug, fellBack: false, availableForFormat: [] };

  const sourceSlug = valueResolution.source;

  return {
    supabase,
    admin,
    formatSlug,
    formatConfigId: formatConfig?.id ?? null,
    formatDisplay,
    scoringKey: scoringKeyForType(formatConfig?.scoring_type),
    isDynasty: formatConfig?.league_type === "dynasty",
    isSuperflex: Boolean(formatConfig?.is_superflex),
    sourceSlug,
    sourceDisplay: sourceSlug ? describeSource(registry, sourceSlug) : null,
    clock,
    settings,
  };
}
