import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Calculator, ListTree } from "lucide-react";
import { SITE } from "@/lib/site";
import { authorJsonLd, serializeJsonLd } from "@/lib/json-ld";
import { pageShareMetadata } from "@/lib/page-og";
import { PageBody } from "@/components/app-shell/page-body";
import { PageColumns } from "@/components/app-shell/page-columns";
import {
  PageMasthead,
  type MastheadChip,
  type MastheadStat,
} from "@/components/app-shell/page-masthead";
import { GuideSectionHeader, GuideSubheading } from "@/components/guides/guide-section-header";
import { FaqAccordion, type FaqAccordionItem } from "@/components/faq-accordion";
import { faqPageJsonLd } from "@/components/tool-explainer";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { isDiscordMember } from "@/lib/discord-membership";
import { createAdminClient } from "@/lib/supabase/server";
import { loadPriorCellsCached } from "@/lib/faab/priors-read";
import { loadFaabSettings } from "@/lib/faab/settings";
import { newestBuiltAt, readCell, type MarketRead } from "@/lib/guides/faab-market-figures";
import { WaiverBoardPanel } from "@/components/waiver-wire/waiver-board";
import { TopPickup } from "@/components/waiver-wire/top-pickup";
import {
  CalculatorRail,
  MethodRail,
  NextRail,
  PositionRail,
  WeekRail,
} from "@/components/waiver-wire/board-rail";
import { resolveWaiverContext } from "@/lib/waiver-wire/context";
import { loadWaiverBoardCached } from "@/lib/waiver-wire/load";
import { weekPath } from "@/lib/waiver-wire/weeks";
import { BOARD_POSITIONS, type BoardPosition, type WaiverBoard } from "@/lib/waiver-wire/types";
import { topPickup } from "@/lib/waiver-wire/reasons";
import {
  ClearingPriceFigure,
  FreeClaimFigure,
  PriorityVsFaabFigure,
  ProcessingFigure,
  type ClearingSlice,
} from "./waiver-figures";

/**
 * /waiver-wire
 *
 * The evergreen hub: what the waiver wire is, how it works on each platform,
 * how to decide who is worth adding, and this week's board.
 *
 * WHY THIS PAGE EXISTS. "waiver wire" is roughly 50,000 US searches a month
 * and until this page the site had nothing on the term at all: zero impressions
 * on any query containing the word in ninety days of Search Console, against
 * 2,227 on "faab calculator" and its variants. The site owned a modifier and
 * not the noun. This page goes after the noun and acts as the parent every
 * weekly board hangs off, which is the part that makes the weekly pages worth
 * publishing at all.
 *
 * WHAT IT IS NOT. It is not another FAAB guide. `/guides/faab-strategy` owns
 * the bidding: how much of a budget to commit, when to spend it all, who to
 * drop. This page owns the MECHANIC: what a claim is, what priority is, when it
 * processes, how to tell a role change from a good Sunday. The two link to each
 * other and deliberately do not overlap, so neither is competing with the other
 * for the same query.
 *
 * ITS LIVE HALF AND ITS EVERGREEN HALF. The board at the top is this week's and
 * changes every Tuesday; everything under it is written once and stays true.
 * That pairing is the point: a reader who arrives on the head term gets an
 * answer they can act on today, and a search engine gets a page that is not a
 * thin list of names that will be wrong in a fortnight.
 *
 * Source and format: the board shows values and projections, so it goes through
 * the ordinary preference chain (`resolveWaiverContext`). The prose shows no
 * player data and has nothing to resolve.
 */

export const dynamic = "force-dynamic";

const TITLE = "Fantasy Football Waiver Wire: How It Works and Who to Add";
const DESCRIPTION =
  "How the fantasy football waiver wire works, when claims process on Sleeper, Yahoo and ESPN, waiver priority against FAAB, and this week's pickups with a bid range for each.";
