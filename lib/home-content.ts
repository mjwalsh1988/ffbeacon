import { unstable_cache } from "next/cache";
import { createCachedReadClient } from "@/lib/supabase/server";
import {
  loadLatestBrief,
  loadRecentRelays,
  type LatestBrief,
  type RelayCardData,
} from "@/lib/relays/load";

/**
 * Cached read of the home page's public content reads (#1 performance).
 *
 * The home page stays dynamic (the member-aware hero reads auth and a live
 * Discord call), but these reads are public and change at most every few
 * minutes, so there is no reason to run them on every visit. unstable_cache
 * forbids cookies()/headers(), so this reads through the cookie-less anon
 * client (createCachedReadClient); every table is RLS-public.
 *
 * The Brief block reads the latest published edition and the four newest
 * Relays (docs/beacon-brief/relays-and-briefs-plan.md, section 6.5).
 *
 * Invalidation: approving an edition calls revalidateTag("home") (see
 * lib/brief-desk/publish.ts), so a fresh Brief shows up immediately rather
 * than waiting out the TTL. The five minute revalidate is the time-based
 * backstop for the Relays, format_configs and source_registry.
 */

/** Two rows of three on a wide screen. */
const HOMEPAGE_RELAY_COUNT = 6;

export type HomeFormatRow = {
  slug: string;
  display_name: string;
  league_type: string;
  scoring_type: string;
  is_superflex: boolean;
  te_premium_bonus: number;
};

export type HomeSourceRow = {
  slug: string;
  display_name: string;
  description: string | null;
  data_type: string[];
  update_cadence: string;
  supported_format_slugs: string[] | null;
  is_default: boolean;
};

export type HomeContent = {
  latestBrief: LatestBrief | null;
  relays: RelayCardData[];
  formats: HomeFormatRow[];
  sources: HomeSourceRow[];
};

async function fetchHomeContent(): Promise<HomeContent> {
  const supabase = createCachedReadClient();

  const [latestBrief, relays, { data: formats }, { data: sources }] =
    await Promise.all([
      loadLatestBrief(supabase),
      loadRecentRelays(supabase, HOMEPAGE_RELAY_COUNT),
      supabase
        .from("format_configs")
        .select("slug, display_name, league_type, scoring_type, is_superflex, te_premium_bonus")
        .eq("is_active", true)
        .order("display_order"),
      supabase
        .from("source_registry")
        .select(
          "slug, display_name, description, data_type, update_cadence, supported_format_slugs, is_default",
        )
        .eq("is_active", true)
        .order("priority"),
    ]);

  return {
    latestBrief,
    relays,
    formats: formats ?? [],
    sources: sources ?? [],
  };
}

/** Cached wrapper. Re-created on every call, same as the player-profile-cache
 *  loaders: unstable_cache keys on the array passed as its second argument,
 *  not on the wrapper's identity, so this is cheap and correct to call from
 *  every render. */
export function loadHomeContent(): Promise<HomeContent> {
  return unstable_cache(fetchHomeContent, ["home-content-v2"], {
    revalidate: 300,
    tags: ["home"],
  })();
}
