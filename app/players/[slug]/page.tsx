import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_FORMAT_SLUG, SITE } from "@/lib/site";
import {
  resolveSourceForFormat,
  getAvailableSources,
  describeSource,
  type SourceRegistryRow,
} from "@/lib/source";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import { TrendChip } from "@/components/trend-chip";

const SEASON = 2025;

export const dynamic = "force-dynamic";

type PlayerPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ format?: string; source?: string }>;
};

export async function generateMetadata({ params }: PlayerPageProps): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: player } = await supabase
    .from("players")
    .select("first_name, last_name, position, team")
    .eq("slug", slug)
    .maybeSingle();
  if (!player) {
    return { title: "Player not found" };
  }
  const name = `${player.first_name} ${player.last_name}`;
  return {
    title: `${name} fantasy football outlook`,
    description: `${name} (${player.position}${player.team ? `, ${player.team}` : ""}) fantasy football analysis, rankings, stats, and value trends.`,
  };
}

export default async function PlayerPage({ params, searchParams }: PlayerPageProps) {
  const { slug } = await params;
  const { format: formatParam, source: sourceParam } = await searchParams;
  const supabase = await createClient();
  const formatResolution = await resolveFormatSlug(supabase, formatParam);
  const sourceResolution = await resolveSourceSlug(supabase, sourceParam);
  const selectedFormatSlug = formatResolution.slug;
  const requestedSourceSlug = sourceResolution.slug;

  const { data: player } = await supabase
    .from("players")
    .select(
      "id, slug, first_name, last_name, position, team, status, birth_date, height_inches, weight_lbs, college, years_experience, draft_year, draft_round, draft_pick",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!player) {
    notFound();
  }

  const { data: defaultFormat } = await supabase
    .from("format_configs")
    .select("id, slug, display_name")
    .eq("slug", selectedFormatSlug)
    .maybeSingle();

  const registry: SourceRegistryRow[] = await getAvailableSources(supabase);
  const registrySlugs = registry.map((r) => r.slug);

  const valueHistoryResolution = defaultFormat
    ? resolveSourceForFormat(
        registry,
        "player_value_history",
        defaultFormat.slug,
        requestedSourceSlug,
      )
    : { source: null, requested: requestedSourceSlug, fellBack: false, availableForFormat: [] };

  const selectedFormatRankingsResolution = defaultFormat
    ? resolveSourceForFormat(
        registry,
        "rankings",
        defaultFormat.slug,
        requestedSourceSlug,
      )
    : { source: null, requested: requestedSourceSlug, fellBack: false, availableForFormat: [] };

  const [{ data: rankingRows }, { data: valueHistory }, { data: trendRows }, { data: stats }, { data: news }] =
    await Promise.all([
      registrySlugs.length
        ? supabase
            .from("rankings")
            .select("overall_rank, position_rank, tier, source, format_config_id, format_configs!inner(slug, display_name)")
            .eq("player_id", player.id)
            .in("source", registrySlugs)
            .eq("season", SEASON)
            .is("week", null)
        : { data: [] },
      defaultFormat && valueHistoryResolution.source
        ? supabase
            .from("player_value_history")
            .select("value, captured_at")
            .eq("player_id", player.id)
            .eq("format_config_id", defaultFormat.id)
            .eq("source", valueHistoryResolution.source)
            .order("captured_at", { ascending: false })
            .limit(8)
        : { data: [] },
      defaultFormat && valueHistoryResolution.source
        ? supabase
            .from("player_value_trends")
            .select("change_7d, change_7d_pct, change_30d, change_30d_pct, trend_7d, trend_30d, volatility_30d, high_30d, low_30d, data_points_30d")
            .eq("player_id", player.id)
            .eq("format_config_id", defaultFormat.id)
            .eq("source", valueHistoryResolution.source)
            .maybeSingle()
        : { data: null },
      supabase
        .from("player_stats")
        .select("week, season, pts_ppr, pts_half_ppr, pts_standard, rec, rec_yd, rec_td, rush_yd, rush_td, pass_yd, pass_td, pass_int, targets, snap_pct, opponent")
        .eq("player_id", player.id)
        .eq("season_type", "regular")
        .order("season", { ascending: false })
        .order("week", { ascending: false })
        .limit(8),
      supabase
        .from("news_items")
        .select("headline, body, source_name, source_url, published_at, ai_summary")
        .eq("player_id", player.id)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(5),
    ]);

  const age = player.birth_date
    ? Math.floor((Date.now() - new Date(player.birth_date).getTime()) / (1000 * 60 * 60 * 24 * 365.25))
    : null;

  const heightDisplay = player.height_inches
    ? `${Math.floor(player.height_inches / 12)}'${player.height_inches % 12}"`
    : null;

  const perFormatPriority = [
    ...(requestedSourceSlug ? [requestedSourceSlug] : []),
    ...registrySlugs.filter((s) => s !== requestedSourceSlug),
  ];
  const rankingByFormat = new Map<
    string,
    {
      overall_rank: number;
      position_rank: number;
      tier: number | null;
      source: string;
      format_configs: { slug: string; display_name: string };
    }
  >();
  for (const source of perFormatPriority) {
    for (const row of rankingRows ?? []) {
      const r = row as unknown as {
        overall_rank: number;
        position_rank: number;
        tier: number | null;
        source: string;
        format_config_id: string;
        format_configs: { slug: string; display_name: string };
      };
      if (r.source !== source) continue;
      if (rankingByFormat.has(r.format_config_id)) continue;
      rankingByFormat.set(r.format_config_id, r);
    }
  }
  const rankings = Array.from(rankingByFormat.values());
  const defaultRanking = rankings.find(
    (r) => r.format_configs.slug === selectedFormatSlug,
  );
  const fallbackBanner =
    selectedFormatRankingsResolution.fellBack && selectedFormatRankingsResolution.source
      ? {
          requested: describeSource(registry, selectedFormatRankingsResolution.requested),
          actual: describeSource(registry, selectedFormatRankingsResolution.source),
        }
      : null;
  const latestValue = valueHistory?.[0];
  const trends = trendRows ?? null;
  const trendDataReady = (trends?.data_points_30d ?? 0) >= 7;

  const fullName = `${player.first_name} ${player.last_name}`;

  return (
    <main id="main">
      <article>
        <header className="border-b border-line">
          <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
            {fallbackBanner && (
              <p
                role="status"
                className="mb-6 rounded-card border border-dashed border-line bg-surface px-4 py-2 text-sm text-ink-muted"
              >
                <span className="font-medium text-ink">Heads up:</span> No{" "}
                {fallbackBanner.requested} data available for{" "}
                {defaultFormat?.display_name ?? "this format"}. Showing{" "}
                {fallbackBanner.actual} data instead.
              </p>
            )}
            <nav aria-label="Breadcrumb" className="mb-4 text-sm text-ink-muted">
              <ol className="flex items-center gap-2">
                <li>
                  <Link href="/" className="hover:text-ink">Home</Link>
                </li>
                <li aria-hidden="true">/</li>
                <li>
                  <Link href={`/rankings?position=${player.position}`} className="hover:text-ink">
                    {player.position}
                  </Link>
                </li>
                <li aria-hidden="true">/</li>
                <li aria-current="page" className="text-ink">{fullName}</li>
              </ol>
            </nav>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="mb-2 text-sm font-medium uppercase tracking-wider text-brand-cyan">
                  {player.position}
                  {player.team ? ` • ${player.team}` : ""}
                  {player.status !== "active" ? ` • ${player.status.toUpperCase()}` : ""}
                </p>
                <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{fullName}</h1>
                <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm text-ink-muted sm:grid-cols-4">
                  {age !== null && (
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-ink-subtle">Age</dt>
                      <dd className="font-mono text-ink">{age}</dd>
                    </div>
                  )}
                  {heightDisplay && (
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-ink-subtle">Height</dt>
                      <dd className="font-mono text-ink">{heightDisplay}</dd>
                    </div>
                  )}
                  {player.weight_lbs && (
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-ink-subtle">Weight</dt>
                      <dd className="font-mono text-ink">{player.weight_lbs} lb</dd>
                    </div>
                  )}
                  {player.years_experience !== null && (
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-ink-subtle">Experience</dt>
                      <dd className="font-mono text-ink">
                        {player.years_experience === 0 ? "Rookie" : `${player.years_experience} yr`}
                      </dd>
                    </div>
                  )}
                  {player.college && (
                    <div className="col-span-2">
                      <dt className="text-xs uppercase tracking-wide text-ink-subtle">College</dt>
                      <dd className="text-ink">{player.college}</dd>
                    </div>
                  )}
                </dl>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {defaultRanking && (
                  <div className="rounded-card border border-line bg-surface px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-ink-subtle">
                      Overall rank
                    </p>
                    <p className="mt-1 font-mono text-2xl font-semibold text-ink">
                      #{defaultRanking.overall_rank}
                    </p>
                    <p className="text-xs text-ink-muted">{defaultFormat?.display_name}</p>
                  </div>
                )}
                {latestValue && (
                  <div className="rounded-card border border-line bg-surface px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-ink-subtle">Market value</p>
                    <p className="mt-1 font-mono text-2xl font-semibold text-ink">
                      {latestValue.value.toLocaleString()}
                    </p>
                    <p className="text-xs text-ink-muted">{defaultFormat?.display_name}</p>
                    {trendDataReady && trends && (
                      <TrendChip
                        direction={trends.trend_7d as "up" | "down" | "stable" | null}
                        delta={trends.change_7d}
                        deltaPct={trends.change_7d_pct}
                        windowLabel="7-day"
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <section aria-labelledby="rankings-heading" className="border-b border-line">
          <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
            <h2 id="rankings-heading" className="text-2xl font-semibold tracking-tight">
              Rankings across formats
            </h2>
            {rankings && rankings.length > 0 ? (
              <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {rankings.map((r) => {
                  const fc = (r as unknown as { format_configs: { slug: string; display_name: string } }).format_configs;
                  return (
                    <li key={fc.slug} className="rounded-card border border-line bg-surface p-4">
                      <p className="text-xs uppercase tracking-wide text-ink-subtle">
                        {fc.display_name}
                      </p>
                      <p className="mt-1 font-mono text-xl font-semibold text-ink">
                        #{r.overall_rank}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {player.position}
                        {r.position_rank} • Tier {r.tier ?? "—"}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-ink-muted">No ranking data yet for this player.</p>
            )}
          </div>
        </section>

        <section aria-labelledby="stats-heading" className="border-b border-line">
          <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
            <h2 id="stats-heading" className="text-2xl font-semibold tracking-tight">
              Last games
            </h2>
            {stats && stats.length > 0 ? (
              <div className="mt-4 overflow-hidden rounded-card border border-line">
                <table className="w-full text-sm">
                  <caption className="sr-only">Recent games stat line</caption>
                  <thead className="bg-surface text-left text-xs uppercase tracking-wide text-ink-subtle">
                    <tr>
                      <th scope="col" className="px-3 py-2">Week</th>
                      <th scope="col" className="px-3 py-2">Opp</th>
                      <th scope="col" className="px-3 py-2 text-right">Pass yd/TD/INT</th>
                      <th scope="col" className="px-3 py-2 text-right">Rush yd/TD</th>
                      <th scope="col" className="px-3 py-2 text-right">Rec/Yd/TD</th>
                      <th scope="col" className="px-3 py-2 text-right">PPR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {stats.map((s, idx) => (
                      <tr key={`${s.season}-${s.week}-${idx}`}>
                        <td className="px-3 py-2 font-mono text-ink-muted">
                          {s.season}/{s.week}
                        </td>
                        <td className="px-3 py-2 text-ink-muted">{s.opponent ?? "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-ink-muted">
                          {s.pass_yd}/{s.pass_td}/{s.pass_int}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-ink-muted">
                          {s.rush_yd}/{s.rush_td}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-ink-muted">
                          {s.rec}/{s.rec_yd}/{s.rec_td}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-medium text-ink">
                          {Number(s.pts_ppr).toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-sm text-ink-muted">
                Stat history loads in once the weekly Sleeper sync runs. Empty for now.
              </p>
            )}
          </div>
        </section>

        <section aria-labelledby="news-heading" className="border-b border-line">
          <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
            <h2 id="news-heading" className="text-2xl font-semibold tracking-tight">
              Latest news
            </h2>
            {news && news.length > 0 ? (
              <ul className="mt-4 space-y-4">
                {news.map((item, idx) => (
                  <li key={idx} className="rounded-card border border-line bg-surface p-4">
                    <h3 className="text-base font-semibold text-ink">{item.headline}</h3>
                    {item.ai_summary && (
                      <p className="mt-2 text-sm text-ink-muted">{item.ai_summary}</p>
                    )}
                    <p className="mt-2 text-xs text-ink-subtle">
                      {item.source_name ?? "Source"}
                      {item.source_url && (
                        <>
                          {" • "}
                          <a
                            href={item.source_url}
                            rel="noopener noreferrer"
                            target="_blank"
                            className="hover:text-ink"
                          >
                            Open
                            <span className="sr-only"> (opens in new tab)</span>
                          </a>
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-ink-muted">No news ingested for this player yet.</p>
            )}
          </div>
        </section>

        <footer className="mx-auto max-w-5xl px-4 py-10 text-sm text-ink-muted sm:px-6 lg:px-8">
          Built and maintained by{" "}
          <Link href={SITE.author.bylineHref} className="text-ink hover:underline">
            {SITE.author.name}
          </Link>{" "}
          at {SITE.name}.
        </footer>
      </article>
    </main>
  );
}
