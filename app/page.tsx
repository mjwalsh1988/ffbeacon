import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  Workflow,
  Calculator,
  Scale,
  Swords,
  Timer,
  ArrowRight,
  Radar,
  Layers,
  BookOpen,
  type LucideIcon,
} from "lucide-react";
import { SITE_TIME_ZONE } from "@/lib/datetime";

// Homepage description, drawn from the hero subtitle below. Kept to ~150
// characters so search engines and social cards show it without truncation.
const HOME_DESCRIPTION =
  "Fantasy football rankings, calculators, and Sleeper league insights that read clearly by eye or by ear. Pick a format and source and get clear answers.";

export const metadata: Metadata = {
  // `absolute` bypasses the root layout's "%s | FF Beacon" title template so
  // the homepage renders this exact string.
  title: {
    absolute: "FF Beacon - Your signal through the fantasy noise.",
  },
  description: HOME_DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "FF Beacon - Your signal through the fantasy noise.",
    description: HOME_DESCRIPTION,
    url: "/",
    siteName: "FF Beacon",
    type: "website",
    images: [
      {
        url: "/img/ff-beacon-logo.png",
        width: 782,
        height: 749,
        alt: "FF Beacon logo",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "FF Beacon - Your signal through the fantasy noise.",
    description: HOME_DESCRIPTION,
    images: ["/img/ff-beacon-logo.png"],
  },
};

export const dynamic = "force-dynamic";

type FeaturedTool = {
  href: string;
  title: string;
  description: string;
  cta: string;
  icon: LucideIcon;
};

const FEATURED_TOOLS: FeaturedTool[] = [
  {
    href: "/tools/league-pulse",
    title: "Sleeper League Pulse",
    description:
      "Type in your Sleeper username and pull back every league you are in: real rosters, recent trades, draft picks, and power rankings tuned to each league's own scoring.",
    cta: "Check your league's pulse",
    icon: Workflow,
  },
  {
    href: "/tools/on-the-clock",
    title: "On The Clock",
    description:
      "Drafting right now? Connect your live Sleeper draft and we will call out where your team needs help, run trade offers with a calculator and an analyzer for startup and rookie drafts, and open every team roster, the full trade history, live power rankings, and startup draft grades and awards.",
    cta: "Open the draft room",
    icon: Timer,
  },
  {
    href: "/tools/beacon-breakdown",
    title: "Beacon Breakdown",
    description:
      "Torn between two players? Drop them into a matchup card and see who has the edge, with side-by-side values, rankings, and trends, plus a plain-English verdict you can screenshot and share.",
    cta: "Compare players",
    icon: Swords,
  },
  {
    href: "/tools/signal-check",
    title: "Signal Check",
    description:
      "Thinking about a trade? Build both sides and get the Beacon Verdict: who wins, by how much, and why, in plain English and weighted for your league's exact scoring.",
    cta: "Analyze a trade",
    icon: Scale,
  },
  {
    href: "/tools/faab",
    title: "FAAB Calculator",
    description:
      "Heading into waivers and not sure what to spend? Get a recommended bid range that weighs a player's real value against how badly your roster needs them, in plain English.",
    cta: "Run a bid",
    icon: Calculator,
  },
];

export default async function HomePage() {
  const supabase = await createClient();

  const [{ data: articles }, { data: formats }, { data: sources }] =
    await Promise.all([
      supabase
        .from("articles")
        .select("slug, title, tl_dr, article_type, published_at")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(4),
      supabase
        .from("format_configs")
        .select("slug, display_name, league_type, scoring_type, is_superflex, te_premium_bonus")
        .eq("is_active", true)
        .order("display_order"),
      supabase
        .from("source_registry")
        .select(
          "slug, display_name, description, data_type, update_cadence, supported_format_slugs, is_default",
        )
        .eq("is_active", true)
        .order("priority"),
    ]);

  return (
    <main id="main">
      <Hero />
      <ToolsSection />
      <SourcesFormatsSection formats={formats ?? []} sources={sources ?? []} />
      <ArticlesSection articles={articles ?? []} />
      <CtaSection />
    </main>
  );
}

/* ---------- Hero ---------- */

function Hero() {
  return (
    <header className="relative overflow-hidden border-b border-line">
      {/* Beacon-gradient accent bar pinned to the very top of the page. */}
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
        className="pointer-events-none absolute -top-32 left-1/2 h-[460px] w-[900px] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(168, 85, 247, 0.18) 0%, rgba(34, 211, 238, 0.10) 45%, transparent 75%)",
        }}
      />
      <div className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-24 lg:px-8 lg:py-28">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          Fantasy football, built for everyone
        </p>
        {/* aria-label gives the h1 a single accessible name covering the
            entire headline, so heading navigation announces it as one piece
            even though the gradient is achieved via a nested span. We
            intentionally do NOT aria-hide the inner content, which would
            remove the text from the accessibility tree and break
            mouse-hover-to-read features. */}
        <h1
          id="hero-heading"
          aria-label="Your signal through the fantasy noise."
          className="max-w-4xl text-5xl font-semibold leading-tight tracking-tight sm:text-6xl md:text-7xl"
        >
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
            }}
          >
            Your signal
          </span>{" "}
          through the fantasy noise.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-muted">
          We are a community first, and everything we build grows out of that.
          Our mission is simple: keep sharp fantasy football help free for
          everyone. The heart of it lives in our Discord, where real people
          answer your lineup, trade, and draft questions, no matter how new you
          are. No paywall, no gatekeeping.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="/join"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Join our Discord (opens in new tab)"
            className="inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon px-5 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <DiscordGlyph className="h-5 w-5" />
            Join our Discord
          </a>
          <Link
            href="/tools/on-the-clock"
            className="inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <Timer aria-hidden="true" className="h-4 w-4" />
            Live draft help
          </Link>
        </div>

        <ul
          className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4"
          role="list"
          aria-label="What sets FF Beacon apart"
        >
          <HeroStat value="All" label="League formats" />
          <HeroStat value="Multi" label="Source-agnostic data" />
          <HeroStat value="AAA" label="WCAG contrast target" />
          <HeroStat value="Free" label="No paywall" />
        </ul>
      </div>
    </header>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <li className="rounded-card border border-line bg-surface/60 p-4">
      <p
        className="bg-clip-text font-mono text-3xl font-bold tabular-nums text-transparent sm:text-4xl"
        style={{
          backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
        }}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        {label}
      </p>
    </li>
  );
}

