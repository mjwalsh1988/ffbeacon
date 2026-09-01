import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { pulseLeagueCore, pulseLeagueDerived } from "@/lib/league-pulse";
import { resolveSourceSlug } from "@/lib/preferences";
import {
  resolveLeagueContext,
  describeDerived,
} from "@/lib/league-format-resolution";
import { loadLeagueTeamCards } from "@/lib/league-view-data";
import { loadPowerPulseView, buildPulseLeaders } from "@/lib/league-power-pulse-data";
import { loadTransactionVolume } from "@/lib/league-transaction-volume";
import { loadViewerCandidates } from "@/lib/league-positional-war-data";
import { matchViewerRoster } from "@/lib/league-viewer";
import { TransactionVolumePanel } from "@/components/league-overview/transaction-volume-panel";
import { PulseLeaders } from "@/components/power-pulse/pulse-leaders";
import { loadLeagueReadiness, type LeagueReadiness } from "@/lib/league-readiness";
import { classifyTeamStatus, type TeamStatus } from "@/lib/league-team-status";
import { PreDraftNotice } from "@/components/power-pulse/pre-draft-notice";
import { type SleeperLeague } from "@/lib/sleeper";
import { loadLeagueHeaderActions } from "@/lib/league-header-data";
import { TeamFilter } from "@/components/team-filter";
import { LeagueLoadError } from "@/components/league-load-error";
import { LeagueShell } from "@/components/league-shell";
import { WarRailSection } from "@/components/league-war/positional-war-section";
import { PulseFavoriteCard } from "@/components/league-rail/pulse-favorite-card";
import { loadPulseFavorite } from "@/lib/league-pulse-favorite";
import { PowerRankingsRow } from "@/components/power-rankings-row";
import { LeagueActivityPanel } from "@/components/league-activity/activity-panel";
import {
  ACTIVITY_DEFAULT_DAYS,
  ACTIVITY_PANEL_ROWS,
  loadLeagueActivity,
  parseRosterId,
  parseWindowDays,
} from "@/lib/league-activity/load";
import { isActivityCategory, type ActivityCategory } from "@/lib/league-activity/types";
import { PicksToggle } from "@/components/picks-toggle";
import { RankModeToggle, type RankMode } from "@/components/power-pulse/rank-mode-toggle";
import { Panel } from "@/components/dashboard-panel";
import {
  buildLeagueFormatTags,
  buildLeagueScoringTags,
} from "@/lib/league-format-tags";
import Link from "next/link";
import {
  Users,
  ArrowLeftRight,
  ArrowRight,
  Handshake,
  CalendarDays,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ league_id: string }>;
  searchParams: Promise<{ name?: string }>;
}): Promise<Metadata> {
  const { league_id } = await params;
  const { name: nameParam } = await searchParams;
  const supabase = await createClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("name, season")
    .eq("sleeper_league_id", league_id)
    .maybeSingle();

  // On a league's first open the row doesn't exist yet (the sync runs in the
  // page body, under the loader). Fall back to the name passed from the
  // previous page via ?name= so the title is correct on first load; the DB
  // name takes over once the row exists. Never surface "League not found";
  // the page renders a branded retry state if the sync truly fails.
  const fallbackName =
    typeof nameParam === "string" && nameParam.trim() ? nameParam.trim() : null;
  const displayName = league?.name ?? fallbackName;

  const ogPath = `/api/og/league/${league_id}`;
  const title = displayName
    ? league?.season != null
      ? `${displayName} (${league.season})`
      : displayName
    : "League Pulse";
  const description = displayName
    ? `League overview, rosters, transactions, and power rankings for ${displayName}.`
    : "League overview, rosters, transactions, and power rankings.";
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogPath, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogPath],
    },
  };
}

// Inline-rendered tabs on this page. Transactions is its own full page, so
// it's not in this union (the redirect below sends ?tab=transactions there).
type InlineTabId = "overview" | "teams";

