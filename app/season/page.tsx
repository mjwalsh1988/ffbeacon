import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CloudSun, Search } from "lucide-react";
import { SITE } from "@/lib/site";
import { authorJsonLd, serializeJsonLd } from "@/lib/json-ld";
import { pageShareMetadata } from "@/lib/page-og";
import { formatEastern } from "@/lib/datetime";
import { PageBody } from "@/components/app-shell/page-body";
import { PageColumns } from "@/components/app-shell/page-columns";
import { PageMasthead, type MastheadChip, type MastheadStat } from "@/components/app-shell/page-masthead";
import { Panel } from "@/components/dashboard-panel";
import { FaqAccordion, type FaqAccordionItem } from "@/components/faq-accordion";
import { faqPageJsonLd } from "@/components/tool-explainer";
import { createClient } from "@/lib/supabase/server";
import { resolveSeasonClock } from "@/lib/start-sit/clock";
import { trimBoard } from "@/lib/season-pulse/board";
import {
  loadDefenseGrid,
  loadProjectionReport,
  loadSeasonBoard,
  loadTeamRecords,
  loadUpcomingGames,
  loadWeekReport,
  loadWeekResults,
  resolveSeasonPulseContext,
} from "@/lib/season-pulse/data";
import { statGroups, usageGroups } from "@/lib/season-pulse/leader-groups";
import { weekPath } from "@/lib/season-pulse/weeks";
import { projectionSourceDisplay } from "@/lib/projections/source-constants";
import { isOffensePosition } from "@/lib/site";
import { toBoardRows } from "@/components/season-pulse/board-rows";
import { LeadersBoard, type BoardTab } from "@/components/season-pulse/leaders-board";
import { WeekSpotlightGroups } from "@/components/season-pulse/spotlights";
import { ProjectionReportPanel } from "@/components/season-pulse/projection-report";
import { LeaderTabs } from "@/components/season-pulse/leader-tabs";
import { DefenseGrid } from "@/components/season-pulse/defense-grid";
import { ResultCard, UpcomingCard } from "@/components/season-pulse/game-cards";
import { TeamRecordsTable } from "@/components/season-pulse/team-records";
import { PulsePages, WeekStrip } from "@/components/season-pulse/week-strip";
import { SectionNav, type SectionNavItem } from "@/components/season-pulse/section-nav";

/**
 * /season, "Season Pulse"
 *
 * The current NFL season as a fantasy manager sees it, on one page. League
 * Pulse reads one league and Manager Pulse reads one manager; this reads the
 * season. Plan of record: docs/season-pulse/season-pulse-plan.md.
 *
 * FANTASY FIRST. The order is deliberate and was the owner's call: the fantasy
 * sections lead and take the most room (positional ranks, the week's
 * spotlights, the projection report, usage, points allowed), then this week's
 * games with a forecast for each, then the NFL's own results, stat leaders and
 * records, which explain the fantasy numbers and are not why a reader came.
 *
 * WHY THIS PAGE EXISTS FOR SEARCH. "fantasy football stats" is 1,000 to 10,000
 * US searches a month and rose ninefold in the three months to October 2026;
 * "fantasy football leaders" and "fantasy points leaders" are the same size.
 * The name carries no search volume, so the title, the h2s and the three pages
 * under this one carry the terms (Keyword Planner, 2026-10-03; section 2 of
 * the plan).
 *
 * FORMAT, AND WHY NO VALUE SOURCE. Every figure is points scored or points
 * projected, so the reader's format matters through its scoring alone and is
 * resolved through the ordinary chain (`resolveSeasonPulseContext`). No market
 * value appears on these pages, so there is no value source to resolve.
 *
 * THE HUB SHIPS THE TOP OF EACH POSITION, NOT THE WHOLE BOARD. The full board
 * is several hundred players by December; this page carries enough of each
 * position to answer most searches and links to /season/leaders for the rest,
 * and the search box says which of the two a reader is looking at.
 *
 * Dynamic because the format comes from the reader's cookie or saved
 * preference. Every read under it is cached (lib/season-pulse/load.ts).
 */

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Fantasy football stats for the current season: points leaders and positional ranks at every position, the best and worst performances of the week, projection beat rates, usage, points allowed by position, NFL results and this week's games with a weather forecast for each.";

