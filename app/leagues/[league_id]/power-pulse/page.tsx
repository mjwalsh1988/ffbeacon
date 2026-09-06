import type { Metadata } from "next";
import { Suspense, cache } from "react";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { resolveSleeperViewer } from "@/lib/sleeper-handle/resolve";
import { viewerLinkUsername } from "@/lib/sleeper-handle/types";
import { pulseLeagueCore, pulseLeagueDerived } from "@/lib/league-pulse";
import { resolveSourceSlug } from "@/lib/preferences";
import {
  resolveLeagueContext,
  describeDerived,
} from "@/lib/league-format-resolution";
import { loadLeagueHeaderActions } from "@/lib/league-header-data";
import {
  buildPulseLeaders,
  loadPowerPulseView,
} from "@/lib/league-power-pulse-data";
import {
  describeLeagueScoring,
  type ScoringSettings,
} from "@/lib/league-scoring";
import {
  buildLeagueFormatTags,
  buildLeagueScoringTags,
} from "@/lib/league-format-tags";
import { LeagueShell } from "@/components/league-shell";
import type { LeagueMastheadProps } from "@/components/league-shell";
import { Panel } from "@/components/dashboard-panel";
import { PulseRankingsTable } from "@/components/power-pulse/pulse-rankings-table";
import { PulseLeaders } from "@/components/power-pulse/pulse-leaders";
import { ProjectedStandings } from "@/components/power-pulse/projected-standings";
import { ProjectedChampion } from "@/components/power-pulse/projected-champion";
import { PositionalWarSection } from "@/components/league-war/positional-war-section";
import { HowPowerPulseWorks } from "@/components/power-pulse/how-power-pulse-works";
import { PreDraftNotice } from "@/components/power-pulse/pre-draft-notice";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { loadLeagueReadiness } from "@/lib/league-readiness";
import { loadLeagueTeamCards } from "@/lib/league-view-data";
import { formatEastern } from "@/lib/datetime";
import {
  emphasisForCategory,
  type LeagueEmphasis,
} from "@/lib/league-emphasis";
import { categorizeLeague } from "@/lib/league-category";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league_id: string }>;
}): Promise<Metadata> {
  const { league_id } = await params;
  const supabase = await createClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("name")
    .eq("sleeper_league_id", league_id)
    .maybeSingle();
  if (!league) return { title: "League not found" };

  const title = `${league.name} Power Pulse`;
  const description = `Projected standings, playoff odds, and expected performance for every team in ${league.name}.`;
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

export default async function LeaguePowerPulsePage({
  params,
  searchParams,
}: {
  params: Promise<{ league_id: string }>;
  searchParams: Promise<{ source?: string; username?: string; war?: string }>;
}) {
  const { league_id: sleeperLeagueId } = await params;
  const sp = await searchParams;
  // Core pulse only: the league, its rosters and its members. The derived half
  // is what computes Power Pulse when it is stale, and that is the slow part, so
  // it runs inside the Suspense boundaries below and the header, tabs and intro
  // paint without waiting for it.
  const adminClient = createAdminClient();
  const pulseResult = await pulseLeagueCore(adminClient, sleeperLeagueId);
  if (!pulseResult.ok) notFound();

  const supabase = await createClient();

  // Who this page is acting for: the ?username= handle when there is one,
  // otherwise the reader's own saved handle (lib/sleeper-handle/resolve.ts).
  // `linkUsername` is what a link built on this page may carry, which is the
  // handle only when the reader arrived on one.
  const viewer = await resolveSleeperViewer(supabase, sp.username);
  const searchedUsername = viewer?.username ?? null;
  const linkUsername = viewerLinkUsername(viewer);
  const { data: league } = await supabase
    .from("leagues")
    .select(
      "id, sleeper_league_id, name, season, status, total_rosters, last_pulsed_at, roster_positions, scoring_settings, metadata, power_pulse_status, power_pulse_detail",
    )
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (!league) notFound();

  const { otherLeagues } = await loadLeagueHeaderActions(
    supabase,
    league.id,
    sleeperLeagueId,
    viewer,
    league.season != null ? String(league.season) : null,
  );

  // No handle on either link for a saved reader: /tools/league-pulse resolves
  // the same identity itself, and the deep view matches on the Sleeper user id.
  const homeHref = linkUsername
    ? `/tools/league-pulse?username=${encodeURIComponent(linkUsername)}`
    : "/tools/league-pulse";
  const leagueHref = linkUsername
    ? `/leagues/${sleeperLeagueId}?username=${encodeURIComponent(linkUsername)}`
    : `/leagues/${sleeperLeagueId}`;

  // Format is derived from the league's own Sleeper settings; only the value
  // source respects the user's pick (CLAUDE.md: League Pulse Format Resolution).
  // Power Pulse itself does not use either, but the value-rank comparison does.
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

  // Which number this league's readers came for. The ordering is Power Pulse
  // either way; this decides what the value column is CALLED, because in a
  // redraft league it is a bargaining position rather than a standing.
  const emphasis = emphasisForCategory(
    sleeperLeague ? categorizeLeague(sleeperLeague as never) : null,
  );

  const settings =
    (league.metadata as { settings?: Record<string, number> } | null)
      ?.settings ?? {};
  // Same rule the engine applies in lib/power-pulse/load.ts: Sleeper leaves this
  // at zero on a league whose bracket is not set up, and a cut line drawn at
  // seed zero would tell every team it misses the playoffs while the simulation
  // behind the odds assumed a six-team field.
  const configuredPlayoffTeams = Number(settings.playoff_teams);
  const playoffTeams =
    Number.isFinite(configuredPlayoffTeams) && configuredPlayoffTeams > 0
      ? configuredPlayoffTeams
      : 6;

  const scoringDescription = describeLeagueScoring(
    (league.scoring_settings ?? {}) as ScoringSettings,
  );

  // Shared league identity, rendered by the shell as the masthead above
  // whatever this section shows.
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
    avatarId: sleeperLeague.avatar ?? null,
    season: league.season ?? null,
    teamCount: league.total_rosters ?? null,
    status: league.status ?? null,
    formatTags,
    scoringTags,
    lastUpdatedLabel: lastPulsed ? formatRelative(lastPulsed) : "never",
    cached: pulseResult.cached,
    coverage: context.coverage,
    sourceDisplay: coverageOk ? context.sourceDisplay : "N/A",
    formatDisplay: coverageOk ? context.formatDisplay : "N/A",
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

  const valueLabel = coverageOk
    ? `${context.formatDisplay} via ${context.sourceDisplay}`
    : null;

  return (
    <LeagueShell
      sleeperLeagueId={sleeperLeagueId}
      activeTab="power-pulse"
      viewer={viewer}
      homeHref={homeHref}
      crumbs={[
        { label: league.name, href: leagueHref },
        { label: "Power Pulse" },
      ]}
      copyHref={`/leagues/${sleeperLeagueId}/power-pulse`}
      copyAriaLabel="Copy link to this league's Power Pulse"
      otherLeagues={otherLeagues}
      masthead={mastheadProps}
    >
      <>
        {/* Feature intro strip. Sets expectations before any number appears,
            and states the one thing Power Pulse ignores. The heading is an h2:
            the masthead above owns this page's h1 (the league name). */}
        <section
          aria-labelledby="pp-intro"
          className="relative overflow-hidden rounded-modal border border-line-accent p-5 sm:p-6"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.13) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.10) 0%, transparent 60%)",
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
          {/* The masthead above already says League Pulse, so this eyebrow
              names what the section measures instead of repeating the brand. */}
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-cyan">
            Expected performance
          </p>
          <h2
            id="pp-intro"
            className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl"
          >
            Power Pulse
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            Other rankings add up what your roster is worth. This one projects
            what it will do: your best lineup each week, under your league's
            scoring, against your real schedule.
          </p>
          <Suspense fallback={null}>
            <IntroChips
              leagueRowId={league.id}
              season={Number(league.season)}
              status={league.status ?? null}
              formatConfigId={coverageOk ? context.formatConfigId : null}
              sourceSlug={coverageOk ? context.sourceSlug : null}
              resynced={!pulseResult.cached}
              scoringDescription={scoringDescription}
            />
          </Suspense>
        </section>

        <Suspense fallback={<PulseBodySkeleton />}>
          <PowerPulseBody
            leagueRowId={league.id}
            sleeperLeagueId={sleeperLeagueId}
            leagueName={league.name}
            season={Number(league.season)}
            seasonLabel={league.season}
            status={league.status ?? null}
            formatConfigId={coverageOk ? context.formatConfigId : null}
            sourceSlug={coverageOk ? context.sourceSlug : null}
            resynced={!pulseResult.cached}
            searchedUsername={searchedUsername}
            viewerSleeperUserId={viewer?.sleeperUserId ?? null}
            linkUsername={linkUsername}
            scoringDescription={scoringDescription}
            playoffTeams={playoffTeams}
            valueLabel={valueLabel}
            emphasis={emphasis}
            powerPulseStatus={league.power_pulse_status ?? null}
            powerPulseDetail={league.power_pulse_detail ?? null}
            teamCount={league.total_rosters ?? 0}
            rosterPositions={
              Array.isArray(league.roster_positions)
                ? (league.roster_positions as unknown[]).filter(
                    (t): t is string => typeof t === "string",
                  )
                : []
            }
            scoringSettings={(league.scoring_settings ?? {}) as ScoringSettings}
          />
        </Suspense>
      </>
    </LeagueShell>
  );
}

