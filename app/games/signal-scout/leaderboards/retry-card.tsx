"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Branded inline retry card for a data-load failure on the Signal Scout
 * leaderboards page. Unlike app/games/signal-scout/error.tsx (a route-level
 * error boundary for render-time throws), this handles a failure the page
 * already caught in its own try/catch around loadLeaderboardView, so the
 * page still renders normally with this card in place of the table. Retry
 * re-runs the server render via router.refresh(), matching
 * components/league-load-error.tsx.
 */
export function RetryCard() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div
      role="alert"
      className="mx-auto max-w-2xl rounded-modal border border-line bg-surface-elevated px-8 py-10 text-center shadow-2xl shadow-black/40"
    >
      <p className="mb-2 text-sm font-medium uppercase tracking-wider text-brand-cyan">
        Signal Scout
      </p>
      <h2 className="text-2xl font-semibold tracking-tight text-ink">We lost the signal</h2>
      <p className="mx-auto mt-3 max-w-md text-sm text-ink-muted">
        Something went wrong loading the leaderboards. Retry, or head back to the game.
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
          href="/games/signal-scout"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Back to Signal Scout
        </Link>
      </div>
    </div>
  );
}
