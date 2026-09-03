import type { Metadata } from "next";
import { Suspense, cache } from "react";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { pulseLeagueCore, pulseLeagueDerived } from "@/lib/league-pulse";
import { resolveSourceSlug } from "@/lib/preferences";
import { resolveLeagueContext, describeDerived } from "@/lib/league-format-resolution";
import { loadLeagueHeaderActions } from "@/lib/league-header-data";
import { buildLeagueFormatTags, buildLeagueScoringTags } from "@/lib/league-format-tags";
import { LeagueShell } from "@/components/league-shell";
import type { LeagueMastheadProps } from "@/components/league-shell";
import { Panel } from "@/components/dashboard-panel";
import { formatRelative } from "@/lib/datetime";
import { resolveScheduleWeek } from "@/lib/league-schedule/data";
import { loadLineupView } from "@/lib/league-lineups/data";
import { loadLeagueValueContext } from "@/lib/faab/league-load";
import { buildWeekOptions, clampWeek } from "@/lib/league-lineups/weeks";
import { withUsername } from "@/components/league-schedule/format";
import { LineupControls } from "@/components/league-lineups/lineup-controls";
import { LineupSummary } from "@/components/league-lineups/lineup-summary";
import { LineupBoard } from "@/components/league-lineups/lineup-board";
import { OptimizerPanel } from "@/components/league-lineups/optimizer-panel";
import { DropPanel, WaiverPanel } from "@/components/league-lineups/roster-moves";
import { WeekStatusBanner } from "@/components/league-lineups/week-status";
import { WeekRecapPanel } from "@/components/league-lineups/week-recap";
import { SeasonContextPanel } from "@/components/league-lineups/season-context";
import { SeasonCharts } from "@/components/league-lineups/season-charts";
import { loadLineupSeason } from "@/lib/league-lineups/season-data";
import { refreshManagerLedger } from "@/lib/league-manager-ledger";
import { projectionSourceDisplay } from "@/lib/projections/source-constants";

/**
 * `/leagues/[id]/lineups`: one team, one week, in depth.
 *
 * WHERE IT SITS BETWEEN THE OTHER SECTIONS
 *   Schedules answers "who am I playing and what will that cost me". Power
 *   Pulse answers "what should this roster win from here". Positional WAR
 *   answers "which positions are scarce in this league". This one answers the
 *   question a manager actually has on a Sunday morning: "am I starting the
 *   right nine people, and is there anything I should do about it".
 *
 * THE SLOW WORK IS BEHIND A BOUNDARY. `pulseLeagueCore` runs first so the
 * masthead, the tabs and the intro paint immediately; the derived half (the
 * matchup slate, Power Pulse, the Positional WAR curve this page READS) runs
 * inside the Suspense boundary underneath. That is the same split every other
 * section of the deep view makes, for the same reason.
 *
 * TWO QUESTIONS, ONE PAGE, DECIDED BY THE WEEK. Before the games this is a
 * lineup helper: a projection per player, an optimiser, a waiver wire and a cut
 * list. After them it is a REPORT: what was scored, the best lineup that was
 * available, whether the difference cost the game, who came through, and what
 * the week did to the season. lib/league-lineups/status.ts decides which, and
 * every panel reads that one decision rather than testing `isFinal` for itself.
 *
 * THE SEASON HALF IS THE MANAGER LEDGER'S, READ AND NOT REBUILT. The Decisions
 * page owns "how good is this manager"; this page shows one roster's slice of
 * the same cache. That is why `includeManagerLedger` is opted into here, and
 * why the whole season section sits in its OWN Suspense boundary: it is a full
 * season of reads and nothing above it should wait on them.
 *
 * THE ONLY COMPUTE IT TRIGGERS IS THE SANCTIONED ONE. `pulseLeagueDerived`
 * below is the on-demand path CLAUDE.md defines for Power Pulse, Positional WAR
 * and the Manager Ledger, TTL-gated exactly as it is on every other section
 * route, and this page calls it the same way its siblings do. What the READ LAYER
 * (lib/league-lineups/data.ts) must never do is start a compute of its own: it
 * reads `league_positional_war_cache` and `league_power_pulse_cache` and
 * nothing more, so a league whose curve has not been built yet gets an honest
 * line rather than a fabricated zero.
 *
 * FORMAT IS THE LEAGUE'S, SOURCE IS THE READER'S. Per the League Pulse Format
 * Resolution rule: `resolveLeagueContext` derives the format from the league's
 * own Sleeper scoring, and only the value source respects `?source=`. That
 * source decides the free agent rankings and the market values behind the cut
 * list; it does NOT decide the projections, which come from the projection
 * source lib/projections/source.ts resolves.
 */

