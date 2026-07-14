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
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { isDiscordMember } from "@/lib/discord-membership";

export const metadata: Metadata = {
  title: "About FF Beacon",
  description:
    "FF Beacon is fantasy football built accessibility-first, for casual fans and screen reader users alike.",
};

export default async function AboutPage() {
  // Confirmed Discord members already have the community; point the closing CTA
  // at the product instead of the invite.
  const isMember = await isDiscordMember();
  return (
    <main id="main">
      <Hero />
      <MissionSection />
      <PrinciplesSection />
      <FeaturesSection />
      <FounderSection />
      <DiscordCtaSection
        eyebrow="See it in action"
        heading="Come see the mission in practice."
        body="The best way to understand FF Beacon is to use it. Drop into our Discord and real fantasy players will show you around, free, or jump straight into the tools built on everything above."
        secondaryHref="/tools"
        secondaryLabel="See every free tool"
        isMember={isMember}
        memberHeading="You get the mission. Now go use it."
        memberBody="You're already part of the crew, so we'll skip the invite. The best way to feel the difference is to use it, so dive into the rankings and the rest of the free toolkit."
        memberCtaHref="/rankings"
        memberCtaLabel="Open the rankings"
      />
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
      {/* Second cyan glow anchored bottom-right for depth. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 right-0 h-[360px] w-[520px]"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(34, 211, 238, 0.10) 0%, transparent 70%)",
        }}
      />
      <div className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-24 lg:px-8">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          About FF Beacon
        </p>
        {/* aria-label gives the h1 a single accessible name covering the
            entire headline, so heading navigation announces it as one piece
            even though the gradient is achieved via a nested span. We
            intentionally do NOT aria-hide the inner content — that would
            remove the text from the accessibility tree and break
            mouse-hover-to-read features. */}
        <h1
          aria-label="Fantasy football that finally works for everyone."
          className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl md:text-6xl"
        >
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
    <li
      className="group relative overflow-hidden rounded-card border border-line bg-surface/60 p-4 transition-colors hover:border-line-accent"
      style={{ boxShadow: "0 0 48px -40px rgba(168, 85, 247, 0.6)" }}
    >
      <AccentStrip />
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
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
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
      className="group relative overflow-hidden rounded-modal border border-line bg-surface p-6 transition-colors hover:border-line-accent sm:p-7"
      style={{
        boxShadow: `0 0 64px -40px ${accentColor}99`,
      }}
    >
      {/* Top hairline tinted to the card's accent so the two cards read as a
          deliberate purple/cyan pair. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage: `linear-gradient(90deg, transparent 0%, ${accentColor} 50%, transparent 100%)`,
        }}
      />
      {/* Corner glow blob, matching the Signal Check result hero. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full"
        style={{
          background: `radial-gradient(circle, ${accentColor}29 0%, ${accentColor}0F 50%, transparent 75%)`,
        }}
      />
      <div className="relative">
        <IconBadge icon={Icon} accent={accent} size="lg" />
        <h3 className="mt-4 text-xl font-semibold text-ink">{title}</h3>
        <p className="mt-2 text-base leading-relaxed text-ink-muted">{body}</p>
      </div>
    </article>
  );
}

/* ---------- Principles ---------- */

function PrinciplesSection() {
  return (
    <section
      aria-labelledby="principles-heading"
      className="relative border-b border-line bg-surface/20"
    >
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
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
            accent="cyan"
            title="Accessibility first"
            body="Every component is keyboard-tested and screen-reader-checked before it ships."
          />
          <PrincipleCard
            icon={BookOpen}
            accent="purple"
            title="Plain-English analytics"
            body="Define the metric in the same view where you use it. No assumed vocabulary."
          />
          <PrincipleCard
            icon={Users}
            accent="cyan"
            title="Sleeper-native"
            body="Real league sync, real transactions, real draft slots. Not a screenshot."
          />
          <PrincipleCard
            icon={Database}
            accent="purple"
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
  accent,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  accent: "purple" | "cyan";
}) {
  return (
    <li className="group relative overflow-hidden rounded-card border border-line bg-base/60 p-5 transition-colors hover:border-line-accent motion-safe:transition-transform motion-safe:hover:-translate-y-0.5">
      <AccentStrip />
      <IconBadge icon={Icon} accent={accent} size="md" rounded />
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
      className="relative overflow-hidden border-b border-line bg-surface/30"
    >
      {/* Beacon hairline pinned to the top edge of the section to set it apart
          from the neighbouring panels. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
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
            accent="cyan"
            title="Rankings Board"
            body="See who's worth what across every major league type, from standard redraft to dynasty superflex. Filter by position, sort the way you think, and switch between ranking sites without losing your spot."
            href="/rankings"
            cta="Open rankings"
          />
          <FeatureCard
            icon={Workflow}
            accent="purple"
            title="Sleeper League Pulse"
            body="Drop in your Sleeper username and pull up every league you're in. Real rosters, recent trades, draft pick values, and a power ranking tuned to your league's actual scoring settings."
            href="/tools/league-pulse"
            cta="Pulse a league"
          />
          <FeatureCard
            icon={Calculator}
            accent="cyan"
            title="FAAB Calculator"
            body="Not sure how much to bid on a waiver pickup? Tell us the player and your league setup, and you'll get a suggested bid range that factors in the player's value and your roster's needs."
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
  accent,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  href: string;
  cta: string;
  accent: "purple" | "cyan";
}) {
  const accentColor = accent === "purple" ? "#A855F7" : "#22D3EE";
  return (
    <article
      className="group relative flex flex-col overflow-hidden rounded-modal border border-line bg-surface p-6 transition-colors hover:border-line-accent motion-safe:transition-transform motion-safe:hover:-translate-y-0.5"
      style={{ boxShadow: `0 0 64px -44px ${accentColor}99` }}
    >
      {/* Corner glow for depth, tinted to the card accent. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-14 -top-14 h-40 w-40 rounded-full"
        style={{
          background: `radial-gradient(circle, ${accentColor}24 0%, transparent 70%)`,
        }}
      />
      <div className="relative flex flex-1 flex-col">
        <IconBadge icon={Icon} accent={accent} size="lg" />
        <h3 className="mt-4 text-lg font-semibold text-ink">{title}</h3>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">{body}</p>
        <Link
          href={href}
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {cta}
          <ArrowRight
            aria-hidden="true"
            className="h-3.5 w-3.5 transition-transform motion-safe:group-hover:translate-x-0.5"
          />
        </Link>
      </div>
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
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <SectionEyebrow>Founder</SectionEyebrow>
        <h2
          id="founder-heading"
          className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          Why this project, why now.
        </h2>

        <div
          className="relative mt-10 flex flex-col items-start gap-8 overflow-hidden rounded-modal border border-line bg-surface p-6 sm:flex-row sm:items-center sm:gap-10 sm:p-8"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.10) 0%, transparent 55%)",
          }}
        >
          {/* Left accent strip ties the founder panel into the card system. */}
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-px"
            style={{
              backgroundImage:
                "linear-gradient(180deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
            }}
          />
          <Link
            href="/author/michael"
            aria-label="Read Michael's full story on the author page"
            className="group relative flex-shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-cyan"
          >
            {/* Beacon gradient ring around the portrait. */}
            <span
              aria-hidden="true"
              className="block rounded-full p-[2px]"
              style={{
                backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
              }}
            >
              <span className="block rounded-full bg-surface p-1">
                <AuthorPortrait size={144} />
              </span>
            </span>
          </Link>
          <div className="relative min-w-0">
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
              className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
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

/* ---------- Shared bits ---------- */

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
      {children}
    </p>
  );
}

/* Left-edge vertical gradient accent strip, the shared card motif used across
   the rankings status tiles and Signal Check. */
function AccentStrip() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-0 left-0 w-px"
      style={{
        backgroundImage:
          "linear-gradient(180deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
      }}
    />
  );
}

/* Tinted icon chip. Decorative: the icon is aria-hidden and the surrounding
   heading carries the accessible name. */
function IconBadge({
  icon: Icon,
  accent,
  size = "md",
  rounded = false,
}: {
  icon: LucideIcon;
  accent: "purple" | "cyan";
  size?: "md" | "lg";
  rounded?: boolean;
}) {
  const c = accent === "purple" ? "#A855F7" : "#22D3EE";
  const box = size === "lg" ? "h-11 w-11" : "h-10 w-10";
  const glyph = size === "lg" ? "h-5 w-5" : "h-4 w-4";
  return (
    <span
      aria-hidden="true"
      className={`flex ${box} items-center justify-center border ${
        rounded ? "rounded-full" : "rounded-card"
      }`}
      style={{
        backgroundImage: `linear-gradient(135deg, ${c}26 0%, ${c}0D 100%)`,
        borderColor: `${c}59`,
        color: c,
      }}
    >
      <Icon className={glyph} />
    </span>
  );
}
