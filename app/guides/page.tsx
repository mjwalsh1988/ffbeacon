import type { Metadata } from "next";
import {
  Accessibility,
  ArrowLeftRight,
  LineChart,
  Check,
  type LucideIcon,
} from "lucide-react";
import { DiscordCtaSection } from "@/components/discord-cta-section";

export const metadata: Metadata = {
  title: "Fantasy Football Guides",
  description:
    "Plain-English guides to fantasy analytics, dynasty strategy, and accessible play. Long-form explainers built so any reader can keep up.",
};

export default function GuidesPage() {
  return (
    <main id="main">
      <Hero />
      <GuidesSection />
      <DiscordCtaSection
        eyebrow="While you wait"
        heading="Waiting on a guide? Ask a real person right now."
        body="Guides are being written while we build out the rest of the platform. In the meantime, drop into our Discord and real fantasy players will walk you through any concept, free. Want to know what's already live? Read about FF Beacon."
      />
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
          Fantasy football guides
        </p>
        {/* aria-label collapses the gradient-split headline into one
            accessible name for screen-reader navigation. */}
        <h1
          aria-label="Fantasy football explained, in plain English."
          className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl md:text-6xl"
        >
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
            }}
          >
            Fantasy football explained
          </span>
          , in plain English.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-muted">
          Long-form explainers that make analytics readable, define every
          term the first time it shows up, and read the same by eye or by
          ear.
        </p>
      </div>
    </header>
  );
}

/* ---------- Guides ---------- */

type Guide = {
  icon: LucideIcon;
  title: string;
  description: string;
  bullets: string[];
};

const GUIDES: Guide[] = [
  {
    icon: LineChart,
    title: "Fantasy analytics 101",
    description:
      "A jargon-free walk through the metrics analysts throw around every week. We'll define each one, show you what it actually predicts, and tell you when to trust it.",
    bullets: [
      "Plain-English definitions of target share, snap rate, and yards per route run",
      "Which metrics actually predict next week's performance",
      "How to read a player's full profile without staring at a chart",
    ],
  },
  {
    icon: Accessibility,
    title: "Accessible fantasy football",
    description:
      "The first-of-its-kind reference for fantasy players who use a screen reader. Apps that work, habits that save time, and what to look for before signing up with a host site.",
    bullets: [
      "Apps and tools that pair cleanly with NVDA, JAWS, and VoiceOver",
      "Weekly habits that make lineup setting and waiver claims faster",
      "How to evaluate a fantasy host site before you commit",
    ],
  },
  {
    icon: ArrowLeftRight,
    title: "Superflex vs standard",
    description:
      "Your draft board flips when you can start two quarterbacks. This guide walks through why, when to pivot, and how to handle the late-round QB scramble most managers get wrong.",
    bullets: [
      "Why quarterback value flips entirely in a superflex league",
      "Draft strategy adjustments by round, in plain English",
      "When (and when not) to roster two QBs in standard leagues",
    ],
  },
];

function GuidesSection() {
  return (
    <section
      aria-labelledby="guides-heading"
      className="border-b border-line bg-surface/30"
    >
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          On the way
        </p>
        <h2
          id="guides-heading"
          className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          What&rsquo;s coming to the guides shelf.
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-muted">
          Guides are being written while we focus on building out the rest of
          the platform. They&rsquo;ll land here as they&rsquo;re ready, no
          specific timeline yet.
        </p>

        <ul
          className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3"
          role="list"
        >
          {GUIDES.map((guide) => (
            <GuideCard key={guide.title} guide={guide} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function GuideCard({ guide }: { guide: Guide }) {
  const Icon = guide.icon;
  return (
    <li className="flex">
      <article
        className="relative flex w-full flex-col overflow-hidden rounded-card border border-line bg-surface p-6 transition-colors hover:border-line-accent"
        style={{
          boxShadow: "0 0 48px -40px rgba(168, 85, 247, 0.55)",
        }}
      >
        {/* Top-edge gradient accent to mark this as a featured card. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
          }}
        />
        <div className="flex items-start justify-between gap-3">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
          >
            <Icon className="h-5 w-5" />
          </span>
          <span
            className="inline-flex items-center rounded-full border border-brand-cyan/30 bg-brand-cyan/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-cyan"
            aria-label="Coming soon"
          >
            Coming soon
          </span>
        </div>
        <h3 className="mt-5 text-lg font-semibold text-ink">{guide.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          {guide.description}
        </p>
        <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
          What you&rsquo;ll learn
        </p>
        <ul role="list" className="space-y-1.5 text-sm leading-relaxed text-ink">
          {guide.bullets.map((bullet) => (
            <li key={bullet} className="flex gap-2">
              <Check
                aria-hidden="true"
                className="mt-1 h-3.5 w-3.5 shrink-0 text-brand-cyan"
              />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      </article>
    </li>
  );
}
