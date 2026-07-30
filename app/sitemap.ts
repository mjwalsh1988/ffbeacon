import type { MetadataRoute } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";

/**
 * sitemap.xml for ffbeacon.com.
 *
 * Revalidated hourly so newly published articles and profiles appear without a
 * redeploy.
 *
 * TWO RULES SHAPE THIS FILE.
 *
 * 1. Every URL listed must be a real page that returns 200 and is indexable. A
 *    sitemap containing a noindex page, a placeholder, or a URL with no route
 *    tells Google the whole file is unreliable, and it stops trusting the rest.
 *    The previous version listed /players, which has no route folder at all: it
 *    fell through to app/[handle] and served "Profile not found" with
 *    noindex, nofollow. It also listed /guides, which has no guides yet, and two
 *    categories with zero published articles.
 *
 * 2. lastModified must be true or absent. It was previously `new Date()` for every
 *    static path and every category, so 20 URLs claimed to change every hour that
 *    the sitemap revalidated, forever. Google's documented response to lastmod it
 *    finds unreliable is to ignore lastmod for the whole site, which throws away
 *    the one signal that tells it which of several hundred URLs to recrawl. So a
 *    lastModified here is either derived from real data or omitted.
 *
 * changeFrequency is gone. Google ignores it, and an accurate lastModified says the
 * same thing with evidence behind it. priority stays: it costs nothing and some
 * non-Google crawlers still read it.
 */

export const revalidate = 3600;

/**
 * Supabase caps an unbounded select() at 1000 rows and does it silently, so any
 * query here that can exceed that has to page explicitly. `rankings` is well past
 * it (about 11k rows across the relevance window).
 */
const DB_PAGE_SIZE = 1000;

/**
 * Matches RELEVANCE_WINDOW_DAYS in lib/player-search.ts on purpose. "Currently
 * fantasy relevant" has exactly one definition in this codebase, membership in
 * `rankings` within this window, and the sitemap uses the same one the player
 * autocomplete does rather than inventing a second.
 */
const PLAYER_RELEVANCE_WINDOW_DAYS = 90;

/**
 * Core public pages.
 *
 * lastModified is deliberately absent for most of these: they change when we ship
 * code, not on a schedule we can read from the database, and a guess would poison
 * the signal for every other URL. `/`, `/brief`, and `/rankings` get real values
 * further down because their content genuinely is data-driven.
 *
 * DELIBERATELY NOT LISTED, and why:
 *   /players            No route folder exists (only /players/[slug]). The path
 *                       falls through to app/[handle] and returns a noindex
 *                       "Profile not found" page.
 *   /guides             Placeholder. Every card on it reads "Coming soon".
 *   /join               Sets robots index:false (it is a Discord hand-off page).
 *   /login /my-beacon   Disallowed in robots.ts; account surfaces.
 *   /admin /api /auth   Disallowed in robots.ts.
 *   /leagues/**         Per-user league data, unbounded in count, and not the kind
 *                       of page that should be advertised for indexing.
 *   /tools/signal-check/v/[shareId]   User-generated share artifacts.
 *   /brief/player/[slug]              Sets robots noindex.
 *   /[handle]/rankings/[boardId]      Sets robots index:false.
 *   /brief/tag/[tag]                  Hundreds of thin filter pages. They stay
 *                       crawlable through in-page links, but advertising them
 *                       would spend crawl budget that belongs to articles and
 *                       player profiles.
 */
const STATIC_PATHS: Array<{ path: string; priority: number }> = [
  { path: "/tools", priority: 0.7 },
  { path: "/tools/beacon-breakdown", priority: 0.6 },
  { path: "/tools/league-pulse", priority: 0.6 },
  { path: "/tools/faab", priority: 0.6 },
  { path: "/tools/on-the-clock", priority: 0.6 },
  { path: "/tools/signal-check", priority: 0.6 },
  { path: "/games", priority: 0.4 },
  { path: "/games/signal-scout", priority: 0.4 },
  { path: "/about", priority: 0.4 },
  { path: "/author/michael", priority: 0.4 },
  { path: "/privacy", priority: 0.2 },
  { path: "/terms", priority: 0.2 },
];

