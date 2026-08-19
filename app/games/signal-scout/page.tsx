import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Radar, Zap, Target, type LucideIcon } from "lucide-react";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { loadSignalScoutSettings } from "@/lib/signal-scout/settings";
import {
  loadLeaderboardView,
  type Board,
} from "@/lib/signal-scout/leaderboards";
import type { LeaderboardViewDto } from "@/lib/signal-scout/client";
import { LeaderboardRail } from "./leaderboard-rail";
import {
  findActiveRoundId,
  getRound,
  type ActiveRoundDto,
  type CompletedRoundDto,
  type RoundIdentity,
  type SignalScoutStreaks,
} from "@/lib/signal-scout/round-engine";
import {
  SCOUT_GUEST_COOKIE,
  uuidSchema,
  hashGuestIp,
} from "@/lib/signal-scout/route-helpers";
import { currentEasternGameDate } from "@/lib/signal-scout/streaks";
import { SignalScoutClient, type MyScoutStats } from "./signal-scout-client";
import { HowItWorks } from "./how-it-works";
import { MyStatsPanel } from "./my-stats-panel";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";

export const metadata: Metadata = {
  alternates: { canonical: "/games/signal-scout" },
  title: "Signal Scout",
  description:
    "Decode the profile. Find the player. A daily fantasy football guessing game: burn hints to reveal clues about a hidden NFL player before the signal runs out.",
};

export const dynamic = "force-dynamic";

/** Display order of the leaderboard boards; filtered by admin settings below. */
const BOARD_ORDER: Board[] = ["daily", "all_time", "streak"];

function isCompletedRound(
  round: ActiveRoundDto | CompletedRoundDto,
): round is CompletedRoundDto {
  return "status" in round;
}

/**
 * Signal Scout - public "guess the player from clues" game (Phase 4 slice 1).
 *
 * Server shell: resolves the admin game settings (feature gate), the signed-in
 * session or a guest identity, any resumable active round, logged-in streak
 * context, and the guest daily-round-cap remainder. None of this touches
 * anything target-related; the round DTOs already enforce the anti-cheat
 * invariant (see the doc comment on ActiveRoundDto in round-engine.ts).
 */
