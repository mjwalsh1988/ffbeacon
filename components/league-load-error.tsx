"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Branded error state for the league deep view when the Sleeper sync fails.
 *
 * Shown instead of notFound() because pulseLeague returns the same failure for
 * a genuinely missing league and a transient Sleeper outage (getSleeperLeague
 * returns null in both cases), so a retry path is the friendlier default.
 *
 * Retry re-runs the current route's server render (router.refresh()), which
 * re-attempts the sync. Back returns to the League Pulse search page. All
 * colors come from brand tokens; no hex is hardcoded.
 */
export function LeagueLoadError() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <main id="main">
      <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-20 sm:px-6 lg:px-8">
        <div
          role="alert"
          className="w-full rounded-modal border border-line bg-surface-elevated px-8 py-10 text-center shadow-2xl shadow-black/40"
        >
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-brand-cyan">
            League Pulse
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            We couldn&apos;t load this league
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-ink-muted">
            Something went wrong while syncing from Sleeper. Try again, or head
            back to search.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => startTransition(() => router.refresh())}
              disabled={pending}
              aria-busy={pending}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-wait disabled:opacity-60"
            >
              {pending ? "Retrying..." : "Retry"}
            </button>
            <Link
              href="/tools/league-pulse"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Back to League Pulse
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
