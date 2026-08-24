import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, cache } from "react";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { ownerLine } from "@/lib/team-label";
import { pulseLeagueCore, pulseLeagueDerived } from "@/lib/league-pulse";
import { resolveSourceSlug } from "@/lib/preferences";
import {
  resolveLeagueContext,
  describeDerived,
} from "@/lib/league-format-resolution";
import { loadLeagueHeaderActions } from "@/lib/league-header-data";
import {
  buildLeagueFormatTags,
  buildLeagueScoringTags,
} from "@/lib/league-format-tags";
import { LeagueShell } from "@/components/league-shell";
import type { LeagueMastheadProps } from "@/components/league-shell";
import { Panel } from "@/components/dashboard-panel";
import {
  loadScheduleBoard,
  resolveScheduleWeek,
} from "@/lib/league-schedule/data";
import {
  buildLuckRows,
  buildSosRows,
  easiestStretch,
  headToHeadCounts,
  toughestStretch,
  weekSpotlight,
  type InsightWeek,
} from "@/lib/league-schedule/insights";
import type {
  ScheduleBoard,
  ScheduleMatchup,
  ScheduleTeam,
} from "@/lib/league-schedule/types";
import { ScheduleControls } from "@/components/league-schedule/schedule-controls";
import { WeekBoard } from "@/components/league-schedule/week-board";
import {
  TeamSeason,
  type SeasonRow,
} from "@/components/league-schedule/team-season";
import { ScheduleEmpty } from "@/components/league-schedule/schedule-empty";
import {
  fmtPoints,
  listWords,
  ordinal,
  pctWords,
  recordLabel,
  sidesFor,
  withUsername,
} from "@/components/league-schedule/format";

export const dynamic = "force-dynamic";

/**
 * The core sync and the league row, once per request.
 *
 * generateMetadata and the page body are two separate calls into this module
 * for the same request, and both need this league. Cached, they share one
 * `pulseLeagueCore` and one select.
 *
 * THE SYNC HAS TO BE INSIDE THE CACHE, not beside it. The page reads the league
 * AFTER the core pulse deliberately: a league nobody has opened before does not
 * exist in our tables until that call writes it. A cached read that ran ahead
 * of the sync would return null, cache the null, and hand the page a 404 for a
 * league that was created two lines later.
 */
