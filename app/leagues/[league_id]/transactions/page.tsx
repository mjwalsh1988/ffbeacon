import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { resolveSleeperViewer } from "@/lib/sleeper-handle/resolve";
import { viewerLinkUsername } from "@/lib/sleeper-handle/types";
import { formatTeamLabelCompact } from "@/lib/team-label";
import { pulseLeagueCore, pulseLeagueDerived } from "@/lib/league-pulse";
import { resolveSourceSlug } from "@/lib/preferences";
import {
  resolveLeagueContext,
  describeDerived,
  type LeagueContext,
  type LeagueContextEmpty,
} from "@/lib/league-format-resolution";
import {
  loadLeagueTransactions,
  loadTradeAnalyses,
  ALL_TYPES_SENTINEL,
  DEFAULT_TYPE_FILTER,
  type TransactionFilter,
} from "@/lib/league-transactions-data";
import { loadLeagueHeaderActions } from "@/lib/league-header-data";
import {
  analyzeLeagueTrades,
  type LeagueTradeSignalCheck,
} from "@/lib/league-signal-check";
import {
  loadStartupPickIndex,
  collectStartupPickQueries,
} from "@/lib/league-startup-picks";
import type { SleeperLeague } from "@/lib/sleeper";
import { TransactionRow } from "@/components/transaction-row";
import { SignalCheckTradeCard } from "@/components/signal-check-trade-card";
import { TransactionFilters } from "@/components/transaction-filters";
import { LeagueShell } from "@/components/league-shell";
import { Panel } from "@/components/dashboard-panel";
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
  // First-touch pulse, split in two exactly as the deep view does. The core is
  // the league, its rosters and its members: everything the header, tabs and
  // info panel need. The derived half (transaction history, trade values, Power
  // Pulse) is what the feed waits on, and it waits inside a Suspense boundary
  // below, so the page paints its shell immediately instead of holding a blank
  // screen for the whole sync.
  const adminClient = createAdminClient();
  const pulseResult = await pulseLeagueCore(adminClient, sleeperLeagueId);
  if (!pulseResult.ok) notFound();

  const supabase = await createClient();

  // Who this page is acting for: the ?username= handle when there is one,
  // otherwise the reader's own saved handle (lib/sleeper-handle/resolve.ts).
  // `linkUsername` is what a link built here may carry, which is the handle
  // only when the reader arrived on one.
  const viewer = await resolveSleeperViewer(supabase, sp.username);
  const linkUsername = viewerLinkUsername(viewer);
  const { data: league } = await supabase
    .from("leagues")
    .select(
      "id, sleeper_league_id, name, season, status, total_rosters, last_pulsed_at, roster_positions, scoring_settings, metadata",
    )
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (!league) notFound();

  // The two shell reads. Both are needed before first paint (the switcher, and
  // the source/format line on the info panel), and neither feeds the other.
  const sleeperLeague = league.metadata as unknown as Parameters<
    typeof resolveLeagueContext
  >[1];
  const [{ otherLeagues }, context] = await Promise.all([
    loadLeagueHeaderActions(
      supabase,
      league.id,
      sleeperLeagueId,
      viewer,
      league.season != null ? String(league.season) : null,
    ),
    // Format is derived from the Sleeper league settings; only the value source
    // follows the user's preference.
    resolveSourceSlug(supabase, sp.source).then((resolved) =>
      resolveLeagueContext(adminClient, sleeperLeague, resolved.slug),
    ),
  ]);

  // Back-links carry the handle only for a reader who arrived on one, so the
  // switcher and overview context survive a shared link without a saved reader
  // publishing their own handle into every hop.
  const homeHref = linkUsername
    ? `/tools/league-pulse?username=${encodeURIComponent(linkUsername)}`
    : "/tools/league-pulse";
  const leagueHref = linkUsername
    ? `/leagues/${sleeperLeagueId}?username=${encodeURIComponent(linkUsername)}`
    : `/leagues/${sleeperLeagueId}`;
  // Copy link is the clean, shareable canonical URL (no personal username).
  const copyHref = `/leagues/${sleeperLeagueId}/transactions`;

  const filter = parseFiltersFromSearchParams(sp);

  // League identity + context for the masthead the shell renders above this
  // section, mirroring every other deep-view surface. Format is derived from
  // the league's Sleeper settings; only the value source respects the user's
  // pick (CLAUDE.md: League Pulse Format Resolution).
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

  const mastheadProps = {
    leagueName: league.name,
    avatarId: sleeperLeague.avatar ?? null,
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

  // In-view links back to the other deep-view surfaces. The handle rides along
  // only for a reader who arrived on one; a saved reader's own team is still
  // found on the other side, by their Sleeper user id.
  const overviewHref = leagueHref;
  const teamsHref = linkUsername
    ? `/leagues/${sleeperLeagueId}?tab=teams&username=${encodeURIComponent(linkUsername)}`
    : `/leagues/${sleeperLeagueId}?tab=teams`;

  return (
    <LeagueShell
      sleeperLeagueId={sleeperLeagueId}
      activeTab="transactions"
      viewer={viewer}
      homeHref={homeHref}
      crumbs={[{ label: league.name, href: leagueHref }, { label: "Transactions" }]}
      copyHref={copyHref}
      copyAriaLabel="Copy link to this league's transactions"
      otherLeagues={otherLeagues}
      masthead={mastheadProps}
    >
      {/* The filter bar and the feed take the main column; the tally and the
          cross-links sit in a right rail. Below xl the grid collapses to one
          column, and the rail lands after the feed rather than in front of it,
          which is why these panels no longer need to be hidden on mobile. */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Suspense fallback={<FeedSkeleton />}>
            <TransactionsFeed
              leagueRowId={league.id}
              sleeperLeagueId={sleeperLeagueId}
              sleeperLeague={league.metadata as unknown as SleeperLeague}
              context={context}
              filter={filter}
              sp={sp}
              resynced={!pulseResult.cached}
            />
          </Suspense>
        </div>

        <aside
          aria-label="Activity summary and links"
          className="space-y-6 xl:sticky xl:top-[5.5rem] xl:self-start"
        >
          <Panel eyebrow="Go deeper" title="Explore this league">
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
      </div>
    </LeagueShell>
  );
}

/**
 * Everything below the filter bar, and the filter bar itself.
 *
 * All of it depends on the derived half of the pulse (the transaction history),
 * so it lives behind a Suspense boundary and the rest of the page does not wait
 * for it. pulseLeagueDerived coalesces per league, so this boundary and the
 * Activity tally beside it share one sync rather than racing for it.
 */
async function TransactionsFeed({
  leagueRowId,
  sleeperLeagueId,
  sleeperLeague,
  context,
  filter,
  sp,
  resynced,
}: {
  leagueRowId: string;
  sleeperLeagueId: string;
  sleeperLeague: SleeperLeague;
  context: LeagueContext | LeagueContextEmpty;
  filter: TransactionFilter;
  sp: Record<string, string | undefined>;
  resynced: boolean;
}) {
  const adminClient = createAdminClient();
  await pulseLeagueDerived(adminClient, leagueRowId, { resynced });

  const supabase = await createClient();
  const [facets, loaded] = await Promise.all([
    // Facet counts come from the unfiltered set, so a user can see every filter
    // without first picking one.
    loadFacets(supabase, leagueRowId),
    loadLeagueTransactions(supabase, leagueRowId, { ...filter, limit: PAGE_SIZE }),
  ]);
  const { total, rows } = loaded;

  const currentOffset = filter.offset ?? 0;
  const hasPrev = currentOffset > 0;
  const hasNext = currentOffset + rows.length < total;

  // Grade every trade on this page through the real Signal Check pipeline (FF
  // Beacon values, the league's derived format, the published ruleset), so each
  // trade shows the same verdict a user gets typing it into /tools/signal-check.
  const tradeRows = rows.filter((r) => r.type === "trade");
  // From the loaded identity map rather than the first row, so the labels are
  // right on a page whose first row happens to be a non-trade (or is empty).
  const rosterLabels: Record<number, string> = {};
  for (const [rid, identity] of Object.entries(loaded.rosterIdentities)) {
    rosterLabels[Number(rid)] = identity.teamName;
  }
  const tradeAnalysis =
    tradeRows.length > 0
      ? await analyzeLeagueTrades(adminClient, {
          sleeperLeague,
          trades: tradeRows.map((r) => ({
            sleeperTransactionId: r.sleeperTransactionId,
            adds: r.adds,
            draftPicks: r.draftPicks,
            createdAtSleeper: r.createdAtSleeper,
          })),
          rosterLabels,
          leagueRowId,
        })
      : null;
  const gradedTrades: Map<string, LeagueTradeSignalCheck> =
    tradeAnalysis?.results ?? new Map();

  // Only the trades Signal Check could not take (a three-team deal, an
  // unmatched player) need the plain value analyzer, and they get it
  // concurrently. Normally this list is empty and no valuation runs at all.
  const ungradedTrades = tradeRows.filter((r) => !gradedTrades.has(r.sleeperTransactionId));

  // The startup index, always with the ADMIN client, because draft_selections is
  // service-role only and the page's user client would read nothing and report
  // every startup pick as unloaded. Signal Check normally builds it and hands it
  // back; it returns without one when Signal Check is disabled or the league's
  // format has no published values, and this feed still has to price startup
  // picks correctly in both of those cases.
  const startupIndex =
    ungradedTrades.length === 0
      ? null
      : (tradeAnalysis?.startupIndex ??
        (context.coverage === "none"
          ? null
          : await loadStartupPickIndex(adminClient, {
              leagueRowId,
              formatSlug: (context as LeagueContext).formatSlug,
              picks: ungradedTrades.flatMap((r) =>
                collectStartupPickQueries(r.draftPicks, r.createdAtSleeper),
              ),
            })));

  const fallbackAnalyses = await loadTradeAnalyses(
    supabase,
    leagueRowId,
    context.coverage === "none" ? null : (context as LeagueContext),
    ungradedTrades,
    loaded,
    startupIndex,
  );

  const coverageOk = context.coverage !== "none";
  const sourceDisplay = coverageOk ? context.sourceDisplay : "N/A";
  const formatDisplay = coverageOk ? (context as LeagueContext).formatDisplay : "N/A";

  // `total` is the count AFTER filtering, and the feed is filtered by default,
  // so "N total transactions" would have read as the league's whole history
  // while showing only its trades. Name what is actually on screen instead.
  const showingOnlyTrades =
    filter.types?.length === 1 && filter.types[0] === DEFAULT_TYPE_FILTER;
  const noun = showingOnlyTrades
    ? total === 1
      ? "trade"
      : "trades"
    : total === 1
      ? "transaction"
      : "transactions";
  const feedTitle = showingOnlyTrades ? "Trades" : "Transactions";
  const countLabel = `${total} ${noun}`;

  return (
    <>
      <TransactionFilters
        sleeperLeagueId={sleeperLeagueId}
        types={facets.types}
        teams={facets.teams}
        weeks={facets.weeks}
        defaultType={DEFAULT_TYPE_FILTER}
        allTypesValue={ALL_TYPES_SENTINEL}
      />

      <Panel
              eyebrow="Feed"
              title={feedTitle}
              helper={
                gradedTrades.size > 0
                  ? `${countLabel}. Graded by Signal Check using FF Beacon values${tradeAnalysis?.formatDisplay ? ` in ${tradeAnalysis.formatDisplay}` : ""}.`
                  : coverageOk
                    ? `${countLabel}, values via ${sourceDisplay} in ${formatDisplay}.`
                    : `${countLabel}.`
              }
              bodyClassName="bg-base/30 p-4 sm:p-5"
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
                    {showingOnlyTrades
                      ? "No trades in this league yet. Uncheck Trade in the filters to see waivers and free agent moves."
                      : "No transactions match the current filters."}
                  </p>
                </div>
              ) : (
                // Wide gaps, not hairlines. Each entry is a self-contained
                // card, so the empty space between them is what says one has
                // ended, and 1rem did not read as a gap between two bordered
                // blocks sitting on a similar background.
                <ol
                  className="space-y-7 sm:space-y-8"
                  role="list"
                  aria-label={showingOnlyTrades ? "League trades" : "League transactions"}
                >
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
                            sourceSlug={coverageOk ? context.sourceSlug : null}
                            startup={graded.startup}
                          />
                        ) : (
                          <TransactionRow
                            data={{
                              ...row,
                              analysis: fallbackAnalyses.get(row.sleeperTransactionId) ?? null,
                            }}
                            sleeperLeagueId={sleeperLeagueId}
                          />
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
    </>
  );
}

/**
 * Stand-in for the feed while the derived sync finishes. Announced politely so
 * a screen reader hears that work is in progress rather than sitting on
 * silence, and replaced in place the moment the real feed streams in.
 */
function FeedSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <div className="rounded-modal border border-line bg-surface/50 px-4 py-3 sm:px-5">
        <p className="text-sm text-ink-muted">Loading filters</p>
      </div>
      <div className="rounded-modal border border-line bg-surface/50 p-4 sm:p-5">
        <p className="text-sm text-ink-muted">Loading transactions</p>
        <div aria-hidden="true" className="mt-4 space-y-7">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-modal bg-base/60" />
          ))}
        </div>
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
  const explicitTypes = sp.type
    ? sp.type.split(",").map((v) => v.trim()).filter((v) => v.length > 0)
    : [];
  const types =
    sp.type === ALL_TYPES_SENTINEL
      ? undefined
      : explicitTypes.length > 0
        ? explicitTypes
        : [DEFAULT_TYPE_FILTER];
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
      // Compact, because these are dropdown options with a fixed width. The
      // handle survives the trim; the team name is what gets clipped.
      label: formatTeamLabelCompact({
        teamName: u?.team_name,
        username: u?.display_name,
        sleeperRosterId: r.sleeper_roster_id,
      }),
    };
  });

  return {
    types,
    teams,
    weeks: Array.from(weekSet).sort((a, b) => b - a),
  };
}