export default async function LeagueDeepViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ league_id: string }>;
  searchParams: Promise<{
    tab?: string;
    source?: string;
    username?: string;
    roster?: string;
    picks?: string;
    rank?: string;
    adays?: string;
    acat?: string;
    ateam?: string;
  }>;
}) {
  const { league_id: sleeperLeagueId } = await params;
  const {
    tab: tabParam,
    source: sourceParam,
    username: usernameParam,
    roster: rosterParam,
    picks: picksParam,
    rank: rankParam,
    adays: activityDaysParam,
    acat: activityCategoryParam,
    ateam: activityTeamParam,
  } = await searchParams;
  const searchedUsername =
    typeof usernameParam === "string" && usernameParam.trim() ? usernameParam.trim() : null;

  // Transactions is its own full page now, not an inline tab. The tab nav
  // links straight there; this redirect catches legacy ?tab=transactions
  // links (and any bookmarks) so nobody lands on a blank tab.
  if (tabParam === "transactions") {
    const qs = new URLSearchParams();
    if (searchedUsername) qs.set("username", searchedUsername);
    if (typeof sourceParam === "string" && sourceParam) qs.set("source", sourceParam);
    const s = qs.toString();
    redirect(`/leagues/${sleeperLeagueId}/transactions${s ? `?${s}` : ""}`);
  }

  const activeTab: InlineTabId = tabParam === "teams" ? "teams" : "overview";
  const focusedRosterId = (() => {
    if (typeof rosterParam !== "string" || !rosterParam.trim()) return null;
    const n = Number.parseInt(rosterParam, 10);
    return Number.isFinite(n) ? n : null;
  })();

  // First-touch pulse, split in two. The core is the league, its rosters, and
  // its members: everything the header and the tabs need, and nothing else. The
  // derived work (transaction history, trade values, Power Pulse) runs inside
  // the Suspense boundaries below, so a cold league paints its name and shape
  // immediately instead of holding a blank loader for the whole sync.
  const adminClient = createAdminClient();
  const pulseResult = await pulseLeagueCore(adminClient, sleeperLeagueId);

  if (!pulseResult.ok) {
    // Sync failed (missing league or a transient Sleeper outage; the API
    // can't distinguish them). Show a branded retry state rather than 404.
    return <LeagueLoadError />;
  }

  // Read the canonical row for render (anon-readable, RLS-safe).
  const supabase = await createClient();
  const { data: league } = await supabase
    .from("leagues")
    .select(
      "id, sleeper_league_id, name, season, status, total_rosters, last_pulsed_at, pulse_status, pulse_error, format_config_id, roster_positions, scoring_settings, metadata",
    )
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();

  if (!league) notFound();

  const formatTags = buildLeagueFormatTags({
    rosterPositions: league.roster_positions,
    scoringSettings: league.scoring_settings,
    teamCount: league.total_rosters,
  });
  const scoringTags = buildLeagueScoringTags(league.scoring_settings);

  // Resolve source preference. Format is NOT user-controlled inside a
  // league view (CLAUDE.md: League Pulse Format Resolution rule). We derive
  // the league's natural format from Sleeper settings and map to the
  // closest format the chosen source supports.
  const resolvedSource = await resolveSourceSlug(supabase, sourceParam);
  const sleeperLeague = (league.metadata ?? {}) as unknown as SleeperLeague;
  const context = await resolveLeagueContext(
    adminClient,
    sleeperLeague,
    resolvedSource.slug,
  );

  // Breadcrumb back-link. Forward the searched handle so the logo crumb lands
  // the user back on their own league results, not a blank search form.
  const backHref = searchedUsername
    ? `/tools/league-pulse?username=${encodeURIComponent(searchedUsername)}`
    : "/tools/league-pulse";

  // Header action data: the searched user's OTHER leagues (for the in-view
  // switcher, fetched only when ?username= is present). Shared with every
  // other deep-view surface via loadLeagueHeaderActions. The Refresh button
  // is public, so there is no per-viewer refresh gate to compute.
  const { otherLeagues } = await loadLeagueHeaderActions(
    supabase,
    league.id,
    sleeperLeagueId,
    searchedUsername,
    league.season != null ? String(league.season) : null,
  );

  const lastPulsed = league.last_pulsed_at ? new Date(league.last_pulsed_at) : null;
  const lastPulsedLabel = lastPulsed ? formatRelative(lastPulsed) : "never";

  // Value coverage + format/source, resolved once and shared by the info panel,
  // power rankings, and teams list. "none" means no source covers the league's
  // format, so the value-dependent surfaces get nulls and render name-only.
  const derivedLabel = describeDerived(context.derived);
  const coverageOk = context.coverage !== "none";
  const formatSlug = coverageOk ? context.formatSlug : null;
  const sourceSlug = coverageOk ? context.sourceSlug : null;
  const formatDisplay = coverageOk ? context.formatDisplay : "N/A";
  const sourceDisplay = coverageOk ? context.sourceDisplay : "N/A";
  const pickSourceDisplay =
    coverageOk && context.pickSource && context.pickSource.slug !== context.sourceSlug
      ? context.pickSource.display
      : null;
  const fallbackDisplay =
    context.coverage === "fallback" ? context.fallback?.derivedDisplay ?? null : null;

  // Draft picks only carry value in dynasty leagues, so the "Include draft
  // picks in power rankings" toggle is dynasty-only. Default ON; `?picks=off`
  // ranks teams by players only. Redraft leagues force picks off and never
  // show the toggle or any picks column. When there's no value coverage there
  // is nothing to rank, so the toggle is hidden then too.
  const isDynasty = context.derived.league_type === "dynasty";
  const includePicks = isDynasty ? picksParam !== "off" : false;
  const showPicksToggle = isDynasty && coverageOk;

  // Power Pulse is the default ordering for the rankings table. `?rank=value`
  // restores the pure trade-value order for readers who want the asset view.
  const rankMode: RankMode = rankParam === "value" ? "value" : "pulse";

  // Activity log state. The window defaults to a fortnight and climbs a ladder
  // from there; the category and team narrow it. All three live in the URL so a
  // filtered view is a link somebody can send to their league.
  const activityDays = parseWindowDays(activityDaysParam);
  const activityCategory: ActivityCategory | null = isActivityCategory(activityCategoryParam)
    ? activityCategoryParam
    : null;
  const activityRosterId = parseRosterId(activityTeamParam);

  // In-view links (username forwarded so the Teams chips default correctly).
  const teamsHref = searchedUsername
    ? `/leagues/${sleeperLeagueId}?tab=teams&username=${encodeURIComponent(searchedUsername)}`
    : `/leagues/${sleeperLeagueId}?tab=teams`;
  const transactionsHref = searchedUsername
    ? `/leagues/${sleeperLeagueId}/transactions?username=${encodeURIComponent(searchedUsername)}`
    : `/leagues/${sleeperLeagueId}/transactions`;
  const powerPulseHref = searchedUsername
    ? `/leagues/${sleeperLeagueId}/power-pulse?username=${encodeURIComponent(searchedUsername)}`
    : `/leagues/${sleeperLeagueId}/power-pulse`;
  const tradeIdeasHref = searchedUsername
    ? `/leagues/${sleeperLeagueId}/trade-ideas?username=${encodeURIComponent(searchedUsername)}`
    : `/leagues/${sleeperLeagueId}/trade-ideas`;
  const scheduleHref = searchedUsername
    ? `/leagues/${sleeperLeagueId}/schedules?username=${encodeURIComponent(searchedUsername)}`
    : `/leagues/${sleeperLeagueId}/schedules`;
  const activityHref = searchedUsername
    ? `/leagues/${sleeperLeagueId}/activity?username=${encodeURIComponent(searchedUsername)}`
    : `/leagues/${sleeperLeagueId}/activity`;
  const positionalWarHref = searchedUsername
    ? `/leagues/${sleeperLeagueId}/positional-war?username=${encodeURIComponent(searchedUsername)}`
    : `/leagues/${sleeperLeagueId}/positional-war`;

  // The masthead is identical on every League Pulse section, so its inputs are
  // assembled once here and handed to the shell, which renders it above
  // whatever this section shows.
  const mastheadProps = {
    leagueName: league.name,
    season: league.season ?? null,
    teamCount: league.total_rosters ?? null,
    status: league.status ?? null,
    formatTags,
    scoringTags,
    lastUpdatedLabel: lastPulsedLabel,
    cached: pulseResult.cached,
    coverage: context.coverage,
    sourceDisplay,
    formatDisplay,
    derivedLabel,
    fallbackDisplay,
    pickSourceDisplay,
  };

  return (
    <LeagueShell
      sleeperLeagueId={sleeperLeagueId}
      activeTab={activeTab}
      searchedUsername={searchedUsername}
      homeHref={backHref}
      crumbs={[{ label: league.name }]}
      copyHref={`/leagues/${sleeperLeagueId}`}
      copyAriaLabel="Copy link to this league"
      otherLeagues={otherLeagues}
      masthead={mastheadProps}
      alert={
        league.pulse_status === "error" && league.pulse_error ? (
          <p
            role="alert"
            className="mb-4 rounded-card border border-signal-danger/40 bg-signal-danger/10 p-3 text-sm text-signal-danger"
          >
            Last refresh failed: {league.pulse_error}
          </p>
        ) : null
      }
    >
      {activeTab === "overview" ? (
        // Overview: rankings take the main column, the secondary panels sit in
        // a right rail. The rail used to be on the left so the league identity
        // landed above the rankings on a phone; the masthead does that job for
        // every section now, so what is left in the rail is genuinely
        // supplementary and belongs after the table in DOM order.
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
            {/*
              THE LOG LEADS THE COLUMN. It is the answer to "what did I miss",
              which is the question a reader has on the way in; the rankings
              answer "where do I stand", which is the question they have once
              they are oriented. It also has to sit above the table because it
              is the only surface on the page that reports a scoring or roster
              change, and both of those change what the table below it means.

              Its own boundary and its own reads: one indexed query against
              league_activity, no valuation, no projection. The rankings do not
              wait on it and it does not wait on the rankings.
            */}
            <Suspense fallback={<ActivitySkeleton />}>
              <ActivitySection
                leagueRowId={league.id}
                sleeperLeagueId={sleeperLeagueId}
                searchedUsername={searchedUsername}
                days={activityDays}
                category={activityCategory}
                rosterId={activityRosterId}
                fullHref={activityHref}
                sourceParam={typeof sourceParam === "string" ? sourceParam : null}
                rankParam={rankParam === "value" ? "value" : null}
                picksParam={picksParam === "off" ? "off" : null}
              />
            </Suspense>

            <Suspense fallback={<RankingsSkeleton />}>
              <PowerRankingsSection
                leagueRowId={league.id}
                sleeperLeagueId={sleeperLeagueId}
                formatSlug={formatSlug}
                sourceSlug={sourceSlug}
                formatDisplay={formatDisplay}
                sourceDisplay={sourceDisplay}
                leagueSeason={league.season != null ? String(league.season) : null}
                leagueStatus={league.status ?? null}
                searchedUsername={searchedUsername}
                includePicks={includePicks}
                showPicksToggle={showPicksToggle}
                rankMode={rankMode}
                powerPulseHref={powerPulseHref}
                resynced={!pulseResult.cached}
              />
            </Suspense>

            {/*
              TWO READINGS OF THE SAME LEAGUE, SIDE BY SIDE. Who keeps making
              moves, and what the ranking table above cannot say. Both are
              league-wide findings rather than navigation, which is why they sit
              in the main column under the table instead of in the rail.

              Its own boundary, and its own reads. The rankings table above does
              not need either of these to paint, and neither of these should
              wait on the table.
            */}
            <Suspense fallback={null}>
              <OverviewInsights
                leagueRowId={league.id}
                leagueSeason={league.season != null ? String(league.season) : null}
                formatSlug={formatSlug}
                sourceSlug={sourceSlug}
                searchedUsername={searchedUsername}
                focusedRosterId={focusedRosterId}
                transactionsHref={transactionsHref}
                resynced={!pulseResult.cached}
              />
            </Suspense>
          </div>

          <aside
            aria-label="League findings and links"
            className="space-y-6 xl:sticky xl:top-[5.5rem] xl:self-start"
          >
            {/*
              TWO FINDINGS, THEN THE LINKS. A finding outranks a navigation
              list, so both cards sit above "Explore this league", and the one
              that answers the question readers arrive with, "who wins my
              league", leads.

              Each renders nothing at all when its data is not there yet: an
              empty finding card is worse than no card, and both of the pages
              they link to carry the honest reason.

              THE FULL Positional WAR CHART IS STILL NOT ON THIS PAGE. The
              thirty-six rank chart, the scatterplot, the player table and the
              upgrade what-if all live at /leagues/[id]/positional-war. What
              the rail carries is a condensed reading of that page's first
              chart, in the space a rail has, with a link onward.

              Separate boundaries, because they read different tables and
              neither should hold the other up. The Positional WAR card owns
              its own compute (see WarRailSection); the Power Pulse card reads
              rows pulseLeagueDerived has already written.
            */}
            <Suspense fallback={null}>
              <PulseFavoriteSection
                leagueRowId={league.id}
                season={Number(league.season ?? 0)}
                powerPulseHref={powerPulseHref}
              />
            </Suspense>

            <Suspense fallback={null}>
              <WarRailSection
                supabase={supabase}
                leagueRowId={league.id}
                season={Number(league.season ?? 0)}
                searchedUsername={searchedUsername}
                focusedRosterId={focusedRosterId}
                positionalWarHref={positionalWarHref}
              />
            </Suspense>

            <Panel eyebrow="Go deeper" title="Explore this league">
              <ul className="space-y-2">
                <li>
                  <ExploreLink
                    href={teamsHref}
                    icon={Users}
                    label="Teams and rosters"
                    hint="Compare every roster side by side"
                  />
                </li>
                <li>
                  <ExploreLink
                    href={scheduleHref}
                    icon={CalendarDays}
                    label="Schedules"
                    hint="Every week, every matchup, both lineups"
                  />
                </li>
                <li>
                  <ExploreLink
                    href={positionalWarHref}
                    icon={TrendingDown}
                    label="Positional WAR"
                    hint="Which positions are hard to replace here"
                  />
                </li>
                <li>
                  <ExploreLink
                    href={tradeIdeasHref}
                    icon={Handshake}
                    label="Trade Ideas"
                    hint="Deals worth offering, and any deal you want checked"
                  />
                </li>
                <li>
                  <ExploreLink
                    href={transactionsHref}
                    icon={ArrowLeftRight}
                    label="Transactions"
                    hint="Trades, waivers, and FAAB moves"
                  />
                </li>
              </ul>
            </Panel>
          </aside>
        </div>
      ) : (
        // Teams: no rail at all. The masthead already carries the league
        // identity, so the rosters get the full dashboard width.
        <Suspense fallback={<RankingsSkeleton />}>
          <TeamsPanel
            leagueRowId={league.id}
            sleeperLeagueId={sleeperLeagueId}
            formatSlug={formatSlug}
            sourceSlug={sourceSlug}
            searchedUsername={searchedUsername}
            focusedRosterId={focusedRosterId}
            leagueSeason={league.season != null ? String(league.season) : null}
            leagueStatus={league.status ?? null}
            includePicks={includePicks}
            showPicksToggle={showPicksToggle}
            isDynasty={isDynasty}
            resynced={!pulseResult.cached}
          />
        </Suspense>
      )}
    </LeagueShell>
  );
}

