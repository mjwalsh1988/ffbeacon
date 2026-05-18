import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { syncLeague } from "@/lib/league-sync";
import { resolveSourceSlug } from "@/lib/preferences";
import {
  resolveLeagueContext,
  describeDerived,
  type LeagueContext,
} from "@/lib/league-format-resolution";
import { loadLeagueTeamCards } from "@/lib/league-view-data";
import { loadLeagueTransactions } from "@/lib/league-transactions-data";
import { getLeagueAdminContext } from "@/lib/league-auth";
import type { SleeperLeague } from "@/lib/sleeper";
import { TeamFilter } from "@/components/team-filter";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import { TransactionRow } from "@/components/transaction-row";
import { CopyLinkButton } from "@/components/copy-link-button";
import { ResyncButton } from "@/components/resync-button";

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
  if (!league) {
    return { title: "League not found" };
  }
  const ogPath = `/api/og/league/${league_id}`;
  const title = `${league.name} (${league.season})`;
  const description = `League overview, rosters, transactions, and power rankings for ${league.name}.`;
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

  // First-touch sync — idempotent, internally cached for 10 minutes.
  const adminClient = createAdminClient();
  const syncResult = await syncLeague(adminClient, sleeperLeagueId);

  if (!syncResult.ok) {
    notFound();
  }

  // Read the canonical row for render (anon-readable, RLS-safe).
  const supabase = await createClient();
  const { data: league } = await supabase
    .from("leagues")
    .select(
      "id, sleeper_league_id, name, season, status, total_rosters, last_synced_at, sync_status, sync_error, format_config_id, roster_positions, metadata",
    )
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();

  if (!league) notFound();

  // Resolve source preference. Format is NOT user-controlled inside a
  // league view (CLAUDE.md: League Sync Format Resolution rule). We derive
  // the league's natural format from Sleeper settings and map to the
  // closest format the chosen source supports.
  const resolvedSource = await resolveSourceSlug(supabase, sourceParam);
  const sleeperLeague = (league.metadata ?? {}) as unknown as SleeperLeague;
  const context = await resolveLeagueContext(
    adminClient,
    sleeperLeague,
    resolvedSource.slug,
  );

  // Admin / commissioner check — gates the Resync button.
  const adminCtx = await getLeagueAdminContext(supabase, league.id);

  const lastSynced = league.last_synced_at ? new Date(league.last_synced_at) : null;
  const lastSyncedLabel = lastSynced ? formatRelative(lastSynced) : "never";

  return (
    <main id="main">
      <header className="border-b border-line">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="mb-2 text-sm font-medium uppercase tracking-wider text-brand-cyan">
                League Sync
              </p>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                {league.name}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CopyLinkButton
                href={`/leagues/${sleeperLeagueId}`}
                ariaLabel="Copy link to this league"
              />
              <ResyncButton
                sleeperLeagueId={sleeperLeagueId}
                isAuthorized={adminCtx.canForceResync}
              />
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-ink-subtle">Season</dt>
              <dd className="font-mono text-ink">{league.season}</dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Teams</dt>
              <dd className="font-mono text-ink">{league.total_rosters ?? "?"}</dd>
            </div>
            <div>
              <dt className="text-ink-subtle">League format</dt>
              <dd className="text-ink">{describeDerived(context.derived)}</dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Status</dt>
              <dd className="capitalize text-ink">{league.status ?? "unknown"}</dd>
            </div>
          </dl>

          <p className="mt-4 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <span>
              Last synced {lastSyncedLabel}
              {syncResult.cached ? " (served from cache)" : " (fresh from Sleeper)"}.
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

          {league.sync_status === "error" && league.sync_error && (
            <p
              role="alert"
              className="mt-3 rounded-card border border-signal-danger/40 bg-signal-danger/10 p-3 text-sm text-signal-danger"
            >
              Last sync failed: {league.sync_error}
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
                    href={`/leagues/${sleeperLeagueId}?tab=${t.id}`}
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
            counts={syncResult.counts}
            formatSlug={context.coverage === "none" ? null : context.formatSlug}
            sourceSlug={context.coverage === "none" ? null : context.sourceSlug}
            formatDisplay={context.coverage === "none" ? "—" : context.formatDisplay}
            sourceDisplay={context.coverage === "none" ? "—" : context.sourceDisplay}
            leagueSeason={league.season != null ? String(league.season) : null}
            leagueStatus={league.status ?? null}
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
}) {
  return (
    <div className="space-y-8">
      <section aria-labelledby="snapshot-heading">
        <h2 id="snapshot-heading" className="text-2xl font-semibold tracking-tight">
          Snapshot
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-3">
          <Stat label="Rosters synced" value={counts.rosters} />
          <Stat label="Members" value={counts.users} />
          <Stat label="Transactions" value={counts.transactions} />
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
}: {
  leagueRowId: string;
  sleeperLeagueId: string;
  formatSlug: string | null;
  sourceSlug: string | null;
  formatDisplay: string;
  sourceDisplay: string;
  leagueSeason: string | null;
  leagueStatus: string | null;
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
            League power rankings. Columns: overall rank, team, then positional rank
            (QB, RB, WR, TE, Picks). Top three for each column are highlighted cyan;
            bottom three are highlighted purple.
          </caption>
          <thead className="bg-surface text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <th scope="col" className="px-4 py-3 text-center">
                Rank
              </th>
              <th scope="col" className="px-3 py-3">
                Team
              </th>
              <th scope="col" className="px-3 py-3 text-center">
                QB
              </th>
              <th scope="col" className="px-3 py-3 text-center">
                RB
              </th>
              <th scope="col" className="px-3 py-3 text-center">
                WR
              </th>
              <th scope="col" className="px-3 py-3 text-center">
                TE
              </th>
              <th scope="col" className="px-4 py-3 text-center">
                Picks
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ranked.map((t) => {
              const ownerHandle = t.ownerSleeperUsername;
              return (
                <tr key={t.rosterRowId} className="hover:bg-surface">
                  <td className="px-4 py-2 text-center font-mono tabular-nums text-ink-muted">
                    {t.cacheRow?.overall_rank ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/leagues/${sleeperLeagueId}?tab=teams&roster=${t.sleeperRosterId}`}
                      className="flex items-center gap-3 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                      aria-label={`Open ${t.teamName} on the Teams tab. Chip filter will show only this team.`}
                    >
                      <SleeperAvatar
                        avatarId={t.ownerAvatarId}
                        initial={t.teamName.charAt(0)}
                        title={t.teamName}
                        size={36}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {t.teamName}
                        </span>
                        {ownerHandle && (
                          <span className="block truncate text-[11px] text-ink-subtle">
                            @{ownerHandle}
                          </span>
                        )}
                      </span>
                    </Link>
                  </td>
                  <PositionRankCell rank={t.positionRanks.QB} teamCount={teamCount} />
                  <PositionRankCell rank={t.positionRanks.RB} teamCount={teamCount} />
                  <PositionRankCell rank={t.positionRanks.WR} teamCount={teamCount} />
                  <PositionRankCell rank={t.positionRanks.TE} teamCount={teamCount} />
                  <PositionRankCell rank={t.statRanks.picks} teamCount={teamCount} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PositionRankCell({
  rank,
  teamCount,
}: {
  rank: number | null;
  teamCount: number;
}) {
  const tier = rankTier(rank, teamCount);
  const style =
    tier === "top"
      ? { color: "#22D3EE" }
      : tier === "bottom"
        ? { color: "#A855F7" }
        : { color: "#F4F4F8" };
  const ariaTier =
    tier === "top" ? " (top three)" : tier === "bottom" ? " (bottom three)" : "";
  const label = rank != null ? rankOrdinal(rank) : "—";
  return (
    <td
      className="px-3 py-2 text-center font-mono font-semibold tabular-nums"
      style={style}
      aria-label={`Rank ${label}${ariaTier}`}
    >
      {label}
    </td>
  );
}

function rankTier(rank: number | null, teamCount: number): "top" | "bottom" | "mid" | "unknown" {
  if (rank == null || teamCount === 0) return "unknown";
  if (rank <= 3) return "top";
  if (rank > teamCount - 3) return "bottom";
  return "mid";
}

function rankOrdinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <li className="rounded-card border border-line bg-surface p-5">
      <p className="text-xs uppercase tracking-wider text-ink-subtle">{label}</p>
      <p className="mt-2 font-mono text-3xl font-semibold text-ink">{value}</p>
    </li>
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
