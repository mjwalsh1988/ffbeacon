"use client";

/**
 * The wall a guest hits after their free votes.
 *
 * TWO FREE ROUNDS FIRST, ON PURPOSE. A visitor who has never seen the game
 * cannot judge whether an account is worth making, so the sign-in ask comes
 * after they have played rather than before. The count they have left is on
 * screen from the first round, so this is the end of something they were told
 * about, not a trapdoor.
 *
 * IT SAYS WHY, AND THE REASON IS TRUE. Votes are counted once per person, and
 * that is only enforceable against an account. It is also what makes the
 * percentages on the reveal worth reading, which is the thing the reader has
 * just spent two rounds finding out they care about.
 *
 * Their first votes are not thrown away: they were written against the guest
 * cookie and are already in the tallies.
 */

import Link from "next/link";
import { LogIn, Lock, UserPlus } from "lucide-react";

export function SignInGate({ votesUsed }: { votesUsed: number }) {
  const next = encodeURIComponent("/games/would-you-rather");
  const played = votesUsed === 1 ? "one trade" : `${votesUsed} trades`;

  return (
    <div className="rounded-card border border-brand-purple/40 bg-surface/50 p-6 text-center">
      <span
        aria-hidden="true"
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-card bg-beacon text-black"
      >
        <Lock className="h-6 w-6" />
      </span>

      {/* h3 because the Panel wrapping this renders the h2. Level, not size:
          the type scale is set by the class, so the outline stays correct. */}
      <h3 className="mt-4 text-xl font-semibold tracking-tight text-ink">
        That is your free run. Sign in to keep going.
      </h3>

      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
        You called {played}, and those votes are already counted. Every vote after
        this one needs an account, because a vote only means something if it can
        be counted once per person, and that is the part the percentages you have
        been reading depend on.
      </p>

      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-muted">
        An account is free, and it keeps your record: which trades you have
        called, and how often you landed on the same side as Signal Check.
      </p>

      <div className="mt-5 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
        <Link
          href={`/login?next=${next}`}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
        >
          <LogIn aria-hidden="true" className="h-4 w-4" />
          Sign in
        </Link>
        <Link
          href={`/login?next=${next}`}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-card border border-line bg-base px-5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
        >
          <UserPlus aria-hidden="true" className="h-4 w-4" />
          Create a free account
        </Link>
      </div>

      <p className="mt-4 text-xs text-ink-subtle">
        Nothing else on FF Beacon is behind a sign-in. The rankings, the tools and
        the other game stay open.
      </p>
    </div>
  );
}
