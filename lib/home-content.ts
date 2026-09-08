import { unstable_cache } from "next/cache";
import { createCachedReadClient } from "@/lib/supabase/server";

/**
 * Cached read of the home page's three public content reads (#1 performance).
 *
 * The home page stays dynamic (the member-aware hero reads auth and a live
 * Discord call), but these three reads are public and change at most every
 * few minutes, so there is no reason to run them on every visit. unstable_cache
 * forbids cookies()/headers(), so this reads through the cookie-less anon
 * client (createCachedReadClient); all three tables are RLS-public.
 *
 * Invalidation: the Beacon Brief worker calls revalidateTag("home") on the
 * success path when it publishes an article (see lib/beacon-brief/worker.ts),
 * so a fresh headline shows up immediately rather than waiting out the TTL.
 * The five minute revalidate is the time-based backstop for everything else
 * (format_configs, source_registry, and a missed or disabled worker run).
 */

const HOMEPAGE_ARTICLE_COUNT = 25;

export type HomeArticleRow = {
  slug: string;
  title: string;
  tl_dr: string | null;
  article_type: string;
  published_at: string | null;
};

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
  articles: HomeArticleRow[];
  formats: HomeFormatRow[];
  sources: HomeSourceRow[];
};

async function fetchHomeContent(): Promise<HomeContent> {
  const supabase = createCachedReadClient();

  const [{ data: articles }, { data: formats }, { data: sources }] =
    await Promise.all([
      // 25, not 4. The homepage is the strongest internal link source on the site,
      // and it used to pass link equity to only 4 articles while the other ~106 sat
      // behind pagination. The section below features the newest 4 as cards and lists
      // the rest as headlines, so ~25 articles are one click from the homepage
      // without the section turning into a wall.
      supabase
        .from("articles")
        .select("slug, title, tl_dr, article_type, published_at")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(HOMEPAGE_ARTICLE_COUNT),
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
    articles: articles ?? [],
    formats: formats ?? [],
    sources: sources ?? [],
  };
}

/** Cached wrapper. Re-created on every call, same as the player-profile-cache
 *  loaders: unstable_cache keys on the array passed as its second argument,
 *  not on the wrapper's identity, so this is cheap and correct to call from
 *  every render. */
export function loadHomeContent(): Promise<HomeContent> {
  return unstable_cache(fetchHomeContent, ["home-content"], {
    revalidate: 300,
    tags: ["home"],
  })();
}
