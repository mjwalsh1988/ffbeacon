import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import {
  Activity,
  BarChart3,
  CalendarRange,
  Gauge,
  Layers,
  LineChart,
  ScrollText,
  Swords,
  Users,
  ArrowRight,
} from "lucide-react";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  assembleBreakdown,
  loadBreakdown,
  mergeMarket,
  EMPTY_EXTRAS,
  type BreakdownResult,
} from "@/lib/beacon-breakdown";
import { DEFAULT_LENS, isLensId, type LensId } from "@/lib/breakdown/types";
import { loadBreakdownExtras } from "@/lib/breakdown/load-extras";
import { loadLeagueMode } from "@/lib/breakdown/league-mode";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { findPlayerTrades } from "@/lib/player-trades";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import {
  getActiveFormats,
  getAvailableSources,
  resolveSourceForFormat,
  describeSource,
} from "@/lib/source";
import { currentNflSeason } from "@/lib/sleeper";
import { SITE } from "@/lib/site";
import { BreakdownSelector, type PickedPlayer } from "./breakdown-selector";
import { MatchupHeader } from "./matchup-header";
import { BeaconEdgeMeter } from "./beacon-edge-meter";
import { EdgeContributionChart } from "./edge-contribution-chart";
import { LensSwitch } from "./lens-switch";
import { BreakdownTable } from "./breakdown-table";
import { QuickTakeaways, VerdictCard } from "./breakdown-summary";
import { BreakdownTabs } from "./breakdown-tabs";
import { StatsCompare } from "./stats-compare";
import { ProjectionsTab } from "./projections-tab";
import { ReliabilityTab } from "./reliability-tab";
import { MarketTab } from "./market-tab";
import { LeagueTab } from "./league-tab";
import { LeaguePanel } from "./league-panel";
import { loadBreakdownStats } from "./load-stats";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { MemberHeroCta } from "@/components/member-hero-cta";
import { isDiscordMember } from "@/lib/discord-membership";
import { HeroLavaField } from "@/components/hero-lava-field";

export const dynamic = "force-dynamic";

type SearchParams = {
  a?: string;
  b?: string;
  format?: string;
  source?: string;
  lens?: string;
  /** Sleeper league id, when the reader has connected one. */
  league?: string;
  /** Their Sleeper roster id in that league. */
  roster?: string;
};

/** Build a URL for this tool, replacing only the params named. */
function buildHref(base: SearchParams, overrides: Partial<SearchParams>): string {
  const merged = { ...base, ...overrides };
  const params = new URLSearchParams();
  for (const key of ["a", "b", "format", "source", "lens", "league", "roster"] as const) {
    const value = merged[key];
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/tools/beacon-breakdown?${qs}` : "/tools/beacon-breakdown";
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { a, b, lens: lensParam, source } = await searchParams;
  let title = "Beacon Breakdown: player comparison tool";
  let description =
    "Compare any two players head-to-head with side-by-side values, rankings, projections, beat rates, and a plain-English verdict on who has the edge.";

  const lens = isLensId(lensParam) ? lensParam : DEFAULT_LENS;

  if (a && b) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("players")
      .select("slug, full_name, first_name, last_name")
      .in("slug", [a, b]);
    const nameOf = (slug: string) => {
      const row = (data ?? []).find((p) => p.slug === slug);
      if (!row) return null;
      return row.full_name ?? `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
    };
    const nameA = nameOf(a);
    const nameB = nameOf(b);
    if (nameA && nameB) {
      title = `${nameA} vs ${nameB}: Beacon Breakdown`;
      description = `${nameA} vs ${nameB} head-to-head: value, rankings, rest-of-season projections, beat rates, and the Beacon Verdict on who has the edge.`;

      // The card is generated from the same loadBreakdown the page runs, so the
      // preview and the page can never disagree about the verdict.
      const ogParams = new URLSearchParams({ lens });
      if (source) ogParams.set("source", source);
      const ogUrl = `${SITE.url}/api/og/breakdown/${encodeURIComponent(a)}/${encodeURIComponent(b)}?${ogParams.toString()}`;

      return {
        title,
        description,
        alternates: { canonical: "/tools/beacon-breakdown" },
        openGraph: {
          title,
          description,
          images: [{ url: ogUrl, width: 1200, height: 630, alt: `${nameA} versus ${nameB}` }],
        },
        twitter: {
          card: "summary_large_image",
          title,
          description,
          images: [ogUrl],
        },
      };
    }
  }

  // Canonical is always the bare tool page, never the ?a=&b= comparison.
  //
  // The title and description above stay comparison-specific on purpose: they are
  // what a shared link previews as. But the comparison space is every ordered pair
  // of ranked players, which is hundreds of thousands of URLs that are all the same
  // tool with different inputs. Pointing them at the bare page consolidates that
  // whole space into one indexable URL instead of inviting Google to crawl it.
  return {
    title,
    description,
    alternates: { canonical: "/tools/beacon-breakdown" },
  };
}

