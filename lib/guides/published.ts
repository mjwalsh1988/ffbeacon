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

import { ABBREVIATION_COUNT, TERM_COUNT } from "@/lib/guides/fantasy-football-terms";

export type PublishedGuide = {
  /** URL slug under /guides/. Permanent once shipped. */
  slug: string;
  /** Short label for menus and the footer, matching the Guides menu. */
  navLabel: string;
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
    navLabel: "Fantasy Football Terms",
    title: "Fantasy football terms and abbreviations, explained",
    summary: `Definitions for ${TERM_COUNT} fantasy football terms and ${ABBREVIATION_COUNT} abbreviations across scoring, league formats, lineup slots, injury tags, drafting, in-season management, trades, and analytics`,
    publishedAt: "2026-08-01T09:00:00-04:00",
    // 2026-09-18: an abbreviations section (status tags, lineup slots, column
    // headers, chat shorthand), eight new questions, a term finder, a scoring
    // switcher and five diagrams. The wording changed, so the date moves.
    updatedAt: "2026-09-18T09:00:00-04:00",
    priority: 0.8,
  },
  {
    slug: "fantasy-football-draft-guide",
    navLabel: "Draft Guide",
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
    navLabel: "How FF Beacon Works",
    title: "How FF Beacon works: the methodology behind every number",
    summary:
      "The projections, matchup model, reliability discount, and confidence figure behind every FF Beacon number, plus what the models do not know",
    publishedAt: "2026-09-10T09:00:00-04:00",
    updatedAt: "2026-09-10T09:00:00-04:00",
    priority: 0.6,
  },
  {
    slug: "positional-war-explained",
    navLabel: "Positional WAR Explained",
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
    navLabel: "FAAB Strategy",
    title: "FAAB strategy: how much to bid on the waiver wire",
    summary:
      "What FAAB is, how much of your budget to bid on each kind of pickup, when to spend it all, who to drop, and the waiver wire mistakes that lose leagues in October",
    publishedAt: "2026-09-15T09:00:00-04:00",
    // 2026-09-16: rebuilt as eight lessons with diagrams, a bid worksheet and
    // a pre-bid checklist.
    // 2026-09-19: a ninth lesson on chopped and guillotine leagues, and two
    // more questions in the FAQ. New prose, so the date moves.
    updatedAt: "2026-09-19T09:00:00-04:00",
    priority: 0.8,
  },
  {
    slug: "fantasy-football-trade-guide",
    navLabel: "Trade Guide",
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
    navLabel: "Superflex Strategy",
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
    navLabel: "Dynasty Strategy",
    title: "Dynasty fantasy football strategy: when to contend, when to rebuild",
    summary:
      "How to tell whether a dynasty roster should contend or rebuild, why the middle is the worst place to be, age curves against market price, rookie pick hit rates, the dynasty calendar, startups and taxi squads",
    // No year in the slug, for the same reason as the other strategy guides:
    // the method does not expire. The one live figure refreshes itself.
    publishedAt: "2026-09-18T09:00:00-04:00",
    updatedAt: "2026-09-18T09:00:00-04:00",
    priority: 0.8,
  },
  {
    slug: "fantasy-football-playoffs",
    navLabel: "Playoff Guide",
    title: "Fantasy football playoffs: your odds, your schedule, and how to win the title",
    summary:
      "How fantasy playoffs work, what playoff odds mean, luck against points for and the all-play record, buying or selling at the trade deadline, how much playoff schedules matter, and win-or-go-home lineups",
    // No year in the slug, for the same reason as the other strategy guides:
    // the method does not expire.
    publishedAt: "2026-09-18T12:00:00-04:00",
    updatedAt: "2026-09-18T12:00:00-04:00",
    priority: 0.8,
  },
  {
    slug: "faab-settings-by-platform",
    navLabel: "FAAB Settings",
    title: "FAAB and waiver settings on Sleeper, Yahoo and ESPN",
    summary:
      "What every waiver setting actually does: the three systems, budgets and minimum bids, when claims process, what you can still change mid-season, and a commissioner's short list",
    // The setup half of the waiver cluster. /guides/faab-strategy keeps the
    // bidding and /waiver-wire keeps the mechanics, so none of the three
    // competes with the others for the same query.
    publishedAt: "2026-09-22T09:00:00-04:00",
    updatedAt: "2026-09-22T09:00:00-04:00",
    priority: 0.7,
  },
  {
    slug: "chopped-league-strategy",
    navLabel: "Chopped Leagues",
    title: "Chopped and guillotine league strategy",
    summary:
      "What chopped, guillotine, death and knockout leagues are, how to draft for them, and how much FAAB to bid when a roster is cut",
    // "chopped" rather than "guillotine" in the slug: it is the rising term and
    // it is Sleeper's own name, while "guillotine" carries the title and the
    // H1. The plan is docs/faab/chopped-guillotine-guide-seo-plan.md 4.1.
    publishedAt: "2026-09-19T09:00:00-04:00",
    updatedAt: "2026-09-19T09:00:00-04:00",
    priority: 0.8,
  },
];

/**
 * Every guide, newest first. Two guides published at the same moment keep
 * their register order reversed (the one added later comes first), so the
 * order never depends on how a sort engine breaks ties.
 */
export function guidesNewestFirst(): PublishedGuide[] {
  return PUBLISHED_GUIDES.map((g, i) => ({ g, i }))
    .sort((a, b) => Date.parse(b.g.publishedAt) - Date.parse(a.g.publishedAt) || b.i - a.i)
    .map(({ g }) => g);
}

/** The most recently published guide, for surfaces that spotlight the newest one. */
export function newestPublishedGuide(): PublishedGuide {
  return guidesNewestFirst()[0];
}

/* ---------- The footer's Learn column ---------- */

/** Always in the footer, first: the glossary, the guide most readers arrive on. */
export const FOOTER_PINNED_GUIDE = "fantasy-football-terms";
/**
 * Never in the rolling list, because the footer links it in a fixed place of
 * its own beside the Rankings Board.
 */
export const FOOTER_FIXED_GUIDES = ["how-ff-beacon-works"];
/** How many of the newest guides follow the pinned one. */
export const FOOTER_NEWEST_COUNT = 5;

/**
 * The guide links in the footer's Learn column: the pinned glossary, the
 * newest few guides, and a link to the full shelf that carries the count.
 *
 * A short list rather than every guide, because the list grows with every
 * guide and a footer column that scrolls or runs to twenty lines is one a
 * sighted reader stops reading. Nothing is lost for a crawler or a keyboard
 * reader: every guide is still linked from /guides and from the Guides menu
 * on every page.
 */
export function footerGuideLinks(): { label: string; href: string }[] {
  const pinned = PUBLISHED_GUIDES.find((g) => g.slug === FOOTER_PINNED_GUIDE);
  const newest = guidesNewestFirst()
    .filter((g) => g.slug !== FOOTER_PINNED_GUIDE && !FOOTER_FIXED_GUIDES.includes(g.slug))
    .slice(0, FOOTER_NEWEST_COUNT);
  return [
    ...(pinned ? [pinned] : []),
    ...newest,
  ]
    .map((g) => ({ label: g.navLabel, href: `/guides/${g.slug}` }))
    .concat({ label: `All ${PUBLISHED_GUIDES.length} guides`, href: "/guides" });
}

/** Look up one published guide by slug, or undefined when it is not published. */
export function findPublishedGuide(slug: string): PublishedGuide | undefined {
  return PUBLISHED_GUIDES.find((g) => g.slug === slug);
}
