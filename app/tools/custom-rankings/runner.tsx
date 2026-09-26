"use client";

/**
 * Beacon Ranker's comparison screen (plan sections 5.2, 10 and 13.3 to 13.6).
 *
 * THE LOG IS THE STATE. The page holds the answer log and folds it with the
 * same engine the server uses (lib/ranking-boards/builder.ts), so an answer
 * shows at once and the server confirms it behind. Answers are sent strictly
 * in order through one promise chain; if the server refuses one (a second tab,
 * a stale pair, a rate limit) it returns its log and the page resyncs to it.
 *
 * ACCESSIBILITY. Each card is one button named by a full sentence. After an
 * answer focus stays on the same button (the button element is keyed by side,
 * not by player), and a polite live region says what happened AND what the
 * next question is, because a button whose name changes under focus is not
 * re-announced by every screen reader. Number keys 1 and 2 choose, stated in
 * the instructions; arrows are left alone for the screen reader's own use.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Ban, CornerUpLeft, ListOrdered, Save, SkipForward, Target } from "lucide-react";
import { ProgressBar } from "@/components/manager-pulse/progress-bar";
import { RankGapChip } from "@/components/ranking-boards/rank-gap-chip";
import { formatEastern } from "@/lib/datetime";
import {
  foldRun,
  provisionalBoard,
  runProgress,
  validateAnswer,
  type Answer,
} from "@/lib/ranking-boards/builder";
import { announcement, resultLine } from "@/lib/ranking-boards/runner-text";
import type { RunPayload } from "@/lib/ranking-boards/run-payload";
import type { CardPlayer } from "@/lib/ranking-boards/card-text";
import { normalizeTierBreaks } from "@/lib/ranking-boards";
import { answerAction, discardRunAction, finishAction, stopAction, undoAction } from "./actions";
import { ComparisonCard } from "./comparison-card";
import { BoardSoFar } from "./board-so-far";
import { PlaceAtRank } from "./place-at-rank";
import { StreakPrompt } from "./streak-prompt";
import { FinishedSummary, TierPass } from "./finished-summary";
import { GuestCapDialog } from "./guest-cap-dialog";

const toolButton =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-card border border-line px-3 text-sm font-medium text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40";

const UNKNOWN: CardPlayer = {
  playerId: "",
  slug: "",
  name: "Unknown player",
  position: "",
  team: null,
  sleeperId: null,
  age: null,
  finishes: [],
  rookie: false,
};

export function Runner({
  payload,
  onRestart,
  communityHref,
}: {
  payload: RunPayload;
  onRestart: () => void;
  /** The community page for this format, once it is published. */
  communityHref: string | null;
}) {
  const { setup, cards, comparison, ref } = payload;
  const isGuest = ref.kind === "guest";
  const [answers, setAnswers] = useState<Answer[]>(payload.answers);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lifted, setLifted] = useState<1 | 2 | null>(null);
  const [placing, setPlacing] = useState(false);
  const [capDismissed, setCapDismissed] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finished, setFinished] = useState(false);
  const [stopped, setStopped] = useState(false);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const headingId = useId();
  const boardHeadingId = useId();
  const progressTextId = useId();

  const state = useMemo(() => foldRun(setup, answers).state, [setup, answers]);
  const card = useCallback((id: string | null | undefined) => (id ? cards[id] ?? UNKNOWN : UNKNOWN), [cards]);
  const provisional = useMemo(() => provisionalBoard(state), [state]);
  const progress = runProgress(setup, state);
  const result = resultLine(state, cards, comparison);

  const newcomer = state.current ? card(state.current.playerId) : null;
  const opponent = state.opponent ? card(state.opponent) : null;
  const questionOpen = state.phase === "compare" && newcomer !== null && opponent !== null;

  /** Send one server call after the ones before it, resyncing on refusal. */
  const enqueue = useCallback(
    (call: () => Promise<{ ok: true; count?: number } | { ok: false; error: string; answers?: Answer[] }>) => {
      chain.current = chain.current.then(async () => {
        try {
          const r = await call();
          if (!r.ok) {
            setError(r.error);
            if (r.answers) setAnswers(r.answers);
          }
        } catch {
          setError("Could not reach the server. Your last answer may not be saved.");
        }
      });
    },
    [],
  );

  const submit = useCallback(
    (answer: Answer, side: 1 | 2 | null = null) => {
      const pair: [string, string | null] | null =
        state.current ? [state.current.playerId, state.opponent] : state.phase === "tiers" && state.tierPass.gap !== null
          ? [state.board[state.tierPass.gap - 1], state.board[state.tierPass.gap]]
          : null;
      const verdict = validateAnswer(setup, answers, answer, pair);
      if (!verdict.ok) {
        setError(verdict.reason);
        return;
      }
      setError(null);
      const expected = answers.length;
      setAnswers([...answers, answer]);
      setMessage(announcement(verdict.state, cards, comparison));
      if (side) {
        setLifted(side);
        window.setTimeout(() => setLifted(null), 360);
      }
      enqueue(() => answerAction({ ref, expected, answer, pair }));
    },
    [answers, setup, state, cards, comparison, enqueue, ref],
  );

  /** Append work to the chain. A failure is reported and the chain stays
   * alive: a rejected link would silently skip every later answer. */
  const runInChain = useCallback((work: () => Promise<void>) => {
    chain.current = chain.current.then(async () => {
      try {
        await work();
      } catch {
        setError("Could not reach the server. Try again in a moment.");
      }
    });
  }, []);

  const undo = () => {
    if (answers.length === 0) return;
    const expected = answers.length;
    const next = answers.slice(0, -1);
    setAnswers(next);
    setPlacing(false);
    setMessage(`Undone. ${announcement({ ...foldRun(setup, next).state, event: null }, cards, comparison)}`);
    enqueue(() => undoAction({ ref, expected }));
  };

  // Number keys 1 and 2 choose, unless the reader is typing or a dialog is
  // open. WCAG 2.1.4: single-key shortcuts must be switchable off, so there is
  // a visible switch, remembered on this browser only.
  const [keysOn, setKeysOn] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem("ffbeacon.ranker.keys") === "off") setKeysOn(false);
    } catch {
      // Storage can be unavailable (private windows); the default stands.
    }
  }, []);
  const toggleKeys = () => {
    const next = !keysOn;
    setKeysOn(next);
    setMessage(next ? "Number key shortcuts on." : "Number key shortcuts off.");
    try {
      window.localStorage.setItem("ffbeacon.ranker.keys", next ? "on" : "off");
    } catch {
      // Nothing to do: the switch still works for this visit.
    }
  };
  useEffect(() => {
    if (!questionOpen || !keysOn) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable='true']") || target.closest("[role='dialog']"))) {
        return;
      }
      if (event.key === "1") {
        event.preventDefault();
        submit({ a: "keep" }, 1);
      } else if (event.key === "2") {
        event.preventDefault();
        submit({ a: "prefer" }, 2);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [questionOpen, keysOn, submit]);

  // A finished tier pass saves the board.
  const [finishFailed, setFinishFailed] = useState(false);
  const finish = useCallback(() => {
    setFinishing(true);
    setFinishFailed(false);
    runInChain(async () => {
      try {
        const r = await finishAction(ref);
        if (r.ok) {
          setFinished(true);
          setMessage("Your board is saved.");
        } else {
          setError(r.error);
          setFinishFailed(true);
        }
      } catch (err) {
        setFinishFailed(true);
        throw err;
      } finally {
        setFinishing(false);
      }
    });
  }, [ref, runInChain]);
  useEffect(() => {
    if (state.phase === "finished" && !isGuest && !finished && !finishing && !finishFailed) finish();
  }, [state.phase, isGuest, finished, finishing, finishFailed, finish]);

  const stop = () => {
    runInChain(async () => {
      const r = await stopAction(ref);
      if (r.ok) {
        setStopped(true);
        setMessage(
          isGuest
            ? "Saved on this browser. Come back to this page to continue."
            : "Saved. Come back to this page any time to continue at the next question.",
        );
      } else {
        setError(r.error);
      }
    });
  };

  const startOver = () => {
    runInChain(async () => {
      await discardRunAction(ref);
      onRestart();
    });
  };

  const breaks =
    state.phase === "tiers" || state.phase === "finished"
      ? state.tierPass.breaks
      : normalizeTierBreaks(setup.initialBreaks, provisional.length).breaks;
  const boardHref = ref.kind === "board" ? `/my-beacon/rankings/${ref.boardId}` : null;
  const guestCap = setup.cap;
  const showCapDialog = isGuest && state.capReached && !capDismissed;

  const boardList = (
    <BoardSoFar
      board={provisional}
      cards={cards}
      climbing={state.current?.playerId ?? null}
      opponent={state.opponent}
      breaks={breaks}
      comparison={comparison}
    />
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-5">
        {/* The live region is always mounted, so its first message is heard. */}
        <p aria-live="polite" className="sr-only">
          {message}
        </p>

        <div className="space-y-2">
          <p id={progressTextId} className="text-sm font-medium text-ink">
            Player {Math.min(progress.placed + (state.current ? 1 : 0), progress.total)} of {progress.total}
          </p>
          <ProgressBar
            done={progress.placed}
            failed={0}
            total={progress.total}
            ariaLabelledBy={progressTextId}
            valueText={`Player ${Math.min(progress.placed + (state.current ? 1 : 0), progress.total)} of ${progress.total}, ${progress.placed} placed`}
          />
          <p className="text-xs text-ink-subtle">
            {setup.meta.seedNote} {setup.meta.defenderNote ?? ""} {payload.comparisonNote}
          </p>
          {isGuest && payload.guest?.expiresAt && (
            <p className="text-xs text-signal-warning">
              Guest board: deleted {payload.guest.retentionHours} hours after your last change
              (about {formatEastern(payload.guest.expiresAt)} if you stop now). Sign in to keep it.
            </p>
          )}
        </div>

        {(state.phase === "compare" || state.phase === "prompt") && newcomer && opponent && (
          <section aria-labelledby={headingId} className="space-y-4">
            <h2 id={headingId} tabIndex={-1} className="text-xl font-semibold tracking-tight text-ink focus:outline-none">
              Who would you rather have?
            </h2>
            <p className="text-sm text-ink-muted">
              Choose a card{keysOn ? ", or press 1 or 2" : ""}. {newcomer.name} is being placed: choose him to move him
              above {opponent.name}.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <ComparisonCard
                key="side-1"
                player={opponent}
                digit={1}
                lifted={lifted === 1}
                disabled={state.phase !== "compare"}
                onChoose={() => submit({ a: "keep" }, 1)}
              />
              <ComparisonCard
                key="side-2"
                player={newcomer}
                digit={2}
                lifted={lifted === 2}
                disabled={state.phase !== "compare"}
                onChoose={() => submit({ a: "prefer" }, 2)}
              />
            </div>
          </section>
        )}

        {result.text && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
            <span>{result.text.split(". ")[0]}.</span>
            {result.gap && comparison && <RankGapChip gap={result.gap} subject={comparison.subject} />}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-signal-danger">
            {error}
          </p>
        )}
        {finishFailed && !finished && (
          <button type="button" onClick={finish} className={toolButton}>
            Try saving again
          </button>
        )}

        {(state.phase === "compare" || state.phase === "prompt") && (
          <div role="toolbar" aria-label="Question controls" className="flex flex-wrap gap-2">
            <button type="button" onClick={undo} disabled={answers.length === 0} className={toolButton}>
              <CornerUpLeft aria-hidden="true" className="h-4 w-4" />
              Undo
            </button>
            <button
              type="button"
              onClick={() => submit({ a: "skip" })}
              disabled={!questionOpen}
              className={toolButton}
            >
              <SkipForward aria-hidden="true" className="h-4 w-4" />
              Skip
            </button>
            <button
              type="button"
              onClick={() => submit({ a: "leave" })}
              disabled={!state.current}
              className={toolButton}
            >
              <Ban aria-hidden="true" className="h-4 w-4" />
              Leave him off
            </button>
            <button
              type="button"
              onClick={() => setPlacing((v) => !v)}
              aria-expanded={placing}
              disabled={!questionOpen || (state.current?.pos ?? 0) < 1}
              className={toolButton}
            >
              <Target aria-hidden="true" className="h-4 w-4" />
              Put him at...
            </button>
            <button type="button" onClick={stop} className={toolButton}>
              <Save aria-hidden="true" className="h-4 w-4" />
              Save and stop
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={keysOn}
              onClick={toggleKeys}
              className={toolButton}
            >
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 rounded-full ${keysOn ? "bg-brand-cyan" : "bg-line-accent"}`}
              />
              Number key shortcuts
            </button>
          </div>
        )}
        {placing && questionOpen && state.current && newcomer && (
          <div className="rounded-card border border-line bg-surface p-4">
            <PlaceAtRank
              playerName={newcomer.name}
              maxRank={state.current.pos}
              board={state.board.map((id) => card(id).name)}
              onPlace={(rank) => {
                setPlacing(false);
                submit({ a: "place", rank });
              }}
              focusOnMount
            />
          </div>
        )}
        {stopped && (
          <p className="text-sm text-ink-muted">
            Saved.{" "}
            {boardHref && (
              <Link href={boardHref} className="font-medium text-brand-cyan hover:underline">
                Open the board
              </Link>
            )}
          </p>
        )}

        {state.phase === "tiers" && state.tierPass.gap !== null && (
          <TierPass
            gap={state.tierPass.gap}
            upperName={card(state.board[state.tierPass.gap - 1]).name}
            lowerName={card(state.board[state.tierPass.gap]).name}
            lines={state.tierPass.breaks.length}
            onAnswer={(yes) => submit({ a: "tier", yes })}
            onEnd={() => submit({ a: "tiers_done" })}
          />
        )}

        {(state.phase === "done" || state.phase === "finished") && (
          <FinishedSummary
            board={state.board}
            cards={cards}
            answered={state.answered}
            tierCount={state.phase === "finished" ? state.tierPass.breaks.length + 1 : normalizeTierBreaks(setup.initialBreaks, state.board.length).breaks.length + 1}
            comparison={comparison}
            agreementWindow={payload.settings.agreementWindow}
            isGuest={isGuest}
            capReached={state.capReached}
            canKeepGoing={!state.capReached && state.remainingFirstPass > 0}
            keepGoingStep={payload.settings.keepGoingStep}
            tiersAllowed={setup.meta.tiersAllowed}
            boardHref={boardHref}
            communityHref={communityHref}
            onKeepGoing={() => {
              if (isGuest && guestCap !== null && state.board.length >= guestCap) {
                setCapDismissed(false);
                return;
              }
              submit({ a: "extend", by: payload.settings.keepGoingStep });
            }}
            onDrawTiers={() => submit({ a: "tiers" })}
            onDone={() => (state.phase === "done" ? submit({ a: "tiers_done" }) : finish())}
            finishing={finishing}
            finished={finished}
          />
        )}

        <button
          type="button"
          onClick={startOver}
          className="text-sm font-medium text-ink-subtle underline-offset-2 hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {isGuest ? "Start over (deletes this guest board)" : "Start a different run"}
        </button>

        {/* Below xl the board is a disclosure under the cards. */}
        <details className="rounded-card border border-line bg-surface p-4 xl:hidden">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
            <ListOrdered aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
            View the board so far, {provisional.length} player{provisional.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-3">{boardList}</div>
        </details>
      </div>

      {/* From xl up it is a rail beside the question. */}
      <aside aria-labelledby={`${boardHeadingId}-rail`} className="hidden xl:block">
        <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-modal border border-line bg-surface p-4">
          <h2 id={`${boardHeadingId}-rail`} className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-ink-subtle">
            Board so far, {provisional.length} player{provisional.length === 1 ? "" : "s"}
          </h2>
          {boardList}
        </div>
      </aside>

      <StreakPrompt
        open={state.phase === "prompt"}
        player={newcomer}
        streak={state.current?.streak ?? 0}
        maxRank={state.current?.pos ?? 1}
        boardNames={state.board.map((id) => card(id).name)}
        onPlace={(rank) => submit({ a: "place", rank })}
        onContinue={() => submit({ a: "continue" })}
      />

      {isGuest && guestCap !== null && (
        <GuestCapDialog
          open={showCapDialog}
          cap={guestCap}
          maxDepth={payload.settings.maxDepth}
          retentionHours={payload.guest?.retentionHours ?? 48}
          onClose={() => setCapDismissed(true)}
        />
      )}
    </div>
  );
}
