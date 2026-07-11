"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Route-level error boundary for /games/signal-scout. Catches render-time
 * failures the client state machine's own per-operation error strips
 * (startError/hintError/guessError in signal-scout-client.tsx) can't cover,
 * since those only handle failed fetches after the page has already
 * rendered. Mirrors the branded retry-card pattern from
 * components/league-load-error.tsx (role="alert" centered card, min-h-11
 * targets, bg-beacon primary action), Signal Scout branded.
 *
 * Next.js requires this file to be a Client Component exporting a default
 * function that receives { error, reset }. error.message is deliberately
 * never rendered (information disclosure); it only goes to console.error
 * for diagnosis.
 */
export default function SignalScoutError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[signal-scout]", error);
  }, [error]);

  return (
    <main id="main">
      <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-20 sm:px-6 lg:px-8">
        <div
          role="alert"
          className="w-full rounded-modal border border-line bg-surface-elevated px-8 py-10 text-center shadow-2xl shadow-black/40"
        >
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-brand-cyan">
            Signal Scout
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            We lost the signal
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-ink-muted">
            Something went wrong loading Signal Scout. Retry, or head back and
            try again in a moment.
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
              href="/"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Back to home
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
