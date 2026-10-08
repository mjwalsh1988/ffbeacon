import type { Metadata } from "next";
import { SITE } from "@/lib/site";
import { authorJsonLd, serializeJsonLd } from "@/lib/json-ld";
import { pageShareMetadata } from "@/lib/page-og";
import { formatEastern } from "@/lib/datetime";
import { PageBody } from "@/components/app-shell/page-body";
import { PageColumns } from "@/components/app-shell/page-columns";
import { PageMasthead, type MastheadChip } from "@/components/app-shell/page-masthead";
import { Panel } from "@/components/dashboard-panel";
import { FaqAccordion, type FaqAccordionItem } from "@/components/faq-accordion";
import { faqPageJsonLd } from "@/components/tool-explainer";
import { createClient } from "@/lib/supabase/server";
import { resolveSeasonClock } from "@/lib/start-sit/clock";
import {
  loadDefenseGrid,
  loadSeasonBoard,
  loadTeamRecords,
  resolveSeasonPulseContext,
} from "@/lib/season-pulse/data";
import { statGroups, usageGroups } from "@/lib/season-pulse/leader-groups";
import { LeaderTabs } from "@/components/season-pulse/leader-tabs";
import { DefenseGrid } from "@/components/season-pulse/defense-grid";
import { TeamRecordsTable } from "@/components/season-pulse/team-records";
import { PulsePages, WeekStrip } from "@/components/season-pulse/week-strip";
import { SectionNav, type SectionNavItem } from "@/components/season-pulse/section-nav";

/**
 * /season/stats
 *
 * The NFL's own numbers for the season: yards, catches and touchdowns, who is
 * getting the work, every team's record, and what each defense gives up to
 * each position.
 *
 * WHY ITS OWN PAGE. "nfl stat leaders" and "nfl snap counts" are each 10,000
 * to 100,000 US searches a month and "nfl target leaders" 1,000 to 10,000
 * (Keyword Planner, 2026-10-03). The hub shows ten of each list under the
 * fantasy sections; this page is where the lists run to twenty-five and lead.
 *
 * Everything is read off the same season board the fantasy ranks come from
 * (lib/season-pulse/leader-groups.ts), so a player's targets here and the
 * points they became on the leaders page are the same rows.
 *
 * Only the points allowed grid depends on scoring, so the format is resolved
 * for it and the page says which scoring that one section uses.
 */

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Stat leaders for the current season: passing, rushing and receiving yards, receptions and touchdowns, target, carry and snap share leaders, every team's record and scoring, and fantasy points allowed by each defense to each position.";

function titleFor(season: number | null): string {
  return `Season Stat Leaders${season ? ` ${season}` : ""}: Yards, Touchdowns, Targets and Snap Share`;
}

export async function generateMetadata(): Promise<Metadata> {
  const clock = await resolveSeasonClock(await createClient());
  const title = titleFor(clock.season);
  return {
    title: { absolute: title },
    description: DESCRIPTION,
    alternates: { canonical: "/season/stats" },
    keywords: [
      "nfl stat leaders",
      "nfl stats",
      "nfl season stats",
      "nfl passing leaders",
      "nfl rushing leaders",
      "nfl receiving leaders",
      "nfl touchdown leaders",
      "nfl target leaders",
      "nfl snap counts",
      "fantasy points allowed by position",
      "defense vs position",
    ],
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    },
    ...pageShareMetadata({ key: "season-stats", title, description: DESCRIPTION, path: "/season/stats" }),
  };
}

const FAQ: FaqAccordionItem[] = [
  {
    question: "Which stats are on this page?",
    answer:
      "Season totals for passing yards, passing touchdowns, rushing yards, receiving yards, receptions and combined rushing and receiving touchdowns, each with the per-game figure beside it. Below those are the usage lists: targets, target share, carries and snap share. Then every team's record and scoring, and the fantasy points each defense has allowed to each position.",
  },
  {
    question: "What is target share?",
    answer:
      "A player's targets as a percentage of his team's targets in the games he played. It is worked out here from every target thrown by his team in those weeks. A receiver at 30 percent is seeing nearly a third of the passes whenever he is on the field, which says more about his role than a raw target count does when he has missed a game.",
  },
  {
    question: "What is snap share?",
    answer:
      "The share of his team's offensive snaps a player was on the field for, averaged over the games he played. It is the simplest measure of how much a team trusts a player, and it tends to move before his touches do.",
  },
  {
    question: "Why does a player need a minimum number of games for the share lists?",
    answer:
      "Target share and snap share are averages, and an average over one game is an anecdote. A player appears on those two lists only after playing at least half the weeks completed so far. The counting lists, like total targets and total yards, have no minimum.",
  },
  {
    question: "How should I read points allowed by position?",
    answer:
      "Each cell is the fantasy points a defense has allowed per game to the startable players at that position, with its rank beside it. Rank 1 allows the most, so a low number is a soft matchup. The figures are raw: they are not adjusted for which offenses a defense has faced, so early in a season a hard schedule can make a good defense look generous.",
  },
];

