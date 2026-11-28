import type { ReactElement } from "react";
import { cache } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  LEAGUE_VIEW_WINDOW_SECONDS,
  claimLeagueView,
  type LeagueViewRefusalReason,
  type LeagueViewVerdict,
} from "@/lib/league-view-gate";
import { allowLeagueReadCache } from "@/lib/league-read-cache";

/**
 * One verdict per request. A page asks at the top of its body, and anything
 * else in the same render that asks gets the same answer without a second
 * claim.
 */
const leagueViewVerdict = cache(
  async (sleeperLeagueId: string): Promise<LeagueViewVerdict> => {
    const requestHeaders = await headers();
    let userId: string | null = null;
    try {
      // getClaims, not getUser: the signature is checked locally against the
      // project's public key, so this is not a round trip (see
      // lib/supabase/middleware.ts). A token that does not verify yields no
      // claims, and the reader is counted as anonymous.
      const supabase = await createClient();
      const { data } = await supabase.auth.getClaims();
      const subject = data?.claims?.sub;
      if (typeof subject === "string" && subject) userId = subject;
    } catch {
      // A broken session read is not a reason to skip the budget.
    }
    const verdict = await claimLeagueView(requestHeaders, sleeperLeagueId, userId);
    // A counted signed-out view may answer repeat reads from memory
    // (lib/league-read-cache.ts). A member always reads live.
    if (!userId && verdict.allowed) allowLeagueReadCache(sleeperLeagueId);
    return verdict;
  },
);

/**
 * The first line of every league page body.
 *
 * Returns null when the reader may see the page, or the refusal to render in
 * its place. It has to run before the page reads anything: the budget only
 * protects the database if a refused request stops here. Why it lives in the
 * page body and nowhere earlier is in lib/league-view-gate.ts.
 */
export async function refuseLeagueView(
  sleeperLeagueId: string,
): Promise<ReactElement | null> {
  // Not a Sleeper league id: the layout has already answered 404 for it.
  if (!/^\d{1,32}$/.test(sleeperLeagueId)) return null;
  const verdict = await leagueViewVerdict(sleeperLeagueId);
  if (verdict.allowed) return null;
  return (
    <LeagueViewRefused reason={verdict.reason} sleeperLeagueId={sleeperLeagueId} />
  );
}

/**
 * What a reader sees when the league page budget refuses them. Same shell as
 * components/league-load-error.tsx, which is the other thing that can stand in
 * for a league.
 */
export function LeagueViewRefused({
  reason,
  sleeperLeagueId,
}: {
  reason: LeagueViewRefusalReason;
  sleeperLeagueId: string;
}) {
  const waitMinutes = Math.round(LEAGUE_VIEW_WINDOW_SECONDS / 60);
  const leaguePath = `/leagues/${sleeperLeagueId}`;
  const unavailable = reason === "unavailable";
  const member = reason === "member";

  const title = unavailable
    ? "League pages are not loading right now"
    : member
      ? "You have opened a lot of league pages"
      : "League pages are busy right now";
  const body = unavailable
    ? "We could not reach our database, so this league cannot load yet. Wait a minute and try again."
    : member
      ? `Your account opened a lot of league pages in the last few minutes, so we paused new ones. Wait ${waitMinutes} minutes and try again.`
      : `A lot of league pages were requested in the last few minutes, so we paused new ones for readers who are not signed in. Wait ${waitMinutes} minutes and try again, or sign in to open your league now.`;
  const offerSignIn = !unavailable && !member;

  const secondary =
    "inline-flex min-h-11 items-center gap-1.5 rounded-card border border-ink-subtle bg-surface px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-brand-cyan hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

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
            {title}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-ink-muted">{body}</p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            {offerSignIn && (
              <Link
                href={`/login?next=${encodeURIComponent(leaguePath)}`}
                prefetch={false}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                Sign in
              </Link>
            )}
            {/* A plain anchor on purpose. A router link would be answered from
                the client cache, and trying again has to be a real request. */}
            <a href={leaguePath} className={secondary}>
              Try this league again
            </a>
            <Link href="/tools/league-pulse" prefetch={false} className={secondary}>
              Back to League Pulse
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
