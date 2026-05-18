import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { POSITIONS } from "@/lib/site";
import {
  BarChart3,
  Workflow,
  Calculator,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";

export const dynamic = "force-dynamic";

type FeaturedTool = {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
};

const FEATURED_TOOLS: FeaturedTool[] = [
  {
    href: "/rankings",
    title: "Rankings Board",
    description:
      "Sortable, filterable rankings across redraft, dynasty, superflex, and TE-premium. Switch sources without losing your place.",
    icon: BarChart3,
  },
  {
    href: "/tools/league-sync",
    title: "Sleeper League Sync",
    description:
      "Paste your Sleeper username, get every league back with real rosters, real transactions, real draft slots, and power rankings calibrated to your scoring.",
    icon: Workflow,
  },
  {
    href: "/tools/faab",
    title: "FAAB Calculator",
    description:
      "Market value plus your real need, weighted into a bid range. Top-100 overall? You'll get told to dump it.",
    icon: Calculator,
  },
];

const POSITION_LABEL: Record<string, string> = {
  QB: "Quarterbacks",
  RB: "Running Backs",
  WR: "Wide Receivers",
  TE: "Tight Ends",
  K: "Kickers",
  DEF: "Defenses",
};

export default async function HomePage() {
  const supabase = await createClient();

  const [{ data: articles }, { data: formats }] = await Promise.all([
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
  ]);

  return (
    <main id="main">
      <Hero />
      <ToolsSection />
      <PositionsSection />
      <FormatsSection formats={formats ?? []} />
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
      <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8 lg:py-28">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          Fantasy football, built for everyone
        </p>
        <h1
          id="hero-heading"
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
          Rankings, calculators, and Sleeper league insights that read clearly
          by eye or by ear. Pick a format, pick a source, get answers — without
          the jargon tax or the unlabeled-chart shutdown.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/rankings"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Browse rankings
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
          <Link
            href="/tools/league-sync"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Sync your Sleeper leagues
          </Link>
        </div>

        <ul
          className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4"
          role="list"
          aria-label="What sets FF Beacon apart"
        >
          <HeroStat value="8" label="Active league formats" />
          <HeroStat value="Multi" label="Source-agnostic data" />
          <HeroStat value="AAA" label="WCAG contrast target" />
          <HeroStat value="Free" label="No paywall, ever" />
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

/* ---------- Featured tools ---------- */

function ToolsSection() {
  return (
    <section aria-labelledby="tools-heading" className="border-b border-line">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-2xl">
            <SectionEyebrow>What you can do here</SectionEyebrow>
            <h2
              id="tools-heading"
              className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
            >
              Three tools that respect your time and your reader.
            </h2>
          </div>
          <Link
            href="/tools"
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan hover:text-brand-purple"
          >
            All tools
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {FEATURED_TOOLS.map((tool) => (
            <ToolCard key={tool.href} {...tool} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ToolCard({ href, title, description, icon: Icon }: FeaturedTool) {
  return (
    <article className="flex flex-col rounded-card border border-line bg-surface p-6 transition-colors hover:border-brand-purple/60">
      <span
        aria-hidden="true"
        className="flex h-11 w-11 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
      >
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-4 text-lg font-semibold text-ink">{title}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">
        {description}
      </p>
      <Link
        href={href}
        className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan hover:text-brand-purple"
        aria-label={`Open ${title}`}
      >
        Open
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    </article>
  );
}

/* ---------- Jump by position ---------- */

function PositionsSection() {
  return (
    <section
      aria-labelledby="positions-heading"
      className="border-b border-line bg-surface/30"
    >
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <SectionEyebrow>Jump by position</SectionEyebrow>
        <h2
          id="positions-heading"
          className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          One tap to the bench you actually care about.
        </h2>

        <ul className="mt-8 flex flex-wrap gap-2" role="list">
          {POSITIONS.map((position) => (
            <li key={position}>
              <Link
                href={`/rankings?position=${position}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-base px-4 py-2 text-sm transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan"
              >
                <span
                  className="font-mono text-xs text-brand-cyan"
                  aria-hidden="true"
                >
                  {position}
                </span>
                <span>{POSITION_LABEL[position]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------- Rankings for every format ---------- */

type FormatRow = {
  slug: string;
  display_name: string;
  league_type: string;
  scoring_type: string;
  is_superflex: boolean;
  te_premium_bonus: number;
};

function FormatsSection({ formats }: { formats: FormatRow[] }) {
  return (
    <section aria-labelledby="formats-heading" className="border-b border-line">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionEyebrow>Pick the league you actually play</SectionEyebrow>
        <h2
          id="formats-heading"
          className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          Redraft, dynasty, superflex, TE premium — values adjust to match.
        </h2>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-muted">
          Eight active formats covered today, with more on the way as the data
          sources we trust publish them. Every format is also gated to the
          sources that actually publish for it, so you never see an empty board.
        </p>

        <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="list">
          {formats.map((format) => (
            <li key={format.slug}>
              <Link
                href={`/rankings?format=${format.slug}`}
                className="flex flex-col rounded-card border border-line bg-surface p-4 transition-colors hover:border-brand-cyan/60"
              >
                <span className="text-base font-medium text-ink">
                  {format.display_name}
                </span>
                <span className="mt-1 text-xs uppercase tracking-wide text-ink-subtle">
                  {format.league_type} • {format.scoring_type.replace("_", " ")}
                  {format.is_superflex ? " • superflex" : ""}
                  {Number(format.te_premium_bonus) > 0 ? " • TEP" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
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

function ArticlesSection({ articles }: { articles: ArticleRow[] }) {
  return (
    <section
      aria-labelledby="articles-heading"
      className="border-b border-line bg-surface/30"
    >
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-2xl">
            <SectionEyebrow>Latest analysis</SectionEyebrow>
            <h2
              id="articles-heading"
              className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
            >
              Plain-English breakdowns of the stats that matter.
            </h2>
          </div>
          <Link
            href="/guides"
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan hover:text-brand-purple"
          >
            All guides
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>

        {articles.length === 0 ? (
          <p className="mt-10 rounded-card border border-dashed border-line bg-base/40 p-6 text-sm text-ink-muted">
            Fresh analysis is on the way. Rankings, the FAAB calculator, and
            league sync are live and updating in the meantime.
          </p>
        ) : (
          <ul className="mt-10 grid gap-4 md:grid-cols-2" role="list">
            {articles.map((article) => (
              <li key={article.slug}>
                <Link
                  href={`/articles/${article.slug}`}
                  className="block rounded-card border border-line bg-surface p-6 transition-colors hover:border-brand-purple/60"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-cyan">
                    {article.article_type.replace("_", " ")}
                  </p>
                  <h3 className="mt-2 text-lg font-semibold text-ink">
                    {article.title}
                  </h3>
                  {article.tl_dr && (
                    <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                      {article.tl_dr}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ---------- CTA ---------- */

function CtaSection() {
  return (
    <section aria-labelledby="cta-heading">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div
          className="relative overflow-hidden rounded-modal border border-line bg-surface p-8 sm:p-12"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.12) 0%, transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.12) 0%, transparent 55%)",
          }}
        >
          <SectionEyebrow>Two minutes in</SectionEyebrow>
          <h2
            id="cta-heading"
            className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Bring your league. Or skim the rankings. Both work by ear.
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-muted">
            No signup to browse. Sign in only when you want to save your
            source, your format, and your linked Sleeper username — and read
            the privacy policy first if you want.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/tools/league-sync"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Sync a Sleeper league
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
