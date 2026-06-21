import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  BarChart3,
  Workflow,
  Calculator,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";

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
    href: "/rankings",
    title: "Rankings Board",
    description:
      "See exactly where every player ranks today, sorted and filtered the way you think. Switch between scoring formats and ranking sites without ever losing your spot.",
    cta: "Open the rankings",
    icon: BarChart3,
  },
  {
    href: "/tools/league-pulse",
    title: "Sleeper League Pulse",
    description:
      "Type in your Sleeper username and pull back every league you are in: real rosters, recent trades, draft picks, and power rankings tuned to each league's own scoring.",
    cta: "Check your league's pulse",
    icon: Workflow,
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
        {/* aria-label gives the h1 a single accessible name covering the
            entire headline, so heading navigation announces it as one piece
            even though the gradient is achieved via a nested span. We
            intentionally do NOT aria-hide the inner content — that would
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
            href="/tools/league-pulse"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Pulse your Sleeper leagues
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
        <SectionEyebrow>Start here</SectionEyebrow>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <h2
            id="tools-heading"
            className="text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Three tools that turn the noise into a clear call.
          </h2>
          <Link
            href="/tools"
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            See all tools
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {FEATURED_TOOLS.map((tool, i) => (
            <ToolCard key={tool.href} tool={tool} index={i} />
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
