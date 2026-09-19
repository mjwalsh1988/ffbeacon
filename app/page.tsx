import type { Metadata } from "next";
import { Suspense } from "react";
import { pageShareMetadata } from "@/lib/page-og";
import Link from "next/link";
import { MemberHeroCta } from "@/components/member-hero-cta";
import { isDiscordMember } from "@/lib/discord-membership";
import {
  getDiscordGuildStats,
  type DiscordGuildStats,
} from "@/lib/discord-stats";
import {
  loadHomeContent,
  type HomeFormatRow,
  type HomeSourceRow,
} from "@/lib/home-content";
import type { LatestBrief, RelayCardData } from "@/lib/relays/load";
import { RelayGrid } from "@/components/relays/relay-grid";
import { LatestBriefPanel } from "@/components/relays/latest-brief-panel";
import { HeroLavaField } from "@/components/hero-lava-field";
import { DiscordGlyph } from "@/components/discord-glyph";
import { AuthorPortrait } from "@/components/author-portrait";
import {
  Workflow,
  Calculator,
  Scale,
  Swords,
  UserSearch,
  Timer,
  ArrowRight,
  Radar,
  Vote,
  Clock,
  Layers,
  Hourglass,
  BookOpen,
  Unlock,
  Users,
  BarChart3,
  Users2,
  CheckCircle2,
  HeartHandshake,
  Accessibility,
  Keyboard,
  Smartphone,
  Eye,
  Headphones,
  Trophy,
  ListOrdered,
  TrendingUp,
  Cog,
  type LucideIcon,
} from "lucide-react";
import { formatEasternShortDate } from "@/lib/datetime";
import { SITE } from "@/lib/site";
import { TERM_COUNT } from "@/lib/guides/fantasy-football-terms";
import { PUBLISHED_GUIDES, newestPublishedGuide } from "@/lib/guides/published";
import type { ToolHref } from "@/lib/tools-catalog";
import type { HomepageToolCard } from "@/lib/site-layout/default-settings";
import { loadSiteLayout } from "@/lib/site-layout/settings";
import {
  CARD_ACCENT_CLASSES,
  CARD_GLOW,
  CARD_WIDTH_CLASSES,
  ToolBadgePill,
} from "@/components/tool-badge";

// What the homepage says about itself to a search engine and to anyone who
// pastes the link into a group chat. Leads with what is free and what you get,
// because that is the question a stranger is actually asking.
//
// The title names the site in the words people search for ("fantasy football
// rankings", tools, news). The slogan it replaced matched no search anyone types
// (docs/seo-audit/seo-audit-and-plan.md, finding B03). The slogan stays as the
// page's h1. 57 characters, under the 60 a results page shows.
const HOME_TITLE = "FF Beacon: Free Fantasy Football Rankings, Tools and News";
const HOME_DESCRIPTION =
  "Free fantasy football rankings, trade grades, draft help, and league tools, with a Discord to sanity-check your lineup. Works by ear or by eye.";

export const metadata: Metadata = {
  // `absolute` bypasses the root layout's "%s | FF Beacon" title template so
  // the homepage renders this exact string.
  title: {
    absolute: HOME_TITLE,
  },
  description: HOME_DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  ...pageShareMetadata({
    key: "home",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    path: "/",
  }),
};

export const dynamic = "force-dynamic";

/**
 * What each homepage tool card says: only the words and the icon.
 *
 * Which order the cards run in, how wide each one is, and which carry a tag or
 * a highlight is the admin-edited site layout (lib/site-layout, edited at
 * /admin/site-layout). Typed as a full record over every tool, so a tool added
 * to the catalog without card copy is a type error rather than a blank card.
 */
type ToolCardContent = {
  title: string;
  description: string;
  cta: string;
  icon: LucideIcon;
};