/**
 * Placeholder for a panel that is still loading. Announced politely so a screen
 * reader hears that work is in progress rather than sitting on silence, and
 * replaced in place the moment the real panel streams in.
 */
/**
 * The Power Pulse favorite card, with its own read, inside its own boundary.
 *
 * Opens its own cookie-bound client rather than taking one as a prop, so the
 * card can sit inside a Suspense boundary that resolves independently of
 * everything else in the rail. loadPulseFavorite is React-cached and keyed on
 * primitives, so a render that mounts this twice still issues one set of
 * queries.
 *
 * READ ONLY. Power Pulse is recomputed on demand through pulseLeague, gated by
 * its own TTL (CLAUDE.md), and DerivedWork on this page already runs that. This
 * component never computes; it renders whatever the last run wrote, or nothing.
 */
async function PulseFavoriteSection({
  leagueRowId,
  season,
  powerPulseHref,
}: {
  leagueRowId: string;
  season: number;
  powerPulseHref: string;
}) {
  const supabase = await createClient();
  const favorite = await loadPulseFavorite(supabase, leagueRowId, season);
  if (!favorite) return null;
  return <PulseFavoriteCard favorite={favorite} powerPulseHref={powerPulseHref} />;
}

/**
 * The two-up findings row under the power rankings table.
 *
 * Transactions by team on the left, the Power Pulse superlatives on the right,
 * fifty-fifty from lg up and stacked below it. When only one of the two has
 * anything to say it takes the full width rather than leaving a hole, and when
 * neither does the row does not render at all: a league that has made no moves
 * and has no Power Pulse rows yet is better served by the table above it alone
 * than by two panels explaining their own emptiness.
 *
 * WHY IT AWAITS pulseLeagueDerived. The awards read rows that the derived pass
 * writes, and this boundary starts at the same moment the rankings one does. On
 * a league's first open the cache is empty until that pass finishes, so without
 * this await the panel would decide the league has no leaders and render
 * nothing on exactly the load where the reader is watching. pulseLeagueDerived
 * coalesces per league in-process, so this shares the rankings table's
 * execution rather than starting a second sync.
 *
 * includePositionalWar: false, for the same reason every other caller on this
 * page passes it: the curve belongs to the rail card's boundary, which owns
 * that compute.
 */
