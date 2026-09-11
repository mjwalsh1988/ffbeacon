/**
 * The user agents Next.js serves blocking, non-streamed HTML to.
 *
 * Since Next 15.2, a dynamic page streams its generateMetadata output into the
 * body after the first flush, so the title, description, canonical and robots
 * tags arrive after `</head>` for any client not on this list. Next's default
 * list (next/dist/shared/lib/router/utils/html-bots.js) covers Bingbot, the
 * social card fetchers and Google's inspection tools, but not Googlebot itself,
 * on the reasoning that Googlebot renders JavaScript and React moves the tags
 * into the head afterwards. Google documents that it accepts rel=canonical only
 * in the head, and every canonical on this site that consolidates a ?source=,
 * ?position=, ?tab= or ?page= variant depends on that. Measured on production
 * 2026-09-11: /rankings/redraft-ppr-std sent Googlebot its title at byte 35,003
 * with `</head>` at byte 3,737, and sent Bingbot its title at byte 2,593, inside
 * the head.
 *
 * So this is Next's default with the search and answer-engine crawlers put in
 * front of it. Several of those (GPTBot, ClaudeBot, PerplexityBot, CCBot) run no
 * JavaScript at all, so for them the streamed tags were never moved anywhere.
 *
 * What it changes, and what it does not (measured on a local production build,
 * 2026-09-11): a matched client's first byte waits for generateMetadata, about
 * 0.25 s on a rankings page against 0.03 s for Chrome, and the title,
 * description, canonical and robots tags then sit inside the head. It does NOT
 * stop the page BODY from streaming. On a route with a loading.tsx the loading
 * line still comes first and the h1 arrives later in the same response, in a
 * hidden block a script moves into place. Only prerendering the route (plan
 * finding A01) fixes the body order. Readers are unaffected, because no browser
 * user agent matches.
 *
 * `htmlLimitedBots` in next.config.ts REPLACES Next's default rather than
 * extending it, which is why the default is copied here verbatim.
 * html-limited-bots.test.ts fails if a Next upgrade changes the default and
 * this copy falls behind.
 *
 * Plan: docs/seo-audit/seo-audit-and-plan.md, finding A02.
 */

/** Next 15.5's default, verbatim. Kept equal by html-limited-bots.test.ts. */
export const NEXT_DEFAULT_HTML_LIMITED_BOTS =
  "[\\w-]+-Google|Google-[\\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight";

/**
 * The crawlers that decide whether a page appears in a search result or an AI
 * answer and that Next's default does not name. Search crawlers and user-fetch
 * agents first, then the training crawlers, which get the same HTML as
 * everyone else: this list controls how a page is delivered, not who may read
 * it. Who may read it is app/robots.ts.
 */
export const SEARCH_AND_ANSWER_CRAWLERS = [
  "Googlebot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "DuckAssistBot",
  "GPTBot",
  "ClaudeBot",
  "CCBot",
] as const;

export const HTML_LIMITED_BOTS = new RegExp(
  `${SEARCH_AND_ANSWER_CRAWLERS.join("|")}|${NEXT_DEFAULT_HTML_LIMITED_BOTS}`,
  "i",
);
