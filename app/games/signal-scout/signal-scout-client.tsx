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

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Crosshair, OctagonX, Radar } from "lucide-react";
import type {
  ActiveRoundDto,
  CompletedRoundDto,
  CompletedStatus,
  SignalScoutStreaks,
} from "@/lib/signal-scout/round-engine";
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
import { useStepScroll } from "@/lib/use-step-scroll";
import { SignalScoutStatusBar } from "./status-bar";
import { MysteryProfileCard } from "./mystery-profile-card";
import { MissionHeader } from "./mission-header";
import { ScoutSectionHead } from "./scout-section-head";
import { ClueGrid, TIER_DISPLAY_NAMES } from "./clue-grid";
import { HintControls } from "./hint-controls";
import { GuessCombobox } from "./guess-combobox";
import { BadReads } from "./bad-reads";
import { BurnConfirmDialog } from "./burn-confirm-dialog";
import { SkipConfirmDialog } from "./skip-confirm-dialog";
import { ScoreMeter } from "./score-meter";
import { BurnedBanner } from "./burned-banner";
import { ResultCard } from "./result-card";

type GamePhase = "idle" | "active" | "completed" | "guest_limit" | "offline";

/**
 * The game area. A new phase opens at the top of the page, but focus has to
 * land on the game itself: the page top is the site header, and a screen
 * reader left there hears nothing about the round that just started.
 */
const STAGE_ID = "signal-scout-stage";

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
  /**
   * The page masthead, rendered by the server and handed in as a slot.
   *
   * It shows before a round and while the game is unavailable, and it goes
   * away the moment a round is live: mid-round, a headline explaining what
   * Signal Scout is sits between the player and a running clock. Same call
   * On The Clock makes with the draft room's hero.
   */
  masthead: ReactNode;
  initialRound: ActiveRoundDto | null;
  isAuthenticated: boolean;
  initialStreaks: SignalScoutStreaks | null;
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
}