/**
 * The chips under the intro heading. Their own boundary because every number on
 * them comes from the Power Pulse cache, and the heading above them should not
 * wait on a recompute to appear.
 */
async function IntroChips({
  leagueRowId,
  season,
  status,
  formatConfigId,
  sourceSlug,
  resynced,
  scoringDescription,
}: {
  leagueRowId: string;
  season: number;
  status: string | null;
  formatConfigId: string | null;
  sourceSlug: string | null;
  resynced: boolean;
  scoringDescription: string;
}) {
  const { view } = await getPulseData(
    leagueRowId,
    season,
    status,
    formatConfigId,
    sourceSlug,
    resynced,
  );
  if (!view) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <Chip
        label={
          view.preseason ? "Preseason" : `Through week ${view.throughWeek}`
        }
        accent
      />
      <Chip label={`${view.teams.length} teams`} />
      <Chip label={scoringDescription} />
      {view.generatedAt && (
        <Chip label={`Updated ${formatEastern(view.generatedAt)}`} />
      )}
    </div>
  );
}

/**
 * Everything below the intro strip: the waiting states and the full ranking.
 *
 * All three branches need the derived pulse, so the branch itself is chosen in
 * here rather than in the shell. getPulseData is React-cached, so this boundary
 * and the chips above share one read and one sync.
 */
