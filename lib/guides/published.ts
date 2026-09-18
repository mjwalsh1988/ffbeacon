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
  {
    slug: "fantasy-football-draft-guide",
    title: "Fantasy football draft guide: steals, swings, and fades",
    summary:
      "The players going later than they should in each format, from FF Beacon values and projected points above a replacement starter measured against real draft ADP",
    // No year in the slug on purpose: the method does not expire even though the
    // names on it refresh nightly, and a dated URL would need redirecting every
    // August. See the note at the top of the page component.
    publishedAt: "2026-08-12T09:00:00-04:00",
    updatedAt: "2026-08-12T09:00:00-04:00",
    priority: 0.8,
  },
  {
    slug: "how-ff-beacon-works",
    title: "How FF Beacon works: the methodology behind every number",
    summary:
      "The projections, matchup model, reliability discount, and confidence figure behind every FF Beacon number, plus what the models do not know",
    publishedAt: "2026-09-10T09:00:00-04:00",
    updatedAt: "2026-09-10T09:00:00-04:00",
    priority: 0.6,
  },
  {
    slug: "positional-war-explained",
    title: "Positional WAR explained: what WAR means in fantasy football",
    summary:
      "What wins above replacement means for a fantasy roster, why scarcity beats raw points, how to read the Positional WAR curve for your own league, and the three decisions it should change",
    publishedAt: "2026-09-15T09:00:00-04:00",
    // 2026-09-16: rebuilt as seven lessons with diagrams and two interactive
    // boxes. The prose changed shape, so the date moves.
    updatedAt: "2026-09-16T09:00:00-04:00",
    priority: 0.8,
  },
  {
    slug: "faab-strategy",
    title: "FAAB strategy: how much to bid on the waiver wire",
    summary:
      "What FAAB is, how much of your budget to bid on each kind of pickup, when to spend it all, who to drop, and the waiver wire mistakes that lose leagues in October",
    publishedAt: "2026-09-15T09:00:00-04:00",
    // 2026-09-16: rebuilt as eight lessons with diagrams, a bid worksheet and
    // a pre-bid checklist.
    updatedAt: "2026-09-16T09:00:00-04:00",
    priority: 0.8,
  },
  {
    slug: "fantasy-football-trade-guide",
    title: "Fantasy football trade guide: how to judge any trade",
    summary:
      "How to judge a fantasy football trade before you send it: value against wins, the 2-for-1 trap, buying low without fooling yourself, dynasty picks, timing, and how to pitch it",
    // No year in the slug, for the same reason as the draft guide: the method
    // does not expire.
    publishedAt: "2026-09-15T12:00:00-04:00",
    updatedAt: "2026-09-15T12:00:00-04:00",
    priority: 0.8,
  },
  {
    slug: "superflex-strategy",
    title: "Superflex strategy: how to draft, roster and trade quarterbacks",
    summary:
      "What a superflex slot changes, how many quarterbacks to roster in redraft, dynasty and best ball, when to draft them, how to trade the spare, managing byes, and how TE premium stacks on top",
    // No year in the slug, for the same reason as the draft and trade guides:
    // the method does not expire. The one live figure refreshes itself.
    publishedAt: "2026-09-16T09:00:00-04:00",
    updatedAt: "2026-09-16T09:00:00-04:00",
    priority: 0.8,
  },
  {
    slug: "dynasty-strategy",
    title: "Dynasty fantasy football strategy: when to contend, when to rebuild",
    summary:
      "How to tell whether a dynasty roster should contend or rebuild, why the middle is the worst place to be, age curves against market price, rookie pick hit rates, the dynasty calendar, startups and taxi squads",
    // No year in the slug, for the same reason as the other strategy guides:
    // the method does not expire. The one live figure refreshes itself.
    publishedAt: "2026-09-18T09:00:00-04:00",
    updatedAt: "2026-09-18T09:00:00-04:00",
    priority: 0.8,
  },
];

/** The most recently published guide, for surfaces that spotlight the newest one. */
export function newestPublishedGuide(): PublishedGuide {
  return [...PUBLISHED_GUIDES].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  )[0];
}

/** Look up one published guide by slug, or undefined when it is not published. */
export function findPublishedGuide(slug: string): PublishedGuide | undefined {
  return PUBLISHED_GUIDES.find((g) => g.slug === slug);
}