const CANONICAL = `${SITE.url}/waiver-wire`;

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/waiver-wire" },
  keywords: [
    "waiver wire",
    "fantasy football waiver wire",
    "fantasy waiver wire",
    "nfl waiver wire",
    "waiver wire adds",
    "waiver priority fantasy football",
    "waiver claim fantasy football",
    "how does the waiver wire work",
    "when do waivers process",
    "dynasty waiver wire",
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  ...pageShareMetadata({
    key: "waiver-wire",
    title: TITLE,
    description: DESCRIPTION,
    path: "/waiver-wire",
  }),
};

/* ---------- Lessons ---------- */

const LESSONS: { title: string; href: string; takeaway: string }[] = [
  {
    title: "What the waiver wire is",
    href: "#what-heading",
    takeaway: "A queue with a lock on it.",
  },
  {
    title: "Priority against FAAB",
    href: "#systems-heading",
    takeaway: "Two games, one name.",
  },
  {
    title: "When claims actually run",
    href: "#timing-heading",
    takeaway: "Wednesday, nearly everywhere.",
  },
  {
    title: "Who is actually worth adding",
    href: "#who-heading",
    takeaway: "Buy the role, not the box score.",
  },
  {
    title: "What a claim costs",
    href: "#price-heading",
    takeaway: "Most of them cost nothing.",
  },
  {
    title: "Dynasty waivers are a different wire",
    href: "#dynasty-heading",
    takeaway: "You are buying a season, not a week.",
  },
  {
    title: "The mistakes that cost the most",
    href: "#mistakes-heading",
    takeaway: "Hoarding, and bidding round numbers.",
  },
];

const LESSON_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"] as const;

function lessonEyebrow(anchor: string): string {
  const i = LESSONS.findIndex((l) => l.href === anchor);
  return `Lesson ${i + 1} of ${LESSONS.length}`;
}

const FAQ: FaqAccordionItem[] = [
  {
    question: "How does the waiver wire work in fantasy football?",
    answer:
      "When a player is dropped, or before he has ever been rostered in some leagues, he sits on waivers for a fixed period instead of being free to claim instantly. Everyone who wants him puts in a claim, and when the waiver period ends the league awards him to one of them. Which one depends on your system: waiver priority gives him to whoever is highest in the queue, and FAAB gives him to whoever bid the most. After waivers clear, anyone left unclaimed becomes a free agent that anybody can add on the spot.",
  },
  {
    question: "When do waivers process?",
    answer:
      "Wednesday morning is the default on Sleeper, Yahoo, ESPN and NFL.com, so a claim entered any time from Tuesday runs overnight. Commissioners change it often, usually to Tuesday night or to daily waivers, and a few leagues run a rolling two-day window on every newly dropped player instead. Your own league settings are the only answer that matters.",
  },
  {
    question: "What is the difference between waiver priority and FAAB?",
    answer:
      "Waiver priority is a queue. Whoever is highest in the order wins the claim, and in most leagues using it drops you to the back. FAAB is a blind auction: everyone bids from a season-long budget, the highest bid wins, and losing costs you nothing. Priority asks whether a player is worth your place in line. FAAB asks what he is worth in dollars you cannot get back.",
  },
  {
    question: "What does it mean when a player is on waivers?",
    answer:
      "He has just been dropped and the league is holding him for a set period, usually until the next waiver run, before anybody can have him. During that window nobody can add him directly; you put in a claim and wait. It exists so that a player dropped at two in the morning does not simply go to whoever happened to be awake.",
  },
  {
    question: "Can you bid zero FAAB?",
    answer:
      "In most leagues yes, and a zero-dollar claim is how the majority of waiver adds are made, because most players nobody else wants. Measured across the leagues synced to this site, most winning claims clear for nothing at all. A one-dollar bid still beats every zero, though, so if there is any chance somebody else had the same idea it is the cheapest insurance in fantasy football.",
  },
  {
    question: "Should I use my waiver priority or wait?",
    answer:
      "Spend it on a player who will start for you for the rest of the season, and hold it for anything less. The cost of using priority is not the player, it is every future week where you are at the back of the queue when somebody better comes free. That calculation flips in the last few weeks: priority you never use is worth nothing in January.",
  },
  {
    question: "How much FAAB should I bid on a waiver claim?",
    answer:
      "It depends on what he adds to your lineup and on how many rivals want him, and the second of those moves the price more than anything about the player. Our FAAB calculator prices a claim against your actual roster, your remaining budget, and what your rivals can still spend, and the FAAB strategy guide covers the thinking behind it.",
  },
  {
    question: "How is the dynasty waiver wire different?",
    answer:
      "A redraft claim is a rental for the rest of one season, so a player who helps you in week ten is worth roughly what ten weeks of him are worth. A dynasty claim is an asset you keep, so a 22-year-old with a path to a role next year is worth real money even if he does nothing this season, and a 30-year-old filling in for four weeks is worth far less than his production suggests. The budget has to last longer too, and in most dynasty leagues it resets each season while the roster does not.",
  },
  {
    question: "Where can I see who is available in my own league?",
    answer:
      "Connect your Sleeper league to League Pulse and the lineups page lists the free agents in that specific league, ranked against your own roster. The free agent finder answers the other version of the question: given one player's name, which of your leagues still have him unowned.",
  },
];

