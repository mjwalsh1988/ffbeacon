"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Last-resort error boundary, for a failure in the root layout itself.
 *
 * app/error.tsx sits inside the root layout, so it cannot catch an error thrown
 * by the layout (the site header runs a Supabase auth call and three queries on
 * every render, all of which can fail). When that happens this replaces the
 * whole document, which is why it has to render its own <html> and <body>.
 *
 * Kept deliberately plain: the header, footer, fonts, and every other layout
 * component are exactly what is presumed broken here, so nothing from the layout
 * is imported. globals.css is imported directly so brand tokens still apply and
 * no color is hardcoded. The reload is a full document load rather than reset(),
 * because a root layout that failed once will usually fail again on a re-render
 * of the same tree.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error boundary]", error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-4 py-20 sm:px-6">
          <div
            role="alert"
            className="w-full rounded-modal border border-line bg-surface-elevated px-8 py-10 text-center shadow-2xl shadow-black/40"
          >
            <p className="mb-2 text-sm font-medium uppercase tracking-wider text-brand-cyan">
              FF Beacon
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              The site hit an error
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm text-ink-muted">
              Something failed before the page could render. Reloading usually
              clears it.
            </p>
            {error.digest && (
              <p className="mt-3 text-xs text-ink-subtle">
                Reference code:{" "}
                <span className="font-mono text-ink-muted">{error.digest}</span>
              </p>
            )}
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => reset()}
                className="inline-flex min-h-11 items-center rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                Try again
              </button>
              <a
                href="/"
                className="inline-flex min-h-11 items-center rounded-card border border-line bg-surface px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                Reload the home page
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