/** Discord wordmark glyph, matching the icon used in the footer and the
 *  floating Discord CTA. Lucide ships no Discord icon, so we inline the
 *  official brand path. Decorative: the surrounding link carries the label. */
function DiscordGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable={false}
    >
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.07.07 0 0 0-.075.035c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.075-.035 19.74 19.74 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.2 14.2 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

/* ---------- Featured tools ---------- */

function ToolsSection() {
  return (
    <section
      aria-labelledby="tools-heading"
      className="relative overflow-hidden border-b border-line"
    >
      {/* Ambient beacon glow that lifts the elevated cards off the page and makes
          this first content section read as the starting point. Decorative. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 h-[380px] w-[760px] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(168, 85, 247, 0.12) 0%, rgba(34, 211, 238, 0.07) 45%, transparent 72%)",
        }}
      />
      <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionEyebrow>Free tools, no signup</SectionEyebrow>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <h2
            id="tools-heading"
            className="text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Rank your players, read your league, win your waivers.
          </h2>
          <Link
            href="/tools"
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            See all tools
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* Top row: 2 across (Signal Check, On The Clock). Bottom row: 3 across
            (Rankings, League Pulse, FAAB). Everything stacks on mobile. */}
        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {FEATURED_TOOLS.slice(0, 2).map((tool, i) => (
            <ToolCard key={tool.href} tool={tool} index={i} />
          ))}
        </div>
        <div className="mt-5 grid gap-5 md:grid-cols-3">
          {FEATURED_TOOLS.slice(2).map((tool, i) => (
            <ToolCard key={tool.href} tool={tool} index={i + 2} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ToolCard({ tool, index }: { tool: FeaturedTool; index: number }) {
  const { href, title, description, cta, icon: Icon } = tool;
  return (
    <Link
      href={href}
      className="group relative flex flex-col rounded-card border border-line bg-surface-elevated p-6 shadow-lg shadow-black/20 transition-all duration-200 hover:-translate-y-1 hover:border-brand-purple/60 hover:shadow-xl hover:shadow-brand-purple/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <div className="flex items-center justify-between">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-card bg-beacon text-black"
        >
          <Icon className="h-6 w-6" />
        </span>
        <span
          aria-hidden="true"
          className="font-mono text-sm font-semibold tracking-[0.2em] text-ink-subtle"
        >
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>
      <h3 className="mt-5 text-xl font-semibold text-ink">{title}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">
        {description}
      </p>
      <span className="mt-5 inline-flex items-center gap-1.5 self-start rounded-card border border-brand-cyan/40 bg-brand-cyan/10 px-3.5 py-2 text-sm font-semibold text-brand-cyan transition-colors group-hover:border-brand-cyan group-hover:bg-brand-cyan/20 group-hover:text-ink">
        {cta}
        <ArrowRight
          aria-hidden="true"
          className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </span>
    </Link>
  );
}

/* ---------- Sources and formats ---------- */

type FormatRow = {
  slug: string;
  display_name: string;
  league_type: string;
  scoring_type: string;
  is_superflex: boolean;
  te_premium_bonus: number;
};

type SourceRow = {
  slug: string;
  display_name: string;
  description: string | null;
  data_type: string[];
  update_cadence: string;
  supported_format_slugs: string[] | null;
  is_default: boolean;
};

const BEACON_SOURCE_SLUG = "ffbeacon";

/** How many of the currently active formats a source actually publishes for.
 *  A null supported list means "every active format" (see source_registry). */
function coverageCount(source: SourceRow, activeFormatSlugs: Set<string>): number {
  if (!source.supported_format_slugs) return activeFormatSlugs.size;
  return source.supported_format_slugs.filter((s) => activeFormatSlugs.has(s)).length;
}

/** Plain-English expansion of a format's abbreviations, for sighted and
 *  screen-reader users alike (SF becomes Superflex, TEP becomes TE premium). */
function describeFormat(f: FormatRow): string {
  const parts: string[] = [];
  if (f.slug.startsWith("bestball")) parts.push("Best Ball");
  parts.push(f.league_type === "dynasty" ? "Dynasty" : "Redraft");
  parts.push(
    f.scoring_type === "ppr"
      ? "PPR"
      : f.scoring_type === "half_ppr"
        ? "Half PPR"
        : "Standard",
  );
  if (f.is_superflex) parts.push("Superflex");
  if (Number(f.te_premium_bonus) > 0) parts.push("TE premium");
  return parts.join(", ");
}

function SourcesFormatsSection({
  formats,
  sources,
}: {
  formats: FormatRow[];
  sources: SourceRow[];
}) {
  const activeFormatSlugs = new Set(formats.map((f) => f.slug));
  const beacon = sources.find((s) => s.slug === BEACON_SOURCE_SLUG) ?? null;
  const otherSources = sources.filter((s) => s.slug !== BEACON_SOURCE_SLUG);

  return (
    <section aria-labelledby="data-heading" className="border-b border-line">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionEyebrow>Rankings for your league</SectionEyebrow>
        <h2
          id="data-heading"
          className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          However your league scores, we have rankings to match.
        </h2>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-muted">
          Compare {sources.length} trusted ranking source
          {sources.length === 1 ? "" : "s"} side by side, or just trust our own
          FF Beacon number. Every set of rankings is tuned to your exact scoring,
          across {formats.length} league types. Pick yours once and the whole
          site follows along.
        </p>

        {/* --- Sources --- */}
        <h3
          id="sources-subheading"
          className="mt-12 text-xs font-semibold uppercase tracking-[0.18em] text-ink-subtle"
        >
          Where the numbers come from
        </h3>

        {beacon && <FeaturedSourceCard source={beacon} />}

        {otherSources.length > 0 && (
          <ul
            className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            role="list"
            aria-label="Other ranking sources"
          >
            {otherSources.map((source) => (
              <li key={source.slug}>
                <SourceCard
                  source={source}
                  coverage={coverageCount(source, activeFormatSlugs)}
                />
              </li>
            ))}
          </ul>
        )}

        {/* --- Formats --- */}
        <h3
          id="formats-subheading"
          className="mt-14 text-xs font-semibold uppercase tracking-[0.18em] text-ink-subtle"
        >
          Pick your scoring ({formats.length} league types)
        </h3>
        <ul
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          role="list"
          aria-labelledby="formats-subheading"
        >
          {formats.map((format) => (
            <li key={format.slug}>
              <Link
                href={`/rankings?format=${format.slug}`}
                className="group flex h-full flex-col rounded-card border border-line bg-surface p-4 transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-base font-medium text-ink">
                    {format.display_name}
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 text-ink-subtle transition-all group-hover:translate-x-0.5 group-hover:text-brand-cyan motion-reduce:transition-none"
                  />
                </span>
                <span className="mt-1 text-xs text-ink-muted">
                  {describeFormat(format)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Small rounded chip used for source metadata (cadence, coverage, data type). */
function MetaPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-base px-2.5 py-0.5 text-[11px] font-medium text-ink-muted">
      {children}
    </span>
  );
}

function sourceMetaPills(source: SourceRow, coverage: number) {
  const cadence =
    source.update_cadence.charAt(0).toUpperCase() + source.update_cadence.slice(1);
  const hasPicks = source.data_type.includes("draft_pick_values");
  return (
    <>
      <MetaPill>{cadence} updates</MetaPill>
      <MetaPill>
        {coverage} format{coverage === 1 ? "" : "s"}
      </MetaPill>
      <MetaPill>{hasPicks ? "Player and pick values" : "Player values"}</MetaPill>
    </>
  );
}

/** The FF Beacon source, given prominence: our own proprietary ranking. */
function FeaturedSourceCard({ source }: { source: SourceRow }) {
  return (
    <Link
      href={`/rankings?source=${source.slug}`}
      className="group relative mt-4 flex flex-col overflow-hidden rounded-modal border border-brand-purple/40 bg-surface-elevated p-6 shadow-lg shadow-black/20 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-purple/70 hover:shadow-xl hover:shadow-brand-purple/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-8"
    >
      {/* Beacon glow wash in the corner. Decorative. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(168, 85, 247, 0.16) 0%, rgba(34, 211, 238, 0.08) 50%, transparent 72%)",
        }}
      />
      <div className="relative flex flex-wrap items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-card bg-beacon text-black"
        >
          <Radar className="h-6 w-6" />
        </span>
        <div>
          <span className="inline-flex items-center rounded-full border border-brand-purple/50 bg-brand-purple/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-purple">
            Our secret sauce
          </span>
          <h4 className="mt-1 text-xl font-semibold text-ink">
            {source.display_name} value
          </h4>
        </div>
      </div>

      <p className="relative mt-4 max-w-2xl text-sm leading-relaxed text-ink-muted">
        Our own number, and we keep the recipe behind the counter. A proprietary
        model does the heavy number-crunching, AI-powered analytics sweat the
        close calls, and our founder and team add the human read that pure math
        always misses. What you get is a single FF Beacon value, tuned to cut
        through the noise instead of echoing it.
      </p>

      <div className="relative mt-5 flex flex-wrap items-center gap-2">
        <MetaPill>
          {source.update_cadence.charAt(0).toUpperCase() +
            source.update_cadence.slice(1)}{" "}
          updates
        </MetaPill>
        <MetaPill>Supports all league formats</MetaPill>
        <MetaPill>
          {source.data_type.includes("draft_pick_values")
            ? "Player and pick values"
            : "Player values"}
        </MetaPill>
      </div>

      <span className="relative mt-6 inline-flex items-center gap-1.5 self-start rounded-card border border-brand-cyan/40 bg-brand-cyan/10 px-3.5 py-2 text-sm font-semibold text-brand-cyan transition-colors group-hover:border-brand-cyan group-hover:bg-brand-cyan/20 group-hover:text-ink">
        See the FF Beacon board
        <ArrowRight
          aria-hidden="true"
          className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </span>
    </Link>
  );
}

/** A third-party ranking source rendered from its source_registry row. */
function SourceCard({
  source,
  coverage,
}: {
  source: SourceRow;
  coverage: number;
}) {
  return (
    <Link
      href={`/rankings?source=${source.slug}`}
      className="group flex h-full flex-col rounded-card border border-line bg-surface p-5 transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
        >
          <Layers className="h-4 w-4" />
        </span>
        <h4 className="text-base font-semibold text-ink">{source.display_name}</h4>
        {source.is_default && (
          <span className="inline-flex items-center rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-cyan">
            Default
          </span>
        )}
      </div>
      {source.description && (
        <p className="mt-3 flex-1 text-sm leading-relaxed text-ink-muted">
          {source.description}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {sourceMetaPills(source, coverage)}
      </div>
    </Link>
  );
}

/* ---------- Latest analysis ---------- */

type ArticleRow = {
  slug: string;
  title: string;
  tl_dr: string | null;
  article_type: string;
  published_at: string | null;
};

function formatArticleDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: SITE_TIME_ZONE,
  });
}

function ArticlesSection({ articles }: { articles: ArticleRow[] }) {
  return (
    <section
      aria-labelledby="articles-heading"
      className="border-b border-line bg-surface/30"
    >
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionEyebrow>Guides for beginners and beyond</SectionEyebrow>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <h2
            id="articles-heading"
            className="text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            New to this? We explain the stats that matter, no jargon.
          </h2>
          <Link
            href="/guides"
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            See all guides
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>

        {articles.length === 0 ? (
          <div className="mt-10 flex flex-col items-center rounded-modal border border-dashed border-line bg-base/40 px-6 py-12 text-center">
            <span
              aria-hidden="true"
              className="flex h-12 w-12 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
            >
              <BookOpen className="h-6 w-6" />
            </span>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-muted">
              Fresh breakdowns are on the way. In the meantime the rankings, the
              FAAB calculator, and league sync are live and updating daily.
            </p>
          </div>
        ) : (
          <ul className="mt-10 grid gap-5 md:grid-cols-2" role="list">
            {articles.map((article) => (
              <li key={article.slug}>
                <ArticleCard article={article} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ArticleCard({ article }: { article: ArticleRow }) {
  return (
    <Link
      href={`/brief/${article.slug}`}
      className="group flex h-full flex-col rounded-card border border-line bg-surface-elevated p-6 shadow-lg shadow-black/20 transition-all duration-200 hover:-translate-y-1 hover:border-brand-purple/60 hover:shadow-xl hover:shadow-brand-purple/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-cyan">
          {article.article_type.replace(/_/g, " ")}
        </span>
        {article.published_at && (
          <span className="text-xs text-ink-subtle">
            {formatArticleDate(article.published_at)}
          </span>
        )}
      </div>
      <h3 className="mt-3 text-lg font-semibold text-ink">{article.title}</h3>
      {article.tl_dr && (
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          {article.tl_dr}
        </p>
      )}
      <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-semibold text-brand-cyan transition-colors group-hover:text-brand-purple">
        Read the breakdown
        <ArrowRight
          aria-hidden="true"
          className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </span>
    </Link>
  );
}

/* ---------- CTA ---------- */

function CtaSection() {
  return (
    <section aria-labelledby="cta-heading">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div
          className="relative overflow-hidden rounded-modal border border-line bg-surface-elevated p-8 shadow-xl shadow-black/30 sm:p-12"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.16) 0%, transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.16) 0%, transparent 55%)",
          }}
        >
          {/* Beacon hairline across the top of the card. Decorative. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              backgroundImage:
                "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
            }}
          />
          <div className="relative">
            <SectionEyebrow>Ready when you are</SectionEyebrow>
            <h2
              id="cta-heading"
              className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl"
            >
              Sync your league, or just browse the rankings. Start free.
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-muted">
              Browse everything with no signup and no paywall. Make an account
              only when you want your source, your format, and your Sleeper
              username saved, so the whole site remembers you the next time you
              drop in.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/tools/league-pulse"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                Pulse a Sleeper league
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
              <Link
                href="/rankings"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                Explore the rankings
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
              <Link
                href="/about"
                className="inline-flex min-h-11 items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-ink-muted hover:text-ink"
              >
                Read about the project
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Shared ---------- */

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
      {children}
    </p>
  );
}
