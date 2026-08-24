import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { Suspense, cache } from "react";
import { notFound } from "next/navigation";
import { formatTeamLabel, ownerLine } from "@/lib/team-label";
import { createAdminClient, createClient } from "@/lib/supabase/server";
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
import { SleeperAvatar } from "@/components/sleeper-avatar";
import { MAX_MATCHUP_WEEK } from "@/lib/league-matchups";
import {
  loadMatchupDetail,
  loadScheduleBoard,
  resolveScheduleWeek,
} from "@/lib/league-schedule/data";
import type {
  MatchupSide,
  MatchupView,
  ScheduleBoard,
} from "@/lib/league-schedule/types";
import { MatchupTable } from "@/components/league-schedule/matchup-table";
import { WinProbBar } from "@/components/league-schedule/win-prob-bar";
import { BenchUpgrades } from "@/components/league-schedule/bench-upgrades";
import { ScheduleEmpty } from "@/components/league-schedule/schedule-empty";
import {
  CHIP,
  fmtPoints,
  recordLabel,
  withUsername,
} from "@/components/league-schedule/format";

export const dynamic = "force-dynamic";

/**
 * The largest roster number this route will look up.
 *
 * Sleeper roster ids are 1-based and dense, and the biggest league anybody
 * actually plays is well under this. The bound is not about the cost of one
 * lookup, which is two indexed queries resolved in memory. It is that
 * /api/og/matchup shares this key space and answers with `s-maxage=3600`, so an
 * unbounded id lets anyone mint an unlimited number of distinct URLs and park a
 * 404 image at each of them for an hour.
 */
const MAX_ROSTER_ID = 64;

/**
 * The core sync and the league row, once per request.
 *
 * generateMetadata and the page body are two separate calls into this module
 * for the same request, and both need this league. Cached, they share one
 * `pulseLeagueCore` and one select instead of racing to do both twice.
 *
 * THE SYNC HAS TO BE INSIDE THE CACHE, not beside it. The page reads the league
 * AFTER the core pulse deliberately: a league nobody has opened before does not
 * exist in our tables until that call writes it. A cached read that ran ahead
 * of the sync would return null, cache the null, and hand the page a 404 for a
 * league that was created two lines later.
 *
 * The select is the page's full column list rather than the three columns a
 * title needs, because a second narrower query is the thing this exists to
 * avoid.
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

/**
 * Both team names for the tab title and the share card.
 *
 * Narrow reads rather than the full detail loader, because a title needs two
 * strings and the loader projects sixty players. Every step is allowed to come
 * back empty: this route is the one people paste into a group chat, so a link
 * to a week that does not exist still has to produce a page rather than a crash
 * inside generateMetadata.
 *
 * Cached on its three primitives. generateMetadata is the only caller today,
 * but Next.js is free to invoke it more than once per request while it streams
 * metadata, and four queries per extra invocation is four too many.
 */
