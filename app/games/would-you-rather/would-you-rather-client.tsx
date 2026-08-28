"use client";

/**
 * The game.
 *
 * A small state machine over one round at a time: `board` while the reader is
 * deciding, `revealed` once the vote is in, plus the terminal states (the
 * sign-in wall, an empty pool, the game switched off, a failure).
 *
 * WHERE THE ANSWER LIVES. The board this component is handed carries no values
 * and no verdict, and nothing fetches them. The reveal arrives in the RESPONSE
 * to the vote, which is the only request that can produce it, and only after
 * the vote row exists. So there is no moment, and no network call, at which a
 * reader could have the answer and not have voted.
 *
 * ONE LIVE REGION, ABOVE EVERY BRANCH. Every phase change writes one sentence
 * into it, including the ones that replace the whole screen. It has to sit
 * outside the phase switch: a terminal state that returned early would unmount
 * the region in the same commit that queued a message into it, and the message
 * would simply be discarded.
 *
 * FOCUS LANDS ON A HEADING YOU CAN SEE. Pressing a vote button destroys the
 * control that had focus, so focus is moved deliberately. It goes to the real
 * heading of whichever panel is now the answer, using Panel's `headingFocusable`
 * so the heading carries a visible focus ring. An sr-only anchor was the first
 * attempt and was wrong twice over: a sighted keyboard user got an outline on a
 * clipped one-pixel box, and a heading list gained a duplicate of the visible
 * title beside it.
 *
 * FOCUS AND THE LIVE REGION DO NOT BOTH SAY THE SAME THING. Moving focus to a
 * heading announces that heading, so the outcome sentence goes to the live
 * region and the heading stays short. Putting the sentence in both made screen
 * readers read the whole result twice.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Gauge,
  Loader2,
  PowerOff,
  RefreshCw,
  Vote,
} from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import { fetchNextRound, submitVote } from "@/lib/would-you-rather/client";
import type {
  WyrErrorCode,
  WyrReview,
  WyrRound,
  WyrSide,
} from "@/lib/would-you-rather/types";
import { TradeBoard, SIDE_LABEL } from "./trade-board";
import { VoteResults } from "./vote-results";
import { VerdictPanel } from "./verdict-panel";
import { DeepRead } from "./deep-read";
import { SignInGate } from "./sign-in-gate";

type Phase = "loading" | "board" | "revealed" | "gate" | "empty" | "off" | "failed";

/** Panel ids. Panel publishes its heading as `${id}-title`, which is what focus moves to. */
const BOARD_PANEL = "wyr-board";
const RESULTS_PANEL = "wyr-results";
const VERDICT_PANEL = "wyr-verdict";
const CONTEXT_PANEL = "wyr-context";
const GATE_PANEL = "wyr-gate";
const OFF_PANEL = "wyr-off";
const EMPTY_PANEL = "wyr-empty";

export interface WouldYouRatherClientProps {
  /**
   * The first round, resolved on the server so the page paints a playable
   * board rather than a spinner. Null when the server could not produce one,
   * in which case `initialError` says why.
   */
  initialRound: WyrRound | null;
  initialError: WyrErrorCode | null;
  /** Free votes left, or null for a signed-in reader (no limit applies). */
  initialGuestVotesRemaining: number | null;
  /** How many votes this guest has already spent, for the wall's copy. */
  guestVotesUsed: number;
  isAuthenticated: boolean;
}

