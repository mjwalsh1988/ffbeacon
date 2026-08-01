/**
 * The register of guides that have a real, indexable page.
 *
 * Four consumers read this and they must not disagree:
 *   app/sitemap.ts          advertises each URL with a true lastModified
 *   app/llms.txt/route.ts   feeds the same list to answer engines
 *   app/guides/[...]/page.tsx  reads its own dates for metadata + Article schema
 *   lib/site.ts             footer "Learn" column links
 *
 * A guide belongs here only once its page returns 200. The rule from
 * app/sitemap.ts applies: a sitemap that lists a placeholder teaches Google to
 * distrust the whole file, so "coming soon" cards on /guides stay out of this
 * array until they are written.
 *
 * `updatedAt` is edited BY HAND, and only when the wording actually changes.
 * Deriving it from the build clock would make every deploy claim that every guide
 * changed, which is the unreliable-lastmod failure mode the sitemap comments
 * describe at length.
 */

import { TERM_COUNT } from "@/lib/guides/fantasy-football-terms";

export type PublishedGuide = {
  /** URL slug under /guides/. Permanent once shipped. */
  slug: string;
  /** Link text for machine-readable surfaces (llms.txt). */
  title: string;
  /** One line describing what the guide covers. */
  summary: string;
  /** ISO 8601 with an explicit offset. */
  publishedAt: string;
  /** ISO 8601 with an explicit offset. Bump only on a real content change. */
  updatedAt: string;
  /** sitemap.xml priority. */
  priority: number;
};

export const PUBLISHED_GUIDES: PublishedGuide[] = [
  {
    slug: "fantasy-football-terms",
    title: "Fantasy football terms: a plain-English glossary",
    summary: `Definitions for ${TERM_COUNT} fantasy football terms across scoring, league formats, rosters, drafting, in-season management, trades, and analytics`,
    publishedAt: "2026-08-01T09:00:00-04:00",
    updatedAt: "2026-08-01T09:00:00-04:00",
    priority: 0.8,
  },
];

/** Look up one published guide by slug, or undefined when it is not published. */
export function findPublishedGuide(slug: string): PublishedGuide | undefined {
  return PUBLISHED_GUIDES.find((g) => g.slug === slug);
}
