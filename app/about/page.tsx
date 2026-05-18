import type { Metadata } from "next";
import Link from "next/link";
import {
  Accessibility,
  BookOpen,
  Users,
  Database,
  BarChart3,
  Workflow,
  Calculator,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { AuthorPortrait } from "@/components/author-portrait";

export const metadata: Metadata = {
  title: "About FF Beacon",
  description:
    "FF Beacon is fantasy football built accessibility-first, for casual fans and screen reader users alike.",
};

export default function AboutPage() {
  return (
    <main id="main">
      <Hero />
      <MissionSection />
      <PrinciplesSection />
      <FeaturesSection />
      <FounderSection />
      <CtaSection />
    </main>
  );
}

/* ---------- Hero ---------- */

function Hero() {
  return (
    <header className="relative overflow-hidden border-b border-line">
      {/* Beacon gradient accent bar pinned to the very top. */}
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
      <div className="relative mx-auto max-w-5xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          About FF Beacon
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl md:text-6xl">
          Fantasy football that{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
            }}
          >
            finally works
          </span>{" "}
          for everyone.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-muted">
          Accessibility-first rankings, calculators, and league insights — built so a
          casual fan, a 20-year veteran, and a screen-reader user can all walk away with
          the same information.
        </p>
        <StatStrip />
      </div>
    </header>
  );
}

