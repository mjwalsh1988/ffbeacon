import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Fantasy Football Tools",
  description: "Sleeper league sync, FAAB calculator, rankings board, and more accessible fantasy tools.",
};

const TOOLS = [
  {
    href: "/rankings" as const,
    title: "Rankings Board",
    description: "Sortable, filterable rankings across every league type and scoring system.",
  },
  {
    href: "/tools/league-sync" as const,
    title: "Sleeper League Sync",
    description: "See every league and roster you own in one accessible view.",
  },
  {
    href: "/tools/faab" as const,
    title: "FAAB Calculator",
    description: "Confident waiver wire bids from market value, budget, and roster need.",
  },
];

export default function ToolsPage() {
  return (
    <main id="main">
      <header className="border-b border-line">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-brand-cyan">Tools</p>
          <h1 className="text-4xl font-semibold tracking-tight">Fantasy football tools</h1>
          <p className="mt-3 max-w-2xl text-ink-muted">
            Accessibility-first tools for redraft and dynasty fantasy football.
          </p>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <ul className="grid gap-4 md:grid-cols-2">
          {TOOLS.map((tool) => (
            <li key={tool.href}>
              <Link
                href={tool.href}
                className="block rounded-card border border-line bg-surface p-6 hover:border-brand-purple"
              >
                <h2 className="text-lg font-semibold text-ink">{tool.title}</h2>
                <p className="mt-2 text-sm text-ink-muted">{tool.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