/* ---------- Market data ---------- */

type WaiverMarket = {
  bidders: ClearingSlice[];
  overall: MarketRead | null;
  updatedAt: string | null;
};

/**
 * The measured clearing prices this page quotes.
 *
 * The same `faab_market_priors` cells the FAAB guide reads, through the same
 * helper, so the two pages can never quote different medians for the same
 * slice of the market. Read at render rather than hardcoded, and a cell below
 * the calculator's own publishing threshold prints "Not enough data yet".
 */
const BIDDER_CELLS: { key: string; label: string }[] = [
  { key: "any|any|any|any|1", label: "Nobody else bid" },
  { key: "any|any|any|any|2", label: "Two teams bidding" },
  { key: "any|any|any|any|3", label: "Three teams bidding" },
  { key: "any|any|any|any|4p", label: "Four or more bidding" },
];

async function loadWaiverMarket(): Promise<WaiverMarket> {
  const [cells, settings] = await Promise.all([
    loadPriorCellsCached(),
    loadFaabSettings(createAdminClient()),
  ]);
  const minSamples = settings.priors.minCellSamples;
  const bidders = BIDDER_CELLS.map((cell) => ({
    label: cell.label,
    read: readCell(cells, cell.key, minSamples),
  }));
  const overall = readCell(cells, "any|any|any|any|any", minSamples);
  return {
    bidders,
    overall,
    updatedAt: newestBuiltAt([overall, ...bidders.map((b) => b.read)]),
  };
}

/* ---------- Page ---------- */

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePosition(value: string | string[] | undefined): BoardPosition | null {
  const raw = firstParam(value)?.toUpperCase();
  if (!raw) return null;
  return (BOARD_POSITIONS as readonly string[]).includes(raw)
    ? (raw as BoardPosition)
    : null;
}

