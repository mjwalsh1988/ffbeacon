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
import { GuideSectionHeader } from "@/components/guides/guide-section-header";
import { FaqAccordion, type FaqAccordionItem } from "@/components/faq-accordion";
import { faqPageJsonLd } from "@/components/tool-explainer";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { isDiscordMember } from "@/lib/discord-membership";
import { BidBandsFigure, BidLadderFigure, PickupWorthFigure } from "./faab-figures";
import { BidWorksheet, PreBidChecklist } from "./faab-classroom";
import { createAdminClient } from "@/lib/supabase/server";
import { loadPriorCellsCached } from "@/lib/faab/priors-read";
import { loadFaabSettings } from "@/lib/faab/settings";
import { calendarMultiplier } from "@/lib/faab/market";
import {
  NOT_ENOUGH,
  moneyText,
  newestBuiltAt,
  pctText,
  readCell,
  sampleText,
  shareText,
  type MarketRead,
} from "@/lib/guides/faab-market-figures";

/**
 * /guides/faab-strategy
 *
 * The waiver wire playbook, written in Michael's first person for a reader who
 * has a budget, a Tuesday night, and no idea whether $23 is a lot.
 *
 * WHY THIS PAGE. "faab calculator" is the one search this site already wins
 * (Search Console, 90 days to 2026-09-14: 246 impressions at position 8.5),
 * and Google's own suggestions around it are the questions this page answers:
 * "faab strategy", "faab bidding strategy", "how much faab should i spend",
 * "how much faab to spend on rookies", "waiver wire strategy fantasy football",
 * "waiver wire bidding strategy", "dynasty faab strategy". The calculator
 * answers one claim at a time; this page is the season-long reasoning behind
 * its answers.
 *
 * THE BID RANGES ARE RULES OF THUMB, AND NO LONGER THE MODEL. The tiers in the
 * "how much" section are the bid curve bands in lib/faab/default-settings.ts
 * (elite 65 to 100 percent, high-end starter 40 to 65, strong weekly starter
 * 25 to 40, starter-level 14 to 25, useful depth 8 to 14, bench 4 to 8,
 * speculative 1 to 4, flyer 0 to 2), merged into four plain-English buckets.
 * Since the overhaul the calculator prices from the auction model in
 * lib/faab/auction.ts against the measured market in faab_market_priors, and
 * those bands survive only as the fallback for a player it cannot project. The
 * page says so.
 *
 * THE TIMING LESSON FOLLOWS THE MEASURED CALENDAR, NOT THE OLD DISCOUNT. It
 * used to describe lib/faab/market.ts urgencyMultiplier, a straight-line ramp
 * that took 15 percent off the first three weeks on the theory that early
 * money has option value. Our own priced winning bids say the market does the
 * opposite, so that ramp was replaced by market.calendar in
 * lib/faab/default-settings.ts (week 1 at 1.0, weeks 2 to 6 at 1.1, weeks 7 to
 * 10 at 0.9, weeks 11 to 13 at 1.0, week 14 on at 1.3) and the lesson now
 * quotes the phase table those bands came from. The walk-away number and the
 * drop list are lib/faab/ladder.ts and lib/faab/marginal.ts. An admin can
 * change any of it, so the page reads the live settings where it quotes them.
 *
 * THE MEASURED FIGURES ARE READ AT RENDER. Everything on this page attributed
 * to "the leagues we hold" comes from faab_market_priors through
 * lib/faab/priors-read.ts and lib/guides/faab-market-figures.ts, with its
 * sample size beside it. A cell under the calculator's own publishing
 * threshold prints "Not enough data yet" instead of a number.
 *
 * NINE LESSONS, FOUR DIAGRAMS, TWO INTERACTIVES, the same shape as the trade
 * guide. The diagrams are in faab-figures.tsx and the interactives in
 * faab-classroom.tsx. EVERY WORKED NUMBER IS INVENTED AND SAYS SO, in the
 * figure captions, in the worksheet, and in the worked example.
 *
 * Article plus BreadcrumbList plus FAQPage, the FAQPage built from the same
 * array the accordion renders.
 */

const SLUG = "faab-strategy";
const CANONICAL = `${SITE.url}/guides/${SLUG}`;
const OG_IMAGE = `${SITE.url}/api/og/guide/${SLUG}`;

const GUIDE = findPublishedGuide(SLUG);
const PUBLISHED_AT = GUIDE?.publishedAt ?? "2026-09-15T09:00:00-04:00";
const UPDATED_AT = GUIDE?.updatedAt ?? PUBLISHED_AT;

const TITLE = "FAAB Strategy: How Much to Bid on the Waiver Wire";
const DESCRIPTION =
  "A plain-English FAAB guide: what FAAB is, how much of your budget to bid on each kind of pickup, when to spend it all, and who to drop.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: `/guides/${SLUG}` },
  keywords: [
    "faab strategy",
    "faab strategy fantasy football",
    "faab bidding strategy",
    "how much faab should i spend",
    "how much faab to spend on rookies",
    "waiver wire strategy fantasy football",
    "waiver wire bidding strategy",
    "waiver wire budget strategy",
    "dynasty faab strategy",
    "faab waiver strategy",
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
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
  { id: "what-heading", label: "What FAAB is" },
  { id: "rule-heading", label: "The one rule" },
  { id: "how-much-heading", label: "How much to bid" },
  { id: "timing-heading", label: "Timing" },
  { id: "room-heading", label: "Reading the room" },
  { id: "drop-heading", label: "Who to drop" },
  { id: "all-in-heading", label: "When to spend it all" },
  { id: "dynasty-heading", label: "Dynasty and rookies" },
  { id: "chopped-heading", label: "Chopped and guillotine leagues" },
  { id: "mistakes-heading", label: "Mistakes I see every year" },
  { id: "example-heading", label: "A worked example" },
  { id: "checklist-heading", label: "Before you bid" },
  { id: "faq-heading", label: "Questions, answered" },
];

