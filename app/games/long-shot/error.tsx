"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Route-level error boundary for /games/long-shot. error.message is never
 * rendered (information disclosure); it goes to the console only. A started
 * attempt is saved server-side, so a retry resumes it.
 */
export default function LongShotError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[long-shot]", error);
  }, [error]);

  return (
    <main id="main">
      <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-20 sm:px-6 lg:px-8">
        <div role="alert" className="w-full rounded-modal border border-line bg-surface-elevated px-8 py-10 text-center shadow-2xl shadow-black/40">
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-brand-cyan">Long Shot</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">The kick went wide</h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-ink-muted">
            Something went wrong loading Long Shot. Retry, or head back to the games. Your attempt is saved.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-11 items-center justify-center rounded-card bg-beacon px-5 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Try again
            </button>
            <Link
              href="/games"
              className="inline-flex min-h-11 items-center justify-center rounded-card border border-line px-5 text-sm font-semibold text-ink hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              All games
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
