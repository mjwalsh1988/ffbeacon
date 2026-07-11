"use client";

/**
 * Client root for the Signal Scout game (Phase 4 slice 1: state machine,
 * status bar, and start/resume flow only). Plain useState, no Zustand,
 * mirroring the On The Clock cockpit's per-operation loading/error pairs
 * (see app/tools/on-the-clock/on-the-clock-client.tsx).
 *
 * ANTI-CHEAT NOTE: this file never imports anything from
 * lib/signal-scout/round-engine as a value, only as types (erased at build).
 * The round state below is exactly what the server DTOs hand back; nothing
 * target-related exists here before a round completes.
 *
 * Hint purchase (SS-T026), guess submission, and skip (SS-T027) are wired.
 * The "active" phase below renders a minimal, real (not lorem) scouting
 * file from the DTO fields that already exist, with TODOs marking the
 * follow-up tasks that replace each remaining stub.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Radar } from "lucide-react";
import type {
  ActiveRoundDto,
  CompletedRoundDto,
  CompletedStatus,
  SignalScoutStreaks,
} from "@/lib/signal-scout/round-engine";
import type { DailyBoardRow } from "@/lib/signal-scout/leaderboards";
import { LeaderboardPreview } from "./leaderboard-preview";
import { MyStatsPanel } from "./my-stats-panel";
import type { SignalTierKey } from "@/lib/signal-scout/scoring";
import {
  startRound as requestStartRound,
  fetchRound,
  purchaseHint as requestPurchaseHint,
  submitGuess as requestSubmitGuess,
  skipRound as requestSkipRound,
  type SearchPlayerResult,
} from "@/lib/signal-scout/client";
import { applyRoundOutcomeToStreaks, currentEasternGameDate } from "@/lib/signal-scout/streaks";
import { SignalScoutStatusBar } from "./status-bar";
import { MysteryProfileCard } from "./mystery-profile-card";
import { ClueGrid, TIER_DISPLAY_NAMES } from "./clue-grid";
import { LockedSlots } from "./locked-slots";
import { HintControls } from "./hint-controls";
import { GuessCombobox } from "./guess-combobox";
import { BadReads } from "./bad-reads";
import { BurnConfirmDialog } from "./burn-confirm-dialog";
import { ScoreMeter } from "./score-meter";
import { BurnedBanner } from "./burned-banner";
import { ResultCard } from "./result-card";

type GamePhase = "idle" | "active" | "completed" | "guest_limit" | "offline";

const EMPTY_STREAKS: SignalScoutStreaks = {
  currentSignalStreak: 0,
  bestSignalStreak: 0,
  currentDailyStreak: 0,
  bestDailyStreak: 0,
};

function isCompletedRound(round: ActiveRoundDto | CompletedRoundDto): round is CompletedRoundDto {
  return "status" in round;
}

// My Scout Record panel data (plan section 3), mirrored server-side from the
// camelCase shape /api/games/signal-scout/me/stats already returns, minus
// the fields the panel does not render (timestamps, hint/wrong-guess totals,
// hidden flag). Server-resolved once on page.tsx; never fetched client-side.
export interface MyScoutStats {
  totalPoints: number;
  roundsPlayed: number;
  roundsWon: number;
  roundsSolvedLate: number;
  roundsFailed: number;
  roundsSkipped: number;
  bestSignalStreak: number;
  bestDailyStreak: number;
}

export interface SignalScoutClientProps {
  initialRound: ActiveRoundDto | null;
  isAuthenticated: boolean;
  initialStreaks: SignalScoutStreaks | null;
  // Server-resolved My Scout Record data. Null for guests and for logged-in
  // users with no signal_scout_user_stats row yet (their first completed
  // round seeds it). The idle-phase panel does not render at all when null.
  myStats: MyScoutStats | null;
  guestRoundsRemaining: number | null;
  guestPlayEnabled: boolean;
  guestDailyLimit: number;
  maxWrongGuesses: number;
  // The LIVE scoring.starting_score setting, used only to scale the score
  // meter's fill percentage. The round's own frozen snapshot governs actual
  // scoring server-side, so a mid-round admin change to this setting can
  // only make the meter's scale drift cosmetically, never the real score.
  startingScore: number;
  // The LIVE scoring.wrong_guess_penalty setting, used only in the guess
  // combobox help copy. Same cosmetic-drift caveat as startingScore: the
  // frozen snapshot governs the real penalty server-side.
  wrongGuessPenalty: number;
  // The LIVE reveal.show_player_images setting, passed straight to the
  // result card. Only affects the completed-round reveal, never anything
  // pre-completion, so it carries no anti-cheat weight.
  showPlayerImages: boolean;
  // Today's top-5 daily board, server-resolved via loadLeaderboardPreview.
  // Null when the daily board is disabled in admin settings (the panel does
  // not render at all); an empty array means the board is enabled but has no
  // scores yet today (the panel renders its own empty-state copy).
  leaderboardPreview: DailyBoardRow[] | null;
  // The LIVE leaderboards.require_login setting. When true and the viewer is
  // a guest, the preview panel renders the sign-up teaser instead of rows.
  requireLogin: boolean;
}

export function SignalScoutClient({
  initialRound,
  isAuthenticated,
  initialStreaks,
  myStats,
  guestRoundsRemaining,
  guestPlayEnabled,
  guestDailyLimit,
  maxWrongGuesses,
  startingScore,
  wrongGuessPenalty,
  showPlayerImages,
  leaderboardPreview,
  requireLogin,
}: SignalScoutClientProps) {
  const [round, setRound] = useState<ActiveRoundDto | CompletedRoundDto | null>(initialRound);
  const [phase, setPhase] = useState<GamePhase>(() => {
    if (initialRound) return "active";
    if (!isAuthenticated && guestRoundsRemaining === 0) return "guest_limit";
    return "idle";
  });
  const [startLoading, setStartLoading] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Mirrors guestRoundsRemaining but stays live across the session: the
  // server counts round STARTS, so this decrements on a fresh start (never
  // on an active_round_exists resume) and feeds the status bar / CTAs below.
  // The initial-phase useState initializer above already ran once off the
  // raw prop, which is fine since it only needs the value at first paint.
  const [guestRoundsLeft, setGuestRoundsLeft] = useState<number | null>(guestRoundsRemaining);

  // Session-scoped guest streaks (plan section 6: guests never persist
  // streaks server-side). Starts at zero every page load; advanced via
  // applyGuestStreakOutcome (below) whenever a guest round completes.
  // Logged-in streaks instead come from the round DTO (round.streaks) or
  // the server-resolved initialStreaks.
  const [guestStreaks, setGuestStreaks] = useState<SignalScoutStreaks>(EMPTY_STREAKS);
  const [guestLastPlayedDate, setGuestLastPlayedDate] = useState<string | null>(null);

  const [announcement, setAnnouncement] = useState("");
  const announce = useCallback((message: string) => setAnnouncement(message), []);

  // Set after a hint purchase so ClueGrid can glow the newest cell and move
  // focus to it (see handlePurchaseHint below).
  const [newestClueKey, setNewestClueKey] = useState<string | null>(null);

  const [hintPendingTier, setHintPendingTier] = useState<SignalTierKey | null>(null);
  const [hintError, setHintError] = useState<string | null>(null);
  // Non-null while the burn-confirmation dialog is open; identifies which
  // tier the confirmation is for.
  const [burnDialogTier, setBurnDialogTier] = useState<SignalTierKey | null>(null);

  const [guessPending, setGuessPending] = useState(false);
  const [guessError, setGuessError] = useState<string | null>(null);
  const [skipPending, setSkipPending] = useState(false);

  const handleStartRound = useCallback(async () => {
    setStartLoading(true);
    setStartError(null);
    setHintError(null);

    const result = await requestStartRound();
    if (result.ok) {
      setRound(result.data.round);
      setPhase("active");
      setStartLoading(false);
      announce("New signal locked. Scouting file open.");
      // The server counts this as a round START, so decrement the guest
      // counter here. A resume (the active_round_exists branch below) never
      // reaches this line, since it did not start a new round.
      if (!isAuthenticated) {
        setGuestRoundsLeft((prev) => (prev === null ? prev : Math.max(0, prev - 1)));
      }
      return;
    }

    if (result.code === "active_round_exists" && result.roundId) {
      // A resume, never surfaced as an error: the caller already has a live
      // round (e.g. a second tab, or a reload that raced the round-start
      // response), so fetch it and drop straight into the game.
      const resumed = await fetchRound(result.roundId);
      if (resumed.ok) {
        setRound(resumed.data.round);
        setPhase(isCompletedRound(resumed.data.round) ? "completed" : "active");
        setStartLoading(false);
        return;
      }
      setStartError(resumed.message);
      setStartLoading(false);
      return;
    }

    if (result.code === "guest_limit_reached") {
      setPhase("guest_limit");
      setStartLoading(false);
      return;
    }

    if (result.code === "game_disabled" || result.code === "pool_empty") {
      setPhase("offline");
      setStartLoading(false);
      return;
    }

    // rate_limited and anything else: stay on the current phase with a
    // retryable error message.
    setStartError(result.message);
    setStartLoading(false);
  }, [announce, isAuthenticated]);

  const activeRound = round && !isCompletedRound(round) ? round : null;
  const completedRound = round && isCompletedRound(round) ? round : null;

  // Focus management (plan section 26): move focus to the result heading the
  // moment the phase transitions INTO "completed", not on every render while
  // it stays completed. The double rAF lets the completed-phase markup paint
  // first so the heading actually exists in the DOM when focus() runs.
  const previousPhaseRef = useRef<GamePhase>(phase);
  useEffect(() => {
    if (phase === "completed" && previousPhaseRef.current !== "completed") {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.getElementById("signal-scout-result-heading")?.focus();
        });
      });
    }
    previousPhaseRef.current = phase;
  }, [phase]);

  const signalStreak = isAuthenticated
    ? (activeRound?.streaks?.currentSignalStreak ??
      completedRound?.streaks?.currentSignalStreak ??
      initialStreaks?.currentSignalStreak ??
      0)
    : guestStreaks.currentSignalStreak;
  const dailyStreak = isAuthenticated
    ? (activeRound?.streaks?.currentDailyStreak ??
      completedRound?.streaks?.currentDailyStreak ??
      initialStreaks?.currentDailyStreak ??
      0)
    : guestStreaks.currentDailyStreak;

  const handlePurchaseHint = useCallback(
    async (tier: SignalTierKey, confirmBurn: boolean) => {
      if (!activeRound) return;
      // Defense in depth: HintControls already disables every tier button
      // while one purchase is pending, but guard here too in case a stale
      // click event slips through.
      if (hintPendingTier) return;

      setHintPendingTier(tier);
      setHintError(null);

      const result = await requestPurchaseHint(activeRound.roundId, tier, confirmBurn);

      if (result.ok) {
        const { clue, scoreAvailable, burned, tierPurchasesRemaining, lockedCounts } = result.data;
        setRound((prev) => {
          if (!prev || isCompletedRound(prev)) return prev;
          return {
            ...prev,
            revealedClues: [...prev.revealedClues, clue],
            score: scoreAvailable,
            burned,
            lockedCounts,
            purchasesRemaining: tierPurchasesRemaining,
          };
        });
        setNewestClueKey(clue.clueKey);
        // The clue content is announced by the focus move to the cell below,
        // and the burned case is announced by BurnedBanner's role="alert", so
        // the polite region only ever carries the score (or nothing when
        // burned) to avoid double speech.
        if (!burned) {
          announce(`Score ${scoreAvailable} of ${startingScore}.`);
        }
        setBurnDialogTier(null);
        setHintPendingTier(null);

        // Deferred so this runs after SlideUpDialog's own focus-restore
        // effect: closing the dialog (setBurnDialogTier(null) above) flips
        // its `open` prop false, and SlideUpDialog returns focus to the
        // element that was focused before it opened as part of that same
        // update. A short timeout lets that restore land first before we
        // move focus again; harmless when the dialog was never open.
        window.setTimeout(() => {
          document.getElementById(`clue-cell-${clue.clueKey}`)?.focus();
        }, 120);
        return;
      }

      setHintPendingTier(null);

      if (result.code === "burn_confirmation_required") {
        // The server caught a stale client (score changed between render and
        // click). Not an error: open the same confirmation dialog the
        // client-side check would have opened.
        setBurnDialogTier(tier);
        return;
      }

      // Every other failure closes the burn dialog if it was open: leaving it
      // up with a stale (or, post-completion, zeroed) cost/score pairing over
      // an error banner or the result card is worse than closing it.
      setBurnDialogTier(null);

      if (
        result.code === "signal_burned" ||
        result.code === "tier_limit_reached" ||
        result.code === "tier_exhausted" ||
        result.code === "tier_disabled" ||
        result.code === "rate_limited"
      ) {
        setHintError(result.message);
        return;
      }

      if (result.code === "round_not_active" || result.code === "not_found") {
        const resynced = await fetchRound(activeRound.roundId);
        if (resynced.ok && isCompletedRound(resynced.data.round)) {
          setRound(resynced.data.round);
          setPhase("completed");
        } else {
          setHintError(resynced.ok ? result.message : resynced.message);
        }
        return;
      }

      setHintError(result.message);
    },
    [activeRound, hintPendingTier, announce],
  );

  const handleBuyClick = useCallback(
    (tier: SignalTierKey) => {
      if (!activeRound) return;
      if (activeRound.tierCosts[tier] >= activeRound.score) {
        setBurnDialogTier(tier);
        return;
      }
      void handlePurchaseHint(tier, false);
    },
    [activeRound, handlePurchaseHint],
  );

  const handleConfirmBurn = useCallback(() => {
    if (!burnDialogTier) return;
    void handlePurchaseHint(burnDialogTier, true);
  }, [burnDialogTier, handlePurchaseHint]);

  // Guest streaks never touch the DB (plan section 6); apply the same pure
  // math the server uses (lib/signal-scout/streaks.ts) to the session-scoped
  // guest state whenever a guest round completes. CompletedStatus and
  // streaks.ts's RoundOutcome are the same four-value union, so the status
  // passes straight through as the outcome.
  const applyGuestStreakOutcome = useCallback(
    (status: CompletedStatus) => {
      const gameDate = currentEasternGameDate();
      const next = applyRoundOutcomeToStreaks({
        outcome: status,
        gameDate,
        current: {
          currentSignalStreak: guestStreaks.currentSignalStreak,
          bestSignalStreak: guestStreaks.bestSignalStreak,
          currentDailyStreak: guestStreaks.currentDailyStreak,
          bestDailyStreak: guestStreaks.bestDailyStreak,
          lastPlayedDate: guestLastPlayedDate,
        },
      });
      setGuestStreaks({
        currentSignalStreak: next.currentSignalStreak,
        bestSignalStreak: next.bestSignalStreak,
        currentDailyStreak: next.currentDailyStreak,
        bestDailyStreak: next.bestDailyStreak,
      });
      setGuestLastPlayedDate(next.lastPlayedDate);
    },
    [guestStreaks, guestLastPlayedDate],
  );

  const handleSubmitGuess = useCallback(
    async (player: SearchPlayerResult) => {
      if (!activeRound || guessPending || skipPending) return;

      setGuessPending(true);
      setGuessError(null);

      const result = await requestSubmitGuess(activeRound.roundId, player.id);

      if (result.ok) {
        const nextRound = result.data.round;
        setRound(nextRound);
        setGuessPending(false);

        if (isCompletedRound(nextRound)) {
          setPhase("completed");
          if (!isAuthenticated) applyGuestStreakOutcome(nextRound.status);
          // No polite announce here: the ResultCard mounts an sr-only
          // role="alert" node carrying the outcome (plan section 26 wants
          // result states on the assertive channel), and announcing here too
          // would double-read it.
        } else {
          announce(
            `Bad Read. ${player.name} ruled out. ${nextRound.wrongGuesses} of ${nextRound.maxWrongGuesses} bad reads used. Score ${nextRound.score}.`,
          );
        }
        return;
      }

      setGuessPending(false);

      if (
        result.code === "guess_duplicate" ||
        result.code === "guess_out_of_pool" ||
        result.code === "rate_limited"
      ) {
        setGuessError(result.message);
        return;
      }

      if (result.code === "round_not_active" || result.code === "not_found") {
        const resynced = await fetchRound(activeRound.roundId);
        if (resynced.ok && isCompletedRound(resynced.data.round)) {
          setRound(resynced.data.round);
          setPhase("completed");
        } else {
          setGuessError(resynced.ok ? result.message : resynced.message);
        }
        return;
      }

      setGuessError(result.message);
    },
    [activeRound, guessPending, skipPending, isAuthenticated, applyGuestStreakOutcome, announce],
  );

  const handleSkipRound = useCallback(async () => {
    if (!activeRound || guessPending || skipPending) return;

    setSkipPending(true);
    setGuessError(null);

    const result = await requestSkipRound(activeRound.roundId);

    if (result.ok) {
      const nextRound = result.data.round;
      setRound(nextRound);
      setPhase("completed");
      setSkipPending(false);
      if (!isAuthenticated) applyGuestStreakOutcome(nextRound.status);
      // No polite announce: ResultCard's sr-only role="alert" node carries
      // the outcome on the assertive channel (see handleSubmitGuess).
      return;
    }

    setSkipPending(false);

    if (result.code === "round_not_active" || result.code === "not_found") {
      const resynced = await fetchRound(activeRound.roundId);
      if (resynced.ok && isCompletedRound(resynced.data.round)) {
        setRound(resynced.data.round);
        setPhase("completed");
      } else {
        setGuessError(resynced.ok ? result.message : resynced.message);
      }
      return;
    }

    setGuessError(result.message);
  }, [activeRound, guessPending, skipPending, isAuthenticated, applyGuestStreakOutcome, announce]);

  return (
    <div className="space-y-6">
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>

      <SignalScoutStatusBar
        score={round ? round.score : null}
        signalStreak={signalStreak}
        dailyStreak={dailyStreak}
        wrongGuesses={round?.wrongGuesses ?? 0}
        maxWrongGuesses={round?.maxWrongGuesses ?? maxWrongGuesses}
        burned={round?.burned ?? false}
        isAuthenticated={isAuthenticated}
        guestRoundsRemaining={isAuthenticated ? null : guestRoundsLeft}
      />

      {startError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-card border border-signal-danger/40 bg-signal-danger/10 px-4 py-3 text-sm text-signal-danger"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{startError}</span>
        </div>
      )}

      {phase === "idle" && (
        <div className="space-y-6">
          <div
            className="relative overflow-hidden rounded-modal border border-brand-purple/25 bg-surface/30 p-5 sm:p-8"
            style={{
              backgroundImage:
                "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.08) 0%, transparent 60%)",
            }}
          >
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-px"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
              }}
            />
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-brand-cyan/40 bg-base text-brand-cyan"
              >
                <Radar className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
                  Ready when you are
                </p>
                <h3 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">
                  Lock onto a signal
                </h3>
              </div>
            </div>
            <p className="mt-2 text-sm text-ink-muted">
              Every round hides one player behind a handful of starter clues. Buy hints
              to reveal more, then name the player before the signal burns out.
            </p>

            <div className="mt-6">
              {!isAuthenticated && !guestPlayEnabled ? (
                <>
                  <p className="text-sm text-ink-muted">Guest play is off right now. Sign in to scout.</p>
                  <Link
                    href="/login"
                    className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  >
                    Sign in
                  </Link>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleStartRound()}
                  disabled={startLoading}
                  aria-busy={startLoading}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-wait disabled:opacity-60"
                >
                  {startLoading ? "Locking onto a signal..." : "Start scouting"}
                </button>
              )}
            </div>
          </div>

          {myStats && <MyStatsPanel stats={myStats} />}

          {leaderboardPreview !== null && (
            <LeaderboardPreview
              rows={leaderboardPreview}
              requireLogin={requireLogin}
              viewerSignedIn={isAuthenticated}
            />
          )}
        </div>
      )}

      {phase === "active" && activeRound && (
        <div
          className="relative overflow-hidden rounded-modal border border-brand-purple/25 bg-surface/30 p-5 sm:p-8"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.08) 0%, transparent 60%)",
          }}
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px"
            style={{
              backgroundImage:
                "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
            }}
          />
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-brand-cyan/40 bg-base text-brand-cyan"
            >
              <Radar className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
                Active round
              </p>
              <h3 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">Scouting file</h3>
            </div>
          </div>

          <div className="mt-6">
            <MysteryProfileCard />
          </div>

          <ClueGrid clues={activeRound.revealedClues} newestClueKey={newestClueKey} />

          <LockedSlots
            lockedCounts={activeRound.lockedCounts}
            purchasesRemaining={activeRound.purchasesRemaining}
            tierCosts={activeRound.tierCosts}
          />

          {hintError && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-card border border-signal-danger/40 bg-signal-danger/10 px-4 py-3 text-sm text-signal-danger"
            >
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{hintError}</span>
            </div>
          )}

          <HintControls
            score={activeRound.score}
            burned={activeRound.burned}
            lockedCounts={activeRound.lockedCounts}
            purchasesRemaining={activeRound.purchasesRemaining}
            tierCosts={activeRound.tierCosts}
            pendingTier={hintPendingTier}
            onBuy={handleBuyClick}
          />

          {activeRound.burned && <BurnedBanner />}

          {guessError && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-card border border-signal-danger/40 bg-signal-danger/10 px-4 py-3 text-sm text-signal-danger"
            >
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{guessError}</span>
            </div>
          )}

          <div className="mt-6">
            <GuessCombobox
              disabled={guessPending || skipPending}
              ruledOutIds={activeRound.badReads.map((b) => b.playerId)}
              wrongGuessPenalty={wrongGuessPenalty}
              onSelect={(player) => void handleSubmitGuess(player)}
            />
          </div>

          <BadReads badReads={activeRound.badReads} />

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleSkipRound()}
              disabled={guessPending || skipPending}
              aria-busy={skipPending}
              aria-describedby="signal-scout-skip-consequence"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-60"
            >
              {skipPending ? "Skipping..." : "Skip round"}
            </button>
            <span id="signal-scout-skip-consequence" className="text-xs text-ink-subtle">
              Ends the round with no score. Your Signal Streak resets.
            </span>
          </div>

          <ScoreMeter score={activeRound.score} startingScore={startingScore} burned={activeRound.burned} />
        </div>
      )}

      {phase === "guest_limit" && (
        <div
          className="relative overflow-hidden rounded-modal border border-brand-purple/25 bg-surface/30 p-5 sm:p-8"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.08) 0%, transparent 60%)",
          }}
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px"
            style={{
              backgroundImage:
                "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
            }}
          />
          <h3 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">
            You are out of signals for today
          </h3>
          <p className="mt-2 text-sm text-ink-muted">
            Guests get {guestDailyLimit} rounds per day (Eastern Time). An account is
            free and unlocks unlimited rounds, saved streaks, and leaderboards.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Create a free account
            </Link>
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Sign in
            </Link>
          </div>
        </div>
      )}

      {phase === "offline" && (
        <div
          role="status"
          className="mx-auto max-w-2xl rounded-modal border border-line bg-surface/50 p-6 text-center sm:p-8"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">Signal Scout</p>
          <h3 className="mt-3 text-xl font-semibold tracking-tight text-ink">Signal offline</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Signal Scout is taking a breather. Check back soon.
          </p>
        </div>
      )}

      {phase === "completed" && completedRound && (
        <div className="space-y-4">
          <ResultCard
            round={completedRound}
            showPlayerImages={showPlayerImages}
            streaks={{ signalStreak, dailyStreak }}
          />

          {!isAuthenticated && guestRoundsLeft === 0 ? (
            <div
              className="relative overflow-hidden rounded-modal border border-brand-purple/25 bg-surface/30 p-5 sm:p-8"
              style={{
                backgroundImage:
                  "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.08) 0%, transparent 60%)",
              }}
            >
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-px"
                style={{
                  backgroundImage:
                    "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
                }}
              />
              <h3 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">
                That is it for today, scout
              </h3>
              <p className="mt-2 text-sm text-ink-muted">
                Guests get {guestDailyLimit} rounds per day (Eastern Time). A free account
                unlocks unlimited rounds, saved streaks, and leaderboards.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/login"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  Create a free account
                </Link>
                <Link
                  href="/login"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  Sign in
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleStartRound()}
                disabled={startLoading}
                aria-busy={startLoading}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-wait disabled:opacity-60"
              >
                {startLoading ? "Locking onto a signal..." : "Next round"}
              </button>
              {!isAuthenticated && guestRoundsLeft !== null && guestRoundsLeft > 0 && (
                <span className="text-xs text-ink-subtle">
                  {guestRoundsLeft} guest round{guestRoundsLeft === 1 ? "" : "s"} left today.
                </span>
              )}
            </div>
          )}

          {/* Suppressed when the "That is it for today, scout" signup wall
              above is already showing (guest, no rounds left): stacking a
              second "Create a free account" CTA from the preview's teaser
              variant would double up the same ask. Guests who still have
              rounds left keep the preview, teaser variant if requireLogin
              is on. */}
          {leaderboardPreview !== null && !(!isAuthenticated && guestRoundsLeft === 0) && (
            <LeaderboardPreview
              rows={leaderboardPreview}
              requireLogin={requireLogin}
              viewerSignedIn={isAuthenticated}
            />
          )}
        </div>
      )}

      <BurnConfirmDialog
        open={burnDialogTier !== null}
        tier={burnDialogTier}
        cost={burnDialogTier && activeRound ? activeRound.tierCosts[burnDialogTier] : 0}
        score={activeRound?.score ?? 0}
        pending={hintPendingTier !== null && hintPendingTier === burnDialogTier}
        onConfirm={handleConfirmBurn}
        onClose={() => setBurnDialogTier(null)}
      />
    </div>
  );
}
