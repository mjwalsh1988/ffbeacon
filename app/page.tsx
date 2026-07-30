import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MemberHeroCta } from "@/components/member-hero-cta";
import { isDiscordMember } from "@/lib/discord-membership";
import { getDiscordGuildStats, type DiscordGuildStats } from "@/lib/discord-stats";
import { HeroSignalBackdrop } from "@/components/hero-signal-backdrop";
import { DiscordGlyph } from "@/components/discord-glyph";
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
  Unlock,
  Users,
  BarChart3,
  Users2,
  CheckCircle2,
  Flame,
  type LucideIcon,
} from "lucide-react";
import { SITE_TIME_ZONE } from "@/lib/datetime";

// Homepage description, drawn from the hero subtitle below. Kept to ~150
// characters so search engines and social cards show it without truncation.
const HOME_DESCRIPTION =
  "FF Beacon is a community-first fantasy football home. Get free lineup, trade, and draft help in our Discord, plus rankings and tools with no paywall.";

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
  /** Optional highlight pill (e.g. "Draft season") shown in the card corner. */
  badge?: string;
  /** When true, the card gets the accented "featured" treatment. */
  featured?: boolean;
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
    badge: "Draft season",
    featured: true,
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

/**
 * How many articles the homepage links, and how many of those get a full card.
 *
 * The remainder render as a headline list beside the cards (see ArticlesSection). The
 * count is the lever on crawl depth: every article listed here is one click from the
 * homepage instead of several pagination hops deep.
 */
const HOMEPAGE_ARTICLE_COUNT = 25;
const HOMEPAGE_FEATURED_COUNT = 4;

export default async function HomePage() {
  const supabase = await createClient();

  const [{ data: articles }, { data: formats }, { data: sources }] =
    await Promise.all([
      // 25, not 4. The homepage is the strongest internal link source on the site,
      // and it used to pass link equity to only 4 articles while the other ~106 sat
      // behind pagination. The section below features the newest 4 as cards and lists
      // the rest as headlines, so ~25 articles are one click from the homepage
      // without the section turning into a wall.
      supabase
        .from("articles")
        .select("slug, title, tl_dr, article_type, published_at")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(HOMEPAGE_ARTICLE_COUNT),
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

  // Confirmed Discord members don't need the "Join our Discord" hero/CTA
  // buttons; they get pointed at the toolkit instead. Live guild stats power the
  // hero's community card (null when Discord can't be reached, handled below).
  const [isMember, discordStats] = await Promise.all([
    isDiscordMember(),
    getDiscordGuildStats(),
  ]);

  return (
    <main id="main">
      <Hero isMember={isMember} discordStats={discordStats} />
      <ToolsSection />
      <GamesSection />
      <SourcesFormatsSection formats={formats ?? []} sources={sources ?? []} />
      <ArticlesSection articles={articles ?? []} />
      <CtaSection isMember={isMember} />
    </main>
  );
}

/* ---------- Hero ---------- */

type HeroFeature = { icon: LucideIcon; label: string };

const HERO_FEATURES: HeroFeature[] = [
  { icon: Unlock, label: "No paywall" },
  { icon: Users, label: "Real community help" },
  { icon: BarChart3, label: "League-specific insights" },
];

function Hero({
  isMember,
  discordStats,
}: {
  isMember: boolean;
  discordStats: DiscordGuildStats | null;
}) {
  return (
    <header className="relative -mt-16 overflow-hidden border-b border-line">
      {/* The negative top margin pulls the hero up behind the transparent site
          header so this animated backdrop shows through it and the nav floats
          in the hero. The content wrapper below adds top padding to clear the
          nav. */}
      {/* Beacon-gradient accent bar pinned to the very top of the page. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 z-10 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />
      <HeroSignalBackdrop />

      <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-24 sm:px-6 sm:pb-20 sm:pt-28 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center lg:gap-12 lg:px-8 lg:pb-28 lg:pt-36 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        {/* Left column: headline, copy, CTAs, feature pills. */}
        <div className="max-w-2xl">
          {/* aria-label gives the h1 a single accessible name covering the
              entire headline, so heading navigation announces it as one piece
              even though the gradient is achieved via nested spans. We
              intentionally do NOT aria-hide the inner content, which would
              remove the text from the accessibility tree and break
              mouse-hover-to-read features. */}
          <h1
            id="hero-heading"
            aria-label="Your signal through the fantasy noise."
            className="text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-[4.25rem]"
          >
            Your <GradientWord>signal</GradientWord> through the{" "}
            <GradientWord>fantasy</GradientWord> noise.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-muted">
            We are a community first, and everything we build grows out of that.
            Our mission is simple: keep sharp fantasy football help free for
            everyone. The heart of it lives in our Discord, where real people
            answer your lineup, trade, and draft questions, no matter how new you
            are. No paywall, no gatekeeping.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <MemberHeroCta
              isMember={isMember}
              size="lg"
              memberMode="link"
              memberHref="/tools"
              memberLabel="Explore our fantasy tools"
              memberIcon="tools"
            />
            <Link
              href="/tools/on-the-clock"
              className="inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-surface/70 px-5 py-3 text-sm font-medium text-ink backdrop-blur-sm transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <Timer aria-hidden="true" className="h-4 w-4" />
              Live draft help
            </Link>
          </div>

          <ul
            className="mt-10 flex flex-wrap gap-2.5"
            role="list"
            aria-label="What sets FF Beacon apart"
          >
            {HERO_FEATURES.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3.5 py-2 text-sm font-medium text-ink-muted backdrop-blur-sm"
              >
                <Icon
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-brand-cyan"
                />
                {label}
              </li>
            ))}
          </ul>
        </div>

        {/* Right column: the Discord community card with live guild stats. */}
        <div className="mt-12 lg:mt-0">
          <DiscordCommunityCard isMember={isMember} stats={discordStats} />
        </div>
      </div>
    </header>
  );
}

