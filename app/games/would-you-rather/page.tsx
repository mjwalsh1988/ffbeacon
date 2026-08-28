import type { Metadata } from "next";
import Link from "next/link";
import {
  BarChart3,
  Newspaper,
  Scale,
  Users,
  Wrench,
} from "lucide-react";
import { pageShareMetadata } from "@/lib/page-og";
import { createAdminClient } from "@/lib/supabase/server";
import { Panel } from "@/components/dashboard-panel";
import { LinkTile } from "@/components/link-tile";
import { PageBody } from "@/components/app-shell/page-body";
import { PageColumns } from "@/components/app-shell/page-columns";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { loadWouldYouRatherSettings } from "@/lib/would-you-rather/settings";
import {
  guestVotesRemaining,
  guestVotesUsed,
  readVoter,
} from "@/lib/would-you-rather/identity";
import {
  loadRound,
  loadVotedTradeIds,
  markServed,
  selectTradeId,
} from "@/lib/would-you-rather/round";
import { countActivePool, growPool, POOL_LOW_WATER_MARK } from "@/lib/would-you-rather/pool";
import type { WyrErrorCode, WyrRound } from "@/lib/would-you-rather/types";
import { WouldYouRatherClient } from "./would-you-rather-client";

export const metadata: Metadata = {
  alternates: { canonical: "/games/would-you-rather" },
  title: "Would You Rather? Vote on Real Fantasy Trades",
  description:
    "A real trade out of a real league, with the names taken off. Call the winner, then see how the room voted and what the full Signal Check grade says. Free to play.",
  ...pageShareMetadata({
    key: "would-you-rather",
    title: "Would You Rather? Vote on Real Fantasy Trades",
    description:
      "A real trade out of a real league, with the names taken off. Call the winner, then see how the room voted and what the full Signal Check grade says. Free to play.",
    path: "/games/would-you-rather",
  }),
};

/**
 * Every render depends on who is asking (their remaining free votes, and which
 * trades they have already called), so there is nothing here a shared cache
 * could ever serve.
 */
export const dynamic = "force-dynamic";

/** How many pool rows the server tries before handing the client a blank. */
const BUILD_ATTEMPTS = 3;

/**
 * Would You Rather: the trade voting game.
 *
 * The server resolves the FIRST round so the page paints a playable board
 * rather than a spinner and a fetch. Every round after that comes from
 * /api/games/would-you-rather/next.
 *
 * WHAT CROSSES THE WIRE FROM HERE IS THE BOARD AND ONLY THE BOARD. `loadRound`
 * grades the trade, because the pool row has to be checked and the asset names
 * come out of the graded view, but only `loaded.round` is handed to the client
 * component. The verdict, the values and the tallies stay on the server and
 * arrive later in the vote response. Anything passed to a client component is
 * serialized into this page's flight payload, where a reader could read it out
 * of view-source, so the split is load-bearing rather than tidy.
 */