const getSyncedLeague = cache(async (sleeperLeagueId: string) => {
  const pulse = await pulseLeagueCore(createAdminClient(), sleeperLeagueId);
  if (!pulse.ok) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("leagues")
    .select(
      "id, sleeper_league_id, name, season, status, total_rosters, last_pulsed_at, roster_positions, scoring_settings, metadata",
    )
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  return data ? { league: data, cached: pulse.cached } : null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league_id: string }>;
}): Promise<Metadata> {
  const { league_id } = await params;
  const synced = await getSyncedLeague(league_id);
  if (!synced) return { title: "League not found" };
  const league = synced.league;

  const title = `${league.name} Schedules`;
  const description = `Every week and every matchup in ${league.name}, with both lineups, projected totals, win probability, and strength of schedule.`;
  const ogPath = `/api/og/league/${league_id}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogPath, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title, images: [ogPath] },
  };
}

export default async function LeagueSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ league_id: string }>;
  searchParams: Promise<{
    view?: string;
    week?: string;
    roster?: string;
    username?: string;
    source?: string;
  }>;
}) {
  const { league_id: sleeperLeagueId } = await params;
  const sp = await searchParams;
  const searchedUsername =
    typeof sp.username === "string" && sp.username.trim()
      ? sp.username.trim()
      : null;
  const view: "week" | "team" = sp.view === "team" ? "team" : "week";
  const requestedWeek = intOrNull(sp.week);
  const requestedRoster = intOrNull(sp.roster);

  // Core pulse only: the league, its rosters and its members. The derived half
  // is what refreshes league_matchups and rescores Power Pulse, and that is the
  // slow part, so it runs inside the Suspense boundaries below and the
  // masthead, the tabs and the intro paint without waiting for it.
  const adminClient = createAdminClient();
  const synced = await getSyncedLeague(sleeperLeagueId);
  if (!synced) notFound();
  const { league, cached: pulseCached } = synced;

  const supabase = await createClient();

  const { otherLeagues } = await loadLeagueHeaderActions(
    supabase,
    league.id,
    sleeperLeagueId,
    searchedUsername,
    league.season != null ? String(league.season) : null,
  );

  const homeHref = searchedUsername
    ? `/tools/league-pulse?username=${encodeURIComponent(searchedUsername)}`
    : "/tools/league-pulse";
  const leagueHref = withUsername(
    `/leagues/${sleeperLeagueId}`,
    searchedUsername,
  );

  // Format is derived from the league's own Sleeper settings; only the value
  // source respects the reader's pick (CLAUDE.md: League Pulse Format
  // Resolution). This page shows almost no value data, but the masthead renders
  // the coverage chips on every section and the resolver is what fills them.
  const sleeperLeague = league.metadata as unknown as Parameters<
    typeof resolveLeagueContext
  >[1];
  const resolvedSource = await resolveSourceSlug(supabase, sp.source);
  const context = await resolveLeagueContext(
    adminClient,
    sleeperLeague,
    resolvedSource.slug,
  );
  const coverageOk = context.coverage !== "none";

  const playoffWeekStart = resolvePlayoffWeekStart(league.metadata);

  const formatTags = buildLeagueFormatTags({
    rosterPositions: league.roster_positions,
    scoringSettings: league.scoring_settings,
    teamCount: league.total_rosters,
  });
  const scoringTags = buildLeagueScoringTags(league.scoring_settings);
  const lastPulsed = league.last_pulsed_at
    ? new Date(league.last_pulsed_at)
    : null;
  const mastheadProps: LeagueMastheadProps = {
    leagueName: league.name,
    season: league.season ?? null,
    teamCount: league.total_rosters ?? null,
    status: league.status ?? null,
    formatTags,
    scoringTags,
    lastUpdatedLabel: lastPulsed ? formatRelative(lastPulsed) : "never",
    cached: pulseCached,
    coverage: context.coverage,
    // The masthead hides these when coverage is "none", so the fallback is a
    // placeholder rather than visible copy. It is still words: "N/A" is read
    // out as "na", "n slash a", or letter by letter depending on the screen
    // reader, and the day one of these leaks into the page it should not need a
    // second fix.
    sourceDisplay: coverageOk ? context.sourceDisplay : "Not available",
    formatDisplay: coverageOk ? context.formatDisplay : "Not available",
    derivedLabel: describeDerived(context.derived),
    fallbackDisplay:
      context.coverage === "fallback"
        ? (context.fallback?.derivedDisplay ?? null)
        : null,
    pickSourceDisplay:
      coverageOk &&
      context.pickSource &&
      context.pickSource.slug !== context.sourceSlug
        ? context.pickSource.display
        : null,
  };

  return (
    <LeagueShell
      sleeperLeagueId={sleeperLeagueId}
      activeTab="schedules"
      searchedUsername={searchedUsername}
      homeHref={homeHref}
      crumbs={[{ label: league.name, href: leagueHref }, { label: "Schedules" }]}
      copyHref={`/leagues/${sleeperLeagueId}/schedules`}
      copyAriaLabel="Copy link to this league's schedule"
      otherLeagues={otherLeagues}
      masthead={mastheadProps}
    >
      <>
        {/* Feature intro strip. The masthead above owns this page's h1 (the
            league name), so the section heading here is an h2. */}
        <section
          aria-labelledby="schedule-intro"
          className="relative overflow-hidden rounded-modal border border-line-accent p-5 sm:p-6"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.13) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.10) 0%, transparent 60%)",
          }}
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px"
            style={{
              backgroundImage:
                "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
            }}
          />
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-cyan">
            Week by week
          </p>
          <h2
            id="schedule-intro"
            className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl"
          >
            Schedules
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            Sleeper shows you who you play. This shows you what that costs:
            every opponent projected under your league&apos;s own scoring, and
            both starting lineups on any game you open.
          </p>
          {/* Its own boundary because the week chip comes from the same derived
              sync as the board, and the heading above it should not wait. */}
          <Suspense fallback={null}>
            <IntroChips
              leagueRowId={league.id}
              season={Number(league.season)}
              playoffWeekStart={playoffWeekStart}
              resynced={!pulseCached}
            />
          </Suspense>
        </section>

        <Suspense fallback={<ScheduleBodySkeleton />}>
          <ScheduleBody
            leagueRowId={league.id}
            sleeperLeagueId={sleeperLeagueId}
            season={Number(league.season)}
            playoffWeekStart={playoffWeekStart}
            resynced={!pulseCached}
            searchedUsername={searchedUsername}
            view={view}
            requestedWeek={requestedWeek}
            requestedRoster={requestedRoster}
          />
        </Suspense>
      </>
    </LeagueShell>
  );
}

/**
 * The chips under the intro heading.
 *
 * The team count and the playoff week are known before the sync finishes, but
 * the live week is not: it comes from Sleeper's state endpoint, which
 * getScheduleData resolves once and hands to the loader. Splitting the chips so
 * two of them paint early and one arrives later would put a row that visibly
 * grows under the heading, so all three wait together behind a boundary that
 * falls back to nothing.
 */
async function IntroChips({
  leagueRowId,
  season,
  playoffWeekStart,
  resynced,
}: {
  leagueRowId: string;
  season: number;
  playoffWeekStart: number;
  resynced: boolean;
}) {
  const board = await getScheduleData(
    leagueRowId,
    season,
    playoffWeekStart,
    resynced,
  );
  if (board.noScheduleYet) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <Chip label={`Week ${board.currentWeek}`} accent />
      <Chip label={`${board.teams.length} teams`} />
      <Chip label={`Playoffs start week ${board.playoffWeekStart}`} />
    </div>
  );
}

/**
 * The control bar, the board, and the rail.
 *
 * Every branch below needs the derived pulse, so the branch is chosen in here
 * rather than in the shell above. getScheduleData is React-cached, so this
 * boundary and the chips share one sync, one call to Sleeper's state endpoint,
 * and one board read.
 */
async function ScheduleBody({
  leagueRowId,
  sleeperLeagueId,
  season,
  playoffWeekStart,
  resynced,
  searchedUsername,
  view,
  requestedWeek,
  requestedRoster,
}: {
  leagueRowId: string;
  sleeperLeagueId: string;
  season: number;
  playoffWeekStart: number;
  resynced: boolean;
  searchedUsername: string | null;
  view: "week" | "team";
  requestedWeek: number | null;
  requestedRoster: number | null;
}) {
  const board = await getScheduleData(
    leagueRowId,
    season,
    playoffWeekStart,
    resynced,
  );

  // Nothing to control, nothing to rank, nothing to link to. The empty state
  // names the reason rather than rendering a page of empty panels.
  if (board.noScheduleYet) {
    return (
      <div className="mt-6">
        <ScheduleEmpty kind="no-schedule" season={season} />
      </div>
    );
  }

  const selectedWeek = clampWeek(board, requestedWeek);
  const selectedTeam = resolveSelectedTeam(
    board,
    requestedRoster,
    searchedUsername,
  );
  const insightWeeks: InsightWeek[] = board.weeks.map((week) => ({
    week: week.week,
    isFinal: week.isFinal,
    matchups: week.matchups,
  }));

  const weekView = board.weeks.find((w) => w.week === selectedWeek) ?? null;

  // Only in team mode, and only for the team on screen.
  const projectedWins =
    view === "team" && selectedTeam
      ? await loadProjectedWins(leagueRowId, season, selectedTeam.rosterRowId)
      : null;

  return (
    <div className="mt-6 space-y-6">
      <ScheduleControls
        sleeperLeagueId={sleeperLeagueId}
        searchedUsername={searchedUsername}
        view={view}
        week={selectedWeek}
        rosterId={
          view === "team" ? (selectedTeam?.sleeperRosterId ?? null) : null
        }
        weeks={board.weeks.map((w) => ({
          week: w.week,
          isFinal: w.isFinal,
          isCurrent: w.isCurrent,
          isPlayoffWeek: w.isPlayoffWeek,
        }))}
        teams={board.teams}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {/* Above the board, never instead of it. A partial slate is shown for
              what it is: everything we have, plus the weeks that are missing
              named out loud, because no conclusion about the shape of a
              schedule survives a week nobody fetched. */}
          {board.missingWeeks.length > 0 && (
            <ScheduleEmpty
              kind="missing-weeks"
              season={season}
              missingWeeks={board.missingWeeks}
            />
          )}

          {/* Where the projections would be. Opponents, records and final
              scores are all still on the board below. */}
          {board.projectionsUnavailable && (
            <ScheduleEmpty kind="no-projections" season={season} />
          )}

          {view === "team" ? (
            selectedTeam === null ? (
              <Panel
                eyebrow="The season"
                title="No teams on this league yet"
                helper="A team view needs rosters, and this league has none stored."
              >
                <p className="text-sm leading-relaxed text-ink-muted">
                  Switch to the week view to see the slate itself. Rosters
                  arrive on the next sync, and the team picker fills in with
                  them.
                </p>
              </Panel>
            ) : (
              <TeamSeason
                team={selectedTeam}
                rows={buildSeasonRows(board, selectedTeam.sleeperRosterId)}
                sleeperLeagueId={sleeperLeagueId}
                searchedUsername={searchedUsername}
                playoffWeekStart={board.playoffWeekStart}
                summary={{
                  remainingSosRank: selectedTeam.sosRank,
                  remainingSosPoints: selectedTeam.sosPoints,
                  projectedWins,
                  hardest: toughestStretch(
                    selectedTeam.sleeperRosterId,
                    insightWeeks,
                  ),
                  easiest: easiestStretch(
                    selectedTeam.sleeperRosterId,
                    insightWeeks,
                  ),
                  h2h: headToHeadCounts(
                    selectedTeam.sleeperRosterId,
                    insightWeeks,
                    board.teams,
                  ),
                }}
              />
            )
          ) : weekView === null ? (
            <Panel
              eyebrow="The week"
              title="That week is not on this slate"
              helper="Pick another week from the control bar above."
            >
              <p className="text-sm leading-relaxed text-ink-muted">
                Sleeper has published{" "}
                {listWords(board.weeks.map((w) => `week ${w.week}`))} for this
                league and nothing else.
              </p>
            </Panel>
          ) : (
            <WeekBoard
              week={weekView}
              sleeperLeagueId={sleeperLeagueId}
              searchedUsername={searchedUsername}
            />
          )}
        </div>

        {/* Rail on the RIGHT, matching every other section of the deep view.
            Second in DOM order, so on a phone it reads after the board it is
            supplementary to. */}
        <aside
          aria-label="Schedule insights and methodology"
          className="min-w-0 space-y-6 xl:sticky xl:top-[5.5rem] xl:self-start"
        >
          <SosPanel board={board} insightWeeks={insightWeeks} />
          <LuckPanel board={board} insightWeeks={insightWeeks} />
          <SpotlightPanel
            board={board}
            insightWeeks={insightWeeks}
            sleeperLeagueId={sleeperLeagueId}
            searchedUsername={searchedUsername}
          />
          <SourcesPanel />
        </aside>
      </div>
    </div>
  );
}

/**
 * One read of the board for every boundary under the intro.
 *
 * React's cache() dedupes it for a single render, so the chips and the body
 * share one derived sync, one call to Sleeper's state endpoint, and one board
 * read instead of racing to do all three twice. Every argument is a primitive,
 * which is what makes the cache key match across the two call sites.
 */
const getScheduleData = cache(
  async (
    leagueRowId: string,
    season: number,
    playoffWeekStart: number,
    resynced: boolean,
  ): Promise<ScheduleBoard> => {
    await pulseLeagueDerived(createAdminClient(), leagueRowId, { resynced });
    const supabase = await createClient();
    const currentWeek = await resolveScheduleWeek(season, playoffWeekStart);
    return loadScheduleBoard(supabase, {
      leagueRowId,
      season,
      playoffWeekStart,
      currentWeek,
    });
  },
);

/**
 * Strength of schedule, both directions, with the direction stated.
 *
 * "SOS rank 1" means the hardest schedule on half the fantasy internet and the
 * easiest on the other half, so the panel says which one it means before the
 * first row rather than leaving a reader to infer it from the points column.
 */
function SosPanel({
  board,
  insightWeeks,
}: {
  board: ScheduleBoard;
  insightWeeks: InsightWeek[];
}) {
  const rows = buildSosRows(board.teams, insightWeeks);
  const ranked = [...rows].sort(
    (a, b) => (a.remainingRank ?? Infinity) - (b.remainingRank ?? Infinity),
  );

  return (
    <Panel
      eyebrow="Who has it hardest"
      title="Strength of schedule"
      helper="Rank 1 is the hardest schedule left, not the easiest."
    >
      {ranked.length === 0 ? (
        <p className="text-sm leading-relaxed text-ink-muted">
          No rosters stored for this league yet, so there is nothing to rank.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Every team by strength of schedule. Columns: rank, team, opponent
              points per remaining week, and the rank of the schedule already
              played. Rank 1 is the hardest in both columns.
            </caption>
            <thead className="text-left text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
              <tr>
                <th scope="col" className="py-2 pr-2">
                  Rank
                </th>
                <th scope="col" className="py-2 pr-2">
                  Team
                </th>
                <th scope="col" className="py-2 pr-2 text-right">
                  Left
                </th>
                <th scope="col" className="py-2 text-right">
                  Played
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ranked.map((row) => (
                <tr key={row.sleeperRosterId}>
                  <td className="py-2 pr-2 font-mono text-xs tabular-nums text-ink-muted">
                    {row.remainingRank === null ? (
                      // Words, not an abbreviation. The two cells beside this
                      // one already say "Not available" and "No games", and
                      // "n/a" is the odd one out for a reader listening to the
                      // row: screen readers voice it as "na", as "n slash a",
                      // or letter by letter, depending on which one is running.
                      <span className="font-sans text-[11px] font-normal text-ink-subtle">
                        No rank yet
                      </span>
                    ) : (
                      row.remainingRank
                    )}
                  </td>
                  <th
                    scope="row"
                    className="max-w-[10rem] py-2 pr-2 text-left text-xs font-semibold text-ink"
                  >
                    <span className="block truncate">{row.teamName}</span>
                    {ownerLine(row.teamName, row.ownerHandle) && (
                      <span className="block truncate text-[11px] font-normal text-ink-subtle">
                        {ownerLine(row.teamName, row.ownerHandle)}
                      </span>
                    )}
                  </th>
                  <td className="py-2 pr-2 text-right font-mono text-xs tabular-nums text-ink">
                    {row.remainingPoints === null ? (
                      <span className="font-sans text-[11px] font-normal text-ink-subtle">
                        Not available
                      </span>
                    ) : (
                      <>
                        <span aria-hidden="true">
                          {fmtPoints(row.remainingPoints)}
                        </span>
                        <span className="sr-only">
                          {fmtPoints(row.remainingPoints)} opponent points per
                          remaining week
                        </span>
                      </>
                    )}
                  </td>
                  <td className="py-2 text-right font-mono text-xs tabular-nums text-ink-muted">
                    {row.playedRank === null ? (
                      <span className="font-sans text-[11px] font-normal text-ink-subtle">
                        No games
                      </span>
                    ) : (
                      <>
                        <span aria-hidden="true">
                          {ordinal(row.playedRank)}
                        </span>
                        <span className="sr-only">
                          {ordinal(row.playedRank)} hardest schedule played so
                          far
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/**
 * Real record against all-play record.
 *
 * The all-play number is the evidence behind an argument every league has: a
 * 4-2 team with the eighth best point total did not earn that record, and a
 * 2-4 team with the second best total did not earn that one either.
 */
function LuckPanel({
  board,
  insightWeeks,
}: {
  board: ScheduleBoard;
  insightWeeks: InsightWeek[];
}) {
  const rows = buildLuckRows(board.teams, insightWeeks);
  const ranked = [...rows].sort((a, b) => a.luckRank - b.luckRank);

  return (
    <Panel
      eyebrow="Record against results"
      title="Luck index"
      helper="Real record against playing everyone every week."
    >
      {ranked.length === 0 ? (
        <p className="text-sm leading-relaxed text-ink-muted">
          No games have been played yet, so no record has had the chance to be
          lucky. This fills in after week 1.
        </p>
      ) : (
        <ul role="list" className="space-y-2">
          {ranked.map((row) => {
            const games = row.allPlayWins + row.allPlayLosses;
            const allPlay = games > 0 ? row.allPlayWins / games : null;
            return (
              <li
                key={row.sleeperRosterId}
                className="rounded-card border border-line bg-base/40 px-3 py-2"
              >
                <p className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-ink">
                      {row.teamName}
                    </span>
                    {ownerLine(row.teamName, row.ownerHandle) && (
                      <span className="block truncate text-[11px] text-ink-subtle">
                        {ownerLine(row.teamName, row.ownerHandle)}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-ink-muted">
                    {recordLabel(row.record)}
                  </span>
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                  {ordinal(row.pointsRank)} in points scored. All-play{" "}
                  {fmtPoints(row.allPlayWins)}-{fmtPoints(row.allPlayLosses)}
                  {allPlay === null
                    ? ""
                    : `, a ${pctWords(allPlay)} win rate`}.{" "}
                  {luckSentence(row.luck)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/** The word, so the sign is never the only thing carrying the meaning. */
function luckSentence(luck: number): string {
  const points = Math.round(Math.abs(luck) * 100);
  if (points < 5) return "Record and results agree.";
  return luck > 0
    ? `Running ${points} points ahead of the results.`
    : `Running ${points} points behind the results.`;
}

/** The closest game and the biggest mismatch in the live week, each a link. */
function SpotlightPanel({
  board,
  insightWeeks,
  sleeperLeagueId,
  searchedUsername,
}: {
  board: ScheduleBoard;
  insightWeeks: InsightWeek[];
  sleeperLeagueId: string;
  searchedUsername: string | null;
}) {
  const week =
    insightWeeks.find((w) => w.week === board.currentWeek) ??
    insightWeeks[0] ??
    null;
  const spotlight = week ? weekSpotlight(week) : null;

  return (
    <Panel
      eyebrow="Games to watch"
      title="This week"
      helper={
        week === null
          ? "No week on this slate to pick from."
          : `Week ${week.week}, by projected win chance.`
      }
    >
      {spotlight === null ||
      (spotlight.closest === null && spotlight.mismatch === null) ? (
        <p className="text-sm leading-relaxed text-ink-muted">
          Picking a closest game needs a win probability on it, and those come
          from Power Pulse. Once it scores this league, the tightest game and
          the widest gap appear here.
        </p>
      ) : (
        <ul role="list" className="space-y-2">
          {spotlight.closest && (
            <SpotlightItem
              label="Closest game"
              matchup={spotlight.closest}
              sleeperLeagueId={sleeperLeagueId}
              searchedUsername={searchedUsername}
            />
          )}
          {spotlight.mismatch && spotlight.mismatch !== spotlight.closest && (
            <SpotlightItem
              label="Biggest mismatch"
              matchup={spotlight.mismatch}
              sleeperLeagueId={sleeperLeagueId}
              searchedUsername={searchedUsername}
            />
          )}
        </ul>
      )}
    </Panel>
  );
}

/** A team named the way the rest of the site names one. */
function teamWithHandle(team: { teamName: string; ownerHandle: string | null }): string {
  const owner = ownerLine(team.teamName, team.ownerHandle);
  return owner ? `${team.teamName} (${owner})` : team.teamName;
}

function SpotlightItem({
  label,
  matchup,
  sleeperLeagueId,
  searchedUsername,
}: {
  label: string;
  matchup: ScheduleMatchup;
  sleeperLeagueId: string;
  searchedUsername: string | null;
}) {
  const href = withUsername(
    `/leagues/${sleeperLeagueId}/schedules/${matchup.week}/${matchup.home.sleeperRosterId}`,
    searchedUsername,
  );
  const away = matchup.away;
  const prob = matchup.homeWinProb;
  return (
    <li className="rounded-card border border-line bg-base/40 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
        {label}
      </p>
      <p className="mt-1 text-xs font-semibold text-ink">
        <Link
          href={href}
          className="rounded-sm hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {teamWithHandle(matchup.home)}
          {away ? ` vs ${teamWithHandle(away)}` : ""}
          <span className="sr-only">
            , week {matchup.week}, open the matchup
          </span>
        </Link>
      </p>
      {away && prob !== null && (
        <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
          {matchup.home.teamName} {pctWords(prob)}, {away.teamName}{" "}
          {pctWords(1 - prob)}.
        </p>
      )}
    </li>
  );
}

/**
 * Where every number on this page comes from, named.
 *
 * The last entry is the one worth reading: trade values do not appear anywhere
 * on this page, so the source toggle in the masthead changes nothing here. A
 * reader who flips it and sees identical numbers should find that written down
 * rather than assume the page is stuck.
 */
function SourcesPanel() {
  return (
    <Panel
      eyebrow="Provenance"
      title="How this is built"
      helper="Where each number comes from."
    >
      <dl className="space-y-3 text-xs leading-relaxed">
        <div>
          <dt className="font-semibold text-ink">The slate</dt>
          <dd className="mt-0.5 text-ink-muted">
            Sleeper&apos;s own schedule for this league, all eighteen weeks,
            stored as it arrives. Final scores are Sleeper&apos;s too.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Projections</dt>
          <dd className="mt-0.5 text-ink-muted">
            Sleeper&apos;s weekly player projections, rescored under this
            league&apos;s literal scoring settings rather than generic PPR.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Opponent strength</dt>
          <dd className="mt-0.5 text-ink-muted">
            Points each NFL defense allowed to each position over the last two
            seasons, weighted toward the recent one.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Player reliability</dt>
          <dd className="mt-0.5 text-ink-muted">
            How often each player has met their own projection, with this season
            weighted heaviest and small samples pulled toward neutral.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Trade values</dt>
          <dd className="mt-0.5 text-ink-muted">
            Not used here. Nothing on this page changes when you switch value
            source, because a schedule is not a valuation.
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

/**
 * Stand-in while the derived sync finishes. Announced politely, so a screen
 * reader hears that work is in progress rather than sitting on silence.
 */
function ScheduleBodySkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-6 rounded-modal border border-line bg-surface/50 p-6"
    >
      <p className="text-sm text-ink-muted">Loading the schedule</p>
      <div aria-hidden="true" className="mt-4 space-y-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-card bg-base/60" />
        ))}
      </div>
    </div>
  );
}

function Chip({ label, accent = false }: { label: string; accent?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
        accent
          ? "border-brand-cyan/40 text-brand-cyan"
          : "border-line text-ink-muted"
      }`}
    >
      {label}
    </span>
  );
}