/** A single word painted with the beacon purple->cyan gradient. */
function GradientWord({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="bg-clip-text text-transparent"
      style={{
        backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
      }}
    >
      {children}
    </span>
  );
}

/**
 * "The heart of FF Beacon" hero card. Shows LIVE Discord guild numbers (total
 * members and how many are online right now) pulled from Discord's own API, and
 * adapts its footer CTA to membership: non-members get the Join invite, confirmed
 * members get a welcome-back note pointing at the tools. When live stats can't be
 * fetched the card still renders, just without the number tiles.
 */
function DiscordCommunityCard({
  isMember,
  stats,
}: {
  isMember: boolean;
  stats: DiscordGuildStats | null;
}) {
  const memberCount = stats ? formatCount(stats.memberCount) : null;
  const onlineCount = stats ? formatCount(stats.onlineCount) : null;

  return (
    <section
      aria-labelledby="discord-card-heading"
      className="relative overflow-hidden rounded-modal border border-brand-purple/40 bg-surface-elevated/80 p-6 shadow-xl shadow-black/40 backdrop-blur-md sm:p-7"
    >
      {/* Beacon wash in the corner. Decorative. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(168, 85, 247, 0.22) 0%, rgba(34, 211, 238, 0.10) 50%, transparent 72%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />

      <div className="relative flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-card bg-beacon text-black"
        >
          <DiscordGlyph className="h-6 w-6" />
        </span>
        <div>
          <h2
            id="discord-card-heading"
            className="text-lg font-semibold text-ink"
          >
            The heart of FF Beacon
          </h2>
          <p className="text-sm text-ink-subtle">Our Discord community</p>
        </div>
      </div>

      {stats ? (
        <dl className="relative mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-card border border-line bg-base/60 p-4">
            <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
              <Users2 aria-hidden="true" className="h-3.5 w-3.5" />
              Members
            </dt>
            <dd className="mt-1.5 font-mono text-3xl font-bold tabular-nums text-ink">
              {memberCount}
            </dd>
          </div>
          <div className="rounded-card border border-line bg-base/60 p-4">
            <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
              <span
                aria-hidden="true"
                className="hero-live-dot inline-block h-2 w-2 rounded-full bg-signal-success"
              />
              Online now
            </dt>
            <dd className="mt-1.5 font-mono text-3xl font-bold tabular-nums text-signal-success">
              {onlineCount}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="relative mt-6 rounded-card border border-line bg-base/60 p-4 text-sm leading-relaxed text-ink-muted">
          Real people answering real fantasy questions, every day. Lineup calls,
          trade gut-checks, and draft help, all free.
        </p>
      )}

      <p className="relative mt-5 flex items-center gap-2 text-sm font-medium text-ink-muted">
        <span
          aria-hidden="true"
          className="bg-clip-text font-semibold text-transparent"
          style={{
            backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
          }}
        >
          Real people. Real answers. Real results.
        </span>
      </p>

      {/* Membership-aware footer CTA. Non-members see the Join invite; confirmed
          members get a welcome-back note instead of a redundant invite. */}
      {isMember ? (
        <div className="relative mt-5 flex items-center gap-2 rounded-card border border-signal-success/30 bg-signal-success/10 px-4 py-3 text-sm font-medium text-ink">
          <CheckCircle2
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-signal-success"
          />
          You are in the crew. Thanks for being here.
        </div>
      ) : (
        <a
          href="/join"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Join our Discord (opens in new tab)"
          className="relative mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-card bg-beacon px-5 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <DiscordGlyph className="h-5 w-5" />
          Join our Discord
        </a>
      )}
    </section>
  );
}