async function OverviewInsights({
  leagueRowId,
  leagueSeason,
  formatSlug,
  sourceSlug,
  searchedUsername,
  focusedRosterId,
  transactionsHref,
  resynced,
}: {
  leagueRowId: string;
  leagueSeason: string | null;
  formatSlug: string | null;
  sourceSlug: string | null;
  searchedUsername: string | null;
  focusedRosterId: number | null;
  transactionsHref: string;
  resynced: boolean;
}) {
  await pulseLeagueDerived(createAdminClient(), leagueRowId, {
    resynced,
    includePositionalWar: false,
  });

  const supabase = await createClient();

  const formatConfigId = formatSlug
    ? ((await supabase.from("format_configs").select("id").eq("slug", formatSlug).maybeSingle())
        .data?.id ?? null)
    : null;

  const [volume, candidates, pulseView] = await Promise.all([
    loadTransactionVolume(supabase, leagueRowId),
    loadViewerCandidates(supabase, leagueRowId),
    leagueSeason
      ? loadPowerPulseView(supabase, leagueRowId, Number(leagueSeason), formatConfigId, sourceSlug)
      : Promise.resolve(null),
  ]);

  const leaders = buildPulseLeaders(pulseView?.teams ?? []);
  // A league can hold transactions and no roster rows for a moment during a
  // cold sync, and a bar chart with no bars is not a chart.
  const showVolume = volume.leagueTotal > 0 && volume.teams.length > 0;
  const showLeaders = leaders.length > 0;
  if (!showVolume && !showLeaders) return null;

  const both = showVolume && showLeaders;

  return (
    // items-start, so the shorter panel keeps its own height instead of
    // stretching to match the taller one and ending in dead space.
    <div className={both ? "grid items-start gap-6 lg:grid-cols-2" : "grid gap-6"}>
      {showVolume && (
        <TransactionVolumePanel
          volume={volume}
          viewerRosterId={matchViewerRoster(candidates, searchedUsername, focusedRosterId)}
          transactionsHref={transactionsHref}
        />
      )}
      {showLeaders && (
        <Panel
          eyebrow="Superlatives"
          title="League leaders"
          helper="The things a rankings table cannot tell you."
        >
          {/* One card per row once this panel is sharing the column. The
              default three-across assumes the full width of the Power Pulse
              tab's main column, which is roughly four times what it gets
              here. */}
          <PulseLeaders
            leaders={leaders}
            columnsClassName={both ? "sm:grid-cols-2 lg:grid-cols-1" : "sm:grid-cols-2 xl:grid-cols-3"}
          />
        </Panel>
      )}
    </div>
  );
}

