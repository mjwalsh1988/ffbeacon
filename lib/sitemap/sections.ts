/**
 * The sitemap, split into four files that can be measured separately.
 *
 * WHY IT IS SPLIT
 *
 * One sitemap of about a thousand URLs gives Search Console one number, and that
 * number cannot answer the only question worth asking: WHICH pages is Google
 * declining to index? On 2026-08-14 the site read 63 indexed against 967 discovered,
 * and the honest answer to "is that the Brief or the player profiles?" was a guess.
 * Player profiles are 77% of the file and articles are 17%, so the guess mattered.
 *
 * Four files, each submitted through one index, turn that into a measurement: Search
 * Console reports discovered and indexed per file. No more guessing which bucket is
 * being ignored.
 *
 * The split is by KIND OF PAGE, not by size. Splitting a thousand URLs for size alone
 * would be pointless (the limits are 50,000 URLs and 50MB), and splitting
 * alphabetically would produce buckets that answer nothing.
 *
 * TWO RULES SHAPE EVERY SECTION. Both carried over from the single file this replaced.
 *
 * 1. Every URL listed must be a real page that returns 200 and is indexable. A sitemap
 *    containing a noindex page, a placeholder, or a URL with no route tells Google the
 *    whole file is unreliable, and it stops trusting the rest. That is why the article
 *    section applies the same indexability rule the article page applies to itself
 *    (lib/beacon-brief/index-quality.ts); the two disagreeing would be worse than
 *    either choice alone.
 *
 * 2. lastModified must be true or absent. It was once `new Date()` for every static
 *    path, so 20 URLs claimed to change every hour, forever. Google's documented
 *    response to lastmod it finds unreliable is to ignore lastmod for the whole site,
 *    which throws away the one signal that says which of several hundred URLs to
 *    recrawl. So a lastModified here is derived from real data or omitted.
 *
 * changeFrequency is gone. Google ignores it, and an accurate lastModified says the
 * same thing with evidence behind it. priority stays: it costs nothing and some
 * non-Google crawlers still read it.
 *
 * DELIBERATELY NOT LISTED, and why:
 *   /players            No route folder exists (only /players/[slug]). The path falls
 *                       through to app/[handle] and returns a noindex page.
 *   /join               Sets robots index:false (it is a Discord hand-off page).
 *   /login /my-beacon   Disallowed in robots.ts; account surfaces.
 *   /admin /api /auth   Disallowed in robots.ts.
 *   /leagues/**         Per-user league data, unbounded in count.
 *   /tools/signal-check/v/[shareId]   User-generated share artifacts.
 *   /brief/player/[slug]              Sets robots noindex.
 *   /[handle]/rankings/[boardId]      Sets robots index:false.
 *   /brief/tag/[tag]                  Hundreds of thin filter pages. They stay
 *                       crawlable through in-page links, but advertising them would
 *                       spend crawl budget that belongs to articles and profiles.
 *   Thin Brief articles See rule 1 above.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import { PUBLISHED_GUIDES } from "@/lib/guides/published";
import { RELEVANCE_WINDOW_DAYS } from "@/lib/player-search";
import {
  countArticleWords,
  THIN_ARTICLE_WORDS,
} from "@/lib/beacon-brief/index-quality";

type Admin = ReturnType<typeof createAdminClient>;

/** One URL in a sitemap file. */
export type SitemapUrl = {
  loc: string;
  lastModified?: Date;
  priority?: number;
};

/**
 * The four files. `id` is the URL segment and the name that shows up in Search
 * Console, so it is a word rather than a number: reading "articles.xml: 148 discovered,
 * 12 indexed" in a table is the entire point of the split.
 */
export const SITEMAP_SECTIONS = [
  "core",
  "articles",
  "players",
  "profiles",
] as const;

export type SitemapSection = (typeof SITEMAP_SECTIONS)[number];

export function sectionPath(section: SitemapSection): string {
  return `/sitemaps/${section}.xml`;
}

/**
 * Supabase caps an unbounded select() at 1000 rows and does it silently, so any query
 * here that can exceed that has to page explicitly. `rankings` is well past it (about
 * 11k rows across the relevance window).
 */
const DB_PAGE_SIZE = 1000;

/**
 * How many ids to put in one `.in()` filter.
 *
 * PostgREST puts the whole list in the query string, and a few hundred UUIDs builds a
 * URL long enough to be rejected outright with "Bad Request". That failure is silent
 * in the worst way: the query returns nothing and the caller reads it as "no rows".
 */
const ID_BATCH_SIZE = 50;