export default async function SignalScoutPage() {
  const admin = createAdminClient();
  const settings = await loadSignalScoutSettings(admin);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAuthenticated = Boolean(user);

  // Guest identity resolution mirrors resolveRoundIdentity in
  // lib/signal-scout/route-helpers.ts, adapted for a Server Component: there
  // is no Request object here, so next/headers cookies()/headers() stand in
  // for the route-helper's hand-rolled cookie read and clientIp.
  let identity: RoundIdentity | null = null;
  let guestId: string | null = null;
  let ipHash: string | null = null;

  if (user) {
    identity = { kind: "user", userId: user.id };
  } else {
    const cookieStore = await cookies();
    const cookieGuestId = cookieStore.get(SCOUT_GUEST_COOKIE)?.value ?? null;
    const headerStore = await headers();
    const xff = headerStore.get("x-forwarded-for");
    const rawIp = xff
      ? (xff.split(",")[0]?.trim() ?? "unknown")
      : headerStore.get("x-real-ip")?.trim() || "unknown";
    ipHash = hashGuestIp(rawIp);
    if (cookieGuestId && uuidSchema.safeParse(cookieGuestId).success) {
      guestId = cookieGuestId;
      identity = { kind: "guest", guestId: cookieGuestId, ipHash };
    }
  }

  let initialRound: ActiveRoundDto | null = null;
  if (identity) {
    const activeRoundId = await findActiveRoundId(admin, identity);
    if (activeRoundId) {
      const result = await getRound(admin, identity, activeRoundId);
      if (result.ok && !isCompletedRound(result.round)) {
        initialRound = result.round;
      }
    }
  }

  let initialStreaks: SignalScoutStreaks | null = null;
  // My Scout Record panel data (plan section 3: the idle state shows
  // streaks, stats, and a leaderboard preview). Pulled off the same row as
  // initialStreaks above, one query, no second round trip.
  let myStats: MyScoutStats | null = null;
  if (user) {
    const { data: statsRow } = await admin
      .from("signal_scout_user_stats")
      .select(
        "current_signal_streak, best_signal_streak, current_daily_streak, best_daily_streak, total_points, rounds_played, rounds_won, rounds_solved_late, rounds_failed, rounds_skipped",
      )
      .eq("user_id", user.id)
      .maybeSingle();
    if (statsRow) {
      initialStreaks = {
        currentSignalStreak: statsRow.current_signal_streak,
        bestSignalStreak: statsRow.best_signal_streak,
        currentDailyStreak: statsRow.current_daily_streak,
        bestDailyStreak: statsRow.best_daily_streak,
      };
      myStats = {
        totalPoints: statsRow.total_points,
        roundsPlayed: statsRow.rounds_played,
        roundsWon: statsRow.rounds_won,
        roundsSolvedLate: statsRow.rounds_solved_late,
        roundsFailed: statsRow.rounds_failed,
        roundsSkipped: statsRow.rounds_skipped,
        bestSignalStreak: statsRow.best_signal_streak,
        bestDailyStreak: statsRow.best_daily_streak,
      };
    }
  }

  let guestRoundsRemaining: number | null = null;
  if (!user) {
    const gameDate = currentEasternGameDate();
    const keys: string[] = [];
    if (guestId) keys.push(`guest:${guestId}`);
    if (ipHash) keys.push(`ip:${ipHash}`);

    let guestCount = 0;
    let ipCount = 0;
    if (keys.length > 0) {
      const { data: counterRows } = await admin
        .from("signal_scout_activity_counters")
        .select("identity_key, count")
        .in("identity_key", keys)
        .eq("action", "guest_round_start")
        .eq("game_date", gameDate);
      for (const row of counterRows ?? []) {
        if (guestId && row.identity_key === `guest:${guestId}`)
          guestCount = row.count;
        if (ipHash && row.identity_key === `ip:${ipHash}`) ipCount = row.count;
      }
    }
    guestRoundsRemaining = Math.max(
      0,
      settings.guest_daily_round_limit - Math.max(guestCount, ipCount, 0),
    );
  }

  // Leaderboard rail (plan sections 3, 8, 21). The boards live in a sidebar
  // on this page now; /games/signal-scout/leaderboards is a permanent
  // redirect back here (see next.config.ts).
  const { leaderboards } = settings;
  const perBoardEnabled: Record<Board, boolean> = {
    daily: leaderboards.daily_enabled,
    all_time: leaderboards.all_time_enabled,
    streak: leaderboards.streak_enabled,
  };
  const enabledBoards = BOARD_ORDER.filter((b) => perBoardEnabled[b]);
  const railEnabled =
    leaderboards.leaderboard_enabled && enabledBoards.length > 0;
  const initialBoard = enabledBoards[0] ?? "daily";

  // LeaderboardRail is a client component, so any prop passed to it is
  // serialized into the RSC/flight payload in the page source regardless of
  // what actually renders on screen. When leaderboards.require_login is on
  // and there is no session, the UI shows only the sign-in card, but a
  // signed-out guest could still read real leaderboard rows out of the flight
  // payload via view-source. So gated guests must never receive row data:
  // skip the load entirely and send null. The rail's `teaser` branch never
  // reads rows and never fetches, so the panel still renders correctly with
  // zero row data ever leaving the server.
  //
  // Unlike the loadLeaderboardPreview call this replaced, loadLeaderboardView
  // throws on a query failure, so it is wrapped: a leaderboard outage must
  // degrade to the rail's own error state, never take the game page down with
  // it. Only page 1 of the first enabled board is server-rendered; every
  // other board and page is fetched by the rail on demand.
  let initialView: LeaderboardViewDto | null = null;
  if (railEnabled && !(leaderboards.require_login && !user)) {
    try {
      const loaded = await loadLeaderboardView(
        admin,
        initialBoard,
        1,
        user?.id ?? null,
        leaderboards.hide_admin_users,
      );
      initialView = { board: initialBoard, page: 1, ...loaded };
    } catch (err) {
      console.error("[signal-scout]", err);
    }
  }

  // No section wrapper and no heading here any more. The masthead carries this
  // page's h1 and the client owns whether it is on screen, so both the h1 and
  // the "Play Signal Scout" heading under it are rendered in there, in that
  // order. A heading declared out here would have preceded the h1 it belongs
  // under.
  const gameSection = (
    <>
      {settings.game_enabled ? (
        <SignalScoutClient
          // The masthead is handed to the client so it can take it away once a
          // round is live. See the prop's note in signal-scout-client.tsx.
          masthead={<Masthead />}
          initialRound={initialRound}
          isAuthenticated={isAuthenticated}
          initialStreaks={initialStreaks}
          guestRoundsRemaining={guestRoundsRemaining}
          guestPlayEnabled={settings.guest_play_enabled}
          guestDailyLimit={settings.guest_daily_round_limit}
          maxWrongGuesses={settings.scoring.max_wrong_guesses}
          startingScore={settings.scoring.starting_score}
          wrongGuessPenalty={settings.scoring.wrong_guess_penalty}
          showPlayerImages={settings.reveal.show_player_images}
        />
      ) : (
        <>
          <Masthead />
          <h2 className="sr-only">Play Signal Scout</h2>
          <div className="mt-6">
            <SignalOfflineNotice />
          </div>
        </>
      )}
    </>
  );

  // How It Works rides along in the rail's secondary column, under the boards
  // in both the desktop sidebar and the mobile modal. The rail renders that
  // column twice and both copies coexist in the DOM while the modal is open,
  // so each gets its own heading id (see the note in how-it-works.tsx).
  const howItWorksProps = {
    startingScore: settings.scoring.starting_score,
    guestDailyLimit: settings.guest_daily_round_limit,
    maxWrongGuesses: settings.scoring.max_wrong_guesses,
    tierCosts: {
      weak: settings.scoring.weak_signal_cost,
      clear: settings.scoring.clear_signal_cost,
      ping: settings.scoring.beacon_ping_cost,
      scan: settings.scoring.full_scan_cost,
    },
  };

  return (
    <main id="main">
      {/* The masthead is rendered INSIDE the game column rather than above the
          whole page, because the game takes it away once a round is live and a
          page-level masthead could not be removed from in here. */}
      <PageBody>
        {railEnabled ? (
          <LeaderboardRail
            boards={enabledBoards}
            initialBoard={initialBoard}
            initialView={initialView}
            requireLogin={leaderboards.require_login}
            viewerSignedIn={isAuthenticated}
            howItWorksRail={
              <HowItWorks
                {...howItWorksProps}
                headingId="signal-scout-how-it-works-rail"
              />
            }
            howItWorksSheet={
              <HowItWorks
                {...howItWorksProps}
                headingId="signal-scout-how-it-works-sheet"
              />
            }
            myStatsRail={
              myStats ? (
                <MyStatsPanel
                  stats={myStats}
                  headingId="signal-scout-my-stats-rail"
                />
              ) : null
            }
            myStatsSheet={
              myStats ? (
                <MyStatsPanel
                  stats={myStats}
                  headingId="signal-scout-my-stats-sheet"
                />
              ) : null
            }
          >
            {gameSection}
          </LeaderboardRail>
        ) : (
          // Leaderboards off entirely: no rail and no button, so the game gets
          // the full width back, and How It Works, which normally rides in the
          // rail, has to be placed here or it would vanish with the rail that
          // carries it.
          <>
            {gameSection}
            {myStats && (
              <div className="mt-6">
                <MyStatsPanel stats={myStats} headingId="signal-scout-my-stats" />
              </div>
            )}
            <div className="mt-6">
              <HowItWorks
                {...howItWorksProps}
                headingId="signal-scout-how-it-works"
              />
            </div>
          </>
        )}
      </PageBody>
    </main>
  );
}