/**
 * The activity log on the overview.
 *
 * Capped and scrolling here, full length on `/leagues/[id]/activity`. Both
 * render the same panel from the same loader, so the two can never disagree
 * about what happened in a league.
 *
 * Every filter link points back at this page and carries the params that must
 * survive the hop (`username`, `source`), plus the fragment that lands focus on
 * the panel heading rather than merely scrolling to it.
 */
async function ActivitySection({
  leagueRowId,
  sleeperLeagueId,
  searchedUsername,
  days,
  category,
  rosterId,
  fullHref,
  sourceParam,
  rankParam,
  picksParam,
}: {
  leagueRowId: string;
  sleeperLeagueId: string;
  searchedUsername: string | null;
  days: number;
  category: ActivityCategory | null;
  rosterId: number | null;
  fullHref: string;
  sourceParam: string | null;
  rankParam: string | null;
  picksParam: string | null;
}) {
  const supabase = await createClient();
  const loaded = await loadLeagueActivity(supabase, {
    leagueRowId,
    sleeperLeagueId,
    days,
    category,
    rosterId,
    limit: ACTIVITY_PANEL_ROWS,
    searchedUsername,
  });

  // EVERY PARAM THE PAGE READS HAS TO SURVIVE A FILTER CLICK. `rank` and `picks`
  // belong to the rankings table below, and dropping them meant pressing an
  // activity chip silently re-sorted that table under the reader, unannounced,
  // with focus already moved up to the panel heading.
  const carry: Record<string, string> = {};
  if (searchedUsername) carry.username = searchedUsername;
  if (sourceParam) carry.source = sourceParam;
  if (rankParam) carry.rank = rankParam;
  if (picksParam) carry.picks = picksParam;
  if (days !== ACTIVITY_DEFAULT_DAYS) carry.adays = days === 0 ? "all" : String(days);
  if (rosterId != null) carry.ateam = String(rosterId);

  return (
    <LeagueActivityPanel
      id="league-activity"
      loaded={loaded}
      days={days}
      scrollable
      fullHref={fullHref}
      // The rankings panel is what follows the log on this page. Its heading is
      // focusable, so the skip link moves focus rather than only scrolling.
      skipHref="#pr-title"
      filters={{
        basePath: `/leagues/${sleeperLeagueId}`,
        carry,
        anchor: "#league-activity-title",
        category,
        available: loaded.availableCategories,
        rosterId,
        teams: loaded.teams,
        // Twelve team chips would double the height of the filter bar in a
        // panel whose whole job is to show entries. They live on the full page.
        showTeams: false,
      }}
    />
  );
}

function ActivitySkeleton() {
  // `role="status"` with hidden text, not `aria-hidden`. A pulsing box tells a
  // sighted reader that something is coming and a screen-reader user nothing at
  // all, so without this they find a gap where the feed should be.
  return (
    <div
      role="status"
      className="h-64 animate-pulse rounded-modal border border-line bg-surface/40"
    >
      <span className="sr-only">Loading league activity</span>
    </div>
  );
}

function RankingsSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-card border border-line bg-surface p-6"
    >
      <p className="text-sm text-ink-muted">Loading rankings</p>
      <div aria-hidden="true" className="mt-4 space-y-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded-card bg-base/60" />
        ))}
      </div>
    </div>
  );
}

function ExploreLink({
  href,
  icon: Icon,
  label,
  hint,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-11 items-center gap-3 rounded-card border border-line bg-base/50 px-3 py-2.5 transition-colors hover:border-brand-cyan/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
    >
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="block truncate text-xs text-ink-subtle">{hint}</span>
      </span>
      <ArrowRight
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-ink-subtle transition-colors group-hover:text-brand-cyan"
      />
    </Link>
  );
}