export default async function WaiverWirePage({
  searchParams,
}: {
  searchParams: Promise<{
    pos?: string | string[];
    format?: string | string[];
    source?: string | string[];
  }>;
}) {
  const search = await searchParams;
  const context = await resolveWaiverContext({
    format: firstParam(search.format),
    source: firstParam(search.source),
  });

  const week = context.currentWeek;

  const [isMember, market, board] = await Promise.all([
    isDiscordMember(),
    loadWaiverMarket(),
    context.format && context.sourceSlug
      ? loadWaiverBoardCached({
          week,
          format: context.format,
          sourceSlug: context.sourceSlug,
          sourceName: context.sourceName,
          settings: context.settings,
        })
      : Promise.resolve<WaiverBoard>({
          season: context.season ?? 0,
          week,
          currentWeek: context.currentWeek,
          rows: [],
          assumptions: {
            teams: 12,
            offensiveStarters: 9,
            budget: 100,
            formatName: context.format?.display_name ?? "your format",
            sourceName: context.sourceName,
            projectionSourceName: "Sleeper",
            availabilityCeilingPct: 70,
          },
          rosterRatesComputedAt: null,
          emptyReason: "no-rankings",
        }),
  ]);

  const position = parsePosition(search.pos);
  const budget = board.assumptions.budget;

  // The headline add, and the counts the rail's filter needs. Both derived
  // here so the rail and the board cannot disagree about either.
  const hero = position ? null : topPickup(board.rows);
  const counts = new Map<BoardPosition, number>();
  for (const row of board.rows) {
    counts.set(row.position, (counts.get(row.position) ?? 0) + 1);
  }

  const chips: MastheadChip[] = [
    { label: "Updated weekly", tone: "cyan" },
    { label: `Week ${week}`, tone: "purple" },
    { label: board.assumptions.formatName, tone: "plain" },
  ];

  const stats: MastheadStat[] = [];
  if (!board.emptyReason) {
    stats.push({
      label: "On the wire",
      value: String(board.rows.length),
      detail: `worth a claim in week ${week}`,
      accent: "cyan",
    });
  }
  const leagues = board.rows.find((r) => r.rosterRate)?.rosterRate?.total;
  if (leagues) {
    stats.push({
      label: "Leagues measured",
      value: String(leagues),
      detail: "real synced rosters",
      accent: "purple",
    });
  }
  if (market.overall?.enough) {
    stats.push({
      label: "Claims that cost $0",
      value: `${Math.round(market.overall.zeroShare * 100)}%`,
      detail: "of winning claims",
    });
  }

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: TITLE,
      description: DESCRIPTION,
      inLanguage: "en-US",
      isAccessibleForFree: true,
      author: authorJsonLd(),
      publisher: {
        "@type": "Organization",
        name: SITE.name,
        url: SITE.url,
        logo: { "@type": "ImageObject", url: `${SITE.url}/img/ff-beacon-logo.png` },
      },
      mainEntityOfPage: { "@type": "WebPage", "@id": CANONICAL },
      url: CANONICAL,
      articleSection: "Waiver Wire",
      about: { "@type": "Thing", name: "Fantasy football waiver wire" },
    },
    faqPageJsonLd(FAQ),
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE.url },
        { "@type": "ListItem", position: 2, name: "Waiver Wire", item: CANONICAL },
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

      <PageBody>
        <PageMasthead
          eyebrow="Waiver wire"
          title="The fantasy football waiver wire"
          chips={chips}
          stats={stats}
          description="How claims work, when they run, and who is worth putting one in for this week. Every name below is measured: who actually still has him, whose role just changed, and what a claim like that has been costing."
          actions={
            <>
              <a
                href="#board-heading"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 py-3 text-sm font-semibold text-base transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                This week&apos;s pickups
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </a>
              <Link
                href="/tools/faab"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <Calculator aria-hidden="true" className="h-4 w-4" />
                FAAB calculator
              </Link>
            </>
          }
        />

        {context.fallbackBanner && (
          <p
            role="status"
            className="mt-6 rounded-card border border-dashed border-line bg-surface px-4 py-2.5 text-sm text-ink-muted"
          >
            <span className="font-medium text-ink">Heads up:</span> No{" "}
            {context.fallbackBanner.requested} data for {board.assumptions.formatName}.
            Showing {context.fallbackBanner.actual} instead.
          </p>
        )}
      </PageBody>

      {/* THE BOARD RUNS IN TWO COLUMNS AND THE PROSE DOES NOT.
          `PageColumns` puts the controls and the method notes in a rail that
          follows the board down a wide screen and falls below it on a phone,
          which is where supplementary content belongs. The lessons underneath
          come back out into a single reading column, because a line of body
          copy across a dashboard is unreadable and a contents rail beside an
          essay is furniture nobody asked for. */}
      <PageColumns
        railLabel="Board controls and how these numbers are built"
        rail={
          <>
            <PositionRail
              basePath="/waiver-wire"
              active={position}
              counts={counts}
              total={board.rows.length}
            />
            <CalculatorRail />
            <WeekRail
              week={null}
              currentWeek={context.currentWeek}
              season={board.season || null}
            />
            <MethodRail board={board} />
            <NextRail
              links={[
                {
                  href: "/guides/faab-strategy",
                  title: "How much to bid",
                  body: "Nine lessons on budgets, timing and the mistakes that lose leagues in October.",
                },
                {
                  href: "/tools/who-should-i-start",
                  title: "Then set the lineup",
                  body: "Whether your new player actually beats the one already in the slot.",
                },
                {
                  href: "/tools/free-agent-finder",
                  title: "Check your other leagues",
                  body: "One name against every league you are in, and where he is still free.",
                },
              ]}
            />
          </>
        }
      >
        <TheShortVersion />

        {hero && <TopPickup row={hero} week={week} isPast={false} />}

        <WaiverBoardPanel
          board={board}
          basePath="/waiver-wire"
          activePosition={position}
          headingId="board-heading"
          heading="This week's waiver wire pickups"
          excludePlayerIds={hero ? [hero.playerId] : []}
        />

        <Link
          href={weekPath(week)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-brand-cyan/50 bg-brand-cyan/10 px-4 py-2.5 text-sm font-semibold text-brand-cyan transition-colors hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Open the week {week} page on its own
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </PageColumns>

      <PageBody>
        <div className="mt-6">
          <Syllabus />
        </div>

        <div className="mt-10 max-w-4xl text-[15px] sm:text-base">
          <WhatSection />
          <SystemsSection />
          <TimingSection />
          <WhoSection />
          <PriceSection market={market} budget={budget} />
          <DynastySection />
          <MistakesSection />

          <section aria-labelledby="faq-heading" className="mt-12">
            <GuideSectionHeader id="faq-heading" eyebrow="FAQ" heading="Questions, answered" />
            <div className="mt-5">
              <FaqAccordion items={FAQ} />
            </div>
          </section>
        </div>
      </PageBody>

      <DiscordCtaSection
        eyebrow="Waivers run Wednesday"
        heading="Not sure which claim to put in?"
        body="Drop your roster and who is available in our Discord and real managers will tell you which one actually moves your week, free."
        isMember={isMember}
        memberHeading="You know who. Now work out how much."
        memberBody="You're already in the crew, so we'll skip the invite. The FAAB calculator prices the claim against your real roster and what your rivals have left to spend."
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
          A dropped player does not go straight back on the shelf. He sits on waivers until
          your league&apos;s next run, everybody who wants him puts in a claim, and the league
          decides who gets him: by queue position if you use waiver priority, by the highest
          bid if you use FAAB. Nearly every league runs that on Wednesday morning by default.
        </p>
        <p className="mt-3 text-sm leading-relaxed" style={{ color: "#F4F4F8" }}>
          The decision is simpler than the machinery. Add the player whose ROLE changed, not
          the one who had a good Sunday, and price him against the worst player you would
          actually start rather than against how good he is in the abstract. The{" "}
          <Link
            href="/guides/faab-strategy"
            className="font-semibold text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            FAAB strategy guide
          </Link>{" "}
          covers the money; this page covers everything around it.
        </p>
      </div>
    </section>
  );
}