function titleFor(season: number | null): string {
  return `Fantasy Football Stats${season ? ` ${season}` : ""}: Season Leaders, Positional Ranks and Weekly Results`;
}

export async function generateMetadata(): Promise<Metadata> {
  const clock = await resolveSeasonClock(await createClient());
  const title = titleFor(clock.season);
  return {
    title: { absolute: title },
    description: DESCRIPTION,
    alternates: { canonical: "/season" },
    keywords: [
      "fantasy football stats",
      "fantasy football leaders",
      "fantasy points leaders",
      "fantasy football scoring leaders",
      "fantasy football season stats",
      "fantasy football positional rankings this season",
      "nfl stats this season",
      "nfl stat leaders",
      "fantasy football weekly recap",
      "fantasy points allowed by position",
      "nfl weather this week",
    ],
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    },
    ...pageShareMetadata({ key: "season", title, description: DESCRIPTION, path: "/season" }),
  };
}

/** How deep the hub's board goes at each position. The full board has everyone. */
const HUB_BOARD_DEPTH = { QB: 36, RB: 60, WR: 72, TE: 36, K: 32, DEF: 32 } as const;

const FAQ: FaqAccordionItem[] = [
  {
    question: "What is Season Pulse?",
    answer:
      "One page for the current NFL season as a fantasy manager sees it. It shows who is scoring the most fantasy points and where each player ranks at his position, the best and worst performances of the latest week, how the projections have held up, who is getting the targets and carries, what each defense allows, last week's results and this week's games with the weather forecast for each.",
  },
  {
    question: "How is a player's positional rank worked out?",
    answer:
      "By total fantasy points for the regular season so far, counted within his position. A wide receiver shown as WR7 has the seventh most points of any wide receiver this season. Players with the same total share a rank. It is a rank on what has already happened, not a ranking of who to start next week.",
  },
  {
    question: "Which scoring do these numbers use?",
    answer:
      "The scoring of the format you have selected in the header: PPR, half PPR or standard, plus the tight end premium when your format has one. The page says which it is showing under the title. League type and superflex do not change anything here, because every figure is points scored rather than a trade value.",
  },
  {
    question: "What does beat rate mean?",
    answer:
      "The share of weeks a player met or beat the projection published for him that week. Only weeks he actually played count, so an injury is not counted as a miss. A projection that is right on average is beaten about half the time, and the projection report shows how far from that each position has been this season.",
  },
  {
    question: "What is a starter week?",
    answer:
      "A week a player finished inside the starting range at his position: the top 12 at quarterback, tight end, kicker and team defense, or the top 24 at running back and wide receiver. It answers a different question from total points. A player can rank highly on two huge games and still have given you a starting-quality week only twice.",
  },
  {
    question: "How often is this page updated?",
    answer:
      "Player stats are refreshed every morning during the season, so a Sunday game shows up on Monday morning and a Monday night game on Tuesday morning. Weather forecasts are refreshed every morning and three more times on a day with games. The week still being played counts toward season totals and is marked as incomplete; the spotlights and the projection report use finished weeks only.",
  },
  {
    question: "Where do the weather forecasts come from?",
    answer:
      "The National Weather Service for games played in the United States, and MET Norway for games played abroad. Each forecast is for the stadium's own location at kickoff and the three hours after it. A game in a dome is marked indoors, and a stadium with a retractable roof is treated as closed, because nothing published says in advance whether it will be open.",
  },
];

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseTab(value: string | string[] | undefined): BoardTab {
  const raw = firstParam(value)?.toUpperCase();
  return isOffensePosition(raw) ? raw : "ALL";
}

const SECTION = "scroll-mt-32 xl:scroll-mt-28";