const FAQ: FaqAccordionItem[] = [
  {
    question: "How much FAAB should I spend on one player?",
    answer:
      "Bid on what he does for your lineup, not on the noise around him. A player who steps into a full-time starting job you would play every week is worth a big share of what you have left, often 40 percent or more. A one-week streamer is worth a few dollars. The FAAB calculator on this site prices a claim against your actual roster and tells you where to stop.",
  },
  {
    question: "Should I spend my whole FAAB budget in week one?",
    answer:
      "Almost never on a rumor, sometimes on a fact. Week one waivers are full of players who had one big game in a role that will not last, and the whole league is bidding on the same hope. Save the big number for a player whose job changed for a reason you can name, like an injury to the starter ahead of him.",
  },
  {
    question: "What is the difference between FAAB and waiver priority?",
    answer:
      "Waiver priority is a queue: whoever is highest in the order gets the player, and using it usually drops you to the back. FAAB is a blind auction: everyone bids from a season-long budget and the highest bid wins. Priority makes you ask whether a player is worth your spot in line. FAAB makes you ask what he is worth in dollars you cannot get back.",
  },
  {
    question: "Is it bad to have FAAB left over at the end of the season?",
    answer:
      "Yes. Leftover FAAB in January bought nothing. A dollar in week two and a dollar in week fourteen are not the same money, because the later one has fewer chances left to be spent. As the season goes on, the right bid on a real upgrade climbs, and a contender should expect to reach the playoffs close to empty.",
  },
  {
    question: "How much FAAB should I bid on a rookie in dynasty?",
    answer:
      "In a dynasty league a waiver pickup has value beyond this season, so an undrafted rookie with a real path to a role is a stash worth low single digits, and a rookie whose role just changed because of an injury is priced like any other new starter. What you should not do is empty a dynasty budget on a name alone, because that budget has to last a long time and the player usually does not.",
  },
  {
    question: "How does FAAB work in a chopped league?",
    answer:
      "It is the same blind auction with the dial turned up. Budgets are usually $1,000 and never reset, trades are normally switched off so the wire is the only way to improve, and a whole eliminated roster lands on waivers at once, so several startable players compete for the same money. Prices fall as the field shrinks, because there are fewer bidders left every week. Our chopped league strategy guide covers the format, the draft and the bid sizes week by week.",
  },
  {
    question: "Should I bid odd numbers?",
    answer:
      "Yes. Most people bid in round numbers, so a tie at 10 or 20 is the one you are most likely to be in, and your league settles it with waiver priority or a coin flip rather than in your favor. 4for4's waiver wire FAAB guide gives the same advice: make it 11 instead of 10, and 21 instead of 20. The extra dollar costs almost nothing and it wins the claims nobody realized were close.",
  },
  {
    question: "Do I have to bid at all if nobody else wants him?",
    answer:
      "Bid one dollar, or whatever your league's minimum is. A zero-dollar claim and a free-agent pickup after waivers clear are the same thing in most leagues, and a one-dollar bid protects you from the one other manager who had the same idea. You only ever have to beat one person.",
  },
];

/**
 * The measured market this page quotes, read once per render.
 *
 * Three slices, and each one answers a sentence somewhere below: what a
 * contested claim costs (the bidder cells), what each stretch of the season
 * costs (the phase cells), and what a chopped league pays (the chopped cell).
 * The calendar multiplier travels with the phase rows so the table can show
 * the measurement and what the calculator does about it side by side, read
 * from the live settings rather than typed in.
 */
type MarketSlice = { label: string; read: MarketRead | null };

type FaabMarket = {
  bidders: MarketSlice[];
  phases: (MarketSlice & { multiplier: number | null })[];
  chopped: MarketRead | null;
  updatedAt: string | null;
};

const BIDDER_CELLS: { key: string; label: string }[] = [
  { key: "any|any|any|any|1", label: "Nobody else bid" },
  { key: "any|any|any|any|2", label: "Two teams bidding" },
  { key: "any|any|any|any|3", label: "Three teams bidding" },
  { key: "any|any|any|any|4p", label: "Four or more bidding" },
];

const PHASE_CELLS: { key: string; label: string; week: number }[] = [
  { key: "any|any|any|wk1|any", label: "Week 1", week: 1 },
  { key: "any|any|any|wk2_6|any", label: "Weeks 2 to 6", week: 2 },
  { key: "any|any|any|wk7_10|any", label: "Weeks 7 to 10", week: 7 },
  { key: "any|any|any|wk11_13|any", label: "Weeks 11 to 13", week: 11 },
  { key: "any|any|any|wk14p|any", label: "Week 14 on", week: 14 },
];

async function loadFaabMarket(): Promise<FaabMarket> {
  const [cells, settings] = await Promise.all([
    loadPriorCellsCached(),
    loadFaabSettings(createAdminClient()),
  ]);
  const minSamples = settings.priors.minCellSamples;
  const calendar = settings.market.calendar;

  const bidders = BIDDER_CELLS.map((c) => ({
    label: c.label,
    read: readCell(cells, c.key, minSamples),
  }));
  const phases = PHASE_CELLS.map((c) => ({
    label: c.label,
    read: readCell(cells, c.key, minSamples),
    multiplier: calendar.enabled ? calendarMultiplier(c.week, calendar) : null,
  }));
  const chopped = readCell(cells, "chopped|any|any|any|any", minSamples);

  return {
    bidders,
    phases,
    chopped,
    updatedAt: newestBuiltAt([
      chopped,
      ...bidders.map((b) => b.read),
      ...phases.map((p) => p.read),
    ]),
  };
}

