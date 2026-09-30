import type { Metadata } from "next";
import Link from "next/link";
import {
  AlarmClock,
  ArrowRight,
  Armchair,
  Axe,
  BookOpen,
  Calculator,
  CalendarClock,
  CircleDollarSign,
  Gavel,
  GitCompareArrows,
  Hammer,
  HandCoins,
  Hourglass,
  Layers,
  Lock,
  MessageCircleQuestion,
  Percent,
  PiggyBank,
  Receipt,
  Scale,
  ScrollText,
  Search,
  Settings2,
  Shuffle,
  Sprout,
  Target,
  Timer,
  TriangleAlert,
  Unlock,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { SITE } from "@/lib/site";
import { authorJsonLd, serializeJsonLd } from "@/lib/json-ld";
import { pageShareMetadata } from "@/lib/page-og";
import { PageBody } from "@/components/app-shell/page-body";
import { FormatFallbackBanner } from "@/components/format-fallback-banner";
import { PageColumns } from "@/components/app-shell/page-columns";
import {
  PageMasthead,
  type MastheadChip,
  type MastheadStat,
} from "@/components/app-shell/page-masthead";
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
  WeekRail,
} from "@/components/waiver-wire/board-rail";
import { resolveWaiverContext } from "@/lib/waiver-wire/context";
import { loadWaiverBoardCached, unavailableBoard } from "@/lib/waiver-wire/load";
import { loadBudgetSpreadCached, type BudgetSpread } from "@/lib/waiver-wire/budgets";
import { weekPath } from "@/lib/waiver-wire/weeks";
import { BOARD_POSITIONS, type BoardPosition } from "@/lib/waiver-wire/types";
import { BudgetProvider } from "@/components/waiver-wire/budget-context";
import { PlaybookNav, type PlaybookItem } from "@/components/waiver-wire/playbook-nav";
import { KeyIdea, LessonCard, Para, TileGrid, TryIt } from "@/components/waiver-wire/playbook";
import { HotClaims } from "@/components/waiver-wire/hot-claims";
import { PercentExplainer } from "@/components/waiver-wire/percent-explainer";
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

const TITLE = "Fantasy Football Waiver Wire: Pickups, FAAB Bids and How It Works";
const DESCRIPTION =
  "This week's fantasy football waiver wire pickups with a FAAB bid for each as a percentage of your budget, priced from real claims. Plus when waivers process on Sleeper, Yahoo and ESPN, and priority against FAAB.";
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
    "waiver wire pickups",
    "best waiver wire pickups",
    "waiver wire adds this week",
    "faab bids",
    "how much faab to bid",
    "faab bid percentage",
    "faab bid amounts",
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

type LessonKey =
  | "what"
  | "systems"
  | "timing"
  | "who"
  | "price"
  | "percent"
  | "dynasty"
  | "mistakes";

/**
 * The playbook, in order. `id` is the section anchor the contents nav points
 * at; `headingId` names the section; `short` is the chip label on a phone.
 */