/** A base-10 integer from a search param, or null. Never NaN, never a float. */
function intOrNull(value: string | undefined): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

/**
 * The league's own playoff cut line.
 *
 * Same rule lib/power-pulse/load.ts applies, and for the same reason: Sleeper
 * writes `playoff_week_start: 0` on a league whose bracket has not been set up,
 * and zero is a number, so a plain `?? 15` never fires. A cut line drawn at week
 * zero marks every week of the season a playoff week, which looks like a
 * deliberate answer and is not one.
 */
function resolvePlayoffWeekStart(metadata: unknown): number {
  const settings = (metadata as { settings?: Record<string, unknown> } | null)
    ?.settings;
  const configured = Number(settings?.playoff_week_start);
  return Number.isFinite(configured) && configured > 0
    ? Math.trunc(configured)
    : 15;
}

/**
 * Land a `?week=` on a week that exists.
 *
 * A shared link can name week 20, a week the league skipped, or nothing at all,
 * and every one of those has to resolve to a board somebody can read. The
 * fallback order is the requested week, then the live week, then the nearest
 * stored week to whichever of the two was asked for, so an out-of-range request
 * lands next to what it meant instead of on an empty page.
 */
function clampWeek(board: ScheduleBoard, requested: number | null): number {
  const available = board.weeks.map((w) => w.week);
  if (available.length === 0) return board.currentWeek;
  const target = requested ?? board.currentWeek;
  if (available.includes(target)) return target;
  return available.reduce((best, week) =>
    Math.abs(week - target) < Math.abs(best - target) ? week : best,
  );
}

