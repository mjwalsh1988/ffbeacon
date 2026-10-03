import type { Metadata } from "next";
import { SITE, isOffensePosition, positionNoun } from "@/lib/site";
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
import { OFFENSE_POSITIONS } from "@/lib/site";
import { loadSeasonBoard, resolveSeasonPulseContext } from "@/lib/season-pulse/data";
import { toBoardRows } from "@/components/season-pulse/board-rows";
import { LeadersBoard, type BoardTab } from "@/components/season-pulse/leaders-board";
import { PlayerAvatar, PlayerName, PositionBadge, TeamTag } from "@/components/season-pulse/bits";
import { PulsePages, WeekStrip } from "@/components/season-pulse/week-strip";

/**
 * /season/leaders
 *
 * The full leaders board: every player who has taken the field this season at
 * the six fantasy positions, ranked at his position, searchable by name.
 *
 * WHY ITS OWN PAGE. "fantasy football leaders" and "fantasy points leaders"
 * are each 1,000 to 10,000 US searches a month (Keyword Planner, 2026-10-03),
 * and the answer to "where does this player rank" needs everyone on the board,
 * which the hub does not ship. This page does.
 *
 * `?pos=` opens the board on a position and the canonical stays the bare path,
 * so six filtered views of one board never compete with each other.
 *
 * Format through the ordinary preference chain; no value source is read
 * (lib/season-pulse/data.ts).
 */

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Fantasy football points leaders for the current season at quarterback, running back, wide receiver, tight end, kicker and defense. Search any player to see his rank at his position, his points per game and how every week went.";

function titleFor(season: number | null): string {
  return `Fantasy Football Leaders${season ? ` ${season}` : ""}: Points and Positional Ranks for Every Player`;
}

export async function generateMetadata(): Promise<Metadata> {
  const clock = await resolveSeasonClock(await createClient());
  const title = titleFor(clock.season);
  return {
    title: { absolute: title },
    description: DESCRIPTION,
    alternates: { canonical: "/season/leaders" },
    keywords: [
      "fantasy football leaders",
      "fantasy points leaders",
      "fantasy football scoring leaders",
      "fantasy football points leaders",
      "fantasy football stats",
      "fantasy football positional rankings",
      "fantasy football stats by week",
      "qb fantasy points leaders",
      "rb fantasy points leaders",
      "wr fantasy points leaders",
      "te fantasy points leaders",
    ],
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    },
    ...pageShareMetadata({ key: "season-leaders", title, description: DESCRIPTION, path: "/season/leaders" }),
  };
}

const FAQ: FaqAccordionItem[] = [
  {
    question: "How do I find a player's positional rank?",
    answer:
      "Type his name in the Find a player box. The search covers every position at once, and the badge at the start of his row is the answer: WR7 means he has the seventh most fantasy points of any wide receiver this season.",
  },
  {
    question: "Is the rank by total points or points per game?",
    answer:
      "The badge is always by total points, because that is what a positional finish means at the end of a season. You can sort the list by points per game instead, and a player is ranked per game only after playing at least half the weeks completed so far, so one big game from a single appearance does not top the list.",
  },
  {
    question: "What does the week by week view show?",
    answer:
      "Every week's fantasy points for each player, with his finish at the position that week printed underneath, such as RB3. A darker cell is a better finish. The last column counts how many of his weeks were starter weeks: a top 12 finish at quarterback, tight end, kicker or defense, or a top 24 finish at running back or wide receiver.",
  },
  {
    question: "Why does the overall tab leave out kickers and defenses?",
    answer:
      "Because a kicker's points and a wide receiver's points are not the same purchase. The overall view ranks quarterbacks, running backs, wide receivers and tight ends together by total points, and each row still carries the player's rank at his own position. Kickers and defenses have their own tabs.",
  },
  {
    question: "Can I see half PPR or standard scoring?",
    answer:
      "Yes. The board follows the format selected in the header, so changing it to a half PPR or standard format rescores every total, rank and weekly finish on this page. Formats with a tight end premium add that bonus to tight ends.",
  },
];

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseTab(value: string | string[] | undefined): BoardTab {
  const raw = firstParam(value)?.toUpperCase();
  return isOffensePosition(raw) ? raw : "ALL";
}

