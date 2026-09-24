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
 *   /tools/trade-calculator/v/[shareId]   User-generated share artifacts.
 *   /brief/player/[slug]              Sets robots noindex.
 *   /[handle]/rankings/[boardId]      Indexable when the board is published and its
 *                       owner's profile is live (only the not-found branch sets
 *                       noindex). Left out of this file because each board is linked
 *                       from its owner's profile, which is listed. Owner decision
 *                       2026-09-11: public Signal profiles stay indexed.
 *   /brief/tag/[tag]                  Hundreds of thin filter pages. They stay
 *                       crawlable through in-page links, but advertising them would
 *                       spend crawl budget that belongs to articles and profiles.
 *   /brief/category/[slug] and /brief/team/[abbr]   Both render Relays, which are
 *                       noindex by design, and both routes now set noindex on
 *                       their own terms rather than following the Brief's master
 *                       switch. Listing a thin archive of pages nobody may index
 *                       would break rule 1 twice over.
 *   Legacy Brief articles and Relays. The articles file carries Brief EDITIONS
 *                       only (article_type 'brief'), which are indexable by type
 *                       ahead of the master switch. Relays are never indexed.
 *   /brief/editions     While no edition is published. The page sets noindex for
 *                       the same reason, from the same read (hasPublishedEditions).
 */

import { idpRelevantPlayerIdSet } from "@/lib/player-search";
import { IDP_POSITIONS } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/server";
import { memoTtl } from "@/lib/memo-ttl";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { SITE } from "@/lib/site";
import { PUBLISHED_GUIDES } from "@/lib/guides/published";
import { resolveSeasonClock } from "@/lib/start-sit/clock";
import { boardWeeks, weekPath } from "@/lib/waiver-wire/weeks";
import { RELEVANCE_WINDOW_DAYS } from "@/lib/player-search";

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

