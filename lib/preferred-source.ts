import { SITE } from "@/lib/site";

/**
 * The address of Google's "add as a preferred source" page for this site.
 *
 * Owner decision, 2026-09-11 (docs/seo-audit/seo-audit-and-plan.md, finding G05).
 * A reader who picks FF Beacon as a preferred source sees more of it in Google's
 * Top Stories and, since May 2026, in AI Overviews and AI Mode.
 *
 * This is Google's documented deeplink
 * (https://developers.google.com/search/docs/appearance/preferred-sources, updated
 * 2026-09-10), which Google says may be used as a plain text link. It is used here
 * instead of Google's publisher.js button: no third-party script on the page,
 * nothing new for the Content Security Policy to allow, no layout shift while a
 * widget loads, and a real link a screen reader announces by its own words.
 *
 * Only a whole domain or subdomain qualifies, never a subfolder, so the query is the
 * bare host with any leading "www." removed.
 */
export function preferredSourceHref(siteUrl: string = SITE.url): string {
  const host = new URL(siteUrl).hostname.replace(/^www\./, "");
  return `https://www.google.com/preferences/source?q=${encodeURIComponent(host)}`;
}