const TOOL_CARD_CONTENT: Record<ToolHref, ToolCardContent> = {
  "/tools/league-pulse": {
    title: "Sleeper League Pulse",
    description:
      "Type in your Sleeper username, or save it once and skip the typing, and pull back every league you are in: real rosters, recent trades, draft picks, and power rankings tuned to each league's own scoring.",
    cta: "Check your league's pulse",
    icon: Workflow,
  },
  "/tools/trade-calculator": {
    title: "Signal Check Trade Calculator",
    description:
      "Thinking about a trade? Build both sides in our fantasy football trade calculator and get the Beacon Verdict: who wins, by how much, and why, in plain English and weighted for your league's exact scoring.",
    cta: "Analyze a trade",
    icon: Scale,
  },
  "/tools/who-should-i-start": {
    title: "Beacon Breakdown: Who Should I Start?",
    description:
      "Put your players in and get a start/sit verdict built from this week's projections and matchups, with the confidence to back it.",
    cta: "Find out who to start",
    icon: Swords,
  },
  "/tools/faab": {
    title: "FAAB Calculator",
    description:
      "Heading into waivers and not sure what to spend? Get a recommended bid range that weighs a player's real value against how badly your roster needs them, in plain English.",
    cta: "Run a bid",
    icon: Calculator,
  },
  "/tools/manager-pulse": {
    title: "Manager Pulse",
    description:
      "About to offer a trade and want to know who you are dealing with? Type their Sleeper username and see four seasons of how they actually play: the players they keep buying, what they overpay for, and how often they win.",
    cta: "Scout a manager",
    icon: UserSearch,
  },
  "/tools/on-the-clock": {
    title: "On The Clock",
    description:
      "Drafting right now? Connect your live Sleeper draft and we will call out where your team needs help, run trade offers with a calculator and an analyzer for startup and rookie drafts, and open every team roster, the full trade history, live power rankings, and startup draft grades and awards.",
    cta: "Open the draft room",
    icon: Timer,
  },
};

/** What the member-aware hero and CTA need: auth state plus a live Discord read.
 *  Kept separate from loadHomeContent() because neither can run inside
 *  unstable_cache (it forbids cookies()) and neither is safe to share across
 *  readers the way the public content is. */
type MemberContext = {
  isMember: boolean;
  discordStats: DiscordGuildStats | null;
};

async function loadMemberContext(): Promise<MemberContext> {
  // Confirmed Discord members don't need the "Join our Discord" hero/CTA
  // buttons; they get pointed at the toolkit instead. Live guild stats power the
  // hero's community card (null when Discord can't be reached, handled below).
  const [isMember, discordStats] = await Promise.all([
    isDiscordMember(),
    getDiscordGuildStats(),
  ]);
  return { isMember, discordStats };
}