function StatStrip() {
  return (
    <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4" role="list">
      <Stat value="20+" label="Seasons of fantasy" />
      <Stat value="100%" label="Keyboard navigable" />
      <Stat value="AAA" label="WCAG contrast target" />
      <Stat value="Multi" label="Source-agnostic data" />
    </ul>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
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

/* ---------- Mission ---------- */

function MissionSection() {
  return (
    <section
      aria-labelledby="mission-heading"
      className="border-b border-line"
    >
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionEyebrow>Mission</SectionEyebrow>
        <h2
          id="mission-heading"
          className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          Two gaps we close in one product.
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-muted">
          Most fantasy tools were built by analysts for analysts, then bolted onto a
          UI that assumes you can see the chart. FF Beacon attacks both ends at once.
        </p>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <GapCard
            icon={BookOpen}
            title="The jargon barrier"
            body="Target share, opportunity score, route participation — terms get tossed around like everyone already knows them. We explain the metric in plain English before we ask you to use it, and we always show our work."
            accent="purple"
          />
          <GapCard
            icon={Accessibility}
            title="The accessibility gap"
            body="Stats trapped in unlabeled charts. Filters you can only reach with a mouse. Player news that updates silently. FF Beacon is built screen-reader-first: real semantic HTML, real ARIA, real keyboard navigation everywhere."
            accent="cyan"
          />
        </div>
      </div>
    </section>
  );
}

function GapCard({
  icon: Icon,
  title,
  body,
  accent,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  accent: "purple" | "cyan";
}) {
  const accentColor = accent === "purple" ? "#A855F7" : "#22D3EE";
  return (
    <article
      className="relative overflow-hidden rounded-card border border-line bg-surface p-6"
      style={{
        boxShadow: `0 0 48px -32px ${accentColor}80`,
      }}
    >
      <span
        aria-hidden="true"
        className="flex h-11 w-11 items-center justify-center rounded-card"
        style={{
          backgroundColor: `${accentColor}1A`,
          border: `1px solid ${accentColor}55`,
          color: accentColor,
        }}
      >
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-4 text-xl font-semibold text-ink">{title}</h3>
      <p className="mt-2 text-base leading-relaxed text-ink-muted">{body}</p>
    </article>
  );
}

/* ---------- Principles ---------- */

function PrinciplesSection() {
  return (
    <section
      aria-labelledby="principles-heading"
      className="border-b border-line"
    >
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionEyebrow>How we build</SectionEyebrow>
        <h2
          id="principles-heading"
          className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          Four principles, applied to every shipped feature.
        </h2>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" role="list">
          <PrincipleCard
            icon={Accessibility}
            title="Accessibility first"
            body="Every component is keyboard-tested and screen-reader-checked before it ships."
          />
          <PrincipleCard
            icon={BookOpen}
            title="Plain-English analytics"
            body="Define the metric in the same view where you use it. No assumed vocabulary."
          />
          <PrincipleCard
            icon={Users}
            title="Sleeper-native"
            body="Real league sync, real transactions, real draft slots. Not a screenshot."
          />
          <PrincipleCard
            icon={Database}
            title="Source-agnostic"
            body="KTC, FantasyCalc, more on the way. Pick the values you trust and the format you actually play."
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

/* ---------- What you can do ---------- */

function FeaturesSection() {
  return (
    <section
      aria-labelledby="features-heading"
      className="border-b border-line bg-surface/30"
    >
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionEyebrow>What you can do here</SectionEyebrow>
        <h2
          id="features-heading"
          className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          Tools that respect your time and your reader.
        </h2>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <FeatureCard
            icon={BarChart3}
            title="Rankings Board"
            body="Sortable, filterable rankings across redraft, dynasty, superflex, and TE-premium. Switch sources without losing your place."
            href="/rankings"
            cta="Open rankings"
          />
          <FeatureCard
            icon={Workflow}
            title="Sleeper League Sync"
            body="Paste your Sleeper username, get every league back with real rosters, real transactions, real draft slots, and power rankings calibrated to your scoring."
            href="/tools/league-sync"
            cta="Sync a league"
          />
          <FeatureCard
            icon={Calculator}
            title="FAAB Calculator"
            body="Market value plus your real need, weighted into a bid range. Top-100 overall? You'll get told to dump it."
            href="/tools/faab"
            cta="Run a bid"
          />
        </div>
      </div>
    </section>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  body,
  href,
  cta,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <article className="flex flex-col rounded-card border border-line bg-surface p-6">
      <span
        aria-hidden="true"
        className="flex h-11 w-11 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
      >
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-4 text-lg font-semibold text-ink">{title}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">{body}</p>
      <Link
        href={href}
        className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan hover:text-brand-purple"
      >
        {cta}
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    </article>
  );
}

/* ---------- Founder ---------- */

function FounderSection() {
  return (
    <section
      aria-labelledby="founder-heading"
      className="border-b border-line"
    >
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionEyebrow>Founder</SectionEyebrow>
        <h2
          id="founder-heading"
          className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          Why this project, why now.
        </h2>

        <div className="mt-10 flex flex-col items-start gap-8 rounded-card border border-line bg-surface p-6 sm:flex-row sm:items-center sm:gap-10 sm:p-8">
          <Link
            href="/author/michael"
            aria-label="Read Michael's full story on the author page"
            className="flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-cyan"
          >
            <AuthorPortrait size={144} />
          </Link>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              Michael — Founder, FF Beacon
            </p>
            <p className="mt-3 text-base leading-relaxed text-ink">
              Twenty years in fantasy. Plays the game stats-first across
              redraft, dynasty, superflex, and TE-premium — partly because
              that&rsquo;s how winners win, partly because most fantasy UIs
              aren&rsquo;t built for blind dynasty managers. FF Beacon is what
              happens when that lived experience drives the product.
            </p>
            <Link
              href="/author/michael"
              className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan hover:text-brand-purple"
            >
              Read the full story
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- CTA ---------- */

function CtaSection() {
  return (
    <section aria-labelledby="cta-heading">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div
          className="relative overflow-hidden rounded-modal border border-line bg-surface p-8 sm:p-12"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.12) 0%, transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.12) 0%, transparent 55%)",
          }}
        >
          <h2
            id="cta-heading"
            className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Bring your league. Or skim the rankings. Both work by ear.
          </h2>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-muted">
            No signup needed to browse. Sign in only when you want to save your
            source, your format, and your linked Sleeper username.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/rankings"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Explore the rankings
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/tools/league-sync"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Sync a Sleeper league
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Shared bits ---------- */

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
      {children}
    </p>
  );
}
