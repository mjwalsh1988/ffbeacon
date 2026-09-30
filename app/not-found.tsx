import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * The site-wide 404 page.
 *
 * Next renders this, inside the root layout, for any URL no route matches and
 * for any notFound() that does not have a closer not-found.tsx above it. The
 * status is a real 404 only when nothing has been flushed to the browser before
 * notFound() runs, which is why no loading.tsx may sit above a route whose
 * existence is decided in its page (see app/leagues/loading.tsx for the long
 * version). This file only decides what the reader sees.
 *
 * Next adds a noindex robots tag to a not-found response on its own.
 */

export const metadata: Metadata = {
  title: "Page not found",
};

const LINKS: { href: string; label: string; body: string }[] = [
  {
    href: "/rankings",
    label: "Rankings",
    body: "Player rankings and values for every format we cover.",
  },
  {
    href: "/tools",
    label: "Tools",
    body: "League Pulse, the trade calculator, start/sit, FAAB bids and the rest.",
  },
  {
    href: "/brief",
    label: "The Beacon Brief",
    body: "The latest news, and what it means for your roster.",
  },
  {
    href: "/guides",
    label: "Guides",
    body: "How to play dynasty, superflex, IDP, chopped leagues and more.",
  },
];

export default function NotFound() {
  return (
    <main id="main">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <p className="text-sm font-medium uppercase tracking-wider text-brand-cyan">Error 404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          We could not find that page
        </h1>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-muted">
          The address may be mistyped, or the page may have moved or been removed. To look for
          a player or a page by name, use the Search button in the header at the top of the
          page.
        </p>

        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Go to the home page
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>

        <nav aria-labelledby="not-found-links" className="mt-12">
          <h2 id="not-found-links" className="text-lg font-semibold text-ink">
            Or try one of these
          </h2>
          <ul role="list" className="mt-4 grid gap-3 sm:grid-cols-2">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="flex h-full min-h-11 flex-col rounded-card border border-line bg-surface/60 p-4 transition-colors hover:border-brand-cyan/50 hover:bg-ink/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <span className="text-sm font-semibold text-ink">{link.label}</span>
                  <span className="mt-1 text-sm leading-relaxed text-ink-muted">{link.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </main>
  );
}
