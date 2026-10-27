import type { Metadata } from "next";
import { Suspense, cache } from "react";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { resolveSleeperViewer } from "@/lib/sleeper-handle/resolve";
import { viewerLinkUsername } from "@/lib/sleeper-handle/types";
import { LEAGUE_CORE_COLUMNS, pulseLeagueCore, pulseLeagueDerived } from "@/lib/league-pulse";
import { resolveSourceSlug } from "@/lib/preferences";
import { resolveLeagueContext } from "@/lib/league-format-resolution";
import { loadLeagueHeaderActions } from "@/lib/league-header-data";
import { leagueMastheadProps } from "@/lib/league-masthead";
import { loadViewerCandidates } from "@/lib/league-positional-war-data";
import { matchViewerRoster } from "@/lib/league-viewer";
import { isWeekSettled, loadLeaderboardsCached } from "@/lib/league-leaderboards/load";
import type { LeaderboardsView } from "@/lib/league-leaderboards/types";
import { LeagueShell } from "@/components/league-shell";
import { Panel } from "@/components/dashboard-panel";
import { CopyImageButton } from "@/components/copy-image-button";
import { CopyLinkButton } from "@/components/copy-link-button";
import { withUsername } from "@/components/league-schedule/format";
import { Podium } from "@/components/league-leaderboards/podium";
import { PlayerBoard } from "@/components/league-leaderboards/player-board";
import { TopTier } from "@/components/league-leaderboards/top-tier";
import { OwnershipLegend } from "@/components/league-leaderboards/ownership-strip";
import { RangeNav } from "@/components/league-leaderboards/range-nav";
import { LIST_CLASS, LeaderRow, PlayerWeekRow } from "@/components/league-leaderboards/leader-row";
import { GameList, TeamScoreList, TeamTotalList } from "@/components/league-leaderboards/team-boards";
import { describeLeaderboards } from "@/lib/league-leaderboards/share";
import {
  boardImageHref,
  buildBoardShareCard,
  describeBoardShareCard,
  type ShareBoard,
} from "@/lib/league-leaderboards/board-share";
import type { SleeperLeague } from "@/lib/sleeper";

export const dynamic = "force-dynamic";

/**
 * The core sync and the league row, once per request, shared by
 * generateMetadata and the page. The sync is inside the cache for the reason
 * app/leagues/[league_id]/matchups/page.tsx gives: a league nobody has opened
 * does not exist in our tables until that call writes it.
 */
const getSyncedLeague = cache(async (sleeperLeagueId: string) => {
  const pulse = await pulseLeagueCore(createAdminClient(), sleeperLeagueId);
  if (!pulse.ok) return null;
  const league =
    pulse.league ??
    (
      await (await createClient())
        .from("leagues")
        .select(LEAGUE_CORE_COLUMNS)
        .eq("sleeper_league_id", sleeperLeagueId)
        .maybeSingle()
    ).data;
  return league ? { league, cached: pulse.cached } : null;
});

/**
 * The derived sync (it refreshes the matchup rows every list reads) and then
 * the view. Primitive arguments, so the body and anything else in the render
 * share one execution.
 */
const getView = cache(
  async (
    leagueRowId: string,
    season: number | null,
    resynced: boolean,
    week: number | null,
  ): Promise<LeaderboardsView | null> => {
    const admin = createAdminClient();
    // includePositionalWar: false. Nothing here draws a curve.
    await pulseLeagueDerived(admin, leagueRowId, { resynced, includePositionalWar: false });
    // A week that has not settled shows the season. Asking for it by number
    // would build the same season again and cache it under that week, so a
    // link to week 20 would cost a full season build per visit window.
    if (week !== null && season !== null && !(await isWeekSettled(leagueRowId, season, week))) {
      return loadLeaderboardsCached(leagueRowId, null);
    }
    return loadLeaderboardsCached(leagueRowId, week);
  },
);