/** Compact human count: 1,243 stays as-is; 12,842 -> 12.8K. */
function formatCount(n: number): string {
  if (n < 10_000) return n.toLocaleString("en-US");
  return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
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
            Read your league, ace your draft, win your week.
          </h2>
          <Link
            href="/tools"
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            See all tools
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* Top row: 2 across (League Pulse, On The Clock). Bottom row: 3 across
            (Beacon Breakdown, Signal Check, FAAB). Everything stacks on mobile. */}
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
  const { href, title, description, cta, icon: Icon, badge, featured } = tool;
  return (
    <Link
      href={href}
      className={`group relative flex flex-col overflow-hidden rounded-card border p-6 shadow-lg transition-all duration-200 hover:-translate-y-1 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
        featured
          ? "border-brand-purple/60 bg-surface-elevated shadow-brand-purple/20 ring-1 ring-brand-purple/20 hover:border-brand-purple hover:shadow-brand-purple/30"
          : "border-line bg-surface-elevated shadow-black/20 hover:border-brand-purple/60 hover:shadow-brand-purple/10"
      }`}
    >
      {/* Featured cards get a beacon glow wash in the corner. Decorative. */}
      {featured && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(168, 85, 247, 0.20) 0%, rgba(34, 211, 238, 0.09) 50%, transparent 72%)",
          }}
        />
      )}
      <div className="relative flex items-center justify-between">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-card bg-beacon text-black"
        >
          <Icon className="h-6 w-6" />
        </span>
        {badge ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-beacon px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-black">
            <Flame aria-hidden="true" className="h-3.5 w-3.5" />
            {badge}
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="font-mono text-sm font-semibold tracking-[0.2em] text-ink-subtle"
          >
            {String(index + 1).padStart(2, "0")}
          </span>
        )}
      </div>
      <h3 className="relative mt-5 text-xl font-semibold text-ink">{title}</h3>
      <p className="relative mt-2 flex-1 text-sm leading-relaxed text-ink-muted">
        {description}
      </p>
      <span className="relative mt-5 inline-flex items-center gap-1.5 self-start rounded-card border border-brand-cyan/40 bg-brand-cyan/10 px-3.5 py-2 text-sm font-semibold text-brand-cyan transition-colors group-hover:border-brand-cyan group-hover:bg-brand-cyan/20 group-hover:text-ink">
        {cta}
        <ArrowRight
          aria-hidden="true"
          className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </span>
    </Link>
  );
}

/* ---------- Games ---------- */

type FeaturedGame = {
  href: string;
  title: string;
  description: string;
  cta: string;
  icon: LucideIcon;
  status: string;
};

const FEATURED_GAMES: FeaturedGame[] = [
  {
    href: "/games/signal-scout",
    title: "Signal Scout",
    description:
      "A mystery player. A handful of clues. Decode the scouting profile and name the player before the signal burns out.",
    cta: "Start scouting",
    icon: Radar,
    status: "New",
  },
];

function GamesSection() {
  return (
    <section aria-labelledby="games-heading" className="border-b border-line">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionEyebrow>Free games, real data</SectionEyebrow>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <h2
            id="games-heading"
            className="text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Decode the profile. Find the player.
          </h2>
          <Link
            href="/games"
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            See all games
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {FEATURED_GAMES.map((game) => (
            <GameCard key={game.href} game={game} />
          ))}
        </div>
      </div>
    </section>
  );
}