export function WouldYouRatherClient({
  initialRound,
  initialError,
  initialGuestVotesRemaining,
  guestVotesUsed,
  isAuthenticated,
}: WouldYouRatherClientProps) {
  const [round, setRound] = useState<WyrRound | null>(initialRound);
  const [review, setReview] = useState<WyrReview | null>(null);
  const [phase, setPhase] = useState<Phase>(() => initialPhase(initialRound, initialError));
  const [pendingSide, setPendingSide] = useState<WyrSide | null>(null);
  const [loadingNext, setLoadingNext] = useState(false);
  const [failed, setFailed] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(initialGuestVotesRemaining);
  const [used, setUsed] = useState(guestVotesUsed);
  const [announcement, setAnnouncement] = useState("");

  /**
   * The last value of `remaining`, readable from a callback with empty deps.
   * A captured `remaining` would be the value at mount forever, which would
   * reset a guest's allowance strip to its opening number the first time a
   * response omitted the count.
   */
  const remainingRef = useRef(initialGuestVotesRemaining);
  useEffect(() => {
    remainingRef.current = remaining;
  }, [remaining]);

  /** The panel heading focus should move to once React has painted it. */
  const focusPanel = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const id = focusPanel.current;
    if (!id) return;
    focusPanel.current = null;
    // Panel renders its heading as `${id}-title` with tabIndex -1 when
    // headingFocusable is set. Read from the DOM rather than a ref because the
    // heading belongs to Panel, which does not forward one.
    document.getElementById(`${id}-title`)?.focus();
  });

  useEffect(() => () => abortRef.current?.abort(), []);

  /**
   * Turn a failure into a phase, a sentence, and somewhere for focus to land.
   *
   * Every branch announces. A reader who cannot see the screen change has no
   * other way to learn that the thing they pressed did not work, and the
   * control they pressed has usually been unmounted by the time they would
   * have found out.
   */
  const applyError = useCallback((code: WyrErrorCode) => {
    switch (code) {
      case "guest_limit_reached":
      case "guest_play_disabled":
        setPhase("gate");
        setFailed(false);
        setAnnouncement("That was your last free vote. Sign in to keep playing.");
        focusPanel.current = GATE_PANEL;
        return;
      case "game_disabled":
        setPhase("off");
        setFailed(false);
        setAnnouncement("Would You Rather is paused right now.");
        focusPanel.current = OFF_PANEL;
        return;
      case "pool_empty":
        setPhase("empty");
        setFailed(false);
        setAnnouncement("There is no new trade to show you right now.");
        focusPanel.current = EMPTY_PANEL;
        return;
      case "rate_limited":
        setFailed(true);
        setPhase("failed");
        setAnnouncement("That was too quick. Wait a moment and try again.");
        return;
      default:
        setFailed(true);
        setPhase("failed");
        setAnnouncement("That did not go through. Nothing was recorded.");
    }
  }, []);

  const loadNext = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingNext(true);
    setFailed(false);
    try {
      const result = await fetchNextRound(controller.signal);
      if (result.ok) {
        setRound(result.round);
        setReview(null);
        setRemaining(result.guestVotesRemaining);
        setPhase("board");
        setAnnouncement("New trade loaded. Read both sides, then pick a winner.");
        focusPanel.current = BOARD_PANEL;
      } else {
        setRemaining(result.guestVotesRemaining ?? remainingRef.current);
        applyError(result.error);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      applyError("server_error");
    } finally {
      setLoadingNext(false);
    }
  }, [applyError]);

  const onVote = useCallback(
    async (side: WyrSide) => {
      if (!round || pendingSide) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setPendingSide(side);
      setFailed(false);
      try {
        const result = await submitVote(round.tradeId, side, controller.signal);
        if (result.ok) {
          setReview(result.review);
          setRemaining(result.guestVotesRemaining);
          if (!result.review.alreadyVoted) setUsed((n) => n + 1);
          setPhase("revealed");
          setAnnouncement(outcomeSentence(result.review));
          focusPanel.current = firstRevealPanel(result.review);
        } else {
          setRemaining(result.guestVotesRemaining ?? remainingRef.current);
          applyError(result.error);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        applyError("server_error");
      } finally {
        setPendingSide(null);
      }
    },
    [round, pendingSide, applyError],
  );

  const showBoard = round !== null && phase !== "gate" && phase !== "off";

  return (
    <div className="space-y-6">
      {/*
        The one live region, outside every branch below, so a terminal state
        cannot unmount it in the same commit that writes into it.
      */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {remaining !== null && phase !== "gate" && phase !== "off" && (
        <GuestAllowance remaining={remaining} />
      )}

      {phase === "off" && (
        <Panel
          id={OFF_PANEL}
          headingFocusable
          eyebrow="Would You Rather"
          title="The game is paused"
        >
          <p className="text-sm leading-relaxed text-ink-muted">
            Would You Rather is switched off right now. Everything else on the
            site is unaffected, and the game will be back.
          </p>
          <Link
            href="/games"
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <PowerOff aria-hidden="true" className="h-4 w-4" />
            See the other games
          </Link>
        </Panel>
      )}

      {phase === "gate" && (
        <Panel
          id={GATE_PANEL}
          headingFocusable
          eyebrow="Would You Rather"
          title="Sign in to keep playing"
          bodyClassName="p-0"
        >
          <SignInGate votesUsed={used} />
        </Panel>
      )}

      {showBoard && round && (
        <Panel
          id={BOARD_PANEL}
          headingFocusable
          eyebrow={
            round.kind === "startup" ? "Startup draft trade" : "Real trade, real league"
          }
          title="Which side wins this trade?"
          helper={
            phase === "revealed"
              ? "Your call is locked in. The full read is below."
              : "Two managers agreed to this. You decide who came out ahead."
          }
          glow
        >
          <TradeBoard
            round={round}
            votedSide={review?.yourSide ?? null}
            pending={pendingSide}
            onVote={onVote}
            headingId={`${BOARD_PANEL}-title`}
          />
        </Panel>
      )}

      {failed && phase === "failed" && (
        <FailureNote onRetry={loadNext} retrying={loadingNext} />
      )}

      {phase === "empty" && (
        <Panel
          id={EMPTY_PANEL}
          headingFocusable
          eyebrow="Would You Rather"
          title="Nothing new to call right now"
        >
          {/*
            Says what the selector actually knows. It SAMPLES the pool rather
            than exhaustively searching it, so "you have voted on every trade we
            have" would be a claim it cannot make: a sample that happened to come
            back fully voted looks identical to a genuinely exhausted pool.
          */}
          <p className="text-sm leading-relaxed text-ink-muted">
            We could not find a trade you have not already called. Try again in a
            moment, or come back later: more arrive as leagues sync new deals.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={loadNext}
              disabled={loadingNext}
              className="inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingNext ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
              )}
              Try again
            </button>
            <Link
              href="/games"
              className="inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
              The other games
            </Link>
          </div>
        </Panel>
      )}

      {phase === "revealed" && review && round && (
        // Each block rises in slightly after the one above it, so the reveal
        // reads as an answer arriving rather than three panels appearing at
        // once. Keyed on the trade so the next round animates in too rather
        // than swapping content inside a settled element. The stagger is inline
        // because a nth-child rule would break the moment an admin switches one
        // of these panels off. See .wyr-reveal in globals.css: it is dropped
        // entirely under prefers-reduced-motion.
        <div key={round.tradeId} className="space-y-6">
          {review.tally.total > 0 && (
            <div className="wyr-reveal">
              <Panel
                id={RESULTS_PANEL}
                headingFocusable
                eyebrow="The room"
                title="How everyone else called it"
              >
                <VoteResults
                  tally={review.tally}
                  yourSide={review.yourSide}
                  crowdVsModel={review.crowdVsModel}
                />
              </Panel>
            </div>
          )}

          {review.verdict && (
            <div className="wyr-reveal" style={{ animationDelay: "140ms" }}>
              <Panel
                id={VERDICT_PANEL}
                headingFocusable
                eyebrow="Signal Check"
                title="What the numbers say"
                helper="The same grade you would get typing this trade into Signal Check, in this league's own format."
              >
                <VerdictPanel
                  view={review.verdict}
                  yourSide={review.yourSide}
                  assetsBySide={round.sides}
                  notes={review.notes}
                />
              </Panel>
            </div>
          )}

          <div className="wyr-reveal" style={{ animationDelay: "280ms" }}>
            <Panel
              id={CONTEXT_PANEL}
              headingFocusable
              eyebrow="League context"
              title="What this league knows about the pieces"
              helper="Positional WAR, projections and value movement, read from the league the trade actually happened in."
            >
              <DeepRead review={review} assetsBySide={round.sides} />
            </Panel>
          </div>

          <div className="flex justify-center">
            <button
              type="button"
              onClick={loadNext}
              disabled={loadingNext}
              className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-card bg-beacon px-6 text-base font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {loadingNext ? (
                <>
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  Finding the next trade
                </>
              ) : (
                <>
                  <Vote aria-hidden="true" className="h-4 w-4" />
                  Next trade
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {phase === "loading" && !round && (
        <Panel eyebrow="Would You Rather" title="Finding a trade">
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            Pulling a real trade out of a synced league.
          </p>
        </Panel>
      )}

      {!isAuthenticated && phase === "revealed" && (
        <p className="text-center text-xs leading-relaxed text-ink-subtle">
          Playing as a guest.{" "}
          <Link
            href="/login?next=%2Fgames%2Fwould-you-rather"
            className="font-medium text-brand-cyan underline underline-offset-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Sign in
          </Link>{" "}
          to keep your record and play without a limit.
        </p>
      )}
    </div>
  );
}

/* ---------- Small pieces ---------- */

function initialPhase(round: WyrRound | null, error: WyrErrorCode | null): Phase {
  if (error === "guest_limit_reached" || error === "guest_play_disabled") return "gate";
  if (error === "game_disabled") return "off";
  if (error === "pool_empty") return "empty";
  if (error) return "failed";
  return round ? "board" : "loading";
}

/**
 * Which reveal panel focus should land on.
 *
 * Whichever one renders first, which depends on the admin's reveal toggles and
 * on whether there are any votes yet. The league context panel is the only one
 * that always renders, so it is the floor. Focusing a panel that is not on
 * screen would leave a keyboard user stranded at the top of the document.
 */
function firstRevealPanel(review: WyrReview): string {
  if (review.tally.total > 0) return RESULTS_PANEL;
  if (review.verdict) return VERDICT_PANEL;
  return CONTEXT_PANEL;
}

/**
 * One sentence a screen reader hears the moment a vote lands.
 *
 * Every clause is gated on the figure it cites. With the community graph
 * switched off the tally arrives zeroed, and an ungated version claimed "you
 * are the first vote on this trade", which is a statement about the world
 * rather than about a display setting, and was regularly false.
 */
function outcomeSentence(review: WyrReview): string {
  const mine = SIDE_LABEL[review.yourSide];
  const { tally } = review;

  let crowd = "";
  if (tally.total === 1) {
    crowd = " You are the first vote on this trade.";
  } else if (tally.total > 1) {
    const share = review.yourSide === "a" ? tally.pctA : tally.pctB;
    crowd = ` ${share} percent of ${tally.total.toLocaleString()} votes agree with you.`;
  }

  const model = review.verdict
    ? review.verdict.isNeutral
      ? ` Signal Check calls it close, at ${review.verdict.marginPct} percent apart.`
      : review.verdict.winnerSide === review.yourSide
        ? ` Signal Check agrees, by ${review.verdict.marginPct} percent on value.`
        : ` Signal Check disagrees, and has the other side ahead by ${review.verdict.marginPct} percent on value.`
    : "";

  return `You picked ${mine}.${crowd}${model}`;
}

/** How many free rounds a guest has left. Shown from the first round, not sprung. */
function GuestAllowance({ remaining }: { remaining: number }) {
  return (
    <p className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-base/40 px-3.5 py-2.5 text-xs text-ink-muted">
      <Gauge aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-cyan" />
      <span>
        {remaining === 0
          ? "You have used your free votes."
          : `${remaining} free vote${remaining === 1 ? "" : "s"} left before you need an account.`}
      </span>
      <Link
        href="/login?next=%2Fgames%2Fwould-you-rather"
        className="font-medium text-brand-cyan underline underline-offset-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        Sign in
      </Link>
    </p>
  );
}

/**
 * A failed request.
 *
 * role="alert" as well as the live region above, because this one appears
 * without focus moving anywhere: the button that was pressed re-enables in
 * place, and a reader who cannot see the strip appear needs to be told.
 */
function FailureNote({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div
      role="alert"
      className="rounded-card border border-signal-warning/40 bg-signal-warning/10 p-4"
    >
      <p className="flex items-start gap-2 text-sm leading-relaxed text-ink">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-signal-warning" />
        <span>
          That did not go through, and nothing was recorded. Trying again costs
          you nothing.
        </span>
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-60"
      >
        {retrying ? (
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
        )}
        Try another trade
      </button>
    </div>
  );
}
