import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { SITE } from "@/lib/site";
import { authorJsonLd, serializeJsonLd } from "@/lib/json-ld";
import { pageShareMetadata } from "@/lib/page-og";
import { PageBody } from "@/components/app-shell/page-body";
import { PageColumns } from "@/components/app-shell/page-columns";
import { PageMasthead, type MastheadChip, type MastheadStat } from "@/components/app-shell/page-masthead";
import { Panel } from "@/components/dashboard-panel";
import { createClient } from "@/lib/supabase/server";
import { resolveSeasonClock } from "@/lib/start-sit/clock";
import {
  loadUpcomingGames,
  loadWeekReport,
  loadWeekResults,
  resolveSeasonPulseContext,
} from "@/lib/season-pulse/data";
import { isPublishableWeek, parseWeekSegment, weekPath, weekPhase } from "@/lib/season-pulse/weeks";
import { projectionSourceDisplay } from "@/lib/projections/source-constants";
import { TopScorersByPosition, WeekSpotlightGroups } from "@/components/season-pulse/spotlights";
import { ResultCard, UpcomingCard } from "@/components/season-pulse/game-cards";
import { PulsePages, WeekStrip } from "@/components/season-pulse/week-strip";
import { SectionNav, type SectionNavItem } from "@/components/season-pulse/section-nav";

/*
 * WHY THE SEGMENT CARRIES ITS OWN "week-" PREFIX. The App Router has no partial
 * dynamic segments, so a folder named `week-[week]` is a literal directory
 * rather than a route. The published URL is still `/season/week-4`; the folder
 * is `[week]` and `parseWeekSegment` accepts "week-4" and strips the prefix.
 * `weekPath` is the only place that builds one. The waiver wire's weekly pages
 * work the same way.
 */

/**
 * /season/[week], where the segment is the literal "week-4".
 *
 * One page per NFL week, and which page it is depends on whether the week is
 * over.
 *
 * A PLAYED WEEK is a recap: the spotlights, the top scorers at every position
 * and every final with the best fantasy lines of the game.
 *
 * THE LIVE WEEK is both at once. Games with a final are results; games without
 * one are previews with a forecast. On a Friday the Thursday game is in the
 * first list and the other fifteen are in the second, and by Tuesday morning
 * the page has turned into a recap without anything being published.
 *
 * A week the season has not reached is a 404. It has no results and no
 * forecast, and an indexed shell that fills in a month later is worse than no
 * page.
 *
 * THE SEASON STAYS OUT OF THE URL, for the reason the waiver wire gives: a
 * dated URL needs eighteen redirects a year and splits whatever authority the
 * page earns across a new set every September. The season is in the title and
 * the structured data.
 */

export const dynamic = "force-dynamic";

type RouteParams = { week: string };

function titleFor(week: number, season: number | null, live: boolean): string {
  const year = season ? ` ${season}` : "";
  return live
    ? `NFL Week ${week}${year}: Game Previews, Weather and Fantasy Projections`
    : `Week ${week} Fantasy Football Recap${year}: Top Scorers, Busts and NFL Results`;
}

function descriptionFor(week: number, live: boolean): string {
  return live
    ? `Every NFL game of week ${week}: kickoff times, expected scores, the weather forecast and its fantasy impact, the players projected to score the most, and results as the games finish.`
    : `Week ${week} fantasy football recap: the best performances, the biggest beats of the projection, the surprises and the letdowns, top scorers at every position and every NFL final.`;
}

