import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Trophy,
  LineChart,
  BarChart3,
  Newspaper,
  GraduationCap,
  Ruler,
  Dumbbell,
  CalendarDays,
  Activity,
  ArrowUpRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import {
  resolveSourceForFormat,
  getAvailableSources,
  describeSource,
  type SourceRegistryRow,
} from "@/lib/source";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import { TrendChip } from "@/components/trend-chip";
import { PlayerHeadshot } from "@/components/player-headshot";

const SEASON = 2025;

export const dynamic = "force-dynamic";

type PlayerPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ format?: string; source?: string }>;
};

// Position accent palette, kept in lockstep with components/player-headshot.tsx.
function positionAccent(position: string): string {
  const pos = (position ?? "").toUpperCase();
  if (pos === "QB") return "#F472B6";
  if (pos === "RB") return "#10B981";
  if (pos === "WR") return "#22D3EE";
  if (pos === "TE") return "#F59E0B";
  return "#A8A8B8";
}

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
  const posTeam = `${player.position}${player.team ? `, ${player.team}` : ""}`;
  const canonical = `${SITE.url}/players/${slug}`;
  const title = `${name} fantasy outlook, stats & rankings`;
  const description = `${name} (${posTeam}) fantasy football profile: dynasty and redraft rankings, market value trends, career and weekly stats, and the latest news.`;
  const ogImage = `${SITE.url}/api/og/player/${slug}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: SITE.name,
      type: "profile",
      images: [{ url: ogImage, width: 1200, height: 630, alt: `${name} fantasy profile card` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

// ---------- stat shaping ----------

type StatLine = {
  pass_cmp: number;
  pass_att: number;
  pass_yd: number;
  pass_td: number;
  pass_int: number;
  rush_att: number;
  rush_yd: number;
  rush_td: number;
  rec: number;
  rec_tgt: number;
  rec_yd: number;
  rec_td: number;
  pts_ppr: number;
};

type StatRow = {
  season: number;
  week: number;
  opponent: string | null;
  snap_pct: number | null;
  gp: number | null;
  pass_cmp: number | null;
  pass_att: number | null;
  pass_yd: number | null;
  pass_td: number | null;
  pass_int: number | null;
  rush_att: number | null;
  rush_yd: number | null;
  rush_td: number | null;
  rec: number | null;
  rec_tgt: number | null;
  rec_yd: number | null;
  rec_td: number | null;
  metadata: unknown;
};

function n(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function readPpr(metadata: unknown): number {
  if (metadata && typeof metadata === "object") {
    const v = (metadata as Record<string, unknown>).pts_ppr;
    const num = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : 0;
    return Number.isFinite(num) ? num : 0;
  }
  return 0;
}

function toLine(r: StatRow): StatLine {
  return {
    pass_cmp: n(r.pass_cmp),
    pass_att: n(r.pass_att),
    pass_yd: n(r.pass_yd),
    pass_td: n(r.pass_td),
    pass_int: n(r.pass_int),
    rush_att: n(r.rush_att),
    rush_yd: n(r.rush_yd),
    rush_td: n(r.rush_td),
    rec: n(r.rec),
    rec_tgt: n(r.rec_tgt),
    rec_yd: n(r.rec_yd),
    rec_td: n(r.rec_td),
    pts_ppr: readPpr(r.metadata),
  };
}

function addLines(a: StatLine, b: StatLine): StatLine {
  return {
    pass_cmp: a.pass_cmp + b.pass_cmp,
    pass_att: a.pass_att + b.pass_att,
    pass_yd: a.pass_yd + b.pass_yd,
    pass_td: a.pass_td + b.pass_td,
    pass_int: a.pass_int + b.pass_int,
    rush_att: a.rush_att + b.rush_att,
    rush_yd: a.rush_yd + b.rush_yd,
    rush_td: a.rush_td + b.rush_td,
    rec: a.rec + b.rec,
    rec_tgt: a.rec_tgt + b.rec_tgt,
    rec_yd: a.rec_yd + b.rec_yd,
    rec_td: a.rec_td + b.rec_td,
    pts_ppr: a.pts_ppr + b.pts_ppr,
  };
}

const EMPTY_LINE: StatLine = toLine({} as StatRow);

function fmt(v: number): string {
  return Math.round(v).toLocaleString();
}

type StatCol = { label: string; get: (s: StatLine) => string };

function statColumns(position: string): StatCol[] {
  const p = (position || "").toUpperCase();
  if (p === "QB")
    return [
      { label: "Cmp/Att", get: (s) => `${fmt(s.pass_cmp)}/${fmt(s.pass_att)}` },
      { label: "Pass Yd", get: (s) => fmt(s.pass_yd) },
      { label: "Pass TD", get: (s) => fmt(s.pass_td) },
      { label: "INT", get: (s) => fmt(s.pass_int) },
      { label: "Rush Yd", get: (s) => fmt(s.rush_yd) },
      { label: "Rush TD", get: (s) => fmt(s.rush_td) },
    ];
  if (p === "RB")
    return [
      { label: "Car", get: (s) => fmt(s.rush_att) },
      { label: "Rush Yd", get: (s) => fmt(s.rush_yd) },
      { label: "Rush TD", get: (s) => fmt(s.rush_td) },
      { label: "Rec", get: (s) => fmt(s.rec) },
      { label: "Rec Yd", get: (s) => fmt(s.rec_yd) },
      { label: "Rec TD", get: (s) => fmt(s.rec_td) },
    ];
  if (p === "WR" || p === "TE")
    return [
      { label: "Tgt", get: (s) => fmt(s.rec_tgt) },
      { label: "Rec", get: (s) => fmt(s.rec) },
      { label: "Rec Yd", get: (s) => fmt(s.rec_yd) },
      { label: "Rec TD", get: (s) => fmt(s.rec_td) },
      { label: "Rush Yd", get: (s) => fmt(s.rush_yd) },
    ];
  return [
    { label: "Rush Yd", get: (s) => fmt(s.rush_yd) },
    { label: "Rec", get: (s) => fmt(s.rec) },
    { label: "Rec Yd", get: (s) => fmt(s.rec_yd) },
  ];
}

type SeasonAgg = { season: number; games: number; line: StatLine };

function aggregateSeasons(rows: StatRow[]): SeasonAgg[] {
  const bySeason = new Map<number, SeasonAgg>();
  for (const r of rows) {
    let agg = bySeason.get(r.season);
    if (!agg) {
      agg = { season: r.season, games: 0, line: { ...EMPTY_LINE } };
      bySeason.set(r.season, agg);
    }
    agg.line = addLines(agg.line, toLine(r));
    agg.games += n(r.gp) > 0 ? 1 : 0;
  }
  return Array.from(bySeason.values()).sort((a, b) => b.season - a.season);
}

// ---------- page ----------

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
      "id, slug, first_name, last_name, position, team, status, birth_date, height_inches, weight_lbs, college, years_experience, draft_year, draft_round, draft_pick, external_ids",
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
    ? resolveSourceForFormat(registry, "player_value_history", defaultFormat.slug, requestedSourceSlug)
    : { source: null, requested: requestedSourceSlug, fellBack: false, availableForFormat: [] };

  const selectedFormatRankingsResolution = defaultFormat
    ? resolveSourceForFormat(registry, "rankings", defaultFormat.slug, requestedSourceSlug)
    : { source: null, requested: requestedSourceSlug, fellBack: false, availableForFormat: [] };

  const [{ data: rankingRows }, { data: valueHistory }, { data: trendRows }, { data: statRowsRaw }, { data: news }] =
    await Promise.all([
      registrySlugs.length
        ? supabase
            .from("rankings")
            .select(
              "overall_rank, position_rank, tier, source, format_config_id, format_configs!inner(slug, display_name)",
            )
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
            .select(
              "change_7d, change_7d_pct, change_30d, change_30d_pct, change_90d, change_90d_pct, trend_7d, trend_30d, volatility_30d, high_30d, low_30d, show_trend_7d, show_trend_30d, show_trend_90d",
            )
            .eq("player_id", player.id)
            .eq("format_config_id", defaultFormat.id)
            .eq("source", valueHistoryResolution.source)
            .maybeSingle()
        : { data: null },
      supabase
        .from("player_stats")
        .select(
          "season, week, opponent, snap_pct, gp, pass_cmp, pass_att, pass_yd, pass_td, pass_int, rush_att, rush_yd, rush_td, rec, rec_tgt, rec_yd, rec_td, metadata",
        )
        .eq("player_id", player.id)
        .eq("season_type", "regular")
        .order("season", { ascending: false })
        .order("week", { ascending: false }),
      supabase
        .from("news_items")
        .select("headline, body, source_name, source_url, published_at, ai_summary")
        .eq("player_id", player.id)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(5),
    ]);

  const statRows = (statRowsRaw ?? []) as StatRow[];
  const seasonAggs = aggregateSeasons(statRows);
  const recentSeason = seasonAggs[0]?.season ?? null;
  const gameLog = recentSeason
    ? statRows.filter((r) => r.season === recentSeason).sort((a, b) => b.week - a.week)
    : [];
  const recentAgg = seasonAggs[0] ?? null;
  const recentPpg =
    recentAgg && recentAgg.games > 0 ? recentAgg.line.pts_ppr / recentAgg.games : null;

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
  const defaultRanking = rankings.find((r) => r.format_configs.slug === selectedFormatSlug);
  const fallbackBanner =
    selectedFormatRankingsResolution.fellBack && selectedFormatRankingsResolution.source
      ? {
          requested: describeSource(registry, selectedFormatRankingsResolution.requested),
          actual: describeSource(registry, selectedFormatRankingsResolution.source),
        }
      : null;
  const latestValue = valueHistory?.[0];
  const trends = trendRows ?? null;
  const sourceCadence = registry.find((r) => r.slug === valueHistoryResolution.source)
    ?.update_cadence as "daily" | "weekly" | undefined;
  // 90d has no stored trend_* column; derive its direction from the pct using
  // the same +/-2% threshold calculate-trends.ts applies to 7d/30d.
  const directionFromPct = (pct: number | null): "up" | "down" | "stable" | null => {
    if (pct === null) return null;
    if (pct > 2) return "up";
    if (pct < -2) return "down";
    return "stable";
  };

  const fullName = `${player.first_name} ${player.last_name}`;
  const sleeperId = (player.external_ids as { sleeper?: string } | null)?.sleeper ?? null;
  const accent = positionAccent(player.position);
  const cols = statColumns(player.position);

  const canonical = `${SITE.url}/players/${slug}`;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Person",
      name: fullName,
      url: canonical,
      jobTitle: `${player.position}${player.team ? `, ${player.team}` : ""} (NFL)`,
      ...(player.team ? { memberOf: { "@type": "SportsTeam", name: player.team } } : {}),
      ...(player.college ? { alumniOf: { "@type": "CollegeOrUniversity", name: player.college } } : {}),
      ...(player.birth_date ? { birthDate: player.birth_date } : {}),
      ...(player.height_inches
        ? { height: { "@type": "QuantitativeValue", value: player.height_inches, unitCode: "INH" } }
        : {}),
      ...(player.weight_lbs
        ? { weight: { "@type": "QuantitativeValue", value: player.weight_lbs, unitCode: "LBR" } }
        : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE.url },
        { "@type": "ListItem", position: 2, name: player.position, item: `${SITE.url}/rankings?position=${player.position}` },
        { "@type": "ListItem", position: 3, name: fullName, item: canonical },
      ],
    },
  ];

  return (
    <main id="main">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <article>
        {/* ---------- Hero ---------- */}
        <header className="relative overflow-hidden border-b border-line">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-beacon" />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 right-0 h-[360px] w-[640px]"
            style={{
              background: `radial-gradient(ellipse at 70% 0%, ${accent}1f 0%, rgba(34,211,238,0.06) 45%, transparent 75%)`,
            }}
          />
          <div className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
            {fallbackBanner && (
              <p
                role="status"
                className="mb-6 rounded-card border border-dashed border-line bg-surface px-4 py-2 text-sm text-ink-muted"
              >
                <span className="font-medium text-ink">Heads up:</span> No {fallbackBanner.requested}{" "}
                data available for {defaultFormat?.display_name ?? "this format"}. Showing{" "}
                {fallbackBanner.actual} data instead.
              </p>
            )}

            <nav aria-label="Breadcrumb" className="mb-6 text-sm text-ink-muted">
              <ol className="flex items-center gap-2">
                <li>
                  <Link href="/" className="hover:text-ink">
                    Home
                  </Link>
                </li>
                <li aria-hidden="true">/</li>
                <li>
                  <Link href={`/rankings?position=${player.position}`} className="hover:text-ink">
                    {player.position}
                  </Link>
                </li>
                <li aria-hidden="true">/</li>
                <li aria-current="page" className="text-ink">
                  {fullName}
                </li>
              </ol>
            </nav>

            <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
              {/* Identity */}
              <div className="flex items-start gap-4 sm:gap-5">
                <div className="flex-shrink-0">
                  <PlayerHeadshot sleeperId={sleeperId} position={player.position} name={fullName} size={96} />
                </div>
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-[0.16em]"
                      style={{ backgroundColor: `${accent}22`, color: accent }}
                    >
                      {player.position}
                    </span>
                    {player.team && (
                      <span className="inline-flex items-center rounded-md bg-base px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                        {player.team}
                      </span>
                    )}
                    {player.status && player.status !== "active" && (
                      <span className="inline-flex items-center rounded-md bg-signal-warning/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-signal-warning">
                        {player.status}
                      </span>
                    )}
                  </div>
                  <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">{fullName}</h1>
                  <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                    <BioFact icon={CalendarDays} label="Age" value={age !== null ? String(age) : null} />
                    <BioFact icon={Ruler} label="Height" value={heightDisplay} />
                    <BioFact icon={Dumbbell} label="Weight" value={player.weight_lbs ? `${player.weight_lbs} lb` : null} />
                    <BioFact
                      icon={Activity}
                      label="Exp"
                      value={
                        player.years_experience !== null
                          ? player.years_experience === 0
                            ? "Rookie"
                            : `${player.years_experience} yr`
                          : null
                      }
                    />
                    <BioFact icon={GraduationCap} label="College" value={player.college} />
                  </dl>
                </div>
              </div>

              {/* Key metric tiles */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:max-w-md lg:flex-shrink-0">
                <MetricTile
                  icon={Trophy}
                  label="Overall rank"
                  value={defaultRanking ? `#${defaultRanking.overall_rank}` : "—"}
                  sub={defaultFormat?.display_name ?? ""}
                />
                <MetricTile
                  icon={LineChart}
                  label="Market value"
                  value={latestValue ? latestValue.value.toLocaleString() : "—"}
                  sub={defaultFormat?.display_name ?? ""}
                >
                  {trends?.show_trend_7d && (
                    <TrendChip
                      direction={trends.trend_7d as "up" | "down" | "stable" | null}
                      delta={trends.change_7d}
                      deltaPct={trends.change_7d_pct}
                      windowLabel="7-day"
                      cadence={sourceCadence}
                    />
                  )}
                  {trends?.show_trend_30d && (
                    <TrendChip
                      direction={trends.trend_30d as "up" | "down" | "stable" | null}
                      delta={trends.change_30d}
                      deltaPct={trends.change_30d_pct}
                      windowLabel="30-day"
                      cadence={sourceCadence}
                    />
                  )}
                  {trends?.show_trend_90d && (
                    <TrendChip
                      direction={directionFromPct(trends.change_90d_pct)}
                      delta={trends.change_90d}
                      deltaPct={trends.change_90d_pct}
                      windowLabel="90-day"
                      cadence={sourceCadence}
                    />
                  )}
                </MetricTile>
                <MetricTile
                  icon={BarChart3}
                  label={`${recentSeason ?? ""} PPR/G`}
                  value={recentPpg !== null ? recentPpg.toFixed(1) : "—"}
                  sub={recentAgg ? `${recentAgg.games} games` : "no games yet"}
                />
              </div>
            </div>
          </div>
        </header>

        {/* ---------- Rankings across formats ---------- */}
        <Section id="rankings-heading" eyebrow="Market" title="Rankings across formats">
          {rankings.length > 0 ? (
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {rankings.map((r) => {
                const fc = (r as unknown as { format_configs: { slug: string; display_name: string } })
                  .format_configs;
                const isActive = fc.slug === selectedFormatSlug;
                return (
                  <li
                    key={fc.slug}
                    className={`rounded-card border bg-surface p-4 ${
                      isActive ? "border-brand-cyan/50" : "border-line"
                    }`}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                      {fc.display_name}
                    </p>
                    <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-ink">
                      #{r.overall_rank}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {player.position}
                      {r.position_rank}
                      {r.tier != null ? ` • Tier ${r.tier}` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyNote>No ranking data yet for this player.</EmptyNote>
          )}
        </Section>

        {/* ---------- Career by season ---------- */}
        <Section id="career-heading" eyebrow="Production" title="Career by season">
          {seasonAggs.length > 0 ? (
            <StatScroll caption={`${fullName} regular-season totals by year`}>
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wider text-ink-subtle">
                  <tr className="border-b border-line">
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Season
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      G
                    </th>
                    {cols.map((c) => (
                      <th key={c.label} scope="col" className="px-3 py-2 text-right font-semibold">
                        {c.label}
                      </th>
                    ))}
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      PPR
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      PPR/G
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {seasonAggs.map((s) => {
                    const ppg = s.games > 0 ? s.line.pts_ppr / s.games : null;
                    return (
                      <tr key={s.season} className="hover:bg-surface">
                        <th
                          scope="row"
                          className="whitespace-nowrap px-3 py-2 text-left font-mono font-medium text-ink"
                        >
                          {s.season}
                        </th>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted">
                          {s.games}
                        </td>
                        {cols.map((c) => (
                          <td
                            key={c.label}
                            className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted"
                          >
                            {c.get(s.line)}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
                          {s.line.pts_ppr.toFixed(1)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-brand-cyan">
                          {ppg !== null ? ppg.toFixed(1) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </StatScroll>
          ) : (
            <EmptyNote>No statistical history on file for this player.</EmptyNote>
          )}
        </Section>

        {/* ---------- Recent game log ---------- */}
        {gameLog.length > 0 && (
          <Section
            id="gamelog-heading"
            eyebrow="Game log"
            title={`${recentSeason} weekly stats`}
          >
            <StatScroll caption={`${fullName} ${recentSeason} weekly stat lines`}>
              <table className="w-full min-w-[680px] text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wider text-ink-subtle">
                  <tr className="border-b border-line">
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Wk
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      Opp
                    </th>
                    {cols.map((c) => (
                      <th key={c.label} scope="col" className="px-3 py-2 text-right font-semibold">
                        {c.label}
                      </th>
                    ))}
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      Snap%
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">
                      PPR
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {gameLog.map((r) => {
                    const line = toLine(r);
                    const snap = r.snap_pct != null ? `${Math.round(r.snap_pct * 100)}%` : "—";
                    return (
                      <tr key={`${r.season}-${r.week}`} className="hover:bg-surface">
                        <th
                          scope="row"
                          className="whitespace-nowrap px-3 py-2 text-left font-mono font-medium text-ink"
                        >
                          {r.week}
                        </th>
                        <td className="px-3 py-2 text-ink-muted">{r.opponent ?? "—"}</td>
                        {cols.map((c) => (
                          <td
                            key={c.label}
                            className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted"
                          >
                            {c.get(line)}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted">
                          {snap}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-ink">
                          {line.pts_ppr.toFixed(1)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </StatScroll>
          </Section>
        )}

        {/* ---------- News ---------- */}
        <Section id="news-heading" eyebrow="Latest" title="News and notes">
          {news && news.length > 0 ? (
            <ul className="mt-6 space-y-3">
              {news.map((item, idx) => (
                <li key={idx} className="rounded-card border border-line bg-surface p-4">
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
                    >
                      <Newspaper className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-ink">{item.headline}</h3>
                      {item.ai_summary && <p className="mt-1.5 text-sm text-ink-muted">{item.ai_summary}</p>}
                      <p className="mt-2 text-xs text-ink-subtle">
                        {item.source_name ?? "Source"}
                        {item.source_url && (
                          <>
                            {" • "}
                            <a
                              href={item.source_url}
                              rel="noopener noreferrer"
                              target="_blank"
                              className="inline-flex items-center gap-0.5 hover:text-ink"
                            >
                              Open
                              <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
                              <span className="sr-only"> (opens in new tab)</span>
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote>No news ingested for this player yet.</EmptyNote>
          )}
        </Section>

        <footer className="mx-auto max-w-7xl px-4 py-10 text-sm text-ink-muted sm:px-6 lg:px-8">
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

// ---------- presentational subcomponents ----------

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="border-b border-line">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">{eyebrow}</p>
        <h2 id={id} className="mt-2 text-2xl font-semibold tracking-tight">
          {title}
        </h2>
        {children}
      </div>
    </section>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  sub,
  children,
}: {
  icon: typeof Trophy;
  label: string;
  value: string;
  sub: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-center gap-2 text-ink-subtle">
        <Icon aria-hidden="true" className="h-3.5 w-3.5" />
        <p className="text-[11px] font-semibold uppercase tracking-wider">{label}</p>
      </div>
      <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-ink">{value}</p>
      {sub && <p className="text-xs text-ink-muted">{sub}</p>}
      {children}
    </div>
  );
}

function BioFact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Trophy;
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2">
      <Icon aria-hidden="true" className="h-4 w-4 text-ink-subtle" />
      <div>
        <dt className="sr-only">{label}</dt>
        <dd className="text-ink">
          <span className="text-ink-subtle">{label}: </span>
          {value}
        </dd>
      </div>
    </div>
  );
}

function StatScroll({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 overflow-hidden rounded-card border border-line bg-surface">
      <div
        role="region"
        aria-label={`${caption}. Scroll horizontally to see every column.`}
        tabIndex={0}
        className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        {children}
      </div>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 rounded-card border border-dashed border-line bg-surface px-4 py-3 text-sm text-ink-muted">
      {children}
    </p>
  );
}