export default async function FaabStrategyGuide() {
  const [isMember, market] = await Promise.all([isDiscordMember(), loadFaabMarket()]);

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
        logo: { "@type": "ImageObject", url: `${SITE.url}/img/ff-beacon-logo.png` },
      },
      image: [{ "@type": "ImageObject", url: OG_IMAGE, width: 1200, height: 630 }],
      mainEntityOfPage: { "@type": "WebPage", "@id": CANONICAL },
      url: CANONICAL,
      articleSection: "Guides",
      about: { "@type": "Thing", name: "FAAB and waiver wire strategy in fantasy football" },
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
          title="FAAB strategy: how much to bid on the waiver wire, and when to spend it all"
          chips={[
            { label: "Guide", tone: "cyan" },
            { label: "Waiver wire", tone: "purple" },
            { label: "9 lessons", tone: "cyan" },
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
            <RuleSection />
            <HowMuchSection market={market} />
            <TimingSection market={market} />
            <RoomSection />
            <DropSection />
            <AllInSection />
            <DynastySection />
            <ChoppedSection market={market} />
            <MistakesSection />
            <ExampleSection />
            <ChecklistSection />
            <FaqSection />
            <ClosingSection />
          </div>
        </article>
      </GuideShell>

      <DiscordCtaSection
        eyebrow="Waivers are stressful"
        heading="Bidding tonight? Ask before you spend it."
        body="Drop the player and your league settings into our Discord and real fantasy players will help you land on a number you feel good about, free. I am in there too."
        isMember={isMember}
        memberHeading="You know the method. Now run the numbers."
        memberBody="You're already in the crew, so we'll skip the invite. The FAAB calculator prices any claim against your real roster in a few seconds."
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

/**
 * A boxed idea: the one sentence a lesson exists to leave behind. The label is
 * decorative; the sentence is real text.
 */
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

/** A pointer at the tool that runs the lesson's arithmetic. */
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

/** A small table with a caption that says what the numbers are. */
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
    <div className="mt-5 overflow-x-auto rounded-card border border-line bg-surface/40">
      <table className="w-full min-w-[30rem] text-sm">
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
            <tr key={row[0]} className="border-b border-line/60 last:border-0 align-top">
              {row.map((cell, i) =>
                i === 0 ? (
                  <th key={cell} scope="row" className="px-4 py-2.5 text-left font-semibold text-ink">
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
          Bid on what a player does for your lineup, not on how loud the hype is. A new every-week
          starter is worth a big chunk of your budget. A one-week streamer is worth a few dollars.
          Your money is worth more in September than December, so do not sit on it. And the most
          expensive mistake on the waiver wire is winning an auction you should have lost.
        </p>
        <p className="mt-3 text-sm leading-relaxed" style={{ color: "#F4F4F8" }}>
          Bidding on someone tonight? The free{" "}
          <Link
            href="/tools/faab"
            className="font-semibold text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            FAAB calculator
          </Link>{" "}
          prices one claim against your roster in a few seconds. This guide is the reasoning behind
          it.
        </p>
      </div>
    </section>
  );
}

/* ---------- Syllabus ---------- */

const LESSONS: { n: string; title: string; href: string; takeaway: string }[] = [
  {
    n: "01",
    title: "What FAAB is",
    href: "#what-heading",
    takeaway: "A blind auction, not a queue.",
  },
  {
    n: "02",
    title: "The one rule",
    href: "#rule-heading",
    takeaway: "Weeks started times points over the cut.",
  },
  {
    n: "03",
    title: "How much to bid",
    href: "#how-much-heading",
    takeaway: "Four kinds of pickup, four bands.",
  },
  {
    n: "04",
    title: "Timing",
    href: "#timing-heading",
    takeaway: "A September dollar and a December dollar.",
  },
  {
    n: "05",
    title: "Reading the room",
    href: "#room-heading",
    takeaway: "You only have to beat one person.",
  },
  {
    n: "06",
    title: "Who to drop",
    href: "#drop-heading",
    takeaway: "Every add is also a cut.",
  },
  {
    n: "07",
    title: "When to spend it all",
    href: "#all-in-heading",
    takeaway: "Three things have to be true.",
  },
  {
    n: "08",
    title: "Dynasty and rookies",
    href: "#dynasty-heading",
    takeaway: "A stash is worth next year, not this Sunday.",
  },
  {
    n: "09",
    title: "Chopped and guillotine leagues",
    href: "#chopped-heading",
    takeaway: "A whole roster hits the wire every week.",
  },
];

function Syllabus() {
  return (
    <section aria-labelledby="syllabus-heading" className="mt-8">
      <h2
        id="syllabus-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle"
      >
        The nine lessons
      </h2>
      <ol role="list" className="mt-3 grid gap-2 sm:grid-cols-2">
        {LESSONS.map((l) => (
          <li key={l.n}>
            <a
              href={l.href}
              className="flex min-h-11 items-start gap-3 rounded-card border border-line bg-surface/60 p-3 transition-colors hover:border-line-accent hover:bg-ink/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <span
                aria-hidden="true"
                className="font-mono text-sm font-semibold tabular-nums text-brand-cyan"
              >
                {l.n}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">
                  <span className="sr-only">Lesson {Number(l.n)}: </span>
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

/* ---------- Lesson 1: what FAAB is ---------- */

function WhatSection() {
  return (
    <section aria-labelledby="what-heading" className="mt-12">
      <GuideSectionHeader
        id="what-heading"
        eyebrow="Lesson 1 of 9"
        heading="What FAAB is, and how it differs from waiver priority"
        tone="purple"
      />
      <Para>
        FAAB stands for free agent acquisition budget. At the start of the season every team in
        your league gets the same pot of fake money, usually 100 dollars, sometimes 200 or 1,000.
        When a player is on waivers and more than one of you wants him, you each write down a
        secret bid. When waivers process, usually early Wednesday morning, the highest bid wins
        the player and that money is gone for the year. Everyone else keeps theirs.
      </Para>
      <Para>
        The older system is waiver priority. There is a queue, it usually starts in reverse
        standings order, and the team highest in the queue gets the player. Use your spot and you
        drop to the back. Priority asks you whether a player is worth your place in line. FAAB
        asks you what he is worth in dollars you cannot get back, which is a harder and more
        interesting question, and the reason most leagues I play in have switched.
      </Para>
      <Para>
        Two mechanics matter more than people realize. First, bids are blind, so you are never
        just pricing the player, you are guessing what the room will pay. Second, ties are
        settled by your league's rules, often by waiver priority or by a coin flip, so check your
        settings before you assume a tie goes your way. And a player nobody bids on usually
        becomes a free agent after waivers clear, where anyone can add him for nothing.
      </Para>
      <KeyIdea>
        FAAB is a blind auction with money you cannot get back. Every bid is a guess about the
        room as much as a price on the player.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 2: the one rule ---------- */

function RuleSection() {
  return (
    <section aria-labelledby="rule-heading" className="mt-12">
      <GuideSectionHeader
        id="rule-heading"
        eyebrow="Lesson 2 of 9"
        heading="Bid on what he does for your lineup, not on the hype"
      />
      <Para>
        Here is the mistake I made for about ten seasons. A player has a big Sunday, my group
        chat lights up, and I bid on the excitement. The bid had nothing to do with my team. The
        right question is boring and specific: if I add this guy, how many weeks does he actually
        start for me between now and the end of the season, and how many more points do I score
        in those weeks than I would have with the player I am cutting to make room?
      </Para>
      <Para>
        Those two numbers, weeks started and points gained over the cut, are what a pickup is
        worth to you. Not to the league, to you. A running back who would start for eleven
        straight weeks over your current flex is worth a lot. The same running back on a team
        that already has three good backs is worth almost nothing, because he would sit on your
        bench, and you cannot score points from the bench.
      </Para>
      <PickupWorthFigure />
      <Para>
        This is why the same player deserves a different bid from every team in the league, and
        why copying a bid from a podcast is a coin flip. The{" "}
        <Link href="/tools/faab" className={LINK_CLASS}>
          FAAB calculator
        </Link>{" "}
        on this site does this arithmetic against your real Sleeper roster: every remaining week
        with him and without him, in your league's own scoring, with the player you would cut
        already subtracted. The rest of this guide is the reasoning it runs on.
      </Para>
      <KeyIdea>
        A pickup is worth weeks started times points over the player you cut. Two numbers, both
        about your team, neither about the highlight.
      </KeyIdea>
      <TryIt href="/tools/faab" label="Price a claim">
        Connect your Sleeper league and the calculator runs every remaining week with and without
        the player, under your league&apos;s own scoring, with the cut already subtracted.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 3: how much ---------- */

function HowMuchSection({ market }: { market: FaabMarket }) {
  const [alone, two, three, four] = market.bidders.map((b) => b.read);
  const contested = [two, three, four].every((r) => r?.enough);

  return (
    <section aria-labelledby="how-much-heading" className="mt-12">
      <GuideSectionHeader
        id="how-much-heading"
        eyebrow="Lesson 3 of 9"
        heading="How much to bid, by kind of pickup"
        tone="purple"
      />
      <Para>
        Every bid is a share of what you have left, not of what you started with. If you have 40
        dollars in week eight, a "forty percent" bid is 16, not 40. With that said, here are the
        four kinds of waiver pickup and roughly what each one is worth, in a typical twelve-team
        league.
      </Para>
      <Para>
        Treat these as rules of thumb for a bid you are making in your head on a Tuesday night.
        The calculator does not price this way any more. It runs an auction: it simulates the
        rivals who would want the player, what each of them can spend, and what claims like this
        one have actually cleared at, and it returns a bid with a win chance attached. These
        bands are what it falls back on for a player it cannot project at all, and they are still
        the right shape to carry around in your head.
      </Para>
      <BidBandsFigure />
      <GuideTable
        caption="Rough bid ranges as a share of your remaining budget, for a bid you are sizing by hand. The calculator prices the specific player against your specific roster and the rivals who would bid against you."
        head={["Kind of pickup", "What he is", "Share of remaining budget"]}
        rows={[
          [
            "League-winner",
            "A starter got hurt and this guy just inherited a full-time job in a good offense. He starts for you every week from here.",
            "65 percent and up, all the way to everything you have",
          ],
          [
            "New weekly starter",
            "A role change, not a windfall. He is a clear lineup upgrade most weeks but not a season-changer.",
            "25 to 65 percent",
          ],
          [
            "Depth and stashes",
            "A handcuff, an injured player coming back, a rookie with a path to a role. Useful in a month, not on Sunday.",
            "4 to 25 percent",
          ],
          [
            "Streamers and flyers",
            "A defense or kicker for one matchup, a bye-week fill, a dart throw.",
            "0 to 4 percent, and 1 dollar is often enough",
          ],
        ]}
      />
      {contested && (
        <Para>
          Company is what actually moves a price, and we can measure how much. Across the leagues
          synced into this site, the median winning bid on a claim two teams wanted was{" "}
          {pctText(two!.p50)} percent of the whole budget ({sampleText(two!)}). With three teams
          on it the median was {pctText(three!.p50)} percent ({sampleText(three!)}), and with
          four or more it was {pctText(four!.p50)} percent ({sampleText(four!)}).
          {alone?.enough
            ? ` A claim nobody else bid on cleared for nothing ${shareText(alone.zeroShare)} percent of the time, over ${sampleText(alone)}.`
            : ""}{" "}
          The median roughly doubles each time another rival joins, which is the real argument
          for reading the room before you write a number down.
        </Para>
      )}
      <Para>
        Notice how much room there is between the top row and the second. Most bad bids are
        second-row players priced like first-row ones. The test I use: would I start him over my
        worst current starter next week without thinking about it? If the answer is no, he is not
        a league-winner, whatever the highlight looked like.
      </Para>
      <Para>
        League size moves all of this. In a ten-team league the free agent pool is deeper, useful
        players are easier to replace, and every range shifts down. In a fourteen-team league or
        one that starts three receivers and two flexes, replacement players are worse and every
        range shifts up. The{" "}
        <Link href="/guides/positional-war-explained" className={LINK_CLASS}>
          Positional WAR guide
        </Link>{" "}
        explains why the position matters as much as the player: a pickup at a position that
        runs out fast is worth more than the same points at a position where the next guy is
        nearly as good.
      </Para>
      <KeyIdea>
        Put him in a bucket before you put a number on him. Most overpays are a second-bucket
        player priced like a first-bucket one.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 4: timing ---------- */

function TimingSection({ market }: { market: FaabMarket }) {
  // The superlatives in the copy are derived, never typed, so a rebuild that
  // moves the market moves the sentence with it rather than leaving the page
  // asserting last season's shape.
  const priced = market.phases.filter((p) => p.read?.enough);
  const dearest = priced.reduce<(typeof priced)[number] | null>(
    (best, p) => (best === null || p.read!.p75 > best.read!.p75 ? p : best),
    null,
  );
  const cheapest = priced.reduce<(typeof priced)[number] | null>(
    (best, p) => (best === null || p.read!.p75 < best.read!.p75 ? p : best),
    null,
  );
  const peak = priced.reduce<(typeof priced)[number] | null>(
    (best, p) => (best === null || p.read!.p90 > best.read!.p90 ? p : best),
    null,
  );
  const measured = priced.length >= 3 && dearest !== null && cheapest !== null && peak !== null;

  return (
    <section aria-labelledby="timing-heading" className="mt-12">
      <GuideSectionHeader
        id="timing-heading"
        eyebrow="Lesson 4 of 9"
        heading="September dollars and December dollars are not the same money"
      />
      <Para>
        A dollar of FAAB is worth exactly what it can still buy. In week two it can buy any of a
        dozen or so weeks of upgrades. In week fourteen it can buy one or two. So the same player
        deserves a bigger bid late in the season than early, and money you are still holding when
        the playoffs start bought you nothing at all. Leftover FAAB in January is a mistake, not a
        badge.
      </Para>
      <Para>
        That is the theory, and for years I taught the other half of it as well: hold off early,
        because week one is full of players who had one big game in a role that will not last.
        Then we measured what the market does. Our own priced winning bids say the early weeks are
        where the money actually goes, and that the quiet middle of the season is the cheapest
        place to buy.
      </Para>
      {measured && (
        <Para>
          Close to half of all waiver claims clear for nothing in every stretch of the season, so
          the median is the wrong number to look at. Look at the top quarter, where the contested
          claims live. The dearest quarter of winning bids cleared above{" "}
          {pctText(dearest!.read!.p75)} percent of the budget in{" "}
          {dearest!.label.toLowerCase()}, which is the most expensive stretch we measure, and
          above {pctText(cheapest!.read!.p75)} percent in {cheapest!.label.toLowerCase()}, the
          cheapest. The highest figure on the table belongs to {peak!.label.toLowerCase()}, where
          the dearest tenth of winning bids cleared above {pctText(peak!.read!.p90)} percent.
        </Para>
      )}
      <GuideTable
        caption="Winning bids as a share of the league's whole budget, measured across the leagues synced into FF Beacon, beside what the calculator does with each stretch. A multiplier above 1 means it expects rivals to bid up."
        head={[
          "Stretch of the season",
          "Top quarter cleared above",
          "Top tenth cleared above",
          "What we measured",
          "Calculator",
        ]}
        rows={market.phases.map((phase) => {
          const multiplier =
            phase.multiplier === null ? "Off" : `${phase.multiplier.toFixed(2)}x`;
          if (!phase.read || !phase.read.enough) {
            return [
              phase.label,
              NOT_ENOUGH,
              NOT_ENOUGH,
              phase.read ? `${phase.read.sampleSize} claims so far` : "Nothing measured yet",
              multiplier,
            ];
          }
          return [
            phase.label,
            `${pctText(phase.read.p75)}%`,
            `${pctText(phase.read.p90)}%`,
            sampleText(phase.read),
            multiplier,
          ];
        })}
      />
      {market.updatedAt && (
        <p className="mt-2 text-xs text-ink-subtle">
          Updated {formatEasternDate(market.updatedAt)}, and rebuilt whenever the leagues behind
          it resync. An admin can change the calculator column, so it is read live rather than
          written here.
        </p>
      )}
      <Para>
        The calculator follows that table rather than the old theory. It used to take about
        fifteen percent off a bid in the first three weeks on the argument that early money has
        option value, and it no longer does. Option value is real, but it belongs to your
        judgement about whether to hold, not to a guess about what a rival will bid, and the
        rivals bid up in September.
      </Para>
      <Para>
        The practical rule: in the busy early weeks, pay a real price only for a change you can
        name, like an injury to the starter ahead of him or a trade that emptied a depth chart,
        and expect company when you do. The middle of the season is where a patient manager gets
        paid, because the same quality of player costs less. From week 14 spend freely, because
        there is no later. And if you are a contender at the deadline with half your budget left,
        you have been too careful, and the fix is to be the highest bidder on the next real
        upgrade rather than the second-highest on three.
      </Para>
      <KeyIdea>
        The market is dearest in the first six weeks and again from week 14, and cheapest in
        between. Buy in the quiet part, and never carry a dollar into January.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 5: reading the room ---------- */

function RoomSection() {
  return (
    <section aria-labelledby="room-heading" className="mt-12">
      <GuideSectionHeader
        id="room-heading"
        eyebrow="Lesson 5 of 9"
        heading="Reading the room: you only have to beat one person"
        tone="purple"
      />
      <Para>
        What a player is worth to you sets the most you should ever pay. What it takes to
        actually win him is a different number, and it is almost always lower, because it
        depends on the other eleven managers and not on you. A bid is an auction, and an auction
        is won by whoever reads the room best.
      </Para>
      <BulletList
        items={[
          <>
            <strong className="text-ink">What they can spend.</strong> Sleeper reports what
            every team has spent, so you can work out what each one has left. If the three
            teams who need a running back are all under 20 dollars, you do not need to bid 45
            to win one. Look before you bid.
          </>,
          <>
            <strong className="text-ink">How many of them want him.</strong> A player only helps
            a team with a hole he fits. One interested rival is a bargain. Five is a bidding war,
            and a bidding war is usually one you should let somebody else win.
          </>,
          <>
            <strong className="text-ink">What your league actually pays.</strong> Every winning
            bid is in your league history. Some rooms never clear ten percent on anyone; some
            spend forty on a backup. Your league&apos;s past bids are the best guide to its next
            one, and the calculator reads them when a league is connected and has enough
            priced claims in its history to mean something.
          </>,
          <>
            <strong className="text-ink">Odd numbers.</strong> People bid in round numbers. If
            you think the winning bid will be 20, bid 21 or 23. It costs almost nothing and it
            wins ties you did not know you were in.
          </>,
        ]}
      />
      <Para>
        Put together, this is why the calculator gives you a ladder instead of one number. Bid is
        the amount that usually wins. Stretch to is what it takes when you cannot afford to lose
        him. Walk away above is the ceiling, the point where winning stops being worth it, and it
        is the most useful number on the page.
      </Para>
      <Para>
        Which of the first two rungs you should be reading is a question about you rather than
        about the player, so the calculator asks it. The goal toggle above the answer offers Good
        value, the cheapest bid that usually wins him, and Make sure I win, which pays up to end
        the argument. Switching between them is instant, because both were priced when the answer
        was built.
      </Para>
      <Para>
        Beside the bid is the number that makes the choice concrete: the chance that bid actually
        wins him, worked out from the same simulated auction that produced it. A bid with a six
        in ten chance and one with a nine in ten chance are different decisions even when the
        dollars are close, and seeing the odds is what stops you adding twenty to feel safe.
      </Para>
      <BidLadderFigure />
      <div className="mt-6">
        <BidWorksheet />
      </div>
      <KeyIdea>
        The ceiling comes from your roster. The bid comes from their wallets. Keep the two
        numbers apart, and never let the second one climb past the first.
      </KeyIdea>
      <TryIt href="/tools/faab" label="See the real ladder">
        With a league connected, the calculator reads every rival&apos;s remaining budget and
        your league&apos;s own bid history, and prints the three rungs for the actual player.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 6: who to drop ---------- */

function DropSection() {
  return (
    <section aria-labelledby="drop-heading" className="mt-12">
      <GuideSectionHeader id="drop-heading" eyebrow="Lesson 6 of 9" heading="Who to drop" />
      <Para>
        Every add is also a cut, and the cut is half the decision. The right player to drop is
        the one your lineup would miss least, which is not always the one with the fewest points.
        A backup running back one injury from a starting job is worth more than his box score.
        A fourth receiver on a bad offense is worth less than his.
      </Para>
      <Para>
        Two habits save a lot of regret. First, never drop a real player for a one-week
        streamer; stream from the bottom of your bench, where the player you cut is one you
        would not miss in a month either. Second, in a dynasty or keeper league, do not cut a
        player who still carries real trade value to make room for a rental. Trade him for
        something instead, even a late pick. A dropped asset is a gift to whoever claims him.
      </Para>
      <Para>
        When a league is connected, the{" "}
        <Link href="/tools/faab" className={LINK_CLASS}>
          FAAB calculator
        </Link>{" "}
        lists up to four drop candidates, cheapest to lose first. It decides who may be named on healthy projections, so a starter who is
        hurt this week cannot look disposable for that reason alone, then orders them by what
        your lineup actually loses. It also refuses to name a player worth more than the one
        you are adding, and in a dynasty or keeper league it only names players from the bottom
        of your roster by value. If it names nobody, one of two things is true: you have an open
        bench spot and do not need to cut anyone, or every player it could name is one you would
        rather keep, in which case it says so and leaves that call to you.
      </Para>
      <KeyIdea>
        Drop the player your lineup would miss least, which is rarely the one with the fewest
        points. A handcuff or a dynasty asset is never the price of a streamer.
      </KeyIdea>
      <TryIt href="/tools/faab" label="See your drop candidates">
        Connect your Sleeper league and the calculator names the players your lineup would miss
        least, and says so when it would rather you kept everyone.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 7: when to spend it all ---------- */

function AllInSection() {
  return (
    <section aria-labelledby="all-in-heading" className="mt-12">
      <GuideSectionHeader
        id="all-in-heading"
        eyebrow="Lesson 7 of 9"
        heading="When to spend it all"
        tone="purple"
      />
      <Para>
        Sometimes the right bid is everything you have. It is rarer than the group chat thinks,
        but it is real. The player is a true league-winner, a full-time starter in a good offense
        who will be in your lineup every week from here. You are a contender, so those weeks
        matter. And he fills a hole, so those points are gains and not a bench decoration.
      </Para>
      <Para>
        When all three are true, go big. A player like that rarely reaches waivers, and the
        season he wins you is worth more than anything the leftover dollars could have bought.
        The calculator&apos;s own all-in verdict is, by default, a bid of about 70 percent of what
        you have left with a walk-away line near 90, and it only runs the ceiling all the way to
        100 when the hole he fills is a starter you need right now. It flags the case on its own
        when a claim adds about 12 points of playoff odds, or about 3.5 points a week to your
        lineup.
      </Para>
      <Para>
        When even one of the three is false, do not. The saddest bid on the wire is a last-place
        team spending its whole budget on a player who will win it two meaningless games in
        December. With a Sleeper league connected, if your{" "}
        <Link href="/guides/fantasy-football-playoffs#odds-heading" className={LINK_CLASS}>
          playoff odds
        </Link>{" "}
        are already 5 percent or lower, the calculator will not tell you to empty the budget,
        and neither will I.
        Save it, or better, trade the player you would have cut to a contender for a pick.
      </Para>
      <KeyIdea>
        Empty the budget only when he is a league-winner, you are contending, and he fills a
        hole. Three yeses. Two is a big bid, not an all-in.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 8: dynasty and rookies ---------- */

function DynastySection() {
  return (
    <section aria-labelledby="dynasty-heading" className="mt-12">
      <GuideSectionHeader
        id="dynasty-heading"
        eyebrow="Lesson 8 of 9"
        heading="Dynasty FAAB, and how much to spend on rookies"
      />
      <Para>
        Dynasty changes one thing about all of the above: a waiver pickup keeps his value next
        year, so a stash can be worth more than his points this season. It does not change the
        core rule. A player who never starts for you is still worth very little, and a dynasty
        budget has to last a long time, so the bar for a huge bid is higher, not lower.
      </Para>
      <Para>
        Rookies are where most dynasty budgets go to die. An undrafted rookie with a real path to
        a role is a stash: low single digits, and only if the bench spot is free. A rookie whose
        role just changed because of an injury is a new starter and gets priced like one. A
        rookie who is a name and nothing else, no snaps, no targets, no depth chart movement, is
        a flyer, and a flyer is a dollar. Some dynasty leagues run their rookie free agency
        through FAAB after the draft; the same buckets apply, with the extra caution that you are
        bidding on players nobody in the league thought were worth a pick.
      </Para>
      <Para>
        One more dynasty-only rule: if you are rebuilding, your FAAB is at its most valuable in
        the weeks when contenders are desperate. Let them empty their budgets in October. Your
        pickups are the ones that matter in March.
      </Para>
      <KeyIdea>
        In dynasty a stash is worth next year, a rookie name is worth a dollar, and a rebuilder&apos;s
        budget is worth the most in the week the contenders run out.
      </KeyIdea>
      <TryIt href="/guides/fantasy-football-trade-guide" label="Read the trade guide">
        The player you were going to cut in a dynasty league is usually worth a late pick to
        somebody. The trade guide covers what a pick is worth, and when.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 9: chopped and guillotine leagues ---------- */

/**
 * The elimination formats, from inside the FAAB topic. This section deliberately
 * stays short and hands the reader to /guides/chopped-league-strategy, which
 * owns the format: the plan (docs/faab/chopped-guillotine-guide-seo-plan.md,
 * sections 3 and 5) keeps this page on its own FAAB terms and keeps the two
 * pages from competing for the same searches.
 */
function ChoppedSection({ market }: { market: FaabMarket }) {
  const chopped = market.chopped;

  return (
    <section aria-labelledby="chopped-heading" className="mt-12">
      <GuideSectionHeader
        id="chopped-heading"
        eyebrow="Lesson 9 of 9"
        heading="FAAB in chopped and guillotine leagues"
        tone="purple"
      />
      <Para>
        A chopped league, which most people still call a guillotine league,
        eliminates the lowest scorer in the whole league every week and puts that
        team&apos;s entire roster back on the wire. Everything above still applies.
        Four things change.
      </Para>
      <Para>
        Budgets never reset and they usually start at $1,000, so the percentages
        in this guide turn into much larger dollar figures and every overpay costs
        you more. A whole roster arrives at once, which means you are not pricing
        one claim, you are pricing a quarterback, two backs and a receiver who all
        hit waivers on the same Tuesday and compete with each other for the same
        money. Work out which of them actually starts for you before you write a
        single number down.
      </Para>
      <Para>
        There are no rebuilders either. Every surviving team is a rival for every
        player, and the number of rivals falls every week, which is why prices
        drop as the field shrinks. And the goal is a different one. There is no
        playoff seed to chase here, and the thing you have to avoid is the lowest
        score in the league this Sunday, so a bid that raises your floor beats
        one that raises your ceiling.
      </Para>
      <Para>
        {chopped?.enough ? (
          <>
            The chopped leagues synced into this site show how lopsided that market is. Across{" "}
            {sampleText(chopped)}, {shareText(chopped.zeroShare)} percent of winning claims cost
            nothing at all, while the dearest tenth cleared above {pctText(chopped.p90)} percent
            of the whole budget, or {moneyText(chopped.p90, 1000)} out of a $1,000 pot. Almost
            every claim is free, and the few that are not decide the season.
          </>
        ) : (
          <>
            We publish measured bids by league type as the sample grows, and the chopped one is
            still thin: {NOT_ENOUGH.toLowerCase()} to put a number on what these leagues pay.
          </>
        )}
      </Para>
      <Para>
        Our{" "}
        <Link href="/guides/chopped-league-strategy" className={LINK_CLASS}>
          chopped league strategy
        </Link>{" "}
        guide covers drafting, survival and bid sizes week by week, and the FAAB
        calculator has a chopped mode that prices a claim against the teams still
        alive.
      </Para>
      <KeyIdea>
        The wire refills with a whole roster every week and the budget never comes
        back. Bid on the player who keeps you off the bottom, not the one who wins
        you the week.
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
        heading="Mistakes I see every year"
        tone="purple"
      />
      <BulletList
        items={[
          <>
            <strong className="text-ink">Bidding the hype, not the role.</strong> One big game in a
            committee is not a job. Look at snaps and touches before you look at points.
          </>,
          <>
            <strong className="text-ink">Overpaying by 20 to feel safe.</strong> Winning by 20
            dollars scores exactly as many points as winning by one. You only have to beat one
            person; guess what they will pay and clear it by a little.
          </>,
          <>
            <strong className="text-ink">Hoarding.</strong> The team that reaches the playoffs with
            60 percent of its budget wasted it.
          </>,
          <>
            <strong className="text-ink">Emptying it in week one.</strong> Full wallets and thin
            evidence make week one the worst market of the year. Pay for facts, not for hope.
          </>,
          <>
            <strong className="text-ink">Cutting the wrong player.</strong> Dropping a handcuff or a
            dynasty asset for a streamer is a gift to whoever picks him up.
          </>,
          <>
            <strong className="text-ink">Ignoring the position.</strong> A hot receiver in a league
            where the fortieth receiver is fine is worth much less than the same points at running
            back, where the cliff is real.
          </>,
          <>
            <strong className="text-ink">Bidding round numbers.</strong> Twenty loses to twenty-one.
            Bid twenty-one.
          </>,
        ]}
      />
    </section>
  );
}

/* ---------- Worked example ---------- */

function ExampleSection() {
  return (
    <section aria-labelledby="example-heading" className="mt-12">
      <GuideSectionHeader
        id="example-heading"
        eyebrow="Start to finish"
        heading="A worked example, with made-up numbers"
      />
      <Para>
        Say it is week five in a twelve-team PPR league with a 100 dollar budget, and you have 71
        left. A starting running back on a good offense tore an ACL on Sunday and his backup is
        now the guy. Your running backs are a stud, a middling starter, and a flex who has been
        scoring 8 a week. You are 3 and 1.
      </Para>
      <GuideTable
        caption="An invented claim, walked through the way the calculator reasons. Every number here is made up."
        head={["Step", "The question", "The answer"]}
        rows={[
          [
            "1. Weeks started",
            "How many of the remaining 13 weeks does he start for me?",
            "All 13, as my second back, pushing the 8-a-week flex to the bench",
          ],
          [
            "2. Points gained",
            "How much more do I score than with the player I cut?",
            "He projects 11 a week; the flex is 8. About 3 a week, over 13 weeks",
          ],
          [
            "3. Odds",
            "What does that do to my playoff chances?",
            "From about 70 percent to about 78 percent. Real, and short of the calculator's all-in line",
          ],
          [
            "4. Kind of pickup",
            "Which bucket is he in?",
            "A new weekly starter with league-winner upside: top of the second row",
          ],
          [
            "5. Value ceiling",
            "The most he is worth to me, as a share of the 71 I have left",
            "Around 55 percent, so roughly 40 dollars. Walk away above that",
          ],
          [
            "6. The room",
            "Who else needs him, and what can they spend?",
            "Two teams need a back. One has 12 dollars left, the other 44",
          ],
          [
            "7. The bid",
            "What wins without overpaying?",
            "The 44-dollar team is the only threat. 27 probably wins; 36 is the sure thing",
          ],
        ]}
      />
      <Para>
        So the ladder reads: bid 27, go to 36 if you cannot afford to lose him, walk away above
        40. Notice that the walk-away number came from your roster and your odds, and the bid
        came from the other team's wallet. Those are two different numbers, and keeping them
        apart is the whole skill. Bid 36 here and you have 35 left for a season that still has a
        lot of Tuesdays in it.
      </Para>
    </section>
  );
}

/* ---------- Checklist ---------- */

function ChecklistSection() {
  return (
    <section aria-labelledby="checklist-heading" className="mt-12">
      <GuideSectionHeader
        id="checklist-heading"
        eyebrow="Pre-flight"
        heading="Before you bid"
        tone="purple"
      />
      <Para>
        Eight questions, one claim. If you cannot tick one, you do not know enough to put the
        bid in yet, and waivers do not process until Wednesday.
      </Para>
      <div className="mt-6">
        <PreBidChecklist />
      </div>
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
        heading="Run it on your own claim"
        tone="purple"
      />
      <Para>
        Everything above is what the{" "}
        <Link href="/tools/faab" className={LINK_CLASS}>
          FAAB calculator
        </Link>{" "}
        does in a few seconds against your actual roster: weeks started, points over the cut,
        your odds before and after, who else can outbid you, and a bid ladder with a walk-away
        line. Connect your Sleeper league for the full version, or enter your league size,
        starters and budget by hand. And if you want the vocabulary first, FAAB, waiver priority
        and the rest are in the{" "}
        <Link href="/guides/fantasy-football-terms#faab" className={LINK_CLASS}>
          glossary
        </Link>
        .
      </Para>
    </section>
  );
}