function Syllabus() {
  return (
    <section aria-labelledby="syllabus-heading">
      <h2
        id="syllabus-heading"
        className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle"
      >
        <ListTree aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
        The {LESSON_WORDS[LESSONS.length]} sections
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
                  <span className="sr-only">Section {i + 1}: </span>
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

/* ---------- Lesson 1 ---------- */

function WhatSection() {
  return (
    <section aria-labelledby="what-heading" className="mt-12">
      <GuideSectionHeader
        id="what-heading"
        eyebrow={lessonEyebrow("#what-heading")}
        heading="What the waiver wire actually is"
        tone="purple"
      />
      <Para>
        The waiver wire is a lock on the free agent pool. When a manager drops a player, he
        does not become instantly available to whoever is quickest. He goes on waivers for a
        set period, and during that period the only way to get him is to put in a claim and
        wait for your league to process them all at once.
      </Para>
      <Para>
        The reason is fairness. Without it, a player dropped at two in the morning goes to
        whichever manager happened to be awake, and the fantasy season becomes a test of who
        has notifications turned on. A waiver period turns that race into a decision.
      </Para>
      <Para>
        Once the waiver run finishes, anyone nobody claimed stops being on waivers and becomes
        an ordinary free agent. At that point it genuinely is first come, first served, which
        is why the hours after a Wednesday morning waiver run are the other moment worth
        paying attention to.
      </Para>

      <GuideSubheading className="mt-8">The three states a player can be in</GuideSubheading>
      <BulletList
        items={[
          <>
            <span className="font-semibold text-ink">Rostered.</span> Somebody owns him. The
            only routes to him are a trade or that manager dropping him.
          </>,
          <>
            <span className="font-semibold text-ink">On waivers.</span> Recently dropped, or
            never yet rostered in a league that puts everybody through waivers. Claims only,
            processed together at your league&apos;s next run.
          </>,
          <>
            <span className="font-semibold text-ink">A free agent.</span> Cleared waivers
            unclaimed. Anybody can add him instantly, at any hour, for nothing.
          </>,
        ]}
      />
      <KeyIdea>
        Most of the players worth adding all season were free agents, not waiver claims.
        The wire matters because of the handful of weeks when somebody&apos;s job changes and
        four managers want the same name.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 2 ---------- */

function SystemsSection() {
  return (
    <section aria-labelledby="systems-heading" className="mt-12">
      <GuideSectionHeader
        id="systems-heading"
        eyebrow={lessonEyebrow("#systems-heading")}
        heading="Waiver priority against FAAB"
        tone="cyan"
      />
      <Para>
        Every league resolves competing claims one of two ways, and which one you are in
        changes the whole shape of the decision. It is worth knowing which before the season
        starts rather than the first time you lose a claim.
      </Para>
      <div className="mt-6">
        <PriorityVsFaabFigure />
      </div>
      <Para>
        There is a third variation worth naming because it catches people out. Some priority
        leagues use a REVERSE STANDINGS order that resets every week rather than a rolling
        queue, so the worst team in the league is first in line every Wednesday and using it
        costs nothing at all. In one of those, there is no reason to hold priority back, and
        a manager playing it like a rolling queue is leaving free players on the table all
        season.
      </Para>
      <KeyIdea>
        In a rolling priority league the question is whether he is worth your place in line.
        In a FAAB league the question is what he is worth in dollars. In a weekly reset
        league there is barely a question at all: if you are near the top, use it.
      </KeyIdea>
      <TryIt href="/guides/faab-strategy" label="Read the FAAB guide">
        If your league uses FAAB, the bidding is its own skill: how much of the budget a
        starter is worth, when to empty it, and why the odd number wins.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 3 ---------- */

function TimingSection() {
  return (
    <section aria-labelledby="timing-heading" className="mt-12">
      <GuideSectionHeader
        id="timing-heading"
        eyebrow={lessonEyebrow("#timing-heading")}
        heading="When claims actually run"
        tone="purple"
      />
      <Para>
        The single most searched waiver question, and the one most often answered wrongly by a
        page that assumes everybody is on the same platform. Here is what each of the four big
        ones does by default.
      </Para>
      <div className="mt-6">
        <ProcessingFigure />
      </div>
      <Para>
        Two practical consequences. The first is that Tuesday evening is the real deadline in
        most leagues, not Wednesday morning, because a claim has to be in before the run
        starts. The second is that the waiver run is not the last chance: anyone who clears
        unclaimed is a free agent from that moment, and Wednesday morning is when the leftovers
        become free to anybody watching.
      </Para>
      <KeyIdea>
        Set a reminder for Tuesday night, not Wednesday morning. By the time the run has
        happened, the decision has been made for you.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 4 ---------- */

function WhoSection() {
  return (
    <section aria-labelledby="who-heading" className="mt-12">
      <GuideSectionHeader
        id="who-heading"
        eyebrow={lessonEyebrow("#who-heading")}
        heading="Who is actually worth adding"
        tone="cyan"
      />
      <Para>
        Almost every waiver mistake is the same mistake: bidding on a box score instead of a
        role. A receiver who caught two passes and took one of them eighty yards scored
        eighteen points and is still the fourth option on his own offence. A back who carried
        it seventeen times for fifty-one yards scored nothing and just became his team&apos;s
        starter. The second one is the add, every time.
      </Para>
      <Para>
        That is why the board on this page leads with usage rather than with points. Targets
        and carries are the closest thing to a direct measurement of what a coaching staff
        thinks of a player, and they move a week or two before the fantasy points do.
      </Para>

      <GuideSubheading className="mt-8">The four questions, in order</GuideSubheading>
      <BulletList
        items={[
          <>
            <span className="font-semibold text-ink">Can I actually get him?</span> A player
            rostered in most leagues is not a waiver plan. Our board leaves out anyone held in
            70 percent or more of the leagues we track for exactly this reason.
          </>,
          <>
            <span className="font-semibold text-ink">Did something change?</span> A new
            starter, an injury ahead of him, a trade that cleared the depth chart. If you
            cannot name the change in a sentence, you are buying a good afternoon.
          </>,
          <>
            <span className="font-semibold text-ink">Is he better than what I would
            start?</span> Not better than the worst player on your roster. Better than the
            worst player you would actually put in a lineup, which is a much higher bar.
          </>,
          <>
            <span className="font-semibold text-ink">What is he worth to everyone else?</span>{" "}
            The price is set by how many rivals need him, not by how much you like him.
          </>,
        ]}
      />
      <KeyIdea>
        Buy the role, not the box score. The player whose job changed is worth money even if
        he scored nothing on Sunday, and the player who scored thirty in a role that has not
        changed is worth almost nothing.
      </KeyIdea>
      <TryIt href="/tools/faab" label="Open the calculator">
        The FAAB calculator answers the third question properly. Connect your league and it
        prices a claim against the player you would actually drop and the lineup you would
        actually set.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 5 ---------- */

function PriceSection({ market, budget }: { market: WaiverMarket; budget: number }) {
  return (
    <section aria-labelledby="price-heading" className="mt-12">
      <GuideSectionHeader
        id="price-heading"
        eyebrow={lessonEyebrow("#price-heading")}
        heading="What a claim actually costs"
        tone="purple"
      />
      <Para>
        These are not estimates. They are measured from every waiver auction in every league
        synced to FF Beacon, stored as anonymous quantiles with no league, roster or manager
        attached to any of them.
      </Para>
      <div className="mt-6">
        <FreeClaimFigure read={market.overall} budget={budget} />
      </div>
      <Para>
        The number that surprises people is how many claims cost nothing at all. Most weeks,
        most adds are uncontested, which means the budget is not really for them. It is for
        the small number of Tuesdays when a starting job changes hands and four managers all
        work that out at once.
      </Para>
      <div className="mt-6">
        <ClearingPriceFigure slices={market.bidders} budget={budget} />
      </div>
      <Para>
        Read those two together and the whole strategy falls out of them. The number of rivals
        bidding moves the price more than anything about the player, and you cannot see that
        number before you bid. What you can see is how many teams around you have a hole at
        his position, which is the closest available proxy and the thing our calculator counts
        for you when a league is connected.
      </Para>
      <KeyIdea>
        You are not bidding against the player&apos;s value. You are bidding against the other
        managers who need him, and there are usually fewer of them than you fear.
      </KeyIdea>
    </section>
  );
}

/* ---------- Lesson 6 ---------- */

function DynastySection() {
  return (
    <section aria-labelledby="dynasty-heading" className="mt-12">
      <GuideSectionHeader
        id="dynasty-heading"
        eyebrow={lessonEyebrow("#dynasty-heading")}
        heading="Dynasty waivers are a different wire"
        tone="cyan"
      />
      <Para>
        In a redraft league a waiver claim is a rental. You are buying whatever this player
        does between now and the end of the season, and in week fourteen that is three games.
        In a dynasty league you are buying an asset you keep, so the arithmetic changes in
        both directions at once.
      </Para>
      <BulletList
        items={[
          <>
            <span className="font-semibold text-ink">Young players are worth more than
            their production.</span> A 22-year-old who just got on the field is a real buy at
            a real price even if he does nothing this season, because you own him next
            September.
          </>,
          <>
            <span className="font-semibold text-ink">Old fill-ins are worth less.</span> A
            30-year-old starting four games while somebody heals wins you those four games and
            then occupies a roster spot for three years.
          </>,
          <>
            <span className="font-semibold text-ink">The wire is thinner.</span> Dynasty
            rosters are deeper and the taxi squad soaks up exactly the profile a redraft league
            leaves free, so the genuinely available player is rarer and worth more when he
            appears.
          </>,
          <>
            <span className="font-semibold text-ink">A rebuilder should be bidding harder
            than a contender.</span> The contender is buying three months. The rebuilder is
            buying a lottery ticket that costs money they have no other use for.
          </>,
        ]}
      />
      <Para>
        Our board splits the availability figure by league type for this reason. A player
        rostered in 80 percent of dynasty leagues and 30 percent of redraft leagues is a
        completely different proposition depending on which room you are in, and a single
        blended number would describe neither.
      </Para>
      <TryIt href="/guides/dynasty-strategy" label="Read the dynasty guide">
        Whether you should be buying at all depends on whether this roster is contending or
        rebuilding, and the dynasty guide has the honest test for which one you are.
      </TryIt>
    </section>
  );
}

/* ---------- Lesson 7 ---------- */

function MistakesSection() {
  return (
    <section aria-labelledby="mistakes-heading" className="mt-12">
      <GuideSectionHeader
        id="mistakes-heading"
        eyebrow={lessonEyebrow("#mistakes-heading")}
        heading="The mistakes that cost the most"
        tone="purple"
      />
      <BulletList
        items={[
          <>
            <span className="font-semibold text-ink">Finishing the season with money
            left.</span> Leftover FAAB in January bought nothing. A dollar in week two and a
            dollar in week fourteen are not the same money, because the later one has fewer
            chances left to be spent.
          </>,
          <>
            <span className="font-semibold text-ink">Bidding round numbers.</span> Everybody
            bids 10 and 20, so those are exactly the ties you are most likely to be in, and
            your league settles them with priority or a coin flip rather than in your favour.
            Make it 11.
          </>,
          <>
            <span className="font-semibold text-ink">Claiming a player you would not
            start.</span> A claim costs a roster spot as well as money, and the player you
            drop to make room is part of the price.
          </>,
          <>
            <span className="font-semibold text-ink">Waiting for the perfect
            week.</span> The best waiver adds of a season are usually claimed in weeks two
            through five, when a starting job changes and nobody is sure yet whether it is
            real.
          </>,
          <>
            <span className="font-semibold text-ink">Reading last week&apos;s points as
            this week&apos;s role.</span> The whole of lesson four, and the one that costs the
            most money per mistake.
          </>,
        ]}
      />
      <Para>
        The counterweight to all of that is the thing the measured prices above actually show:
        most claims cost nothing, so the cost of being slightly too aggressive is small and
        the cost of being permanently too cautious is a budget you never spent.
      </Para>
      <div className="mt-8 rounded-card border border-line bg-surface/50 p-5">
        <h3 className="text-base font-semibold text-ink">Where to go from here</h3>
        <ul role="list" className="mt-3 space-y-2 text-sm leading-relaxed text-ink-muted">
          <li>
            <Link href="/guides/faab-strategy" className={LINK_CLASS}>
              FAAB strategy
            </Link>{" "}
            for how much to bid, in nine lessons with a worked example.
          </li>
          <li>
            <Link href="/guides/faab-settings-by-platform" className={LINK_CLASS}>
              FAAB settings by platform
            </Link>{" "}
            if you are trying to turn it on, change the budget, or work out what your
            league&apos;s waiver type means.
          </li>
          <li>
            <Link href="/tools/free-agent-finder" className={LINK_CLASS}>
              Free agent finder
            </Link>{" "}
            to check one name against every league you are in at once.
          </li>
          <li>
            <Link href="/guides/chopped-league-strategy" className={LINK_CLASS}>
              Chopped and guillotine leagues
            </Link>
            , where the wire is the entire game.
          </li>
        </ul>
      </div>
    </section>
  );
}