export default async function HomePage() {
  const [{ latestBrief, relays, formats, sources }, layout] = await Promise.all([
    loadHomeContent(),
    loadSiteLayout(),
  ]);

  // Started here, not awaited: Hero and CtaSection each read this same promise
  // from their own Suspense boundary, so the auth check and the Discord call
  // run exactly once and the static sections below don't wait on either of them.
  const memberContext = loadMemberContext();

  return (
    <main id="main">
      <Hero memberContext={memberContext} />
      <ToolsSection cards={layout.homepage.cards} />
      <GamesSection />
      <GuidesSection />
      <ArticlesSection latestBrief={latestBrief} relays={relays} />
      <SourcesFormatsSection formats={formats} sources={sources} />
      <FounderSection />
      <CtaSection memberContext={memberContext} />
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

function Hero({ memberContext }: { memberContext: Promise<MemberContext> }) {
  return (
    <header className="relative overflow-hidden border-b border-line">
      {/* The site header is opaque and sits above this block, so the hero
          starts directly under it. The animated backdrop fills the hero
          itself rather than bleeding up behind the nav. */}
      {/* Beacon-gradient accent bar pinned to the top of the hero. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 z-10 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />
      <HeroLavaField copy="left" />

      <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-12 sm:px-6 sm:pb-20 sm:pt-14 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center lg:gap-12 lg:px-8 lg:pb-24 lg:pt-20 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
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
            answer your lineup, trade, and draft questions, no matter how new
            you are. No paywall, no gatekeeping.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {/* Short labels on purpose: the hero shows two of these three
                buttons at once, and the longer wording pushed the pair onto two
                rows at phone width. */}
            <Suspense fallback={<HeroCtaFallback />}>
              <HeroPrimaryCta memberContext={memberContext} />
            </Suspense>
            <Link
              href="/rankings"
              className="inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-surface/70 px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <BarChart3 aria-hidden="true" className="h-4 w-4" />
              Player Rankings
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
                className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3.5 py-2 text-sm font-medium text-ink-muted"
              >
                <Icon
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-brand-cyan"
                />
                {label}
              </li>
            ))}
          </ul>

          {/* Byline. Same "By {name}" pattern as the guide pages (rel="author"
              ties the link to the person their Article schema already names).
              Beacon Brief articles credit FF Beacon as author instead, because
              software drafts them. */}
          <p className="mt-6 text-xs text-ink-subtle">
            Built by{" "}
            <Link
              rel="author"
              href={SITE.author.bylineHref}
              className="font-semibold text-ink-muted underline underline-offset-2 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {SITE.author.name}
            </Link>
            .
          </p>
        </div>

        {/* Right column: the Discord community card with live guild stats. */}
        <div className="mt-12 lg:mt-0">
          <Suspense fallback={<DiscordCardFallback />}>
            <DiscordCommunityCardAsync memberContext={memberContext} />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

/** The hero's primary CTA, resolved from the shared member/Discord read. A
 *  thin async wrapper rather than passing a boolean prop, so this piece alone
 *  can sit behind its own Suspense boundary while the static headline and
 *  copy beside it render immediately. */
async function HeroPrimaryCta({
  memberContext,
}: {
  memberContext: Promise<MemberContext>;
}) {
  const { isMember } = await memberContext;
  return (
    <MemberHeroCta
      isMember={isMember}
      size="lg"
      memberMode="link"
      memberHref="/tools"
      memberLabel="Free Tools"
      memberIcon="tools"
      joinLabel="Join Discord"
    />
  );
}

/** Loading placeholder for the hero's primary CTA button. Same min-height as
 *  the real button (min-h-11) so it doesn't shift the layout when it resolves. */
function HeroCtaFallback() {
  return (
    <span role="status" className="inline-flex">
      <span
        aria-hidden="true"
        className="h-11 w-40 animate-pulse rounded-card bg-surface/70"
      />
      <span className="sr-only">Loading membership status</span>
    </span>
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

/** Thin async wrapper so the Discord community card can sit behind its own
 *  Suspense boundary, independent of the hero's headline and the primary CTA
 *  button beside it. */
async function DiscordCommunityCardAsync({
  memberContext,
}: {
  memberContext: Promise<MemberContext>;
}) {
  const { isMember, discordStats } = await memberContext;
  return <DiscordCommunityCard isMember={isMember} stats={discordStats} />;
}

/** Loading placeholder for the Discord community card. Same outer chrome
 *  (border, rounded-modal, padding) as the real card and a height close to its
 *  common case (the stats grid, not the no-stats paragraph) so the layout
 *  doesn't jump when the real card streams in. */
function DiscordCardFallback() {
  return (
    <div
      role="status"
      className="relative overflow-hidden rounded-modal border border-brand-purple/40 bg-surface-elevated/80 p-6 shadow-xl shadow-black/40 sm:p-7"
    >
      <div aria-hidden="true" className="flex items-center gap-3">
        <div className="h-12 w-12 shrink-0 animate-pulse rounded-card bg-base/60" />
        <div className="space-y-2">
          <div className="h-5 w-40 animate-pulse rounded bg-base/60" />
          <div className="h-4 w-28 animate-pulse rounded bg-base/60" />
        </div>
      </div>
      <div aria-hidden="true" className="mt-6 grid grid-cols-2 gap-3">
        <div className="h-24 animate-pulse rounded-card border border-line bg-base/60" />
        <div className="h-24 animate-pulse rounded-card border border-line bg-base/60" />
      </div>
      <div
        aria-hidden="true"
        className="mt-5 h-11 animate-pulse rounded-card bg-base/60"
      />
      <span className="sr-only">
        Loading our Discord community's live numbers
      </span>
    </div>
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
      className="relative overflow-hidden rounded-modal border border-brand-purple/40 bg-surface-elevated/80 p-6 shadow-xl shadow-black/40 sm:p-7"
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
            backgroundImage:
              "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
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

function ToolsSection({ cards }: { cards: HomepageToolCard[] }) {
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

        {/* One grid: three columns from md, two from sm, one on a phone. Each
            card's width comes from the admin layout. The flow is deliberately
            NOT dense, so a gap a wide card leaves is left empty rather than
            filled by a card drawn out of order; the visual order always matches
            the reading and tab order. /admin/site-layout previews the rows. */}
        <div className="mt-12 grid gap-5 sm:grid-cols-2 md:grid-cols-3">
          {cards.map((card, i) => (
            <ToolCard key={card.href} card={card} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ToolCard({ card, index }: { card: HomepageToolCard; index: number }) {
  const { title, description, cta, icon: Icon } = TOOL_CARD_CONTENT[card.href];
  const { badge, highlight } = card;
  return (
    <Link
      href={card.href}
      className={`group relative flex flex-col overflow-hidden rounded-card border p-6 shadow-lg transition-all duration-200 hover:-translate-y-1 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${CARD_ACCENT_CLASSES[highlight ?? "none"]} ${CARD_WIDTH_CLASSES[card.width]}`}
    >
      {/* A highlighted card gets a glow wash in the corner, in its own accent,
          so two highlights chosen for different reasons do not read as the
          same promotion. Decorative. */}
      {highlight && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full"
          style={{ background: CARD_GLOW[highlight] }}
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
          <ToolBadgePill badge={badge} />
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
  /** Absent while the game is still being built. A card with no href renders
   *  as a non-interactive "coming soon" placeholder rather than a dead link.
   *  Nothing is in that state right now; the branch stays for the next one. */
  href?: string;
  title: string;
  description: string;
  /** Only meaningful on a playable game. */
  cta?: string;
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
  {
    href: "/games/would-you-rather",
    title: "Would You Rather?",
    description:
      "A real trade out of a real league, with the managers' names taken off. Call the winner, then see how the room voted and what the full grade says.",
    cta: "Call a trade",
    icon: Vote,
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
            Guess the player. Pick a side.
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
            // Keyed by title, not href: an unbuilt game has no href yet.
            <GameCard key={game.title} game={game} />
          ))}
        </div>
      </div>
    </section>
  );
}

function GameCard({ game }: { game: FeaturedGame }) {
  const { href, title, description, cta, icon: Icon, status } = game;

  // A game still being built gets a non-interactive card: dashed border,
  // recessed surface, muted icon, and no hover lift. Rendering it as a Link
  // would put a dead destination in the tab order and promise a page that does
  // not exist. Same treatment the pending cards on /guides use, so "not built
  // yet" looks the same everywhere on the site.
  if (!href) {
    return (
      <article className="relative flex flex-col rounded-card border border-dashed border-line bg-base/40 p-6">
        <div className="flex items-center justify-between">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-card border border-dashed border-line bg-surface text-ink-muted"
          >
            <Icon className="h-6 w-6" />
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-line bg-base px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
            <Clock aria-hidden="true" className="h-3 w-3" />
            {status}
          </span>
        </div>
        <h3 className="mt-5 text-xl font-semibold text-ink-muted">{title}</h3>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">
          {description}
        </p>
        <span className="mt-5 inline-flex items-center gap-1.5 self-start rounded-card border border-dashed border-line px-3.5 py-2 text-sm font-semibold text-ink-subtle">
          In development
        </span>
      </article>
    );
  }

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

// Row shapes are owned by lib/home-content.ts, which is what actually queries
// them; these are local aliases so the rest of this file doesn't have to spell
// out the "Home" prefix everywhere.
type FormatRow = HomeFormatRow;
type SourceRow = HomeSourceRow;

const BEACON_SOURCE_SLUG = "ffbeacon";

/** How many of the currently active formats a source actually publishes for.
 *  A null supported list means "every active format" (see source_registry). */
function coverageCount(
  source: SourceRow,
  activeFormatSlugs: Set<string>,
): number {
  if (!source.supported_format_slugs) return activeFormatSlugs.size;
  return source.supported_format_slugs.filter((s) => activeFormatSlugs.has(s))
    .length;
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
          FF Beacon number. Every set of rankings is tuned to your exact
          scoring, across {formats.length} league types. Pick yours once and the
          whole site follows along.
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
    source.update_cadence.charAt(0).toUpperCase() +
    source.update_cadence.slice(1);
  const hasPicks = source.data_type.includes("draft_pick_values");
  return (
    <>
      <MetaPill>{cadence} updates</MetaPill>
      <MetaPill>
        {coverage} format{coverage === 1 ? "" : "s"}
      </MetaPill>
      <MetaPill>
        {hasPicks ? "Player and pick values" : "Player values"}
      </MetaPill>
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
        <h4 className="text-base font-semibold text-ink">
          {source.display_name}
        </h4>
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

/**
 * The Beacon Brief block: the latest published Brief beside the four newest
 * Relays (docs/beacon-brief/relays-and-briefs-plan.md, section 6.5).
 *
 * The Brief card is the thing worth a reader's click and the one page here that
 * search engines are asked to index; the Relays are the running feed and each
 * links to its own permalink and to the hub. Both columns render at every
 * breakpoint (stacked on a phone, side by side from lg), so nothing is hidden
 * from a small screen.
 *
 * When no edition exists yet the Brief column is not rendered at all and the
 * Relay column takes the full width. There is no placeholder sentence: a
 * promise that an edition is coming is thin content on the page search engines
 * read first, and the empty column it sat in was an empty grid cell.
 *
 * Heading levels: the section is an h2, the panel's edition title and the
 * "Newest reports" label are h3s under it, and each Relay card is an h4 under
 * its own group heading. The panel prints its own "Latest Brief" eyebrow, so
 * this block does not repeat those words above it.
 */
function ArticlesSection({
  latestBrief,
  relays,
}: {
  latestBrief: LatestBrief | null;
  relays: RelayCardData[];
}) {
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
            What changed this week, and what to do about it.
          </h2>
          <Link
            href="/brief"
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Open the Beacon Brief
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>

        {relays.length === 0 && !latestBrief ? (
          <div className="mt-10 flex flex-col items-center rounded-modal border border-dashed border-line bg-base/40 px-6 py-12 text-center">
            <span
              aria-hidden="true"
              className="flex h-12 w-12 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
            >
              <BookOpen className="h-6 w-6" />
            </span>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-muted">
              The desk has not accepted a report yet. The rankings, the FAAB
              calculator, and league sync are live and updating daily.
            </p>
          </div>
        ) : (
          <div className="mt-10 space-y-10">
            {latestBrief && <LatestBriefPanel brief={latestBrief} headingLevel={3} />}

            {relays.length > 0 && (
              <div>
                <h3
                  id="latest-relays-heading"
                  className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle"
                >
                  Newest reports
                </h3>
                {/* Three compact cards across on a wide screen, one per row on
                    a phone; each headline clamps at three lines and the full
                    report is one link away. */}
                <RelayGrid relays={relays} headingLevel={4} labelledBy="latest-relays-heading" />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------- Guides ---------- */

/**
 * The guides shelf on the homepage: one spotlight and a stack.
 *
 * This used to be a single card pointing at /guides, written when the shelf
 * held one guide. It now reads the register (lib/guides/published.ts), so a
 * guide that ships appears here the same day without a homepage edit. The
 * newest guide gets the spotlight, with its date and the lessons inside it, and
 * the rest sit in a stack beside it as rows a reader can scan in one pass.
 *
 * HOME_GUIDE_DETAILS holds the words this surface needs that the register does
 * not carry: an icon, a one-line hint, and the lessons for the spotlight. A
 * guide with no entry still renders, on a book icon and its register summary,
 * so a missing row here is a duller card rather than a missing guide.
 *
 * Every column renders at every width. On a phone the spotlight stacks above
 * the shelf; nothing is hidden.
 */
type HomeGuideDetail = {
  icon: LucideIcon;
  hint: string;
  /** What the spotlight lists under "Inside". Only read for the newest guide. */
  lessons?: string[];
};

const HOME_GUIDE_DETAILS: Record<string, HomeGuideDetail> = {
  "fantasy-football-terms": {
    icon: BookOpen,
    hint: `${TERM_COUNT} terms, each defined once and then explained properly`,
    lessons: [
      "PPR, superflex, FAAB and every other word your league chat assumes",
      "What the analytics measure, from target share to yards per route run",
    ],
  },
  "fantasy-football-draft-guide": {
    icon: ListOrdered,
    hint: "Steals, swings and fades in every format, rebuilt nightly",
    lessons: [
      "The players going later than they should, per format",
      "Tier-based drafting and how to read a cliff",
    ],
  },
  "how-ff-beacon-works": {
    icon: Cog,
    hint: "The methodology behind every number on the site",
    lessons: [
      "The projection engine and the matchup model",
      "The reliability discount and the confidence figure",
    ],
  },
  "positional-war-explained": {
    icon: TrendingUp,
    hint: "Why scarcity beats raw points, for beginners",
    lessons: [
      "The replacement player, and why he decides everything",
      "How to read the Positional WAR curve for your own league",
      "Move the replacement line yourself and watch the gap change",
    ],
  },
  "faab-strategy": {
    icon: Calculator,
    hint: "How much to bid on the waiver wire, and when to spend it all",
    lessons: [
      "Bid ranges for a league-winner, a new starter, a streamer and a stash",
      "Why September dollars and December dollars are not the same money",
      "Reading the room: the ceiling is yours, the bid is theirs",
    ],
  },
  "fantasy-football-trade-guide": {
    icon: Scale,
    hint: "How to judge any trade before you send it",
    lessons: [
      "Why value and wins are two different scales",
      "The 2-for-1 trap, and the roster spot you get back",
      "Buying low without fooling yourself",
      "How to pitch a trade that gets accepted",
    ],
  },
  "superflex-strategy": {
    icon: Layers,
    hint: "Quarterbacks when everyone needs two",
    lessons: [
      "Why the free quarterback moves twelve places, with a live table",
      "How many quarterbacks to roster in redraft, dynasty and best ball",
      "One pillar, then let the run tell you, from any draft slot",
      "Your third quarterback is value, not wins",
    ],
  },
  "dynasty-strategy": {
    icon: Hourglass,
    hint: "When to contend, when to rebuild",
    lessons: [
      "Find your lane with the same code League Pulse uses to tag your team",
      "Why the middle is the worst place in dynasty",
      "Who the dynasty market pays for by age, live from tonight's values",
      "Rookie pick hit rates by slot, and when picks are cheapest",
    ],
  },
  "fantasy-football-playoffs": {
    icon: Trophy,
    hint: "Your odds, the trade deadline and the title run",
    lessons: [
      "What playoff odds mean, with a worksheet for your own record",
      "Luck against points for, and the all-play record",
      "Buy, hold or sell at the deadline, by odds rather than record",
      "Floor when favored, ceiling when you are the underdog",
    ],
  },
};

const FALLBACK_GUIDE_DETAIL: HomeGuideDetail = { icon: BookOpen, hint: "" };

function guideDetail(slug: string): HomeGuideDetail {
  return HOME_GUIDE_DETAILS[slug] ?? FALLBACK_GUIDE_DETAIL;
}

function GuidesSection() {
  const newest = newestPublishedGuide();
  const shelf = PUBLISHED_GUIDES.filter((g) => g.slug !== newest.slug);
  const spotlight = guideDetail(newest.slug);
  const SpotlightIcon = spotlight.icon;

  return (
    <section
      aria-labelledby="guides-heading"
      className="relative overflow-hidden border-b border-line"
    >
      {/* The same ambient wash the tools section carries, mirrored to the
          right, so the shelf reads as lit rather than as a footer. Decorative. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 right-0 h-[380px] w-[620px] translate-x-1/4"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(34, 211, 238, 0.10) 0%, rgba(168, 85, 247, 0.07) 45%, transparent 72%)",
        }}
      />
      <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionEyebrow>Learn the game</SectionEyebrow>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <h2
            id="guides-heading"
            className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Guides written the way a good friend explains it.
          </h2>
          <Link
            href="/guides"
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Browse all guides
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="mt-10 grid items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-8">
          {/* The spotlight: the newest guide, with what is inside it. */}
          <article
            aria-labelledby="guide-spotlight-heading"
            className="relative flex flex-col overflow-hidden rounded-modal border border-line-accent bg-surface-elevated p-6 shadow-lg shadow-black/20 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-cyan sm:p-8"
            style={{
              backgroundImage:
                "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.16) 0%, transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.12) 0%, transparent 55%)",
            }}
          >
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-0.5"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, #A855F7 0%, #22D3EE 100%)",
              }}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span
                className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-black"
                style={{
                  backgroundImage:
                    "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
                }}
              >
                Newest guide
              </span>
              <time
                dateTime={newest.publishedAt}
                className="text-xs text-ink-subtle"
              >
                {formatEasternShortDate(newest.publishedAt)}
              </time>
              <span className="text-xs text-ink-subtle">Free to read</span>
            </div>

            <div className="mt-5 flex items-start gap-4">
              <span
                aria-hidden="true"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-card bg-beacon text-black"
              >
                <SpotlightIcon className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <h3
                  id="guide-spotlight-heading"
                  className="text-2xl font-semibold tracking-tight text-ink"
                >
                  {/* Stretched link: the heading is the accessible name and the
                      whole spotlight is clickable, one tab stop. */}
                  <Link
                    href={`/guides/${newest.slug}`}
                    className="after:absolute after:inset-0 after:content-[''] hover:text-brand-cyan focus-visible:outline-none"
                  >
                    {newest.title}
                  </Link>
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  {newest.summary}.
                </p>
              </div>
            </div>

            {spotlight.lessons && spotlight.lessons.length > 0 && (
              <div className="mt-6">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                  Inside
                </p>
                <ul role="list" className="mt-2 grid gap-2 sm:grid-cols-2">
                  {spotlight.lessons.map((lesson, i) => (
                    <li
                      key={lesson}
                      className="flex items-start gap-2.5 rounded-card border border-line bg-base/50 px-3 py-2.5 text-sm leading-relaxed text-ink"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-brand-cyan"
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span>{lesson}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Visual affordance only. The stretched link on the heading is the
                real control, so this is hidden from assistive tech. */}
            <p
              aria-hidden="true"
              className="mt-6 inline-flex items-center gap-1.5 self-start rounded-card border border-brand-cyan/40 bg-brand-cyan/10 px-3.5 py-2 text-sm font-semibold text-brand-cyan"
            >
              Read the guide
              <ArrowRight className="h-3.5 w-3.5" />
            </p>
          </article>

          {/* The shelf: every other guide as a row, in register order, which
              is also the order a new reader should take them in. */}
          <div className="flex flex-col gap-4">
            <h3
              id="guide-shelf-heading"
              className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle"
            >
              The rest of the shelf
            </h3>
            <ul
              aria-labelledby="guide-shelf-heading"
              role="list"
              className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface"
            >
              {shelf.map((guide) => {
                const detail = guideDetail(guide.slug);
                const Icon = detail.icon;
                return (
                  <li key={guide.slug}>
                    <Link
                      href={`/guides/${guide.slug}`}
                      className="group flex min-h-11 items-center gap-3 px-4 py-3 transition-colors hover:bg-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                    >
                      <span
                        aria-hidden="true"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-ink group-hover:text-brand-cyan">
                          {guide.title}
                        </span>
                        {detail.hint && (
                          <span className="block text-xs leading-relaxed text-ink-muted">
                            {detail.hint}
                          </span>
                        )}
                      </span>
                      <ArrowRight
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0 text-ink-subtle transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand-cyan motion-reduce:transition-none"
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>

            <dl className="grid grid-cols-3 gap-2">
              <div className="rounded-card border border-line bg-base/50 px-3 py-2.5 text-center">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                  Guides
                </dt>
                <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-brand-cyan">
                  {PUBLISHED_GUIDES.length}
                </dd>
              </div>
              <div className="rounded-card border border-line bg-base/50 px-3 py-2.5 text-center">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                  Terms defined
                </dt>
                <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-brand-purple">
                  {TERM_COUNT}
                </dd>
              </div>
              <div className="rounded-card border border-line bg-base/50 px-3 py-2.5 text-center">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                  Cost to read
                </dt>
                <dd className="mt-0.5 font-mono text-lg font-semibold text-ink">
                  Free
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Founder ---------- */

/**
 * Who builds the site, and why it reads the way it does. Written in Michael's
 * own voice, first person, because a homepage that talks ABOUT its founder in
 * the third person reads like a press release and this is a one-person site.
 *
 * Every claim here is one the about page or the author page already makes:
 * twenty seasons since 2006, blind, NVDA every day, the four build rules.
 * Nothing is invented for the homepage, so the three pages cannot disagree
 * about the person behind the byline.
 *
 * It sits low on the page on purpose. A first-time visitor wants the tools; a
 * visitor who has scrolled this far is asking who made them and whether to
 * trust the numbers, and that is the question this answers.
 */

type BuildRule = { icon: LucideIcon; title: string; body: string };

const BUILD_RULES: BuildRule[] = [
  {
    icon: Accessibility,
    title: "Real HTML first",
    body: "A button is a button and a table is a table. I use ARIA to fill the gaps HTML cannot express, never the other way round.",
  },
  {
    icon: Keyboard,
    title: "Everything works by keyboard",
    body: "Every control is reachable without a mouse, and I never remove a focus ring without putting a replacement in its place.",
  },
  {
    icon: Smartphone,
    title: "Nothing is dropped on a phone",
    body: "When a table will not fit, the row restacks. I never hide a column to make the layout easier.",
  },
  {
    icon: Eye,
    title: "Color never carries meaning alone",
    body: "Every colored state is paired with words, so a verdict reads the same by ear as it looks on the page.",
  },
];

function FounderSection() {
  return (
    <section aria-labelledby="founder-heading" className="border-b border-line">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div
          className="relative overflow-hidden rounded-modal border border-brand-purple/30 bg-surface-elevated p-6 shadow-xl shadow-black/40 sm:p-10"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 100% 0%, rgba(168, 85, 247, 0.18) 0%, transparent 50%), radial-gradient(ellipse at 0% 100%, rgba(34, 211, 238, 0.14) 0%, transparent 50%)",
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

          <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
            {/* The story. */}
            <div className="min-w-0">
              <SectionEyebrow>
                A note from the guy who built this
              </SectionEyebrow>
              <h2
                id="founder-heading"
                className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
              >
                Hi, I&apos;m Michael. I built the fantasy site I couldn&apos;t
                find anywhere else.{" "}
                <GradientWord>It reads by ear or by eye.</GradientWord>
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-muted">
                I&apos;ve played fantasy football since 2006, twenty seasons of
                redraft, dynasty, superflex and tight end premium. I&apos;m also
                blind, and I run every one of my leagues with a screen reader.
                For most of those years the tools everyone else loved were the
                thing standing between me and my own lineup.
              </p>
              <div className="mt-6 max-w-2xl border-l-2 border-brand-cyan/60 pl-5">
                <p className="text-base leading-relaxed text-ink sm:text-lg">
                  Every app I tried had friction sighted users never notice:
                  stats trapped inside an unlabeled chart, filters you can only
                  reach with a mouse, player news that updates silently. At some
                  point I stopped waiting for somebody else to fix it.
                </p>
              </div>
              <p className="mt-6 max-w-2xl text-base leading-relaxed text-ink-muted">
                So every screen here is written as real HTML first, then driven
                with a keyboard and a screen reader before it ships, and a
                number sounds the same as it looks. If you can see just fine,
                you still get something out of that: a site that works by ear
                has nothing hiding in a chart, so it is faster for everyone.
                Come find me in{" "}
                <Link
                  href="/join"
                  className="font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  the Discord
                </Link>
                , I&apos;m in there too.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link
                  href="/author/michael"
                  className="inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  More about me
                  <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                </Link>
                <Link
                  href="/about"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <Accessibility aria-hidden="true" className="h-3.5 w-3.5" />
                  How I build for accessibility
                </Link>
              </div>
            </div>

            {/* The person, and the rules. */}
            <div className="min-w-0">
              <div className="flex items-center gap-5 rounded-card border border-line bg-base/60 p-5">
                <AuthorPortrait size={96} className="shrink-0" />
                {/* Each pair is one div holding a dt then a dd, with the icon
                    inside the dt, the same shape lineup-summary.tsx uses. A div
                    between the dl and the pair is not a valid dl child. */}
                <dl className="grid min-w-0 flex-1 gap-2.5">
                  <div className="min-w-0">
                    <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                      <Trophy
                        aria-hidden="true"
                        className="h-3.5 w-3.5 shrink-0 text-brand-cyan"
                      />
                      Seasons
                    </dt>
                    <dd className="mt-0.5 text-sm font-semibold text-ink">
                      Twenty, since 2006
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                      <Layers
                        aria-hidden="true"
                        className="h-3.5 w-3.5 shrink-0 text-brand-purple"
                      />
                      Format focus
                    </dt>
                    <dd className="mt-0.5 text-sm font-semibold text-ink">
                      Dynasty, superflex and TEP
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                      <Headphones
                        aria-hidden="true"
                        className="h-3.5 w-3.5 shrink-0 text-brand-cyan"
                      />
                      Reads by
                    </dt>
                    <dd className="mt-0.5 text-sm font-semibold text-ink">
                      Screen reader, every day
                    </dd>
                  </div>
                </dl>
              </div>

              <h3 className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-ink-subtle">
                The rules I ship every screen under
              </h3>
              <ul role="list" className="mt-3 grid gap-3 sm:grid-cols-2">
                {BUILD_RULES.map((rule) => (
                  <BuildRuleCard key={rule.title} rule={rule} />
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function BuildRuleCard({ rule }: { rule: BuildRule }) {
  const Icon = rule.icon;
  return (
    <li className="relative overflow-hidden rounded-card border border-line bg-base/60 p-4">
      {/* Left accent rail. Decorative. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-px"
        style={{
          backgroundImage:
            "linear-gradient(180deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      <span
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-card border border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan"
      >
        <Icon className="h-4 w-4" />
      </span>
      <h4 className="mt-3 text-sm font-semibold text-ink">{rule.title}</h4>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{rule.body}</p>
    </li>
  );
}

/* ---------- CTA ---------- */

function CtaSection({
  memberContext,
}: {
  memberContext: Promise<MemberContext>;
}) {
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
          {/* Nearly everything below (eyebrow, heading, copy, primary button) reads
              differently for a confirmed member, so the whole block sits behind one
              Suspense boundary rather than three. The card's border, background wash
              and hairline above are decorative and render immediately either way. */}
          <Suspense fallback={<CtaContentFallback />}>
            <CtaContent memberContext={memberContext} />
          </Suspense>
        </div>
      </div>
    </section>
  );
}

async function CtaContent({
  memberContext,
}: {
  memberContext: Promise<MemberContext>;
}) {
  const { isMember } = await memberContext;
  return (
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
        {/* A real link to the /donate page, distinct from the header's Donate
            control, which opens the same form in a modal without leaving the
            page. */}
        <Link
          href="/donate"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <HeartHandshake aria-hidden="true" className="h-3.5 w-3.5" />
          Support the site
        </Link>
        <Link
          href="/about"
          className="inline-flex min-h-11 items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-ink-muted hover:text-ink"
        >
          Read about the project
        </Link>
      </div>
    </div>
  );
}

/** Loading placeholder for the CTA block. Reserves roughly the same height as
 *  the real heading + copy + button row (both member and non-member copy run
 *  two to three lines at this width) so the card doesn't jump when it resolves. */
function CtaContentFallback() {
  return (
    <div role="status" className="relative">
      <div aria-hidden="true" className="space-y-3">
        <div className="h-3 w-32 animate-pulse rounded bg-base/60" />
        <div className="h-8 w-full max-w-md animate-pulse rounded bg-base/60" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded bg-base/60" />
        <div className="h-4 w-full max-w-lg animate-pulse rounded bg-base/60" />
        <div className="mt-4 h-11 w-48 animate-pulse rounded-card bg-base/60" />
      </div>
      <span className="sr-only">Loading membership status</span>
    </div>
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