export default async function SeasonLeadersPage({
  searchParams,
}: {
  searchParams: Promise<{ pos?: string | string[]; format?: string | string[] }>;
}) {
  const search = await searchParams;
  const context = await resolveSeasonPulseContext({ format: search.format });
  const board = await loadSeasonBoard(context);
  const scoringLabel = context.scoring.label;
  const hasBoard = board !== null && board.players.length > 0;
  const liveWeek = context.throughWeek > context.lastCompletedWeek ? context.throughWeek : null;

  const leaders = board
    ? OFFENSE_POSITIONS.flatMap((position) => {
        const top = board.players.find((p) => p.position === position && p.rank === 1);
        return top ? [top] : [];
      })
    : [];
  const ranked = board ? Object.values(board.rankedByPosition).reduce((sum, n) => sum + n, 0) : 0;

  const chips: MastheadChip[] = [
    ...(context.season ? [{ label: `${context.season} season`, tone: "cyan" as const }] : []),
    { label: `${scoringLabel} scoring`, tone: "plain" },
    ...(liveWeek ? [{ label: `Week ${liveWeek} in progress`, tone: "purple" as const }] : []),
  ];
  const stats: MastheadStat[] = hasBoard
    ? [
        { label: "Players ranked", value: String(ranked), detail: "at six positions", accent: "cyan" },
        {
          label: "Weeks played",
          value: String(context.lastCompletedWeek),
          detail: liveWeek ? `Week ${liveWeek} in progress` : "of 18",
          accent: "purple",
        },
      ]
    : [];

  const canonical = `${SITE.url}/season/leaders`;
  const title = titleFor(context.season);
  const overall = board
    ? [...board.players].filter((p) => p.position !== "K" && p.position !== "DEF").sort((a, b) => b.total - a.total)
    : [];
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
    ...(overall.length > 0
      ? [
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: `Fantasy football points leaders${context.season ? `, ${context.season} season` : ""}, ${scoringLabel} scoring`,
            numberOfItems: Math.min(25, overall.length),
            itemListElement: overall.slice(0, 25).map((p, i) => ({
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
        { "@type": "ListItem", position: 2, name: "Season Pulse", item: `${SITE.url}/season` },
        { "@type": "ListItem", position: 3, name: "Fantasy leaders", item: canonical },
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
          title="Fantasy football leaders"
          chips={chips}
          stats={stats}
          description="Every player's fantasy points this season and his rank at his position. Type a name to find him, or pick a position and scan the list."
        />
      </PageBody>

      <PageColumns
        railLabel="Position leaders, the other Season Pulse pages and how the board is built"
        rail={
          <>
            {leaders.length > 0 && (
              <Panel eyebrow="Number one" title="The leader at each position" headingLevel={2}>
                <ul role="list" className="divide-y divide-line/60">
                  {leaders.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 py-1.5">
                      <PlayerAvatar position={p.position} sleeperId={p.sleeperId} team={p.team} size={32} />
                      <span className="min-w-0 flex-1">
                        <PlayerName slug={p.slug} name={p.name} />
                        <span className="-mt-2 block text-xs">
                          <TeamTag team={p.team} size={12} />
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <PositionBadge position={p.position} rank={1} size="sm" />
                        <span className="mt-0.5 block font-mono text-sm font-bold tabular-nums text-ink">
                          {p.total.toFixed(1)}
                          <span className="sr-only"> points</span>
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            <Panel eyebrow="Season Pulse" title="More of the season" headingLevel={2}>
              <PulsePages current="leaders" />
            </Panel>
            {context.throughWeek >= 1 && (
              <Panel eyebrow="Week by week" title="Every week so far" headingLevel={2}>
                <WeekStrip currentWeek={context.currentWeek} />
              </Panel>
            )}
            <Panel eyebrow="Method" title="How the board is built" headingLevel={2}>
              <ul role="list" className="space-y-2.5 text-sm leading-relaxed text-ink-muted">
                <li>
                  Points use <strong className="font-semibold text-ink">{scoringLabel}</strong> scoring, from the
                  format selected in the header.
                </li>
                <li>
                  A week a player did not play is left blank. It is not counted as a game and never lowers a per-game
                  figure.
                </li>
                <li>Only players who have taken the field this season are ranked.</li>
                {board && <li>Last rebuilt {formatEastern(board.computedAt)}.</li>}
              </ul>
            </Panel>
          </>
        }
      >
        {hasBoard && board ? (
          <Panel
            id="leaders"
            eyebrow="Fantasy"
            title="Positional ranks for every player"
            helper={`Total fantasy points this season, ${scoringLabel} scoring.${
              liveWeek ? ` Week ${liveWeek} is still being played and counts toward the totals.` : ""
            }`}
            glow
          >
            <LeadersBoard
              rows={toBoardRows(board.players)}
              rankedByPosition={board.rankedByPosition}
              throughWeek={board.throughWeek}
              lastCompletedWeek={board.lastCompletedWeek}
              scoringLabel={scoringLabel}
              initialTab={parseTab(search.pos)}
              pageSize={50}
            />
          </Panel>
        ) : (
          <Panel eyebrow="Fantasy" title="No scores yet this season">
            <p className="text-sm leading-relaxed text-ink-muted">
              The board fills in the morning after the first games are played.
            </p>
          </Panel>
        )}

        {hasBoard && board && (
          <Panel eyebrow="At a glance" title="How deep each position runs" headingLevel={2}>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              {OFFENSE_POSITIONS.map((position) => (
                <div key={position} className="rounded-card border border-line bg-base/50 px-3 py-2.5">
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                    {positionNoun(position, "plural")}
                  </dt>
                  <dd className="mt-1 font-mono text-xl font-bold tabular-nums text-ink">
                    {board.rankedByPosition[position]}
                    <span className="sr-only"> ranked</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-ink-subtle">
              The number of players at each position with a game this season, which is what a rank is out of.
            </p>
          </Panel>
        )}

        <Panel id="faq" eyebrow="FAQ" title="Leaders board questions, answered">
          <FaqAccordion items={FAQ} />
        </Panel>
      </PageColumns>
    </main>
  );
}