/** Newest of a set of timestamps, or undefined when there is nothing to go on. */
function newest(
  values: Array<string | null | undefined>,
): Date | undefined {
  let best: number | null = null;
  for (const v of values) {
    if (!v) continue;
    const t = new Date(v).getTime();
    if (Number.isNaN(t)) continue;
    if (best === null || t > best) best = t;
  }
  return best === null ? undefined : new Date(best);
}

/**
 * Slugs of every player appearing in `rankings` inside the relevance window.
 *
 * Paged, because `rankings` is well past the 1000-row default and Supabase truncates
 * silently rather than erroring.
 *
 * The slug comes back on the embedded `players` row instead of from a second query
 * keyed by id. Collecting ~800 ids and then filtering `players` with .in() builds a
 * roughly 30KB query string, which PostgREST rejects outright with "Bad Request", so
 * that shape looked correct and returned zero player URLs. The inner join keeps
 * everything in the one paged scan and the URL constant-length.
 */
async function rankedPlayerSlugs(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<string[]> {
  const cutoff = new Date(
    Date.now() - PLAYER_RELEVANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const slugs = new Set<string>();
  for (let from = 0; ; from += DB_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("rankings")
      .select("player_id, players!inner(slug)")
      .gte("generated_at", cutoff)
      .range(from, from + DB_PAGE_SIZE - 1);
    if (error) {
      console.error("[sitemap] ranked player page failed", error);
      break;
    }
    for (const row of data ?? []) {
      // PostgREST returns a to-one embed as an object or a single-element array
      // depending on inferred cardinality. Normalize both.
      const embed = (row as { players?: unknown }).players;
      const player = Array.isArray(embed) ? embed[0] : embed;
      const slug = (player as { slug?: string | null } | null)?.slug;
      if (slug) slugs.add(slug);
    }
    if (!data || data.length < DB_PAGE_SIZE) break;
  }
  return [...slugs];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = createAdminClient();

  const [
    { data: profiles },
    { data: articles },
    { data: categories },
    { data: articleTeams },
    { data: teams },
    { data: rankingFormats },
    { data: latestRanking },
  ] = await Promise.all([
    // Only live Signal profiles (published + public + not hidden) are indexable.
    // Drafts and private profiles are excluded by contract.
    supabase
      .from("signals")
      .select("handle, updated_at")
      .eq("status", "published")
      .eq("visibility", "public")
      .eq("hidden", false)
      .order("updated_at", { ascending: false })
      .limit(5000),
    supabase
      .from("articles")
      .select("id, slug, last_updated, published_at, category_id")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(5000),
    supabase.from("news_categories").select("id, slug").eq("is_active", true),
    supabase.from("article_teams").select("article_id, team_id"),
    supabase.from("nfl_teams").select("id, abbreviation"),
    supabase
      .from("format_configs")
      .select("slug")
      .eq("is_active", true)
      .order("display_order"),
    // One timestamp for the whole ranked set. Values are regenerated in batches, so
    // the newest generated_at is when a player profile's numbers last moved.
    supabase
      .from("rankings")
      .select("generated_at")
      .order("generated_at", { ascending: false })
      .limit(1),
  ]);

  const publishedArticles = articles ?? [];
  const articleChangedAt = (a: {
    last_updated: string | null;
    published_at: string | null;
  }) => newest([a.last_updated, a.published_at]);

  const newestArticleAt = newest(
    publishedArticles.flatMap((a) => [a.last_updated, a.published_at]),
  );
  const rankingsUpdatedAt = newest([latestRanking?.[0]?.generated_at]);

  const entries: MetadataRoute.Sitemap = [
    // The homepage surfaces the latest Beacon Brief coverage, so the newest
    // article's timestamp is a real answer for when it last changed.
    { url: `${SITE.url}/`, lastModified: newestArticleAt, priority: 1 },
    {
      url: `${SITE.url}/rankings`,
      lastModified: rankingsUpdatedAt,
      priority: 0.9,
    },
    {
      url: `${SITE.url}/brief`,
      lastModified: newestArticleAt,
      priority: 0.7,
    },
    ...STATIC_PATHS.map(({ path, priority }) => ({
      url: `${SITE.url}${path}`,
      priority,
    })),
  ];

  // Per-format rankings pages. Each one has its own h1, title, and meta description
  // (see lib/rankings-formats.ts), which is what makes them distinct pages rather than
  // the near-duplicate `?format=` views they replaced. They share the rankings batch
  // timestamp because they are all rebuilt from the same nightly data.
  for (const format of rankingFormats ?? []) {
    entries.push({
      url: `${SITE.url}/rankings/${format.slug}`,
      lastModified: rankingsUpdatedAt,
      priority: 0.8,
    });
  }

  for (const profile of profiles ?? []) {
    entries.push({
      url: `${SITE.url}/${profile.handle}`,
      lastModified: newest([profile.updated_at]),
      priority: 0.6,
    });
  }

  for (const article of publishedArticles) {
    entries.push({
      url: `${SITE.url}/brief/${article.slug}`,
      lastModified: articleChangedAt(article),
      priority: 0.6,
    });
  }

  // Category filter pages, but only the ones that lead somewhere. A category with
  // no published articles renders "Nothing here yet", which is not a page worth
  // asking Google to index.
  const articlesByCategory = new Map<
    string,
    Array<(typeof publishedArticles)[number]>
  >();
  for (const a of publishedArticles) {
    if (!a.category_id) continue;
    const list = articlesByCategory.get(a.category_id) ?? [];
    list.push(a);
    articlesByCategory.set(a.category_id, list);
  }
  for (const category of categories ?? []) {
    const inCategory = articlesByCategory.get(category.id);
    if (!inCategory || inCategory.length === 0) continue;
    entries.push({
      url: `${SITE.url}/brief/category/${category.slug}`,
      lastModified: newest(
        inCategory.flatMap((a) => [a.last_updated, a.published_at]),
      ),
      priority: 0.5,
    });
  }

  // Team filter pages, same rule: only teams we have actually covered. These are
  // real editorial collections ("everything on the Bills"), unlike tag pages, and
  // they are bounded at 32.
  const publishedIds = new Set(publishedArticles.map((a) => a.id));
  const articleById = new Map(publishedArticles.map((a) => [a.id, a]));
  const articlesByTeam = new Map<
    string,
    Array<(typeof publishedArticles)[number]>
  >();
  for (const row of articleTeams ?? []) {
    if (!publishedIds.has(row.article_id)) continue;
    const article = articleById.get(row.article_id);
    if (!article) continue;
    const list = articlesByTeam.get(row.team_id) ?? [];
    list.push(article);
    articlesByTeam.set(row.team_id, list);
  }
  for (const team of teams ?? []) {
    const covered = articlesByTeam.get(team.id);
    if (!covered || covered.length === 0) continue;
    entries.push({
      url: `${SITE.url}/brief/team/${team.abbreviation}`,
      lastModified: newest(
        covered.flatMap((a) => [a.last_updated, a.published_at]),
      ),
      priority: 0.4,
    });
  }

  // Player profiles. These are the most differentiated pages on the site (values
  // across every source and format, trends, stats, projections) and none of them
  // were in the sitemap before. Google was reaching them only through /rankings.
  //
  // Scoped to players carrying current value data, so the sitemap never advertises
  // a profile for one of the ~10k retired or practice-squad rows in `players`.
  for (const slug of await rankedPlayerSlugs(supabase)) {
    entries.push({
      url: `${SITE.url}/players/${slug}`,
      lastModified: rankingsUpdatedAt,
      priority: 0.7,
    });
  }

  return entries;
}