export default async function BeaconBreakdownPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const hasBoth = Boolean(params.a && params.b);

  // Resolve the display labels for the format/source context bar. When we run a
  // breakdown these also come back inside the result, but the empty-state
  // selector needs them up front.
  const [formatResolution, sourceResolution, registry, activeFormats] = await Promise.all([
    resolveFormatSlug(supabase, params.format),
    resolveSourceSlug(supabase, params.source),
    getAvailableSources(supabase),
    getActiveFormats(supabase),
  ]);
  // Picked in memory from the request-cached list rather than a second
  // slug-keyed round trip.
  const formatRow = activeFormats.find((f) => f.slug === formatResolution.slug) ?? null;
  const formatDisplay = formatRow?.display_name ?? formatResolution.slug;
  const valueResolution = formatRow
    ? resolveSourceForFormat(registry, "player_value_history", formatRow.slug, sourceResolution.slug)
    : null;
  const sourceDisplay = valueResolution?.source
    ? describeSource(registry, valueResolution.source)
    : null;

  // Confirmed Discord members skip the invite: the hero button scrolls to the
  // comparison and the bottom CTA points them at the rest of the toolkit.
  const isMember = await isDiscordMember();

  return (
    <main id="main">
      <Hero isMember={isMember} />

      <section
        id="beacon-breakdown-section"
        aria-labelledby="breakdown-heading"
        className="scroll-mt-24 border-b border-line"
      >
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
          <h2 id="breakdown-heading" className="sr-only">
            Run a Beacon Breakdown
          </h2>

          {hasBoth ? (
            <Suspense fallback={<ResultSkeleton />}>
              <BreakdownShell
                params={params}
                formatDisplayFallback={formatDisplay}
                sourceDisplayFallback={sourceDisplay}
              />
            </Suspense>
          ) : (
            <EmptyState
              formatDisplay={formatDisplay}
              sourceDisplay={sourceDisplay}
              leagueAttached={Boolean(params.league && params.roster)}
            />
          )}
        </div>
      </section>
      <DiscordCtaSection
        eyebrow="Torn on the verdict?"
        heading="Still can't decide? Talk it out with real people."
        body="The Beacon Edge gives you a clear lean, but a trade or a start/sit call can still be close. Bring the matchup to our Discord and real fantasy managers will help you settle it for free. Want to know what's behind FF Beacon? Read about the project."
        isMember={isMember}
        memberHeading="Call made? Explore the rest of the toolkit."
        memberBody="You're already in the crew, so we'll skip the invite. Dig into the other free FF Beacon tools for your next close call."
      />
    </main>
  );
}

/**
 * The fast half: identity, the selector, and the matchup cards.
 *
 * Everything here comes from one query wave over the core tables, so the page
 * paints as soon as we know who is being compared. The meter, the table, and the
 * tabs all depend on projections, reliability, market data, and possibly a whole
 * league simulation, so they stream in behind their own boundary rather than
 * holding the header hostage.
 */