async function TeamsPanel({
  leagueRowId,
  sleeperLeagueId,
  formatSlug,
  sourceSlug,
  searchedUsername,
  focusedRosterId,
  leagueSeason,
  leagueStatus,
  includePicks,
  showPicksToggle,
  isDynasty,
  resynced,
}: {
  leagueRowId: string;
  sleeperLeagueId: string;
  formatSlug: string | null;
  sourceSlug: string | null;
  searchedUsername: string | null;
  focusedRosterId: number | null;
  leagueSeason: string | null;
  leagueStatus: string | null;
  includePicks: boolean;
  showPicksToggle: boolean;
  /** Derived from the league's own Sleeper settings, never the global format
   * toggle. Decides which players the roster cut mark is willing to name. */
  isDynasty: boolean;
  /** True when the core sync just contacted Sleeper, so history needs a pull. */
  resynced: boolean;
}) {
  // Values, rankings, and the schedule land here, not in the page shell. The
  // header is already on screen while this runs.
  // includePositionalWar: false. The Teams tab renders no Positional WAR at
  // all, so a curve computed here is work nothing on this tab reads.
  await pulseLeagueDerived(createAdminClient(), leagueRowId, {
    resynced,
    includePositionalWar: false,
  });

  const supabase = await createClient();

  // Readiness reads the synced schedule, so it has to be resolved after the
  // derived pass rather than alongside the page shell.
  const readiness = await loadLeagueReadiness(
    supabase,
    leagueRowId,
    Number(leagueSeason ?? 0),
    leagueStatus,
  );

  const formatConfigId = formatSlug
    ? (await supabase.from("format_configs").select("id").eq("slug", formatSlug).maybeSingle()).data?.id ?? null
    : null;

  const [teams, pulseView] = await Promise.all([
    loadLeagueTeamCards(
      supabase,
      leagueRowId,
      formatConfigId,
      sourceSlug,
      leagueSeason,
      leagueStatus,
      includePicks,
    ),
    readiness.preDraft || !leagueSeason
      ? Promise.resolve(null)
      : loadPowerPulseView(
          supabase,
          leagueRowId,
          Number(leagueSeason),
          formatConfigId,
          sourceSlug,
        ),
  ]);
  if (teams.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No rosters synced yet. Try refreshing in a moment.
      </p>
    );
  }

  // Contender / Bubble / Rebuilder per roster, so a team card
  // carries the same tag the rankings table and the league list show.
  const statusByRoster: Record<string, TeamStatus> = {};
  for (const t of pulseView?.teams ?? []) {
    if (t.status) statusByRoster[t.rosterRowId] = t.status;
  }

  return (
    <section aria-labelledby="teams-heading" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="teams-heading" className="text-2xl font-semibold tracking-tight">
          Teams ({teams.length})
        </h2>
        {searchedUsername && (
          <p className="text-xs text-ink-subtle">
            Defaulting to <span className="font-medium text-ink">@{searchedUsername}</span>.
            Tap other team chips to compare side-by-side.
          </p>
        )}
      </div>
      {readiness.preDraft && (
        <PreDraftNotice
          readiness={readiness}
          teams={[]}
          season={leagueSeason}
          variant="inline"
        />
      )}
      {showPicksToggle && (
        <div className="flex justify-start">
          <PicksToggle includePicks={includePicks} />
        </div>
      )}
      <TeamFilter
        teams={teams}
        sleeperLeagueId={sleeperLeagueId}
        searchedUsername={searchedUsername}
        focusedRosterId={focusedRosterId}
        valueIsBeacon={sourceSlug === "ffbeacon"}
        statusByRoster={statusByRoster}
        sourceSlug={sourceSlug}
        isDynasty={isDynasty}
      />
    </section>
  );
}

