"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Route-level error boundary for /games/would-you-rather.
 *
 * Covers a render-time failure the client's own state machine cannot: its
 * failure strip only handles a fetch that came back wrong AFTER the page had
 * rendered. Same branded retry card as the Signal Scout boundary and
 * components/league-load-error.tsx.
 *
 * `error.message` is deliberately never rendered. It can carry internal detail,
 * and a reader can do nothing with it; it goes to the console for diagnosis.
 */
export default function WouldYouRatherError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[would-you-rather]", error);
  }, [error]);

  return (
    <main id="main">
      <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-20 sm:px-6 lg:px-8">
        <div
          role="alert"
          className="w-full rounded-modal border border-line bg-surface-elevated px-8 py-10 text-center shadow-2xl shadow-black/40"
        >
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-brand-cyan">
            Would You Rather
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            That trade would not load
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-ink-muted">
            Nothing was recorded, so retrying costs you nothing. If it keeps
            happening, the other games are unaffected.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Retry
            </button>
            <Link
              href="/games"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Back to games
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