export async function generateMetadata({ params }: { params: Promise<RouteParams> }): Promise<Metadata> {
  const week = parseWeekSegment((await params).week);
  if (week == null) return {};
  const clock = await resolveSeasonClock(await createClient());
  if (!isPublishableWeek(week, clock.currentWeek)) return {};
  const live = weekPhase(week, clock.currentWeek) === "live";
  const title = titleFor(week, clock.season, live);
  const description = descriptionFor(week, live);
  const path = weekPath(week);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    keywords: live
      ? [
          `nfl week ${week}`,
          `nfl week ${week} schedule`,
          `nfl week ${week} weather`,
          `week ${week} nfl game previews`,
          `week ${week} fantasy football projections`,
          "nfl games this week",
          "nfl matchups this week",
        ]
      : [
          `week ${week} fantasy football recap`,
          `week ${week} fantasy football top scorers`,
          `nfl week ${week} results`,
          `nfl week ${week} scores`,
          `week ${week} fantasy football busts`,
          "fantasy football weekly recap",
        ],
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    },
    ...pageShareMetadata({ key: "season", title, description, path, type: "article" }),
  };
}

const SECTION = "scroll-mt-32 xl:scroll-mt-28";
const PAGER =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface/70 px-4 text-sm font-semibold text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

export default async function SeasonWeekPage({
  params,
  searchParams,
}: {
  params: Promise<RouteParams>;
  searchParams: Promise<{ format?: string | string[] }>;
}) {
  const [{ week: segment }, search] = await Promise.all([params, searchParams]);
  const week = parseWeekSegment(segment);
  if (week == null) notFound();

  const context = await resolveSeasonPulseContext({ format: search.format });
  if (!isPublishableWeek(week, context.currentWeek)) notFound();

  const live = weekPhase(week, context.currentWeek) === "live";
  const now = Date.now();
  const [report, results, upcoming] = await Promise.all([
    loadWeekReport(context, week),
    loadWeekResults(context, week),
    live ? loadUpcomingGames(context, week) : Promise.resolve([]),
  ]);

  const scoringLabel = context.scoring.label;
  const sourceName = report?.projectionSourceName ?? projectionSourceDisplay(context.projectionSource);
  const top = report?.spotlights.best[0] ?? null;
  const prev = week > 1 ? week - 1 : null;
  const next = isPublishableWeek(week + 1, context.currentWeek) ? week + 1 : null;

  const chips: MastheadChip[] = [
    ...(context.season ? [{ label: `${context.season} season`, tone: "cyan" as const }] : []),
    { label: live ? "Being played now" : "Final", tone: live ? "purple" : "success" },
    { label: `${scoringLabel} scoring`, tone: "plain" },
  ];
  const stats: MastheadStat[] = [];
  if (results.length > 0) {
    stats.push({ label: "Finals", value: String(results.length), detail: results.length === 1 ? "game" : "games", accent: "cyan" });
  }
  if (upcoming.length > 0) {
    stats.push({ label: "Still to play", value: String(upcoming.length), detail: upcoming.length === 1 ? "game" : "games", accent: "purple" });
  }
  if (top) {
    stats.push({ label: "Top score", value: top.points.toFixed(1), detail: `${top.name}, ${top.position}` });
  }

  const sections: SectionNavItem[] = [
    ...(upcoming.length > 0 ? [{ id: "upcoming", title: "Games still to play", short: "To play" }] : []),
    ...(report ? [{ id: "spotlight", title: "The week in the spotlight", short: "Spotlight" }] : []),
    ...(report ? [{ id: "top-scorers", title: "Top scorers by position", short: "Top scorers" }] : []),
    ...(results.length > 0 ? [{ id: "results", title: "Results", short: "Results" }] : []),
  ];

  const canonical = `${SITE.url}${weekPath(week)}`;
  const title = titleFor(week, context.season, live);
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: title,
      description: descriptionFor(week, live),
      url: canonical,
      inLanguage: "en-US",
      isAccessibleForFree: true,
      author: authorJsonLd(),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE.url },
        { "@type": "ListItem", position: 2, name: "Season Pulse", item: `${SITE.url}/season` },
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

      <PageBody flush>
        <PageMasthead
          eyebrow="Season Pulse"
          title={live ? `NFL week ${week}: previews and results` : `Week ${week} fantasy football recap`}
          chips={chips}
          stats={stats}
          description={
            live
              ? "The games still to play with a forecast and a short preview for each, and the finals as they come in."
              : "Who went off, who beat the projection, who came from nowhere and who let a lineup down, with every final."
          }
        >
          <nav aria-label="Previous and next week" className="flex flex-wrap gap-2">
            {prev && (
              <Link href={weekPath(prev)} className={PAGER}>
                <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
                Week {prev}
              </Link>
            )}
            {next && (
              <Link href={weekPath(next)} className={PAGER}>
                Week {next}
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
            )}
            <Link href="/season" className={PAGER}>
              Season Pulse
            </Link>
          </nav>
        </PageMasthead>
      </PageBody>

      <PageColumns
        railLabel="Sections of this week, the other weeks and the other Season Pulse pages"
        rail={
          <>
            {sections.length > 1 && <SectionNav items={sections} variant="rail" label={`Week ${week} sections`} />}
            <Panel eyebrow="Week by week" title="Every week so far" headingLevel={2}>
              <WeekStrip currentWeek={context.currentWeek} activeWeek={week} />
            </Panel>
            <Panel eyebrow="Season Pulse" title="More of the season" headingLevel={2}>
              <PulsePages current="week" />
            </Panel>
            <Panel eyebrow="Method" title="How to read this week" headingLevel={2}>
              <ul role="list" className="space-y-2.5 text-sm leading-relaxed text-ink-muted">
                <li>
                  Fantasy points use <strong className="font-semibold text-ink">{scoringLabel}</strong> scoring, from
                  the format selected in the header.
                </li>
                <li>
                  A badge like RB3 on this page is the finish at the position for this week alone, not the season
                  rank.
                </li>
                <li>Projections are {sourceName}&apos;s published numbers for the week.</li>
                {live && <li>A game moves from the previews to the results the morning after it is played.</li>}
              </ul>
            </Panel>
          </>
        }
      >
        {sections.length > 1 && <SectionNav items={sections} variant="bar" label={`Week ${week} sections`} />}

        {upcoming.length > 0 && (
          <Panel
            id="upcoming"
            className={SECTION}
            eyebrow="This week"
            title={`Week ${week} games still to play`}
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
            glow
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

        {report && (
          <Panel
            id="spotlight"
            className={SECTION}
            eyebrow="Fantasy"
            title={live ? `Week ${week} so far, in the spotlight` : `Week ${week} in the spotlight`}
            helper={`${
              live ? "From the games already played. " : ""
            }The best, the biggest beats, the surprises and the letdowns. Projections are ${sourceName}'s.`}
            glow={upcoming.length === 0}
          >
            <WeekSpotlightGroups
              spotlights={report.spotlights}
              scoringLabel={scoringLabel}
              sourceName={sourceName}
              idPrefix="week-spot"
            />
          </Panel>
        )}

        {report && (
          <Panel
            id="top-scorers"
            className={SECTION}
            eyebrow="Fantasy"
            title={`Week ${week} top scorers by position`}
            helper={`The five highest scores at each position, ${scoringLabel} scoring.`}
          >
            <TopScorersByPosition spotlights={report.spotlights} sourceName={sourceName} idPrefix="week-top" />
          </Panel>
        )}

        {results.length > 0 && (
          <Panel
            id="results"
            className={SECTION}
            eyebrow="Around the NFL"
            title={`Week ${week} results`}
            helper="Every final, how the line fared and the best fantasy lines of each game."
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

        {!report && results.length === 0 && upcoming.length === 0 && (
          <Panel eyebrow="This week" title={`Nothing from week ${week} yet`}>
            <p className="text-sm leading-relaxed text-ink-muted">
              No game of this week has a box score or a schedule entry yet. Scores appear the morning after each game.
            </p>
          </Panel>
        )}
      </PageColumns>
    </main>
  );
}