const SECTION = "scroll-mt-32 xl:scroll-mt-28";

export default async function SeasonStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ format?: string | string[] }>;
}) {
  const search = await searchParams;
  const context = await resolveSeasonPulseContext({ format: search.format });
  const [board, records, grid] = await Promise.all([
    loadSeasonBoard(context),
    loadTeamRecords(context),
    loadDefenseGrid(context),
  ]);
  const hasBoard = board !== null && board.players.length > 0;
  const scoringLabel = context.scoring.label;
  const liveWeek = context.throughWeek > context.lastCompletedWeek ? context.throughWeek : null;

  const chips: MastheadChip[] = [
    ...(context.season ? [{ label: `${context.season} season`, tone: "cyan" as const }] : []),
    ...(context.lastCompletedWeek >= 1
      ? [{ label: `Through week ${context.lastCompletedWeek}`, tone: "purple" as const }]
      : []),
    ...(liveWeek ? [{ label: `Week ${liveWeek} in progress`, tone: "plain" as const }] : []),
  ];

  const sections: SectionNavItem[] = [
    ...(hasBoard ? [{ id: "stat-leaders", title: "Season stat leaders", short: "Leaders" }] : []),
    ...(hasBoard ? [{ id: "usage", title: "Targets, carries and snap share", short: "Usage" }] : []),
    ...(records.length > 0 ? [{ id: "teams", title: "Team records and scoring", short: "Teams" }] : []),
    ...(grid.length > 0 ? [{ id: "matchups", title: "Points allowed by position", short: "Matchups" }] : []),
    { id: "faq", title: "Questions, answered", short: "FAQ" },
  ];

  const canonical = `${SITE.url}/season/stats`;
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
      ...(board ? { dateModified: board.computedAt } : {}),
    },
    faqPageJsonLd(FAQ),
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE.url },
        { "@type": "ListItem", position: 2, name: "Season Pulse", item: `${SITE.url}/season` },
        { "@type": "ListItem", position: 3, name: "Season stat leaders", item: canonical },
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
          title="Season stat leaders"
          chips={chips}
          description="The season's leaders in yards, catches and touchdowns, who is getting the targets and carries, every team's record, and what each defense gives up."
        />
      </PageBody>

      <PageColumns
        railLabel="Sections of this page and the other Season Pulse pages"
        rail={
          <>
            <SectionNav items={sections} variant="rail" label="Season stat leaders sections" />
            <Panel eyebrow="Season Pulse" title="More of the season" headingLevel={2}>
              <PulsePages current="stats" />
            </Panel>
            {context.throughWeek >= 1 && (
              <Panel eyebrow="Week by week" title="Every week so far" headingLevel={2}>
                <WeekStrip currentWeek={context.currentWeek} />
              </Panel>
            )}
            <Panel eyebrow="Method" title="Where these come from" headingLevel={2}>
              <ul role="list" className="space-y-2.5 text-sm leading-relaxed text-ink-muted">
                <li>Totals are added up from every box score of the regular season so far.</li>
                <li>
                  Points allowed use <strong className="font-semibold text-ink">{scoringLabel}</strong> scoring, from
                  the format selected in the header. Nothing else on this page depends on scoring.
                </li>
                {board && <li>Last rebuilt {formatEastern(board.computedAt)}.</li>}
              </ul>
            </Panel>
          </>
        }
      >
        <SectionNav items={sections} variant="bar" label="Season stat leaders sections" />

        {!hasBoard && (
          <Panel eyebrow="Around the NFL" title="No box scores yet this season">
            <p className="text-sm leading-relaxed text-ink-muted">
              The lists fill in the morning after the first games are played.
            </p>
          </Panel>
        )}

        {hasBoard && board && (
          <Panel
            id="stat-leaders"
            className={SECTION}
            eyebrow="Around the NFL"
            title="Passing, rushing and receiving leaders"
            helper={`Season totals with the per-game figure beside each.${
              liveWeek ? ` Week ${liveWeek} is still being played and is included.` : ""
            }`}
            glow
          >
            <LeaderTabs groups={statGroups(board, 25)} groupLabel="Stat category" />
          </Panel>
        )}

        {hasBoard && board && (
          <Panel
            id="usage"
            className={SECTION}
            eyebrow="Fantasy"
            title="Targets, carries and snap share"
            helper="Who is getting the work, as season totals and as a share of the team."
          >
            <LeaderTabs groups={usageGroups(board, 25)} groupLabel="Usage category" />
          </Panel>
        )}

        {records.length > 0 && (
          <Panel
            id="teams"
            className={SECTION}
            eyebrow="Around the NFL"
            title="Team records and scoring"
            helper="Every team's record with points scored and allowed per game, best record first."
          >
            <TeamRecordsTable records={records} />
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

        <Panel id="faq" className={SECTION} eyebrow="FAQ" title="Stat leaders questions, answered">
          <FaqAccordion items={FAQ} />
        </Panel>
      </PageColumns>
    </main>
  );
}