async function PowerPulseBody({
  leagueRowId,
  sleeperLeagueId,
  leagueName,
  season,
  seasonLabel,
  status,
  formatConfigId,
  sourceSlug,
  resynced,
  searchedUsername,
  viewerSleeperUserId,
  linkUsername,
  scoringDescription,
  playoffTeams,
  valueLabel,
  emphasis,
  powerPulseStatus,
  powerPulseDetail,
  teamCount,
  rosterPositions,
  scoringSettings,
}: {
  leagueRowId: string;
  sleeperLeagueId: string;
  leagueName: string;
  season: number;
  seasonLabel: string | number | null;
  status: string | null;
  formatConfigId: string | null;
  sourceSlug: string | null;
  resynced: boolean;
  searchedUsername: string | null;
  /** The viewer's Sleeper user id, tried before the handle: a saved handle is
   *  a Sleeper username while the candidates carry display names. */
  viewerSleeperUserId: string | null;
  /** The handle links inside this section may carry, or null. */
  linkUsername: string | null;
  scoringDescription: string;
  playoffTeams: number;
  valueLabel: string | null;
  /** Whether this league reads value as a standing or as trade leverage. */
  emphasis: LeagueEmphasis;
  powerPulseStatus: string | null;
  powerPulseDetail: string | null;
  /** For the Positional WAR panel's copy and footnote. */
  teamCount: number;
  rosterPositions: string[];
  scoringSettings: ScoringSettings;
  /** The raw `?war=` searchParam value, for the axis toggle. */
}) {
  const { readiness, view } = await getPulseData(
    leagueRowId,
    season,
    status,
    formatConfigId,
    sourceSlug,
    resynced,
  );

  // The roster list is only needed for the waiting state, where it is the
  // whole point: the reader still gets to see who is in the league.
  const supabase = await createClient();
  const pulseSettings = await loadPowerPulseSettings(createAdminClient());
  const preDraftTeams = readiness.preDraft
    ? (
        await loadLeagueTeamCards(
          supabase,
          leagueRowId,
          null,
          null,
          seasonLabel != null ? String(seasonLabel) : null,
          status,
          false,
        )
      ).map((t) => ({
        rosterRowId: t.rosterRowId,
        sleeperRosterId: t.sleeperRosterId,
        teamName: t.teamName,
        ownerHandle: t.ownerSleeperUsername,
        ownerAvatarId: t.ownerAvatarId,
      }))
    : [];

  return (
    <>
      {readiness.preDraft ? (
        <div className="mt-6 space-y-6">
          <PreDraftNotice
            readiness={readiness}
            teams={preDraftTeams}
            season={seasonLabel}
          />
        </div>
      ) : !view ? (
        <div className="mt-6">
          <PowerPulseEmptyState
            status={powerPulseStatus}
            detail={powerPulseDetail}
          />
        </div>
      ) : (
        // Rail on the RIGHT, matching the overview tab. The masthead above
        // already names the league on every section, so what is left in the
        // rail is supplementary and reads better after the rankings when the
        // grid collapses to one column on a phone.
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          {/* Main column: the rankings, then who those rankings say wins,
                  then the standings and the awards. The champion sits between
                  the ranking and the projected finish because it is the bridge
                  between them: the table shows the order, the card argues what
                  that order means. */}
          <div className="min-w-0 space-y-6">
            <Panel
              eyebrow="The ranking"
              title="Power Pulse rankings"
              helper="Ranked by expected performance. The value column compares that to each team's trade-value rank."
              bodyClassName="p-0"
              glow
            >
              <PulseRankingsTable
                teams={view.teams}
                sleeperLeagueId={sleeperLeagueId}
                linkUsername={linkUsername}
                valueLabel={valueLabel}
                emphasis={emphasis}
              />
            </Panel>

            <ProjectedChampion
              teams={view.teams}
              simulationRuns={pulseSettings.simulation.runs}
            />

            {/* The same panel and the same cached rows as the overview.
                    This page is its better second home: the rail already
                    carries HowPowerPulseWorks, which is where model
                    explanation belongs, and a reader who came here to
                    understand what drives a projection is the reader most
                    likely to want to know where the scarcity is.

                    Its own Suspense boundary, so a missing curve never blocks
                    the standings below it. */}
            <Suspense fallback={<WarSkeleton />}>
              <PositionalWarBlock
                leagueRowId={leagueRowId}
                leagueName={leagueName}
                season={season}
                teamCount={teamCount}
                rosterPositions={rosterPositions}
                scoringSettings={scoringSettings}
                searchedUsername={searchedUsername}
                viewerSleeperUserId={viewerSleeperUserId}
                exploreHref={
                  linkUsername
                    ? `/leagues/${sleeperLeagueId}/positional-war?username=${encodeURIComponent(linkUsername)}`
                    : `/leagues/${sleeperLeagueId}/positional-war`
                }
              />
            </Suspense>

            {/* "Regular season" is doing real work in this title. The
                    champion card above ranks by title odds, which are decided in
                    the bracket, and the two orders legitimately disagree: a team
                    can lead this table on the back of an easy schedule and still
                    not be the favorite, because the playoffs only pit it against
                    the other qualifiers. Without the qualifier a reader sees
                    themselves first here, somebody else named champion above,
                    and no way to tell which one is wrong. Neither is. */}
            <Panel
              eyebrow="Where this ends up"
              title="Projected final regular season standings"
              helper={`Ordered by expected wins, so a hard schedule can drop a strong roster below the ${playoffTeams}-team cut.`}
              bodyClassName="p-0"
            >
              <ProjectedStandings
                teams={view.teams}
                playoffTeams={playoffTeams}
              />
            </Panel>

            <Panel
              eyebrow="Superlatives"
              title="League leaders"
              helper="The things a rankings table cannot tell you."
            >
              <PulseLeaders leaders={buildPulseLeaders(view.teams)} />
            </Panel>
          </div>

          {/* Right rail: the numbers behind the numbers, and how they were
                  reached. */}
          <aside
            aria-label="League snapshot and methodology"
            className="space-y-6 xl:sticky xl:top-[5.5rem] xl:self-start"
          >
            <HowPowerPulseWorks
              scoringDescription={scoringDescription}
              preseason={view.preseason}
            />
          </aside>
        </div>
      )}
    </>
  );
}

