import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/**
 * robots.txt for ffbeacon.com.
 *
 * The site previously shipped no robots.txt at all. That is permissive (nothing was
 * blocked) but it left two things on the table: crawlers had no pointer to the
 * sitemap, and every admin screen, API route, and signed-in account page was fair
 * game for crawl budget that should go to rankings, tools, and Beacon Brief articles.
 *
 * The rule here is deliberately narrow. Only surfaces that can never rank are
 * disallowed: the admin panel, machine-only API routes, auth endpoints, and
 * user-account pages. Everything a reader can reach stays crawlable, including all
 * of /brief, /players, /rankings, /tools, and public Signal profiles.
 *
 * Two allowances sit inside the /api/ block on purpose:
 *   - /api/og/ generates the Open Graph and Twitter card images referenced from
 *     article metadata. Blocking it would stop Google, Slack, Discord, and X from
 *     fetching preview images, which would silently kill rich link previews.
 *   - Allow lines precede the broader Disallow so the more specific rule wins under
 *     the longest-match precedence every major crawler uses.
 *
 * AI crawlers are intentionally NOT blocked. Answer engines are a growing referral
 * source for a site like this, and /llms.txt exists specifically to feed them.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          // OG and Twitter card image generation. Must stay fetchable.
          "/api/og/",
        ],
        disallow: [
          // Admin panel. Auth-gated, and nothing here should ever be indexed.
          "/admin",
          // Machine-only endpoints (cron, internal data, webhooks). The /api/og/
          // allow above is more specific and still wins.
          "/api/",
          // Auth callback and sign-out. Crawling sign-out is actively harmful.
          "/auth/",
          // Signed-in account surfaces. Personal, and empty to an anonymous crawler.
          "/my-beacon",
          "/login",
        ],
      },
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