function intOrNull(value: string | undefined): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 30 ? parsed : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league_id: string }>;
}): Promise<Metadata> {
  const { league_id } = await params;
  const synced = await getSyncedLeague(league_id);
  if (!synced) return { title: "League not found" };
  const league = synced.league;
  const title = `${league.name} Leaderboards`;
  const description = `Top scorers at every position in ${league.name}, rostered or not, the best single games, the highest team scores and the closest games of the season.`;
  const ogPath = `/api/og/leaderboards/${league_id}`;
  return {
    title,
    description,
    // Never indexed: it is about one league's members.
    robots: { index: false, follow: true },
    openGraph: { title, description, images: [{ url: ogPath, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, images: [ogPath] },
  };
}

export default async function LeagueLeaderboardsPage({
  params,
  searchParams,
}: {
  params: Promise<{ league_id: string }>;
  searchParams: Promise<{ week?: string; username?: string; source?: string }>;
}) {
  const { league_id: sleeperLeagueId } = await params;
  const sp = await searchParams;
  const requestedWeek = intOrNull(sp.week);

  const synced = await getSyncedLeague(sleeperLeagueId);
  if (!synced) notFound();
  const { league, cached: pulseCached } = synced;

  const supabase = await createClient();
  const viewer = await resolveSleeperViewer(supabase, sp.username);
  const linkUsername = viewerLinkUsername(viewer);

  const { otherLeagues } = await loadLeagueHeaderActions(
    supabase,
    league.id,
    sleeperLeagueId,
    viewer,
    league.season != null ? String(league.season) : null,
  );

  // The masthead shows the value source and format on every section, so the
  // resolver runs here too, even though nothing on this page is a value.
  const resolvedSource = await resolveSourceSlug(supabase, sp.source);
  const context = await resolveLeagueContext(
    createAdminClient(),
    league.metadata as unknown as SleeperLeague,
    resolvedSource.slug,
  );

  const homeHref = linkUsername
    ? `/tools/league-pulse?username=${encodeURIComponent(linkUsername)}`
    : "/tools/league-pulse";
  const leagueHref = withUsername(`/leagues/${sleeperLeagueId}`, linkUsername);

  return (
    <LeagueShell
      sleeperLeagueId={sleeperLeagueId}
      activeTab="leaderboards"
      viewer={viewer}
      homeHref={homeHref}
      crumbs={[{ label: league.name, href: leagueHref }, { label: "Leaderboards" }]}
      copyHref={`/leagues/${sleeperLeagueId}/leaderboards`}
      copyAriaLabel="Copy link to this league's leaderboards"
      otherLeagues={otherLeagues}
      masthead={leagueMastheadProps(league, context, pulseCached)}
    >
      <>
        {/* The masthead owns the h1 (the league name); the section heading is
            an h2. */}
        <section
          aria-labelledby="leaderboards-intro"
          className="relative overflow-hidden rounded-modal border border-line-accent p-5 sm:p-6"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.16) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.12) 0%, transparent 60%)",
          }}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              backgroundImage:
                "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
            }}
          />
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-cyan">Bragging rights</p>
          <h2 id="leaderboards-intro" className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Leaderboards
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            Every player who took the field, rostered or not, scored under your league&apos;s own settings.
            Each one says whose team he was on and when, so you can point at the one you got first.
          </p>
        </section>

        <Suspense fallback={<BodySkeleton />}>
          <LeaderboardsBody
            leagueRowId={league.id}
            season={league.season != null ? Number(league.season) : null}
            sleeperLeagueId={sleeperLeagueId}
            leagueName={league.name}
            resynced={!pulseCached}
            requestedWeek={requestedWeek}
            searchedUsername={viewer?.username ?? null}
            viewerSleeperUserId={viewer?.sleeperUserId ?? null}
            linkUsername={linkUsername}
          />
        </Suspense>
      </>
    </LeagueShell>
  );
}