function SignalOfflineNotice() {
  return (
    <div
      role="status"
      className="mx-auto max-w-2xl rounded-modal border border-line bg-surface/50 p-6 text-center sm:p-8"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
        Signal Scout
      </p>
      <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink">
        Signal offline
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        Signal Scout is taking a breather. Check back soon.
      </p>
    </div>
  );
}

const HERO_BULLETS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Radar,
    title: "A hidden player",
    body: "One real NFL player, revealed only through clues.",
  },
  {
    icon: Zap,
    title: "Hints burn signal",
    body: "Every clue you buy costs score. Spend it wisely.",
  },
  {
    icon: Target,
    title: "Name them in time",
    body: "Guess the player before the signal burns out.",
  },
];

function Masthead() {
  return (
    <PageMasthead
      eyebrow="Games"
      title="Signal Scout: decode the profile. Find the player."
      description="Every round hides a real NFL player behind a handful of starter clues. Buy hints across four signal tiers to reveal more, but each one burns your score, so read fast, guess smart, and name the player before the signal burns out."
    >
      <ul
        role="list"
        aria-label="How Signal Scout works"
        className="grid grid-cols-3 gap-2 sm:gap-4"
      >
        {HERO_BULLETS.map((bullet) => (
          <HeroBullet key={bullet.title} {...bullet} />
        ))}
      </ul>
    </PageMasthead>
  );
}

function HeroBullet({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <li className="flex flex-col items-center rounded-card border border-line bg-surface/60 p-2.5 text-center sm:items-start sm:p-4 sm:text-left">
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded-card border border-line bg-base text-brand-cyan sm:h-9 sm:w-9"
      >
        <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
      </span>
      <p className="mt-2 text-xs font-semibold leading-tight text-ink sm:mt-3 sm:text-sm">
        {title}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-ink-muted sm:text-xs sm:leading-relaxed">
        {body}
      </p>
    </li>
  );
}