/**
 * One read of everything the two boundaries below the intro need.
 *
 * React's cache() dedupes it across them for a single render, so the chips and
 * the body share one derived sync and one view read instead of racing to do
 * both twice. Every argument is a primitive, which is what makes the cache key
 * match between the two call sites.
 */
const getPulseData = cache(
  async (
    leagueRowId: string,
    season: number,
    status: string | null,
    formatConfigId: string | null,
    sourceSlug: string | null,
    resynced: boolean,
  ) => {
    await pulseLeagueDerived(createAdminClient(), leagueRowId, { resynced });
    const supabase = await createClient();
    // Readiness first: a league that has not drafted, or that Sleeper has not
    // paired up yet, has no honest numbers to show and gets the waiting state
    // instead of a table of zeroes. See lib/league-readiness.ts.
    const readiness = await loadLeagueReadiness(
      supabase,
      leagueRowId,
      season,
      status,
    );
    const view = readiness.preDraft
      ? null
      : await loadPowerPulseView(
          supabase,
          leagueRowId,
          season,
          formatConfigId,
          sourceSlug,
        );
    return { readiness, view };
  },
);

/**
 * Stand-in for the ranking while the derived sync finishes. Announced politely
 * so a screen reader hears that work is in progress rather than sitting on
 * silence.
 */
function PulseBodySkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-6 rounded-modal border border-line bg-surface/50 p-6"
    >
      <p className="text-sm text-ink-muted">Loading Power Pulse</p>
      <div aria-hidden="true" className="mt-4 space-y-2">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded-card bg-base/60" />
        ))}
      </div>
    </div>
  );
}

/**
 * What a reader sees when Power Pulse has no view to render and the league is
 * past the draft (the pre-draft case is handled earlier by PreDraftNotice).
 * One fixed sentence per power_pulse_status, never the raw detail: the detail
 * is server-written and holds no secrets, but a plain status-based sentence
 * is the honest answer for a non-admin reader, and the raw string belongs on
 * the admin surface (/admin/system/league-health) instead.
 */
function PowerPulseEmptyState({
  status,
  detail,
}: {
  status: string | null;
  detail: string | null;
}) {
  if (status === "error") {
    return (
      <Panel
        eyebrow="Refresh incomplete"
        title="The last refresh did not complete"
        helper="This retries automatically."
      >
        <p className="text-sm text-ink-muted">
          Something interrupted the last Power Pulse calculation for this
          league. Check back in a few minutes, or reload the page.
        </p>
      </Panel>
    );
  }

  if (status === "settled") {
    const seasonOver =
      detail?.startsWith("no regular season games remaining") ?? false;
    if (seasonOver) {
      return (
        <Panel
          eyebrow="Season complete"
          title="The regular season is over"
          helper="There is nothing left to project."
        >
          <p className="text-sm text-ink-muted">
            Every regular season game for this league has been played, so Power
            Pulse has no remaining schedule to score.
          </p>
        </Panel>
      );
    }
    return (
      <Panel
        eyebrow="Waiting on a schedule"
        title="No schedule to project yet"
        helper="Power Pulse needs a published matchup schedule."
      >
        <p className="text-sm text-ink-muted">
          This league does not have a schedule published yet. Once one posts,
          Power Pulse picks it up on the next sync.
        </p>
      </Panel>
    );
  }

  if (status === "skipped") {
    return (
      <Panel
        eyebrow="Waiting on data"
        title="Power Pulse needs a little more data"
        helper="The next sync brings what's missing."
      >
        <p className="text-sm text-ink-muted">
          Sleeper has not published everything this needs yet: rosters, weekly
          projections, or this week's schedule. Nothing is broken, check back
          after the next sync.
        </p>
      </Panel>
    );
  }

  // 'pending', null, or any other value: the normal first-attempt state.
  return (
    <Panel
      eyebrow="Building"
      title="Power Pulse is still calculating"
      helper="This runs on the first load after a league syncs."
    >
      <p className="text-sm text-ink-muted">
        We need Sleeper's weekly projections and this league's schedule first.
        Both arrive on the next sync, so try again in a moment.
      </p>
    </Panel>
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

/**
 * The Positional WAR section on this page, wrapped so it can own the
 * cookie-bound read client rather than having one threaded down through
 * PowerPulseBody's props. PositionalWarSection owns the compute behind this
 * boundary, so a cold curve never holds up the rankings table above it.
 */
async function PositionalWarBlock({
  leagueRowId,
  leagueName,
  season,
  teamCount,
  rosterPositions,
  scoringSettings,
  searchedUsername,
  viewerSleeperUserId,
  exploreHref,
}: {
  leagueRowId: string;
  leagueName: string;
  season: number;
  teamCount: number;
  rosterPositions: string[];
  scoringSettings: ScoringSettings;
  searchedUsername: string | null;
  /** The viewer's Sleeper user id, tried before the handle: a saved handle is
   *  a Sleeper username while the candidates carry display names. */
  viewerSleeperUserId: string | null;
  exploreHref: string;
}) {
  const supabase = await createClient();
  // A preview here, not the dashboard. This page's subject is expected
  // performance; the scarcity curve is context for it, and the full dashboard
  // (the scatterplot, the player table, the upgrade what-if) has its own page.
  return (
    <PositionalWarSection
      supabase={supabase}
      leagueRowId={leagueRowId}
      leagueName={leagueName}
      season={season}
      teamCount={teamCount}
      rosterPositions={rosterPositions}
      scoringSettings={scoringSettings}
      searchedUsername={searchedUsername}
      viewerSleeperUserId={viewerSleeperUserId}
      focusedRosterId={null}
      variant="preview"
      exploreHref={exploreHref}
    />
  );
}

/**
 * Placeholder while the Positional WAR curve streams in. Announced politely so
 * a screen reader hears that work is in progress rather than sitting on
 * silence.
 */
function WarSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-modal border border-line bg-surface/50 p-6"
    >
      <p className="text-sm text-ink-muted">Loading Positional WAR</p>
      <div
        aria-hidden="true"
        className="mt-4 h-56 animate-pulse rounded-card bg-base/60"
      />
    </div>
  );
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