export default async function WouldYouRatherPage() {
  const admin = createAdminClient();
  const settings = await loadWouldYouRatherSettings(admin);

  const voter = await readVoter();
  const isAuthenticated = voter?.kind === "user";

  let initialRound: WyrRound | null = null;
  let initialError: WyrErrorCode | null = null;
  let used = 0;
  let remaining: number | null = null;
  let poolSize = 0;
  let votesCast = 0;

  if (!settings.game_enabled) {
    initialError = "game_disabled";
  } else if (!isAuthenticated && !settings.guest_play_enabled) {
    initialError = "guest_play_disabled";
  } else {
    // The page has no Request, so it counts against the cookie alone. That is
    // only ever a DISPLAY of the remaining allowance; the two routes derive the
    // actor properly and are what actually enforce it.
    used = await guestVotesUsed(admin, voter, null);
    remaining = isAuthenticated
      ? null
      : guestVotesRemaining(settings.guest_vote_limit, used);

    if (remaining === 0) {
      initialError = "guest_limit_reached";
    } else {
      // Top the pool up inline when it has run thin. One pass is bounded work
      // (one sample window, one league's grading) and it means the game is
      // playable on a fresh install without a separate job having run first.
      poolSize = await countActivePool(admin);
      if (poolSize < POOL_LOW_WATER_MARK) {
        // respectCooldown: a render must never be the thing that repeatedly pays
        // for a pool that has nothing left to find.
        await growPool(admin, settings, { respectCooldown: true });
        poolSize = await countActivePool(admin);
      }

      const voted = await loadVotedTradeIds(admin, {
        userId: voter?.kind === "user" ? voter.userId : null,
        guestId: voter?.kind === "guest" ? voter.guestId : null,
      });

      for (let attempt = 0; attempt < BUILD_ATTEMPTS && !initialRound; attempt += 1) {
        const tradeId = await selectTradeId(admin, voted);
        if (!tradeId) {
          initialError = "pool_empty";
          break;
        }
        const loaded = await loadRound(admin, tradeId);
        if (!loaded) {
          voted.add(tradeId);
          continue;
        }
        await markServed(admin, loaded.pool);
        initialRound = loaded.round;
      }
      if (!initialRound && !initialError) initialError = "pool_empty";
    }
  }

  // Masthead figures. Two counts, both cheap head queries, and neither of them
  // says anything about any individual trade.
  if (poolSize === 0) poolSize = await countActivePool(admin);
  const { count: voteCount } = await admin
    .from("would_you_rather_votes")
    .select("id", { count: "exact", head: true });
  votesCast = voteCount ?? 0;

  return (
    <main id="main">
      <PageBody flush>
        <PageMasthead
          eyebrow="Games"
          title="Would You Rather?"
          description="A real trade, out of a real league, with the managers' names taken off. Call the winner. Then see where everyone else landed, and what the full Signal Check grade says about the pieces."
          stats={[
            {
              label: "Trades to call",
              value: poolSize.toLocaleString(),
              detail: "Real deals, real leagues",
              accent: "cyan",
            },
            {
              label: "Votes cast",
              value: votesCast.toLocaleString(),
              detail: "Site and Discord",
              accent: "purple",
            },
            { label: "Cost", value: "$0", detail: "Two rounds without an account" },
          ]}
        />
      </PageBody>

      <PageColumns
        railLabel="How the game works and where to go next"
        rail={
          <>
            <Panel eyebrow="Before you vote" title="How this works" headingLevel={2}>
              <ol
                role="list"
                className="space-y-3 text-sm leading-relaxed text-ink-muted"
              >
                <Step n={1}>
                  You get one real trade from a synced Sleeper league. The league
                  is named and its rules are shown, because the same two players
                  are a different deal in a superflex TE premium league than in a
                  standard one.
                </Step>
                <Step n={2}>
                  The two managers are not named, here or anywhere else. They are
                  Team A and Team B.
                </Step>
                <Step n={3}>
                  You see no values, no grade and no hint of what FF Beacon thinks
                  until your vote is in. That is the whole game: an unprimed call.
                </Step>
                <Step n={4}>
                  Then everything opens up at once. Where the room voted, the full
                  Signal Check verdict, and what that league's own numbers say
                  about every player who moved.
                </Step>
              </ol>
            </Panel>

            <Panel eyebrow="Playing" title="What an account changes" headingLevel={2}>
              <ul role="list" className="space-y-2.5 text-sm leading-relaxed text-ink-muted">
                <li>
                  {settings.guest_vote_limit === 0
                    ? "An account is needed to vote."
                    : `You get ${settings.guest_vote_limit} ${settings.guest_vote_limit === 1 ? "trade" : "trades"} without one, so you can see what the game is before deciding.`}
                </li>
                <li>
                  After that, signing in is what lets a vote be counted once per
                  person. Without it the percentages would not be worth reading.
                </li>
                <li>Everything else on FF Beacon stays open with no account.</li>
              </ul>
              {!isAuthenticated && (
                <Link
                  href="/login?next=%2Fgames%2Fwould-you-rather"
                  className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <Users aria-hidden="true" className="h-4 w-4" />
                  Sign in or create an account
                </Link>
              )}
            </Panel>

            <Panel eyebrow="Elsewhere" title="Where to go next" headingLevel={2}>
              <div className="grid gap-2">
                <LinkTile
                  href="/tools/signal-check"
                  icon={Scale}
                  title="Signal Check"
                  body="Grade a trade of your own, with the same pipeline behind the reveal."
                  accent="purple"
                />
                <LinkTile
                  href="/tools/league-pulse"
                  icon={BarChart3}
                  title="League Pulse"
                  body="Your own league, with Power Pulse and Positional WAR on it."
                />
                <LinkTile
                  href="/games/signal-scout"
                  icon={Newspaper}
                  title="Signal Scout"
                  body="The other game. A hidden player, a handful of clues."
                />
                <LinkTile
                  href="/tools"
                  icon={Wrench}
                  title="Every free tool"
                  body="On The Clock, the FAAB calculator, and the rest."
                />
              </div>
            </Panel>
          </>
        }
      >
        <WouldYouRatherClient
          initialRound={initialRound}
          initialError={initialError}
          initialGuestVotesRemaining={remaining}
          guestVotesUsed={used}
          isAuthenticated={isAuthenticated}
        />
      </PageColumns>
    </main>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand-cyan/40 bg-brand-cyan/10 font-mono text-xs font-semibold text-brand-cyan"
      >
        {n}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}