async function LeaderboardsBody({
  leagueRowId,
  season,
  sleeperLeagueId,
  leagueName,
  resynced,
  requestedWeek,
  searchedUsername,
  viewerSleeperUserId,
  linkUsername,
}: {
  leagueRowId: string;
  season: number | null;
  sleeperLeagueId: string;
  leagueName: string;
  resynced: boolean;
  requestedWeek: number | null;
  searchedUsername: string | null;
  viewerSleeperUserId: string | null;
  linkUsername: string | null;
}) {
  const [view, candidates] = await Promise.all([
    getView(leagueRowId, season, resynced, requestedWeek),
    createClient().then((supabase) => loadViewerCandidates(supabase, leagueRowId)),
  ]);

  if (!view || view.settledWeeks.length === 0) {
    return (
      <div className="mt-6">
        <Panel eyebrow="Leaderboards" title="Nothing has settled yet">
          <p className="text-sm leading-relaxed text-ink-muted">
            Leaderboards count finished weeks only, so a Sunday in progress never shows up as a result.
            They fill in once week 1 is final in this league.
          </p>
        </Panel>
      </div>
    );
  }

  const viewerRosterId = matchViewerRoster(candidates, searchedUsername, null, viewerSleeperUserId);
  const { teams } = view;
  const isWeek = view.week !== null;
  const scopeLabel = isWeek ? `in week ${view.week}` : "this season";
  const scopeTitle = isWeek ? `Week ${view.week}` : "Season";
  const playoffWeek = isWeek && view.playoffWeekStart !== null && view.week! >= view.playoffWeekStart;
  const imageHref = `/api/og/leaderboards/${sleeperLeagueId}${isWeek ? `?week=${view.week}` : ""}`;
  const pageHref = withUsername(
    `/leagues/${sleeperLeagueId}/leaderboards${isWeek ? `?week=${view.week}` : ""}`,
    linkUsername,
  );
  // The builder falls back to the season for a week that has not settled, and
  // the reader is told rather than left wondering where their week went.
  const ignoredWeek = requestedWeek !== null && !isWeek;

  // One copy-image button per list, drawn by /api/og/leaderboards/[id]/[board].
  // Nothing is offered for a list with nothing on it.
  const shareButton = (board: ShareBoard, spoken: string) => {
    const card = buildBoardShareCard(view, board);
    if (!card || card.entries.length === 0) return undefined;
    return (
      <CopyImageButton
        size="sm"
        imageHref={boardImageHref(sleeperLeagueId, board, view.week)}
        description={describeBoardShareCard(card, leagueName)}
        ariaLabel={`Copy image: ${spoken} ${scopeLabel}, as a picture on the clipboard`}
      />
    );
  };
  // The points board switches position in the browser, so it gets every
  // position's link and sentence up front and its button follows the tab.
  const pointsShare = Object.fromEntries(
    (["ALL", ...view.positions] as const).map((key) => {
      const position = key === "ALL" ? null : key;
      const card = buildBoardShareCard(view, "points", position);
      return [
        key,
        card && card.entries.length > 0
          ? {
              imageHref: boardImageHref(sleeperLeagueId, "points", view.week, position),
              description: describeBoardShareCard(card, leagueName),
            }
          : null,
      ];
    }),
  );

  return (
    <div className="mt-6 space-y-6">
      <div className="space-y-3">
        <RangeNav
          sleeperLeagueId={sleeperLeagueId}
          weeks={view.settledWeeks}
          current={view.week}
          playoffWeekStart={view.playoffWeekStart}
          linkUsername={linkUsername}
        />
        {ignoredWeek && (
          <p role="status" className="text-xs text-ink-muted">
            Week {requestedWeek} has no final results in this league, so this shows the whole season.
          </p>
        )}
        <section
          aria-labelledby="leaderboards-share"
          className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface/50 px-3 py-2.5"
        >
          <h2 id="leaderboards-share" className="mr-1 text-[11px] font-bold uppercase tracking-[0.18em] text-ink-subtle">
            Share
          </h2>
          <CopyImageButton
            imageHref={imageHref}
            description={describeLeaderboards(view, leagueName)}
            ariaLabel={`Copy image: the ${scopeTitle.toLowerCase()} leaders for ${leagueName}, as a picture on the clipboard`}
          />
          <CopyLinkButton
            href={pageHref}
            icon="link"
            noun="Leaderboards link"
            label="Copy page link"
            size="md"
            ariaLabel={`Copy page link: a web address for these ${scopeTitle.toLowerCase()} leaderboards`}
          />
        </section>
      </div>

      <Panel
        eyebrow={playoffWeek ? `${scopeTitle}, playoffs` : scopeTitle}
        title={isWeek ? `The top three in week ${view.week}` : "The top three this season"}
        helper="Every position, rostered or not."
        glow
      >
        <Podium
          leaders={view.boards.all}
          teams={teams}
          viewerRosterId={viewerRosterId}
          label={isWeek ? `Top three scorers, week ${view.week}` : "Top three scorers this season"}
        />
      </Panel>

      <Panel
        eyebrow="The true board"
        title="Points leaders"
        helper={`Every player ${scopeLabel}, overall and by position. The tag says whose roster he is on today; the line under it, who had him before.`}
      >
        <PlayerBoard
          boards={view.boards}
          positions={view.positions}
          teams={teams}
          viewerRosterId={viewerRosterId}
          scopeLabel={scopeLabel}
          share={pointsShare}
        />
      </Panel>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Panel
          eyebrow="Still out there"
          title="Best players nobody owns"
          helper={`The top scorers ${scopeLabel} who are on no roster today.`}
          action={shareButton("unowned", "the best players nobody owns")}
        >
          {view.unowned.length === 0 ? (
            <p className="text-sm text-ink-muted">Every player who has scored is on somebody&apos;s roster.</p>
          ) : (
            <>
              <OwnershipLegend />
              <ol role="list" aria-label="Best players nobody owns" className={`mt-3 ${LIST_CLASS}`}>
              {view.unowned.slice(0, 10).map((leader) => (
                <LeaderRow
                  key={leader.player.sleeperId}
                  leader={leader}
                  teams={teams}
                  viewerRosterId={viewerRosterId}
                  leaderPoints={view.unowned[0].points}
                />
              ))}
              </ol>
            </>
          )}
        </Panel>

        <Panel
          eyebrow="Who has them"
          title="Most top players held"
          helper="The top X at each position, where X is the number of teams times that position's own starting slots. Flex slots do not count. Counted on today's rosters."
          action={shareButton("top-tier", "the teams holding the most top players")}
        >
          <TopTier
            cutoffs={view.topTier.cutoffs}
            rows={view.topTier.rows}
            teams={teams}
            viewerRosterId={viewerRosterId}
          />
        </Panel>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        {!isWeek && (
          <Panel
            eyebrow="Single games"
            title="Best player games"
            helper="The biggest one-week scores of the season, and whose team each one landed on."
            action={shareButton("best-games", "the best player games")}
          >
            <ol role="list" aria-label="Best player games this season" className={LIST_CLASS}>
              {view.bestWeeks.map((item, i) => (
                <PlayerWeekRow
                  key={`${item.player.sleeperId}-${item.week}`}
                  item={item}
                  rank={i + 1}
                  teams={teams}
                  viewerRosterId={viewerRosterId}
                />
              ))}
            </ol>
          </Panel>
        )}
        {view.showsBench && (
          <Panel
            eyebrow="Left on the bench"
            title="Bench heroes"
            helper={`The biggest games ${scopeLabel} that did not count, because the player was not in the lineup.`}
            action={shareButton("bench-heroes", "the bench heroes")}
          >
            {view.benchHeroes.length === 0 ? (
              <p className="text-sm text-ink-muted">Nobody scored a point from the bench {scopeLabel}.</p>
            ) : (
              <ol role="list" aria-label={`Bench heroes ${scopeLabel}`} className={LIST_CLASS}>
                {view.benchHeroes.map((item, i) => (
                  <PlayerWeekRow
                    key={`${item.player.sleeperId}-${item.week}`}
                    item={item}
                    rank={i + 1}
                    teams={teams}
                    viewerRosterId={viewerRosterId}
                    showStatus={false}
                  />
                ))}
              </ol>
            )}
          </Panel>
        )}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Panel eyebrow="Teams" title="Highest team scores" helper={`The best single weeks ${scopeLabel}.`} action={shareButton("team-highs", "the highest team scores")}>
          <TeamScoreList label="Highest team scores" scores={view.teamHighs} teams={teams} viewerRosterId={viewerRosterId} />
        </Panel>
        <Panel eyebrow="Teams" title="Lowest team scores" helper={`The quietest weeks ${scopeLabel}.`} action={shareButton("team-lows", "the lowest team scores")}>
          <TeamScoreList label="Lowest team scores" scores={view.teamLows} teams={teams} viewerRosterId={viewerRosterId} />
        </Panel>
        <Panel eyebrow="Teams" title="Most points scored" helper={`Total points ${scopeLabel}, playoff weeks included.`} action={shareButton("points-for", "every team's total points")}>
          <TeamTotalList
            label="Most points scored"
            totals={view.pointsFor}
            teams={teams}
            viewerRosterId={viewerRosterId}
            unit={() => "points"}
            depth={isWeek ? undefined : 10}
          />
        </Panel>
        {!isWeek && view.weeklyHighs.length > 0 && (
          <Panel
            eyebrow="Teams"
            title="Weekly high scores"
            helper="How many weeks each team posted the top score in the league. Ties count for everyone tied."
            action={shareButton("weekly-highs", "the weekly high score count for every team")}
          >
            <TeamTotalList
              label="Weekly high scores"
              totals={view.weeklyHighs}
              teams={teams}
              viewerRosterId={viewerRosterId}
              unit={(n) => (n === 1 ? "week" : "weeks")}
              decimals={false}
            />
          </Panel>
        )}
      </div>

      {view.games.blowouts.length > 0 && (
        <Panel eyebrow="Head to head" title="Games that stood out" helper="Open any game for both lineups.">
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
            {(
              [
                { title: "Biggest blowouts", games: view.games.blowouts, figure: "margin", board: "blowouts" },
                { title: "Closest games", games: view.games.closest, figure: "margin", board: "closest" },
                { title: "Most combined points", games: view.games.shootouts, figure: "combined", board: "shootouts" },
              ] as const
            ).map((list) => (
              <div key={list.title} className="min-w-0">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">{list.title}</h3>
                  {shareButton(list.board, `the ${list.title.toLowerCase()}`)}
                </div>
                <GameList
                  label={list.title}
                  games={list.games}
                  teams={teams}
                  viewerRosterId={viewerRosterId}
                  figure={list.figure}
                  sleeperLeagueId={sleeperLeagueId}
                  linkUsername={linkUsername}
                />
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel eyebrow="How this is counted" title="Where these numbers come from" headingLevel={2}>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-muted">
          <li>Only finished weeks count. Week {view.settledWeeks[view.settledWeeks.length - 1]} is the latest one final in this league.</li>
          <li>
            A week on a roster uses the points Sleeper credited in this league. A free agent week is scored from the
            player&apos;s stat line under this league&apos;s scoring settings, the same math Sleeper runs.
            {!view.scoresFreeAgents &&
              " This league's stored scoring settings could not be read, so free agent weeks are left out until they can."}
          </li>
          <li>
            Who had a player in a given week comes from that week&apos;s final roster in Sleeper, so trades, claims
            and drops land in the week they happened.
          </li>
          {view.showsBench && (
            <li>
              Bench heroes leave out players on injured reserve or the taxi squad, who could not have been started.
              Sleeper keeps no week by week record of those lists, so today&apos;s are used.
            </li>
          )}
          {view.playoffWeekStart !== null ? (
            <li>Playoff weeks (week {view.playoffWeekStart} on) are included and marked.</li>
          ) : (
            <li>This league has no playoff bracket, so no week is marked as one.</li>
          )}
        </ul>
      </Panel>
    </div>
  );
}

function BodySkeleton() {
  return (
    <div className="mt-6 space-y-6" aria-busy="true">
      <p role="status" className="text-sm text-ink-muted">
        Loading the leaderboards
      </p>
      <div className="h-11 animate-pulse rounded-full bg-surface/60 motion-reduce:animate-none" />
      <div className="h-64 animate-pulse rounded-modal bg-surface/60 motion-reduce:animate-none" />
      <div className="h-96 animate-pulse rounded-modal bg-surface/60 motion-reduce:animate-none" />
    </div>
  );
}
