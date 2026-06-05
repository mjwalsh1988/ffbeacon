import type { Metadata } from "next";
import Link from "next/link";
import {
  BarChart3,
  Workflow,
  Calculator,
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
    "Rankings board, Sleeper league sync, and FAAB calculator. Accessible fantasy football tools for redraft and dynasty managers.",
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
      <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
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
          Sortable rankings, real Sleeper league sync, and confident waiver
          bids in one place. All built to work the same by eye or by ear.
        </p>
      </div>
    </header>
  );
}

/* ---------- Tools ---------- */

type Tool = {
  icon: LucideIcon;
  href: "/rankings" | "/tools/league-pulse" | "/tools/faab";
  eyebrow: string;
  title: string;
  pitch: string;
  bullets: string[];
  cta: string;
};

const TOOLS: Tool[] = [
  {
    icon: BarChart3,
    href: "/rankings",
    eyebrow: "Rankings & values",
    title: "Rankings Board",
    pitch:
      "See where every player stands today and stop guessing what tier they belong in. The same dataset top managers use, surfaced in a layout you can actually navigate.",
    bullets: [
      "Filter by position to focus on the spot you're trying to fill",
      "Sort by overall value, position rank, or week-over-week trend",
      "Switch between ranking sites without losing your filters",
      "Supports redraft, dynasty, superflex, and TE-premium formats",
    ],
    cta: "Open the rankings",
  },
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
            New tools land here as they ship.
          </h2>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-muted">
            More tools are in the works. Want to see what shaped these ones, or
            who&rsquo;s behind them? Start with the about page.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/about"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Read about FF Beacon
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/author/michael"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Meet the founder
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