export default async function SeasonPulsePage({
  searchParams,
}: {
  searchParams: Promise<{ pos?: string | string[]; format?: string | string[] }>;
}) {
  const search = await searchParams;
  const context = await resolveSeasonPulseContext({ format: search.format });
  const now = Date.now();
  const spotlightWeek = context.lastCompletedWeek;

  const [board, weekReport, report, grid, records, results, upcoming] = await Promise.all([
    loadSeasonBoard(context),
    spotlightWeek >= 1 ? loadWeekReport(context, spotlightWeek) : Promise.resolve(null),
    loadProjectionReport(context),
    loadDefenseGrid(context),
    loadTeamRecords(context),
    spotlightWeek >= 1 ? loadWeekResults(context, spotlightWeek) : Promise.resolve([]),
    loadUpcomingGames(context, context.currentWeek),
  ]);

  const scoringLabel = context.scoring.label;
  const sourceName = report?.sourceName ?? weekReport?.projectionSourceName ?? projectionSourceDisplay(context.projectionSource);
  const hasBoard = board !== null && board.players.length > 0;
  const hubBoard = board ? trimBoard(board, HUB_BOARD_DEPTH) : null;
  const liveWeek = context.throughWeek > context.lastCompletedWeek ? context.throughWeek : null;

  const overall = board
    ? [...board.players].filter((p) => p.position !== "K" && p.position !== "DEF").sort((a, b) => b.total - a.total)
    : [];
  const topScorer = overall[0] ?? null;
  const pooled = report?.season.find((s) => s.position === "ALL") ?? null;

  const chips: MastheadChip[] = [
    ...(context.season ? [{ label: `${context.season} season`, tone: "cyan" as const }] : []),
    ...(context.currentWeek <= 18
      ? [{ label: `Week ${context.currentWeek}`, tone: "purple" as const }]
      : [{ label: "Regular season complete", tone: "purple" as const }]),
    { label: `${scoringLabel} scoring`, tone: "plain" },
  ];

  const stats: MastheadStat[] = [];
  if (context.lastCompletedWeek >= 1) {
    stats.push({
      label: "Weeks played",
      value: String(context.lastCompletedWeek),
      detail: liveWeek ? `Week ${liveWeek} in progress` : "of 18",
      accent: "cyan",
    });
  }
  if (topScorer) {
    stats.push({
      label: "Top scorer",
      value: topScorer.total.toFixed(1),
      detail: `${topScorer.name}, ${topScorer.position}`,
      accent: "purple",
    });
  }
  if (pooled?.beatRate !== null && pooled?.beatRate !== undefined) {
    stats.push({
      label: "Beat rate",
      value: `${Math.round(pooled.beatRate * 100)}%`,
      detail: `of ${sourceName} projections`,
      accent: "cyan",
    });
  }
  if (upcoming.length > 0) {
    stats.push({
      label: "Still to play",
      value: String(upcoming.length),
      detail: `${upcoming.length === 1 ? "game" : "games"} in week ${context.currentWeek}`,
    });
  }

  const sections: SectionNavItem[] = [
    ...(hasBoard ? [{ id: "leaders", title: "Positional ranks and leaders", short: "Ranks" }] : []),
    ...(weekReport ? [{ id: "spotlight", title: `Week ${spotlightWeek} in the spotlight`, short: "Spotlight" }] : []),
    ...(report ? [{ id: "projections", title: "Projection report", short: "Projections" }] : []),
    ...(hasBoard ? [{ id: "usage", title: "Usage leaders", short: "Usage" }] : []),
    ...(grid.length > 0 ? [{ id: "matchups", title: "Points allowed by position", short: "Matchups" }] : []),
    ...(upcoming.length > 0 ? [{ id: "upcoming", title: `Week ${context.currentWeek} games and weather`, short: "This week" }] : []),
    ...(results.length > 0 ? [{ id: "results", title: `Week ${spotlightWeek} results`, short: "Results" }] : []),
    ...(hasBoard ? [{ id: "nfl-leaders", title: "Season stat leaders", short: "Stat leaders" }] : []),
    ...(records.length > 0 ? [{ id: "teams", title: "Team records", short: "Teams" }] : []),
    { id: "faq", title: "Questions, answered", short: "FAQ" },
  ];

  const canonical = `${SITE.url}/season`;
  const title = titleFor(context.season);
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: title,
      description: DESCRIPTION,
      url: canonical,
      inLanguage: "en-US",
      isAccessibleForFree: true,
      author: authorJsonLd(),
      publisher: {
        "@type": "Organization",
        name: SITE.name,
        url: SITE.url,
        logo: { "@type": "ImageObject", url: `${SITE.url}/img/ff-beacon-logo.png` },
      },
      about: { "@type": "Thing", name: "Fantasy football statistics" },
      ...(board ? { dateModified: board.computedAt } : {}),
    },
    faqPageJsonLd(FAQ),
    ...(overall.length > 0
      ? [
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: `Fantasy football points leaders${context.season ? `, ${context.season} season` : ""}, ${scoringLabel} scoring`,
            numberOfItems: Math.min(10, overall.length),
            itemListElement: overall.slice(0, 10).map((p, i) => ({
              "@type": "ListItem",
              position: i + 1,
              name: `${p.name}, ${p.position}${p.team ? ` ${p.team}` : ""}`,
              url: `${SITE.url}/players/${encodeURIComponent(p.slug)}`,
            })),
          },
        ]
      : []),
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE.url },
        { "@type": "ListItem", position: 2, name: "Season Pulse", item: canonical },
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
          eyebrow="Season Pulse"
          title={context.season ? `${context.season} fantasy football stats` : "Fantasy football stats this season"}
          chips={chips}
          stats={stats}
          description="Who is scoring, where every player ranks at his position, what happened last week and what is coming this week, with a weather forecast for every game."
          actions={
            <>
              {hasBoard && (
                <a
                  href="#leaders"
                  className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-card bg-beacon px-5 py-3 text-sm font-semibold text-[#07070D] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
                >
                  <Search aria-hidden="true" className="h-4 w-4" />
                  Find a player&apos;s rank
                </a>
              )}
              <Link
                href="/season/weather"
                className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
              >
                <CloudSun aria-hidden="true" className="h-4 w-4" />
                This week&apos;s weather
              </Link>
            </>
          }
        />
      </PageBody>

      <PageColumns
        railLabel="Season Pulse sections, pages and how the numbers are built"
        rail={
          <>
            <SectionNav items={sections} variant="rail" label="Season Pulse sections" />
            <Panel eyebrow="Season Pulse" title="More of the season" headingLevel={2}>
              <PulsePages current="hub" />
            </Panel>
            {context.throughWeek >= 1 && (
              <Panel eyebrow="Week by week" title="Every week so far" headingLevel={2}>
                <WeekStrip currentWeek={context.currentWeek} />
              </Panel>
            )}
            <Panel eyebrow="Method" title="How to read this page" headingLevel={2}>
              <ul role="list" className="space-y-2.5 text-sm leading-relaxed text-ink-muted">
                <li>
                  Every fantasy figure uses <strong className="font-semibold text-ink">{scoringLabel}</strong> scoring,
                  from the format selected in the header.
                </li>
                <li>
                  A rank like WR7 is by total points at the position this season. It describes what has happened, not
                  who to start.
                </li>
                <li>
                  Projections are {sourceName}&apos;s published numbers, graded against what each player went on to
                  score.
                </li>
                {board && <li>Stats last rebuilt {formatEastern(board.computedAt)}.</li>}
              </ul>
            </Panel>
          </>
        }
      >
        <SectionNav items={sections} variant="bar" label="Season Pulse sections" />

        {!hasBoard && (
          <Panel eyebrow="Fantasy" title="The season has not produced a score yet">
            <p className="text-sm leading-relaxed text-ink-muted">
              Leaders, positional ranks and the weekly spotlights appear here the morning after the first games are
              played. This week&apos;s games and their forecasts are below as soon as the schedule and the forecast
              reach them.
            </p>
          </Panel>
        )}

        {hasBoard && hubBoard && board && (
          <Panel
            id="leaders"
            className={SECTION}
            eyebrow="Fantasy"
            title="Positional ranks and fantasy points leaders"
            helper={`Total fantasy points this season and each player's rank at his position, ${scoringLabel} scoring.${
              liveWeek ? ` Week ${liveWeek} is still being played and counts toward the totals.` : ""
            }`}
            glow
          >
            <LeadersBoard
              rows={toBoardRows(hubBoard.players)}
              rankedByPosition={board.rankedByPosition}
              throughWeek={board.throughWeek}
              lastCompletedWeek={board.lastCompletedWeek}
              scoringLabel={scoringLabel}
              initialTab={parseTab(search.pos)}
              pageSize={15}
              fullBoardHref="/season/leaders"
              truncated
            />
          </Panel>
        )}

        {weekReport && (
          <Panel
            id="spotlight"
            className={SECTION}
            eyebrow="Fantasy"
            title={`Week ${spotlightWeek} in the spotlight`}
            helper={`The best, the biggest beats, the surprises and the letdowns of the latest finished week. Projections are ${weekReport.projectionSourceName}'s.`}
            action={
              <Link
                href={weekPath(spotlightWeek)}
                className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                All of week {spotlightWeek}
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
            }
          >
            <WeekSpotlightGroups
              spotlights={weekReport.spotlights}
              scoringLabel={scoringLabel}
              sourceName={weekReport.projectionSourceName}
              idPrefix="hub-spot"
              limit={4}
            />
          </Panel>
        )}

        {report && (
          <Panel
            id="projections"
            className={SECTION}
            eyebrow="Fantasy"
            title={`${report.sourceName} projection report`}
            helper={`How often players have met or beaten their ${report.sourceName} projection this season, by position and by week.`}
          >
            <ProjectionReportPanel report={report} scoringLabel={scoringLabel} idPrefix="hub-proj" />
          </Panel>
        )}

        {hasBoard && board && (
          <Panel
            id="usage"
            className={SECTION}
            eyebrow="Fantasy"
            title="Usage leaders"
            helper="Who is getting the work: targets, target share, carries and snap share."
          >
            <LeaderTabs groups={usageGroups(board, 10)} groupLabel="Usage category" />
          </Panel>
        )}

        {grid.length > 0 && (
          <Panel
            id="matchups"
            className={SECTION}
            eyebrow="Fantasy"
            title="Fantasy points allowed by position"
            helper="What each defense has given up to quarterbacks, running backs, wide receivers and tight ends. Select a column heading to sort by it."
          >
            <DefenseGrid rows={grid} scoringLabel={scoringLabel} />
          </Panel>
        )}

        {upcoming.length > 0 && (
          <Panel
            id="upcoming"
            className={SECTION}
            eyebrow="This week"
            title={`Week ${context.currentWeek} games, previews and weather`}
            helper="Kickoff in Eastern time, what each side is expected to score, the forecast and what it means for a lineup."
            action={
              <Link
                href="/season/weather"
                className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                Full forecasts
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
            }
          >
            <ul role="list" className="grid gap-4 2xl:grid-cols-2">
              {upcoming.map((game) => (
                <li key={game.gameKey} className="min-w-0">
                  <UpcomingCard game={game} now={now} />
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {results.length > 0 && (
          <Panel
            id="results"
            className={SECTION}
            eyebrow="Around the NFL"
            title={`Week ${spotlightWeek} results`}
            helper="Every final, how the line fared and the best fantasy lines of each game."
            action={
              <Link
                href={weekPath(spotlightWeek)}
                className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                Week {spotlightWeek} in full
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
            }
          >
            <ul role="list" className="grid gap-4 2xl:grid-cols-2">
              {results.map((game) => (
                <li key={game.gameKey} className="min-w-0">
                  <ResultCard game={game} scoringLabel={scoringLabel} />
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {hasBoard && board && (
          <Panel
            id="nfl-leaders"
            className={SECTION}
            eyebrow="Around the NFL"
            title="Season stat leaders"
            helper="The season's leaders in yards, catches and touchdowns."
            action={
              <Link
                href="/season/stats"
                className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                All stat leaders
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
            }
          >
            <LeaderTabs groups={statGroups(board, 10)} groupLabel="Stat category" />
          </Panel>
        )}

        {records.length > 0 && (
          <Panel
            id="teams"
            className={SECTION}
            eyebrow="Around the NFL"
            title="Team records and scoring"
            helper="Every team's record with points scored and allowed per game."
          >
            <TeamRecordsTable records={records} />
          </Panel>
        )}

        <Panel id="faq" className={SECTION} eyebrow="FAQ" title="Season Pulse questions, answered">
          <FaqAccordion items={FAQ} />
        </Panel>
      </PageColumns>
    </main>
  );
}
