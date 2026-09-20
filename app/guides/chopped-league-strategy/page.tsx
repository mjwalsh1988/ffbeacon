import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { authorJsonLd, serializeJsonLd } from "@/lib/json-ld";
import { formatEasternDate } from "@/lib/datetime";
import { findPublishedGuide } from "@/lib/guides/published";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { GuideShell } from "@/components/guides/guide-shell";
import { GuideToc } from "@/components/guides/guide-toc";
import { GuideSectionHeader, GuideSubheading } from "@/components/guides/guide-section-header";
import { FaqAccordion, type FaqAccordionItem } from "@/components/faq-accordion";
import { faqPageJsonLd } from "@/components/tool-explainer";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { isDiscordMember } from "@/lib/discord-membership";
import { createAdminClient } from "@/lib/supabase/server";
import { loadPriorCellsCached } from "@/lib/faab/priors-read";
import { loadFaabSettings } from "@/lib/faab/settings";
import {
  NOT_ENOUGH,
  moneyPctText,
  newestBuiltAt,
  pctText,
  readCell,
  sampleText,
  shareText,
  type MarketRead,
} from "@/lib/guides/faab-market-figures";
import { SurvivalFigure } from "./chopped-figures";

/**
 * /guides/chopped-league-strategy
 *
 * Chopped, guillotine, death and knockout leagues: one format, seven names, in
 * Michael's first person for a reader who just joined one and has no idea
 * whether being average is safe.
 *
 * WHY THIS PAGE. The plan is docs/faab/chopped-guillotine-guide-seo-plan.md,
 * approved 2026-09-19. Short version of its research: "guillotine league" does
 * over 1,000 US searches a month at Easy difficulty and peaks in draft season,
 * "chopped league" is Sleeper's 2025 name and is up about 2.5 times year over
 * year on Google Trends, and the pages that rank today are almost all
 * draft-only. The FAAB guide keeps its own targets and links here; the
 * calculator keeps the "calculator" terms. This page owns the format and the
 * strategy.
 *
 * HOW THE PAGE IS ASSEMBLED. Every lesson number is read from the LESSONS
 * array, so the six lessons renumber themselves if one is ever added or
 * moved. The survival figure in lesson 2 lives in chopped-figures.tsx
 * (FB-G02). The measured tables in lessons 4 and 5 (FB-G03) are read from
 * faab_market_priors at render through lib/faab/priors-read.ts, never
 * hardcoded, and a cell under the calculator's own publishing threshold
 * (priors.minCellSamples) prints "Not enough data yet" rather than a figure
 * nobody should stand behind.
 *
 * EVERY NUMBER IS SOURCED OR LABELLED. Platform rules come from each
 * platform's own rules page, linked under the table in lesson 1. The Fantasy
 * Life bid medians and the NFFC Eliminator bands are published figures and are
 * attributed in the sentences that use them, as are Paul Charchian's pace
 * targets and the two arguments against them. The survival arithmetic in
 * lesson 2 is exact for equal-strength teams and says so. The bid figures in
 * lesson 4 are measured from our own synced leagues and carry their sample
 * size. The worked example in lesson 5 and the budget thresholds in the
 * endgame lesson are invented and rules of thumb respectively, and both say so
 * on the page.
 *
 * Source and format: this guide shows no player values, rankings or
 * projections, so it has nothing to resolve (the generic-guide exception in
 * CLAUDE.md).
 *
 * Article plus BreadcrumbList plus FAQPage, the FAQPage built from the same
 * array the accordion renders.
 */

const SLUG = "chopped-league-strategy";
const CANONICAL = `${SITE.url}/guides/${SLUG}`;
const OG_IMAGE = `${SITE.url}/api/og/guide/${SLUG}`;

// The register (lib/guides/published.ts) is the source of both dates. The
// literals below are the fallback the page shipped with and match the register
// row, so a missing entry cannot produce a blank datePublished.
const GUIDE = findPublishedGuide(SLUG);
const PUBLISHED_AT = GUIDE?.publishedAt ?? "2026-09-19T09:00:00-04:00";
const UPDATED_AT = GUIDE?.updatedAt ?? PUBLISHED_AT;