async function BreakdownShell({
  params,
  formatDisplayFallback,
  sourceDisplayFallback,
}: {
  params: SearchParams;
  formatDisplayFallback: string;
  sourceDisplayFallback: string | null;
}) {
  const supabase = await createClient();
  const lens: LensId = isLensId(params.lens) ? params.lens : DEFAULT_LENS;

  const lookup = await loadBreakdown(supabase, params.a!, params.b!, {
    formatParam: params.format,
    sourceParam: params.source,
    lens,
  });

  if (!lookup.ok) {
    return (
      <div className="space-y-6">
        <p
          role="alert"
          className="rounded-card border border-signal-warning/40 bg-signal-warning/5 px-4 py-3 text-sm text-ink"
        >
          We couldn&apos;t find {lookup.missing.length > 1 ? "those players" : "that player"}. They
          may be inactive or the link may be out of date. Pick two players to try again.
        </p>
        <BreakdownSelector
          formatDisplay={formatDisplayFallback}
          sourceDisplay={sourceDisplayFallback}
        />
      </div>
    );
  }

  const core = lookup.result;
  const { a, b, context } = core;

  const pickedA: PickedPlayer = {
    slug: a.slug,
    name: a.name,
    position: a.position,
    team: a.team,
    sleeperId: a.sleeperId,
  };
  const pickedB: PickedPlayer = {
    slug: b.slug,
    name: b.name,
    position: b.position,
    team: b.team,
    sleeperId: b.sleeperId,
  };

  return (
    <div className="space-y-6">
      {context.fallbackBanner && (
        <p
          role="status"
          className="rounded-card border border-dashed border-line bg-surface px-4 py-2 text-sm text-ink-muted"
        >
          <span className="font-medium text-ink">Heads up:</span> No{" "}
          {context.fallbackBanner.requested} values for {context.fallbackBanner.formatDisplay}.
          Showing {context.fallbackBanner.actual} values instead.
        </p>
      )}

      <BreakdownSelector
        compact
        initialA={pickedA}
        initialB={pickedB}
        formatDisplay={context.formatDisplay}
        sourceDisplay={context.sourceDisplay}
      />

      <MatchupHeader a={a} b={b} valueIsBeacon={context.valueIsBeacon} />

      <LensSwitch active={lens} hrefForLens={(next) => buildHref(params, { lens: next })} />

      <Suspense fallback={<AnalysisSkeleton />}>
        <BreakdownAnalysis core={core} params={params} lens={lens} />
      </Suspense>
    </div>
  );
}

/**
 * The measured half.
 *
 * Loads projections, reliability, market data, trade history, weekly stats, and
 * (when a league is connected) a full league simulation, then rebuilds the
 * comparison with all of it folded in. The rebuild goes through the SAME
 * assembleBreakdown the fast path uses, so a league-aware verdict is a
 * better-informed version of the public one rather than a second opinion.
 */