/** Core public pages that are not data-driven. */
const STATIC_PATHS: Array<{ path: string; priority: number }> = [
  { path: "/tools", priority: 0.7 },
  { path: "/tools/beacon-breakdown", priority: 0.6 },
  { path: "/tools/league-pulse", priority: 0.6 },
  { path: "/tools/faab", priority: 0.6 },
  { path: "/tools/on-the-clock", priority: 0.6 },
  { path: "/tools/signal-check", priority: 0.6 },
  { path: "/games", priority: 0.4 },
  { path: "/games/signal-scout", priority: 0.4 },
  { path: "/games/would-you-rather", priority: 0.4 },
  { path: "/about", priority: 0.4 },
  { path: "/author/michael", priority: 0.4 },
  { path: "/privacy", priority: 0.2 },
  { path: "/terms", priority: 0.2 },
];

/** Newest of a set of timestamps, or undefined when there is nothing to go on. */
function newest(values: Array<string | null | undefined>): Date | undefined {
  let best: number | null = null;
  for (const v of values) {
    if (!v) continue;
    const t = new Date(v).getTime();
    if (Number.isNaN(t)) continue;
    if (best === null || t > best) best = t;
  }
  return best === null ? undefined : new Date(best);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

/* ------------------------------------------------------------------ */
/* Shared reads                                                        */
/* ------------------------------------------------------------------ */

type ArticleRow = {
  id: string;
  slug: string;
  content_md: string | null;
  last_updated: string | null;
  published_at: string | null;
  category_id: string | null;
};

async function publishedArticles(supabase: Admin): Promise<ArticleRow[]> {
  const { data } = await supabase
    .from("articles")
    .select("id, slug, content_md, last_updated, published_at, category_id")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(5000);
  return (data ?? []) as ArticleRow[];
}

const articleChangedAt = (a: {
  last_updated: string | null;
  published_at: string | null;
}) => newest([a.last_updated, a.published_at]);

/**
 * Which of these articles cover at least one currently ranked player.
 *
 * Only ever asked about the thin ones, because that is the only case where the answer
 * changes anything, which keeps both the article_players read and the rankings read
 * small enough to batch.
 */
async function articlesWithRankedPlayer(
  supabase: Admin,
  articleIds: string[],
): Promise<Set<string>> {
  const withRanked = new Set<string>();
  if (articleIds.length === 0) return withRanked;

  const links: Array<{ article_id: string; player_id: string }> = [];
  for (const batch of chunk(articleIds, ID_BATCH_SIZE)) {
    const { data } = await supabase
      .from("article_players")
      .select("article_id, player_id")
      .in("article_id", batch);
    links.push(...((data ?? []) as typeof links));
  }
  if (links.length === 0) return withRanked;

  const cutoff = new Date(
    Date.now() - RELEVANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const playerIds = [...new Set(links.map((l) => l.player_id))];
  const ranked = new Set<string>();
  for (const batch of chunk(playerIds, ID_BATCH_SIZE)) {
    const { data } = await supabase
      .from("rankings")
      .select("player_id")
      .in("player_id", batch)
      .gte("generated_at", cutoff);
    for (const row of data ?? []) ranked.add(row.player_id);
  }

  for (const link of links) {
    if (ranked.has(link.player_id)) withRanked.add(link.article_id);
  }
  return withRanked;
}

/**
 * Slugs of every player appearing in `rankings` inside the relevance window.
 *
 * Paged, because `rankings` is well past the 1000-row default. The slug comes back on
 * the embedded `players` row instead of from a second query keyed by id: collecting
 * ~800 ids and then filtering `players` with .in() builds a roughly 30KB query string,
 * which PostgREST rejects outright, so that shape looked correct and returned zero
 * player URLs. The inner join keeps it to one paged scan at constant URL length.
 */
async function rankedPlayerSlugs(supabase: Admin): Promise<string[]> {
  const cutoff = new Date(
    Date.now() - RELEVANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
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

/* ------------------------------------------------------------------ */
/* The sections                                                        */
/* ------------------------------------------------------------------ */

/**
 * Home, rankings, tools, guides, and the Brief's own index and filter pages.
 *
 * Small, slow-moving, and the pages that should be crawled first. Keeping them in
 * their own file means a crawl budget spent on 800 player profiles cannot bury them.
 */
async function coreSection(supabase: Admin): Promise<SitemapUrl[]> {
  const [
    { data: categories },
    { data: articleTeams },
    { data: teams },
    { data: rankingFormats },
    { data: latestRanking },
  ] = await Promise.all([
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

  const articles = await publishedArticles(supabase);
  const newestArticleAt = newest(
    articles.flatMap((a) => [a.last_updated, a.published_at]),
  );
  const rankingsUpdatedAt = newest([latestRanking?.[0]?.generated_at]);

  const urls: SitemapUrl[] = [
    // The homepage surfaces the latest Beacon Brief coverage, so the newest article's
    // timestamp is a real answer for when it last changed.
    { loc: `${SITE.url}/`, lastModified: newestArticleAt, priority: 1 },
    {
      loc: `${SITE.url}/rankings`,
      lastModified: rankingsUpdatedAt,
      priority: 0.9,
    },
    { loc: `${SITE.url}/brief`, lastModified: newestArticleAt, priority: 0.7 },
    ...STATIC_PATHS.map(({ path, priority }) => ({
      loc: `${SITE.url}${path}`,
      priority,
    })),
  ];

  // Guides. Both the index and each guide carry a genuine lastModified, taken from the
  // hand-maintained dates in lib/guides/published.ts rather than the build clock.
  if (PUBLISHED_GUIDES.length > 0) {
    urls.push({
      loc: `${SITE.url}/guides`,
      lastModified: newest(PUBLISHED_GUIDES.map((g) => g.updatedAt)),
      priority: 0.7,
    });
    for (const guide of PUBLISHED_GUIDES) {
      urls.push({
        loc: `${SITE.url}/guides/${guide.slug}`,
        lastModified: newest([guide.updatedAt]),
        priority: guide.priority,
      });
    }
  }

  // Per-format rankings pages. Each has its own h1, title, and meta description (see
  // lib/rankings-formats.ts), which is what makes them distinct pages rather than the
  // near-duplicate `?format=` views they replaced.
  for (const format of rankingFormats ?? []) {
    urls.push({
      loc: `${SITE.url}/rankings/${format.slug}`,
      lastModified: rankingsUpdatedAt,
      priority: 0.8,
    });
  }

  // Category filter pages, but only the ones that lead somewhere. A category with no
  // published articles renders "Nothing here yet".
  const byCategory = new Map<string, ArticleRow[]>();
  for (const a of articles) {
    if (!a.category_id) continue;
    const list = byCategory.get(a.category_id) ?? [];
    list.push(a);
    byCategory.set(a.category_id, list);
  }
  for (const category of categories ?? []) {
    const inCategory = byCategory.get(category.id);
    if (!inCategory || inCategory.length === 0) continue;
    urls.push({
      loc: `${SITE.url}/brief/category/${category.slug}`,
      lastModified: newest(
        inCategory.flatMap((a) => [a.last_updated, a.published_at]),
      ),
      priority: 0.5,
    });
  }

  // Team filter pages, same rule: only teams we have actually covered. These are real
  // editorial collections ("everything on the Bills") and they are bounded at 32.
  const publishedIds = new Set(articles.map((a) => a.id));
  const articleById = new Map(articles.map((a) => [a.id, a]));
  const byTeam = new Map<string, ArticleRow[]>();
  for (const row of articleTeams ?? []) {
    if (!publishedIds.has(row.article_id)) continue;
    const article = articleById.get(row.article_id);
    if (!article) continue;
    const list = byTeam.get(row.team_id) ?? [];
    list.push(article);
    byTeam.set(row.team_id, list);
  }
  for (const team of teams ?? []) {
    const covered = byTeam.get(team.id);
    if (!covered || covered.length === 0) continue;
    urls.push({
      loc: `${SITE.url}/brief/team/${team.abbreviation}`,
      lastModified: newest(
        covered.flatMap((a) => [a.last_updated, a.published_at]),
      ),
      priority: 0.4,
    });
  }

  return urls;
}

/**
 * Beacon Brief articles that clear the quality floor.
 *
 * The filter is the reason this section exists separately: it is the bucket whose
 * indexed rate is in question, and it is the bucket where a bad page costs the most.
 */
async function articlesSection(supabase: Admin): Promise<SitemapUrl[]> {
  const articles = await publishedArticles(supabase);

  const thinIds = new Set(
    articles
      .filter((a) => countArticleWords(a.content_md) < THIN_ARTICLE_WORDS)
      .map((a) => a.id),
  );
  const rescued = await articlesWithRankedPlayer(supabase, [...thinIds]);

  const dropped = [...thinIds].filter((id) => !rescued.has(id)).length;
  if (dropped > 0) {
    console.log(
      `[sitemap] ${dropped} thin article(s) held back from the index of ${articles.length}`,
    );
  }

  return articles
    .filter((a) => !thinIds.has(a.id) || rescued.has(a.id))
    .map((a) => ({
      loc: `${SITE.url}/brief/${a.slug}`,
      lastModified: articleChangedAt(a),
      priority: 0.6,
    }));
}

/**
 * Player profiles.
 *
 * The most differentiated pages on the site (values across every source and format,
 * trends, stats, projections) and the biggest section by a distance. Scoped to players
 * carrying current value data, so the sitemap never advertises a profile for one of
 * the ~10k retired or practice-squad rows in `players`.
 */
async function playersSection(supabase: Admin): Promise<SitemapUrl[]> {
  const { data: latestRanking } = await supabase
    .from("rankings")
    .select("generated_at")
    .order("generated_at", { ascending: false })
    .limit(1);
  const rankingsUpdatedAt = newest([latestRanking?.[0]?.generated_at]);

  const slugs = await rankedPlayerSlugs(supabase);
  return slugs.map((slug) => ({
    loc: `${SITE.url}/players/${slug}`,
    lastModified: rankingsUpdatedAt,
    priority: 0.7,
  }));
}

/** Live Signal profiles. Drafts and private profiles are excluded by contract. */
async function profilesSection(supabase: Admin): Promise<SitemapUrl[]> {
  const { data } = await supabase
    .from("signals")
    .select("handle, updated_at")
    .eq("status", "published")
    .eq("visibility", "public")
    .eq("hidden", false)
    .order("updated_at", { ascending: false })
    .limit(5000);
  return (data ?? []).map((profile) => ({
    loc: `${SITE.url}/${profile.handle}`,
    lastModified: newest([profile.updated_at]),
    priority: 0.6,
  }));
}

export async function loadSitemapSection(
  section: SitemapSection,
): Promise<SitemapUrl[]> {
  const supabase = createAdminClient();
  switch (section) {
    case "core":
      return coreSection(supabase);
    case "articles":
      return articlesSection(supabase);
    case "players":
      return playersSection(supabase);
    case "profiles":
      return profilesSection(supabase);
  }
}

/**
 * When each section last changed, for the index file.
 *
 * One cheap query per section rather than building the section itself: the index is
 * fetched by crawlers on its own schedule, and making it re-derive 800 player URLs to
 * report one timestamp would be the expensive way to say the same thing.
 */
export async function sectionLastModified(
  section: SitemapSection,
): Promise<Date | undefined> {
  const supabase = createAdminClient();
  if (section === "players") {
    const { data } = await supabase
      .from("rankings")
      .select("generated_at")
      .order("generated_at", { ascending: false })
      .limit(1);
    return newest([data?.[0]?.generated_at]);
  }
  if (section === "profiles") {
    const { data } = await supabase
      .from("signals")
      .select("updated_at")
      .eq("status", "published")
      .eq("visibility", "public")
      .eq("hidden", false)
      .order("updated_at", { ascending: false })
      .limit(1);
    return newest([data?.[0]?.updated_at]);
  }
  // Core and articles both move when an article does. Core also moves when the
  // rankings batch lands, so it takes the newer of the two.
  const [{ data: article }, { data: ranking }] = await Promise.all([
    supabase
      .from("articles")
      .select("last_updated, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(1),
    section === "core"
      ? supabase
          .from("rankings")
          .select("generated_at")
          .order("generated_at", { ascending: false })
          .limit(1)
      : Promise.resolve({ data: null }),
  ]);
  return newest([
    article?.[0]?.last_updated,
    article?.[0]?.published_at,
    (ranking as { generated_at: string | null }[] | null)?.[0]?.generated_at,
  ]);
}

/* ------------------------------------------------------------------ */
/* XML                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The five characters XML reserves. Our URLs are slugs and handles, so this should
 * never fire, which is exactly why it is here rather than assumed away: one handle
 * containing an ampersand would otherwise produce a file no parser accepts.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderUrlSet(urls: SitemapUrl[]): string {
  const body = urls
    .map((u) => {
      const parts = [`    <loc>${escapeXml(u.loc)}</loc>`];
      if (u.lastModified) {
        parts.push(`    <lastmod>${u.lastModified.toISOString()}</lastmod>`);
      }
      if (typeof u.priority === "number") {
        parts.push(`    <priority>${u.priority.toFixed(1)}</priority>`);
      }
      return `  <url>\n${parts.join("\n")}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function renderSitemapIndex(
  entries: Array<{ loc: string; lastModified?: Date }>,
): string {
  const body = entries
    .map((e) => {
      const parts = [`    <loc>${escapeXml(e.loc)}</loc>`];
      if (e.lastModified) {
        parts.push(`    <lastmod>${e.lastModified.toISOString()}</lastmod>`);
      }
      return `  <sitemap>\n${parts.join("\n")}\n  </sitemap>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

/** One place to set the caching and content type for every sitemap response. */
export function xmlResponse(xml: string): Response {
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Matches the hourly revalidate the single sitemap file used.
      "Cache-Control":
        "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
