import { createCachedReadClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import { formatRfc822Eastern } from "@/lib/datetime";

/**
 * RSS 2.0 feed for The Beacon Brief.
 *
 * The site had no feed at all. /feed.xml and /brief/rss.xml both 404'd, which for a
 * news desk means giving up a discovery channel that costs nothing to serve: feed
 * readers, aggregators, Discover-style surfaces, and anyone who wants to pipe the
 * Brief into their own tooling. Unlike a sitemap, a feed is pull-based and pushes new
 * coverage to subscribers rather than waiting on a crawl.
 *
 * Route precedence note: this sits at app/brief/rss.xml/, a literal segment, so it
 * wins over the sibling app/brief/[slug]/ dynamic route. /brief/rss.xml can never be
 * mistaken for an article slug.
 *
 * Feed conventions worth not breaking:
 *   - guid uses the article URL with isPermaLink="true". Readers key dedupe off guid,
 *     so it has to be stable for the life of the article. Slugs do not change, and
 *     the four that were retired in migration 0151 are 308 redirects rather than new
 *     URLs, so existing subscribers do not see duplicates.
 *   - pubDate is published_at, never last_updated. A revision must not resurface an
 *     item as new in someone's reader. The Brief revises articles routinely now, so
 *     this matters more here than on most sites.
 *   - lastBuildDate is the newest published_at, so a reader can cheaply tell whether
 *     anything is new.
 *   - atom:link rel="self" is required for feed validation and lets a reader
 *     rediscover its own source URL.
 */

// Match the sitemap and llms.txt cadence so new coverage appears without a redeploy.
export const revalidate = 3600;

/** Number of most recent articles carried in the feed. */
const FEED_LIMIT = 50;

/**
 * Escape text for XML.
 *
 * Everything interpolated below is DB content written by the Beacon Brief pipeline,
 * so it can contain ampersands and angle brackets that would otherwise produce an
 * invalid feed. Applied to every field with no exceptions, including titles.
 */
function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Collapse a summary to one clean line of plain text. */
function summarize(text: string, max = 400): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 3).trimEnd()}...`;
}

export async function GET() {
  const supabase = createCachedReadClient();

  const { data: articles } = await supabase
    .from("articles")
    .select(
      "slug, title, tl_dr, meta_description, published_at, news_categories(name)",
    )
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(FEED_LIMIT);

  const rows = articles ?? [];
  const feedUrl = `${SITE.url}/brief/rss.xml`;
  const lastBuild =
    formatRfc822Eastern(rows[0]?.published_at) ??
    formatRfc822Eastern(new Date().toISOString());

  const items = rows
    .map((a) => {
      const url = `${SITE.url}/brief/${a.slug}`;
      const summary = summarize(a.meta_description || a.tl_dr || a.title);
      const pubDate = formatRfc822Eastern(a.published_at);
      // PostgREST returns a to-one embed as an object or a single-element array.
      const embed = (a as { news_categories?: unknown }).news_categories;
      const category = (
        Array.isArray(embed) ? embed[0] : embed
      ) as { name?: string } | null;

      return [
        "    <item>",
        `      <title>${xml(a.title)}</title>`,
        `      <link>${xml(url)}</link>`,
        `      <guid isPermaLink="true">${xml(url)}</guid>`,
        `      <description>${xml(summary)}</description>`,
        ...(pubDate ? [`      <pubDate>${pubDate}</pubDate>`] : []),
        ...(category?.name
          ? [`      <category>${xml(category.name)}</category>`]
          : []),
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(`The Beacon Brief: ${SITE.name}`)}</title>
    <link>${xml(`${SITE.url}/brief`)}</link>
    <description>${xml("Fantasy football news that tells you what it means. Injuries, transactions, depth chart shifts, suspensions, and rookie news, with the fantasy impact spelled out.")}</description>
    <language>en-us</language>
    <copyright>${xml(`${SITE.name}`)}</copyright>
    <managingEditor>${xml(SITE.author.name)}</managingEditor>
${lastBuild ? `    <lastBuildDate>${lastBuild}</lastBuildDate>\n` : ""}    <atom:link href="${xml(feedUrl)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      // Same shape as the OG routes: cheap for readers that poll, and a stale copy
      // for an hour is harmless for a feed.
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
