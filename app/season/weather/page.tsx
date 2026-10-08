import type { Metadata } from "next";
import { SITE } from "@/lib/site";
import { authorJsonLd, serializeJsonLd } from "@/lib/json-ld";
import { pageShareMetadata } from "@/lib/page-og";
import { formatEasternKickoff } from "@/lib/datetime";
import { PageBody } from "@/components/app-shell/page-body";
import { PageColumns } from "@/components/app-shell/page-columns";
import { PageMasthead, type MastheadChip, type MastheadStat } from "@/components/app-shell/page-masthead";
import { Panel } from "@/components/dashboard-panel";
import { FaqAccordion, type FaqAccordionItem } from "@/components/faq-accordion";
import { faqPageJsonLd } from "@/components/tool-explainer";
import { NflTeamLogo } from "@/components/nfl-team-logo";
import { createClient } from "@/lib/supabase/server";
import { resolveSeasonClock } from "@/lib/start-sit/clock";
import {
  MET_NORWAY_ATTRIBUTION,
  MET_NORWAY_ATTRIBUTION_URL,
  NWS_ATTRIBUTION,
  NWS_ATTRIBUTION_URL,
} from "@/lib/nfl-weather";
import { readWeather, weatherSeverity } from "@/lib/nfl-weather-impact";
import { loadUpcomingGames, resolveSeasonPulseContext } from "@/lib/season-pulse/data";
import { loadStadiumsCached, loadTeamsCached } from "@/lib/season-pulse/load";
import { PULSE_LINK } from "@/components/season-pulse/bits";
import { UpcomingCard, WeatherChip } from "@/components/season-pulse/game-cards";
import { PulsePages, WeekStrip } from "@/components/season-pulse/week-strip";
import { SectionNav, type SectionNavItem } from "@/components/season-pulse/section-nav";

/**
 * /season/weather
 *
 * The forecast for every NFL game still to be played this week, read for
 * fantasy: which games to downgrade, which to ignore, and which are indoors.
 *
 * WHY ITS OWN PAGE. "nfl weather" is 10,000 to 100,000 US searches a month,
 * and "nfl game weather", "nfl weather report", "nfl weather forecast" and
 * "nfl weather today" are 1,000 to 10,000 each (Keyword Planner, 2026-10-03).
 * It is the largest cluster in the Season Pulse research that a page can
 * answer completely, and the site had nothing on it.
 *
 * WHERE THE FORECAST COMES FROM. `nfl_game_weather` (migration 0337), filled
 * by /api/cron/sync-nfl-weather from the National Weather Service for games in
 * the United States and MET Norway for games abroad. This page reads the
 * newest snapshot per game and never calls either service.
 *
 * WHAT IT DOES NOT DO. It adjusts no projection. The projected points on each
 * card are the same ones the rest of the site shows; the forecast sits beside
 * them with what it has meant historically (lib/nfl-weather-impact.ts).
 *
 * THE WORST WEATHER IS FIRST. The games are ordered by how much the forecast
 * matters and then by kickoff, because a reader arriving on Sunday morning has
 * one question, and thirteen calm games above the windy one buries the answer.
 *
 * A game with no forecast says so. It is never shown as calm.
 */

export const dynamic = "force-dynamic";

function titleFor(week: number | null, season: number | null): string {
  return week
    ? `Game Day Weather, Week ${week}${season ? ` ${season}` : ""}: Forecast for Every Game and Fantasy Impact`
    : "Game Day Weather This Week: Forecast for Every Game and Fantasy Impact";
}

const DESCRIPTION =
  "Game day weather forecasts for every game this week: temperature, wind, gusts and rain at kickoff from the National Weather Service, which games are in a dome, and what each forecast means for your fantasy football lineup.";

export async function generateMetadata(): Promise<Metadata> {
  const clock = await resolveSeasonClock(await createClient());
  const week = clock.currentWeek >= 1 && clock.currentWeek <= 18 ? clock.currentWeek : null;
  const title = titleFor(week, clock.season);
  return {
    title: { absolute: title },
    description: DESCRIPTION,
    alternates: { canonical: "/season/weather" },
    keywords: [
      "nfl weather",
      "nfl weather report",
      "nfl weather forecast",
      "nfl game weather",
      "nfl weather today",
      "nfl weather this week",
      "nfl weather sunday",
      "fantasy football weather",
      "fantasy football weather report",
      "nfl dome teams",
      ...(week ? [`nfl week ${week} weather`, `week ${week} nfl weather forecast`] : []),
    ],
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    },
    ...pageShareMetadata({ key: "season-weather", title, description: DESCRIPTION, path: "/season/weather" }),
  };
}

