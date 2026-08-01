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
import { loadLeagueTransactions, type TransactionFilter } from "@/lib/league-transactions-data";
import { loadLeagueHeaderActions } from "@/lib/league-header-data";
import {
  analyzeLeagueTrades,
  type LeagueTradeSignalCheck,
} from "@/lib/league-signal-check";
import type { SleeperLeague } from "@/lib/sleeper";
import { TransactionRow } from "@/components/transaction-row";
import { SignalCheckTradeCard } from "@/components/signal-check-trade-card";
import { TransactionFilters } from "@/components/transaction-filters";
import { LeagueBreadcrumb } from "@/components/league-breadcrumb";
import { LeagueHeaderActions } from "@/components/league-header-actions";
import { LeagueTabs } from "@/components/league-tabs";
import { Panel, StatReadout } from "@/components/dashboard-panel";
import { LeagueInfoPanel } from "@/components/league-info-panel";
import {
  buildLeagueFormatTags,
  buildLeagueScoringTags,
} from "@/lib/league-format-tags";
import { LayoutDashboard, Users, ArrowRight, type LucideIcon } from "lucide-react";

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
    .select("name, season")
    .eq("sleeper_league_id", league_id)
    .maybeSingle();
  if (!league) return { title: "League not found" };

  const ogPath = `/api/og/league/${league_id}`;
  return {
    title: `${league.name} transactions`,
    description: `All trades, waiver claims, and free agent moves for ${league.name}.`,
    openGraph: {
      title: `${league.name} transactions`,
      description: `All trades, waiver claims, and free agent moves for ${league.name}.`,
      images: [{ url: ogPath, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${league.name} transactions`,
      images: [ogPath],
    },
  };
}

const PAGE_SIZE = 25;

export default async function LeagueTransactionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ league_id: string }>;
  searchParams: Promise<{
    type?: string;
    team?: string;
    week?: string;
    offset?: string;
    source?: string;
    username?: string;
  }>;
}) {
  const { league_id: sleeperLeagueId } = await params;
  const sp = await searchParams;
  const searchedUsername =
    typeof sp.username === "string" && sp.username.trim()
      ? sp.username.trim()
      : null;

  // Idempotent first-touch pulse, same as the deep view.
  const adminClient = createAdminClient();
  const pulseResult = await pulseLeague(adminClient, sleeperLeagueId);
  if (!pulseResult.ok) notFound();

  const supabase = await createClient();
  const { data: league } = await supabase
    .from("leagues")
    .select(
      "id, sleeper_league_id, name, season, status, total_rosters, last_pulsed_at, roster_positions, scoring_settings, metadata",
    )
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (!league) notFound();

  // Shared header action data (in-view switcher + admin refresh gate).
  const { otherLeagues } = await loadLeagueHeaderActions(
    supabase,
    league.id,
    sleeperLeagueId,
    searchedUsername,
    league.season != null ? String(league.season) : null,
  );

  // Back-links forward the searched handle so the switcher and overview
  // context survive the round trip.
  const homeHref = searchedUsername
    ? `/tools/league-pulse?username=${encodeURIComponent(searchedUsername)}`
    : "/tools/league-pulse";
  const leagueHref = searchedUsername
    ? `/leagues/${sleeperLeagueId}?username=${encodeURIComponent(searchedUsername)}`
    : `/leagues/${sleeperLeagueId}`;
  // Copy link is the clean, shareable canonical URL (no personal username).
  const copyHref = `/leagues/${sleeperLeagueId}/transactions`;

  // Resolve league context (format + source), source respects user prefs;
  // format is derived from the actual Sleeper league settings.
  const sleeperLeague = league.metadata as unknown as Parameters<
    typeof resolveLeagueContext
  >[1];
  const resolvedSource = await resolveSourceSlug(supabase, sp.source);
  const context = await resolveLeagueContext(adminClient, sleeperLeague, resolvedSource.slug);

  // Parse filters from URL
  const filter = parseFiltersFromSearchParams(sp);

  // Filter facet counts come from the unfiltered set (so users can see
  // every possible filter without first picking one).
  const facets = await loadFacets(supabase, league.id);

  const { total, rows } = await loadLeagueTransactions(
    supabase,
    league.id,
    context.coverage === "none" ? null : (context as LeagueContext),
    { ...filter, limit: PAGE_SIZE },
  );

  const currentOffset = filter.offset ?? 0;
  const hasPrev = currentOffset > 0;
  const hasNext = currentOffset + rows.length < total;

  // Grade every trade on this page through the real Signal Check pipeline (FF
  // Beacon values, the league's derived format, the published ruleset), so each
  // trade shows the same verdict a user gets typing it into /tools/signal-check.
  const tradeRows = rows.filter((r) => r.type === "trade");
  const rosterLabels: Record<number, string> = {};
  for (const [rid, identity] of Object.entries(rows[0]?.rosterIdentities ?? {})) {
    rosterLabels[Number(rid)] = identity.teamName;
  }
  const tradeAnalysis =
    tradeRows.length > 0
      ? await analyzeLeagueTrades(adminClient, {
          sleeperLeague: league.metadata as unknown as SleeperLeague,
          trades: tradeRows.map((r) => ({
            sleeperTransactionId: r.sleeperTransactionId,
            adds: r.adds,
            draftPicks: r.draftPicks,
          })),
          rosterLabels,
        })
      : null;
  const gradedTrades: Map<string, LeagueTradeSignalCheck> =
    tradeAnalysis?.results ?? new Map();

  // League identity + context for the highlighted sidebar card, mirroring the
  // overview page so every deep-view surface reads as one dashboard. Format is
  // derived from the league's Sleeper settings; only the value source respects
  // the user's pick (CLAUDE.md: League Pulse Format Resolution).
  const formatTags = buildLeagueFormatTags({
    rosterPositions: league.roster_positions,
    scoringSettings: league.scoring_settings,
    teamCount: league.total_rosters,
  });
  const scoringTags = buildLeagueScoringTags(league.scoring_settings);
  const derivedLabel = describeDerived(context.derived);
  const coverageOk = context.coverage !== "none";
  const sourceDisplay = coverageOk ? context.sourceDisplay : "N/A";
  const formatDisplay = coverageOk ? context.formatDisplay : "N/A";
  const pickSourceDisplay =
    coverageOk && context.pickSource && context.pickSource.slug !== context.sourceSlug
      ? context.pickSource.display
      : null;
  const fallbackDisplay =
    context.coverage === "fallback" ? context.fallback?.derivedDisplay ?? null : null;
  const lastPulsed = league.last_pulsed_at ? new Date(league.last_pulsed_at) : null;
  const lastPulsedLabel = lastPulsed ? formatRelative(lastPulsed) : "never";

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

  // At-a-glance transaction counts from the unfiltered facet set (so the
  // snapshot reflects the whole league, not the current filter).
  const typeCountBy = new Map(facets.types.map((t) => [t.value, t.count]));
  const totalAll = facets.types.reduce((sum, t) => sum + t.count, 0);
  const tradeCount = typeCountBy.get("trade") ?? 0;
  const waiverCount =
    (typeCountBy.get("waiver") ?? 0) + (typeCountBy.get("free_agent") ?? 0);

  // In-view links back to the other deep-view surfaces (username forwarded so
  // the switcher + Teams owner default survive the hop).
  const overviewHref = leagueHref;
  const teamsHref = searchedUsername
    ? `/leagues/${sleeperLeagueId}?tab=teams&username=${encodeURIComponent(searchedUsername)}`
    : `/leagues/${sleeperLeagueId}?tab=teams`;

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
          {/* Slim header: breadcrumb + actions only. League identity and context
              live in the highlighted LeagueInfoPanel in the sidebar, matching
              the overview page. */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <LeagueBreadcrumb
              homeHref={homeHref}
              crumbs={[
                { label: league.name, href: leagueHref },
                { label: "Transactions" },
              ]}
            />
            <LeagueHeaderActions
              sleeperLeagueId={sleeperLeagueId}
              copyHref={copyHref}
              copyAriaLabel="Copy link to this league's transactions"
              otherLeagues={otherLeagues}
              searchedUsername={searchedUsername}
            />
          </div>
        </div>
      </header>

      <LeagueTabs
        sleeperLeagueId={sleeperLeagueId}
        activeTab="transactions"
        searchedUsername={searchedUsername}
      />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Transactions: league info + quick panels in a LEFT rail, the filter
            bar and activity feed on the RIGHT. The rail stacks above the feed
            below xl, mirroring the overview page. */}
        <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside
            aria-label="League information and links"
            className="space-y-6 xl:sticky xl:top-8 xl:self-start"
          >
            <LeagueInfoPanel layout="sidebar" {...infoPanelProps} />

            {/* Supplementary rail panels are hidden below the sidebar
                breakpoint. `hidden` sets display:none, so they leave the
                accessibility tree entirely and screen readers skip them on
                mobile rather than reading a stack of secondary links. */}
            <Panel eyebrow="At a glance" title="Activity" className="hidden xl:block">
              <dl className="grid grid-cols-3 gap-2">
                <StatReadout label="Total" value={String(totalAll)} accent="ink" />
                <StatReadout label="Trades" value={String(tradeCount)} accent="purple" />
                <StatReadout label="Waivers" value={String(waiverCount)} accent="cyan" />
              </dl>
            </Panel>

            <Panel
              eyebrow="Go deeper"
              title="Explore this league"
              className="hidden xl:block"
            >
              <ul className="space-y-2">
                <li>
                  <ExploreLink
                    href={overviewHref}
                    icon={LayoutDashboard}
                    label="League overview"
                    hint="Power rankings and league snapshot"
                  />
                </li>
                <li>
                  <ExploreLink
                    href={teamsHref}
                    icon={Users}
                    label="Teams and rosters"
                    hint="Compare every roster side by side"
                  />
                </li>
              </ul>
            </Panel>
          </aside>

          <div className="min-w-0 space-y-6">
            <TransactionFilters
              sleeperLeagueId={sleeperLeagueId}
              types={facets.types}
              teams={facets.teams}
              weeks={facets.weeks}
            />

            <Panel
              eyebrow="Feed"
              title="Transactions"
              helper={
                gradedTrades.size > 0
                  ? `${total} total ${total === 1 ? "transaction" : "transactions"}. Trades graded by Signal Check using FF Beacon values${tradeAnalysis?.formatDisplay ? ` in ${tradeAnalysis.formatDisplay}` : ""}.`
                  : coverageOk
                    ? `${total} total ${total === 1 ? "transaction" : "transactions"}, values via ${sourceDisplay} in ${formatDisplay}.`
                    : `${total} total ${total === 1 ? "transaction" : "transactions"}.`
              }
              bodyClassName="p-4 sm:p-5"
            >
              {tradeAnalysis?.formatNotice && (
                <p
                  role="status"
                  className="mb-4 rounded-card border border-brand-cyan/30 bg-brand-cyan/5 p-3 text-xs leading-relaxed text-ink-muted"
                >
                  {tradeAnalysis.formatNotice}
                </p>
              )}

              {rows.length === 0 ? (
                <div className="rounded-card border border-line bg-base/40 p-8 text-center">
                  <p className="text-sm text-ink-muted">
                    No transactions match the current filters.
                  </p>
                </div>
              ) : (
                <ol className="space-y-4" role="list" aria-label="League transactions">
                  {rows.map((row) => {
                    const graded =
                      row.type === "trade"
                        ? gradedTrades.get(row.sleeperTransactionId)
                        : undefined;
                    return (
                      <li key={row.sleeperTransactionId} id={`tx-${row.sleeperTransactionId}`}>
                        {graded ? (
                          <SignalCheckTradeCard
                            view={graded.view}
                            assetMeta={graded.assetMeta}
                            sleeperLeagueId={sleeperLeagueId}
                            sleeperTransactionId={row.sleeperTransactionId}
                            week={row.week}
                            createdAtSleeper={row.createdAtSleeper}
                            status={row.status}
                          />
                        ) : (
                          <TransactionRow data={row} sleeperLeagueId={sleeperLeagueId} />
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}

              {(hasPrev || hasNext) && (
                <nav
                  aria-label="Transactions pagination"
                  className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line/70 pt-4"
                >
                  <p className="text-xs text-ink-subtle">
                    Showing {currentOffset + 1}-{currentOffset + rows.length} of {total}
                  </p>
                  <div className="flex gap-2">
                    <PaginationLink
                      disabled={!hasPrev}
                      href={buildHref(sleeperLeagueId, sp, Math.max(0, currentOffset - PAGE_SIZE))}
                      label="Previous"
                    />
                    <PaginationLink
                      disabled={!hasNext}
                      href={buildHref(sleeperLeagueId, sp, currentOffset + PAGE_SIZE)}
                      label="Next"
                    />
                  </div>
                </nav>
              )}
            </Panel>
          </div>
        </div>
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

function PaginationLink({
  disabled,
  href,
  label,
}: {
  disabled: boolean;
  href: string;
  label: string;
}) {
  if (disabled) {
    return (
      <span
        className="inline-flex min-h-11 items-center rounded-card border border-line px-4 py-2 text-sm text-ink-subtle"
        aria-disabled="true"
      >
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center rounded-card border border-line bg-surface px-4 py-2 text-sm text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline-2 focus-visible:outline-brand-cyan"
    >
      {label}
    </Link>
  );
}

function buildHref(
  sleeperLeagueId: string,
  sp: Awaited<Promise<Record<string, string | undefined>>>,
  offset: number,
): string {
  const params = new URLSearchParams();
  if (sp.type) params.set("type", sp.type);
  if (sp.team) params.set("team", sp.team);
  if (sp.week) params.set("week", sp.week);
  if (sp.source) params.set("source", sp.source);
  if (sp.username) params.set("username", sp.username);
  if (offset > 0) params.set("offset", String(offset));
  const qs = params.toString();
  return `/leagues/${sleeperLeagueId}/transactions${qs ? `?${qs}` : ""}`;
}

function parseFiltersFromSearchParams(sp: {
  type?: string;
  team?: string;
  week?: string;
  offset?: string;
}): TransactionFilter {
  const types = sp.type
    ? sp.type.split(",").map((v) => v.trim()).filter((v) => v.length > 0)
    : undefined;
  const rosterIds = sp.team
    ? sp.team
        .split(",")
        .map((v) => Number.parseInt(v.trim(), 10))
        .filter((n) => Number.isFinite(n))
    : undefined;
  const week = sp.week ? Number.parseInt(sp.week, 10) : null;
  const offset = sp.offset ? Math.max(0, Number.parseInt(sp.offset, 10)) : 0;
  // Sleeper's transactions endpoint only returns the league's current season,
  // so there's no season filter, the synced rows already share one season.
  return {
    types,
    rosterIds: rosterIds && rosterIds.length > 0 ? rosterIds : undefined,
    week: Number.isFinite(week) ? week : null,
    offset,
  };
}

async function loadFacets(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leagueRowId: string,
): Promise<{
  types: Array<{ value: string; label: string; count: number }>;
  teams: Array<{ rosterId: number; label: string }>;
  weeks: number[];
}> {
  // No season facet, Sleeper's transactions endpoint only returns the
  // league's current season, so the synced rows already share one season.
  const { data: allRows } = await supabase
    .from("league_transactions")
    .select("type, week")
    .eq("league_id", leagueRowId);

  const typeCounts = new Map<string, number>();
  const weekSet = new Set<number>();
  for (const r of allRows ?? []) {
    typeCounts.set(r.type, (typeCounts.get(r.type) ?? 0) + 1);
    if (typeof r.week === "number") weekSet.add(r.week);
  }

  const labelMap: Record<string, string> = {
    trade: "Trade",
    waiver: "Waiver",
    free_agent: "Free agent",
    commissioner: "Commissioner",
  };
  const types = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({
      value,
      label: labelMap[value] ?? value,
      count,
    }));

  // Build team facet
  const [{ data: rosterRows }, { data: userRows }] = await Promise.all([
    supabase
      .from("rosters")
      .select("sleeper_roster_id, owner_user_id")
      .eq("league_id", leagueRowId)
      .order("sleeper_roster_id", { ascending: true }),
    supabase
      .from("league_users")
      .select("sleeper_user_id, display_name, team_name")
      .eq("league_id", leagueRowId),
  ]);
  const userBySleeperId = new Map(userRows?.map((u) => [u.sleeper_user_id, u]) ?? []);
  const teams = (rosterRows ?? []).map((r) => {
    const u = r.owner_user_id ? userBySleeperId.get(r.owner_user_id) : null;
    return {
      rosterId: r.sleeper_roster_id,
      label: u?.team_name || u?.display_name || `Team ${r.sleeper_roster_id}`,
    };
  });

  return {
    types,
    teams,
    weeks: Array.from(weekSet).sort((a, b) => b - a),
  };
}
