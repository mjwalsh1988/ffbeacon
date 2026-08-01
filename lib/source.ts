import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { pickFallbackFormat, type FormatLike } from "@/lib/format-fallback";

const VALID_SOURCE_SLUG = /^[a-z0-9-]+$/;

export function readSourceSlug(
  input: string | string[] | undefined,
): string | null {
  const candidate = Array.isArray(input) ? input[0] : input;
  if (!candidate || candidate.length > 64 || !VALID_SOURCE_SLUG.test(candidate)) {
    return null;
  }
  return candidate;
}

export type SourceRegistryRow = {
  slug: string;
  display_name: string;
  description: string | null;
  priority: number;
  is_default: boolean;
  data_type: string[];
  supported_format_slugs: string[] | null;
  update_cadence: string;
};

// React.cache makes this a request-scoped memo: every server-side caller in
// the same render pass shares one Promise (one network round-trip). SiteHeader
// in the layout and the active page route both call this; without the cache
// they'd each issue their own SELECT against source_registry.
export const getAvailableSources = cache(
  async (supabase: SupabaseClient<Database>): Promise<SourceRegistryRow[]> => {
    const { data } = await supabase
      .from("source_registry")
      .select("slug, display_name, description, priority, is_default, data_type, supported_format_slugs, update_cadence")
      .eq("is_active", true)
      .order("priority");
    return data ?? [];
  },
);

// Same request-scoped memo for format_configs. format_configs has 8 rows and
// never changes during a single request, but SiteHeader + every page touch it.
// We pull a richer row shape than FormatLike alone so SiteHeader (which needs
// id and is_default) can reuse the same cached fetch.
export type ActiveFormatRow = FormatLike & {
  id: string;
  is_default: boolean;
  te_premium_bonus: number | null;
};

export const getActiveFormats = cache(
  async (supabase: SupabaseClient<Database>): Promise<ActiveFormatRow[]> => {
    const { data } = await supabase
      .from("format_configs")
      .select(
        "id, slug, display_name, is_default, league_type, scoring_type, is_superflex, display_order, te_premium_bonus",
      )
      .eq("is_active", true)
      .order("display_order");
    return data ?? [];
  },
);

// A source supports a format when its supported_format_slugs contains the
// slug, OR supported_format_slugs is null (the "supports everything" default).
// Empty array means the source supports nothing.
export function sourceSupportsFormat(
  source: Pick<SourceRegistryRow, "supported_format_slugs">,
  formatSlug: string,
): boolean {
  const list = source.supported_format_slugs;
  if (list === null) return true;
  return list.includes(formatSlug);
}

// The site-wide default source: the active source flagged is_default in
// source_registry, falling back to the first by display order (priority) if no
// flag is set. This is the DB-backed replacement for the old hardcoded
// DEFAULT_SOURCE_SLUG constant. A logged-in user's saved preference is resolved
// earlier in the chain (see lib/preferences.ts), so this only governs anonymous
// visitors and logged-in users with no saved source preference.
export function pickDefaultSource(sources: SourceRegistryRow[]): string | null {
  return sources.find((s) => s.is_default)?.slug ?? sources[0]?.slug ?? null;
}

export async function getDefaultSourceSlug(
  supabase: SupabaseClient<Database>,
): Promise<string | null> {
  const sources = await getAvailableSources(supabase);
  return pickDefaultSource(sources);
}

export type ResolvedSource = {
  source: string | null;
  requested: string | null;
  fellBack: boolean;
  availableForFormat: string[];
};

// Pick the source that should back a (table, format) query.
//
// This used to issue one COUNT() per source × per table to discover row
// presence (~2N COUNTs per /rankings render). With supported_format_slugs
// the registry already declares what each source covers, so we can decide
// purely in-memory. data_type still filters out sources that don't publish
// the table at all.
//
// requestedSlug is honored when the requesting source supports the format.
// With no valid request we pick the site-wide default source when it supports
// the format, otherwise the first supporting source in display order (priority).
// If nothing covers the (table, format) combo, returns null and the caller
// renders the empty state.
export function resolveSourceForFormat(
  registry: SourceRegistryRow[],
  table: "rankings" | "player_value_history",
  formatSlug: string,
  requestedSlug: string | null,
): ResolvedSource {
  const availableForFormat: string[] = [];
  let defaultSlug: string | null = null;
  for (const r of registry) {
    if (!r.data_type.includes(table)) continue;
    if (!sourceSupportsFormat(r, formatSlug)) continue;
    availableForFormat.push(r.slug);
    if (r.is_default) defaultSlug = r.slug;
  }

  if (availableForFormat.length === 0) {
    return { source: null, requested: requestedSlug, fellBack: false, availableForFormat };
  }

  if (requestedSlug && availableForFormat.includes(requestedSlug)) {
    return { source: requestedSlug, requested: requestedSlug, fellBack: false, availableForFormat };
  }

  // No valid request: prefer the default source (if it covers this format),
  // else the first supporting source in display order.
  return {
    source: defaultSlug ?? availableForFormat[0],
    requested: requestedSlug,
    fellBack: !!requestedSlug,
    availableForFormat,
  };
}

export function describeSource(
  registry: SourceRegistryRow[],
  slug: string | null,
): string {
  if (!slug) return "this source";
  return registry.find((r) => r.slug === slug)?.display_name ?? slug;
}

// Validate that the resolved (sourceSlug, formatSlug) pair is internally
// consistent against source_registry.supported_format_slugs. When it isn't,
// pick a fallback format using pickFallbackFormat and return enough info for
// the caller to render a one-line banner.
//
// This is a *pure* declarative check against the registry. It does not touch
// cookies or the DB, pages that call this should NOT persist the fallback,
// because that's the URL-arrival / stale-cookie case where we just want to
// give the user something coherent to look at on this request.

export type ReconciledFormat = {
  formatSlug: string;
  fallback: {
    fromSlug: string;
    fromName: string;
    toSlug: string;
    toName: string;
    sourceName: string;
  } | null;
};

export function reconcileFormatWithSource(
  registry: SourceRegistryRow[],
  allFormats: FormatLike[],
  sourceSlug: string | null,
  formatSlug: string,
): ReconciledFormat {
  if (!sourceSlug) return { formatSlug, fallback: null };
  const source = registry.find((r) => r.slug === sourceSlug);
  if (!source) return { formatSlug, fallback: null };
  if (sourceSupportsFormat(source, formatSlug)) {
    return { formatSlug, fallback: null };
  }
  const replacement = pickFallbackFormat(
    allFormats,
    formatSlug,
    source.supported_format_slugs,
  );
  if (!replacement) return { formatSlug, fallback: null };
  const requested = allFormats.find((f) => f.slug === formatSlug);
  return {
    formatSlug: replacement.slug,
    fallback: {
      fromSlug: formatSlug,
      fromName: requested?.display_name ?? formatSlug,
      toSlug: replacement.slug,
      toName: replacement.display_name,
      sourceName: source.display_name,
    },
  };
}
