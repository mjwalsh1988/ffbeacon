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
 * AI crawlers are intentionally NOT blocked, and that includes the ones that collect
 * training data (GPTBot, ClaudeBot, CCBot, Google-Extended, Applebot-Extended). The
 * owner decided this on 2026-09-11 (docs/seo-audit/seo-audit-and-plan.md, finding
 * G03): answer engines are a growing referral source for a site like this, and being
 * in the training data is one way a small brand becomes a name the models know.
 * Blocking them would do nothing for search rankings.
 *
 * So they share the wildcard group below rather than getting groups of their own. A
 * crawler with its own group ignores the wildcard entirely, so a named group would
 * have to repeat every disallow line, and a copy that drifted would open /admin or
 * /my-beacon to that one crawler. If a crawler ever needs different treatment, give
 * it a group that repeats the full disallow list.
 *
 * THE ONE EXCEPTION IS AMAZONBOT, blocked from the whole site since 2026-09-22.
 * On that day it made 11.8k of the site's 45k requests in 24 hours, much of it
 * walking the /leagues/ pages one every four seconds, and each of those pages
 * refreshes a league and makes about 50 database reads. It sent no readers in
 * return: the 30-day referrer list had Google, Bing, DuckDuckGo, Yahoo and
 * ChatGPT on it and nothing from Amazon. Amazon says the crawl feeds its own
 * products and "may be used to train Amazon AI models", so the answer-engine
 * reasoning above does not reach it. The owner chose to block it outright.
 * Amazon documents that Amazonbot honors robots.txt
 * (developer.amazon.com/amazonbot) but not crawl-delay, so slowing it down was
 * not an option. If Amazon ever starts sending readers, delete the group.
 *
 * Its group is `Disallow: /`, so it does not need the repeated disallow list the
 * paragraph above warns about: there is nothing left for it to drift from. Every
 * other crawler, Googlebot, Bingbot, GPTBot, OAI-SearchBot, ClaudeBot,
 * PerplexityBot and Applebot included, still reads only the wildcard group. A
 * crawler obeys the group that names it and ignores the rest, and none of the
 * others match the token "Amazonbot".
 *
 * Vercel's Firewall and Bot Protection settings can block AI crawlers regardless of
 * this file. Those live in the Vercel dashboard, not the repo.
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
      {
        // Blocked from everything. See the header for why and when.
        userAgent: "Amazonbot",
        disallow: "/",
      },
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
    // No `host`: Google and Bing ignore the Host directive, and Yandex dropped it
    // in 2018. The canonical host is set by redirects and canonical tags instead.
  };
}
