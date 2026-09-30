import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  Calculator,
  GraduationCap,
  ListChecks,
  MessageCircleQuestion,
} from "lucide-react";
import { SITE } from "@/lib/site";
import { authorJsonLd, serializeJsonLd } from "@/lib/json-ld";
import { PageBody } from "@/components/app-shell/page-body";
import { FormatFallbackBanner } from "@/components/format-fallback-banner";
import { PageColumns } from "@/components/app-shell/page-columns";
import { PageMasthead, type MastheadChip, type MastheadStat } from "@/components/app-shell/page-masthead";
import { FaqAccordion, type FaqAccordionItem } from "@/components/faq-accordion";
import { faqPageJsonLd } from "@/components/tool-explainer";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { isDiscordMember } from "@/lib/discord-membership";
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
import { BudgetProvider } from "@/components/waiver-wire/budget-context";
import { HotClaims } from "@/components/waiver-wire/hot-claims";
import { PercentExplainer } from "@/components/waiver-wire/percent-explainer";
import {
  isPublishableWeek,
  parseWeekSegment,
  weekNeighbours,
  weekPath,
  weekPhase,
  weekPhaseLabel,
} from "@/lib/waiver-wire/weeks";
import { BOARD_POSITIONS, type BoardPosition, type WaiverBoard } from "@/lib/waiver-wire/types";
import { claimWeeksText } from "@/lib/waiver-wire/weeks";
import { topPickup } from "@/lib/waiver-wire/reasons";
import { WeekPager } from "../week-strip";

/*
 * WHY THE SEGMENT CARRIES ITS OWN "week-" PREFIX. The App Router has no partial
 * dynamic segments, so a folder named `week-[week]` is a literal directory
 * rather than a route. The published URL is still `/waiver-wire/week-4`, which
 * is the shape the searches use ("waiver wire week 4"); the folder is `[week]`
 * and `parseWeekSegment` accepts "week-4" and strips the prefix. `weekPath` is
 * the only place that builds one, so the two can never drift.
 */

/**
 * /waiver-wire/[week], where the segment is the literal "week-4".
 *
 * One page per NFL week: who is worth a waiver claim, why, and what to bid.
 *
 * WHY THIS ROUTE EXISTS. "waiver wire week 4" and its siblings are the largest
 * recurring search in fantasy football, roughly 5,000 a month EACH across
 * fifteen weeks, and before this page the site had no impression on any query
 * containing the word "waiver" in ninety days of Search Console. The keyword
 * research behind it is docs/seo-audit/waiver-wire-keyword-plan.md.
 *
 * WHAT MAKES IT DIFFERENT FROM THE TWO HUNDRED OTHER WAIVER ARTICLES. Every
 * row is measured rather than argued. Availability is counted from real synced
 * Sleeper rosters, the role change is counted from the box score, the
 * projection is the same adjusted one the rest of the site shows, and the bid
 * comes from the FAAB calculator's own engine. The page cites all four and says
 * which league it priced.
 *
 * THE URL KEEPS ITS SEASON IMPLICIT AND THAT IS DELIBERATE.
 * `/waiver-wire/week-4` is rewritten every September rather than becoming
 * `/waiver-wire/2026/week-4`. A dated URL would need eighteen redirects a year
 * and would split whatever authority the page earns across a new set of URLs
 * every season; the undated one accumulates it. The season is stated on the
 * page and in the structured data, so nothing is ambiguous to a reader.
 *
 * EVERY PUBLISHED WEEK IS INDEXABLE, AND NOTHING ELSE IS. A week beyond one
 * ahead of the live one is a 404 rather than a page of blanks with a
 * real-looking heading, because Sleeper publishes projections about a week out.
 * The position filter's `?pos=` views carry the bare canonical, so six filtered
 * views of the same board never compete with each other.
 *
 * Source and format: this page shows player values and projections, so it goes
 * through the ordinary preference chain (`resolveWaiverContext`). It is not a
 * league view, so `resolveLeagueContext` deliberately does not apply.
 */

export const dynamic = "force-dynamic";

type RouteParams = { week: string };
type SearchParams = {
  pos?: string | string[];
  format?: string | string[];
  source?: string | string[];
};

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

function titleFor(week: number, season: number | null): string {
  return `Week ${week} Waiver Wire Pickups${season ? ` ${season}` : ""}: Top Adds and FAAB Bid %`;
}

