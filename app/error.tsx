"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/**
 * Site-wide error boundary.
 *
 * Before this existed, the only error boundary on the site was
 * app/games/signal-scout/error.tsx, so a render error anywhere else had nothing
 * to catch it. On a first page load that is survivable (the server answers with
 * an error page), but the App Router navigates in place: a link click swaps the
 * page contents without a document load. An uncaught error during one of those
 * navigations tears the tree down with no replacement, and the reader is left on
 * a page where nothing responds until they refresh by hand. That is the "it
 * eventually stops working" half of the reported bug.
 *
 * This boundary does NOT change 404 behaviour. Next re-throws the sentinel
 * errors that notFound() and redirect() raise straight past error boundaries, so
 * a missing player still answers a real 404. That matters because it is the same
 * concern that keeps a loading.tsx out of the app root (see
 * app/leagues/loading.tsx for the full write-up), and it is worth being explicit
 * that the two cases differ.
 *
 * reset() re-renders the failed segment in place, which recovers a transient
 * failure (a dropped database connection, a timed-out query) without a full
 * document reload. The home link is the escape hatch when it fails again.
 *
 * All colors come from brand tokens; no hex is hardcoded.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app error boundary]", error);
  }, [error]);

  return (
    <main id="main">
      <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-20 sm:px-6 lg:px-8">
        <div
          role="alert"
          className="w-full rounded-modal border border-line bg-surface-elevated px-8 py-10 text-center shadow-2xl shadow-black/40"
        >
          <span
            aria-hidden="true"
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-card border border-line bg-surface text-signal-warning"
          >
            <AlertTriangle className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Something went wrong
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-ink-muted">
            This page hit an error while loading. Trying again usually clears it.
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
              onClick={reset}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Try again
            </button>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Go to the home page
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