const loadMatchupTitle = cache(
  async (
    sleeperLeagueId: string,
    week: number,
    sleeperRosterId: number,
  ): Promise<{
    leagueName: string;
    home: string;
    away: string | null;
  } | null> => {
    const supabase = await createClient();
    const synced = await getSyncedLeague(sleeperLeagueId);
    if (!synced) return null;
    const league = synced.league;

    const { data: rows } = await supabase
      .from("league_matchups")
      .select("sleeper_roster_id, matchup_id")
      .eq("league_id", league.id)
      .eq("season", Number(league.season))
      .eq("week", week);

    const homeRow = (rows ?? []).find(
      (r) => Number(r.sleeper_roster_id) === sleeperRosterId,
    );
    if (!homeRow)
      return {
        leagueName: league.name,
        home: `Roster ${sleeperRosterId}`,
        away: null,
      };

    const awayRow =
      homeRow.matchup_id == null
        ? null
        : ((rows ?? []).find(
            (r) =>
              r.matchup_id === homeRow.matchup_id &&
              Number(r.sleeper_roster_id) !== sleeperRosterId,
          ) ?? null);

    const [rostersRes, usersRes] = await Promise.all([
      supabase
        .from("rosters")
        .select("sleeper_roster_id, owner_user_id")
        .eq("league_id", league.id),
      supabase
        .from("league_users")
        .select("sleeper_user_id, display_name, team_name")
        .eq("league_id", league.id),
    ]);

    const usersById = new Map(
      (usersRes.data ?? []).map((u) => [u.sleeper_user_id, u] as const),
    );
    const nameOf = (rosterId: number): string => {
      const roster = (rostersRes.data ?? []).find(
        (r) => Number(r.sleeper_roster_id) === rosterId,
      );
      const user = roster?.owner_user_id
        ? usersById.get(roster.owner_user_id)
        : null;
      return formatTeamLabel({
        teamName: user?.team_name,
        username: user?.display_name,
        sleeperRosterId: rosterId,
      });
    };

    return {
      leagueName: league.name,
      home: nameOf(sleeperRosterId),
      away: awayRow ? nameOf(Number(awayRow.sleeper_roster_id)) : null,
    };
  },
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league_id: string; week: string; roster_id: string }>;
}): Promise<Metadata> {
  const { league_id, week: weekParam, roster_id } = await params;
  const week = intOrNull(weekParam);
  const rosterId = intOrNull(roster_id);
  // Same bounds the page enforces. A title is not a reason to run four queries
  // for a roster number nobody could have.
  if (
    week === null ||
    week < 1 ||
    week > MAX_MATCHUP_WEEK ||
    rosterId === null ||
    rosterId < 1 ||
    rosterId > MAX_ROSTER_ID
  ) {
    return { title: "Matchup not found" };
  }

  const names = await loadMatchupTitle(league_id, week, rosterId);
  if (!names) return { title: "League not found" };

  const title = names.away
    ? `${names.home} vs ${names.away}, week ${week}`
    : `${names.home}, week ${week}`;
  const description = names.away
    ? `Both starting lineups for week ${week} of ${names.leagueName}, with projections, reliability, and the points sitting on each bench.`
    : `Week ${week} of ${names.leagueName}. ${names.home} has no opponent this week, so this is the lineup as set.`;
  const ogPath = `/api/og/matchup/${league_id}/${week}/${rosterId}`;
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

export default async function LeagueMatchupPage({
  params,
  searchParams,
}: {
  params: Promise<{ league_id: string; week: string; roster_id: string }>;
  searchParams: Promise<{ username?: string; source?: string }>;
}) {
  const {
    league_id: sleeperLeagueId,
    week: weekParam,
    roster_id: rosterParam,
  } = await params;
  const sp = await searchParams;
  const searchedUsername =
    typeof sp.username === "string" && sp.username.trim()
      ? sp.username.trim()
      : null;

  // A route segment is whatever somebody typed. Anything that is not a real
  // week or a real roster number is a 404 before a single query runs, rather
  // than a query with a NaN in it. Both ends are bounded: an unbounded roster
  // number is an endless supply of distinct URLs, and the share card for this
  // route carries an hour of CDN cache, so every one of them would be a
  // separate stored 404 image.
  const week = intOrNull(weekParam);
  const sleeperRosterId = intOrNull(rosterParam);
  if (week === null || week < 1 || week > MAX_MATCHUP_WEEK) notFound();
  if (
    sleeperRosterId === null ||
    sleeperRosterId < 1 ||
    sleeperRosterId > MAX_ROSTER_ID
  ) {
    notFound();
  }

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
  const scheduleHref = withUsername(
    `/leagues/${sleeperLeagueId}/schedules?view=week&week=${week}`,
    searchedUsername,
  );

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
    // The masthead hides these when coverage is "none", so this string is a
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
      crumbs={[
        { label: league.name, href: leagueHref },
        { label: "Schedule", href: scheduleHref },
        { label: `Week ${week}` },
      ]}
      copyHref={`/leagues/${sleeperLeagueId}/schedules/${week}/${sleeperRosterId}`}
      copyAriaLabel={`Copy link to this week ${week} matchup`}
      otherLeagues={otherLeagues}
      masthead={mastheadProps}
    >
      <Suspense fallback={<MatchupSkeleton week={week} />}>
        <MatchupBody
          leagueRowId={league.id}
          sleeperLeagueId={sleeperLeagueId}
          season={Number(league.season)}
          playoffWeekStart={resolvePlayoffWeekStart(league.metadata)}
          week={week}
          sleeperRosterId={sleeperRosterId}
          resynced={!pulseCached}
          searchedUsername={searchedUsername}
          scheduleHref={scheduleHref}
        />
      </Suspense>
    </LeagueShell>
  );
}