/** Core public pages that are not data-driven. */
const STATIC_PATHS: Array<{ path: string; priority: number }> = [
  { path: "/tools", priority: 0.7 },
  // The start/sit tool is a head-term landing page, one notch above the
  // other tools (plan 2.3).
  { path: "/tools/who-should-i-start", priority: 0.7 },
  { path: "/tools/league-pulse", priority: 0.6 },
  { path: "/tools/faab", priority: 0.6 },
  { path: "/tools/on-the-clock", priority: 0.6 },
  { path: "/tools/manager-pulse", priority: 0.6 },
  { path: "/tools/trade-calculator", priority: 0.6 },
  { path: "/tools/free-agent-finder", priority: 0.5 },
  { path: "/games", priority: 0.4 },
  { path: "/games/signal-scout", priority: 0.4 },
  { path: "/games/would-you-rather", priority: 0.4 },
  { path: "/about", priority: 0.4 },
  { path: "/author/michael", priority: 0.4 },
  // /donate is listed; /donate/thanks deliberately is not. A receipt is
  // per-visit, carries a session id, and is marked noindex on the page itself.
  { path: "/donate", priority: 0.3 },
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

/* ------------------------------------------------------------------ */
/* Shared reads                                                        */
/* ------------------------------------------------------------------ */

type ArticleRow = {
  id: string;
  slug: string;
  article_type: string;
  last_updated: string | null;
  published_at: string | null;
  category_id: string | null;
};

const articleChangedAt = (a: {
  last_updated: string | null;
  published_at: string | null;
}) => newest([a.last_updated, a.published_at]);

/**
 * Published Brief editions (article_type 'brief'), newest first. The one kind
 * of article the sitemap advertises: person-written, reviewed and indexable
 * ahead of the master switch (lib/beacon-brief/index-quality.ts).
 */
async function publishedEditions(supabase: Admin): Promise<ArticleRow[]> {
  // Paged: a .limit() above 1000 still returns 1000. A failed read throws, so
  // the route errors rather than serving a file with articles missing.
  const rows = await fetchAllRows("[sitemap] brief editions", (from, to) =>
    supabase
      .from("articles")
      .select("id, slug, article_type, last_updated, published_at, category_id")
      .eq("status", "published")
      .eq("article_type", "brief")
      .order("published_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows as ArticleRow[];
}

/**
 * Whether a single Brief edition is published yet.
 *
 * Three decisions read this one question and have to give the same answer:
 * whether the index points at the articles file, whether the core file lists
 * /brief/editions, and whether that page is indexable at all (its
 * generateMetadata calls this directly). A sitemap entry pointing at a noindex
 * page is what teaches Google to stop trusting the file, so this is the only
 * place the question is asked.
 */
export async function hasPublishedEditions(
  supabase: Admin = createAdminClient(),
): Promise<boolean> {
  // Memoised for a minute: the hub asks this on every request, and the answer
  // changes only when an edition is approved, which busts it below. The count
  // is public data (the anon policy shows published rows), so the shared
  // entry is the same answer for every reader.
  return memoTtl(HAS_EDITIONS_MEMO_KEY, 60_000, async () => {
    const { count } = await supabase
      .from("articles")
      .select("id", { count: "exact", head: true })
      .eq("status", "published")
      .eq("article_type", "brief");
    return (count ?? 0) > 0;
  });
}

/** Busted by lib/brief-desk/publish.ts when an edition is published. */
export const HAS_EDITIONS_MEMO_KEY = "ref:brief:has-editions";

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
  // Ordered by id so pages neither overlap nor skip. A failed page throws: a
  // player file missing half its profiles reads to Google as pages removed.
  const rows = await fetchAllRows("[sitemap] ranked players", (from, to) =>
    supabase
      .from("rankings")
      .select("player_id, players!inner(slug)")
      .gte("generated_at", cutoff)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const slugs = new Set<string>();
  for (const row of rows) {
    // PostgREST returns a to-one embed as an object or a single-element array
    // depending on inferred cardinality. Normalize both.
    const embed = (row as { players?: unknown }).players;
    const player = Array.isArray(embed) ? embed[0] : embed;
    const slug = (player as { slug?: string | null } | null)?.slug;
    if (slug) slugs.add(slug);
  }
  return [...slugs];
}

/**
 * Defender profile slugs that pass the IDP relevance gate (plan R-15, R-17).
 *
 * No value source ranks a defender, so rankedPlayerSlugs never finds one. The
 * gate is the defensive equivalent (a real season of snaps, or a depth chart
 * spot), and a defender outside it is noindexed on the page itself, so the
 * sitemap and the robots tag agree. Paged over the three positions and filtered
 * in memory: an .in() over 1,500 ids is the URL-length failure described above.
 */
export async function idpPlayerSlugs(supabase: Admin): Promise<string[]> {
  const gate = await idpRelevantPlayerIdSet(supabase);
  const rows = await fetchAllRows("[sitemap] defenders", (from, to) =>
    supabase
      .from("players")
      .select("id, slug")
      .in("position", [...IDP_POSITIONS])
      .order("id", { ascending: true })
      .range(from, to),
  );
  const slugs: string[] = [];
  for (const row of rows) if (row.slug && gate.has(row.id)) slugs.push(row.slug);
  return slugs;
}

/* ------------------------------------------------------------------ */
/* The sections                                                        */
/* ------------------------------------------------------------------ */

/**
 * Home, rankings, tools, guides, the Brief hub and its editions listing.
 *
 * Small, slow-moving, and the pages that should be crawled first. Keeping them in
 * their own file means a crawl budget spent on 800 player profiles cannot bury them.
 */
async function coreSection(supabase: Admin): Promise<SitemapUrl[]> {
  const [{ data: rankingFormats }, { data: latestRanking }, { data: newestRelay }] =
    await Promise.all([
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
      // The hub renders Relays, so the newest Relay is when the hub last changed.
      supabase
        .from("relays")
        .select("source_posted_at")
        .eq("status", "published")
        .order("source_posted_at", { ascending: false })
        .limit(1),
    ]);

  // The same filter hasPublishedEditions() counts, so the file and the page
  // cannot disagree about whether /brief/editions is a page worth listing.
  const editions = await publishedEditions(supabase);
  const editionStamps = editions.flatMap((a) => [a.last_updated, a.published_at]);
  const relayStamp = newestRelay?.[0]?.source_posted_at ?? null;
  const newestEditionAt = newest(editionStamps);
  const newestRelayAt = newest([relayStamp]);
  const rankingsUpdatedAt = newest([latestRanking?.[0]?.generated_at]);

  const urls: SitemapUrl[] = [
    // The homepage carries both the Relay feed and the latest edition, so it
    // takes whichever of the two moved last.
    {
      loc: `${SITE.url}/`,
      lastModified: newest([relayStamp, ...editionStamps]),
      priority: 1,
    },
    // The rankings hub. No lastmod: since 2026-09-11 it is a directory of the format
    // boards (owner decision, plan finding D04), and its content no longer changes
    // when the nightly rankings rebuild does. A date that moved every night without
    // the page changing would teach Google to ignore this file's dates.
    { loc: `${SITE.url}/rankings`, priority: 0.9 },
    // The Brief hub, dated from Relays rather than from articles. It has rendered
    // the Relay feed since BD-T018 and changes several times a day, while the
    // article-derived date it used to carry was absent entirely (no published
    // articles) and would later have frozen on the day an edition was approved.
    // Rule 2: a lastmod is true or it is absent.
    { loc: `${SITE.url}/brief`, lastModified: newestRelayAt, priority: 0.7 },
    ...STATIC_PATHS.map(({ path, priority }) => ({
      loc: `${SITE.url}${path}`,
      priority,
    })),
  ];

  // Every published Brief edition by season and week (plan 11.1), dated from
  // the newest edition, which is the only thing that moves it. Listed only once
  // there is an edition to list: until then the page itself sets noindex, from
  // this same predicate, and rule 1 forbids advertising a noindex URL.
  if (editions.length > 0) {
    urls.push({
      loc: `${SITE.url}/brief/editions`,
      lastModified: newestEditionAt,
      priority: 0.7,
    });
  }

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

  // The waiver wire hub and one URL per publishable week.
  //
  // WHY THE WEEKS ARE LISTED INDIVIDUALLY. Each one is a real page with its own
  // title, its own board and its own FAQ, and the searches behind them are
  // per-week ("waiver wire week 4"), so listing only the hub would hide the
  // fifteen pages that the section actually exists for.
  //
  // WHY ONLY THE PUBLISHABLE ONES. `boardWeeks` stops one week past the live
  // week because Sleeper publishes projections about a week out, and the route
  // itself 404s past that. Rule 1 of this file: never advertise a URL that does
  // not serve a page. The list grows by one each week on its own.
  //
  // NO lastModified. The boards genuinely change every week, but they also
  // change whenever a value sync lands, and a date that moved nightly without
  // the page meaningfully changing is what teaches a crawler to ignore this
  // file's dates. Rule 2: a lastmod is true or it is absent.
  {
    const clock = await resolveSeasonClock(supabase);
    if (clock.season != null) {
      urls.push({ loc: `${SITE.url}/waiver-wire`, priority: 0.8 });
      for (const week of boardWeeks(clock.currentWeek)) {
        urls.push({ loc: `${SITE.url}${weekPath(week)}`, priority: 0.7 });
      }
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

  // The category and team archives are deliberately absent, and the blocks that
  // used to build them are gone rather than switched off.
  //
  // They were listed whenever BRIEF_SEARCH_INDEXING was true, and their URLs and
  // their dates were both computed from PUBLISHED ARTICLES. Those routes have
  // rendered Relays since BD-T018 and every legacy article is archived, so the
  // blocks would have published about 40 thin archive pages carrying lastmod
  // values describing content nobody can reach, on one boolean nobody would
  // connect to this file. Both routes now set noindex on their own terms.
  // Making them indexable again is a separate decision that needs its own
  // Relay-count rule and its own lastmod source.
  return urls;
}

/**
 * Beacon Brief editions, and only editions.
 *
 * Legacy per-post articles and Relays are never listed, whatever the master
 * switch says: an edition is the one Brief page that is indexable by its
 * type (lib/beacon-brief/index-quality.ts isPublishedEdition), and the page
 * applies the same rule to itself, so the file and the page cannot disagree.
 * Until the first edition is published the file is an empty urlset and the
 * index does not point at it (app/sitemap.xml/route.ts).
 */
async function articlesSection(supabase: Admin): Promise<SitemapUrl[]> {
  const editions = await publishedEditions(supabase);
  return editions.map((a) => ({
    loc: `${SITE.url}/brief/${a.slug}`,
    lastModified: articleChangedAt(a),
    priority: 0.7,
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

  const [ranked, defenders] = await Promise.all([
    rankedPlayerSlugs(supabase),
    idpPlayerSlugs(supabase),
  ]);
  const slugs = [...new Set([...ranked, ...defenders])];
  return slugs.map((slug) => ({
    loc: `${SITE.url}/players/${slug}`,
    lastModified: rankingsUpdatedAt,
    priority: 0.7,
  }));
}

/** Live Signal profiles. Drafts and private profiles are excluded by contract. */
async function profilesSection(supabase: Admin): Promise<SitemapUrl[]> {
  const rows = await fetchAllRows("[sitemap] signal profiles", (from, to) =>
    supabase
      .from("signals")
      .select("handle, updated_at")
      .eq("status", "published")
      .eq("visibility", "public")
      .eq("hidden", false)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows.map((profile) => ({
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
  // The articles file holds only editions, so its date is the newest edition's.
  if (section === "articles") {
    const { data } = await supabase
      .from("articles")
      .select("last_updated, published_at")
      .eq("status", "published")
      .eq("article_type", "brief")
      .order("published_at", { ascending: false })
      .limit(1);
    return newest([data?.[0]?.last_updated, data?.[0]?.published_at]);
  }
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
  // Core moves when a Relay lands (the /brief hub and the homepage both render
  // the feed), when an edition is published or revised, and when the rankings
  // batch lands. It takes the newest of the three. The Relay read is the one
  // that matters day to day, and it is the one this used to be missing.
  const [{ data: relay }, { data: edition }, { data: ranking }] = await Promise.all([
    supabase
      .from("relays")
      .select("source_posted_at")
      .eq("status", "published")
      .order("source_posted_at", { ascending: false })
      .limit(1),
    supabase
      .from("articles")
      .select("last_updated, published_at")
      .eq("status", "published")
      .eq("article_type", "brief")
      .order("published_at", { ascending: false })
      .limit(1),
    supabase
      .from("rankings")
      .select("generated_at")
      .order("generated_at", { ascending: false })
      .limit(1),
  ]);
  return newest([
    relay?.[0]?.source_posted_at,
    edition?.[0]?.last_updated,
    edition?.[0]?.published_at,
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
