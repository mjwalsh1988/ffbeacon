import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { syncLeague } from "@/lib/league-sync";
import { resolveSourceSlug } from "@/lib/preferences";
import { resolveLeagueContext, type LeagueContext } from "@/lib/league-format-resolution";
import { loadLeagueTransactions, type TransactionFilter } from "@/lib/league-transactions-data";
import { TransactionRow } from "@/components/transaction-row";
import { TransactionFilters } from "@/components/transaction-filters";

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
  }>;
}) {
  const { league_id: sleeperLeagueId } = await params;
  const sp = await searchParams;

  // Idempotent first-touch sync — same as the deep view.
  const adminClient = createAdminClient();
  const syncResult = await syncLeague(adminClient, sleeperLeagueId);
  if (!syncResult.ok) notFound();

  const supabase = await createClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("id, sleeper_league_id, name, season, metadata")
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (!league) notFound();

  // Resolve league context (format + source) — source respects user prefs;
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

  return (
    <main id="main">
      <header className="border-b border-line">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-brand-cyan">
            <Link
              href={`/leagues/${sleeperLeagueId}`}
              className="hover:text-brand-purple focus-visible:underline"
            >
              ← {league.name}
            </Link>
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Transactions
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            {total} total {total === 1 ? "transaction" : "transactions"}
            {context.coverage !== "none" && (
              <>
                {" "}
                · values via {context.sourceDisplay} • {context.formatDisplay}
              </>
            )}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <TransactionFilters
          sleeperLeagueId={sleeperLeagueId}
          types={facets.types}
          teams={facets.teams}
          weeks={facets.weeks}
        />

        {rows.length === 0 ? (
          <div className="rounded-card border border-line bg-surface p-8 text-center">
            <p className="text-sm text-ink-muted">
              No transactions match the current filters.
            </p>
          </div>
        ) : (
          <ol className="space-y-3" role="list" aria-label="League transactions">
            {rows.map((row) => (
              <li key={row.sleeperTransactionId} id={`tx-${row.sleeperTransactionId}`}>
                <TransactionRow data={row} sleeperLeagueId={sleeperLeagueId} />
              </li>
            ))}
          </ol>
        )}

        {(hasPrev || hasNext) && (
          <nav
            aria-label="Transactions pagination"
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <p className="text-xs text-ink-subtle">
              Showing {currentOffset + 1}–{currentOffset + rows.length} of {total}
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
      </div>
    </main>
  );
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
  // so there's no season filter — the synced rows already share one season.
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
  // No season facet — Sleeper's transactions endpoint only returns the
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