/**
 * Which team the team view opens on.
 *
 * The reader's own team first, matched on the Sleeper handle they searched
 * with, because that is the team they came to look at. A `?roster=` that names
 * a team this league does not have falls through to the same chain rather than
 * rendering an empty season.
 */
function resolveSelectedTeam(
  board: ScheduleBoard,
  requested: number | null,
  searchedUsername: string | null,
): ScheduleTeam | null {
  const byRequest =
    requested === null
      ? null
      : (board.teams.find((t) => t.sleeperRosterId === requested) ?? null);

  const handle = searchedUsername?.toLowerCase() ?? null;
  const byHandle =
    handle === null
      ? null
      : (board.teams.find(
          (t) => (t.ownerHandle ?? "").toLowerCase() === handle,
        ) ?? null);

  return byRequest ?? byHandle ?? board.teams[0] ?? null;
}

/**
 * Projected wins for one roster.
 *
 * The board does not carry it: it is a Power Pulse figure rather than a
 * schedule one, and loading it for twelve teams to show one would be a read
 * nobody looks at. TeamSeason renders "Power Pulse has not scored this league
 * yet" when it is null, which is a false statement on a league Power Pulse HAS
 * scored, so the one number for the one team on screen is worth one narrow
 * query rather than a null and a wrong sentence.
 */
async function loadProjectedWins(
  leagueRowId: string,
  season: number,
  rosterRowId: string,
): Promise<number | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("league_power_pulse_cache")
    .select("projected_wins")
    .eq("league_id", leagueRowId)
    .eq("season", season)
    .eq("roster_id", rosterRowId)
    .maybeSingle();
  const wins = Number(data?.projected_wins);
  return Number.isFinite(wins) ? wins : null;
}

/** One row per stored week for the team view, paired to that team's game. */
function buildSeasonRows(
  board: ScheduleBoard,
  sleeperRosterId: number,
): SeasonRow[] {
  return board.weeks.map((week) => ({
    week: week.week,
    isFinal: week.isFinal,
    isCurrent: week.isCurrent,
    isPlayoffWeek: week.isPlayoffWeek,
    matchup:
      week.matchups.find((m) => sidesFor(m, sleeperRosterId).self !== null) ??
      null,
  }));
}

function formatRelative(date: Date): string {
  const secs = Math.round((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return `${secs} seconds ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
