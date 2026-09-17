import { createCachedReadClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import { formatRfc822Eastern } from "@/lib/datetime";
import { loadRecentRelays } from "@/lib/relays/load";

/**
 * RSS 2.0 feed of Relays: every accepted report, newest first.
 *
 * /brief/rss.xml carries the weekly Briefs, which is the thing a reader
 * subscribes to; this carries the running feed for anyone who wants every
 * report. Same conventions as rss.xml: guid is the permalink, pubDate is the
 * post's own timestamp, every field is escaped.
 */

export const revalidate = 900;

const FEED_LIMIT = 100;

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const relays = await loadRecentRelays(createCachedReadClient(), FEED_LIMIT);
  const feedUrl = `${SITE.url}/brief/relays.xml`;
  const lastBuild =
    formatRfc822Eastern(relays[0]?.sourcePostedAt) ?? formatRfc822Eastern(new Date().toISOString());

  const items = relays
    .map((r) => {
      const url = `${SITE.url}/brief/relay/${r.slug}`;
      const description = [
        ...r.facts.map((f) => `${f.label}: ${f.value}`),
        `Original report: @${r.sourceHandle.replace(/^@/, "")} on X`,
      ].join(". ");
      const pubDate = formatRfc822Eastern(r.sourcePostedAt);
      return [
        "    <item>",
        `      <title>${xml(r.headline)}</title>`,
        `      <link>${xml(url)}</link>`,
        `      <guid isPermaLink="true">${xml(url)}</guid>`,
        `      <description>${xml(description)}</description>`,
        ...(pubDate ? [`      <pubDate>${pubDate}</pubDate>`] : []),
        ...(r.category?.name ? [`      <category>${xml(r.category.name)}</category>`] : []),
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(`The Beacon Brief, every report: ${SITE.name}`)}</title>
    <link>${xml(`${SITE.url}/brief`)}</link>
    <description>${xml("Every injury, trade, signing and role change the desk accepted, as a structured report with the original source credited.")}</description>
    <language>en-us</language>
    <copyright>${xml(SITE.name)}</copyright>
${lastBuild ? `    <lastBuildDate>${lastBuild}</lastBuildDate>\n` : ""}    <atom:link href="${xml(feedUrl)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=900, stale-while-revalidate=86400",
    },
  });
}
