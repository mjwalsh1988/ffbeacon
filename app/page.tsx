import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { POSITIONS } from "@/lib/site";

export const dynamic = "force-dynamic";

type FeaturedTool = {
  href: string;
  title: string;
  description: string;
  icon: string;
};

const FEATURED_TOOLS: FeaturedTool[] = [
  {
    href: "/rankings",
    title: "Rankings Board",
    description: "Sortable, filterable rankings across every league type and scoring system.",
    icon: "📊",
  },
  {
    href: "/tools/league-sync",
    title: "Sleeper League Sync",
    description: "See every roster across all your Sleeper leagues in one accessible view.",
    icon: "🔗",
  },
  {
    href: "/tools/faab",
    title: "FAAB Calculator",
    description: "Set a confident waiver bid using market value, budget, and roster need.",
    icon: "💰",
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

const TRUST_POINTS = [
  {
    title: "Accessibility-first",
    body: "Built screen reader native from day one — every page works with NVDA, JAWS, and VoiceOver.",
  },
  {
    title: "20 years of fantasy",
    body: "Founder Michael has played fantasy since 2006 and now runs a stats-first dynasty stable across multiple formats.",
  },
  {
    title: "Free, no spam",
    body: "Core tools stay free forever. No autoplay, no email gates, no dark patterns.",
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
      <section aria-labelledby="hero-heading" className="border-b border-line">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <p className="mb-4 text-sm font-medium uppercase tracking-wider text-brand-purple">
            Fantasy football, built for everyone
          </p>
          <h1
            id="hero-heading"
            className="max-w-3xl text-5xl font-semibold leading-tight tracking-tight sm:text-6xl"
          >
            <span className="bg-beacon bg-clip-text text-transparent">Your signal</span>{" "}
            through the fantasy noise.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-ink-muted">
            Rankings, analysis, and tools that work for sighted fans and screen reader users alike.
            Built by Michael, an active dynasty manager who plays the game stats-first.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/rankings"
              className="inline-flex items-center rounded-card bg-beacon px-5 py-3 text-sm font-semibold text-black"
            >
              Browse rankings
            </Link>
            <Link
              href="/tools/league-sync"
              className="inline-flex items-center rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink hover:border-line-accent"
            >
              Sync your Sleeper leagues
            </Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="tools-heading" className="border-b border-line">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-end justify-between">
            <h2 id="tools-heading" className="text-2xl font-semibold tracking-tight">
              Featured tools
            </h2>
            <Link href="/tools" className="text-sm text-brand-cyan hover:underline">
              All tools
              <span aria-hidden="true"> →</span>
            </Link>
          </div>
          <ul className="grid gap-4 md:grid-cols-3">
            {FEATURED_TOOLS.map((tool) => (
              <li key={tool.href}>
                <Link
                  href={tool.href}
                  className="group flex h-full flex-col rounded-card border border-line bg-surface p-6 transition-colors hover:border-brand-purple"
                >
                  <span aria-hidden="true" className="mb-4 text-3xl">
                    {tool.icon}
                  </span>
                  <h3 className="text-lg font-semibold text-ink">{tool.title}</h3>
                  <p className="mt-2 flex-1 text-sm text-ink-muted">{tool.description}</p>
                  <span className="mt-4 text-sm font-medium text-brand-purple">
                    Open
                    <span aria-hidden="true" className="ml-1 transition-transform group-hover:translate-x-1">
                      →
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="positions-heading" className="border-b border-line">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <h2 id="positions-heading" className="text-2xl font-semibold tracking-tight">
            Jump by position
          </h2>
          <ul className="mt-6 flex flex-wrap gap-2">
            {POSITIONS.map((position) => (
              <li key={position}>
                <Link
                  href={`/rankings?position=${position}`}
                  className="inline-flex items-center gap-2 rounded-card border border-line bg-surface px-4 py-2 text-sm hover:border-line-accent"
                >
                  <span className="font-mono text-xs text-brand-cyan" aria-hidden="true">
                    {position}
                  </span>
                  <span>{POSITION_LABEL[position]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="formats-heading" className="border-b border-line">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <h2 id="formats-heading" className="text-2xl font-semibold tracking-tight">
            Rankings for every format
          </h2>
          <p className="mt-2 max-w-2xl text-ink-muted">
            Redraft, dynasty, superflex, TE premium. Pick the format that matches your league and the
            data adjusts.
          </p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(formats ?? []).map((format) => (
              <li key={format.slug}>
                <Link
                  href={`/rankings?format=${format.slug}`}
                  className="flex flex-col rounded-card border border-line bg-surface p-4 hover:border-brand-cyan"
                >
                  <span className="text-base font-medium text-ink">{format.display_name}</span>
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

      <section aria-labelledby="articles-heading" className="border-b border-line">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-end justify-between">
            <h2 id="articles-heading" className="text-2xl font-semibold tracking-tight">
              Latest analysis
            </h2>
            <Link href="/guides" className="text-sm text-brand-cyan hover:underline">
              All guides
              <span aria-hidden="true"> →</span>
            </Link>
          </div>
          {(articles ?? []).length === 0 ? (
            <p className="rounded-card border border-dashed border-line bg-surface p-6 text-sm text-ink-muted">
              Fresh analysis is coming this week. Rankings and tools are live and updating in the
              meantime.
            </p>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {articles!.map((article) => (
                <li key={article.slug}>
                  <Link
                    href={`/articles/${article.slug}`}
                    className="block rounded-card border border-line bg-surface p-6 hover:border-brand-purple"
                  >
                    <p className="text-xs uppercase tracking-wide text-brand-cyan">
                      {article.article_type.replace("_", " ")}
                    </p>
                    <h3 className="mt-2 text-lg font-semibold text-ink">{article.title}</h3>
                    {article.tl_dr && (
                      <p className="mt-2 text-sm text-ink-muted">{article.tl_dr}</p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="trust-heading">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <h2 id="trust-heading" className="sr-only">
            Why FF Beacon
          </h2>
          <ul className="grid gap-6 md:grid-cols-3">
            {TRUST_POINTS.map((point) => (
              <li key={point.title} className="rounded-card border border-line bg-surface p-6">
                <h3 className="text-base font-semibold text-ink">{point.title}</h3>
                <p className="mt-2 text-sm text-ink-muted">{point.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-center text-sm text-ink-muted">
            Built and maintained by{" "}
            <Link href="/author/michael" className="text-ink underline-offset-4 hover:underline">
              Michael
            </Link>
            . Real photo, real story,{" "}
            <Link href="/about" className="text-ink underline-offset-4 hover:underline">
              real mission
            </Link>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