export const dynamic = "force-dynamic";

/**
 * The core sync and the league row, once per request.
 *
 * generateMetadata and the page body both need this league. Cached, they share
 * one `pulseLeagueCore` and one select. The sync is INSIDE the cache rather
 * than beside it: a league nobody has opened before does not exist in our
 * tables until that call writes it, and a cached read that ran ahead of the
 * sync would return null, cache the null, and 404 a league created two lines
 * later.
 */
const getSyncedLeague = cache(async (sleeperLeagueId: string) => {
  const pulse = await pulseLeagueCore(createAdminClient(), sleeperLeagueId);
  if (!pulse.ok) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("leagues")
    .select(
      "id, sleeper_league_id, name, season, status, total_rosters, last_pulsed_at, roster_positions, scoring_settings, metadata, format_config_id",
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

  const title = `${league.name} Lineups`;
  const description = `Every starter and bench player in ${league.name}, with projections, matchups, game totals and the changes that raise your score.`;
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

export default async function LeagueLineupsPage({
  params,
  searchParams,
}: {
  params: Promise<{ league_id: string }>;
  searchParams: Promise<{
    roster?: string;
    week?: string;
    username?: string;
    source?: string;
  }>;
}) {
  const { league_id: sleeperLeagueId } = await params;
  const sp = await searchParams;
  const searchedUsername =
    typeof sp.username === "string" && sp.username.trim() ? sp.username.trim() : null;

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

  const sleeperLeague = league.metadata as unknown as Parameters<typeof resolveLeagueContext>[1];
  const resolvedSource = await resolveSourceSlug(supabase, sp.source);
  const context = await resolveLeagueContext(adminClient, sleeperLeague, resolvedSource.slug);
  const coverageOk = context.coverage !== "none";

  const formatTags = buildLeagueFormatTags({
    rosterPositions: league.roster_positions,
    scoringSettings: league.scoring_settings,
    teamCount: league.total_rosters,
  });
  const scoringTags = buildLeagueScoringTags(league.scoring_settings);

  const mastheadProps: LeagueMastheadProps = {
    leagueName: league.name,
    season: league.season ?? null,
    teamCount: league.total_rosters ?? null,
    status: league.status ?? null,
    formatTags,
    scoringTags,
    lastUpdatedLabel: formatRelative(league.last_pulsed_at),
    cached: pulseCached,
    coverage: context.coverage,
    sourceDisplay: coverageOk ? context.sourceDisplay : "Not available",
    formatDisplay: coverageOk ? context.formatDisplay : "Not available",
    derivedLabel: describeDerived(context.derived),
    fallbackDisplay:
      context.coverage === "fallback" ? (context.fallback?.derivedDisplay ?? null) : null,
    pickSourceDisplay:
      coverageOk && context.pickSource && context.pickSource.slug !== context.sourceSlug
        ? context.pickSource.display
        : null,
  };

  const leagueHref = withUsername(`/leagues/${sleeperLeagueId}`, searchedUsername);

  return (
    <LeagueShell
      sleeperLeagueId={sleeperLeagueId}
      activeTab="lineups"
      searchedUsername={searchedUsername}
      homeHref={
        searchedUsername
          ? `/tools/league-pulse?username=${encodeURIComponent(searchedUsername)}`
          : "/tools/league-pulse"
      }
      crumbs={[{ label: league.name, href: leagueHref }, { label: "Lineups" }]}
      copyHref={`/leagues/${sleeperLeagueId}/lineups`}
      copyAriaLabel="Copy link to this lineup"
      otherLeagues={otherLeagues}
      masthead={mastheadProps}
    >
      <>
        {/* Feature intro. The masthead owns this page's h1 (the league name),
            so the section heading is an h2. */}
        <section
          aria-labelledby="lineups-intro"
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
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-cyan">
            Start the right nine
          </p>
          <h2
            id="lineups-intro"
            className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl"
          >
            Lineups
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            Every player you own, what each one is projected to score in your league&apos;s
            scoring, how his matchup and his game look, and the exact changes that raise your
            total.
          </p>
        </section>

        <Suspense fallback={<LineupSkeleton />}>
          <LineupBody
            leagueRowId={league.id}
            sleeperLeagueId={sleeperLeagueId}
            season={Number(league.season)}
            metadata={league.metadata}
            resynced={!pulseCached}
            searchedUsername={searchedUsername}
            requestedRoster={intOrNull(sp.roster)}
            requestedWeek={intOrNull(sp.week)}
            formatConfigId={coverageOk ? context.formatConfigId : null}
            sourceSlug={context.sourceSlug}
          />
        </Suspense>
      </>
    </LeagueShell>
  );
}

/**
 * The controls, the board and the panels.
 *
 * The derived pulse runs in here rather than above the shell, so the league
 * name and the tabs paint while the slate refreshes.
 *
 * BOTH SLOW COMPUTES ARE OPTED OUT OF HERE AND AWAITED INSIDE THE BOUNDARY
 * THAT RENDERS THEM. `pulseLeagueDerived` runs before the board, so anything it
 * is asked to compute is time a reader spends looking at nothing.
 *
 *   The MANAGER LEDGER is a full season of matchups, transactions, draft picks
 *   and one optimiser run per team per week. Only the season section shows it,
 *   so `SeasonBody` refreshes it behind its own skeleton, exactly as
 *   app/leagues/[league_id]/decisions/page.tsx does.
 *
 *   POSITIONAL WAR is a full-universe projection read on a cold fingerprint.
 *   This page only READS the curve, so it has no reason to wait for one.
 *
 * Leaving either at its default also forked the in-process coalescer: its key
 * includes both flags, so a render with different flags to the warm-up
 * endpoint's started a second full derived run instead of joining the first.
 */
async function LineupBody({
  leagueRowId,
  sleeperLeagueId,
  season,
  metadata,
  resynced,
  searchedUsername,
  requestedRoster,
  requestedWeek,
  formatConfigId,
  sourceSlug,
}: {
  leagueRowId: string;
  sleeperLeagueId: string;
  season: number;
  metadata: unknown;
  resynced: boolean;
  searchedUsername: string | null;
  requestedRoster: number | null;
  requestedWeek: number | null;
  formatConfigId: string | null;
  sourceSlug: string;
}) {
  const adminClient = createAdminClient();
  await pulseLeagueDerived(adminClient, leagueRowId, {
    resynced,
    includeManagerLedger: false,
    includePositionalWar: false,
  });

  const supabase = await createClient();
  const playoffWeekStart = resolvePlayoffWeekStart(metadata);

  // FOUR INDEPENDENT READS, ONE WAVE. None of them consumes another's output,
  // and this boundary is already the slow half of the page, so running them in
  // sequence spent three round trips on nothing.
  //
  // `loadLeagueValueContext` is the shared resolver for "is a cut permanent
  // here" (lib/faab/league-load.ts). It leads on the league's DERIVED format
  // and only falls back to Sleeper's own `settings.type`. A local copy reading
  // the metadata alone gets a dynasty league with missing or zero Sleeper
  // settings wrong in the one direction that matters: the cut guard stands
  // down and the panel offers a valuable dynasty asset as droppable.
  const [currentWeek, storedWeeks, rosterId, valueContext] = await Promise.all([
    resolveScheduleWeek(season, playoffWeekStart),
    loadStoredWeeks(supabase, leagueRowId, season),
    resolveRosterId(supabase, leagueRowId, requestedRoster, searchedUsername),
    loadLeagueValueContext(adminClient, leagueRowId),
  ]);

  const weekOptions = buildWeekOptions(storedWeeks, currentWeek, playoffWeekStart);
  const week = clampWeek(weekOptions, requestedWeek, currentWeek);

  if (rosterId === null) {
    return (
      <div className="mt-6">
        <Panel
          eyebrow="Nothing to show"
          title="No rosters stored for this league yet"
          helper="A lineup needs a roster, and this league has none."
        >
          <p className="text-sm leading-relaxed text-ink-muted">
            Rosters arrive on the next sync. Open the league overview once and this fills in.
          </p>
        </Panel>
      </div>
    );
  }

  const isKeeperLeague = valueContext.isKeeperLeague;

  const result = await loadLineupView(supabase, adminClient, {
    leagueRowId,
    season,
    week,
    currentWeek,
    sleeperRosterId: rosterId,
    playoffWeekStart,
    formatConfigId,
    sourceSlug,
    isKeeperLeague,
    statusVariant: isKeeperLeague ? "dynasty" : "redraft",
  });

  if (!result.ok) {
    return (
      <div className="mt-6">
        <Panel
          eyebrow="Nothing to show"
          title={
            result.reason === "no-roster"
              ? "That team is not in this league"
              : "This league has not finished syncing"
          }
          helper="Pick another team from the control bar, or open the league overview to sync it."
        >
          <p className="text-sm leading-relaxed text-ink-muted">
            {result.reason === "no-roster"
              ? "The roster in the link does not exist in this league. The picker above lists every team we hold."
              : "We hold no league row for this id yet."}
          </p>
        </Panel>
      </div>
    );
  }

  const { view, dropNote, teams } = result;

  // /tools/faab takes no league param, so the link is the bare tool. Passing
  // one that the route does not read would look like a deep link and behave
  // like a plain one.
  const faabHref = "/tools/faab";

  const decisionsHref = withUsername(
    `/leagues/${sleeperLeagueId}/decisions`,
    searchedUsername,
  );

  return (
    <div className="mt-6 space-y-6">
      <LineupControls
        sleeperLeagueId={sleeperLeagueId}
        searchedUsername={searchedUsername}
        week={week}
        weeks={weekOptions}
        rosterId={rosterId}
        teams={teams}
      />

      {/* WHAT THE READER IS LOOKING AT, before any number. A forecast and a
          result are different kinds of thing and the page has to say which
          before it starts quoting figures. */}
      <WeekStatusBanner status={view.weekStatus} week={view.week} season={view.season} />

      <LineupSummary view={view} />

      {/* THE REPORT, and only when there is one. Above the board, because on a
          settled week the result is what a reader came for and the roster is
          the evidence for it. */}
      {view.recap && (
        <WeekRecapPanel
          recap={view.recap}
          opponent={view.opponent}
          week={view.week}
          decisionsHref={decisionsHref}
        />
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Panel
            id="lineup-board"
            eyebrow="Your roster"
            title={`Week ${view.week} lineup`}
            helper={
              view.weekStatus.showsResults
                ? "Every slot, then the bench. The big number is what he scored, with the projection it is measured against underneath."
                : "Every slot, then the bench. Tap a player for the full breakdown, or his slot button to try a change."
            }
            headingLevel={2}
            // A supplied bodyClassName REPLACES the default padding, which is
            // what lets the table run to the panel edge on a phone.
            bodyClassName="px-2 py-3 sm:px-3"
          >
            <div>
              <LineupBoard
                groups={view.groups}
                bench={view.bench}
                reserve={view.reserve}
                taxi={view.taxi}
                week={view.week}
                status={view.weekStatus}
                isFinal={view.isFinal}
                optimization={view.optimization}
                opponent={view.opponent}
                environmentAverage={view.environmentAverage}
                environmentUnavailable={view.environmentUnavailable}
                positionalWarUnavailable={view.positionalWarUnavailable}
                unprojectableSlotCount={view.unprojectableSlotCount}
                unprojectedSlotCount={view.unprojectedSlotCount}
              />
            </div>
          </Panel>

          {/* ADVICE BEFORE THE WEEK, RETROSPECT AFTER IT, AND NOTHING ELSE.
              The panel flips its own wording on `isFinal`. What it must not do
              is run mid-week, where the optimum is still graded on projections
              and it would offer "changes worth making" for players whose games
              have finished, or on an unsettled past week, where the banner has
              just said there is nothing to grade and the panel would follow it
              with present-tense advice for a week that has gone. */}
          {(view.weekStatus.phase === "upcoming" || view.weekStatus.phase === "final") && (
            <OptimizerPanel
              optimization={view.optimization}
              isFinal={view.isFinal}
              week={view.week}
            />
          )}

          {/* THE SEASON, IN ITS OWN BOUNDARY. A full season of matchup rows,
              projections and the ledger read: none of it is what a reader came
              for, so none of it holds up the board above. */}
          <Suspense fallback={<SeasonSkeleton />}>
            <SeasonBody
              leagueRowId={leagueRowId}
              season={season}
              sleeperRosterId={view.sleeperRosterId}
              viewedWeek={view.week}
              currentWeek={view.currentWeek}
              teamName={view.teamName}
              teamCount={teams.length}
              decisionsHref={decisionsHref}
            />
          </Suspense>
        </div>

        {/* Rail on the RIGHT, matching every other section of the deep view.
            Second in DOM order, so on a phone it reads after the lineup it is
            supplementary to. */}
        <aside
          aria-label={
            view.weekStatus.showsAdvice
              ? "Roster moves and how this works"
              : "How this works"
          }
          className="min-w-0 space-y-6 xl:sticky xl:top-[5.5rem] xl:self-start"
        >
          {/* THE RAIL IS ADVICE, so it goes when the week does. Both panels are
              about a decision that is still open: who to pick up for this week,
              and who to drop to make room. Beside a report on week 3 in
              November they are answering a question nobody asked, and the
              waiver panel would have to spend its whole body explaining that it
              cannot help. The board, the recap and the season stay. */}
          {view.weekStatus.showsAdvice && (
            <>
              <WaiverPanel
                suggestions={view.waivers}
                status={view.status}
                faabHref={faabHref}
                state={view.waiversState}
                week={view.week}
              />
              <DropPanel
                options={view.dropOptions}
                note={dropNote}
                isKeeperLeague={isKeeperLeague}
              />
            </>
          )}
          <MethodPanel
            projectionSource={view.projectionSource}
            showsResults={view.weekStatus.showsResults}
          />
        </aside>
      </div>
    </div>
  );
}

/**
 * The season section: the standing, and the two charts.
 *
 * ITS OWN COMPONENT AND ITS OWN BOUNDARY, so the reads behind it (a season of
 * matchup rows, a season of projections, and the ledger row) never delay the
 * lineup. Nothing here computes a model: the settled half is read from
 * `league_manager_ledger_cache` and the projected half is rebuilt through the
 * same `projectPlayerWeek` every other number on the page goes through.
 */
async function SeasonBody({
  leagueRowId,
  season,
  sleeperRosterId,
  viewedWeek,
  currentWeek,
  teamName,
  teamCount,
  decisionsHref,
}: {
  leagueRowId: string;
  season: number;
  sleeperRosterId: number;
  viewedWeek: number;
  currentWeek: number;
  teamName: string;
  teamCount: number;
  decisionsHref: string;
}) {
  // THE COMPUTE AND THE READ, both inside this boundary. The skeleton above is
  // what a reader looks at while this runs, rather than the empty page they
  // were looking at when it ran in front of the board.
  await refreshManagerLedger(createAdminClient(), leagueRowId);

  const seasonView = await loadLineupSeason({
    leagueRowId,
    season,
    sleeperRosterId,
    viewedWeek,
    currentWeek,
    teamCount,
  });

  return (
    <div className="space-y-6">
      <SeasonContextPanel
        ledger={seasonView.ledger}
        teamName={teamName}
        decisionsHref={decisionsHref}
      />
      <SeasonCharts
        series={seasonView.series}
        accuracy={seasonView.accuracy}
        viewedWeek={viewedWeek}
        projectionSourceLabel={projectionSourceDisplay(seasonView.projectionSource)}
      />
    </div>
  );
}

function SeasonSkeleton() {
  return (
    <div
      role="status"
      className="h-64 animate-pulse rounded-modal border border-line bg-surface/40"
    >
      <span className="sr-only">Loading your season</span>
    </div>
  );
}

/** Where every number on this page comes from, in plain words. */
function MethodPanel({
  projectionSource,
  showsResults,
}: {
  projectionSource: string;
  /** A report week explains its results; an upcoming one explains its advice. */
  showsResults: boolean;
}) {
  return (
    <Panel eyebrow="How this works" title="Where the numbers come from" headingLevel={2}>
      <dl className="space-y-3 text-[13px] leading-relaxed">
        {showsResults && (
          <div>
            <dt className="font-semibold text-ink">Scores</dt>
            <dd className="mt-0.5 text-ink-muted">
              Sleeper&apos;s own per-player points for the week, and its own team total for
              the result. The projection beside each score is what the player was expected
              to do, kept so you can see how far off it was.
            </dd>
          </div>
        )}
        <div>
          <dt className="font-semibold text-ink">Projections</dt>
          <dd className="mt-0.5 text-ink-muted">
            {projectionSource === "ffbeacon" ? "FF Beacon" : "Sleeper"} weekly numbers,
            rescored under your league&apos;s own settings, then adjusted for the defense
            each player faces, how often he has met his number, and how often he has been
            available. The same model the Power Pulse page uses.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Game totals</dt>
          <dd className="mt-0.5 text-ink-muted">
            How many points the betting market expects each offense to score. A big number
            means a shootout, which usually means more chances for everyone in it.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Positional WAR</dt>
          <dd className="mt-0.5 text-ink-muted">
            How scarce a player&apos;s position is in this league, and where he ranks in it.
            It measures the position, not what he is worth to your team, so a high number
            beside a player you already have covered is not a reason to trade for another.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Best lineup</dt>
          <dd className="mt-0.5 text-ink-muted">
            The highest-scoring legal lineup your roster {showsResults ? "could have produced" : "can produce"}.
            Injured reserve and taxi players are left out, because Sleeper will not let them
            start.{" "}
            {showsResults
              ? "On a settled week it is graded on what players actually scored, never on what they were projected for."
              : ""}
          </dd>
        </div>
        {showsResults && (
          <div>
            <dt className="font-semibold text-ink">Your season</dt>
            <dd className="mt-0.5 text-ink-muted">
              Read from the same model the Decisions page uses, so a figure here and the
              same figure there are one number rather than two that happen to agree.
            </dd>
          </div>
        )}
      </dl>
    </Panel>
  );
}

function LineupSkeleton() {
  // Announced rather than hidden: this boundary can wait on a full league sync,
  // and a silent gap is worse than a spoken "loading".
  return (
    <div
      role="status"
      className="mt-6 h-96 animate-pulse rounded-modal border border-line bg-surface/40"
    >
      <span className="sr-only">Loading your lineup</span>
    </div>
  );
}

/** Sleeper's playoff_week_start, or the usual 15 when it is unset. */
function resolvePlayoffWeekStart(metadata: unknown): number {
  const settings = (metadata as { settings?: Record<string, unknown> } | null)?.settings;
  const configured = Number(settings?.playoff_week_start);
  return Number.isFinite(configured) && configured > 0 ? Math.trunc(configured) : 15;
}

function intOrNull(value: string | undefined): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

/** Which weeks this league has a stored slate for. */
async function loadStoredWeeks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueRowId: string,
  season: number,
): Promise<Array<{ week: number; isFinal: boolean }>> {
  const { data } = await supabase
    .from("league_matchups")
    .select("week, is_final")
    .eq("league_id", leagueRowId)
    .eq("season", season)
    .order("week", { ascending: true });

  const byWeek = new Map<number, boolean>();
  for (const row of data ?? []) {
    const week = Number(row.week);
    if (!Number.isFinite(week)) continue;
    byWeek.set(week, byWeek.get(week) || Boolean(row.is_final));
  }
  return [...byWeek.entries()]
    .map(([week, isFinal]) => ({ week, isFinal }))
    .sort((a, b) => a.week - b.week);
}

/**
 * Whose lineup to show.
 *
 * The explicit `?roster=` wins. Failing that, the searched Sleeper handle
 * picks their own team, which is the whole reason that param is carried across
 * every link in this section. Failing that, the first roster, so the page has
 * something to render rather than an empty state a reader cannot act on.
 */
async function resolveRosterId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueRowId: string,
  requested: number | null,
  searchedUsername: string | null,
): Promise<number | null> {
  const { data } = await supabase
    .from("rosters")
    .select("sleeper_roster_id, owner_user_id, league_users!inner(display_name)")
    .eq("league_id", leagueRowId)
    .order("sleeper_roster_id", { ascending: true });

  const rows = (data ?? []) as unknown as Array<{
    sleeper_roster_id: number;
    owner_user_id: string | null;
    league_users: { display_name: string | null } | Array<{ display_name: string | null }> | null;
  }>;

  if (rows.length === 0) {
    // The inner join above drops a roster with no owner, so a league that is
    // all orphan rosters would look empty. Ask again without it before giving
    // up: a lineup is worth rendering even when nobody is named.
    const { data: bare } = await supabase
      .from("rosters")
      .select("sleeper_roster_id")
      .eq("league_id", leagueRowId)
      .order("sleeper_roster_id", { ascending: true });
    const ids = (bare ?? []).map((r) => Number(r.sleeper_roster_id));
    if (ids.length === 0) return null;
    if (requested !== null && ids.includes(requested)) return requested;
    return ids[0];
  }

  const ids = rows.map((r) => Number(r.sleeper_roster_id));
  if (requested !== null && ids.includes(requested)) return requested;

  const handle = searchedUsername?.trim().toLowerCase() ?? null;
  if (handle) {
    const match = rows.find((row) => {
      const users = Array.isArray(row.league_users) ? row.league_users : [row.league_users];
      return users.some((u) => (u?.display_name ?? "").toLowerCase() === handle);
    });
    if (match) return Number(match.sleeper_roster_id);
  }

  return ids[0];
}