/**
 * The matchup itself, behind the derived sync.
 *
 * `resolveScheduleWeek` is called exactly once here and threaded into both
 * loaders. It wraps Sleeper's state endpoint, and calling it per loader would
 * make one page render two network requests for a number that cannot change
 * between them.
 */
async function MatchupBody({
  leagueRowId,
  sleeperLeagueId,
  season,
  playoffWeekStart,
  week,
  sleeperRosterId,
  resynced,
  searchedUsername,
  scheduleHref,
}: {
  leagueRowId: string;
  sleeperLeagueId: string;
  season: number;
  playoffWeekStart: number;
  week: number;
  sleeperRosterId: number;
  resynced: boolean;
  searchedUsername: string | null;
  scheduleHref: string;
}) {
  const admin = createAdminClient();
  await pulseLeagueDerived(admin, leagueRowId, { resynced });

  const supabase = await createClient();
  const currentWeek = await resolveScheduleWeek(season, playoffWeekStart);

  const [result, board] = await Promise.all([
    loadMatchupDetail(supabase, admin, {
      leagueRowId,
      season,
      week,
      sleeperRosterId,
      currentWeek,
    }),
    // The rail's two league-wide panels come from the same board the Schedule
    // page renders, which is four queries and no arithmetic. Deriving a season
    // series and a form line from it costs nothing beyond that one read.
    loadScheduleBoard(supabase, {
      leagueRowId,
      season,
      playoffWeekStart,
      currentWeek,
    }),
  ]);

  if (!result.ok) {
    return (
      <div className="space-y-6">
        {result.reason === "no-data" ? (
          <ScheduleEmpty kind="no-schedule" season={season} />
        ) : (
          // Named, not a generic 404. The league is real, the week is real, and
          // the roster is real; what is missing is a game between them, and a
          // reader who followed a shared link needs to be told which of those
          // four things did not line up.
          <Panel
            eyebrow="Schedule"
            title={`No game stored for roster ${sleeperRosterId} in week ${week}`}
            helper="The league and the week both exist. This pairing does not."
          >
            <div className="space-y-2 text-sm leading-relaxed text-ink-muted">
              <p>
                Sleeper has no row for this roster in week {week} of the{" "}
                {season} season. That happens when the roster number is not one
                this league uses, when the week has not been published, or when
                a shared link points at a different league&apos;s roster
                numbering.
              </p>
              <p>
                <Link
                  href={scheduleHref}
                  className="rounded-sm font-semibold text-brand-cyan underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  Back to week {week} on the schedule
                </Link>
              </p>
            </div>
          </Panel>
        )}
      </div>
    );
  }

  const view = result.view;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">
        {/* GETTING BACK OUT, without walking the breadcrumb.
            The crumb trail above says Schedules, and a crumb is a small target
            in a row of small targets that a reader has to go looking for. These
            two are the moves somebody actually wants from a matchup: back to the
            week they came from, or straight to one of these two teams' own
            seasons. Both carry the week and the roster, so neither lands on a
            default the reader has to correct. */}
        <nav aria-label="Back to the schedules" className="flex flex-wrap gap-2">
          <Link
            href={scheduleHref}
            className="inline-flex min-h-11 items-center gap-2 rounded-card border border-line-accent bg-surface px-3 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
            All week {week} matchups
          </Link>
          <Link
            href={withUsername(
              `/leagues/${sleeperLeagueId}/schedules?view=team&roster=${view.home.sleeperRosterId}`,
              searchedUsername,
            )}
            className="inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-surface/60 px-3 py-2 text-sm font-semibold text-ink-muted transition-colors hover:border-brand-cyan/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <CalendarDays aria-hidden="true" className="h-4 w-4" />
            {view.home.teamName} season
          </Link>
          {view.away !== null && (
            <Link
              href={withUsername(
                `/leagues/${sleeperLeagueId}/schedules?view=team&roster=${view.away.sleeperRosterId}`,
                searchedUsername,
              )}
              className="inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-surface/60 px-3 py-2 text-sm font-semibold text-ink-muted transition-colors hover:border-brand-cyan/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <CalendarDays aria-hidden="true" className="h-4 w-4" />
              {view.away.teamName} season
            </Link>
          )}
        </nav>

        <MatchupHeader view={view} />

        <Panel
          eyebrow="The lineups"
          title="Slot by slot"
          helper={
            view.isFinal
              ? "What each slot scored. Tap any player for the full numbers."
              : "Projected points in this league's scoring. Tap any player for the full numbers."
          }
          glow={view.isCurrent}
        >
          {/* The display order lives inside MatchupTable, which groups the
              paired rows by position block and sorts on the league's own slot
              order within each block. orderSlotsForDisplay is NOT applied here
              as well: sorting a list that is about to be regrouped changes
              nothing except the chance the two disagree. */}
          <MatchupTable view={view} />
        </Panel>

        <BenchUpgrades
          side={view.home}
          isFinal={view.isFinal}
          week={view.week}
        />
        {view.away && (
          <BenchUpgrades
            side={view.away}
            isFinal={view.isFinal}
            week={view.week}
          />
        )}
      </div>

      <aside
        aria-label="Matchup history and methodology"
        className="min-w-0 space-y-6 xl:sticky xl:top-[5.5rem] xl:self-start"
      >
        <SeasonSeriesPanel
          view={view}
          board={board}
          sleeperLeagueId={sleeperLeagueId}
          searchedUsername={searchedUsername}
        />
        <RecentFormPanel view={view} board={board} />
        <SourcesPanel />
      </aside>
    </div>
  );
}