function GameCard({ game }: { game: FeaturedGame }) {
  const { href, title, description, cta, icon: Icon, status } = game;
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
        <span className="inline-flex items-center rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-cyan">
          {status}
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
              {/* Links at the format's own page, not /rankings?format=. The path
                  is the indexable URL for this format; the query param version
                  canonicalizes away, so linking it would spend the homepage's link
                  equity on a URL that consolidates elsewhere. */}
              <Link
                href={`/rankings/${format.slug}`}
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

/* ---------- Latest from the Beacon Brief ---------- */

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

/**
 * Latest from the Beacon Brief: 4 featured cards beside a headline list.
 *
 * Two jobs at once. For a reader, the cards give the newest stories room to sell
 * themselves while the list makes the rest scannable at a glance. For crawlers, the
 * homepage now links ~25 articles instead of 4, which is the cheapest available fix
 * for the crawl depth problem: with prev/next-only pagination at 9 per page, the
 * oldest article sat 13 hops from /brief and Google left most of the library
 * unindexed as "Discovered - currently not indexed".
 *
 * The list is deliberately plain anchors carrying the full article title as their
 * visible text. Anchor text is a relevance signal, and "Read more" would waste it.
 * Both columns render at every breakpoint (stacked on mobile, side by side from lg),
 * so no headline is hidden from a phone.
 */
function ArticlesSection({ articles }: { articles: ArticleRow[] }) {
  const featured = articles.slice(0, HOMEPAGE_FEATURED_COUNT);
  const headlines = articles.slice(HOMEPAGE_FEATURED_COUNT);

  return (
    <section
      aria-labelledby="articles-heading"
      className="border-b border-line bg-surface/30"
    >
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionEyebrow>The Beacon Brief</SectionEyebrow>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <h2
            id="articles-heading"
            className="text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            The latest fantasy news, explained in plain English.
          </h2>
          <Link
            href="/brief"
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Check out the Beacon Brief
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
              Fresh Beacon Brief stories are on the way. In the meantime the
              rankings, the FAAB calculator, and league sync are live and updating
              daily.
            </p>
          </div>
        ) : (
          <div className="mt-10 grid items-start gap-8 lg:grid-cols-2 lg:gap-10">
            <div>
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                Latest coverage
              </h3>
              <ul className="grid gap-5 sm:grid-cols-2" role="list">
                {featured.map((article) => (
                  <li key={article.slug}>
                    <ArticleCard article={article} />
                  </li>
                ))}
              </ul>
            </div>

            {headlines.length > 0 && (
              <div>
                <h3
                  id="more-headlines-heading"
                  className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle"
                >
                  More headlines
                </h3>
                <ul
                  aria-labelledby="more-headlines-heading"
                  role="list"
                  className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface"
                >
                  {headlines.map((article) => (
                    <li key={article.slug}>
                      <Link
                        href={`/brief/${article.slug}`}
                        className="flex min-h-11 items-baseline justify-between gap-4 px-4 py-3 text-sm text-ink-muted transition-colors hover:bg-base hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                      >
                        <span className="font-medium">{article.title}</span>
                        {article.published_at && (
                          <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-ink-subtle">
                            {formatArticleDate(article.published_at)}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
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

function CtaSection({ isMember }: { isMember: boolean }) {
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
            <SectionEyebrow>
              {isMember ? "Already in the crew" : "Ready when you are"}
            </SectionEyebrow>
            <h2
              id="cta-heading"
              className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl"
            >
              {isMember
                ? "You're in the Discord. Now let the tools go to work."
                : "Real people in the Discord, real help on the clock."}
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-muted">
              {isMember
                ? "Thanks for being part of the crew, so we'll skip the invite. Everything we build is free and ready to use, from live draft help to trade grades and waiver bids. Drafting tonight? Connect your live Sleeper draft and let On The Clock call out your team's needs pick by pick."
                : "Jump into our Discord for free lineup, trade, and draft advice from real fantasy players, no matter how new you are. Drafting tonight? Connect your live Sleeper draft and let On The Clock call out your team's needs pick by pick. No paywall, ever."}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <MemberHeroCta
                isMember={isMember}
                size="md"
                memberMode="link"
                memberHref="/tools"
                memberLabel="Explore our fantasy tools"
                memberIcon="tools"
              />
              <Link
                href="/tools/on-the-clock"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <Timer aria-hidden="true" className="h-3.5 w-3.5" />
                Get live draft help
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
