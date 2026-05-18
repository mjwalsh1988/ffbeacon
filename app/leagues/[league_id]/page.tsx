import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { syncLeague } from "@/lib/league-sync";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import {
  getActiveFormats,
  getAvailableSources,
  reconcileFormatWithSource,
} from "@/lib/source";
import { loadLeagueTeamCards } from "@/lib/league-view-data";
import { TeamFilter } from "@/components/team-filter";
import { SleeperAvatar } from "@/components/sleeper-avatar";

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
  return {
    title: `${league.name} (${league.season})`,
    description: `League overview, rosters, transactions, and power rankings for ${league.name}.`,
  };
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "teams", label: "Teams" },
  { id: "transactions", label: "Transactions" },
  { id: "power-rankings", label: "Power Rankings" },
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
    format?: string;
    source?: string;
    username?: string;
    roster?: string;
  }>;
}) {
  const { league_id: sleeperLeagueId } = await params;
  const {
    tab: tabParam,
    format: formatParam,
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
      "id, sleeper_league_id, name, season, status, total_rosters, last_synced_at, sync_status, sync_error, format_config_id, roster_positions",
    )
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();

  if (!league) notFound();

  const formatDisplay = league.format_config_id
    ? (
        await supabase
          .from("format_configs")
          .select("display_name, slug")
          .eq("id", league.format_config_id)
          .maybeSingle()
      ).data
    : null;

  // Resolve format/source preferences (used by tabs that consume cached
  // power-rankings rows).
  const [resolvedFormat, resolvedSource, registry, allFormats] = await Promise.all([
    resolveFormatSlug(supabase, formatParam),
    resolveSourceSlug(supabase, sourceParam),
    getAvailableSources(supabase),
    getActiveFormats(supabase),
  ]);
  const reconciled = reconcileFormatWithSource(
    registry,
    allFormats,
    resolvedSource.slug,
    resolvedFormat.slug,
  );
  const displayedFormatSlug = reconciled.formatSlug;
  const sourceSlug = resolvedSource.slug;
  const formatNameForDisplay =
    allFormats.find((f) => f.slug === displayedFormatSlug)?.display_name ??
    displayedFormatSlug;
  const sourceNameForDisplay =
    registry.find((r) => r.slug === sourceSlug)?.display_name ?? sourceSlug ?? "—";

  const lastSynced = league.last_synced_at ? new Date(league.last_synced_at) : null;
  const lastSyncedLabel = lastSynced ? formatRelative(lastSynced) : "never";

  return (
    <main id="main">
      <header className="border-b border-line">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-brand-cyan">
            League Sync
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{league.name}</h1>
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
              <dt className="text-ink-subtle">Format</dt>
              <dd className="text-ink">{formatDisplay?.display_name ?? "Unmatched"}</dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Status</dt>
              <dd className="capitalize text-ink">{league.status ?? "unknown"}</dd>
            </div>
          </dl>
          <p
            className="mt-4 text-xs text-ink-subtle"
            aria-live="polite"
          >
            Last synced {lastSyncedLabel}
            {syncResult.cached ? " (served from cache)" : " (fresh from Sleeper)"}.
          </p>
          {league.sync_status === "error" && league.sync_error && (
            <p
              role="alert"
              className="mt-3 rounded-card border border-signal-danger/40 bg-signal-danger/10 p-3 text-sm text-signal-danger"
            >
              Last sync failed: {league.sync_error}
            </p>
          )}
          {reconciled.fallback && (
            <p
              role="status"
              className="mt-3 rounded-card border border-brand-cyan/30 bg-brand-cyan/5 p-3 text-xs text-ink-muted"
            >
              Showing {reconciled.fallback.toName} because {reconciled.fallback.sourceName}{" "}
              does not publish values for {reconciled.fallback.fromName}.
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
          />
        )}
        {activeTab === "teams" && (
          <TeamsPanel
            leagueRowId={league.id}
            sleeperLeagueId={sleeperLeagueId}
            formatSlug={displayedFormatSlug}
            sourceSlug={sourceSlug}
            searchedUsername={searchedUsername}
            focusedRosterId={focusedRosterId}
            leagueSeason={league.season != null ? String(league.season) : null}
            leagueStatus={league.status ?? null}
          />
        )}
        {activeTab === "transactions" && <ComingSoonPanel section="Transactions" />}
        {activeTab === "power-rankings" && (
          <PowerRankingsPanel
            leagueRowId={league.id}
            sleeperLeagueId={sleeperLeagueId}
            formatSlug={displayedFormatSlug}
            sourceSlug={sourceSlug}
            formatDisplay={formatNameForDisplay}
            sourceDisplay={sourceNameForDisplay}
            leagueSeason={league.season != null ? String(league.season) : null}
            leagueStatus={league.status ?? null}
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
}: {
  leagueRowId: string;
  sleeperLeagueId: string;
  counts: { rosters: number; users: number; transactions: number };
}) {
  const supabase = await createClient();
  const { data: users } = await supabase
    .from("league_users")
    .select("display_name, team_name, sleeper_user_id, is_commissioner")
    .eq("league_id", leagueRowId)
    .order("display_name", { ascending: true });

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

      <section aria-labelledby="members-heading">
        <h2 id="members-heading" className="text-2xl font-semibold tracking-tight">
          Members
        </h2>
        {users && users.length > 0 ? (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {users.map((u) => (
              <li
                key={u.sleeper_user_id}
                className="rounded-card border border-line bg-surface p-4"
              >
                <p className="text-base font-semibold text-ink">
                  {u.team_name || u.display_name || "Unnamed team"}
                </p>
                {u.team_name && u.display_name && (
                  <p className="text-sm text-ink-muted">{u.display_name}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink-muted">
            No members synced yet. Try refreshing the page in a moment.
          </p>
        )}
      </section>

      <section aria-labelledby="next-heading">
        <h2 id="next-heading" className="text-2xl font-semibold tracking-tight">
          Quick links
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-ink-muted">
          Sleeper league: <span className="font-mono text-ink">{sleeperLeagueId}</span>.
          Use the tabs above to browse teams, transactions, and power rankings.
        </p>
      </section>
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
  formatSlug: string;
  sourceSlug: string | null;
  searchedUsername: string | null;
  focusedRosterId: number | null;
  leagueSeason: string | null;
  leagueStatus: string | null;
}) {
  const supabase = await createClient();

  const { data: formatRow } = await supabase
    .from("format_configs")
    .select("id")
    .eq("slug", formatSlug)
    .maybeSingle();

  const teams = await loadLeagueTeamCards(
    supabase,
    leagueRowId,
    formatRow?.id ?? null,
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

async function PowerRankingsPanel({
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
  formatSlug: string;
  sourceSlug: string | null;
  formatDisplay: string;
  sourceDisplay: string;
  leagueSeason: string | null;
  leagueStatus: string | null;
}) {
  const supabase = await createClient();

  if (!sourceSlug) {
    return (
      <p className="text-sm text-ink-muted">
        No data source configured. Visit /rankings to pick one.
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

function ComingSoonPanel({ section }: { section: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-8 text-center">
      <h2 className="text-xl font-semibold tracking-tight">{section}</h2>
      <p className="mx-auto mt-3 max-w-md text-sm text-ink-muted">
        Landing in a later League Sync phase. The data is being synced; the view is being
        built. Check the Overview tab in the meantime.
      </p>
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