const LESSONS: {
  key: LessonKey;
  id: string;
  headingId: string;
  heading: string;
  short: string;
  takeaway: string;
  icon: LucideIcon;
}[] = [
  {
    key: "what",
    id: "lesson-what",
    headingId: "what-heading",
    heading: "What the waiver wire actually is",
    short: "What it is",
    takeaway: "A queue with a lock on it.",
    icon: Lock,
  },
  {
    key: "systems",
    id: "lesson-systems",
    headingId: "systems-heading",
    heading: "Waiver priority against FAAB",
    short: "Priority vs FAAB",
    takeaway: "Two games, one name.",
    icon: GitCompareArrows,
  },
  {
    key: "timing",
    id: "lesson-timing",
    headingId: "timing-heading",
    heading: "When claims actually run",
    short: "When it runs",
    takeaway: "Wednesday, nearly everywhere.",
    icon: CalendarClock,
  },
  {
    key: "who",
    id: "lesson-who",
    headingId: "who-heading",
    heading: "Who is actually worth adding",
    short: "Who to add",
    takeaway: "Buy the role, not the box score.",
    icon: Target,
  },
  {
    key: "price",
    id: "lesson-price",
    headingId: "price-heading",
    heading: "What a claim actually costs",
    short: "What it costs",
    takeaway: "Most of them cost nothing.",
    icon: Receipt,
  },
  {
    key: "percent",
    id: "lesson-percent",
    headingId: "percent-heading",
    heading: "Bid in percentages, not dollars",
    short: "Percentages",
    takeaway: "Budgets differ; shares do not.",
    icon: Percent,
  },
  {
    key: "dynasty",
    id: "lesson-dynasty",
    headingId: "dynasty-heading",
    heading: "Dynasty waivers are a different wire",
    short: "Dynasty",
    takeaway: "You are buying a season, not a week.",
    icon: Sprout,
  },
  {
    key: "mistakes",
    id: "lesson-mistakes",
    headingId: "mistakes-heading",
    heading: "The mistakes that cost the most",
    short: "Mistakes",
    takeaway: "Hoarding, and bidding round numbers.",
    icon: TriangleAlert,
  },
];

