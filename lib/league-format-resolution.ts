import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { deriveLeagueFormat, mapToFormatSlug, type DerivedFormat } from "@/lib/sleeper-to-format";
import type { FormatLike } from "@/lib/format-fallback";
import {
  getActiveFormats,
  getAvailableSources,
  sourceSupportsFormat,
  type SourceRegistryRow,
} from "@/lib/source";

/**
 * League-contextual format resolution.
 *
 * Inside a league view, format selection works DIFFERENTLY than the rest of
 * the site: the format used for player values is derived from the actual
 * Sleeper league settings (scoring_settings + roster_positions +
 * settings.type), not from the user's global format toggle. Source is still
 * user-controlled.
 *
 * Why: every league has fixed real-world scoring rules. Showing a Redraft
 * Half-PPR value for a player whose owner plays in a Dynasty Superflex
 * league produces a number that's flat-out wrong for trade decisions.
 *
 * Resolution chain (each step strictly tighter than the next):
 *   1. Derive ideal format from Sleeper league settings (deriveLeagueFormat)
 *   2. If the user's chosen source supports the ideal format → use it
 *   3. Otherwise, fall back via pickLeagueTypeSafeFormat() to the source's
 *      closest supported format WITHIN THE SAME league_type (dynasty vs
 *      redraft is a hard wall, never cross it), then same scoring_type,
 *      then same is_superflex, then lowest display_order
 *   4. If the source supports nothing in the league's own league_type,
 *      return `coverage: 'none'` and the UI renders an empty state. We
 *      deliberately do NOT cross to the other league_type: a redraft value
 *      is meaningless for a dynasty roster and vice versa.
 *
 * Draft pick values are a separate axis. FantasyCalc doesn't publish them,
 * so we ALWAYS look them up via the highest-priority source whose
 * source_registry.data_type contains 'draft_pick_values'. In practice this
 * is KTC. When the player-value source is FantasyCalc, the UI surfaces a
 * "Draft pick values powered by KTC" footnote.
 *
 * This module is the single source of truth for "what format slug should
 * back values inside this league view". Pages, OG image routes, and the
 * trade analyzer all call resolveLeagueContext() and pass the result down.
 */

import type { SleeperLeague } from "@/lib/sleeper";

export type LeagueContext = {
  /** The format slug that should back player-value lookups. Always set
   * unless coverage === 'none'. */
  formatSlug: string;
  /** The format display_name to show to users on the league header. */
  formatDisplay: string;
  /** The format_config_id (uuid) for SQL joins. */
  formatConfigId: string;
  /** The source slug used for player values. */
  sourceSlug: string;
  /** The source display_name to show to users. */
  sourceDisplay: string;
  /** Coverage tells the UI whether the user got an exact format match. */
  coverage: "exact" | "fallback" | "none";
  /** Populated when coverage === 'fallback'. Drives the explanatory banner. */
  fallback: {
    /** The format slug that was derived from Sleeper league settings. */
    derivedSlug: string;
    /** Display name of the derived (unavailable) format. */
    derivedDisplay: string;
  } | null;
  /** The Sleeper-derived structural format. Useful when we want to render
   * format tags ("Dynasty • Superflex • TEP") that describe the LEAGUE's
   * actual rules, not whatever format we ended up resolving to. */
  derived: DerivedFormat;
  /** When the selected source doesn't publish draft pick values, this is
   * the source we use for picks (always KTC today). Null when the chosen
   * source already publishes picks. UI uses this to render the "Draft
   * pick values powered by {name}" footnote. */
  pickSource: { slug: string; display: string } | null;
};

export type LeagueContextEmpty = {
  formatSlug: null;
  formatConfigId: null;
  sourceSlug: string;
  sourceDisplay: string;
  coverage: "none";
  derived: DerivedFormat;
};

type ServiceClient =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/**
 * Resolve the (format, source) context for a league view.
 *
 * @param supabase     Any supabase client (server or admin both work).
 * @param league       The Sleeper league object (from getSleeperLeague or
 *                     leagues.metadata jsonb).
 * @param sourceSlug   The user's currently-selected source slug. When null
 *                     we fall through to the registry's first-priority
 *                     source that publishes player values.
 */
