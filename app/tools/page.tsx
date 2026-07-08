import type { Metadata } from "next";
import Link from "next/link";
import {
  Workflow,
  Calculator,
  Scale,
  Swords,
  Timer,
  ArrowRight,
  Accessibility,
  BookOpen,
  Sliders,
  Check,
  type LucideIcon,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Fantasy Football Tools",
  description:
    "Sleeper league sync, live draft help, trade grades, player comparisons, and a FAAB calculator. Accessible fantasy football tools for redraft and dynasty managers.",
};

export default function ToolsPage() {
  return (
    <main id="main">
      <Hero />
      {TOOLS.map((tool, i) => (
        <ToolSection key={tool.href} tool={tool} tinted={i % 2 === 1} />
      ))}
      <PrinciplesSection />
      <CtaSection />
    </main>
  );
}

/* ---------- Hero ---------- */

function Hero() {
  return (
    <header className="relative overflow-hidden border-b border-line">
      {/* Beacon-gradient accent bar pinned to the very top. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />
      {/* Soft ambient glow behind the headline. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 left-1/2 h-[420px] w-[820px] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(168, 85, 247, 0.18) 0%, rgba(34, 211, 238, 0.10) 45%, transparent 75%)",
        }}
      />
      <div className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-24 lg:px-8">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          Fantasy football tools
        </p>
        {/* aria-label collapses the gradient-split headline into one
            accessible name for screen-reader navigation. The visible
            content keeps its visual gradient. */}
        <h1
          aria-label="Every tool you need, none of the noise."
          className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl md:text-6xl"
        >
          Every tool you need,{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
            }}
          >
            none of the noise
          </span>
          .
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-muted">
          Real Sleeper league sync, live draft help, trade grades, and
          confident waiver bids in one place. All built to work the same by
          eye or by ear.
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

/* ---------- Tools ---------- */

type Tool = {
  icon: LucideIcon;
  href:
    | "/tools/league-pulse"
    | "/tools/on-the-clock"
    | "/tools/beacon-breakdown"
    | "/tools/signal-check"
    | "/tools/faab";
  eyebrow: string;
  title: string;
  pitch: string;
  bullets: string[];
  cta: string;
};

// Order mirrors the homepage tools grid and the header/mobile Tools
// dropdown (lib/site.ts TOOLS_NAV). Rankings Board lives on its own
// top-level page and is intentionally not listed here.
const TOOLS: Tool[] = [
  {
    icon: Workflow,
    href: "/tools/league-pulse",
    eyebrow: "League management",
    title: "Sleeper League Pulse",
    pitch:
      "Bring every Sleeper league you're in into one place. See your full roster portfolio at a glance, with values and standings tuned to each league's actual scoring.",
    bullets: [
      "One-step pull of every league tied to your Sleeper username",
      "Real rosters, recent trades, and accurate draft pick values",
      "Power rankings calibrated to your league's actual settings",
      "Tap any team to see a full breakdown of their roster",
    ],
    cta: "Sync a league",
  },
  {
    icon: Timer,
    href: "/tools/on-the-clock",
    eyebrow: "Live drafts",
    title: "On The Clock",
    pitch:
      "Connect your active Sleeper draft and FF Beacon points you to the best pick for your team, then keeps everything else you need in one hub. Built to work the same by eye or by ear.",
    bullets: [
      "Best Available and Team Need picks tuned to your league format",
      "A trade calculator and an analyzer for startup and rookie drafts",
      "Every team roster plus the full trade and transaction history",
      "Live power rankings, startup draft grades, and awards",
    ],
    cta: "Open the draft room",
  },
  {
    icon: Swords,
    href: "/tools/beacon-breakdown",
    eyebrow: "Player comparison",
    title: "Beacon Breakdown",
    pitch:
      "Two players. One verdict. Drop any two players into a matchup card and see who has the edge, with side-by-side values, rankings, trends, and a plain-English bottom line you can screenshot and share.",
    bullets: [
      "Head-to-head cards with a single Beacon Edge meter up top",
      "Every row shows who wins: value, rank, production, risk, and upside",
      "Dynasty and redraft outlooks weighted to your league format",
      "A Beacon Verdict that reads like a real take, not a stat dump",
    ],
    cta: "Compare players",
  },
  {
    icon: Scale,
    href: "/tools/signal-check",
    eyebrow: "Trade analysis",
    title: "Signal Check",
    pitch:
      "Build any trade and get the Beacon Verdict: who wins, by how much, and why. Powered by FF Beacon Values and weighted for your league format, with a plain-language reason for every call.",
    bullets: [
      "Add players and, in dynasty, draft picks to either side",
      "FF Beacon Values weighted to your exact league format",
      "A clear margin and a near-even guard so tiny edges aren't oversold",
      "Freeze and share a clean public verdict link",
    ],
    cta: "Analyze a trade",
  },
  {
    icon: Calculator,
    href: "/tools/faab",
    eyebrow: "Waivers & bids",
    title: "FAAB Calculator",
    pitch:
      "Take the guesswork out of waiver Tuesday. Get a recommended bid range that factors in the player's actual value and how badly your roster needs them.",
    bullets: [
      "Search any player, not just the top names everyone is chasing",
      "Bids weighted by current value, your league size, and remaining FAAB",
      "Adjusts for your roster's positional need at that spot",
      "Explains the recommendation in plain English so you can adjust",
    ],
    cta: "Run a bid",
  },
];

function ToolSection({ tool, tinted }: { tool: Tool; tinted: boolean }) {
  const headingId = `tool-${tool.href.replace(/\//g, "-").replace(/^-+/, "")}-heading`;
  const Icon = tool.icon;
  return (
    <section
      aria-labelledby={headingId}
      className={`border-b border-line ${tinted ? "bg-surface/30" : ""}`}
    >
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="grid gap-8 md:grid-cols-[1fr_2fr] md:gap-12 lg:gap-16">
          <div>
            <span
              aria-hidden="true"
              className="flex h-14 w-14 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
            >
              <Icon className="h-7 w-7" />
            </span>
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
              {tool.eyebrow}
            </p>
            <h2
              id={headingId}
              className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
            >
              {tool.title}
            </h2>
          </div>
          <div className="space-y-6">
            <p className="text-lg leading-relaxed text-ink-muted">{tool.pitch}</p>
            <ul
              role="list"
              className="space-y-2.5 text-base leading-relaxed text-ink"
            >
              {tool.bullets.map((bullet) => (
                <li key={bullet} className="flex gap-2.5">
                  <Check
                    aria-hidden="true"
                    className="mt-1 h-4 w-4 shrink-0 text-brand-cyan"
                  />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
            <Link
              href={tool.href}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {tool.cta}
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- What every tool gets right ---------- */

function PrinciplesSection() {
  return (
    <section
      aria-labelledby="principles-heading"
      className="border-b border-line"
    >
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionEyebrow>What every tool gets right</SectionEyebrow>
        <h2
          id="principles-heading"
          className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          Different jobs. Same standards.
        </h2>

        <ul
          className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          role="list"
        >
          <PrincipleCard
            icon={Accessibility}
            title="Screen-reader native"
            body="Every control is keyboard-navigable and announces clearly. No traps, no silent updates, no chart that won't read aloud."
          />
          <PrincipleCard
            icon={BookOpen}
            title="Plain English first"
            body="The metric is defined in the same view where you use it. No insider vocabulary, no analytics gatekeeping."
          />
          <PrincipleCard
            icon={Sliders}
            title="Your league, your settings"
            body="Pick your scoring format and ranking source once. Every tool on the site follows along automatically."
          />
        </ul>
      </div>
    </section>
  );
}

function PrincipleCard({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <li className="rounded-card border border-line bg-base/60 p-5 transition-colors hover:border-line-accent">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-brand-cyan"
      >
        <Icon className="h-4 w-4" />
      </span>
      <h3 className="mt-4 text-base font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{body}</p>
    </li>
  );
}

/* ---------- CTA ---------- */

function CtaSection() {
  return (
    <section aria-labelledby="cta-heading">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div
          className="relative overflow-hidden rounded-modal border border-line bg-surface p-8 sm:p-10"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.12) 0%, transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.12) 0%, transparent 55%)",
          }}
        >
          <SectionEyebrow>More on the way</SectionEyebrow>
          <h2
            id="cta-heading"
            className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Stuck on a tool? Real people are a message away.
          </h2>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-muted">
            Drop into our Discord for free help from real fantasy players on
            any tool here, and more tools are on the way. Want to know what
            shaped these ones and who is behind them? Read about FF Beacon.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="/join"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Join our Discord (opens in new tab)"
              className="inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <DiscordGlyph className="h-4 w-4" />
              Join our Discord
            </a>
            <Link
              href="/about"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Read about FF Beacon
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
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

/** Discord wordmark glyph, matching the icon used on the homepage, in the
 *  footer, and in the floating Discord CTA. Lucide ships no Discord icon,
 *  so we inline the official brand path. Decorative: the surrounding link
 *  carries the label. */
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
