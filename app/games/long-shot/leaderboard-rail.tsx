/**
 * The boards column (plan 13.1 and 18A.2). It is not a sidebar beside the game
 * (the Signal Scout rail pattern is explicitly not used here); it sits below
 * the stage. Signed out it says the boards exist and are for signed-in
 * players, with no rows at all, so nothing reaches the page source. Paused, it
 * is one sentence.
 */

import Link from "next/link";
import type { LeaderboardView } from "@/lib/long-shot/leaderboards";
import { LeaderboardPanel } from "./leaderboard-panel";

export function LeaderboardRail({
  signedIn,
  enabled,
  initialView,
}: {
  signedIn: boolean;
  enabled: boolean;
  initialView: LeaderboardView | null;
}) {
  if (!enabled || !signedIn) {
    return (
      <section aria-labelledby="ls-boards-teaser" className="rounded-[20px] border border-line bg-surface p-5 sm:p-6">
        <h2 id="ls-boards-teaser" className="text-lg font-bold text-ink">
          Boards
        </h2>
        {!enabled ? (
          <p className="mt-3 text-sm text-ink-muted">Boards are paused.</p>
        ) : (
          <p className="mt-3 text-sm text-ink-muted">
            A daily board, an all-time board and a streak board, with today&apos;s top three on a podium. They are
            for signed-in players.{" "}
            <Link
              href="/login?next=/games/long-shot"
              className="inline-flex min-h-11 items-center font-semibold text-brand-cyan underline-offset-2 hover:underline"
            >
              Sign in to play
            </Link>
          </p>
        )}
      </section>
    );
  }
  return <LeaderboardPanel initialView={initialView} />;
}