export function SignalScoutClient({
  masthead,
  initialRound,
  isAuthenticated,
  initialStreaks,
  guestRoundsRemaining,
  guestPlayEnabled,
  guestDailyLimit,
  maxWrongGuesses,
  startingScore,
  wrongGuessPenalty,
  showPlayerImages,
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
  // Skipping is irreversible (no score, streak reset) and the server does not
  // ask twice, so the button opens this confirmation rather than skipping.
  const [skipDialogOpen, setSkipDialogOpen] = useState(false);

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
  // Each phase replaces the whole screen, but the URL never changes, so nothing
  // moves the scroll position on its own. Starting the next round from the
  // button at the bottom of a result used to leave the reader down there,
  // staring at the middle of a round they had not seen the top of. A round is
  // a new place rather than an answer to a question, so it opens at the top.
  // "completed" opts out: the focus move below already puts them on the result
  // heading, and two scrolls in one frame is worse than one.
  useStepScroll(phase === "completed" ? null : phase, { focusId: STAGE_ID });

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

    // The dialog is rendered outside the phase branches, so it would sit open
    // over the result card once the skip lands. Closed on every outcome, not
    // just success: a failure surfaces in the answer panel's error slot, which
    // is behind the dialog.
    setSkipDialogOpen(false);

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

  // Before a round, and when there is no round to be had. Once one is live the
  // masthead steps aside, and it stays aside through the reveal so the result
  // is what fills the screen.
  const showMasthead =
    phase === "idle" || phase === "guest_limit" || phase === "offline";

  return (
    <div id={STAGE_ID} className="space-y-6 scroll-mt-24">
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>

      {showMasthead && masthead}
      {/* The masthead carries the page h1 before a round. Once it steps aside
          the mission header takes both its place and its h1, so the page always
          has exactly one, and the heading below names the game itself at both
          times, which is what keeps the round's own headings from skipping a
          level. */}
      {!showMasthead && (
        <MissionHeader variant={phase === "completed" ? "complete" : "active"} />
      )}
      <h2 className="sr-only">Play Signal Scout</h2>

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

        </div>
      )}

      {/* No panel around the round any more. Every section inside it now
          carries its own bordered, toned surface with its own header, and
          wrapping the set in one more bordered surface put a box inside a box
          inside a box. It also means the guess combobox's listbox can no longer
          be clipped by an ancestor's overflow-hidden. */}
      {phase === "active" && activeRound && (
        <div>
          <h3 className="sr-only">Active round</h3>

          <MysteryProfileCard />

          <ClueGrid clues={activeRound.revealedClues} newestClueKey={newestClueKey} highlight />

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

          {/* The answer panel: deliberately NOT styled like the clue panel it
              sits below. Clues are a cool cyan-bordered surface you read; this
              is the warm purple-bordered surface you act on, lit from below so
              it reads as the round's live call to action rather than another
              slab of information.

              NO overflow-hidden here, unlike the clue panel: the combobox's
              results listbox is absolutely positioned and would be clipped by
              it. The gradient follows the border radius on its own, and this
              panel skips the top hairline that would have needed the clipping
              anyway. */}
          <section
            aria-labelledby="signal-scout-answer-heading"
            className="relative mt-6 rounded-modal border border-brand-purple/45 p-4 shadow-[0_0_70px_-38px_rgba(168,85,247,0.95)] sm:p-5"
            style={{
              backgroundImage:
                "radial-gradient(ellipse at 50% 118%, rgba(168, 85, 247, 0.30) 0%, rgba(168, 85, 247, 0.12) 42%, transparent 72%)",
            }}
          >
            <ScoutSectionHead
              icon={Crosshair}
              eyebrow="Name them"
              title="Make the call"
              id="signal-scout-answer-heading"
              tone="purple"
            />

            {guessError && (
              <div
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-card border border-signal-danger/40 bg-signal-danger/10 px-4 py-3 text-sm text-signal-danger"
              >
                <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{guessError}</span>
              </div>
            )}

            <div className="mt-3">
              <GuessCombobox
                disabled={guessPending || skipPending}
                ruledOutIds={activeRound.badReads.map((b) => b.playerId)}
                wrongGuessPenalty={wrongGuessPenalty}
                onSelect={(player) => void handleSubmitGuess(player)}
              />
            </div>
          </section>

          <BadReads badReads={activeRound.badReads} />

          {/* The meter sits directly under the round's controls and above the
              skip action, so its docked home on mobile is the end of the game
              proper rather than the end of the card. Scrolling to it undocks
              it (see score-meter.tsx); everything below it is exit, not play. */}
          <ScoreMeter score={activeRound.score} startingScore={startingScore} burned={activeRound.burned} />

          {/* Skipping is the one irreversible thing on this screen, so it is
              toned as the destructive action it is. It used to be a neutral
              button that hovered CYAN, the same tone every safe, encouraged
              action on this page uses, which read as a friendly next step
              rather than "this ends your round and resets your streak". It now
              opens a confirmation instead of firing the skip on click. */}
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <button
              type="button"
              onClick={() => setSkipDialogOpen(true)}
              disabled={guessPending || skipPending}
              aria-busy={skipPending}
              aria-haspopup="dialog"
              aria-expanded={skipDialogOpen}
              aria-describedby="signal-scout-skip-consequence"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-signal-danger/50 bg-signal-danger/10 px-5 py-3 text-sm font-semibold text-signal-danger transition-colors hover:border-signal-danger hover:bg-signal-danger/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-60"
            >
              <OctagonX aria-hidden="true" className="h-4 w-4 shrink-0" />
              {skipPending ? "Skipping..." : "Skip round"}
            </button>
            <span id="signal-scout-skip-consequence" className="text-xs text-ink-subtle">
              Ends the round with no score. Your Signal Streak resets.
            </span>
          </div>
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

      {/* Gated on activeRound as well as its own open flag: without that, a
          round that completes underneath the dialog (a guess landing in
          another tab) would leave a confirmation open for a round that can no
          longer be skipped. */}
      <SkipConfirmDialog
        open={skipDialogOpen && activeRound !== null}
        pending={skipPending}
        onConfirm={() => void handleSkipRound()}
        onClose={() => setSkipDialogOpen(false)}
      />
    </div>
  );
}