const FAQ: FaqAccordionItem[] = [
  {
    question: "Does weather really affect fantasy football scoring?",
    answer:
      "Wind does, and little else matters as much. Passing efficiency and long field goals start to slip at about 10 miles per hour of sustained wind and drop sharply at 20 and above. Rain trims passing a little and adds a few carries. Snow is the largest effect and the rarest. Cold on its own has not moved team scoring in the studies cited on this page.",
  },
  {
    question: "How windy is too windy for a quarterback or a kicker?",
    answer:
      "This page starts flagging a game at 10 miles per hour sustained, marks a downgrade at 15 and heavy weather at 20. Those cut points are ours, drawn from the published measurements linked below. A strong gust lifts a game one step, and the highest wind across the three hours after kickoff counts, not only the kickoff hour.",
  },
  {
    question: "Which NFL teams play in a dome?",
    answer:
      "Five stadiums have a fixed roof: the Superdome in New Orleans, Ford Field in Detroit, U.S. Bank Stadium in Minneapolis, Allegiant Stadium in Las Vegas and SoFi Stadium in Inglewood, which the Rams and Chargers share. Five more have a retractable roof: AT&T Stadium in Arlington, NRG Stadium in Houston, Lucas Oil Stadium in Indianapolis, Mercedes-Benz Stadium in Atlanta and State Farm Stadium in Glendale. The table on this page lists every stadium.",
  },
  {
    question: "What about a stadium with a retractable roof?",
    answer:
      "We treat it as closed. Nothing published says in advance whether a retractable roof will be open on game day, so the page assumes no weather effect for those games and says so on each one, instead of calling the game indoors as a fact.",
  },
  {
    question: "Where do these forecasts come from, and how fresh are they?",
    answer:
      "From the National Weather Service for games in the United States and from MET Norway for games played abroad. Each is for the stadium's own location at kickoff and the three hours after it. Forecasts are refreshed every morning and three more times on a day with games, and every card shows when its forecast was read. A forecast several days out is said to be early, because it will change.",
  },
  {
    question: "Why does a game say no forecast yet?",
    answer:
      "The National Weather Service publishes about seven days ahead, so a game further out than that has nothing to show. The page says so instead of assuming fair weather. The forecast appears on the first morning the game comes inside the window.",
  },
  {
    question: "Are your projections adjusted for the weather?",
    answer:
      "No. The projected points on this page are the same ones shown everywhere else on the site. The forecast is placed beside them with what it has meant historically, so you can make the call yourself in a close decision.",
  },
];

const ROOF_LABEL = { outdoors: "Open air", dome: "Dome", retractable: "Retractable roof" } as const;

const SECTION = "scroll-mt-32 xl:scroll-mt-28";

const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" } as const;