export async function resolveLeagueContext(
  supabase: ServiceClient,
  league: SleeperLeague,
  sourceSlug: string | null,
): Promise<LeagueContext | LeagueContextEmpty> {
  const [registry, allFormats] = await Promise.all([
    getAvailableSources(supabase as SupabaseClient<Database>),
    getActiveFormats(supabase as SupabaseClient<Database>),
  ]);

  const derived = deriveLeagueFormat(league);
  const idealSlug = mapToFormatSlug(derived);

  const resolvedSource = pickSourceForLeagueValues(registry, sourceSlug);
  const pickSource = pickSourceForDraftPicks(registry);

  if (!resolvedSource) {
    return {
      formatSlug: null,
      formatConfigId: null,
      sourceSlug: sourceSlug ?? "",
      sourceDisplay: sourceSlug ?? "",
      coverage: "none",
      derived,
    };
  }

  // No mapping at all. Sleeper league doesn't fit any of our active formats
  // (e.g. half-ppr dynasty). Try to give the user *something* coherent, but
  // stay inside the league's own league_type: a dynasty league must fall to a
  // dynasty format, never a redraft one.
  if (!idealSlug) {
    const fallbackFormat = pickLeagueTypeSafeFormat(
      allFormats,
      derived,
      resolvedSource.supported_format_slugs,
    );
    if (!fallbackFormat) {
      return {
        formatSlug: null,
        formatConfigId: null,
        sourceSlug: resolvedSource.slug,
        sourceDisplay: resolvedSource.display_name,
        coverage: "none",
        derived,
      };
    }
    const fc = await loadFormatConfigId(supabase, fallbackFormat.slug);
    if (!fc) {
      return {
        formatSlug: null,
        formatConfigId: null,
        sourceSlug: resolvedSource.slug,
        sourceDisplay: resolvedSource.display_name,
        coverage: "none",
        derived,
      };
    }
    return {
      formatSlug: fallbackFormat.slug,
      formatDisplay: fallbackFormat.display_name,
      formatConfigId: fc,
      sourceSlug: resolvedSource.slug,
      sourceDisplay: resolvedSource.display_name,
      coverage: "fallback",
      fallback: {
        derivedSlug: "(unmapped)",
        derivedDisplay: describeDerived(derived),
      },
      derived,
      pickSource: pickSource && pickSource.slug !== resolvedSource.slug
        ? { slug: pickSource.slug, display: pickSource.display_name }
        : null,
    };
  }

  // Ideal format exists. Does the source carry it?
  if (sourceSupportsFormat(resolvedSource, idealSlug)) {
    const ideal = allFormats.find((f) => f.slug === idealSlug);
    if (!ideal) {
      return {
        formatSlug: null,
        formatConfigId: null,
        sourceSlug: resolvedSource.slug,
        sourceDisplay: resolvedSource.display_name,
        coverage: "none",
        derived,
      };
    }
    const fc = await loadFormatConfigId(supabase, idealSlug);
    if (!fc) {
      return {
        formatSlug: null,
        formatConfigId: null,
        sourceSlug: resolvedSource.slug,
        sourceDisplay: resolvedSource.display_name,
        coverage: "none",
        derived,
      };
    }
    return {
      formatSlug: idealSlug,
      formatDisplay: ideal.display_name,
      formatConfigId: fc,
      sourceSlug: resolvedSource.slug,
      sourceDisplay: resolvedSource.display_name,
      coverage: "exact",
      fallback: null,
      derived,
      pickSource: pickSource && pickSource.slug !== resolvedSource.slug
        ? { slug: pickSource.slug, display: pickSource.display_name }
        : null,
    };
  }

  // Source doesn't carry the ideal format → fall through to the closest it
  // does support, locked to the league's own league_type (dynasty stays
  // dynasty, redraft stays redraft).
  const replacement = pickLeagueTypeSafeFormat(
    allFormats,
    derived,
    resolvedSource.supported_format_slugs,
  );
  if (!replacement) {
    return {
      formatSlug: null,
      formatConfigId: null,
      sourceSlug: resolvedSource.slug,
      sourceDisplay: resolvedSource.display_name,
      coverage: "none",
      derived,
    };
  }
  const idealRow = allFormats.find((f) => f.slug === idealSlug);
  const fc = await loadFormatConfigId(supabase, replacement.slug);
  if (!fc) {
    return {
      formatSlug: null,
      formatConfigId: null,
      sourceSlug: resolvedSource.slug,
      sourceDisplay: resolvedSource.display_name,
      coverage: "none",
      derived,
    };
  }
  return {
    formatSlug: replacement.slug,
    formatDisplay: replacement.display_name,
    formatConfigId: fc,
    sourceSlug: resolvedSource.slug,
    sourceDisplay: resolvedSource.display_name,
    coverage: "fallback",
    fallback: {
      derivedSlug: idealSlug,
      derivedDisplay: idealRow?.display_name ?? idealSlug,
    },
    derived,
    pickSource: pickSource && pickSource.slug !== resolvedSource.slug
      ? { slug: pickSource.slug, display: pickSource.display_name }
      : null,
  };
}

