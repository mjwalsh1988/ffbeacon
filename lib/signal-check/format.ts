/**
 * Format + source resolution for Signal Check.
 *
 * V1 uses FF Beacon Values only (source slug "ffbeacon"). The supported manual
 * format list is the intersection of: FF Beacon's supported_format_slugs
 * (source_registry), active format_configs, and the admin disabled list. Picks
 * are dynasty-only: allowsPicks is derived purely from format_configs.league_type.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ResolvedFormat, SignalCheckSettings } from "./types";

type Client = SupabaseClient<Database>;

export const FFBEACON_SOURCE_SLUG = "ffbeacon";
export const FFBEACON_SOURCE_DISPLAY = "FF Beacon";
/** Pick-value fallback when FF Beacon lacks pick rows for a dynasty format. */
export const PICK_FALLBACK_SOURCE_SLUG = "ktc";
export const PICK_FALLBACK_SOURCE_DISPLAY = "KTC";

export interface SupportedFormatOption {
  slug: string;
  display: string;
  leagueType: string;
  allowsPicks: boolean;
  displayOrder: number | null;
}

/**
 * Resolve a single format slug to a ResolvedFormat. Returns null when the slug
 * is unknown, inactive, or not supported by FF Beacon Values.
 */
export async function resolveFormat(
  supabase: Client,
  slug: string,
): Promise<ResolvedFormat | null> {
  const { data: fc } = await supabase
    .from("format_configs")
    .select("id, slug, display_name, league_type, is_active")
    .eq("slug", slug)
    .maybeSingle();
  if (!fc || !fc.is_active) return null;

  const supported = await ffbeaconSupportedSlugs(supabase);
  if (supported && !supported.includes(fc.slug)) return null;

  return {
    slug: fc.slug,
    display: fc.display_name,
    configId: fc.id,
    leagueType: fc.league_type,
    allowsPicks: fc.league_type === "dynasty",
  };
}

/** FF Beacon's supported_format_slugs (null means "all formats"). */
async function ffbeaconSupportedSlugs(supabase: Client): Promise<string[] | null> {
  const { data } = await supabase
    .from("source_registry")
    .select("supported_format_slugs")
    .eq("slug", FFBEACON_SOURCE_SLUG)
    .maybeSingle();
  return (data?.supported_format_slugs as string[] | null) ?? null;
}

/**
 * The list of formats a user may pick in the manual builder: FF Beacon
 * supported, active, and not admin-disabled. Ordered by display_order.
 */
export async function supportedFormats(
  supabase: Client,
  settings: SignalCheckSettings,
): Promise<SupportedFormatOption[]> {
  const supported = await ffbeaconSupportedSlugs(supabase);
  const { data } = await supabase
    .from("format_configs")
    .select("slug, display_name, league_type, is_active, display_order")
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  const disabled = new Set(settings.disabledFormatSlugs);
  return (data ?? [])
    .filter((fc) => (supported ? supported.includes(fc.slug) : true))
    .filter((fc) => !disabled.has(fc.slug))
    .map((fc) => ({
      slug: fc.slug,
      display: fc.display_name,
      leagueType: fc.league_type,
      allowsPicks: fc.league_type === "dynasty",
      displayOrder: fc.display_order,
    }));
}