export default async function SeasonWeatherPage({
  searchParams,
}: {
  searchParams: Promise<{ format?: string | string[] }>;
}) {
  const search = await searchParams;
  const context = await resolveSeasonPulseContext({ format: search.format });
  const now = Date.now();
  const week = context.currentWeek >= 1 && context.currentWeek <= 18 ? context.currentWeek : null;

  const [games, stadiums, teams] = await Promise.all([
    week ? loadUpcomingGames(context, week) : Promise.resolve([]),
    loadStadiumsCached(),
    loadTeamsCached(),
  ]);
  const teamName = new Map(teams.map((t) => [t.code, t.name]));

  const read = games.map((game) => ({ game, weather: readWeather(game.weather) }));
  const ordered = [...read].sort(
    (a, b) =>
      weatherSeverity(b.weather.band) - weatherSeverity(a.weather.band) ||
      (a.game.kickoffAt ?? "").localeCompare(b.game.kickoffAt ?? ""),
  );

  const flagged = read.filter((r) => r.weather.band === "downgrade" || r.weather.band === "heavy");
  const watching = read.filter((r) => r.weather.band === "watch");
  const indoors = read.filter((r) => r.weather.band === "indoors");
  const unknown = read.filter((r) => r.weather.band === "unknown");
  const usesMetNorway = games.some((g) => g.weather?.provider === "met-norway");

  const chips: MastheadChip[] = [
    ...(context.season ? [{ label: `${context.season} season`, tone: "cyan" as const }] : []),
    ...(week ? [{ label: `Week ${week}`, tone: "purple" as const }] : []),
    { label: "Refreshed every morning", tone: "plain" },
  ];
  const stats: MastheadStat[] =
    games.length > 0
      ? [
          { label: "Games to play", value: String(games.length), detail: `in week ${week}`, accent: "cyan" },
          {
            label: "Downgrades",
            value: String(flagged.length),
            detail: flagged.length === 1 ? "game with real weather" : "games with real weather",
            accent: "purple",
          },
          { label: "Worth watching", value: String(watching.length), detail: "a tiebreaker at most" },
          { label: "Indoors", value: String(indoors.length), detail: "roof over the field" },
        ]
      : [];

  const sections: SectionNavItem[] = [
    ...(games.length > 0 ? [{ id: "summary", title: "The short version", short: "Summary" }] : []),
    ...(games.length > 0 ? [{ id: "forecasts", title: "Forecast for every game", short: "Forecasts" }] : []),
    { id: "evidence", title: "How weather moves fantasy scoring", short: "The evidence" },
    { id: "stadiums", title: "Every stadium's roof", short: "Stadiums" },
    { id: "faq", title: "Questions, answered", short: "FAQ" },
  ];

  // One row per TEAM, so the two stadiums that host two teams appear under each
  // of them and the list reads alphabetically by team.
  const homeRows = stadiums
    .flatMap((stadium) => stadium.homeTeams.map((team) => ({ team, name: teamName.get(team) ?? team, stadium })))
    .sort((a, b) => a.name.localeCompare(b.name));

  const canonical = `${SITE.url}/season/weather`;
  const title = titleFor(week, context.season);
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
    },
    faqPageJsonLd(FAQ),
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE.url },
        { "@type": "ListItem", position: 2, name: "Season Pulse", item: `${SITE.url}/season` },
        { "@type": "ListItem", position: 3, name: "Game day weather", item: canonical },
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
          title={week ? `Game day weather, week ${week}` : "Game day weather this week"}
          chips={chips}
          stats={stats}
          description="The forecast at kickoff for every game still to be played, and what it means for a fantasy lineup: which games to downgrade, which to ignore, and which have a roof."
        />
      </PageBody>

      <PageColumns
        railLabel="Sections of this page and the other Season Pulse pages"
        rail={
          <>
            <SectionNav items={sections} variant="rail" label="Game day weather sections" />
            <Panel eyebrow="Season Pulse" title="More of the season" headingLevel={2}>
              <PulsePages current="weather" />
            </Panel>
            {context.throughWeek >= 1 && (
              <Panel eyebrow="Week by week" title="Every week so far" headingLevel={2}>
                <WeekStrip currentWeek={context.currentWeek} />
              </Panel>
            )}
            <Panel eyebrow="Sources" title="Where the forecasts come from" headingLevel={2}>
              <ul role="list" className="space-y-2.5 text-sm leading-relaxed text-ink-muted">
                <li>
                  <a href={NWS_ATTRIBUTION_URL} {...EXTERNAL} className={`inline-flex min-h-11 items-center ${PULSE_LINK}`}>
                    {NWS_ATTRIBUTION}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  , for games in the United States.
                </li>
                <li>
                  <a href={MET_NORWAY_ATTRIBUTION_URL} {...EXTERNAL} className={`inline-flex min-h-11 items-center ${PULSE_LINK}`}>
                    {MET_NORWAY_ATTRIBUTION}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  , for games played abroad.
                </li>
                <li>Each forecast is for the stadium at kickoff and the three hours after it.</li>
                <li>Projections on this page are not adjusted for weather.</li>
              </ul>
            </Panel>
          </>
        }
      >
        <SectionNav items={sections} variant="bar" label="Game day weather sections" />

        {games.length === 0 ? (
          <Panel eyebrow="This week" title={week ? `No games left to play in week ${week}` : "The regular season is over"}>
            <p className="text-sm leading-relaxed text-ink-muted">
              {week
                ? "Every game of the week has a final. Forecasts for the next week appear here once it becomes the live week."
                : "There are no regular season games left to forecast. The stadium table and the evidence below stay here for next season."}
            </p>
          </Panel>
        ) : (
          <>
            <Panel
              id="summary"
              className={SECTION}
              eyebrow="This week"
              title="The short version"
              helper={`${games.length} ${games.length === 1 ? "game" : "games"} still to play in week ${week}, worst weather first.`}
              glow
            >
              <p className="text-sm leading-relaxed text-ink">
                {flagged.length === 0
                  ? watching.length === 0
                    ? "No game this week has weather worth changing a lineup for."
                    : `No game this week carries a real weather downgrade. ${watching.length} ${watching.length === 1 ? "is" : "are"} worth a look as a tiebreaker.`
                  : `${flagged.length} ${flagged.length === 1 ? "game carries" : "games carry"} a real weather downgrade this week${
                      watching.length > 0 ? `, and ${watching.length} more ${watching.length === 1 ? "is" : "are"} worth watching` : ""
                    }.`}
                {indoors.length > 0
                  ? ` ${indoors.length} ${indoors.length === 1 ? "is" : "are"} under a roof.`
                  : ""}
                {unknown.length > 0
                  ? ` ${unknown.length} ${unknown.length === 1 ? "has" : "have"} no forecast yet, which is not the same as fair weather.`
                  : ""}
              </p>
              <ul role="list" className="mt-4 divide-y divide-line/60">
                {ordered.map(({ game, weather }) => (
                  <li key={game.gameKey} className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                    <a
                      href={`#game-${game.gameKey.toLowerCase()}`}
                      className={`inline-flex min-h-11 min-w-0 flex-1 items-center gap-2 text-sm ${PULSE_LINK}`}
                    >
                      <NflTeamLogo team={game.away.code} size={20} />
                      <span>{game.away.nickname}</span>
                      <span className="text-ink-subtle no-underline">at</span>
                      <NflTeamLogo team={game.home.code} size={20} />
                      <span>{game.home.nickname}</span>
                    </a>
                    <span className="text-xs text-ink-subtle sm:w-56 sm:shrink-0">
                      {game.kickoffAt ? formatEasternKickoff(game.kickoffAt) : "Kickoff time not set"}
                    </span>
                    <span className="sm:w-48 sm:shrink-0">
                      <WeatherChip weather={game.weather} />
                      <span className="sr-only">. {weather.forecast ?? weather.advice}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel
              id="forecasts"
              className={SECTION}
              eyebrow="This week"
              title={`Week ${week} forecast for every game`}
              helper="Temperature, wind, gusts and rain at kickoff, what it means for a lineup, and the players projected to score the most."
            >
              <ul role="list" className="grid gap-4">
                {ordered.map(({ game }) => (
                  <li key={game.gameKey} className="min-w-0">
                    <UpcomingCard game={game} now={now} detail />
                  </li>
                ))}
              </ul>
              {usesMetNorway && (
                <p className="mt-3 text-xs leading-relaxed text-ink-subtle">
                  Forecasts for games played outside the United States are from MET Norway.
                </p>
              )}
            </Panel>
          </>
        )}

        <Panel
          id="evidence"
          className={SECTION}
          eyebrow="The evidence"
          title="How weather moves fantasy scoring"
          helper="What the published studies measured. The bands on this page are ours; the numbers behind them are theirs."
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-line bg-base/40 p-4">
              <h3 className="text-sm font-semibold text-ink">Wind is the one that matters</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                Across 7,276 games,{" "}
                <a href="https://nflanalytic.com/explainer-weather-and-scoring.html" {...EXTERNAL} className={PULSE_LINK}>
                  nflanalytic
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>{" "}
                found games averaged 44.7 combined points in wind of 0 to 5 miles per hour and 40.5 at 16 and above.{" "}
                <a href="https://www.pff.com/news/fantasy-football-the-factors-week-14-2017" {...EXTERNAL} className={PULSE_LINK}>
                  PFF
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>{" "}
                measured completion rate 1.8 points lower and 0.30 fewer yards per attempt at 10 miles per hour and
                above, over 5,736 attempts.
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-base/40 p-4">
              <h3 className="text-sm font-semibold text-ink">At 20 miles per hour and above</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                <a
                  href="https://www.thespax.com/nfl/analyzing-the-effect-of-weather-in-the-nfl/"
                  {...EXTERNAL}
                  className={PULSE_LINK}
                >
                  The Spax
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>{" "}
                found completion rate falling from 60.3 to 54.7 percent and field goal accuracy from 83.8 to 76.9
                percent in wind of 20 miles per hour and above, with kickers already attempting shorter kicks.
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-base/40 p-4">
              <h3 className="text-sm font-semibold text-ink">Cold alone does almost nothing</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                <a
                  href="https://www.4for4.com/how-does-cold-weather-impact-nfl-scoring"
                  {...EXTERNAL}
                  className={PULSE_LINK}
                >
                  4for4
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>{" "}
                looked at 3,935 games and found temperature explained under 1 percent of the variation in scoring.
                nflanalytic&apos;s figures agree: 43.4 points at 32 degrees or colder against 43.7 at 50 to 69.
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-base/40 p-4">
              <h3 className="text-sm font-semibold text-ink">A dome only takes the weather away</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                Dome games score more in the raw numbers, but better offenses play in domes. A roof means the wind,
                rain and snow columns are empty, which is why an indoor game here reads as no weather concern and
                nothing more.
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-subtle">
            The expected scores on each card come from the scoring line, which is set with the forecast in view. The
            forecast is most useful for how the points are made: fewer deep passes and long field goals, more carries.
          </p>
        </Panel>

        <Panel
          id="stadiums"
          className={SECTION}
          eyebrow="Reference"
          title="Every NFL stadium: dome, retractable roof or open air"
          helper="The home stadium of each team for the current season."
        >
          <div
            role="region"
            aria-label="Stadium roofs table"
            tabIndex={0}
            className="beacon-scroll overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">
                Each NFL team&apos;s home stadium and whether it is open air, a dome, or has a retractable roof.
              </caption>
              <thead>
                <tr className="border-b border-line bg-surface-elevated/50 text-[10px] uppercase tracking-[0.12em] text-ink-subtle">
                  <th scope="col" className="px-2 py-2.5 font-semibold sm:px-3">
                    Team
                  </th>
                  <th scope="col" className="px-2 py-2.5 font-semibold sm:px-3">
                    Stadium
                  </th>
                  <th scope="col" className="px-2 py-2.5 font-semibold sm:px-3">
                    Roof
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {homeRows.map(({ team, name, stadium }) => (
                    <tr key={`${stadium.id}-${team}`}>
                      <th scope="row" className="px-2 py-2 text-left font-normal sm:px-3">
                        <span className="flex items-center gap-2">
                          <NflTeamLogo team={team} size={20} />
                          <span className="text-sm font-medium text-ink sm:hidden">
                            {team}
                            <span className="sr-only">{`, ${name}`}</span>
                          </span>
                          <span className="hidden text-sm font-medium text-ink sm:inline">{name}</span>
                        </span>
                      </th>
                      <td className="px-2 py-2 text-ink-muted sm:px-3">
                        {stadium.name}
                        <span className="block text-xs text-ink-subtle">
                          {[stadium.city, stadium.region].filter(Boolean).join(", ")}
                        </span>
                      </td>
                      <td className="px-2 py-2 sm:px-3">
                        <span
                          className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${
                            stadium.roof === "outdoors"
                              ? "border-line text-ink-muted"
                              : stadium.roof === "dome"
                                ? "border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan"
                                : "border-brand-purple/40 bg-brand-purple/10 text-brand-purple-light"
                          }`}
                        >
                          {ROOF_LABEL[stadium.roof]}
                        </span>
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
            SoFi Stadium is listed as a dome: its canopy is fixed and its sides are open, and it keeps wind and rain off
            the field. A retractable roof is treated as closed on this page.
          </p>
        </Panel>

        <Panel id="faq" className={SECTION} eyebrow="FAQ" title="Game day weather questions, answered">
          <FaqAccordion items={FAQ} />
        </Panel>
      </PageColumns>
    </main>
  );
}
