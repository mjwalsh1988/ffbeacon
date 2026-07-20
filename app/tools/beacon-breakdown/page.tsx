import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { BarChart3, Gauge, Layers, ScrollText, Swords, Users, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { loadBreakdown } from "@/lib/beacon-breakdown";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import { getAvailableSources, resolveSourceForFormat, describeSource } from "@/lib/source";
import { BreakdownSelector, type PickedPlayer } from "./breakdown-selector";
import { MatchupHeader } from "./matchup-header";
import { BeaconEdgeMeter } from "./beacon-edge-meter";
import { BreakdownTable } from "./breakdown-table";
import { QuickTakeaways, VerdictCard } from "./breakdown-summary";
import { BreakdownTabs } from "./breakdown-tabs";
import { StatsCompare } from "./stats-compare";
import { loadBreakdownStats } from "./load-stats";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { MemberHeroCta } from "@/components/member-hero-cta";
import { isDiscordMember } from "@/lib/discord-membership";
import { HeroAmbience } from "@/components/hero-ambience";

export const dynamic = "force-dynamic";

type SearchParams = {
  a?: string;
  b?: string;
  format?: string;
  source?: string;
};

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { a, b } = await searchParams;
  let title = "Beacon Breakdown: player comparison tool";
  let description =
    "Compare any two players head-to-head with side-by-side values, rankings, trends, and a plain-English verdict on who has the edge.";

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
      description = `${nameA} vs ${nameB} head-to-head: FF Beacon value, rankings, trends, and the Beacon Verdict on who has the edge.`;
    }
  }

  return { title, description };
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
  const [formatResolution, sourceResolution, registry] = await Promise.all([
    resolveFormatSlug(supabase, params.format),
    resolveSourceSlug(supabase, params.source),
    getAvailableSources(supabase),
  ]);
  const { data: formatRow } = await supabase
    .from("format_configs")
    .select("slug, display_name")
    .eq("slug", formatResolution.slug)
    .maybeSingle();
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
              <BreakdownResult
                slugA={params.a!}
                slugB={params.b!}
                formatParam={params.format}
                sourceParam={params.source}
                formatDisplayFallback={formatDisplay}
                sourceDisplayFallback={sourceDisplay}
              />
            </Suspense>
          ) : (
            <EmptyState formatDisplay={formatDisplay} sourceDisplay={sourceDisplay} />
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

async function BreakdownResult({
  slugA,
  slugB,
  formatParam,
  sourceParam,
  formatDisplayFallback,
  sourceDisplayFallback,
}: {
  slugA: string;
  slugB: string;
  formatParam?: string;
  sourceParam?: string;
  formatDisplayFallback: string;
  sourceDisplayFallback: string | null;
}) {
  const supabase = await createClient();
  const lookup = await loadBreakdown(supabase, slugA, slugB, { formatParam, sourceParam });

  if (!lookup.ok) {
    return (
      <div className="space-y-6">
        <p
          role="alert"
          className="rounded-card border border-signal-warning/40 bg-signal-warning/5 px-4 py-3 text-sm text-ink"
        >
          We couldn&rsquo;t find {lookup.missing.length > 1 ? "those players" : "that player"}.
          They may be inactive or the link may be out of date. Pick two players to try again.
        </p>
        <BreakdownSelector
          formatDisplay={formatDisplayFallback}
          sourceDisplay={sourceDisplayFallback}
        />
      </div>
    );
  }

  const { a, b, rows, edge, takeaways, verdict, context } = lookup.result;

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

  const stats = await loadBreakdownStats(supabase, a, b);

  const breakdownTab = (
    <div className="space-y-6">
      <BeaconEdgeMeter a={a} b={b} edge={edge} />

      <div className="rounded-modal border border-line bg-surface/40 p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">
            Category comparison
          </h3>
          <p className="text-xs text-ink-subtle">
            {context.formatDisplay}
            {context.sourceDisplay ? ` · ${context.sourceDisplay}` : ""}
          </p>
        </div>
        <BreakdownTable a={a} b={b} rows={rows} />
      </div>

      <QuickTakeaways a={a} b={b} takeaways={takeaways} />

      <VerdictCard verdict={verdict} />
    </div>
  );

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

      <BreakdownTabs
        tabs={[
          {
            id: "breakdown",
            label: "The Breakdown",
            icon: <Swords className="h-4 w-4" />,
            content: breakdownTab,
          },
          {
            id: "stats",
            label: "Stats",
            icon: <BarChart3 className="h-4 w-4" />,
            content: <StatsCompare a={stats.a} b={stats.b} />,
          },
        ]}
      />
    </div>
  );
}

function EmptyState({
  formatDisplay,
  sourceDisplay,
}: {
  formatDisplay: string;
  sourceDisplay: string | null;
}) {
  return (
    <div className="space-y-8">
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
            title="See the Beacon Edge"
            body="A single meter shows who has the stronger signal, at a glance."
          />
          <HowCard
            icon={Layers}
            title="Read the breakdown"
            body="Value, rank, production, risk, and upside, side by side with an edge on every row."
          />
          <HowCard
            icon={ScrollText}
            title="Get the verdict"
            body="A plain-English bottom line you can screenshot and share."
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

function Hero({ isMember }: { isMember: boolean }) {
  return (
    <header className="relative overflow-hidden border-b border-line">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 h-[360px] w-[820px] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(168, 85, 247, 0.16) 0%, rgba(34, 211, 238, 0.08) 45%, transparent 75%)",
        }}
      />
      <HeroAmbience variant="left" />
      <div className="relative mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
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
        <p className="mt-4 text-xl font-semibold text-ink sm:text-2xl">
          Two players. One verdict.
        </p>
        <p className="mt-4 max-w-2xl text-[1rem] leading-relaxed text-ink-muted sm:text-lg">
          Compare players head-to-head with side-by-side stats, rankings, and value signals, plus
          a quick takeaway on who actually has the edge. No spreadsheets, no jargon, just the
          call.
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