const TITLE = "Chopped and Guillotine League Strategy: Draft and FAAB";
const DESCRIPTION =
  "How to survive a chopped league on Sleeper, a Yahoo death league or an ESPN knockout league: what to draft, when to spend FAAB, and how much to bid when a roster is cut.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `/guides/${SLUG}` },
  keywords: [
    "chopped league strategy",
    "guillotine league strategy",
    "chopped league faab",
    "guillotine league faab",
    "sleeper chopped league",
    "what is a chopped league",
    "death league fantasy football",
    "knockout league fantasy football",
    "guillotine league draft strategy",
    "guillotine league waiver strategy",
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "article",
    title: TITLE,
    description: DESCRIPTION,
    url: CANONICAL,
    siteName: SITE.name,
    locale: "en_US",
    publishedTime: PUBLISHED_AT,
    modifiedTime: UPDATED_AT,
    authors: [SITE.author.name],
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export const dynamic = "force-dynamic";

const TOC_ITEMS = [
  { id: "what-heading", label: "What a chopped league is" },
  { id: "survive-heading", label: "The only goal each week" },
  { id: "draft-heading", label: "Drafting for it" },
  { id: "money-heading", label: "When rosters drop in bulk" },
  { id: "how-much-heading", label: "How much to bid" },
  { id: "endgame-heading", label: "The endgame" },
  { id: "mistakes-heading", label: "Mistakes that get you chopped" },
  { id: "faq-heading", label: "Questions, answered" },
];

const FAQ: FaqAccordionItem[] = [
  {
    question: "What is a chopped league on Sleeper?",
    answer:
      "It is a redraft league where the lowest scorer each week is eliminated and their whole roster goes back to waivers. Sleeper recommends 18 teams and a $1,000 FAAB budget, trades are off by default, and the last team left wins.",
  },
  {
    question: "Is a chopped league the same as a guillotine league?",
    answer:
      "Yes. Guillotine league is the older name. Yahoo now calls it a death league, ESPN calls it a knockout league, and the FFPC runs a Chop Classic. The rules differ in the details that matter: the minimum bid, the week chopped players stop being released, and how the final weeks are played.",
  },
  {
    question: "How much FAAB should I spend in a guillotine league?",
    answer:
      "Less than you think in September and more than you think once the field shrinks, and only on players who will start for you until the end. Prices fall as teams are eliminated. In Fantasy Life's 2024 guillotine leagues the median winning bid on Derrick Henry was $424 with about 11 teams alive and $241 with about 8. The FAAB calculator on this site prices a claim against your own roster and what your rivals have left to spend.",
  },
  {
    question: "How many teams should be in a guillotine league?",
    answer:
      "Eighteen is the most common, because 17 eliminations fill a 17-week season and leave one manager holding the trophy. Sleeper allows up to 32, and Yahoo public death leagues run 14 teams over 13 weeks.",
  },
  {
    question: "What happens on a tie for lowest score?",
    answer:
      "On Sleeper the team with fewer season points is chopped, and in week 1, when there are no season points yet, the better draft slot goes. Yahoo and the FFPC also look at season points first. Check your own league before you assume a tie goes your way.",
  },
  {
    question: "When do chopped players hit waivers?",
    answer:
      "After the week's elimination, on your league's normal waiver run. Some formats stop releasing them late in the season: the FFPC locks chopped players from week 15, and Fantasy Life guillotine leagues stopped releasing them after week 14 in 2024.",
  },
  {
    question: "Can you trade in a chopped league?",
    answer:
      "Usually not. Sleeper turns trades off by default, and the FFPC and the NFFC ban them outright. Assume you cannot until your commissioner says otherwise, which means your waiver budget is the only currency you have.",
  },
  {
    question: "Should I draft a kicker and defense?",
    answer:
      "Only if your league starts them. Several chopped formats do not: the FFPC Chop Classic lineup is a quarterback, two backs, two receivers, a tight end and two flexes. When a league does start them, stream both and spend as close to nothing as your minimum bid allows.",
  },
];

/**
 * The measured half of lessons 4 and 5, read once and handed down.
 *
 * `bands` keeps a row for every teams-alive band even when the cell is thin,
 * because a missing row would quietly shorten the table and leave a reader
 * thinking we only measured the part that suited us.
 */
type ChoppedMarket = {
  bands: { label: string; read: MarketRead | null }[];
  overall: MarketRead | null;
  updatedAt: string | null;
};

const BAND_LABELS: { key: string; label: string }[] = [
  { key: "chopped|any|any|alive_50p|any", label: "Half the field or more still in" },
  { key: "chopped|any|any|alive_30_50|any", label: "Between 30 and 50 percent left" },
  { key: "chopped|any|any|alive_lt30|any", label: "Under 30 percent left" },
];

async function loadChoppedMarket(): Promise<ChoppedMarket> {
  const [cells, settings] = await Promise.all([
    loadPriorCellsCached(),
    loadFaabSettings(createAdminClient()),
  ]);
  const minSamples = settings.priors.minCellSamples;
  const bands = BAND_LABELS.map((band) => ({
    label: band.label,
    read: readCell(cells, band.key, minSamples),
  }));
  const overall = readCell(cells, "chopped|any|any|any|any", minSamples);
  return {
    bands,
    overall,
    updatedAt: newestBuiltAt([overall, ...bands.map((b) => b.read)]),
  };
}

export default async function ChoppedLeagueStrategyGuide() {
  const [isMember, market] = await Promise.all([isDiscordMember(), loadChoppedMarket()]);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: TITLE,
      description: DESCRIPTION,
      inLanguage: "en-US",
      isAccessibleForFree: true,
      datePublished: PUBLISHED_AT,
      dateModified: UPDATED_AT,
      author: authorJsonLd(),
      publisher: {
        "@type": "Organization",
        name: SITE.name,
        url: SITE.url,
        logo: {
          "@type": "ImageObject",
          url: `${SITE.url}/img/ff-beacon-logo.png`,
        },
      },
      image: [{ "@type": "ImageObject", url: OG_IMAGE, width: 1200, height: 630 }],
      mainEntityOfPage: { "@type": "WebPage", "@id": CANONICAL },
      url: CANONICAL,
      articleSection: "Guides",
      about: {
        "@type": "Thing",
        name: "Chopped, guillotine, death and knockout fantasy football leagues",
      },
    },
    faqPageJsonLd(FAQ),
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE.url },
        { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE.url}/guides` },
        { "@type": "ListItem", position: 3, name: TITLE, item: CANONICAL },
      ],
    },
  ];

  return (
    <main id="main">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />

      <PageBody flush>
        <PageMasthead
          eyebrow="Guides"
          title="Chopped and guillotine league strategy"
          chips={[
            { label: "Guide", tone: "cyan" },
            { label: "Elimination leagues", tone: "purple" },
            { label: `${LESSON_WORDS[LESSONS.length]} lessons`, tone: "cyan" },
          ]}
        >
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-subtle">
            <time dateTime={PUBLISHED_AT}>{formatEasternDate(PUBLISHED_AT)}</time>
            <span>
              By{" "}
              <Link
                rel="author"
                href={SITE.author.bylineHref}
                className="font-semibold text-ink-muted underline underline-offset-2 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                {SITE.author.name}
              </Link>
            </span>
          </p>
        </PageMasthead>
      </PageBody>

      <GuideShell toc={<GuideToc items={TOC_ITEMS} />}>
        <article>
          <TheShortVersion />
          <Syllabus />

          <div className="text-[15px] sm:text-base">
            <WhatSection />
            <SurviveSection />
            <DraftSection />
            <MoneySection market={market} />
            <HowMuchSection />
            <EndgameSection />
            <MistakesSection />
            <FaqSection />
            <ClosingSection />
          </div>
        </article>
      </GuideShell>

      <DiscordCtaSection
        eyebrow="One bad week ends it"
        heading="Not sure whether your lineup is safe this week?"
        body="Post your roster and how many teams are left in our Discord and real players will tell you where your floor is, free. I am in there too."
        isMember={isMember}
        memberHeading="You know the format. Now price the claim."
        memberBody="You're already in the crew, so we'll skip the invite. The FAAB calculator prices a waiver claim against your real roster and what your rivals have left."
        memberCtaHref="/tools/faab"
        memberCtaLabel="Open the FAAB calculator"
      />
    </main>
  );
}

/* ---------- Shared bits ---------- */

const LINK_CLASS =
  "font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80";

function Para({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 leading-relaxed text-ink-muted">{children}</p>;
}

function BulletList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul role="list" className="mt-4 list-disc space-y-2 pl-6 leading-relaxed text-ink-muted">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/** The one sentence a lesson exists to leave behind. */
function KeyIdea({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 rounded-card border-l-4 border-brand-purple bg-surface p-4 sm:p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-purple">
        Key idea
      </p>
      <p className="mt-1 text-base font-medium leading-relaxed text-ink">{children}</p>
    </div>
  );
}

/** A pointer at the tool that runs the lesson's arithmetic on a real league. */
function TryIt({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6 flex flex-col gap-3 rounded-card border border-brand-cyan/40 bg-brand-cyan/5 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <p className="text-sm leading-relaxed text-ink-muted">
        <span className="font-semibold text-brand-cyan">Try it. </span>
        {children}
      </p>
      <Link
        href={href}
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-card border border-brand-cyan/50 bg-brand-cyan/10 px-4 py-2 text-sm font-semibold text-brand-cyan transition-colors hover:bg-brand-cyan/20 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        {label}
      </Link>
    </div>
  );
}

/**
 * A small table with a caption that says what the numbers are. Focusable and
 * named, as the other guides do it: Chrome does not make a scroll container
 * reachable by keyboard on its own.
 */
function GuideTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: string[][];
}) {
  return (
    <div
      className="mt-5 overflow-x-auto rounded-card border border-line bg-surface/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
      tabIndex={0}
      role="region"
      aria-label={caption}
    >
      <table className="w-full text-sm">
        <caption className="px-4 py-3 text-left text-xs text-ink-subtle">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]} className="border-b border-line/60 align-top last:border-0">
              {row.map((cell, i) =>
                i === 0 ? (
                  <th
                    key={cell}
                    scope="row"
                    className="px-4 py-2.5 text-left font-semibold text-ink"
                  >
                    {cell}
                  </th>
                ) : (
                  <td key={`${row[0]}-${i}`} className="px-4 py-2.5 text-ink-muted">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Short version ---------- */

function TheShortVersion() {
  return (
    <section
      aria-labelledby="short-version"
      className="rounded-card p-px"
      style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
    >
      <div className="rounded-card p-4 sm:p-5" style={{ background: "#16162A" }}>
        <h2
          id="short-version"
          className="text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: "#22D3EE" }}
        >
          The short version
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed sm:text-base" style={{ color: "#F4F4F8" }}>
          A chopped league asks one question every week: was your score the lowest in the league?
          Answer it wrong once and your season is over, so the roster you want is the dull one that
          never has a disaster, not the spiky one that wins some weeks by forty. The money works the
          same way. Your budget never resets, an entire roster hits the wire every time somebody is
          eliminated, and the price of a good player falls as the field shrinks.
        </p>
        <p className="mt-3 text-sm leading-relaxed" style={{ color: "#F4F4F8" }}>
          Guillotine league, death league, knockout league and Chop Classic are the same game under
          different names. The{" "}
          <Link
            href="/guides/faab-strategy"
            className="font-semibold text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            FAAB strategy
          </Link>{" "}
          guide covers bidding in a normal league; this one covers the format where the wire is the
          whole game.
        </p>
      </div>
    </section>
  );
}

/* ---------- Syllabus ---------- */

/**
 * The numbered lessons, in page order. Every lesson number on the page is read
 * from this array, so FB-G03 can insert its two lessons in the right place and
 * nothing else needs renumbering.
 */
const LESSONS: { title: string; href: string; takeaway: string }[] = [
  {
    title: "What a chopped league is",
    href: "#what-heading",
    takeaway: "One format, seven names.",
  },
  {
    title: "The only goal each week",
    href: "#survive-heading",
    takeaway: "Beat the worst team, not the best.",
  },
  {
    title: "Drafting for it",
    href: "#draft-heading",
    takeaway: "Draft the floor, buy the ceiling.",
  },
  {
    title: "When rosters drop in bulk",
    href: "#money-heading",
    takeaway: "A whole team, one Tuesday.",
  },
  {
    title: "How much to bid",
    href: "#how-much-heading",
    takeaway: "Hold, until holding costs you.",
  },
  {
    title: "The endgame",
    href: "#endgame-heading",
    takeaway: "Money left against players left.",
  },
];

const LESSON_WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
] as const;

/** "Lesson 3 of 6", counted from the array so an insertion renumbers itself. */
function lessonEyebrow(anchor: string): string {
  const i = LESSONS.findIndex((l) => l.href === anchor);
  return `Lesson ${i + 1} of ${LESSONS.length}`;
}

function Syllabus() {
  return (
    <section aria-labelledby="syllabus-heading" className="mt-8">
      <h2
        id="syllabus-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle"
      >
        The {LESSON_WORDS[LESSONS.length]} lessons
      </h2>
      <ol role="list" className="mt-3 grid gap-2 sm:grid-cols-2">
        {LESSONS.map((l, i) => (
          <li key={l.href}>
            <a
              href={l.href}
              className="flex min-h-11 items-start gap-3 rounded-card border border-line bg-surface/60 p-3 transition-colors hover:border-line-accent hover:bg-ink/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <span
                aria-hidden="true"
                className="font-mono text-sm font-semibold tabular-nums text-brand-cyan"
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">
                  <span className="sr-only">Lesson {i + 1}: </span>
                  {l.title}
                </span>
                <span className="block text-xs text-ink-muted">{l.takeaway}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------- Lesson 1: what a chopped league is ---------- */

/** The platform rules under the table in lesson 1, each read at the source. */
const PLATFORM_SOURCES: { name: string; href: string }[] = [
  {
    name: "Sleeper, Introduction to chopped leagues",
    href: "https://support.sleeper.com/en/articles/12005468-introduction-to-chopped-leagues",
  },
  {
    name: "Yahoo, Fantasy death leagues overview",
    href: "https://help.yahoo.com/kb/fantasy-football/overview-fantasy-guillotine-leagues-sln37116.html",
  },
  {
    name: "ESPN, What is a knockout league",
    href: "https://support.espn.com/hc/en-us/articles/18378552635156-What-is-a-Knockout-League",
  },
  {
    name: "FFPC, Chop Classic official rules",
    href: "https://myffpc.com/cms/public/play/chop-classic-leagues-official-rules",
  },
  {
    name: "Fantasy Life, guillotine league waiver wire",
    href: "https://www.fantasylife.com/tools/guillotine-league-waiver-wire",
  },
  {
    name: "MyFantasyLeague, Chop Leagues",
    href: "https://home.myfantasyleague.com/chopleagues.html",
  },
  { name: "NFFC, Eliminator rules", href: "https://nfc.shgn.com/rules/2703" },
];

function WhatSection() {
  return (
    <section aria-labelledby="what-heading" className="mt-12">
      <GuideSectionHeader
        id="what-heading"
        eyebrow={lessonEyebrow("#what-heading")}
        heading="What a chopped league is, and what everyone else calls it"
        tone="purple"
      />
      <Para>
        Every week the lowest scorer in the entire league is eliminated. Not the loser of your
        head-to-head game, the lowest score of all of them. When a team is chopped its whole roster
        goes straight back into the player pool, so the waiver wire in week 2 holds a full team
        worth of startable players. There is no bracket and there are no playoffs. The manager still
        standing at the end wins.
      </Para>
      <Para>
        Two more rules shape everything else. Trades are usually switched off, so your waiver budget
        is the only currency you have, and that budget is usually $1,000 and never resets. Nothing
        you spend in week 3 comes back in week 10.
      </Para>
      <Para>
        What that does to the season is bigger than it sounds. There is no record to dig out of and
        no schedule luck to complain about, because you are not playing an opponent. You are playing
        the floor of the league, every week, and the floor rises as the weak teams are removed.
      </Para>

      <GuideSubheading className="mt-8">The same format under seven names</GuideSubheading>
      <Para>
        Sleeper launched Chopped in August 2025 and never uses the word guillotine. Guillotine
        league is the older generic name and still the one most people search for. Yahoo calls its
        version a death league, ESPN calls its version a knockout league, and the high-stakes sites
        have had their own for years. The rules differ in ways that change how you should play, so
        read your own league's before the draft.
      </Para>
      <GuideTable
        caption="Elimination formats by platform, from each platform's own rules pages as of September 2026. Every row is linked under the table."
        head={["Format", "Teams", "Budget and bids", "The rules that differ"]}
        rows={[
          [
            "Sleeper Chopped",
            "Up to 32, 18 recommended",
            "$1,000 recommended",
            "Trades off by default. On a tie for the lowest score the team with fewer season points is chopped, and in week 1 it is the better draft slot. Sleeper also recommends PPR scoring and two injured reserve slots.",
          ],
          [
            "Yahoo Fantasy Death League",
            "14 in public leagues, up to 18 private",
            "$1,000",
            "Public leagues run 13 weeks, private ones up to 17. Eliminated players go through a forced one-day waiver. A tie goes against the team with fewer season points. Yahoo called this Guillotine Leagues in 2025.",
          ],
          [
            "ESPN Knockout",
            "12 or more recommended",
            "Not published",
            "Launched in July 2026. A 20-team league ends with two teams left, and the higher score in the final week takes the title.",
          ],
          [
            "FFPC Chop Classic",
            "18",
            "$1,000, $1 minimum",
            "No trades, and no adds at all once your budget is gone. Chopped rosters reach free agency on Tuesday morning in weeks 1 to 14, and from week 15 chopped players are locked. Lineup is a quarterback, two backs, two receivers, a tight end and two flexes, with 1.5 points per tight end catch.",
          ],
          [
            "Fantasy Life guillotine leagues",
            "18 in public leagues",
            "$1,000, $0 bids allowed",
            "Blind bidding on set days, with a tie going to the lower season points total. In 2024, week 14 was the last week a chopped roster was released.",
          ],
          [
            "MyFantasyLeague Chop Leagues",
            "18 ideal",
            "The league's choice",
            "Runs to week 17. The commissioner picks blind bidding or standard waivers.",
          ],
          [
            "NFFC Eliminator",
            "17",
            "$1,000, $1 minimum, no $0 bids",
            "One chop a week in weeks 1 to 13, then the last four teams play a total-points final over weeks 14 to 17. No trades.",
          ],
        ]}
      />
      <ul role="list" className="mt-4 grid gap-2 sm:grid-cols-2">
        {PLATFORM_SOURCES.map((s) => (
          <li key={s.href}>
            <a
              href={s.href}
              className="flex min-h-11 items-center rounded-card border border-line bg-surface/40 px-3 py-2 text-sm leading-snug text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {s.name}
            </a>
          </li>
        ))}
      </ul>

      <GuideSubheading className="mt-8">Death league, and the one name that means something else</GuideSubheading>
      <Para>
        Death league is Yahoo's 2026 branding for the same game, and chop league is what
        MyFantasyLeague and the FFPC call it. Survivor is the odd one out. A survivor pool asks you
        to pick one winning NFL team each week without repeating a team, and you are out when a pick
        loses. Sleeper runs one of those under the name Football Survivor. It has no rosters, no
        waiver budget and nothing in common with this format beyond the word.
      </Para>
      <KeyIdea>
        One question a week: was my score the lowest in the league? Every other rule in the format
        is downstream of that one.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 2: survival ---------- */

function SurviveSection() {
  return (
    <section aria-labelledby="survive-heading" className="mt-12">
      <GuideSectionHeader
        id="survive-heading"
        eyebrow={lessonEyebrow("#survive-heading")}
        heading="The only goal each week is not being last"
      />
      <Para>
        Start with the arithmetic, because it settles an argument people have every August. Take a
        league of 18 teams and imagine, for a moment, that every team is exactly as good as every
        other. Then each one has the same 1 in 18 chance of posting the lowest score, which is about
        5.6 percent. You survive week 1 about nineteen times out of twenty.
      </Para>
      <Para>
        Keep going and the numbers stay friendly for a long while. If nobody is better than anybody
        else, the order teams get chopped in is just a shuffle, so the chance you are still alive
        after k weeks is the number of teams left divided by the number you started with. After six
        chops that is 12 of 18, or two thirds. After twelve it is 6 of 18, a third. At the end it is
        1 in 18, which is the 5.6 percent you always had of winning the thing. Those figures are
        exact for equal-strength teams and no league is equal-strength, so treat them as the shape
        of the season rather than a forecast.
      </Para>
      <div className="mt-6">
        <SurvivalFigure />
      </div>
      <Para>
        Here is what the shape tells you. In September, being average is nearly always enough,
        because the score that gets chopped belongs to a team with three injured starters and a bye
        week nobody noticed. Your job in those weeks is to stay clear of the bottom, and the way you
        lose is not by being the second-worst team, it is by having one disaster. A boom-or-bust
        roster can score more points than mine across the season and still be eliminated in week 4,
        because it is the variance that kills you, not the average.
      </Para>
      <Para>
        Then the arithmetic turns. Every week the league removes its worst team, so the field you
        are measured against gets better and the lowest score climbs. Average is a safe place to be
        in September and a dangerous one in November, which is also the point in the season where
        the eliminated rosters have put real starters on the wire and your money can do something
        about it.
      </Para>
      <KeyIdea>
        You only have to beat the worst team in the league, which makes a high-floor roster the
        correct roster. The bar rises every week, so a plan that ends at the draft runs out in
        October.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 3: drafting ---------- */

function DraftSection() {
  return (
    <section aria-labelledby="draft-heading" className="mt-12">
      <GuideSectionHeader
        id="draft-heading"
        eyebrow={lessonEyebrow("#draft-heading")}
        heading="Drafting for a chopped league"
        tone="purple"
      />
      <Para>
        A normal draft is about upside, because a league season is thirteen or fourteen games and
        you can absorb a couple of bad ones. This draft is about not handing in a low score, ever,
        and the two goals pull in different directions often enough that a chopped board should look
        noticeably different from your redraft board.
      </Para>

      <GuideSubheading className="mt-8">Floor over ceiling</GuideSubheading>
      <Para>
        Draft the players who hand you a number every Sunday: the back who gets the carries whether
        or not the game script cooperates, and the receiver who still sees nine targets in a bad
        week. The deep threat who wins you a week in a head-to-head league is the
        same player who gives you a 3-point Sunday, and a 3-point Sunday in week 3 with sixteen
        teams still alive is how people get chopped in September.
      </Para>

      <GuideSubheading className="mt-8">Depth over stars</GuideSubheading>
      <Para>
        In an 18-team league the bench is short and the free agent pool at the start is bare, so a
        bye week or an early injury leaves you starting somebody who should not be on a roster. That
        is the disaster week. Two reliable starters are worth more here than one great player and a
        hole beside him.
      </Para>
      <Para>
        There is a second reason, and it is the one that makes this format fun. Talent arrives every
        single week. Somebody gets chopped, their roster lands on the wire, and the best player on
        it is available to whoever bids the most. You can buy a star in October with money. You
        cannot buy back the week you scored 62 points because your third receiver was on a bye.
        Draft the base and buy the peaks.
      </Para>

      <GuideSubheading className="mt-8">Byes cut both ways</GuideSubheading>
      <Para>
        The published advice splits on this one.{" "}
        <a href="https://jakobsanderson.substack.com/p/pre-season-mailbag-answers" className={LINK_CLASS}>
          Jakob Sanderson argues for early byes
        </a>
        : while the field is full the bar for last place is low, so a week with two starters missing
        is at its most survivable early. The case on the other side, which I lean toward, is that an
        early exit ends the season before any of your plan happens, and that by week 11 you will
        have replaced your bye-week starters with players bought off the wire anyway.
      </Para>
      <Para>
        What both sides agree on is the thing worth acting on: do not draft a cluster. Three
        starters sharing one bye week is a scheduled disaster, and in this format a scheduled
        disaster is a scheduled elimination. Check the bye columns before you take your fifth and
        sixth picks, not after.
      </Para>

      <GuideSubheading className="mt-8">Kickers, defenses and the superflex case</GuideSubheading>
      <Para>
        Several chopped formats do not start a kicker or a defense at all. The FFPC Chop Classic
        lineup is a quarterback, two backs, two receivers, a tight end and two flexes. If yours does
        start them, take them last and plan to stream: they are the cheapest weekly upgrade in the
        format and paying real money for either is money you will want in November.
      </Para>
      <Para>
        If your league starts two quarterbacks, the floor argument points straight at the position.
        Quarterbacks are the most predictable weekly scorers in fantasy football, and in a superflex
        league of this size the drop from a starting quarterback to whatever is left on the wire is
        the steepest drop on the board. The{" "}
        <Link href="/guides/superflex-strategy" className={LINK_CLASS}>
          superflex guide
        </Link>{" "}
        covers how many to roster and when to take them.
      </Para>
      <KeyIdea>
        Draft the floor and buy the ceiling. An entire roster hits the wire every week, so talent is
        the thing you can add later and a quiet Sunday is the thing you cannot undo.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 4: the money ---------- */

/** The budget the measured shares are converted into, and the format's norm. */
const REFERENCE_BUDGET = 1000;

function bandRow(label: string, read: MarketRead | null): string[] {
  if (!read || !read.enough) {
    return [
      label,
      NOT_ENOUGH,
      NOT_ENOUGH,
      NOT_ENOUGH,
      read ? `${read.sampleSize} claims so far` : "Nothing measured yet",
    ];
  }
  return [
    label,
    moneyPctText(read.p50, REFERENCE_BUDGET),
    moneyPctText(read.p75, REFERENCE_BUDGET),
    moneyPctText(read.p90, REFERENCE_BUDGET),
    sampleText(read),
  ];
}

function MoneySection({ market }: { market: ChoppedMarket }) {
  const wide = market.bands[0].read;
  const later = market.bands.slice(1).filter((b) => b.read !== null);

  return (
    <section aria-labelledby="money-heading" className="mt-12">
      <GuideSectionHeader
        id="money-heading"
        eyebrow={lessonEyebrow("#money-heading")}
        heading="How FAAB works when rosters drop in bulk"
        tone="purple"
      />
      <Para>
        The bidding itself works the way it does everywhere else, and the{" "}
        <Link href="/guides/faab-strategy" className={LINK_CLASS}>
          FAAB strategy
        </Link>{" "}
        guide covers that part. What changes here is the market around the bid. Four things
        about it are different, and each one pushes your number in a direction.
      </Para>
      <Para>
        Your budget never resets. A thousand dollars is what you get for the whole season, and
        every dollar you spend in week 3 is a dollar you do not have in week 12 when the field
        is half the size and the players on the wire are twice as good. There is no next year,
        and in most of these leagues no trade to make instead.
      </Para>
      <Para>
        Every surviving team is a rival. In a normal league, half the room has given up by
        October and will not bid against you on anything. Nobody in a chopped league has given
        up, because there is nothing here to give up on. You are alive or you are gone, and
        everyone alive wants the same players you do.
      </Para>
      <Para>
        A chopped roster arrives all at once. You are not pricing one player, you are pricing a
        quarterback, two backs and a receiver who land on the same Tuesday and compete with each
        other for the same money. Decide which of them actually starts for you before you write
        a single number down, because the second-best player in that group is often the one
        nobody else prices properly.
      </Para>
      <Para>
        And prices fall as the field shrinks. Fewer teams left means fewer bidders, and several
        of the teams still alive spent their budgets in September finding that out.
      </Para>

      <GuideSubheading className="mt-8">What our own chopped leagues paid</GuideSubheading>
      <Para>
        Every figure below is a winning bid measured as a share of the league&apos;s whole
        budget, which is the only honest way to add a $100 league to a $1,000 one, converted
        back into dollars of a $1,000 pot. These are anonymous aggregates from the chopped
        leagues synced into League Pulse, with nothing identifying a league, a manager or a
        roster.
      </Para>
      <GuideTable
        caption="Winning bids in chopped leagues by how much of the field was still alive, from leagues synced into FF Beacon. Dollars are what the share is worth in a $1,000 budget, with the share itself in brackets."
        head={[
          "Teams still alive",
          "Half cleared under",
          "Top quarter above",
          "Top tenth above",
          "What we measured",
        ]}
        rows={market.bands.map((band) => bandRow(band.label, band.read))}
      />
      {market.updatedAt && (
        <p className="mt-2 text-xs text-ink-subtle">
          Updated {formatEasternDate(market.updatedAt)}, and rebuilt whenever the leagues behind
          it resync.
        </p>
      )}
      {wide?.enough && (
        <Para>
          Two things in that top row are worth sitting with. The first is how much of this market
          is free: {shareText(wide.zeroShare)} percent of the winning claims cost nothing at all,
          because most of what a chopped roster puts on the wire is a bench player nobody else
          wants. The second is the other end of the same distribution. The dearest tenth of those
          claims cleared above {moneyPctText(wide.p90, REFERENCE_BUDGET)}, and that is from{" "}
          {sampleText(wide)}. Almost everything is free, and the few players who are not are the
          season.
        </Para>
      )}
      {later.length > 0 && (
        <Para>
          The rows below it are thin and you should treat them that way:{" "}
          {later
            .map((band) => `${band.label.toLowerCase()} is ${sampleText(band.read!)}`)
            .join(", and ")}
          . That is one room&apos;s habits rather than a market. Chopped leagues are new, most of
          the ones we hold have not played out that far yet, and these rows will mean something
          in a season or two.
        </Para>
      )}

      <GuideSubheading className="mt-8">What the published guillotine data says</GuideSubheading>
      <Para>
        Older, larger guillotine data sets say the same thing with better names attached. Fantasy
        Life recorded the median winning bid in its 2024 guillotine leagues on the same players as
        the field shrank: Justin Jefferson fell from $434 to $340, Derrick Henry from $424 with
        about eleven teams alive to $241 with about eight, and Amon-Ra St. Brown from $333 all the
        way to $76.
      </Para>
      <Para>
        The NFFC Eliminator&apos;s 2025 figures put it in percentages of the budget. A top-twelve
        running back went for 28.9 percent while half the field or more was alive, 12.8 percent
        once between 30 and 50 percent of teams were left, and nothing at all below that, because
        by then the survivors had either spent their money or had no room to use him.
      </Para>
      <Para>
        Two different data sets, one lesson. The same player is worth less every week the league
        gets smaller, so the question is never only what he is worth. It is what he is worth
        against what will be released next Tuesday, and against the money you will still have
        when it is.
      </Para>
      <KeyIdea>
        The price of a player falls as the field shrinks, and your budget does not come back.
        Every bid is a bet that nobody better is dropped later.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 5: how much to bid ---------- */

const FIELD_LABEL =
  "block text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle";
const FIELD_INPUT =
  "mt-2 min-h-11 w-full rounded-card border border-line bg-base px-3 py-2.5 text-base text-ink focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30 sm:text-sm";

/**
 * The danger check (task FB-G04).
 *
 * A native GET form pointed straight at the calculator, which parses
 * kind, start, alive and danger in app/tools/faab/manual-setup.ts and seeds
 * its manual chopped mode from them. No JavaScript, no state, and nothing
 * priced here: the guide has no business putting a number on a bid, and a
 * form that submits to a URL is both the simplest thing that works and the
 * one that still works with scripting off.
 *
 * Budget and starting lineup are deliberately not asked for. The calculator
 * ignores them in a link, so a field here would be typed once and thrown
 * away, and the copy says where they are asked for instead.
 */
function DangerCheck() {
  return (
    <form
      action="/tools/faab"
      method="get"
      aria-labelledby="danger-check-heading"
      className="mt-6 rounded-card border border-brand-cyan/40 bg-brand-cyan/5 p-4 sm:p-5"
    >
      <h4 id="danger-check-heading" className="text-sm font-semibold text-brand-cyan">
        Check where you stand
      </h4>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">
        Three answers, and the calculator opens on its chopped mode with them already filled in.
        It asks for your budget and your starting lineup there, because those do not travel in a
        link.
      </p>
      <input type="hidden" name="kind" value="chopped" />
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="danger-start" className={FIELD_LABEL}>
            Teams at the draft
          </label>
          <input
            id="danger-start"
            name="start"
            type="number"
            inputMode="numeric"
            min={2}
            max={32}
            step={1}
            defaultValue={18}
            className={FIELD_INPUT}
          />
        </div>
        <div>
          <label htmlFor="danger-alive" className={FIELD_LABEL}>
            Teams still alive
          </label>
          <input
            id="danger-alive"
            name="alive"
            type="number"
            inputMode="numeric"
            min={2}
            max={32}
            step={1}
            defaultValue={12}
            className={FIELD_INPUT}
          />
        </div>
        <div>
          <label htmlFor="danger-rank" className={FIELD_LABEL}>
            Your rank on season points
          </label>
          <select id="danger-rank" name="danger" defaultValue="near-cut" className={FIELD_INPUT}>
            <option value="bottom-two">Bottom two in the league</option>
            <option value="near-cut">Near the cut</option>
            <option value="mid-pack">Middle of the pack</option>
            <option value="safe">Comfortably safe</option>
          </select>
        </div>
      </div>
      <button
        type="submit"
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-card border border-brand-cyan/50 bg-brand-cyan/10 px-4 py-2 text-sm font-semibold text-brand-cyan transition-colors hover:bg-brand-cyan/20 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        Open the chopped FAAB calculator with these numbers
      </button>
    </form>
  );
}

function HowMuchSection() {
  return (
    <section aria-labelledby="how-much-heading" className="mt-12">
      <GuideSectionHeader
        id="how-much-heading"
        eyebrow={lessonEyebrow("#how-much-heading")}
        heading="How much to bid in a chopped league"
      />
      <Para>
        This is the question everybody asks in week 2, and the published answers disagree with
        each other, which is worth knowing before you take any of them.
      </Para>

      <GuideSubheading className="mt-8">The case for holding</GuideSubheading>
      <Para>
        Paul Charchian publishes pace targets for a $1,000 guillotine budget: still hold about
        $900 at the end of September, about $750 at the end of October, and about $250 at the end
        of November. The ledger of a 2024 champion published alongside them ran even tighter.
        That manager had $969 after week 4, $904 after week 8, $240 after week 12 and $11 after
        week 14. He spent almost nothing while the field was large, then nearly all of it
        between weeks 9 and 14.
      </Para>
      <Para>
        The logic is the one the table in the last lesson shows. Early prices are the highest of
        the season and the players on offer are the worst, because a week 2 chopped roster is the
        worst roster in the league. Waiting buys the same shelf later at a discount, which makes
        it the aggressive move rather than the timid one.
      </Para>

      <GuideSubheading className="mt-8">The case against holding</GuideSubheading>
      <Para>
        Masters Fantasy Football argues for committing 20 to 35 percent of the budget in
        September, on the grounds that a roster good enough to survive is what buys you the right
        to spend anything later. Ben Gretch makes a barbell argument in his guillotine writing:
        spend early, when one upgrade genuinely moves your floor, and spend late, when money is
        about to expire, and avoid the middle of the season, where you pay real prices for
        marginal players.
      </Para>
      <Para>
        Both objections land on the same weakness in a pure hold plan. A budget is only an asset
        while you are still in the league, and the manager who went out in week 5 with $940
        unspent had the pace exactly right and is still out.
      </Para>

      <GuideSubheading className="mt-8">Where I land</GuideSubheading>
      <Para>
        Two conditions, and I want at least one of them before I spend anything real.
      </Para>
      <BulletList
        items={[
          <>
            <strong className="text-ink">He starts for me through the final week.</strong> Every
            Sunday until the league ends, rather than the one in front of me. A player who
            patches one bye is a
            minimum bid in this format, whatever he did last weekend, because the roster that gets
            chopped next week will probably have a better version of him on it.
          </>,
          <>
            <strong className="text-ink">Or my survival odds this week are genuinely in
            danger.</strong> When the thing you are buying is not finishing last on Sunday, the
            price of the player stops being the point. A team on the edge of the cut should
            outbid a safe team on the same player, every time, and a safe team should let it
            happen.
          </>,
        ]}
      />
      <Para>
        With neither of those true, hold. The market you are waiting for is measurably cheaper
        than the one in front of you, and every week you survive takes another bidder out of it.
      </Para>

      <GuideSubheading className="mt-8">The danger ladder</GuideSubheading>
      <Para>
        Where you sit this week should move your number more than anything about the player does.
        Find yourself on this ladder before you bid. No percentages here on purpose: your league
        size, your scoring and who is left all move the real numbers, and the calculator prices
        them against your actual league rather than against a rule of thumb.
      </Para>
      <BulletList
        items={[
          <>
            <strong className="text-ink">Bottom two on the week&apos;s projections.</strong> You
            are bidding to stay in the league, so bid like it. The correct amount is whatever it
            takes to be the top bid on the best player who starts for you this Sunday, and saving
            money for a season you will not be in is the only real mistake available to you.
          </>,
          <>
            <strong className="text-ink">Near the cut but not in it.</strong> Buy the upgrade
            that raises your floor, not the one that raises your ceiling. Pay a premium over what
            you think he is worth, because the alternative is finding out on Sunday afternoon.
          </>,
          <>
            <strong className="text-ink">Middle of the pack.</strong> This is where the format is
            most often misplayed. You have no emergency, so bid on the season instead: only the
            player who starts for you every week from here, and only at a price that leaves you
            able to do it again.
          </>,
          <>
            <strong className="text-ink">Comfortably safe.</strong> Let the desperate teams pay.
            Your money is worth more next week, when two of them are gone and their rosters are
            on the wire, and the only claim worth making now is the cheap one nobody noticed.
          </>,
        ]}
      />
      <Para>
        The{" "}
        <Link href="/tools/faab" className={LINK_CLASS}>
          chopped FAAB calculator
        </Link>{" "}
        weighs this the same way. It simulates the rest of your season, works out your odds of
        being chopped this week with the player and without him, and prices the claim higher when
        the week itself is the thing at risk.
      </Para>
      <DangerCheck />

      <GuideSubheading className="mt-8">A worked example, with made-up numbers</GuideSubheading>
      <Para>
        Every figure in this example is invented. It is here to show the order the questions come
        in, not to tell you what a running back costs.
      </Para>
      <GuideTable
        caption="An invented mid-season claim in an 18-team chopped league, walked through in order. Every number here is made up."
        head={["Step", "The question", "The answer"]}
        rows={[
          [
            "1. Where the league is",
            "How much of the field is left?",
            "12 of the 18 teams are alive in week 7, and a chopped roster just released a top running back",
          ],
          [
            "2. Where I am",
            "Am I in danger this week?",
            "Third from bottom on points scored, so a quiet Sunday is a real elimination risk",
          ],
          [
            "3. Weeks started",
            "Does he start for me from here to the end?",
            "Yes, straight into the flex over a back who has averaged 7 a week",
          ],
          [
            "4. What it buys",
            "What does that do to my floor?",
            "About 5 points a week in the slot that has been sinking me, which is the whole problem",
          ],
          [
            "5. The room",
            "Who else can outbid me, and do they need him?",
            "Four teams have more than $400 left. Two of them start a back I would not want either",
          ],
          [
            "6. The bid",
            "What wins without wrecking November?",
            "$260 of the $640 I have left. Enough to beat two funded rivals, and it leaves $380",
          ],
          [
            "7. The walk-away",
            "Where does winning stop being worth it?",
            "$340. Above that I am buying six safe weeks with the money for the last four",
          ],
        ]}
      />
      <Para>
        Notice which step did the work. Being third from bottom is what turned an ordinary
        upgrade into a bid worth 40 percent of a remaining budget, and a safe team looking at the
        identical player should have bid half as much and been pleased to lose him.
      </Para>
      <KeyIdea>
        Spend on the players who start for you until the end, and on the weeks you might not
        survive. Everything else is a reason to wait for next Tuesday.
      </KeyIdea>
      <TryIt href="/tools/faab" label="Price a chopped claim">
        Connect your Sleeper chopped league and the calculator reads who is still alive, what
        they have left to spend, and your own odds of being chopped this week with the player and
        without him.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 6: the endgame ---------- */

function EndgameSection() {
  return (
    <section aria-labelledby="endgame-heading" className="mt-12">
      <GuideSectionHeader
        id="endgame-heading"
        eyebrow={lessonEyebrow("#endgame-heading")}
        heading="The endgame: money left against players left"
      />
      <Para>
        By the last few weeks the format has turned into a small, rich auction. Six or seven teams
        remain, each one a survivor, and the two numbers that decide the title are how much of your
        budget is left and whether anybody worth buying is still being released.
      </Para>

      <GuideSubheading className="mt-8">Find your release cutoff before you plan</GuideSubheading>
      <Para>
        Several formats stop feeding the wire before the season ends. The{" "}
        <a href="https://myffpc.com/cms/public/play/chop-classic-leagues-official-rules" className={LINK_CLASS}>
          FFPC Chop Classic
        </a>{" "}
        locks chopped players from week 15, and{" "}
        <a href="https://www.fantasylife.com/tools/guillotine-league-waiver-wire" className={LINK_CLASS}>
          Fantasy Life guillotine leagues
        </a>{" "}
        stopped releasing them after week 14 in 2024. The NFFC Eliminator switches format entirely
        for the last four weeks, with the surviving four teams playing a total-points final. That
        cutoff is a deadline on your money. If nothing is released after week 14, every dollar you
        are holding in week 15 has already turned into nothing, and holding it was the mistake, not
        the caution.
      </Para>

      <GuideSubheading className="mt-8">What to do with what you have</GuideSubheading>
      <Para>
        These thresholds are rules of thumb I use, not measurements, and they assume the usual
        $1,000 budget:
      </Para>
      <BulletList
        items={[
          <>
            <strong className="text-ink">Two thirds or more left.</strong> You are the richest team
            in a shrinking market, and the market is about to hand you an elite player. Be the top
            bid on him. Being outbid here by a team with a quarter of your budget is the worst
            outcome available to you.
          </>,
          <>
            <strong className="text-ink">A third to two thirds.</strong> You cannot win every
            auction, so stop entering all of them. Pick the one lineup slot that is genuinely
            costing you points, buy the best player available for it, and let the rest go.
          </>,
          <>
            <strong className="text-ink">Under a third.</strong> You are streaming now. Fill your
            weakest slot on matchup, bid at or just above the minimum, and accept that your roster
            is what it is. Winning from here means the draft carried you.
          </>,
        ]}
      />
      <Para>
        The comfort is that prices fall with the field. Fewer teams left means fewer bidders on the
        same player, and several of the teams still alive spent their budgets in September working
        that out. A player who cost $400 in week 5 can go for a quarter of that in week 13, and the
        discipline that got you there is what buys him.
      </Para>
      <Para>
        One more thing about the final week. In most formats the last two or four teams settle it on
        score, so the endgame is the one moment in a chopped league where ceiling beats floor. When
        you need to outscore one specific team rather than avoid being last, the boom-or-bust player
        you correctly avoided all season is suddenly the right start.
      </Para>
      <KeyIdea>
        Money you carry past your league's release cutoff bought nothing. Find that week in August
        and treat it as the day the budget expires.
      </KeyIdea>
    </section>
  );
}

/* ---------- Mistakes ---------- */

function MistakesSection() {
  return (
    <section aria-labelledby="mistakes-heading" className="mt-12">
      <GuideSectionHeader
        id="mistakes-heading"
        eyebrow="Been there"
        heading="Mistakes that get you chopped"
        tone="purple"
      />
      <BulletList
        items={[
          <>
            <strong className="text-ink">Spending half the budget in week 1.</strong> Full wallets
            and one game of evidence make the first waiver run the worst market of the year, and
            there are another sixteen weeks of rosters coming.
          </>,
          <>
            <strong className="text-ink">Drafting a bye cluster.</strong> Three starters off in the
            same week is a scheduled low score. It is the easiest elimination in the format to
            avoid and the one I still see every season.
          </>,
          <>
            <strong className="text-ink">Paying a starter&apos;s price for a patch.</strong> A
            player you need for two weeks is worth two weeks. The bid should reflect how many
            Sundays he is actually in your lineup, not how good he looked on Sunday.
          </>,
          <>
            <strong className="text-ink">Not reading the tiebreaks.</strong> On Sleeper a tie for
            the lowest score goes against the team with fewer season points, and in week 1 against
            the better draft slot. The FFPC settles a tied bid on worst total points, then worst
            previous week. Both of those change a decision you will actually face.
          </>,
          <>
            <strong className="text-ink">Managing to your average.</strong> There are no standings
            here and nobody hands out a prize for points scored. A season of 120-point weeks and one
            60 is a loss, and a season of 95s is a win.
          </>,
          <>
            <strong className="text-ink">Going out with money in the bank.</strong> Leftover FAAB in
            a format with no next season is the clearest waste in fantasy football. If you are still
            holding half your budget in November, you have been playing not to lose in a game where
            everybody else already lost.
          </>,
        ]}
      />
    </section>
  );
}

/* ---------- FAQ ---------- */

function FaqSection() {
  return (
    <section aria-labelledby="faq-heading" className="mt-12">
      <GuideSectionHeader id="faq-heading" eyebrow="FAQ" heading="Questions, answered" />
      <div className="mt-6">
        <FaqAccordion items={FAQ} />
      </div>
    </section>
  );
}

/* ---------- Closing ---------- */

function ClosingSection() {
  return (
    <section aria-labelledby="closing-heading" className="mt-12">
      <GuideSectionHeader
        id="closing-heading"
        eyebrow="Next"
        heading="Run it on your own league"
        tone="purple"
      />
      <Para>
        When a roster is chopped and you have to put a number on somebody, the{" "}
        <Link href="/tools/faab" className={LINK_CLASS}>
          FAAB calculator
        </Link>{" "}
        prices the claim against your actual lineup and what your rivals have left to spend, and
        gives you a walk-away line. The{" "}
        <Link href="/guides/faab-strategy" className={LINK_CLASS}>
          FAAB strategy
        </Link>{" "}
        guide is the season-long reasoning behind it, and most of it carries over. Bid on the weeks
        a player actually starts for you, and never win an auction you should have lost.
      </Para>
      <Para>
        If your chopped league is on Sleeper, sync it in{" "}
        <Link href="/tools/league-pulse" className={LINK_CLASS}>
          League Pulse
        </Link>{" "}
        and you can see every surviving roster alongside what the field around you has been
        spending. And if a term on this page was new, guillotine league and the rest of the
        vocabulary are in the{" "}
        <Link href="/guides/fantasy-football-terms#guillotine-league" className={LINK_CLASS}>
          glossary
        </Link>
        .
      </Para>
      <TryIt href="/tools/faab" label="Price a claim">
        A whole roster just hit your wire. Enter your league size, starters and remaining budget, or
        connect Sleeper, and the calculator tells you where to stop.
      </TryIt>
    </section>
  );
}