async function BreakdownAnalysis({
  core,
  params,
  lens,
}: {
  core: BreakdownResult;
  params: SearchParams;
  lens: LensId;
}) {
  const supabase = await createClient();
  const { a, b, context } = core;

  // The Power Pulse model config lives in a service-role-only table. It never
  // throws and falls back to the code defaults, matching how the public FAAB
  // page reads its own settings.
  const pulseSettings = await loadPowerPulseSettings(createAdminClient());

  const rosterId = params.roster ? Number(params.roster) : NaN;
  const wantsLeague = Boolean(params.league) && Number.isInteger(rosterId) && rosterId > 0;

  const [extrasMap, stats, tradesA, tradesB, leagueMode] = await Promise.all([
    loadBreakdownExtras(
      supabase,
      [a, b].map((p) => ({
        id: p.id,
        position: p.position,
        team: p.team,
        injuryStatus: p.injuryStatus,
        overallRank: p.overallRank,
      })),
      {
        scoringKey: context.scoringKey,
        formatConfigId: context.formatConfigId,
        valueSource: context.sourceSlug,
        isDynasty: context.isDynasty,
        isSuperflex: context.isSuperflex,
        // No league in the public path, so no TE premium beyond what the format
        // itself already bakes into the stored points column.
        tePremiumPerReception: 0,
      },
      pulseSettings,
    ),
    loadBreakdownStats(supabase, a, b),
    a.sleeperId ? findPlayerTrades(supabase, a.sleeperId, { limit: 3 }) : Promise.resolve([]),
    b.sleeperId ? findPlayerTrades(supabase, b.sleeperId, { limit: 3 }) : Promise.resolve([]),
    wantsLeague
      ? loadLeagueMode({
          sleeperLeagueId: params.league!,
          rosterId,
          sleeperA: a.sleeperId,
          sleeperB: b.sleeperId,
        })
      : Promise.resolve({ report: null, notice: null }),
  ]);

  const extrasA = mergeMarket(a, extrasMap.get(a.id) ?? EMPTY_EXTRAS);
  const extrasB = mergeMarket(b, extrasMap.get(b.id) ?? EMPTY_EXTRAS);

  const leagueReport = leagueMode.report;
  const leagueA = leagueReport?.impacts[0] ?? null;
  const leagueB = leagueReport?.impacts[1] ?? null;

  // Rebuild with everything we now know. Same assembly, richer inputs.
  const result = assembleBreakdown({
    a,
    b,
    extrasA,
    extrasB,
    leagueA,
    leagueB,
    lens,
    valueIsBeacon: context.valueIsBeacon,
    context,
  });

  const { rows, edge, takeaways, verdict } = result;

  const shareHref = buildHref(params, {});

  const breakdownTab = (
    <div className="space-y-6">
      <BeaconEdgeMeter a={a} b={b} edge={edge} />

      <EdgeContributionChart a={a} b={b} edge={edge} />

      <div className="rounded-modal border border-line bg-surface/40 p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">
            Category comparison
          </h3>
          <p className="text-xs text-ink-subtle">
            {context.formatDisplay}
            {context.sourceDisplay ? `, ${context.sourceDisplay}` : ""}
          </p>
        </div>
        <BreakdownTable a={a} b={b} rows={rows} />
      </div>

      <QuickTakeaways a={a} b={b} takeaways={takeaways} />

      <VerdictCard verdict={verdict} shareHref={shareHref} />
    </div>
  );

  const tabs = [
    {
      id: "breakdown",
      label: "The Breakdown",
      icon: <Swords className="h-4 w-4" />,
      content: breakdownTab,
    },
    {
      id: "projections",
      label: "Projections",
      icon: <CalendarRange className="h-4 w-4" />,
      content: (
        <ProjectionsTab
          a={{ player: a, projection: extrasA.projection }}
          b={{ player: b, projection: extrasB.projection }}
        />
      ),
    },
    {
      id: "reliability",
      label: "Reliability",
      icon: <Activity className="h-4 w-4" />,
      content: (
        <ReliabilityTab
          a={{ player: a, reliability: extrasA.reliability }}
          b={{ player: b, reliability: extrasB.reliability }}
        />
      ),
    },
    {
      id: "market",
      label: "Market",
      icon: <LineChart className="h-4 w-4" />,
      content: (
        <MarketTab
          a={{ player: a, market: extrasA.market, trades: tradesA }}
          b={{ player: b, market: extrasB.market, trades: tradesB }}
          sourceDisplay={context.sourceDisplay}
          formatDisplay={context.formatDisplay}
        />
      ),
    },
    {
      id: "stats",
      label: "Stats",
      icon: <BarChart3 className="h-4 w-4" />,
      content: <StatsCompare a={stats.a} b={stats.b} />,
    },
  ];

  if (leagueReport) {
    // Slotted right after the breakdown, because once a league is connected it
    // is the most specific answer on the page.
    tabs.splice(1, 0, {
      id: "your-league",
      label: "Your league",
      icon: <Users className="h-4 w-4" />,
      content: (
        <LeagueTab
          a={{ player: a, impact: leagueA }}
          b={{ player: b, impact: leagueB }}
          report={leagueReport}
        />
      ),
    });
  }

  return (
    <div className="space-y-6">
      <LeaguePanel
        active={
          leagueReport
            ? {
                sleeperLeagueId: leagueReport.league.sleeperLeagueId,
                name: leagueReport.league.name,
                teamName: leagueReport.team.name,
                record: leagueReport.team.record,
                season: leagueReport.league.season,
                scoringDescription: leagueReport.league.scoringDescription,
              }
            : null
        }
        defaultSeason={currentNflSeason()}
        applyHrefBase={buildHref(params, { league: undefined, roster: undefined })}
        clearHref={buildHref(params, { league: undefined, roster: undefined })}
      />

      {leagueMode.notice && (
        <p
          role="status"
          className="rounded-card border border-dashed border-signal-warning/40 bg-signal-warning/5 px-4 py-2 text-sm text-ink-muted"
        >
          {leagueMode.notice}
        </p>
      )}

      <BreakdownTabs tabs={tabs} />

      <PackageHandoff aName={a.name} bName={b.name} />
    </div>
  );
}

/**
 * The exit to Signal Check.
 *
 * A head-to-head is the wrong shape for a real trade, which is usually two for
 * one or three for two. Signal Check already prices multi-asset packages, values
 * picks, and grades the whole deal, so the Breakdown points at it rather than
 * growing a second, weaker copy of that engine.
 */
