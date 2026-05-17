import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { readPosition } from "@/lib/format";
import {
  resolveSourceForFormat,
  getAvailableSources,
  getActiveFormats,
  describeSource,
  reconcileFormatWithSource,
} from "@/lib/source";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import { RankingsTable, type RankingsRow } from "@/components/rankings-table";
import { POSITIONS } from "@/lib/site";

export const metadata: Metadata = {
  title: "Fantasy Football Rankings",
  description:
    "Sortable, filterable fantasy football rankings across redraft, dynasty, superflex, and TE premium formats.",
};

export const dynamic = "force-dynamic";

const SEASON = 2025;

export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ format?: string; position?: string; source?: string }>;
}) {
  const params = await searchParams;
  const positionFilter = readPosition(params.position);

  const supabase = await createClient();

  // Resolve preferences + load registry/format list in parallel. The two
  // resolvers share a cached user_preferences fetch (see lib/preferences.ts),
  // and getAvailableSources / getActiveFormats are React.cache-wrapped so
  // SiteHeader (running in the same render pass via the root layout) reuses
  // the same Promises.
  const [formatResolution, sourceResolution, registry, allFormats] = await Promise.all([
    resolveFormatSlug(supabase, params.format),
    resolveSourceSlug(supabase, params.source),
    getAvailableSources(supabase),
    getActiveFormats(supabase),
  ]);
  const requestedSourceSlug = sourceResolution.slug;

  // Reconcile (source, format): if the active source doesn't support the
  // requested format (URL-driven mismatch, or stale cookie after a source's
  // supported_format_slugs shrank), fall through to a sensible substitute and
  // surface a banner. We do NOT persist this swap — it's a read-time
  // correction so the user gets coherent data without losing their saved
  // preferences elsewhere.
  const reconciled = reconcileFormatWithSource(
    registry,
    allFormats,
    requestedSourceSlug,
    formatResolution.slug,
  );
  const formatSlug = reconciled.formatSlug;

  // Single DB lookup for the format's ID + te_premium_bonus. The cached
  // allFormats list doesn't carry the UUID, since we don't need it for
  // banner/dropdown rendering — only for filtering rankings/player_value_history.
  const { data: format } = await supabase
    .from("format_configs")
    .select("id, slug, display_name, league_type, scoring_type, is_superflex, te_premium_bonus")
    .eq("slug", formatSlug)
    .maybeSingle();

  if (!format) {
    return (
      <main id="main" className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold">Rankings</h1>
        <p className="mt-4 text-ink-muted">Format not found.</p>
      </main>
    );
  }

  const rankingsResolution = resolveSourceForFormat(
    registry,
    "rankings",
    format.slug,
    requestedSourceSlug,
  );
  const valueHistoryResolution = resolveSourceForFormat(
    registry,
    "player_value_history",
    format.slug,
    requestedSourceSlug,
  );

  // Run rankings + value-history + trends fetches in parallel. They don't
  // depend on each other; join is done in-memory below.
  //
  // We intentionally do NOT pass an .in("player_id", playerIds) filter on
  // player_value_history: with 400+ UUIDs the resulting PostgREST GET URL
  // silently exceeds the fetch URL length (~16 KB) and the request fails
  // with "fetch failed", leaving the page values-less. The (format_config_id,
  // source) pair already bounds the result to a few hundred rows, so the
  // filter is unnecessary anyway.
  const rankingsQuery = supabase
    .from("rankings")
    .select(
      "overall_rank, position_rank, tier, players!inner(id, slug, first_name, last_name, position, team, status)",
    )
    .eq("format_config_id", format.id)
    .eq("source", rankingsResolution.source ?? "__none__")
    .eq("season", SEASON)
    .is("week", null)
    .order("overall_rank")
    .limit(500);

  const [rankingsResult, valuesResult, trendsResult] = await Promise.all([
    rankingsResolution.source
      ? positionFilter
        ? rankingsQuery.eq("players.position", positionFilter)
        : rankingsQuery
      : Promise.resolve({ data: [] as never }),
    valueHistoryResolution.source
      ? supabase
          .from("player_value_history")
          .select("player_id, value, captured_at")
          .eq("format_config_id", format.id)
          .eq("source", valueHistoryResolution.source)
          .order("captured_at", { ascending: false })
      : Promise.resolve({ data: [] as never }),
    valueHistoryResolution.source
      ? supabase
          .from("player_value_trends")
          .select("player_id, change_7d, change_7d_pct, trend_7d, data_points_30d")
          .eq("format_config_id", format.id)
          .eq("source", valueHistoryResolution.source)
      : Promise.resolve({ data: [] as never }),
  ]);
  const rankings = rankingsResult.data;
  const values = valuesResult.data;
  const trends = trendsResult.data;

  const valueByPlayer = new Map<string, { value: number }>();
  for (const v of values ?? []) {
    if (valueByPlayer.has(v.player_id)) continue;
    valueByPlayer.set(v.player_id, { value: v.value });
  }
  const trendByPlayer = new Map<
    string,
    { change_7d: number | null; change_7d_pct: number | null; trend_7d: string | null; data_points_30d: number }
  >();
  for (const t of trends ?? []) {
    trendByPlayer.set(t.player_id, {
      change_7d: t.change_7d,
      change_7d_pct: t.change_7d_pct,
      trend_7d: t.trend_7d,
      data_points_30d: t.data_points_30d,
    });
  }

  const rows: RankingsRow[] = (rankings ?? []).map((r) => {
    const player = (r as unknown as {
      players: {
        id: string;
        slug: string;
        first_name: string;
        last_name: string;
        position: string;
        team: string | null;
        status: string;
      };
    }).players;
    const value = valueByPlayer.get(player.id);
    const trend = trendByPlayer.get(player.id);
    return {
      overall_rank: r.overall_rank,
      position_rank: r.position_rank,
      tier: r.tier ?? null,
      slug: player.slug,
      name: `${player.first_name} ${player.last_name}`,
      position: player.position,
      team: player.team,
      status: player.status,
      value: value?.value ?? null,
      change_7d: trend?.change_7d ?? null,
      change_7d_pct: trend?.change_7d_pct ?? null,
      trend_7d: trend?.trend_7d ?? null,
      data_points_30d: trend?.data_points_30d ?? 0,
    };
  });

  return (
    <main id="main">
      <header className="border-b border-line">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          {reconciled.fallback && (
            <p
              role="status"
              aria-live="polite"
              className="mb-6 rounded-card border border-dashed border-line bg-surface px-4 py-2 text-sm text-ink-muted"
            >
              <span className="font-medium text-ink">Switched to {reconciled.fallback.toName}</span>{" "}
              because {reconciled.fallback.sourceName} doesn{"’"}t provide values for{" "}
              {reconciled.fallback.fromName}.
            </p>
          )}
          {rankingsResolution.fellBack && rankingsResolution.source && (
            <p
              role="status"
              className="mb-6 rounded-card border border-dashed border-line bg-surface px-4 py-2 text-sm text-ink-muted"
            >
              <span className="font-medium text-ink">Heads up:</span> No{" "}
              {describeSource(registry, rankingsResolution.requested)} data
              available for {format.display_name}. Showing{" "}
              {describeSource(registry, rankingsResolution.source)} data instead.
            </p>
          )}
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-brand-cyan">
            Rankings
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            {format.display_name} rankings
          </h1>
          <p className="mt-3 max-w-2xl text-ink-muted">
            {rows.length} ranked players for {format.league_type} {format.scoring_type.replace("_", " ")}
            {format.is_superflex ? ", superflex" : ""}
            {Number(format.te_premium_bonus) > 0 ? ", TE premium" : ""}. Updated nightly from market
            value plus our editorial overlay.
          </p>
          <nav aria-label="Filter by position" className="mt-6 flex flex-wrap gap-2">
            <FilterLink
              href={`/rankings?format=${formatSlug}`}
              active={!positionFilter}
              label="All positions"
            />
            {POSITIONS.map((pos) => (
              <FilterLink
                key={pos}
                href={`/rankings?format=${formatSlug}&position=${pos}`}
                active={positionFilter === pos}
                label={pos}
              />
            ))}
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {rows.length === 0 ? (
          <p className="rounded-card border border-dashed border-line bg-surface p-6 text-sm text-ink-muted">
            No ranking data for this format yet. Try a different format.
          </p>
        ) : (
          <RankingsTable rows={rows} />
        )}
      </div>
    </main>
  );
}

function FilterLink({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-card border px-3 py-1.5 text-sm transition-colors ${
        active
          ? "border-brand-purple bg-brand-purple/15 text-ink"
          : "border-line bg-surface text-ink-muted hover:border-line-accent hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
}