async function PowerRankingsSection({
  leagueRowId,
  sleeperLeagueId,
  formatSlug,
  sourceSlug,
  formatDisplay,
  sourceDisplay,
  leagueSeason,
  leagueStatus,
  searchedUsername,
  includePicks,
  showPicksToggle,
  rankMode,
  powerPulseHref,
  resynced,
}: {
  leagueRowId: string;
  sleeperLeagueId: string;
  formatSlug: string | null;
  sourceSlug: string | null;
  formatDisplay: string;
  sourceDisplay: string;
  leagueSeason: string | null;
  leagueStatus: string | null;
  searchedUsername: string | null;
  includePicks: boolean;
  showPicksToggle: boolean;
  /** Requested row order. Falls back to value when Power Pulse has no rows. */
  rankMode: RankMode;
  /** Link to the full Power Pulse tab, with the searched handle forwarded. */
  powerPulseHref: string;
  /** True when the core sync just contacted Sleeper, so history needs a pull. */
  resynced: boolean;
}) {
  // Values, rankings, and the schedule land here, not in the page shell. The
  // header is already on screen while this runs.
  //
  // includePositionalWar: false. THIS is the boundary that shows the rankings
  // table, and a cold curve costs about ten seconds. The flag and the comment
  // explaining it have been sitting on TeamsPanel since the feature shipped,
  // which renders no rankings table and no curve, so the call that actually
  // needed the flag never had it and the overview's primary content waited on
  // a Positional WAR compute on every cold fingerprint. The rail card owns
  // that compute now, behind its own boundary; see
  // components/league-war/positional-war-section.tsx WarRailSection.
  await pulseLeagueDerived(createAdminClient(), leagueRowId, {
    resynced,
    includePositionalWar: false,
  });

  const supabase = await createClient();

  // Readiness reads the synced schedule, so it has to be resolved after the
  // derived pass rather than alongside the page shell. Pre-draft leagues get a
  // listing with a warning, not a ranking.
  const readiness = await loadLeagueReadiness(
    supabase,
    leagueRowId,
    Number(leagueSeason ?? 0),
    leagueStatus,
  );

  if (readiness.preDraft) {
    return (
      <PreDraftRoster
        leagueRowId={leagueRowId}
        leagueSeason={leagueSeason}
        leagueStatus={leagueStatus}
        readiness={readiness}
      />
    );
  }

  if (!sourceSlug || !formatSlug) {
    return (
      <p className="text-sm text-ink-muted">
        No values available for this league's format.
      </p>
    );
  }

  const { data: formatRow } = await supabase
    .from("format_configs")
    .select("id")
    .eq("slug", formatSlug)
    .maybeSingle();

  if (!formatRow) {
    return (
      <p className="text-sm text-ink-muted">
        Unknown format <span className="font-mono">{formatSlug}</span>.
      </p>
    );
  }

  // Reuse the same loader the Teams tab uses. It already computes per-position
  // ranks across the league, so the table can render them directly without
  // re-fetching or re-deriving.
  const [teams, pulseView] = await Promise.all([
    loadLeagueTeamCards(
      supabase,
      leagueRowId,
      formatRow.id,
      sourceSlug,
      leagueSeason,
      leagueStatus,
      includePicks,
    ),
    leagueSeason
      ? loadPowerPulseView(supabase, leagueRowId, Number(leagueSeason), formatRow.id, sourceSlug)
      : Promise.resolve(null),
  ]);

  // Power Pulse, keyed by roster row id so it can decorate the value rows.
  const pulseByRoster = new Map(
    (pulseView?.teams ?? []).map((t) => [t.rosterRowId, t]),
  );
  const pulseAvailable = pulseByRoster.size > 0;
  // Power Pulse is the default ordering: a "power ranking" should rank by who
  // wins games. `?rank=value` restores the pure trade-value ordering, which is
  // still a question people legitimately want answered.
  const effectiveMode: RankMode = rankMode === "value" || !pulseAvailable ? "value" : "pulse";

  const ranked = teams
    .filter((t) => t.displayOverallRank != null)
    .sort((a, b) => {
      if (effectiveMode === "pulse") {
        const ap = pulseByRoster.get(a.rosterRowId)?.pulseRank ?? Number.MAX_SAFE_INTEGER;
        const bp = pulseByRoster.get(b.rosterRowId)?.pulseRank ?? Number.MAX_SAFE_INTEGER;
        if (ap !== bp) return ap - bp;
      }
      return (
        (a.displayOverallRank ?? Number.MAX_SAFE_INTEGER) -
        (b.displayOverallRank ?? Number.MAX_SAFE_INTEGER)
      );
    });

  if (ranked.length === 0) {
    return (
      <Panel
        id="pr"
        headingFocusable
        eyebrow="Standings"
        title="Power Rankings"
        helper={`${formatDisplay}, ${sourceDisplay}`}
      >
        <p className="text-sm text-ink-muted">
          No cached power rankings yet for {formatDisplay} via {sourceDisplay}. The cache
          builds during the next sync; refresh in a moment, or run{" "}
          <span className="font-mono text-ink">
            npm run calculate:power-rankings -- --sleeper-league-id {sleeperLeagueId}
          </span>{" "}
          locally to backfill.
        </p>
      </Panel>
    );
  }

  const teamCount = teams.length;
  const valueRankByRoster = new Map(
    ranked
      .slice()
      .sort(
        (a, b) =>
          (a.displayOverallRank ?? Number.MAX_SAFE_INTEGER) -
          (b.displayOverallRank ?? Number.MAX_SAFE_INTEGER),
      )
      .map((t, i) => [t.rosterRowId, i + 1]),
  );

  // Short on purpose. The table's own columns and the sr-only caption below
  // carry the detail; this line only has to say what the order means and where
  // the numbers came from.
  const helper =
    effectiveMode === "pulse"
      ? `Expected performance from here, in this league's scoring. Team value ${includePicks ? "with" : "without"} picks, via ${sourceDisplay}.`
      : `Ranked by team value${includePicks ? "" : ", picks excluded"}. ${formatDisplay}, ${sourceDisplay}.`;

  return (
    <Panel
      id="pr"
      headingFocusable
      eyebrow="Standings"
      title="Power Rankings"
      helper={helper}
      bodyClassName="p-0"
      action={
        pulseAvailable ? (
          // Small on purpose, and sitting across from the heading rather than
          // under it. A 44px-tall pill here was the widest thing in the panel
          // header on a phone and pushed the table down for it.
          //
          // The visible pill is about 24px tall; the transparent ::after
          // stretches the tap target back to 44 without adding any bulk to the
          // layout. The header padding above and below is empty, so the larger
          // target has nothing to steal a tap from.
          <Link
            href={powerPulseHref}
            className="relative inline-flex items-center gap-1 rounded-card border border-brand-cyan/45 bg-brand-cyan/10 px-2 py-1 text-[11px] font-semibold text-brand-cyan transition-colors after:absolute after:inset-x-0 after:-inset-y-3 after:content-[''] hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:px-3 sm:py-1.5 sm:text-xs sm:after:hidden"
          >
            Full Power Pulse
            <span aria-hidden="true">→</span>
          </Link>
        ) : undefined
      }
    >
      {/* One row, never two. The rank toggle takes the full width on its own,
          and splits it in half with the draft picks switch when that is on
          screen.

          Draft picks only matter to the value ordering. Power Pulse is a
          competitive score that never counts a pick, so the switch would be a
          control with nothing to do while that mode is selected. It appears
          when the reader switches to team value. */}
      <div className="flex items-stretch gap-2 border-b border-line px-4 py-3 sm:flex-wrap sm:items-center sm:gap-3 sm:px-5">
        <RankModeToggle mode={effectiveMode} pulseAvailable={pulseAvailable} />
        {showPicksToggle && effectiveMode === "value" && (
          <PicksToggle includePicks={includePicks} />
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            League power rankings, ordered by{" "}
            {effectiveMode === "pulse" ? "Power Pulse" : "team value"}. Columns:
            rank, team, Power Pulse score, whether the team is competing,
            mid-table, or rebuilding, positional rank (QB, RB, WR, TE
            {includePicks ? ", Picks" : ""}), then total team value
            {includePicks ? "" : " counting players only"} with its league rank.
            Top three for each position column are highlighted cyan; bottom three
            are highlighted purple.
          </caption>
          <thead className="bg-surface text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <th scope="col" className="w-px whitespace-nowrap px-2 py-3 text-center">
                Rank
              </th>
              <th scope="col" className="px-3 py-3">
                Team
              </th>
              <th scope="col" className="px-2 py-3 text-center">
                Pulse
              </th>
              <th scope="col" className="hidden px-3 py-3 text-left md:table-cell">
                Outlook
              </th>
              <th scope="col" className="hidden px-3 py-3 text-center md:table-cell">
                QB
              </th>
              <th scope="col" className="hidden px-3 py-3 text-center md:table-cell">
                RB
              </th>
              <th scope="col" className="hidden px-3 py-3 text-center md:table-cell">
                WR
              </th>
              <th scope="col" className="hidden px-3 py-3 text-center md:table-cell">
                TE
              </th>
              {includePicks && (
                <th scope="col" className="hidden px-4 py-3 text-center md:table-cell">
                  Picks
                </th>
              )}
              <th scope="col" className="hidden px-4 py-3 text-right md:table-cell">
                Value
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ranked.map((t, i) => (
              <PowerRankingsRow
                key={t.rosterRowId}
                sleeperLeagueId={sleeperLeagueId}
                searchedUsername={searchedUsername}
                teamCount={teamCount}
                valueIsBeacon={sourceSlug === "ffbeacon"}
                showPicks={includePicks}
                data={{
                  rosterRowId: t.rosterRowId,
                  sleeperRosterId: t.sleeperRosterId,
                  teamName: t.teamName,
                  ownerHandle: t.ownerSleeperUsername,
                  ownerAvatarId: t.ownerAvatarId,
                  // The leading rank column follows whichever mode is active.
                  overallRank:
                    effectiveMode === "pulse"
                      ? pulseByRoster.get(t.rosterRowId)?.pulseRank ?? i + 1
                      : t.displayOverallRank,
                  powerPulse: pulseByRoster.get(t.rosterRowId)?.powerPulse ?? null,
                  pulseRank: pulseByRoster.get(t.rosterRowId)?.pulseRank ?? null,
                  valueRank: valueRankByRoster.get(t.rosterRowId) ?? null,
                  status: pulseByRoster.get(t.rosterRowId)?.status ?? null,
                  positionRanks: {
                    QB: t.positionRanks.QB,
                    RB: t.positionRanks.RB,
                    WR: t.positionRanks.WR,
                    TE: t.positionRanks.TE,
                    PICKS: t.statRanks.picks,
                  },
                  record: {
                    wins: t.record.wins,
                    losses: t.record.losses,
                    ties: t.record.ties,
                  },
                  totalValue: t.displayTotalValue,
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}


/**
 * The overview's stand-in for the rankings table before a league has drafted.
 *
 * The teams are still listed, which is what the reader came for, but nothing
 * is ranked and the notice above says so in as many words. Sorting by name
 * rather than by any cached number is deliberate: an alphabetical list cannot
 * be mistaken for a standings table the way a numbered one can.
 */
async function PreDraftRoster({
  leagueRowId,
  leagueSeason,
  leagueStatus,
  readiness,
}: {
  leagueRowId: string;
  leagueSeason: string | null;
  leagueStatus: string | null;
  readiness: LeagueReadiness;
}) {
  const supabase = await createClient();
  const teams = await loadLeagueTeamCards(
    supabase,
    leagueRowId,
    null,
    null,
    leagueSeason,
    leagueStatus,
    false,
  );

  return (
    <div className="space-y-6">
      <PreDraftNotice
        readiness={readiness}
        teams={[]}
        season={leagueSeason}
        variant="inline"
      />
      <Panel
        id="pr"
        headingFocusable
        eyebrow="Standings"
        title="Power Rankings"
        helper="Listed alphabetically. There is no ranking to show until the draft finishes and the schedule posts."
        bodyClassName="p-0"
      >
        {teams.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-muted sm:px-5">
            No rosters synced yet. Try refreshing in a moment.
          </p>
        ) : (
          <ul role="list" className="divide-y divide-line">
            {[...teams]
              .sort((a, b) => a.teamName.localeCompare(b.teamName))
              .map((t) => (
                <li
                  key={t.rosterRowId}
                  className="flex items-center gap-3 px-4 py-3 sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {t.teamName}
                    </span>
                    {t.ownerSleeperUsername && (
                      <span className="block truncate text-[11px] text-ink-subtle">
                        @{t.ownerSleeperUsername}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-ink-subtle">
                    {t.record.wins}-{t.record.losses}
                    {t.record.ties ? `-${t.record.ties}` : ""}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const secs = Math.round(diffMs / 1000);
  if (secs < 60) return `${secs} seconds ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