/**
 * Both teams, the week, its state, the two totals, and the win probability.
 *
 * The heading is an h2: the masthead above owns this page's h1 (the league
 * name). Every number here appears as text, including both halves of the win
 * probability, so the bar under it is decoration and nothing else.
 */
function MatchupHeader({ view }: { view: MatchupView }) {
  const { home, away, isFinal, isCurrent, week } = view;
  const homeTotal = isFinal ? home.actualTotal : home.projectedTotal;
  const awayTotal = away
    ? isFinal
      ? away.actualTotal
      : away.projectedTotal
    : null;
  const homeProb = view.homeWinProb;

  const state = isFinal ? "Final" : isCurrent ? "This week" : "Upcoming";

  return (
    <section
      aria-labelledby="matchup-header"
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
        Week {week}, {state.toLowerCase()}
      </p>
      <h2
        id="matchup-header"
        className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl"
      >
        {away ? `${home.teamName} vs ${away.teamName}` : home.teamName}
      </h2>

      {/* THE TWO CARDS ARE THE SCOREBOARD.
          Each side gets its own tinted card, cyan on the left and purple on the
          right, matching the two ends of the win-probability bar directly below
          so the eye carries the same pairing from one to the other. The leading
          side is called out in a word as well as a tint, because a tint is not a
          label. `items-stretch` is the default in a grid, so two cards on one
          row share a height however long a team name runs. */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <SideSummary
          side={home}
          total={homeTotal}
          isFinal={isFinal}
          tone="home"
          leading={leadingSide(homeTotal, awayTotal) === "home"}
        />
        {away ? (
          <SideSummary
            side={away}
            total={awayTotal}
            isFinal={isFinal}
            tone="away"
            leading={leadingSide(homeTotal, awayTotal) === "away"}
          />
        ) : (
          <div className="rounded-card border border-line bg-base/40 px-3 py-3">
            <p className="text-sm font-semibold text-ink">No opponent</p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
              This league has an odd number of teams, so one roster sits out
              each week. The lineup below is the one that is set.
            </p>
          </div>
        )}
      </div>

      {away && homeProb !== null && (
        <div className="mt-4 rounded-card border border-line bg-base/40 p-3 sm:p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            Win chance
          </p>
          <div className="mt-2">
            <WinProbBar
              homeName={home.teamName}
              awayName={away.teamName}
              homeProb={homeProb}
            />
          </div>
        </div>
      )}

      {away && isFinal && (
        <p className="mt-3 text-sm text-ink-muted">
          This week is final, so there is no win chance left to report. The
          scores above are what happened.
        </p>
      )}
    </section>
  );
}

/**
 * Which side is ahead on the two totals, or neither.
 *
 * A missing total on either side is not a lead for the other one, and a tie is
 * not a lead at all. Both come back null and no side is marked.
 */
function leadingSide(
  home: number | null,
  away: number | null,
): "home" | "away" | null {
  if (home === null || away === null) return null;
  if (home === away) return null;
  return home > away ? "home" : "away";
}

/**
 * One team on the scoreboard.
 *
 * The number is the largest thing on the card and it sits under a word saying
 * what it is, so "Projected" and "Scored" are on the screen rather than only in
 * the accessible name. Record and Power Pulse rank ride along at every width,
 * because the card is where a reader decides whether the projection is a
 * surprise.
 */
function SideSummary({
  side,
  total,
  isFinal,
  tone,
  leading,
}: {
  side: MatchupSide;
  total: number | null;
  isFinal: boolean;
  /** Which end of the win-probability bar below this card belongs to. */
  tone: "home" | "away";
  /** True on the side with the higher total. Drives a word, not just a tint. */
  leading: boolean;
}) {
  const isHome = tone === "home";
  const accent = isHome ? "text-brand-cyan" : "text-brand-purple";
  const frame = isHome
    ? "border-brand-cyan/30 bg-brand-cyan/[0.05]"
    : "border-brand-purple/30 bg-brand-purple/[0.05]";
  const leadChip = isHome
    ? "border-brand-cyan/60 bg-brand-cyan/15 text-brand-cyan"
    : "border-brand-purple/60 bg-brand-purple/15 text-brand-purple";

  return (
    <div
      className={`relative flex h-full flex-col overflow-hidden rounded-card border p-3.5 sm:p-4 ${frame}`}
    >
      <div className="flex items-start gap-3">
        <SleeperAvatar
          avatarId={side.ownerAvatarId}
          title={side.teamName}
          size={44}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold leading-tight text-ink">
            {side.teamName}
          </p>
          {ownerLine(side.teamName, side.ownerHandle) && (
            <p className="truncate text-[11px] text-ink-subtle">
              {ownerLine(side.teamName, side.ownerHandle)}
            </p>
          )}
        </div>
        {leading && (
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${leadChip}`}
          >
            {isFinal ? "Won" : "Ahead"}
          </span>
        )}
      </div>

      <p className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className={CHIP}>
          <span className="sr-only">Record </span>
          {recordLabel(side.record)}
        </span>
        {side.pulseRank !== null && (
          <span className={CHIP}>Pulse #{side.pulseRank}</span>
        )}
      </p>

      <div className="mt-auto pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-subtle">
          {isFinal ? "Scored" : "Projected"}
        </p>
        {total === null ? (
          <p className="mt-0.5 text-sm text-ink-subtle">
            {isFinal ? "Not available" : "No projection"}
          </p>
        ) : (
          <p
            className={`mt-0.5 font-mono text-4xl font-extrabold leading-none tabular-nums sm:text-5xl ${accent}`}
          >
            {fmtPoints(total)}
            <span className="sr-only"> points</span>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Every week these two meet, and what happened in the ones already played.
 *
 * Read off the board rather than recomputed, so this panel and the Schedule
 * page can never disagree about how many times a pairing appears.
 */
function SeasonSeriesPanel({
  view,
  board,
  sleeperLeagueId,
  searchedUsername,
}: {
  view: MatchupView;
  board: ScheduleBoard;
  sleeperLeagueId: string;
  searchedUsername: string | null;
}) {
  const away = view.away;
  if (!away) {
    return (
      <Panel
        eyebrow="History"
        title="Season series"
        helper="A series needs two teams."
      >
        <p className="text-sm leading-relaxed text-ink-muted">
          {view.home.teamName} is unpaired in week {view.week}, so there is no
          opponent to have a record against.
        </p>
      </Panel>
    );
  }

  const meetings = board.weeks
    .flatMap((w) => w.matchups)
    .filter(
      (m) =>
        m.away !== null &&
        [m.home.sleeperRosterId, m.away.sleeperRosterId].includes(
          view.home.sleeperRosterId,
        ) &&
        [m.home.sleeperRosterId, m.away.sleeperRosterId].includes(
          away.sleeperRosterId,
        ),
    );

  const played = meetings.filter((m) => m.isFinal);
  const homeWins = played.filter((m) =>
    m.home.sleeperRosterId === view.home.sleeperRosterId
      ? m.home.won
      : m.away?.won,
  ).length;
  const awayWins = played.filter((m) =>
    m.home.sleeperRosterId === away.sleeperRosterId ? m.home.won : m.away?.won,
  ).length;

  return (
    <Panel
      eyebrow="History"
      title="Season series"
      helper={
        meetings.length === 0
          ? "No stored meetings between these two."
          : `These two meet ${meetings.length} ${meetings.length === 1 ? "time" : "times"} this season.`
      }
    >
      {meetings.length === 0 ? (
        <p className="text-sm leading-relaxed text-ink-muted">
          The slate on file does not pair {view.home.teamName} with{" "}
          {away.teamName} in any week, including this one. That is a gap in the
          schedule rather than a claim about the league.
        </p>
      ) : (
        <>
          <p className="text-sm text-ink-muted">
            {played.length === 0
              ? "None of those games have been played yet."
              : `${view.home.teamName} ${homeWins}, ${away.teamName} ${awayWins} in the ${played.length} played so far.`}
          </p>
          <ul role="list" className="mt-3 space-y-2">
            {meetings.map((m) => {
              const selfSide =
                m.home.sleeperRosterId === view.home.sleeperRosterId
                  ? m.home
                  : m.away;
              const otherSide =
                m.home.sleeperRosterId === view.home.sleeperRosterId
                  ? m.away
                  : m.home;
              const href = withUsername(
                `/leagues/${sleeperLeagueId}/schedules/${m.week}/${view.home.sleeperRosterId}`,
                searchedUsername,
              );
              return (
                <li
                  key={m.week}
                  className="rounded-card border border-line bg-base/40 px-3 py-2"
                >
                  <p className="text-xs font-semibold text-ink">
                    <Link
                      href={href}
                      className="rounded-sm hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                    >
                      Week {m.week}
                      {m.week === view.week ? " (this one)" : ""}
                    </Link>
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">
                    {m.isFinal
                      ? selfSide?.actual === null ||
                        selfSide?.actual === undefined ||
                        otherSide?.actual === null ||
                        otherSide?.actual === undefined
                        ? "Final, scores not stored."
                        : `Final: ${view.home.teamName} ${fmtPoints(selfSide.actual)}, ${away.teamName} ${fmtPoints(otherSide.actual)}.`
                      : "Not played yet."}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Panel>
  );
}

/** The last three settled weeks for each side, as results rather than a streak. */
function RecentFormPanel({
  view,
  board,
}: {
  view: MatchupView;
  board: ScheduleBoard;
}) {
  const sides = [view.home, view.away].filter(
    (side): side is MatchupSide => side !== null,
  );
  const anyFinal = board.weeks.some((w) => w.isFinal);

  return (
    <Panel
      eyebrow="Form"
      title="Last three weeks"
      helper="Finished weeks, newest first."
    >
      {!anyFinal ? (
        <p className="text-sm leading-relaxed text-ink-muted">
          No week on this slate has been played, so neither team has form to
          report yet.
        </p>
      ) : (
        <dl className="space-y-3">
          {sides.map((side) => {
            const results = recentResults(board, side.sleeperRosterId, 3);
            return (
              <div key={side.sleeperRosterId}>
                <dt className="truncate text-xs font-semibold text-ink">
                  {side.teamName}
                </dt>
                <dd className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">
                  {results.length === 0
                    ? "No settled games on this roster's slate."
                    : results
                        .map(
                          (r) =>
                            `Week ${r.week}: ${r.outcome}${
                              r.points === null || r.opponentPoints === null
                                ? ""
                                : `, ${fmtPoints(r.points)} to ${fmtPoints(r.opponentPoints)}`
                            }`,
                        )
                        .join(". ") + "."}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </Panel>
  );
}

/**
 * The most recent settled weeks for one roster.
 *
 * The outcome is a word, never a colour and never a letter on its own: "won",
 * "lost", "tied", and "no opponent" for the week an odd league leaves a roster
 * out. A missing score reports as a missing score rather than as a zero.
 */
function recentResults(
  board: ScheduleBoard,
  sleeperRosterId: number,
  limit: number,
): {
  week: number;
  outcome: string;
  points: number | null;
  opponentPoints: number | null;
}[] {
  const out: {
    week: number;
    outcome: string;
    points: number | null;
    opponentPoints: number | null;
  }[] = [];

  for (const week of [...board.weeks].reverse()) {
    if (!week.isFinal) continue;
    for (const matchup of week.matchups) {
      const isHome = matchup.home.sleeperRosterId === sleeperRosterId;
      const isAway = matchup.away?.sleeperRosterId === sleeperRosterId;
      if (!isHome && !isAway) continue;
      const self = isHome ? matchup.home : matchup.away;
      const other = isHome ? matchup.away : matchup.home;
      if (!self) continue;
      if (!other) {
        out.push({
          week: week.week,
          outcome: "no opponent",
          points: self.actual,
          opponentPoints: null,
        });
        break;
      }
      const outcome =
        self.actual === null || other.actual === null
          ? "result not stored"
          : self.actual > other.actual
            ? "won"
            : self.actual < other.actual
              ? "lost"
              : "tied";
      out.push({
        week: week.week,
        outcome,
        points: self.actual,
        opponentPoints: other.actual,
      });
      break;
    }
    if (out.length >= limit) break;
  }

  return out.slice(0, limit);
}

/** Where every number on this page comes from, named. */
function SourcesPanel() {
  return (
    <Panel
      eyebrow="Provenance"
      title="How this is built"
      helper="Where each number comes from."
    >
      <dl className="space-y-3 text-xs leading-relaxed">
        <div>
          <dt className="font-semibold text-ink">The lineups</dt>
          <dd className="mt-0.5 text-ink-muted">
            Sleeper&apos;s own starters array, read against this league&apos;s
            roster positions in their published order, so slot 4 is the slot the
            manager filled fourth.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Projections</dt>
          <dd className="mt-0.5 text-ink-muted">
            Sleeper&apos;s weekly player projections, rescored under this
            league&apos;s literal scoring settings.
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
            How often each player has met their own projection, and how often
            they were available at all.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Trade values</dt>
          <dd className="mt-0.5 text-ink-muted">
            Not used here. A lineup is scored on points, not on what it would
            fetch in a trade.
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

function MatchupSkeleton({ week }: { week: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-modal border border-line bg-surface/50 p-6"
    >
      <p className="text-sm text-ink-muted">Loading the week {week} matchup</p>
      <div aria-hidden="true" className="mt-4 space-y-2">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded-card bg-base/60" />
        ))}
      </div>
    </div>
  );
}

/** A base-10 integer from a route segment, or null. Never NaN, never a float. */
function intOrNull(value: string | undefined): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

/**
 * The league's own playoff cut line.
 *
 * Same rule lib/power-pulse/load.ts applies: Sleeper writes
 * `playoff_week_start: 0` on a league whose bracket has not been set up, and
 * zero is a number, so a plain `?? 15` never fires. A cut line at week zero
 * marks the whole season a playoff week, which looks deliberate and is not.
 */
function resolvePlayoffWeekStart(metadata: unknown): number {
  const settings = (metadata as { settings?: Record<string, unknown> } | null)
    ?.settings;
  const configured = Number(settings?.playoff_week_start);
  return Number.isFinite(configured) && configured > 0
    ? Math.trunc(configured)
    : 15;
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