/** Choose the player-value source. Honors the user's request if active;
 * otherwise picks the first-priority active source that publishes rankings. */
function pickSourceForLeagueValues(
  registry: SourceRegistryRow[],
  requestedSlug: string | null,
): SourceRegistryRow | null {
  if (requestedSlug) {
    const hit = registry.find(
      (r) => r.slug === requestedSlug && r.data_type.includes("rankings"),
    );
    if (hit) return hit;
  }
  return registry.find((r) => r.data_type.includes("rankings")) ?? null;
}

/** Pick the source we use for draft pick values. By contract this is the
 * highest-priority source whose data_type includes 'draft_pick_values'.
 * Today the only such source is KTC. */
export function pickSourceForDraftPicks(
  registry: SourceRegistryRow[],
): SourceRegistryRow | null {
  return registry.find((r) => r.data_type.includes("draft_pick_values")) ?? null;
}

/**
 * Pick the closest format a source supports for a league, with league_type
 * (dynasty vs redraft) as a HARD constraint. This is the league-view-specific
 * sibling of pickFallbackFormat: inside a league view, a redraft value must
 * never back a dynasty roster (or vice versa), so we refuse to cross that line
 * even when it would leave us with nothing.
 *
 * Within the league's own league_type the preference chain is the usual one:
 * same scoring_type → same is_superflex → lowest display_order. Returns null
 * (→ coverage 'none') when the source publishes no format in this league_type.
 */
function pickLeagueTypeSafeFormat(
  allFormats: FormatLike[],
  derived: DerivedFormat,
  supportedSlugs: string[] | null,
): FormatLike | null {
  const eligible =
    supportedSlugs === null
      ? allFormats
      : allFormats.filter((f) => supportedSlugs.includes(f.slug));

  // HARD wall: only formats in the league's own league_type are candidates.
  const sameLeague = eligible.filter(
    (f) => f.league_type === derived.league_type,
  );
  if (sameLeague.length === 0) return null;

  const sameScoring = sameLeague.filter(
    (f) => f.scoring_type === derived.scoring_type,
  );
  const scoringPool = sameScoring.length > 0 ? sameScoring : sameLeague;

  const sameSflex = scoringPool.filter(
    (f) => f.is_superflex === derived.is_superflex,
  );
  const sflexPool = sameSflex.length > 0 ? sameSflex : scoringPool;

  return [...sflexPool].sort(byDisplayOrder)[0] ?? null;
}

function byDisplayOrder(a: FormatLike, b: FormatLike): number {
  const ao = a.display_order ?? Number.MAX_SAFE_INTEGER;
  const bo = b.display_order ?? Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  return a.slug.localeCompare(b.slug);
}

async function loadFormatConfigId(
  supabase: ServiceClient,
  slug: string,
): Promise<string | null> {
  const { data } = await (supabase as SupabaseClient<Database>)
    .from("format_configs")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  return data?.id ?? null;
}

/** Human-readable description of the league's structural format. Used in
 * fallback banners ("we don't have FantasyCalc values for Dynasty TEP
 * Superflex"). Does NOT use the format slug; describes what the league
 * actually looks like in plain language. */
export function describeDerived(d: DerivedFormat): string {
  const parts: string[] = [];
  parts.push(d.league_type === "dynasty" ? "Dynasty" : "Redraft");
  if (d.scoring_type === "ppr") parts.push("PPR");
  else if (d.scoring_type === "half_ppr") parts.push("Half PPR");
  else parts.push("Standard");
  if (d.is_superflex) parts.push("Superflex");
  if (d.is_tep) parts.push("TEP");
  return parts.join(" ");
}

