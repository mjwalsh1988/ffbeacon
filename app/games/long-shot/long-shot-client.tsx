"use client";

/**
 * The Long Shot game (plan 5, 8.3, 18 and 18A). Owns the state machine (idle,
 * resume, prompt, result, completed, paused), calls the routes through
 * lib/long-shot/client.ts, owns the state live region, and moves focus to the
 * one target each state has: the prompt heading, the result heading or the
 * completion heading.
 *
 * Live regions: exactly one speaks on any event. Prompt load and the two
 * countdown marks belong to the countdown's timer region; results,
 * completion, errors, resume and paused belong to the state region here,
 * which is silent on prompt load.
 *
 * During an attempt the stage is the only thing below the hero. The boards,
 * the record and Yesterday render under it when idle or complete.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Stage } from "@/components/long-shot/stage";
import type { SearchPlayerResult } from "@/components/player-guess-combobox";
import { trackEvent } from "@/lib/analytics";
import {
  CLIENT_ERROR_COPY,
  GENERIC_ERROR_COPY,
  endPractice,
  fetchState,
  nextPrompt,
  startAttempt,
  submitAnswer,
  type ApiResult,
  type StartOrNext,
} from "@/lib/long-shot/client";
import type { LeaderboardView } from "@/lib/long-shot/leaderboards";
import type { AttemptDto, CompletedDto, Mode, PageStateDto, PromptDto, ResultDto } from "@/lib/long-shot/types";
import { CompletionPanel } from "./completion-panel";
import { LeaderboardPanel } from "./leaderboard-panel";
import { ModePicker } from "./mode-picker";
import { MyRecordPanel } from "./my-record-panel";
import { PromptCard } from "./prompt-card";
import { ResultPanel } from "./result-panel";
import { resultSentence } from "./result-text";
import { YesterdayPanel } from "./yesterday-panel";

type View =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "resume"; attempt: AttemptDto }
  | { kind: "prompt"; prompt: PromptDto }
  | { kind: "result"; prompt: PromptDto; result: ResultDto }
  | { kind: "completed"; completed: CompletedDto }
  | { kind: "paused" };

export function viewFromState(state: PageStateDto): View {
  if (state.active) return state.active.hasPending ? { kind: "loading" } : { kind: "resume", attempt: state.active };
  if (state.hurryUpToday?.status === "completed" && state.todayCompleted) {
    return { kind: "completed", completed: state.todayCompleted };
  }
  return { kind: "idle" };
}

function copyFor(code: string): string {
  return CLIENT_ERROR_COPY[code as keyof typeof CLIENT_ERROR_COPY] ?? GENERIC_ERROR_COPY;
}

export function LongShotClient({
  initialState,
  timerSeconds,
  filmRoomEnabled,
  leaderboardsEnabled,
  initialBoardView,
  extra,
}: {
  initialState: PageStateDto;
  timerSeconds: number;
  filmRoomEnabled: boolean;
  leaderboardsEnabled: boolean;
  initialBoardView: LeaderboardView | null;
  /** Server-rendered panels for the right column under the stage (How it works). */
  extra?: ReactNode;
}) {
  const [state, setState] = useState<PageStateDto>(initialState);
  const [view, setView] = useState<View>(() => viewFromState(initialState));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [boardsKey, setBoardsKey] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // One answer in flight at a time. The clock reaching zero while an Answer
  // request is still out would otherwise send a timeout for the same prompt,
  // get stale_prompt back and serve the next prompt over the reveal.
  const answering = useRef(false);
  // Set when the clock ran out while an Answer was in flight (that timeout
  // was dropped). If the Answer then fails there is no clock left to run, so
  // the error gets the reload sentence rather than "your clock is still
  // running". Cleared whenever a new prompt arrives.
  const clockOut = useRef(false);
  // Seeded with the first state's key, so a fresh load of a finished day does
  // not pull focus past the skip link; only a change of state moves focus.
  const lastFocused = useRef<string>(
    initialState.hurryUpToday?.status === "completed" && initialState.todayCompleted && !initialState.active
      ? `c-${initialState.todayCompleted.attempt.attemptId}`
      : "",
  );

  const announce = useCallback((text: string) => {
    // Clearing first makes a repeated sentence speak again.
    setAnnouncement("");
    requestAnimationFrame(() => setAnnouncement(text));
  }, []);

  // One focus target per state, moved once per state change.
  useEffect(() => {
    const key =
      view.kind === "prompt"
        ? `p-${view.prompt.attemptId}-${view.prompt.position}`
        : view.kind === "result"
          ? `r-${view.result.position}`
          : view.kind === "completed"
            ? `c-${view.completed.attempt.attemptId}`
            : "";
    if (!key || key === lastFocused.current) return;
    lastFocused.current = key;
    headingRef.current?.focus();
  }, [view]);

  const reloadState = useCallback(async (): Promise<PageStateDto | null> => {
    const res = await fetchState();
    if (!res.ok) {
      if (res.code === "game_disabled") setView({ kind: "paused" });
      return null;
    }
    setState(res.data);
    return res.data;
  }, []);

  const applyStartOrNext = useCallback(
    async (data: StartOrNext) => {
      if (data.kind === "prompt") {
        clockOut.current = false;
        setView({ kind: "prompt", prompt: data });
      } else if (data.kind === "completed") {
        setView({ kind: "completed", completed: data });
        announce(`Day complete. ${data.attempt.basePoints} points.`);
      } else {
        const s = await reloadState();
        if (s) setView(viewFromState(s));
      }
    },
    [announce, reloadState],
  );

  const handleCommonError = useCallback(
    async (res: Extract<ApiResult<unknown>, { ok: false }>): Promise<boolean> => {
      if (res.code === "game_disabled") {
        setView({ kind: "paused" });
        announce(copyFor("game_disabled"));
        return true;
      }
      if (res.code === "attempt_closed") {
        const msg = copyFor("attempt_closed");
        setError(msg);
        announce(msg);
        const s = await reloadState();
        if (s) setView(viewFromState(s));
        return true;
      }
      return false;
    },
    [announce, reloadState],
  );

  const goNext = useCallback(
    async (attemptId: string) => {
      setBusy(true);
      setError(null);
      const res = await nextPrompt(attemptId);
      setBusy(false);
      if (res.ok) {
        await applyStartOrNext(res.data);
        return;
      }
      if (await handleCommonError(res)) return;
      const msg = copyFor(res.code === "network" ? "server_error" : res.code);
      setError(msg);
      announce(msg);
    },
    [announce, applyStartOrNext, handleCommonError],
  );

  // A resumed attempt whose prompt is already on the clock is fetched at once.
  useEffect(() => {
    if (view.kind === "loading" && state.active) {
      // No state announcement: the prompt loads at once and the timer region
      // speaks for it, and only one region may speak per event.
      void goNext(state.active.attemptId);
    }
    // Only on entering the loading state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.kind]);

  async function start(mode: Mode) {
    setBusy(true);
    setError(null);
    trackEvent("long_shot_start", { mode });
    const res = await startAttempt(mode);
    setBusy(false);
    if (res.ok) {
      await applyStartOrNext(res.data);
      return;
    }
    if (await handleCommonError(res)) return;
    if (res.code === "attempt_active" || res.code === "film_room_disabled") {
      const s = await reloadState();
      if (s) setView(viewFromState(s));
      return;
    }
    const msg = copyFor(res.code === "network" ? "server_error" : res.code);
    setError(msg);
    announce(msg);
  }

  async function answer(prompt: PromptDto, body: { playerId: string | null; timedOut: boolean; skipped: boolean }) {
    if (answering.current) {
      if (body.timedOut) clockOut.current = true;
      return;
    }
    answering.current = true;
    try {
      await answerInner(prompt, body);
    } finally {
      answering.current = false;
    }
  }

  async function answerInner(prompt: PromptDto, body: { playerId: string | null; timedOut: boolean; skipped: boolean }) {
    setBusy(true);
    setError(null);
    const payload = { position: prompt.position, ...body };
    let res = await submitAnswer(prompt.attemptId, payload);
    let retried = false;
    if (!res.ok && res.code === "network") {
      retried = true;
      res = await submitAnswer(prompt.attemptId, payload);
    }
    setBusy(false);
    if (res.ok) {
      const result = res.data;
      setView({ kind: "result", prompt, result });
      announce(resultSentence(result));
      if (result.next.kind === "completed") {
        trackEvent("long_shot_complete", { mode: prompt.mode, points: result.next.attempt.basePoints });
      }
      return;
    }
    if (await handleCommonError(res)) return;
    if (res.code === "stale_prompt") {
      if (retried) {
        // The first send landed. Reload rather than serve the next prompt, so
        // its clock never starts without the player pressing Continue.
        const s = await reloadState();
        if (s) setView(viewFromState(s));
        return;
      }
      await goNext(prompt.attemptId);
      return;
    }
    // A failed timeout has no Answer to press again (the clock is at zero and
    // nothing is chosen), so it gets the reload sentence; reloading serves the
    // next prompt and the server records the timeout itself.
    const msg =
      !body.timedOut && !clockOut.current && (res.code === "rate_limited" || res.code === "network")
        ? copyFor(res.code)
        : GENERIC_ERROR_COPY;
    setError(msg);
    announce(msg);
  }

  async function afterResult(prompt: PromptDto, result: ResultDto) {
    if (result.next.kind === "completed") {
      const completed = result.next;
      setView({ kind: "completed", completed });
      announce(`Day complete. ${completed.attempt.basePoints} points.`);
      if (completed.attempt.mode === "hurry_up") {
        await reloadState();
        setBoardsKey((k) => k + 1);
      }
      return;
    }
    await goNext(prompt.attemptId);
  }

  async function endFilm(attemptId: string) {
    setBusy(true);
    const res = await endPractice(attemptId);
    setBusy(false);
    if (res.ok) {
      setState(res.data);
      setView(viewFromState(res.data));
      return;
    }
    if (await handleCommonError(res)) return;
    setError(GENERIC_ERROR_COPY);
    announce(GENERIC_ERROR_COPY);
  }

  const midAttempt = view.kind === "prompt" || view.kind === "result" || view.kind === "loading";
  const hurryToday = state.hurryUpToday;
  const hurryOver = hurryToday?.status === "completed" || hurryToday?.status === "abandoned";

  let main: ReactNode;
  if (view.kind === "paused") {
    main = <p className="text-lg text-ink">Long Shot is paused. Check back soon.</p>;
  } else if (view.kind === "loading") {
    main = <p className="text-base text-ink-muted">Loading your prompt.</p>;
  } else if (view.kind === "prompt") {
    const p = view.prompt;
    main = (
      <PromptCard
        key={`${p.attemptId}-${p.position}`}
        ref={headingRef}
        prompt={p}
        today={state.gameDate}
        limitSeconds={timerSeconds}
        busy={busy}
        error={error}
        onAnswer={(player: SearchPlayerResult) => answer(p, { playerId: player.id, timedOut: false, skipped: false })}
        onTimeout={() => answer(p, { playerId: null, timedOut: true, skipped: false })}
        onSkip={() => answer(p, { playerId: null, timedOut: false, skipped: true })}
        onEnd={() => endFilm(p.attemptId)}
      />
    );
  } else if (view.kind === "result") {
    main = (
      <ResultPanel
        ref={headingRef}
        prompt={view.prompt}
        result={view.result}
        busy={busy}
        onNext={() => afterResult(view.prompt, view.result)}
      />
    );
  } else if (view.kind === "completed") {
    main = (
      <CompletionPanel
        ref={headingRef}
        completed={view.completed}
        filmRoomEnabled={filmRoomEnabled}
        busy={busy}
        onFilmRoom={() => start("film_room")}
        onBack={() => setView(viewFromState({ ...state, active: null }))}
      />
    );
  } else if (view.kind === "resume") {
    const a = view.attempt;
    main = (
      <div>
        <h2 className="text-2xl font-bold text-ink">
          {a.mode === "hurry_up" ? "Your Hurry-Up is in progress" : "Your Film Room is in progress"}
        </h2>
        <p className="mt-3 text-base text-ink-muted">
          Prompt {a.currentPosition} of {a.promptCount}, {a.basePoints} points so far.
          {a.mode === "hurry_up" ? " The next prompt's clock starts when you continue." : ""}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => goNext(a.attemptId)}
          className="mt-5 inline-flex h-12 items-center justify-center rounded-card bg-brand-cyan px-6 text-base font-bold text-[#07070D] hover:bg-brand-cyan-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
        >
          Continue
        </button>
        {error && <p className="mt-3 text-sm text-signal-danger">{error}</p>}
      </div>
    );
  } else {
    main = (
      <div>
        <h2 className="text-2xl font-bold text-ink">
          {hurryToday?.status === "abandoned" ? "Today's Hurry-Up is closed" : "Play today's five"}
        </h2>
        {hurryToday?.status === "abandoned" && (
          <p className="mt-3 text-base text-ink-muted">
            Your Hurry-Up for today was closed unfinished. You scored {hurryToday.basePoints} on{" "}
            {hurryToday.answers.filter((a) => a.state === "answered").length} answered prompts. Tomorrow&apos;s
            puzzle is a fresh start.
          </p>
        )}
        <div className="mt-5">
          <ModePicker
            timerSeconds={timerSeconds}
            filmRoomEnabled={filmRoomEnabled}
            puzzleReady={state.puzzle !== null}
            busy={busy}
            hideHurryUp={hurryOver}
            onPick={start}
          />
        </div>
        {error && <p className="mt-3 text-sm text-signal-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <Stage>{main}</Stage>
      {!midAttempt && view.kind !== "paused" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            {leaderboardsEnabled ? (
              <LeaderboardPanel key={boardsKey} initialView={boardsKey === 0 ? initialBoardView : null} refresh={boardsKey > 0} />
            ) : (
              <section aria-labelledby="ls-boards-paused" className="rounded-[20px] border border-line bg-surface p-5 sm:p-6">
                <h2 id="ls-boards-paused" className="text-lg font-bold text-ink">
                  Boards
                </h2>
                <p className="mt-3 text-sm text-ink-muted">Boards are paused.</p>
              </section>
            )}
          </div>
          <div className="space-y-6">
            <MyRecordPanel stats={state.stats} />
            {state.yesterday && <YesterdayPanel yesterday={state.yesterday} />}
            {extra}
          </div>
        </div>
      )}
    </div>
  );
}