function descriptionFor(week: number): string {
  return `Week ${week} fantasy football waiver wire pickups at every position, with how widely each is rostered, his role change, and a FAAB bid as a percentage of your budget priced from real waiver claims.`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const week = parseWeekSegment((await params).week);
  if (week == null) return {};

  const context = await resolveWaiverContext({});
  const title = titleFor(week, context.season);
  const description = descriptionFor(week);
  const path = weekPath(week);

  return {
    title: { absolute: title },
    description,
    // The bare week path, so the six `?pos=` views consolidate into one page
    // rather than competing with each other for the same query.
    alternates: { canonical: path },
    keywords: [
      `week ${week} waiver wire`,
      `waiver wire week ${week}`,
      `fantasy football waiver wire week ${week}`,
      `week ${week} waiver wire adds`,
      `week ${week} fantasy football waiver wire`,
      `week ${week} waiver pickups`,
      `week ${week} waiver wire pickups`,
      `best waiver wire pickups week ${week}`,
      `week ${week} faab bids`,
      "waiver wire adds",
      "faab bids",
      "faab bid percentage",
    ],
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    },
    openGraph: {
      type: "article",
      title,
      description,
      url: `${SITE.url}${path}`,
      siteName: SITE.name,
      locale: "en_US",
      images: [
        {
          url: `${SITE.url}/api/og/waiver-wire/week-${week}`,
          width: 1200,
          height: 630,
          alt: `Week ${week} waiver wire on FF Beacon`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${SITE.url}/api/og/waiver-wire/week-${week}`],
    },
  };
}

/**
 * The questions this page is actually asked, answered from what it shows.
 *
 * Week-specific rather than generic: a reader on the week 4 page searched for
 * week 4, and an answer that could have been written in July is one they have
 * read five times already.
 */
function faqFor(week: number, board: WaiverBoard, hero: WaiverBoard["rows"][number] | null): FaqAccordionItem[] {
  const top = hero ?? board.rows[0];
  const a = board.assumptions;
  const hot = board.hotClaims[0];
  const heroBid = top?.bid
    ? top.bid.lowPct === top.bid.highPct
      ? `${top.bid.highPct} percent`
      : `${top.bid.lowPct} to ${top.bid.highPct} percent`
    : null;
  return [
    {
      question: `Who is the top waiver wire add in week ${week}?`,
      answer: top
        ? `${top.name}, the ${top.position} for ${top.team ?? "his team"}, leads this board. ${top.reason}${heroBid ? ` The suggested bid is ${heroBid} of your season budget.` : ""} Within each position the list is ordered by what a player adds over the last startable player there rather than by raw projected points, because ten points from a tight end and ten from a running back are not the same purchase.`
        : `We have not published a ranked board for week ${week} yet. The page fills in once this week's projections land, which is usually a few days before the slate.`,
    },
    {
      question: `How much FAAB should I bid in week ${week}?`,
      answer: `Every player on this board carries a range as a percentage of your season budget, because budgets differ from league to league. The lower figure wins about 6 times in 10 and the higher about 9 in 10, read from what waiver claims have actually cleared at in ${a.marketName} leagues synced to FF Beacon${a.claimWeeks ? `, and pulled toward each player's own price where he was claimed in ${claimWeeksText(a.claimWeeks)}` : ""}. It prices winning him, not what he is worth to your roster, so pay it only if he would start for you. The FAAB calculator works out that second part against your actual roster.`,
    },
    ...(hot
      ? [
          {
            question: `Who was the most-claimed player on waivers in ${claimWeeksText(a.claimWeeks ?? { from: week, to: week })}?`,
            answer: `${hot.name} (${hot.position}${hot.team ? `, ${hot.team}` : ""}), claimed in ${hot.market.leagues} of the synced leagues with ${hot.market.avgBidders.toFixed(1)} teams bidding on average. The median winning bid was ${Math.round(hot.market.p50)} percent of the season budget, and the middle half of winning bids ran from ${Math.round(hot.market.p25)} to ${Math.round(hot.market.p75)} percent.`,
          },
        ]
      : []),
    {
      question: "What does rostered percentage mean here?",
      answer: board.rosterRatesComputedAt
        ? `The share of the real Sleeper leagues synced to FF Beacon that already have that player on a roster, rebuilt nightly. It is measured from ${board.rows[0]?.rosterRate?.total ?? "the"} leagues rather than published by a platform about itself. Those leagues are ones readers connected themselves, so they skew toward dynasty and they are not a random sample of Sleeper.`
        : "The share of synced Sleeper leagues that already roster a player. It has not been built for this season yet, which is why the column is empty rather than showing a zero.",
    },
    {
      question: "Why is a player I saw recommended elsewhere missing?",
      answer: `Two reasons account for nearly all of them. He is rostered in ${a.availabilityCeilingPct} percent or more of the leagues we track, so he is not really a waiver claim, or he projects below the last startable player at his position this week, which makes him a bench add rather than an upgrade. The board is ranked on what a player changes about a lineup, not on how much he was talked about on Sunday.`,
    },
    {
      question: "When do waivers process?",
      answer:
        "On Sleeper the default is Wednesday morning, and most leagues leave it there, so a claim entered any time from Tuesday runs overnight. Yahoo and ESPN both default to Wednesday too. Your league can change it, and a few run waivers daily, so check your own settings before you rely on a deadline.",
    },
  ];
}

export default async function WaiverWeekPage({
  params,
  searchParams,
}: {
  params: Promise<RouteParams>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ week: weekSegment }, search] = await Promise.all([params, searchParams]);
  const week = parseWeekSegment(weekSegment);
  if (week == null) notFound();

  const context = await resolveWaiverContext({
    format: firstParam(search.format),
    source: firstParam(search.source),
  });

  // A week too far ahead has no projections and never will until the season
  // gets there. A real 404 rather than a page of blanks: an indexed shell that
  // fills in three months later is worse than no page at all.
  if (!isPublishableWeek(week, context.currentWeek)) notFound();

  const [isMember, board, spread] = await Promise.all([
    isDiscordMember(),
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
    context.season != null
      ? loadBudgetSpreadCached(context.season)
      : Promise.resolve<BudgetSpread>({ total: 0, buckets: [], otherLeagues: 0 }),
  ]);

  const position = parsePosition(search.pos);
  const phase = weekPhase(week, context.currentWeek);
  // The headline add. `?pos=` only picks the board's opening tab now, so the
  // hero stays whichever tab a shared link opens on.
  const hero = topPickup(board.rows);
  const { prev, next } = weekNeighbours(week, context.currentWeek);
  const faq = faqFor(week, board, hero);
  const title = titleFor(week, board.season || context.season);
  const canonical = `${SITE.url}${weekPath(week)}`;

  const chips: MastheadChip[] = [
    { label: weekPhaseLabel(week), tone: "purple" },
    {
      label:
        phase === "past"
          ? "Already played"
          : phase === "current"
            ? "This week"
            : "Next week",
      tone: phase === "current" ? "cyan" : "plain",
    },
    { label: board.assumptions.formatName, tone: "cyan" },
  ];

  const stats: MastheadStat[] = [];
  if (!board.emptyReason) {
    stats.push({
      label: "Worth a claim",
      value: String(board.rows.length),
      detail: "players on this board",
      accent: "cyan",
    });
    const topBid = hero?.bid ?? board.rows.find((r) => r.bid)?.bid;
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
    const totalLeagues = board.rows.find((r) => r.rosterRate)?.rosterRate?.total;
    if (totalLeagues) {
      stats.push({
        label: "Leagues measured",
        value: String(totalLeagues),
        detail: "for availability",
      });
    }
  }

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: title,
      description: descriptionFor(week),
      inLanguage: "en-US",
      isAccessibleForFree: true,
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
      mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
      url: canonical,
      articleSection: "Waiver Wire",
      about: {
        "@type": "Thing",
        name: `Week ${week} fantasy football waiver wire`,
      },
      ...(board.rosterRatesComputedAt ? { dateModified: board.rosterRatesComputedAt } : {}),
    },
    faqPageJsonLd(faq),
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
        {
          "@type": "ListItem",
          position: 2,
          name: "Waiver Wire",
          item: `${SITE.url}/waiver-wire`,
        },
        { "@type": "ListItem", position: 3, name: `Week ${week}`, item: canonical },
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
          title={`Week ${week} waiver wire`}
          chips={chips}
          stats={stats}
          description={
            phase === "past"
              ? `The week ${week} wire as it stood, kept so the link still works. For the claims you can still make, open this week's board.`
              : `Who is still available, whose role just changed, and what to bid. Ranked by what a player adds over the last startable option at his position, not by how loud his Sunday was.`
          }
          actions={
            <>
              <Link
                href="/tools/faab"
                className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-card bg-beacon px-5 py-3 sm:w-auto text-sm font-semibold text-[#07070D] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <Calculator aria-hidden="true" className="h-4 w-4" />
                Price a bid for your league
              </Link>
              <Link
                href="/waiver-wire"
                className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 sm:w-auto text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                How the waiver wire works
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
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
            {context.fallbackBanner.requested} data for{" "}
            {board.assumptions.formatName}. Showing {context.fallbackBanner.actual} instead.
          </p>
        )}

        {phase === "past" && (
          <p
            role="status"
            className="mt-6 rounded-card border border-brand-purple/40 bg-brand-purple/5 px-4 py-3 text-sm leading-relaxed text-ink-muted"
          >
            <span className="font-medium text-ink">Week {week} has been played.</span>{" "}
            Availability and usage below are current, but the projection column describes a
            week that is already settled.{" "}
            <Link
              href={weekPath(context.currentWeek)}
              className="font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80"
            >
              Open week {context.currentWeek} instead
            </Link>
            .
          </p>
        )}

      </PageBody>

      {/* Two columns for the board, one for the prose under it. Same shape as
          the hub, for the same reasons: the controls and the method notes
          follow the board down a wide screen and fall below it on a phone. */}
      <PageColumns
        railLabel="Board controls and how these numbers are built"
        rail={
          <>
            <CalculatorRail />
            <WeekRail
              week={week}
              currentWeek={context.currentWeek}
              season={board.season || null}
            />
            <MethodRail board={board} />
            <NextRail
              links={[
                {
                  href: "/waiver-wire",
                  title: "How the wire works",
                  body: "Claims, priority against FAAB, when it all processes, and the dynasty differences.",
                },
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
              ]}
            />
          </>
        }
      >
        <BudgetProvider>
          {hero && <TopPickup row={hero} week={week} isPast={phase === "past"} />}

          <WaiverBoardPanel
            board={board}
            basePath={weekPath(week)}
            activePosition={position}
            headingId="board-heading"
            heading={`Week ${week} waiver wire pickups`}
            excludePlayerIds={hero ? [hero.playerId] : []}
          />
        </BudgetProvider>

        <HotClaims claims={board.hotClaims} window={board.assumptions.claimWeeks} />

        <WeekPager prev={prev} next={next} />
      </PageColumns>

      {/* The same two-column grid as the board above, so the page keeps one
          width top to bottom. The next-steps list is the rail on a wide
          screen and follows the FAQ on a phone. */}
      <PageBody>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
            <PercentExplainer
              spread={spread}
              headingId="week-percent-heading"
              eyebrow="How to read the bids"
            />

            <section
              aria-labelledby="week-faq-heading"
              className="relative overflow-hidden rounded-3xl border border-line bg-surface/40 p-4 sm:p-7"
            >
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
                <MessageCircleQuestion aria-hidden="true" className="h-3.5 w-3.5" />
                FAQ
              </p>
              <h2
                id="week-faq-heading"
                className="mt-1 text-xl font-bold tracking-tight text-ink sm:text-[26px]"
              >
                Week {week} waiver questions, answered
              </h2>
              <div className="mt-5">
                <FaqAccordion items={faq} />
              </div>
            </section>
          </div>

          <aside aria-labelledby="week-next-heading" className="min-w-0">
            <div className="space-y-4 xl:sticky xl:top-[5.5rem]">
              <section className="rounded-3xl border border-line bg-surface/50 p-4 sm:p-5">
                <h2 id="week-next-heading" className="text-lg font-bold tracking-tight text-ink">
                  Before you put the claim in
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                  This board prices what it takes to win each player, not what he is worth to
                  your roster. Three things take it the rest of the way to yours.
                </p>
                <ul role="list" className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
                  {[
                    {
                      href: "/tools/faab",
                      title: "Price it for your roster",
                      body: "The calculator prices the claim against who you would drop and what your rivals can still spend.",
                      icon: Calculator,
                    },
                    {
                      href: "/guides/faab-strategy",
                      title: "Learn the bidding",
                      body: "How much to bid, when to spend it all, and the mistakes that lose leagues in October.",
                      icon: GraduationCap,
                    },
                    {
                      href: "/tools/who-should-i-start",
                      title: "Then set the lineup",
                      body: "Whether he beats the player already in the slot.",
                      icon: ListChecks,
                    },
                  ].map((link) => {
                    const Icon = link.icon;
                    return (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          className="group flex h-full min-h-11 items-start gap-3 rounded-2xl border border-line bg-base/50 p-3.5 transition-colors hover:border-brand-cyan/50 hover:bg-ink/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                        >
                          <span
                            aria-hidden="true"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-cyan/10 text-brand-cyan"
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-ink group-hover:text-brand-cyan">
                              {link.title}
                            </span>
                            <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-muted">
                              {link.body}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          </aside>
        </div>
      </PageBody>

      <DiscordCtaSection
        eyebrow="Waivers close Tuesday night"
        heading="Not sure he is worth the money?"
        body="Post the claim and your budget in our Discord and real managers will tell you whether to push or pass, free."
        isMember={isMember}
        memberHeading="You know the board. Now price it properly."
        memberBody="You're already in the crew, so we'll skip the invite. The FAAB calculator runs this same engine against your real roster and your rivals' real budgets."
        memberCtaHref="/tools/faab"
        memberCtaLabel="Open the FAAB calculator"
      />
    </main>
  );
}
