import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { pulseLeague } from "@/lib/league-pulse";
import { resolveSourceSlug } from "@/lib/preferences";
import {
  resolveLeagueContext,
  describeDerived,
} from "@/lib/league-format-resolution";
import { loadLeagueTeamCards } from "@/lib/league-view-data";
import { type SleeperLeague } from "@/lib/sleeper";
import { loadLeagueHeaderActions } from "@/lib/league-header-data";
import { TeamFilter } from "@/components/team-filter";
import { LeagueLoadError } from "@/components/league-load-error";
import { LeagueBreadcrumb } from "@/components/league-breadcrumb";
import { LeagueHeaderActions } from "@/components/league-header-actions";
import { LeagueTabs } from "@/components/league-tabs";
import { PowerRankingsRow } from "@/components/power-rankings-row";
import { PicksToggle } from "@/components/picks-toggle";
import { Panel, StatReadout } from "@/components/dashboard-panel";
import { LeagueInfoPanel, LeagueMetaLine } from "@/components/league-info-panel";
import {
  buildLeagueFormatTags,
  buildLeagueScoringTags,
} from "@/lib/league-format-tags";
import Link from "next/link";
import {
  Users,
  ArrowLeftRight,
  ArrowRight,
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
  }>;
}) {
  const { league_id: sleeperLeagueId } = await params;
  const {
    tab: tabParam,
    source: sourceParam,
    username: usernameParam,
    roster: rosterParam,
    picks: picksParam,
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

  // First-touch pulse: idempotent, internally cached for 10 minutes.
  const adminClient = createAdminClient();
  const pulseResult = await pulseLeague(adminClient, sleeperLeagueId);

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

  // In-view links (username forwarded so the Teams chips default correctly).
  const teamsHref = searchedUsername
    ? `/leagues/${sleeperLeagueId}?tab=teams&username=${encodeURIComponent(searchedUsername)}`
    : `/leagues/${sleeperLeagueId}?tab=teams`;
  const transactionsHref = searchedUsername
    ? `/leagues/${sleeperLeagueId}/transactions?username=${encodeURIComponent(searchedUsername)}`
    : `/leagues/${sleeperLeagueId}/transactions`;

  // Shared props for the league info card, rendered as a left rail on Overview
  // and as a full-width horizontal band on Teams (so the rosters get full width).
  const infoPanelProps = {
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
    <main id="main">
      <header className="relative overflow-hidden border-b border-line">
        {/* Beacon-gradient accent bar, matching the On The Clock command strip. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
          }}
        />
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {/* Slim header: breadcrumb + actions only. The league name (page h1)
              and all league context now live in the highlighted LeagueInfoPanel
              in the sidebar. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <LeagueBreadcrumb
              homeHref={backHref}
              crumbs={[{ label: league.name }]}
            />
            <LeagueHeaderActions
              sleeperLeagueId={sleeperLeagueId}
              copyHref={`/leagues/${sleeperLeagueId}`}
              copyAriaLabel="Copy link to this league"
              otherLeagues={otherLeagues}
              searchedUsername={searchedUsername}
            />
          </div>

          {/* League identity + context now lives in the left sidebar
              (LeagueInfoPanel) to keep the header compact. Only a true refresh
              error stays here, surfaced prominently as a page-level alert. */}
          {league.pulse_status === "error" && league.pulse_error && (
            <p
              role="alert"
              className="mt-4 rounded-card border border-signal-danger/40 bg-signal-danger/10 p-3 text-sm text-signal-danger"
            >
              Last refresh failed: {league.pulse_error}
            </p>
          )}
        </div>
      </header>

      <LeagueTabs
        sleeperLeagueId={sleeperLeagueId}
        activeTab={activeTab}
        searchedUsername={searchedUsername}
      />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {activeTab === "overview" ? (
          // Overview: league info + quick panels in a LEFT rail, power rankings
          // on the RIGHT. The rail stacks above the content below xl.
          <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
            <aside
              aria-label="League information and links"
              className="space-y-6 xl:sticky xl:top-8 xl:self-start"
            >
              <LeagueInfoPanel layout="sidebar" {...infoPanelProps} />

              <Panel eyebrow="At a glance" title="Snapshot">
                <dl className="grid grid-cols-3 gap-2">
                  <StatReadout
                    label="Rosters"
                    value={String(pulseResult.counts.rosters)}
                    accent="cyan"
                  />
                  <StatReadout
                    label="Members"
                    value={String(pulseResult.counts.users)}
                    accent="purple"
                  />
                  <StatReadout
                    label="Transactions"
                    value={String(pulseResult.counts.transactions)}
                    accent="ink"
                  />
                </dl>
              </Panel>

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
                      href={transactionsHref}
                      icon={ArrowLeftRight}
                      label="Transactions"
                      hint="Trades, waivers, and FAAB moves"
                    />
                  </li>
                </ul>
              </Panel>
            </aside>

            <div className="min-w-0 space-y-6">
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
              />
            </div>
          </div>
        ) : (
          // Teams: the league info becomes a full-width horizontal band on top,
          // so the rosters below can use the full page width. The last-updated /
          // value meta drops out of the band and renders as one discreet line.
          <div className="space-y-6">
            <div>
              <LeagueInfoPanel
                layout="horizontal"
                showFooter={false}
                {...infoPanelProps}
              />
              <div className="mt-2 px-1">
                <LeagueMetaLine
                  lastUpdatedLabel={lastPulsedLabel}
                  cached={pulseResult.cached}
                  coverage={context.coverage}
                  sourceDisplay={sourceDisplay}
                  formatDisplay={formatDisplay}
                  derivedLabel={derivedLabel}
                  fallbackDisplay={fallbackDisplay}
                  pickSourceDisplay={pickSourceDisplay}
                />
              </div>
            </div>
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
            />
          </div>
        )}
      </div>
    </main>
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
}) {
  const supabase = await createClient();

  const formatConfigId = formatSlug
    ? (await supabase.from("format_configs").select("id").eq("slug", formatSlug).maybeSingle()).data?.id ?? null
    : null;

  const teams = await loadLeagueTeamCards(
    supabase,
    leagueRowId,
    formatConfigId,
    sourceSlug,
    leagueSeason,
    leagueStatus,
    includePicks,
  );
  if (teams.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No rosters synced yet. Try refreshing in a moment.
      </p>
    );
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
}) {
  const supabase = await createClient();

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
  const teams = await loadLeagueTeamCards(
    supabase,
    leagueRowId,
    formatRow.id,
    sourceSlug,
    leagueSeason,
    leagueStatus,
    includePicks,
  );
  const ranked = teams
    .filter((t) => t.displayOverallRank != null)
    .sort(
      (a, b) =>
        (a.displayOverallRank ?? Number.MAX_SAFE_INTEGER) -
        (b.displayOverallRank ?? Number.MAX_SAFE_INTEGER),
    );

  if (ranked.length === 0) {
    return (
      <Panel
        eyebrow="Standings"
        title="Power Rankings"
        helper={`${formatDisplay} • ${sourceDisplay}`}
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

  return (
    <Panel
      id="pr"
      eyebrow="Standings"
      title="Power Rankings"
      helper={`Ranked by ${
        includePicks ? "total team value" : "player value (draft picks excluded)"
      }. ${formatDisplay} • ${sourceDisplay}.`}
      bodyClassName="p-0"
    >
      {showPicksToggle && (
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <PicksToggle includePicks={includePicks} />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            League power rankings. Columns: overall rank, team, positional rank
            (QB, RB, WR, TE{includePicks ? ", Picks" : ""}), then total team
            value{includePicks ? "" : " counting players only"}. Top three for
            each position column are highlighted cyan; bottom three are
            highlighted purple.
          </caption>
          <thead className="bg-surface text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <th scope="col" className="w-px whitespace-nowrap px-2 py-3 text-center">
                Rank
              </th>
              <th scope="col" className="px-3 py-3">
                Team
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
            {ranked.map((t) => (
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
                  overallRank: t.displayOverallRank,
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
