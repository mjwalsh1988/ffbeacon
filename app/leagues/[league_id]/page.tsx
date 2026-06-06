import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { pulseLeague } from "@/lib/league-pulse";
import { resolveSourceSlug } from "@/lib/preferences";
import {
  resolveLeagueContext,
  describeDerived,
  type LeagueContext,
} from "@/lib/league-format-resolution";
import { loadLeagueTeamCards } from "@/lib/league-view-data";
import { loadLeagueTransactions } from "@/lib/league-transactions-data";
import { getLeagueAdminContext } from "@/lib/league-auth";
import { humanizeLeagueStatus } from "@/lib/league-status";
import { currentNflSeason, type SleeperLeague } from "@/lib/sleeper";
import { loadUserOtherLeagues } from "@/lib/league-switcher-data";
import { TeamFilter } from "@/components/team-filter";
import { TransactionRow } from "@/components/transaction-row";
import { CopyLinkButton } from "@/components/copy-link-button";
import { RefreshButton } from "@/components/refresh-button";
import { LeagueLoadError } from "@/components/league-load-error";
import { LeagueSwitcher } from "@/components/league-switcher";
import { PowerRankingsRow } from "@/components/power-rankings-row";
import {
  buildLeagueFormatTags,
  type FormatTag,
} from "@/lib/league-format-tags";
import {
  CalendarDays,
  Users,
  Trophy,
  Activity,
  ClipboardList,
  ArrowLeftRight,
  ChevronRight,
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

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "teams", label: "Teams" },
  { id: "transactions", label: "Transactions" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTab(value: string | undefined): value is TabId {
  return TABS.some((t) => t.id === value);
}

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
  }>;
}) {
  const { league_id: sleeperLeagueId } = await params;
  const {
    tab: tabParam,
    source: sourceParam,
    username: usernameParam,
    roster: rosterParam,
  } = await searchParams;
  const activeTab: TabId = isTab(tabParam) ? tabParam : "overview";
  const searchedUsername =
    typeof usernameParam === "string" && usernameParam.trim() ? usernameParam.trim() : null;
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

  // Admin / commissioner check gates the Refresh button.
  const adminCtx = await getLeagueAdminContext(supabase, league.id);

  // Breadcrumb back-link. Forward the searched handle so the logo crumb lands
  // the user back on their own league results, not a blank search form.
  const backHref = searchedUsername
    ? `/tools/league-pulse?username=${encodeURIComponent(searchedUsername)}`
    : "/tools/league-pulse";

  // Tab links preserve the searched handle so the in-view league switcher and
  // the Teams-tab owner default survive tab navigation. Without this, clicking
  // any tab drops ?username= and the switcher disappears mid-browse, regardless
  // of whether the user arrived from the public tool or their dashboard.
  const tabHref = (tabId: TabId): string => {
    const qs = new URLSearchParams({ tab: tabId });
    if (searchedUsername) qs.set("username", searchedUsername);
    return `/leagues/${sleeperLeagueId}?${qs.toString()}`;
  };

  // League switcher data: the searched user's OTHER leagues for this season,
  // so they can hop between leagues without returning to /tools/league-pulse.
  // Only fetched when we know which user was searched (forwarded via ?username=).
  const otherLeagues = searchedUsername
    ? await loadUserOtherLeagues(
        supabase,
        league.id,
        sleeperLeagueId,
        searchedUsername,
        league.season != null ? String(league.season) : currentNflSeason(),
      )
    : [];

  const lastPulsed = league.last_pulsed_at ? new Date(league.last_pulsed_at) : null;
  const lastPulsedLabel = lastPulsed ? formatRelative(lastPulsed) : "never";

  return (
    <main id="main">
      <header className="border-b border-line">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          {/* Grid so the source order (breadcrumb → buttons → name) is the
              mobile stacking order, while sm+ reflows to a two-column layout:
              breadcrumb + name in the left column, buttons top-right. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-6">
            <nav
              aria-label="Breadcrumb"
              className="min-w-0 sm:col-start-1 sm:row-start-1"
            >
              <ol className="flex items-center gap-1.5 text-sm">
                <li className="flex items-center">
                  <Link
                    href={backHref}
                    title="Back to League Pulse"
                    aria-label="Back to League Pulse home"
                    className="inline-flex items-center rounded-card p-0.5 transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/img/ff-beacon-logo.png"
                      alt=""
                      width={20}
                      height={20}
                      style={{ width: 20, height: 20 }}
                      className="flex-shrink-0 rounded-sm"
                    />
                  </Link>
                </li>
                <li aria-hidden="true" className="flex items-center text-ink-subtle">
                  <ChevronRight className="h-4 w-4" />
                </li>
                <li className="min-w-0">
                  <span
                    aria-current="page"
                    className="block truncate text-ink-muted"
                  >
                    {league.name}
                  </span>
                </li>
              </ol>
            </nav>
            <div className="flex flex-col gap-2 sm:col-start-2 sm:row-start-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              {/* Mobile: Switch league and Copy link share the top row (50/50
                  when both present, full width when one is absent); Refresh
                  drops to a full-width line below. sm+ dissolves this wrapper
                  via display:contents so every control sits inline, right
                  aligned. */}
              <div
                className={`grid gap-2 sm:contents ${
                  otherLeagues.length > 0 ? "grid-cols-2" : "grid-cols-1"
                }`}
              >
                {otherLeagues.length > 0 && (
                  <LeagueSwitcher
                    leagues={otherLeagues}
                    searchedUsername={searchedUsername}
                  />
                )}
                <CopyLinkButton
                  href={`/leagues/${sleeperLeagueId}`}
                  ariaLabel="Copy link to this league"
                />
              </div>
              <RefreshButton
                sleeperLeagueId={sleeperLeagueId}
                isAuthorized={adminCtx.canForceRefresh}
                mobileFullWidth
              />
            </div>
            <h1 className="min-w-0 text-3xl font-semibold tracking-tight sm:col-start-1 sm:row-start-2 sm:text-4xl">
              {league.name}
            </h1>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <InfoChip
              icon={CalendarDays}
              label="Season"
              value={<span className="font-mono">{league.season}</span>}
            />
            <InfoChip
              icon={Users}
              label="Teams"
              value={
                <span className="font-mono">{league.total_rosters ?? "?"}</span>
              }
            />
            <InfoChip
              icon={Trophy}
              label="League format"
              value={describeDerived(context.derived)}
            />
            <InfoChip
              icon={Activity}
              label="Status"
              value={<StatusPill status={league.status ?? null} />}
            />
          </dl>

          {formatTags.length > 0 && (
            <FormatTagRow tags={formatTags} />
          )}

          <p className="mt-4 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <span>
              Last updated {lastPulsedLabel}
              {pulseResult.cached ? " (served from cache)" : " (fresh from Sleeper)"}.
            </span>
            {context.coverage !== "none" && (
              <span
                title="Values are calibrated to your league's scoring rules. The global format toggle has no effect inside a league view."
                aria-describedby={`league-format-info`}
              >
                · Values via{" "}
                <span className="text-ink-muted">{context.sourceDisplay}</span> •{" "}
                <span className="text-ink-muted">{context.formatDisplay}</span>
              </span>
            )}
          </p>
          <p id="league-format-info" className="sr-only">
            Player values shown inside this league view use the format closest to your
            league's actual Sleeper scoring rules. Changing the global format toggle does
            not affect this view; switching source recalculates which format we can
            display.
          </p>

          {league.pulse_status === "error" && league.pulse_error && (
            <p
              role="alert"
              className="mt-3 rounded-card border border-signal-danger/40 bg-signal-danger/10 p-3 text-sm text-signal-danger"
            >
              Last refresh failed: {league.pulse_error}
            </p>
          )}

          {context.coverage === "fallback" && context.fallback && (
            <p
              role="status"
              className="mt-3 rounded-card border border-brand-cyan/30 bg-brand-cyan/5 p-3 text-xs text-ink-muted"
            >
              Showing values for {context.formatDisplay} because {context.sourceDisplay}{" "}
              doesn't publish data for {context.fallback.derivedDisplay}. Pick a different
              source from the header to find a closer match.
            </p>
          )}

          {context.coverage === "none" && (
            <p
              role="status"
              className="mt-3 rounded-card border border-signal-warning/40 bg-signal-warning/10 p-3 text-xs text-signal-warning"
            >
              No data source covers {describeDerived(context.derived)} yet. Players will
              still show with names; values are unavailable for this combination.
            </p>
          )}

          {context.coverage !== "none" &&
            context.pickSource &&
            context.pickSource.slug !== context.sourceSlug && (
              <p
                role="note"
                className="mt-2 text-xs text-ink-subtle"
              >
                Draft pick values powered by {context.pickSource.display} (
                {context.sourceDisplay} doesn't publish pick values).
              </p>
            )}
        </div>
      </header>

      <nav aria-label="League sections" className="border-b border-line">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <ul className="flex flex-wrap gap-1">
            {TABS.map((t) => {
              const isActive = t.id === activeTab;
              return (
                <li key={t.id}>
                  <Link
                    href={tabHref(t.id)}
                    aria-current={isActive ? "page" : undefined}
                    className={`inline-block min-h-11 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                      isActive
                        ? "border-brand-purple text-ink"
                        : "border-transparent text-ink-muted hover:text-ink"
                    }`}
                  >
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {activeTab === "overview" && (
          <OverviewPanel
            leagueRowId={league.id}
            sleeperLeagueId={sleeperLeagueId}
            counts={pulseResult.counts}
            formatSlug={context.coverage === "none" ? null : context.formatSlug}
            sourceSlug={context.coverage === "none" ? null : context.sourceSlug}
            formatDisplay={context.coverage === "none" ? "N/A" : context.formatDisplay}
            sourceDisplay={context.coverage === "none" ? "N/A" : context.sourceDisplay}
            leagueSeason={league.season != null ? String(league.season) : null}
            leagueStatus={league.status ?? null}
            searchedUsername={searchedUsername}
          />
        )}
        {activeTab === "teams" && (
          <TeamsPanel
            leagueRowId={league.id}
            sleeperLeagueId={sleeperLeagueId}
            formatSlug={context.coverage === "none" ? null : context.formatSlug}
            sourceSlug={context.coverage === "none" ? null : context.sourceSlug}
            searchedUsername={searchedUsername}
            focusedRosterId={focusedRosterId}
            leagueSeason={league.season != null ? String(league.season) : null}
            leagueStatus={league.status ?? null}
          />
        )}
        {activeTab === "transactions" && (
          <TransactionsPanel
            leagueRowId={league.id}
            sleeperLeagueId={sleeperLeagueId}
            context={context.coverage === "none" ? null : (context as LeagueContext)}
          />
        )}
      </div>
    </main>
  );
}

async function OverviewPanel({
  leagueRowId,
  sleeperLeagueId,
  counts,
  formatSlug,
  sourceSlug,
  formatDisplay,
  sourceDisplay,
  leagueSeason,
  leagueStatus,
  searchedUsername,
}: {
  leagueRowId: string;
  sleeperLeagueId: string;
  counts: { rosters: number; users: number; transactions: number };
  formatSlug: string | null;
  sourceSlug: string | null;
  formatDisplay: string;
  sourceDisplay: string;
  leagueSeason: string | null;
  leagueStatus: string | null;
  searchedUsername: string | null;
}) {
  return (
    <div className="space-y-8">
      <section aria-labelledby="snapshot-heading">
        <h2 id="snapshot-heading" className="text-2xl font-semibold tracking-tight">
          Snapshot
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-3">
          <Stat icon={ClipboardList} label="Rosters synced" value={counts.rosters} />
          <Stat icon={Users} label="Members" value={counts.users} />
          <Stat icon={ArrowLeftRight} label="Transactions" value={counts.transactions} />
        </ul>
      </section>

      <PowerRankingsSection
        leagueRowId={leagueRowId}
        sleeperLeagueId={sleeperLeagueId}
        formatSlug={formatSlug}
        sourceSlug={sourceSlug}
        formatDisplay={formatDisplay}
        sourceDisplay={sourceDisplay}
        leagueSeason={leagueSeason}
        leagueStatus={leagueStatus}
        searchedUsername={searchedUsername}
      />
    </div>
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
}: {
  leagueRowId: string;
  sleeperLeagueId: string;
  formatSlug: string | null;
  sourceSlug: string | null;
  searchedUsername: string | null;
  focusedRosterId: number | null;
  leagueSeason: string | null;
  leagueStatus: string | null;
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
      <TeamFilter
        teams={teams}
        sleeperLeagueId={sleeperLeagueId}
        searchedUsername={searchedUsername}
        focusedRosterId={focusedRosterId}
      />
    </section>
  );
}

async function TransactionsPanel({
  leagueRowId,
  sleeperLeagueId,
  context,
}: {
  leagueRowId: string;
  sleeperLeagueId: string;
  context: LeagueContext | null;
}) {
  const supabase = await createClient();
  const { rows, total } = await loadLeagueTransactions(supabase, leagueRowId, context, {
    limit: 10,
  });

  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-line bg-surface p-8 text-center">
        <h2 className="text-xl font-semibold tracking-tight">Transactions</h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-ink-muted">
          No transactions synced yet. Try refreshing the page in a moment.
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby="tx-heading" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 id="tx-heading" className="text-2xl font-semibold tracking-tight">
            Recent transactions
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Showing the latest {rows.length} of {total}.
          </p>
        </div>
        <Link
          href={`/leagues/${sleeperLeagueId}/transactions`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-3 py-2 text-sm text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline-2 focus-visible:outline-brand-cyan"
        >
          View all transactions →
        </Link>
      </div>
      <ol className="space-y-3" role="list" aria-label="Recent league transactions">
        {rows.map((row) => (
          <li key={row.sleeperTransactionId} id={`tx-${row.sleeperTransactionId}`}>
            <TransactionRow data={row} sleeperLeagueId={sleeperLeagueId} />
          </li>
        ))}
      </ol>
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
  );
  const ranked = teams
    .filter((t) => t.cacheRow?.overall_rank != null)
    .sort(
      (a, b) =>
        (a.cacheRow!.overall_rank ?? Number.MAX_SAFE_INTEGER) -
        (b.cacheRow!.overall_rank ?? Number.MAX_SAFE_INTEGER),
    );

  if (ranked.length === 0) {
    return (
      <div className="rounded-card border border-line bg-surface p-6">
        <p className="text-sm text-ink-muted">
          No cached power rankings yet for {formatDisplay} via {sourceDisplay}. The cache
          builds during the next sync; refresh in a moment, or run{" "}
          <span className="font-mono text-ink">
            npm run calculate:power-rankings -- --sleeper-league-id {sleeperLeagueId}
          </span>{" "}
          locally to backfill.
        </p>
      </div>
    );
  }

  const teamCount = teams.length;

  return (
    <section aria-labelledby="pr-heading" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="pr-heading" className="text-2xl font-semibold tracking-tight">
          Power Rankings
        </h2>
        <p className="text-xs text-ink-subtle">
          {formatDisplay} • {sourceDisplay}
        </p>
      </div>
      <div className="overflow-x-auto rounded-card border border-line">
        <table className="w-full text-sm">
          <caption className="sr-only">
            League power rankings. Columns: overall rank, team, positional rank
            (QB, RB, WR, TE, Picks), then total team value. Top three for each
            position column are highlighted cyan; bottom three are highlighted purple.
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
              <th scope="col" className="hidden px-4 py-3 text-center md:table-cell">
                Picks
              </th>
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
                data={{
                  rosterRowId: t.rosterRowId,
                  sleeperRosterId: t.sleeperRosterId,
                  teamName: t.teamName,
                  ownerHandle: t.ownerSleeperUsername,
                  ownerAvatarId: t.ownerAvatarId,
                  overallRank: t.cacheRow?.overall_rank ?? null,
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
                  totalValue: t.cacheRow?.total_value ?? null,
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
}) {
  return (
    <li className="flex items-center gap-4 rounded-card border border-line bg-surface p-5">
      <span
        aria-hidden="true"
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-line bg-base/60 text-brand-cyan"
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wider text-ink-subtle">{label}</p>
        <p className="mt-1 font-mono text-3xl font-semibold text-ink">{value}</p>
      </div>
    </li>
  );
}

function InfoChip({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-line bg-surface/60 px-4 py-3">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-line bg-base/60 text-brand-cyan"
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">
          {label}
        </p>
        <div className="mt-0.5 truncate text-sm font-medium text-ink">{value}</div>
      </div>
    </div>
  );
}


function FormatTagRow({ tags }: { tags: FormatTag[] }) {
  // Two visual tones so format meta (cyan) is scannable apart from per-slot
  // counts (purple), mirroring the FF Beacon brand split. Border + chip tint
  // are inline so the colors survive PurgeCSS even when Tailwind misses the
  // arbitrary value.
  const styles = {
    format: {
      backgroundColor: "rgba(34, 211, 238, 0.08)",
      borderColor: "rgba(34, 211, 238, 0.30)",
      color: "#22D3EE",
    },
    position: {
      backgroundColor: "rgba(168, 85, 247, 0.08)",
      borderColor: "rgba(168, 85, 247, 0.30)",
      color: "#A855F7",
    },
  } as const;
  return (
    <ul
      className="mt-4 flex flex-wrap gap-1.5"
      role="list"
      aria-label="League format tags"
    >
      {tags.map((t) => (
        <li
          key={t.key}
          className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide"
          style={styles[t.tone]}
        >
          {t.label}
        </li>
      ))}
    </ul>
  );
}

function StatusPill({ status }: { status: string | null }) {
  const label = humanizeLeagueStatus(status);
  const key = (status ?? "").toLowerCase();
  // Map Sleeper status → semantic accent. Pre-draft = brand cyan (build-up
  // energy), drafting = warning amber (active event), in-season = brand
  // purple (live), complete = muted slate, anything else = neutral subtle.
  const palette: { dot: string; chip: string; text: string } =
    key === "pre_draft"
      ? {
          dot: "#22D3EE",
          chip: "rgba(34, 211, 238, 0.10)",
          text: "#22D3EE",
        }
      : key === "drafting"
        ? {
            dot: "#F59E0B",
            chip: "rgba(245, 158, 11, 0.10)",
            text: "#F59E0B",
          }
        : key === "in_season"
          ? {
              dot: "#A855F7",
              chip: "rgba(168, 85, 247, 0.10)",
              text: "#A855F7",
            }
          : key === "complete"
            ? {
                dot: "#10B981",
                chip: "rgba(16, 185, 129, 0.10)",
                text: "#10B981",
              }
            : {
                dot: "#6B6B7D",
                chip: "rgba(107, 107, 125, 0.10)",
                text: "#A8A8B8",
              };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold"
      style={{
        backgroundColor: palette.chip,
        borderColor: `${palette.dot}55`,
        color: palette.text,
      }}
      aria-label={`Status: ${label}`}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: palette.dot, boxShadow: `0 0 6px ${palette.dot}` }}
      />
      {label}
    </span>
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
