import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Fantasy Football Guides",
  description: "Plain-language guides to fantasy analytics, dynasty strategy, and accessible play.",
};

const GUIDES = [
  {
    href: "/guides/fantasy-analytics-101" as const,
    title: "Fantasy analytics 101",
    description: "What target share, snap rate, and yards per route run actually mean.",
  },
  {
    href: "/guides/accessible-fantasy-football" as const,
    title: "Accessible fantasy football",
    description: "Apps, tools, and habits for fantasy players who use a screen reader.",
  },
  {
    href: "/guides/superflex-vs-standard" as const,
    title: "Superflex vs standard",
    description: "Why your quarterback strategy changes everything in a superflex league.",
  },
];

export default function GuidesPage() {
  return (
    <main id="main">
      <header className="border-b border-line">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-brand-cyan">Guides</p>
          <h1 className="text-4xl font-semibold tracking-tight">Fantasy football guides</h1>
          <p className="mt-3 max-w-2xl text-ink-muted">
            Long-form explainers that make analytics readable, even on a screen reader.
          </p>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <p className="mb-8 rounded-card border border-dashed border-line bg-surface p-4 text-sm text-ink-muted">
          Guide content is being written this week. The titles below are the first batch landing soon.
        </p>
        <ul className="grid gap-4 md:grid-cols-2">
          {GUIDES.map((g) => (
            <li key={g.href} className="rounded-card border border-line bg-surface p-6">
              <h2 className="text-lg font-semibold text-ink">{g.title}</h2>
              <p className="mt-2 text-sm text-ink-muted">{g.description}</p>
              <p className="mt-4 text-xs uppercase tracking-wide text-ink-subtle">Coming soon</p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