const PLAYBOOK_ITEMS: PlaybookItem[] = [
  ...LESSONS.map((l) => ({ id: l.id, title: l.heading, short: l.short })),
  { id: "faq", title: "Questions, answered", short: "FAQ" },
];

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
      "Think in percentages of your season budget rather than dollars, and price the competition before the player. A claim nobody else wants usually clears for nothing, while one that several teams want usually takes a real share of the budget; the measured figures are in the section on what a claim costs. Every pickup on this page carries a range: the lower figure wins about 6 times in 10 and the higher about 9 in 10, read from what claims like it have actually cleared at. Pay it only if he would start for you. Our FAAB calculator prices a claim against your actual roster, your remaining budget and what your rivals can still spend.",
  },
  {
    question: "Why are FAAB bids shown as a percentage of budget?",
    answer:
      "Because budgets differ from league to league. Among the leagues synced to this site, $100 and $1,000 are both common and neither covers most leagues, so a dollar figure on a public page is wrong for a large share of the people reading it. A percentage of the season budget is the same decision in every league: 20 percent is $20 in a $100 league and $200 in a $1,000 one. The converter on this page turns every bid into dollars for your own budget.",
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

  const [isMember, market, spread, board] = await Promise.all([
    isDiscordMember(),
    loadWaiverMarket(),
    context.season != null
      ? loadBudgetSpreadCached(context.season)
      : Promise.resolve<BudgetSpread>({ total: 0, buckets: [], otherLeagues: 0 }),
    context.format && context.sourceSlug
      ? loadWaiverBoardCached({
          week,
          format: context.format,
          sourceSlug: context.sourceSlug,
          sourceName: context.sourceName,
          settings: context.settings,
        })
      : Promise.resolve(
          unavailableBoard({
            season: context.season,
            week,
            currentWeek: context.currentWeek,
            formatName: context.format?.display_name ?? null,
            sourceName: context.sourceName,
          }),
        ),
  ]);

  const position = parsePosition(search.pos);

  // The headline add. `?pos=` only picks the board's opening tab now, so the
  // hero stays whichever tab a shared link opens on.
  const hero = topPickup(board.rows);

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
  const topBid = hero?.bid ?? board.rows.find((r) => r.bid)?.bid ?? null;
  if (topBid) {
    stats.push({
      label: "Top pickup bid",
      value:
        topBid.lowPct === topBid.highPct
          ? `${topBid.highPct}%`
          : `${topBid.lowPct}-${topBid.highPct}%`,
      detail: "of your season budget",
      accent: "purple",
    });
  }
  if (market.overall?.enough) {
    stats.push({
      label: "Claims that cost nothing",
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
      ...(board.rosterRatesComputedAt ? { dateModified: board.rosterRatesComputedAt } : {}),
    },
    faqPageJsonLd(FAQ),
    ...(board.rows.length > 0
      ? [
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: `Week ${week} fantasy football waiver wire pickups`,
            numberOfItems: Math.min(10, board.rows.length),
            itemListElement: [
              ...(hero ? [hero] : []),
              ...board.rows.filter((r) => r.playerId !== hero?.playerId),
            ]
              .slice(0, 10)
              .map((row, i) => ({
                "@type": "ListItem",
                position: i + 1,
                name: `${row.name}, ${row.position}${row.team ? ` ${row.team}` : ""}`,
                url: `${SITE.url}/players/${encodeURIComponent(row.slug)}`,
              })),
          },
        ]
      : []),
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
                className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-card bg-beacon px-5 py-3 sm:w-auto text-sm font-semibold text-[#07070D] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                This week&apos;s pickups
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </a>
              <Link
                href="/tools/faab"
                className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 sm:w-auto text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <Calculator aria-hidden="true" className="h-4 w-4" />
                FAAB calculator
              </Link>
            </>
          }
        />

        <FormatFallbackBanner fallback={context.formatFallback} className="mt-6" />
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

      {/* THE BOARD AND THE PLAYBOOK SHARE ONE GRID.
          `PageColumns` puts the week picker and the method notes in a rail that
          follows the board down a wide screen and falls below it on a phone.
          The playbook underneath uses the same two-column grid, with its own
          contents nav in the rail, so the main column keeps one width from the
          masthead to the FAQ instead of narrowing halfway down the page. */}
      <PageColumns
        railLabel="Board controls and how these numbers are built"
        rail={
          <>
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

        <BudgetProvider>
          {hero && <TopPickup row={hero} week={week} isPast={false} />}

          <WaiverBoardPanel
            board={board}
            basePath="/waiver-wire"
            activePosition={position}
            headingId="board-heading"
            heading="This week's waiver wire pickups"
            excludePlayerIds={hero ? [hero.playerId] : []}
          />
        </BudgetProvider>

        <HotClaims claims={board.hotClaims} window={board.assumptions.claimWeeks} />

        <Link
          href={weekPath(week)}
          className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-brand-cyan/50 bg-brand-cyan/10 px-4 py-2.5 text-sm font-semibold text-brand-cyan transition-colors hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Open the week {week} page on its own
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </PageColumns>

      <PageBody>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <PlaybookIntro />
            <PlaybookNav items={PLAYBOOK_ITEMS} variant="bar" />

            <div className="mt-6 space-y-6">
              <WhatSection />
              <SystemsSection />
              <TimingSection />
              <WhoSection />
              <PriceSection market={market} />
              <PercentSection spread={spread} />
              <DynastySection />
              <MistakesSection />

              <section
                id="faq"
                aria-labelledby="faq-heading"
                className="relative scroll-mt-32 overflow-hidden rounded-3xl xl:scroll-mt-28 border border-line bg-surface/40 p-4 sm:p-7"
              >
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
                  <MessageCircleQuestion aria-hidden="true" className="h-3.5 w-3.5" />
                  FAQ
                </p>
                <h2
                  id="faq-heading"
                  className="mt-1 text-xl font-bold tracking-tight text-ink sm:text-[26px]"
                >
                  Waiver wire questions, answered
                </h2>
                <div className="mt-5">
                  <FaqAccordion items={FAQ} />
                </div>
              </section>
            </div>
          </div>

          <aside className="hidden xl:block">
            <div className="sticky top-[5.5rem] space-y-4">
              <PlaybookNav items={PLAYBOOK_ITEMS} variant="rail" />
              <div
                className="rounded-3xl p-px"
                style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
              >
                <div className="rounded-[calc(1.5rem-1px)] bg-[#16162A] p-4">
                  <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-cyan">
                    <Calculator aria-hidden="true" className="h-3.5 w-3.5" />
                    Put it to work
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                    The calculator prices a claim against your own roster and what your rivals
                    can still spend.
                  </p>
                  <Link
                    href="/tools/faab"
                    className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-beacon px-4 py-2.5 text-sm font-semibold text-[#07070D] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  >
                    Open the FAAB calculator
                  </Link>
                </div>
              </div>
            </div>
          </aside>
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

/** The lesson card for one entry in LESSONS, looked up by its key. */
function Lesson({ lessonKey, children }: { lessonKey: LessonKey; children: React.ReactNode }) {
  const i = LESSONS.findIndex((l) => l.key === lessonKey);
  const l = LESSONS[i];
  return (
    <LessonCard
      id={l.id}
      headingId={l.headingId}
      number={i + 1}
      total={LESSONS.length}
      heading={l.heading}
      takeaway={l.takeaway}
      icon={l.icon}
      tone={i % 2 === 0 ? "purple" : "cyan"}
    >
      {children}
    </LessonCard>
  );
}

/** A heading inside a lesson, one level under the lesson's own. */
function LessonSubheading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-8 text-lg font-semibold tracking-tight text-ink sm:text-xl">{children}</h3>
  );
}

/**
 * The whole mechanic in three steps, above the board. A reader who arrived on
 * the head term gets the answer before any list of names.
 */
function TheShortVersion() {
  const steps: { icon: LucideIcon; title: string; body: string }[] = [
    {
      icon: Hourglass,
      title: "He is dropped",
      body: "He does not go straight back on the shelf. He sits on waivers until your league's next run.",
    },
    {
      icon: HandCoins,
      title: "Everybody claims",
      body: "Every manager who wants him puts in a claim, blind, before the run starts.",
    },
    {
      icon: Gavel,
      title: "The league decides",
      body: "By queue position with waiver priority, by the highest bid with FAAB. Nearly every league runs it Wednesday morning.",
    },
  ];
  return (
    <section
      aria-labelledby="short-version"
      className="relative overflow-hidden rounded-3xl border border-line bg-surface/40 p-4 sm:p-6"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      <h2
        id="short-version"
        className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan"
      >
        The short version
      </h2>
      <ol role="list" className="mt-3 grid gap-2 sm:grid-cols-3 sm:gap-3">
        {steps.map((step, i) => {
          const Icon = step.icon;
          return (
            <li
              key={step.title}
              className="relative flex gap-3 rounded-2xl border border-line/80 bg-base/50 p-3.5 sm:flex-col sm:gap-2"
            >
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#07070D]"
                style={{
                  backgroundImage:
                    i === 1
                      ? "linear-gradient(140deg, #22D3EE 0%, #A855F7 100%)"
                      : i === 0
                        ? "linear-gradient(140deg, #A855F7 0%, #6D28D9 100%)"
                        : "linear-gradient(140deg, #22D3EE 0%, #0E7490 100%)",
                }}
              >
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-ink">
                  <span className="mr-1 font-mono text-xs text-ink-subtle">
                    {i + 1}
                    <span className="sr-only">.</span>
                  </span>
                  {step.title}
                </h3>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">{step.body}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-sm leading-relaxed text-ink-muted">
        The decision is simpler than the machinery. Add the player whose ROLE changed, not the
        one who had a good Sunday, and price him against the worst player you would actually
        start. The{" "}
        <Link
          href="/guides/faab-strategy"
          className="font-semibold text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          FAAB strategy guide
        </Link>{" "}
        covers the money; this page covers everything around it.
      </p>
    </section>
  );
}

/** The playbook's opening, so the lessons read as one course rather than a list. */
function PlaybookIntro() {
  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-purple">
          <BookOpen aria-hidden="true" className="h-3.5 w-3.5" />
          The waiver wire playbook
        </p>
        <p className="mt-1 text-lg font-semibold text-ink sm:text-xl">
          Everything around the claim, in {LESSONS.length} lessons.
        </p>
      </div>
      <p className="max-w-sm text-sm leading-relaxed text-ink-muted sm:text-right">
        How the wire works, when it runs, who is worth it and what it costs. Jump to any lesson
        from the contents.
      </p>
    </div>
  );
}

/* ---------- Lesson 1 ---------- */

function WhatSection() {
  return (
    <Lesson lessonKey="what">
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

      <LessonSubheading>The three states a player can be in</LessonSubheading>
      <TileGrid
        columns="sm:grid-cols-3"
        headingLevel={4}
        tiles={[
          {
            icon: Lock,
            tone: "danger",
            title: "Rostered",
            body: "Somebody owns him. The only routes to him are a trade or that manager dropping him.",
          },
          {
            icon: Hourglass,
            tone: "amber",
            title: "On waivers",
            body: "Recently dropped, or never yet rostered in a league that puts everybody through waivers. Claims only, processed together at your league's next run.",
          },
          {
            icon: Unlock,
            tone: "success",
            title: "A free agent",
            body: "Cleared waivers unclaimed. Anybody can add him instantly, at any hour, for nothing.",
          },
        ]}
      />
      <KeyIdea>
        Most of the players worth adding all season were free agents, not waiver claims. The
        wire matters because of the handful of weeks when somebody&apos;s job changes and four
        managers want the same name.
      </KeyIdea>
    </Lesson>
  );
}

/* ---------- Lesson 2 ---------- */

function SystemsSection() {
  return (
    <Lesson lessonKey="systems">
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
        costs nothing at all. In one of those, there is no reason to hold priority back, and a
        manager playing it like a rolling queue is leaving free players on the table all
        season.
      </Para>
      <KeyIdea>
        In a rolling priority league the question is whether he is worth your place in line.
        In a FAAB league the question is what he is worth in dollars. In a weekly reset league
        there is barely a question at all: if you are near the top, use it.
      </KeyIdea>
      <TryIt href="/guides/faab-strategy" label="Read the FAAB guide">
        If your league uses FAAB, the bidding is its own skill: how much of the budget a starter
        is worth, when to empty it, and why the odd number wins.
      </TryIt>
    </Lesson>
  );
}

/* ---------- Lesson 3 ---------- */

function TimingSection() {
  return (
    <Lesson lessonKey="timing">
      <Para>
        The single most searched waiver question, and the one most often answered wrongly by a
        page that assumes everybody is on the same platform. First the rhythm of a default
        week, then what each of the four big platforms does.
      </Para>
      <TileGrid
        numbered
        columns="sm:grid-cols-2 2xl:grid-cols-4"
        tiles={[
          {
            icon: CalendarClock,
            tone: "purple",
            title: "From Tuesday: claims go in",
            body: "Waivers on most platforms default to an overnight run, so a claim entered any time from Tuesday is in time.",
          },
          {
            icon: AlarmClock,
            tone: "danger",
            title: "Tuesday night: the real deadline",
            body: "A claim has to be in before the run starts, which in most leagues is overnight into Wednesday.",
          },
          {
            icon: Gavel,
            tone: "cyan",
            title: "Wednesday morning: the run",
            body: "Every claim is processed at once, by priority or by the highest bid.",
          },
          {
            icon: Unlock,
            tone: "success",
            title: "After the run: free agents",
            body: "Anyone left unclaimed is first come, first served, for anybody watching.",
          },
        ]}
      />
      <div className="mt-6">
        <ProcessingFigure />
      </div>
      <KeyIdea>
        Set a reminder for Tuesday night, not Wednesday morning. By the time the run has
        happened, the decision has been made for you.
      </KeyIdea>
    </Lesson>
  );
}

/* ---------- Lesson 4 ---------- */

function WhoSection() {
  return (
    <Lesson lessonKey="who">
      <Para>
        Almost every waiver mistake is the same mistake: bidding on a box score instead of a
        role. A receiver who caught two passes and took one of them eighty yards scored eighteen
        points and is still the fourth option on his own offence. A back who carried it
        seventeen times for fifty-one yards scored nothing and just became his team&apos;s
        starter. The second one is the add, every time.
      </Para>
      <Para>
        That is why the board on this page leads with usage rather than with points. Targets and
        carries are the closest thing to a direct measurement of what a coaching staff thinks of
        a player, and they move a week or two before the fantasy points do.
      </Para>

      <LessonSubheading>The four questions, in order</LessonSubheading>
      <TileGrid
        numbered
        headingLevel={4}
        tiles={[
          {
            icon: Search,
            tone: "cyan",
            title: "Can I actually get him?",
            body: "A player rostered in most leagues is not a waiver plan. Our board leaves out anyone held in 70 percent or more of the leagues we track for exactly this reason.",
          },
          {
            icon: Shuffle,
            tone: "purple",
            title: "Did something change?",
            body: "A new starter, an injury ahead of him, a trade that cleared the depth chart. If you cannot name the change in a sentence, you are buying a good afternoon.",
          },
          {
            icon: Scale,
            tone: "cyan",
            title: "Is he better than what I would start?",
            body: "Not better than the worst player on your roster. Better than the worst player you would actually put in a lineup, which is a much higher bar.",
          },
          {
            icon: Users,
            tone: "purple",
            title: "What is he worth to everyone else?",
            body: "The price is set by how many rivals need him, not by how much you like him.",
          },
        ]}
      />
      <KeyIdea>
        Buy the role, not the box score. The player whose job changed is worth money even if he
        scored nothing on Sunday, and the player who scored thirty in a role that has not changed
        is worth almost nothing.
      </KeyIdea>
      <TryIt href="/tools/faab" label="Open the calculator">
        The FAAB calculator answers the third question properly. Connect your league and it
        prices a claim against the player you would actually drop and the lineup you would
        actually set.
      </TryIt>
    </Lesson>
  );
}

/* ---------- Lesson 5 ---------- */

function PriceSection({ market }: { market: WaiverMarket }) {
  return (
    <Lesson lessonKey="price">
      <div className="grid gap-6 2xl:grid-cols-2 2xl:items-start">
        <div>
          <Para>
            These are not estimates. They are measured from every waiver auction in every league
            synced to FF Beacon, stored as anonymous quantiles with no league, roster or manager
            attached to any of them.
          </Para>
          <Para>
            The number that surprises people is how many claims cost nothing at all. Most weeks,
            most adds are uncontested, which means the budget is not really for them. It is for
            the small number of Tuesdays when a starting job changes hands and four managers all
            work that out at once.
          </Para>
        </div>
        <FreeClaimFigure read={market.overall} />
      </div>
      <div className="mt-6">
        <ClearingPriceFigure slices={market.bidders} />
      </div>
      <Para>
        Read those two together and the whole strategy falls out of them. The number of rivals
        bidding moves the price more than anything about the player, and you cannot see that
        number before you bid. What you can see is how many teams around you have a hole at his
        position, which is the closest available proxy and the thing our calculator counts for
        you when a league is connected.
      </Para>
      <KeyIdea>
        You are not bidding against the player&apos;s value. You are bidding against the other
        managers who need him, and there are usually fewer of them than you fear.
      </KeyIdea>
    </Lesson>
  );
}

/* ---------- Lesson 6 ---------- */

function PercentSection({ spread }: { spread: BudgetSpread }) {
  return (
    <Lesson lessonKey="percent">
      <Para>
        Every bid on this page is a share of the season budget, and that is deliberate. The
        figures above are shares too. A public page cannot see your league, and the leagues it
        is written for do not agree on how much money there is to spend.
      </Para>
      <div className="mt-6">
        <PercentExplainer
          spread={spread}
          headingId="percent-figure-heading"
          headingLevel={3}
          bare
        />
      </div>
      <KeyIdea>
        Read a bid as a share of what you started the season with. If the board says 12 to 20
        percent and your league plays for $1,000, that is $120 to $200, and the converter on the
        board does the arithmetic for you.
      </KeyIdea>
    </Lesson>
  );
}

/* ---------- Lesson 7 ---------- */

function DynastySection() {
  return (
    <Lesson lessonKey="dynasty">
      <Para>
        In a redraft league a waiver claim is a rental. You are buying whatever this player does
        between now and the end of the season, and in week fourteen that is three games. In a
        dynasty league you are buying an asset you keep, so the arithmetic changes in both
        directions at once.
      </Para>
      <TileGrid
        tiles={[
          {
            icon: Sprout,
            tone: "success",
            title: "Young players are worth more than their production",
            body: "A 22-year-old who just got on the field is a real buy at a real price even if he does nothing this season, because you own him next September.",
          },
          {
            icon: Hourglass,
            tone: "amber",
            title: "Old fill-ins are worth less",
            body: "A 30-year-old starting four games while somebody heals wins you those four games and then occupies a roster spot for three years.",
          },
          {
            icon: Layers,
            tone: "cyan",
            title: "The wire is thinner",
            body: "Dynasty rosters are deeper and the taxi squad soaks up exactly the profile a redraft league leaves free, so the genuinely available player is rarer and worth more when he appears.",
          },
          {
            icon: Hammer,
            tone: "purple",
            title: "A rebuilder should bid harder than a contender",
            body: "The contender is buying three months. The rebuilder is buying a lottery ticket that costs money they have no other use for.",
          },
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
    </Lesson>
  );
}

/* ---------- Lesson 8 ---------- */

function MistakesSection() {
  return (
    <Lesson lessonKey="mistakes">
      <TileGrid
        columns="sm:grid-cols-2 sm:[&>li:last-child]:col-span-2 2xl:grid-cols-3 2xl:[&>li:last-child]:col-span-1"
        tiles={[
          {
            icon: PiggyBank,
            tone: "danger",
            title: "Finishing the season with money left",
            body: "Leftover FAAB in January bought nothing. A dollar in week two and a dollar in week fourteen are not the same money, because the later one has fewer chances left to be spent.",
          },
          {
            icon: CircleDollarSign,
            tone: "danger",
            title: "Bidding round numbers",
            body: "Everybody bids 10 and 20, so those are exactly the ties you are most likely to be in, and your league settles them with priority or a coin flip rather than in your favour. Make it 11.",
          },
          {
            icon: Armchair,
            tone: "danger",
            title: "Claiming a player you would not start",
            body: "A claim costs a roster spot as well as money, and the player you drop to make room is part of the price.",
          },
          {
            icon: Timer,
            tone: "danger",
            title: "Waiting for the perfect week",
            body: "The best waiver adds of a season are usually claimed in weeks two through five, when a starting job changes and nobody is sure yet whether it is real.",
          },
          {
            icon: ScrollText,
            tone: "danger",
            title: "Reading last week's points as this week's role",
            body: "The whole of lesson four, and the one that costs the most money per mistake.",
          },
        ]}
      />
      <Para>
        The counterweight to all of that is the thing the measured prices above actually show:
        most claims cost nothing, so the cost of being slightly too aggressive is small and the
        cost of being permanently too cautious is a budget you never spent.
      </Para>

      <LessonSubheading>Where to go from here</LessonSubheading>
      <ul role="list" className="mt-4 grid gap-3 sm:grid-cols-2">
        {[
          {
            href: "/guides/faab-strategy",
            title: "FAAB strategy",
            body: "How much to bid, in nine lessons with a worked example.",
            icon: Wallet,
          },
          {
            href: "/guides/faab-settings-by-platform",
            title: "FAAB settings by platform",
            body: "Turning it on, changing the budget, and what your league's waiver type means.",
            icon: Settings2,
          },
          {
            href: "/tools/free-agent-finder",
            title: "Free agent finder",
            body: "One name against every league you are in at once.",
            icon: Search,
          },
          {
            href: "/guides/chopped-league-strategy",
            title: "Chopped and guillotine leagues",
            body: "Where the wire is the entire game.",
            icon: Axe,
          },
        ].map((link) => {
          const Icon = link.icon;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className="group flex h-full min-h-11 items-start gap-3 rounded-2xl border border-line bg-base/50 p-4 transition-colors hover:border-brand-cyan/50 hover:bg-ink/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-cyan/10 text-brand-cyan"
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1 text-sm font-semibold text-ink group-hover:text-brand-cyan">
                    {link.title}
                    <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                  </span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-ink-muted">
                    {link.body}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Lesson>
  );
}