function PackageHandoff({ aName, bName }: { aName: string; bName: string }) {
  return (
    <section
      aria-labelledby="package-heading"
      className="rounded-modal border border-line bg-surface/40 p-4 sm:p-5"
    >
      <h3 id="package-heading" className="text-sm font-semibold text-ink">
        Is this actually a bigger trade?
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">
        Real trades are rarely one for one. If {aName} and {bName} are only part of the deal, build
        the whole thing in Signal Check: it prices multi-player packages and draft picks together
        and grades the trade end to end.
      </p>
      <Link
        href="/tools/signal-check"
        className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        Build the full trade in Signal Check
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    </section>
  );
}

function EmptyState({
  formatDisplay,
  sourceDisplay,
  leagueAttached,
}: {
  formatDisplay: string;
  sourceDisplay: string | null;
  /** True when the reader arrived from a league page carrying their roster. */
  leagueAttached?: boolean;
}) {
  return (
    <div className="space-y-8">
      {leagueAttached && (
        <p
          role="status"
          className="rounded-card border border-brand-cyan/40 bg-brand-cyan/5 px-4 py-2 text-sm text-ink-muted"
        >
          <span className="font-medium text-ink">Your league is connected.</span> Pick two players
          and we will score them under your league&apos;s own rules and against your roster.
        </p>
      )}

      <BreakdownSelector formatDisplay={formatDisplay} sourceDisplay={sourceDisplay} />

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-cyan">
          How it works
        </p>
        <ul role="list" className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <HowCard
            icon={Users}
            title="Pick two players"
            body="Search any two skill players and drop them into the matchup."
          />
          <HowCard
            icon={Gauge}
            title="Choose your question"
            body="Dynasty, win now, or this week. The same numbers, weighted for what you're deciding."
          />
          <HowCard
            icon={Layers}
            title="See where the edge comes from"
            body="Every category, scored and weighted, with the exact rows that moved the verdict."
          />
          <HowCard
            icon={ScrollText}
            title="Make it about your team"
            body="Connect a Sleeper league to see what each one adds to your actual starting lineup."
          />
        </ul>
      </div>
    </div>
  );
}

function HowCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Users;
  title: string;
  body: string;
}) {
  return (
    <li className="rounded-card border border-line bg-surface/50 p-4">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
      >
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-3 text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{body}</p>
    </li>
  );
}

function ResultSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="h-28 animate-pulse rounded-modal border border-line bg-surface/40" />
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div className="h-44 animate-pulse rounded-modal border border-line bg-surface/40" />
        <div className="hidden w-14 sm:block" />
        <div className="h-44 animate-pulse rounded-modal border border-line bg-surface/40" />
      </div>
      <div className="h-40 animate-pulse rounded-modal border border-line bg-surface/40" />
      <div className="h-72 animate-pulse rounded-modal border border-line bg-surface/40" />
    </div>
  );
}

function AnalysisSkeleton() {
  return (
    <div className="space-y-6">
      <p role="status" className="sr-only">
        Working out the comparison.
      </p>
      <div aria-hidden="true" className="space-y-6">
        <div className="h-24 animate-pulse rounded-modal border border-line bg-surface/40" />
        <div className="h-48 animate-pulse rounded-modal border border-line bg-surface/40" />
        <div className="h-96 animate-pulse rounded-modal border border-line bg-surface/40" />
      </div>
    </div>
  );
}

function Hero({ isMember }: { isMember: boolean }) {
  return (
    <header className="relative -mt-[4.5rem] overflow-hidden border-b border-line">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 z-10 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />
      <HeroLavaField copy="center" />
      <div className="relative mt-[4.5rem] mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <h1
          aria-label="Beacon Breakdown. Two players. One verdict."
          className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl"
        >
          Beacon{" "}
          <span
            className="bg-clip-text text-transparent forced-colors:text-ink"
            style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
          >
            Breakdown
          </span>
        </h1>
        <p className="mt-4 text-xl font-semibold text-ink sm:text-2xl">Two players. One verdict.</p>
        <p className="mt-4 max-w-2xl text-[1rem] leading-relaxed text-ink-muted sm:text-lg">
          Compare players head-to-head on value, rankings, rest-of-season projections, and how
          often each one actually hits his number. Connect a league and we&apos;ll tell you what
          each is worth to your starting lineup.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <MemberHeroCta
            isMember={isMember}
            size="lg"
            memberMode="scroll"
            memberScrollTargetId="beacon-breakdown-section"
            memberLabel="Break down a matchup"
            memberIcon="arrow-down"
          />
          <Link
            href="/rankings"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            View player rankings
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}
