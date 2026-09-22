import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Calculator } from "lucide-react";
import { SITE } from "@/lib/site";
import { authorJsonLd, serializeJsonLd } from "@/lib/json-ld";
import { PageBody } from "@/components/app-shell/page-body";
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
  PositionRail,
  WeekRail,
} from "@/components/waiver-wire/board-rail";
import { resolveWaiverContext } from "@/lib/waiver-wire/context";
import { loadWaiverBoardCached } from "@/lib/waiver-wire/load";
import {
  isPublishableWeek,
  parseWeekSegment,
  weekNeighbours,
  weekPath,
  weekPhase,
  weekPhaseLabel,
} from "@/lib/waiver-wire/weeks";
import { BOARD_POSITIONS, type BoardPosition, type WaiverBoard } from "@/lib/waiver-wire/types";
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
  return `Week ${week} Waiver Wire${season ? ` ${season}` : ""}: Top Adds and FAAB Bids`;
}

function descriptionFor(week: number): string {
  return `Week ${week} fantasy football waiver wire pickups, ranked by what they add over a startable replacement, with how widely each is already rostered and a FAAB bid range for a standard league.`;
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
      "waiver wire adds",
      "faab bids",
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
          url: `${SITE.url}/api/og/page/waiver-wire`,
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
      images: [`${SITE.url}/api/og/page/waiver-wire`],
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
function faqFor(week: number, board: WaiverBoard): FaqAccordionItem[] {
  const top = board.rows[0];
  const a = board.assumptions;
  return [
    {
      question: `Who is the top waiver wire add in week ${week}?`,
      answer: top
        ? `${top.name}, the ${top.position} for ${top.team ?? "his team"}, leads this board. ${top.reason} The list is ordered by what a player adds over the last startable player at his position rather than by raw projected points, because ten points from a tight end and ten from a running back are not the same purchase.`
        : `We have not published a ranked board for week ${week} yet. The page fills in once this week's projections land, which is usually a few days before the slate.`,
    },
    {
      question: `How much FAAB should I bid in week ${week}?`,
      answer: `Every player on this board carries a range priced for a ${a.teams}-team league with a $${a.budget} season budget, so the dollar figure is also a percentage of whatever you have left. It assumes a neutral level of need, which is the one thing a public page cannot know about you. If your starting running back went down on Sunday, your real number is higher than the one here, and the FAAB calculator will work it out against your actual roster.`,
    },
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

  const [isMember, board] = await Promise.all([
    isDiscordMember(),
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
  const phase = weekPhase(week, context.currentWeek);
  // The headline add, and the counts the rail's filter needs. Both derived
  // here so the rail and the board cannot disagree about either.
  const hero = position ? null : topPickup(board.rows);
  const counts = new Map<BoardPosition, number>();
  for (const row of board.rows) {
    counts.set(row.position, (counts.get(row.position) ?? 0) + 1);
  }
  const { prev, next } = weekNeighbours(week, context.currentWeek);
  const faq = faqFor(week, board);
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
    const topBid = board.rows.find((r) => r.bid && !r.bid.isDumpCandidate)?.bid;
    if (topBid) {
      stats.push({
        label: "Top bid",
        value: `$${topBid.highPct}`,
        detail: "of a $100 budget",
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
    },
    faqPageJsonLd(faq),
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
                className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 py-3 text-sm font-semibold text-base transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <Calculator aria-hidden="true" className="h-4 w-4" />
                Price a bid for your league
              </Link>
              <Link
                href="/waiver-wire"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                How the waiver wire works
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
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
            <PositionRail
              basePath={weekPath(week)}
              active={position}
              counts={counts}
              total={board.rows.length}
            />
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
        {hero && <TopPickup row={hero} week={week} isPast={phase === "past"} />}

        <WaiverBoardPanel
          board={board}
          basePath={weekPath(week)}
          activePosition={position}
          headingId="board-heading"
          heading={`Week ${week} waiver wire pickups`}
          excludePlayerIds={hero ? [hero.playerId] : []}
        />

        <WeekPager prev={prev} next={next} />
      </PageColumns>

      <PageBody>
        <section aria-labelledby="week-faq-heading" className="mt-12">
          <h2
            id="week-faq-heading"
            className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
          >
            Week {week} waiver questions, answered
          </h2>
          <div className="mt-5">
            <FaqAccordion items={faq} />
          </div>
        </section>

        <section aria-labelledby="week-next-heading" className="mt-12">
          <h2
            id="week-next-heading"
            className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
          >
            Before you put the claim in
          </h2>
          <p className="mt-3 max-w-3xl leading-relaxed text-ink-muted">
            This board prices a standard league. Three things on the site take it the rest
            of the way to yours.
          </p>
          <ul role="list" className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              {
                href: "/tools/faab",
                title: "Price it for your roster",
                body: "Connect the league and the calculator prices the claim against who you would drop and what your rivals can still spend.",
              },
              {
                href: "/guides/faab-strategy",
                title: "Learn the bidding",
                body: "Nine lessons on how much to bid, when to spend it all, and the mistakes that lose leagues in October.",
              },
              {
                href: "/tools/who-should-i-start",
                title: "Then set the lineup",
                body: "Once he is yours, the start/sit tool says whether he beats the player already in the slot.",
              },
            ].map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="flex h-full min-h-11 flex-col rounded-card border border-line bg-surface/60 p-4 transition-colors hover:border-brand-cyan/50 hover:bg-ink/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <span className="text-sm font-semibold text-ink">{link.title}</span>
                  <span className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                    {link.body}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
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
