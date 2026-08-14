"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowUp, RotateCcw } from "lucide-react";
import { BeamAvatar } from "@/components/beam/beam-mark";
import type {
  BeamClarifyOption,
  BeamMatchedPlayer,
  BeamOutcome,
} from "@/lib/beam/types";
import { BeamAnswerCard } from "./beam-answer-card";
import { BeamClarify } from "./beam-clarify";
import { BeamUnsupported } from "./beam-unsupported";
import { BeamLearnForm } from "./beam-learn-form";

/**
 * Ask BEAM: the conversation.
 *
 * Lives inside the slide-in panel (components/beam/beam-panel.tsx), so it owns
 * the scrolling transcript and the composer pinned under it, and nothing else.
 *
 * ANNOUNCEMENT IS SEPARATE FROM THE TRANSCRIPT, and that is the single most
 * important decision in this file. Wrapping the transcript itself in aria-live
 * would announce every card in full, in visual order, including a fact grid that
 * reads as a stream of disconnected words. Instead the transcript is ordinary
 * markup a screen reader user browses normally, and one visually-hidden live
 * region carries the `speech` string the presenter built for exactly this
 * purpose: one sentence, then the facts as prose, then the caveats.
 *
 * Polite, never assertive: an answer arriving should not interrupt someone
 * mid-sentence.
 *
 * FOCUS. After an answer, focus stays in the textarea so a follow-up needs no
 * tabbing. After a clarification, BeamClarify moves focus to the first choice,
 * because the reader was just asked a question and the answer to it should be
 * under their hands.
 */

type Turn = {
  id: number;
  question: string;
  outcome: BeamOutcome | null;
  /** True while the request is in flight. */
  pending: boolean;
  error: string | null;
};

const MAX_LENGTH = 300;
/** Composer height ceiling, about five lines, before it scrolls instead. */
const COMPOSER_MAX_PX = 132;

export function BeamChat({ starters }: { starters: string[] }) {
  const inputId = useId();
  const helpId = useId();
  const countId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const turnCounter = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  // The Help BEAM learn this button, so closing the form puts focus back on it
  // rather than dropping it to the document body.
  const learnCtaRef = useRef<HTMLButtonElement>(null);

  const [value, setValue] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [learnFor, setLearnFor] = useState<number | null>(null);

  useEffect(() => {
    return () => inFlight.current?.abort();
  }, []);

  // Keep the newest turn in view, the way every chat surface does. This moves
  // the scroll container, never focus, so a screen reader user reading back
  // through the transcript is not yanked anywhere.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || turns.length === 0) return;
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: reduced ? "auto" : "smooth",
    });
  }, [turns]);

  // Auto-grow the composer up to a ceiling, then let it scroll. The offsetParent
  // check skips this while the panel is primed but still hidden: scrollHeight is
  // 0 inside a display:none subtree, and writing that back would pin the box to
  // its min-height until the first keystroke.
  useEffect(() => {
    const el = inputRef.current;
    if (!el || el.offsetParent === null) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_PX)}px`;
  }, [value]);

  const submit = useCallback(
    async (question: string) => {
      const trimmed = question.trim().slice(0, MAX_LENGTH);
      if (!trimmed || busy) return;

      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      turnCounter.current += 1;
      const id = turnCounter.current;
      setTurns((prev) => [
        ...prev,
        { id, question: trimmed, outcome: null, pending: true, error: null },
      ]);
      setValue("");
      setBusy(true);
      setLearnFor(null);
      setAnnouncement("BEAM is looking that up.");

      try {
        const res = await fetch("/api/beam/ask", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-requested-with": "ff-beacon",
          },
          body: JSON.stringify({ question: trimmed }),
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => ({}))) as {
          outcome?: BeamOutcome;
          error?: string;
        };

        if (!res.ok || !data.outcome) {
          const message =
            data.error ??
            "BEAM is unavailable right now. Try again in a moment.";
          setTurns((prev) =>
            prev.map((t) =>
              t.id === id ? { ...t, pending: false, error: message } : t,
            ),
          );
          setAnnouncement(message);
          return;
        }

        const outcome = data.outcome;
        setTurns((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, pending: false, outcome } : t,
          ),
        );
        setAnnouncement(announcementFor(outcome));
      } catch {
        if (controller.signal.aborted) return;
        const message =
          "We could not reach BEAM. Check your connection and try again.";
        setTurns((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, pending: false, error: message } : t,
          ),
        );
        setAnnouncement(message);
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    },
    [busy],
  );

  /**
   * Answering a clarification re-asks the WHOLE question with the ambiguous span
   * replaced, rather than starting a fresh one. Someone who typed nine words
   * should not lose eight of them to pick a name from a list.
   */
  const answerClarification = useCallback(
    (
      template: string,
      kind: "player" | "stat" | "season",
      option: { value: string; label: string },
      options: BeamClarifyOption[],
    ) => {
      let replacement = option.label;
      if (kind === "player") {
        // When two options share a name, the team is what separates them, and
        // the resolver already reads a team as a narrowing hint.
        const duplicated =
          options.filter((o) => o.label === option.label).length > 1;
        const picked = options.find((o) => o.value === option.value);
        const team = picked?.detail?.split(",").pop()?.trim();
        if (duplicated && team) replacement = `${option.label} ${team}`;
      } else {
        replacement = option.value;
      }
      const placeholder = kind === "stat" ? "{stat}" : "{player}";
      const rewritten = template.includes(placeholder)
        ? template.replace(placeholder, replacement)
        : `${replacement} ${template}`;
      void submit(rewritten);
    },
    [submit],
  );

  const correctPlayer = useCallback(
    (turn: Turn, matched: BeamMatchedPlayer) => {
      // Re-ask with the full name spelled out, which lands on the exact-match
      // tier and skips whatever inference got it wrong the first time.
      const rewritten = turn.question.replace(
        new RegExp(escapeRegExp(matched.matchedOn), "i"),
        matched.name,
      );
      setValue(rewritten === turn.question ? turn.question : rewritten);
      inputRef.current?.focus();
      inputRef.current?.select();
    },
    [],
  );

  const clear = useCallback(() => {
    inFlight.current?.abort();
    setTurns([]);
    setLearnFor(null);
    setValue("");
    setBusy(false);
    setAnnouncement("Conversation cleared. Ask BEAM something new.");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const remaining = MAX_LENGTH - value.length;
  const canSend = value.trim().length > 0 && !busy;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The one live region. The transcript below is deliberately NOT live. */}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>

      {/* Outside the scroll container on purpose: the transcript auto-scrolls to
          the newest turn, so anything parked at the top of it is unreachable
          within a sentence or two. */}
      {turns.length > 0 && (
        <div className="flex shrink-0 justify-end border-b border-line/60 px-2 sm:px-3">
          <button
            type="button"
            onClick={clear}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-card px-2 text-xs font-semibold text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
            Clear conversation
          </button>
        </div>
      )}

      <div
        ref={scrollRef}
        className="beacon-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
      >
        {turns.length === 0 ? (
          <Welcome starters={starters} onPick={submit} disabled={busy} />
        ) : (
          <ol role="list" className="space-y-6">
            {turns.map((turn) => (
              <li key={turn.id} className="space-y-3">
                {/* The question, as the reader's own message. Still a heading:
                    it is what every answer below it belongs to, and a screen
                    reader user navigates the transcript by heading. */}
                <div className="flex justify-end">
                  <h2 className="max-w-[85%] rounded-modal rounded-br border border-brand-purple/30 bg-brand-purple/15 px-3.5 py-2 text-sm font-medium leading-relaxed text-ink">
                    <span className="sr-only">You asked:</span>
                    {turn.question}
                  </h2>
                </div>

                <div className="flex gap-2.5">
                  <BeamAvatar size={28} className="mt-1" />
                  <div className="min-w-0 flex-1 space-y-3">
                    {turn.pending && <Thinking />}

                    {turn.error && (
                      <p className="rounded-card border border-signal-danger bg-signal-danger/10 px-4 py-3 text-sm text-ink">
                        {turn.error}
                      </p>
                    )}

                    {turn.outcome?.kind === "answer" && (
                      <BeamAnswerCard
                        answer={turn.outcome.answer}
                        matchedPlayers={turn.outcome.matchedPlayers}
                        onCorrectPlayer={(matched) =>
                          correctPlayer(turn, matched)
                        }
                      />
                    )}

                    {turn.outcome?.kind === "clarify" && (
                      <BeamClarify
                        clarification={turn.outcome.clarification}
                        disabled={busy}
                        onPick={(option) =>
                          answerClarification(
                            turn.outcome && turn.outcome.kind === "clarify"
                              ? turn.outcome.clarification.template
                              : turn.question,
                            turn.outcome && turn.outcome.kind === "clarify"
                              ? turn.outcome.clarification.kind
                              : "player",
                            option,
                            turn.outcome && turn.outcome.kind === "clarify"
                              ? turn.outcome.clarification.options
                              : [],
                          )
                        }
                      />
                    )}

                    {turn.outcome?.kind === "unsupported" &&
                      learnFor !== turn.id && (
                        <BeamUnsupported
                          ref={learnCtaRef}
                          outcome={turn.outcome}
                          disabled={busy}
                          onSuggestion={submit}
                          onHelpBeamLearn={() => setLearnFor(turn.id)}
                        />
                      )}

                    {turn.outcome?.kind === "unsupported" &&
                      learnFor === turn.id && (
                        <BeamLearnForm
                          question={turn.question}
                          queryId={turn.outcome.queryId}
                          onCancel={() => {
                            setLearnFor(null);
                            window.requestAnimationFrame(() =>
                              learnCtaRef.current?.focus(),
                            );
                          }}
                          onDone={() => {
                            setLearnFor(null);
                            inputRef.current?.focus();
                          }}
                        />
                      )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Composer. Pinned under the transcript, not sticky inside it, so the
          panel's own scroll never moves it. */}
      <form
        className="shrink-0 border-t border-line bg-surface-elevated px-4 pb-[max(0.85rem,env(safe-area-inset-bottom))] pt-3 sm:px-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(value);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Ask BEAM a question
        </label>
        <div className="flex items-end gap-2 rounded-modal border border-line bg-base px-3 py-2 transition-colors focus-within:border-brand-cyan/70">
          <textarea
            ref={inputRef}
            id={inputId}
            data-beam-initial-focus="true"
            value={value}
            rows={1}
            maxLength={MAX_LENGTH}
            aria-describedby={`${helpId} ${countId}`}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter adds a line. Stated in the help text
              // below, because a keyboard shortcut nobody is told about is not
              // a feature.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit(value);
              }
            }}
            placeholder="Ask about a player, a stat, or a matchup"
            className="beacon-scroll max-h-[132px] min-h-[28px] flex-1 resize-none bg-transparent py-1.5 text-sm leading-relaxed text-ink placeholder:text-ink-muted focus:outline-none"
          />
          {/* aria-disabled, not disabled: a disabled button that the reader has
              just tabbed to disappears from the tab order under their hands. */}
          <button
            type="submit"
            aria-disabled={!canSend}
            aria-label={busy ? "BEAM is answering" : "Send question"}
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
              canSend
                ? "bg-beacon text-black hover:opacity-90"
                : "bg-line text-ink-muted opacity-70"
            }`}
          >
            {busy ? (
              <TypingDots className="text-ink-muted" />
            ) : (
              <ArrowUp aria-hidden="true" className="h-5 w-5" />
            )}
          </button>
        </div>
        <p
          id={helpId}
          className="mt-2 text-[11px] leading-relaxed text-ink-muted"
        >
          Press Enter to send, Shift and Enter for a new line. BEAM reads FF
          Beacon data and does not guess.
        </p>
        <p id={countId} className="sr-only">
          {remaining} characters remaining of {MAX_LENGTH}.
        </p>
      </form>
    </div>
  );
}

/** The empty state: who BEAM is, and four questions that prove it. */
function Welcome({
  starters,
  onPick,
  disabled,
}: {
  starters: string[];
  onPick: (question: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col items-center pt-2 text-center">
      {/* The glow is a radial gradient painted behind the mascot, NOT a
          drop-shadow filter on the image. A CSS filter over a transparent PNG
          or WebP makes the browser blur the image's alpha mask on the main
          thread, and it does it while the panel is mid-slide, which is exactly
          when there is no frame budget to spare. A gradient is a plain paint. */}
      <div className="relative flex justify-center">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(closest-side, rgba(168,85,247,0.30), rgba(168,85,247,0))",
          }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/img/beam-mascot.webp"
          alt=""
          width={132}
          height={177}
          decoding="async"
          style={{ width: 132, height: 177 }}
          className="relative"
        />
      </div>
      <h2 className="mt-3 text-lg font-semibold text-ink">
        Hi, I&apos;m BEAM.
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
        Ask a fantasy football question the way you would say it out loud. I
        answer from FF Beacon&apos;s own data: season stats back to 2020, values
        and ranks in your format, and head-to-head verdicts. When I am not sure
        who you mean, I ask.
      </p>

      {starters.length > 0 && (
        <section
          aria-labelledby="beam-starters-heading"
          className="mt-6 w-full text-left"
        >
          <h3
            id="beam-starters-heading"
            className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan"
          >
            Try one of these
          </h3>
          <ul role="list" className="mt-2.5 grid gap-2">
            {starters.map((starter) => (
              <li key={starter}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(starter)}
                  aria-label={`Ask BEAM: ${starter}`}
                  className="flex min-h-[44px] w-full items-center rounded-card border border-line bg-surface/60 px-3 py-2 text-left text-sm leading-snug text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
                >
                  {starter}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** In-flight state. The live region already said this, so the dots are hidden
 * from assistive tech and the sentence carries the meaning on screen. */
function Thinking() {
  return (
    <p className="flex items-center gap-2.5 px-1 py-2 text-sm text-ink-muted">
      <TypingDots className="text-brand-cyan" />
      BEAM is looking that up.
    </p>
  );
}

function TypingDots({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center gap-1 ${className}`}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-current motion-reduce:animate-none"
          style={{ animationDelay: `${i * 140}ms`, animationDuration: "1s" }}
        />
      ))}
    </span>
  );
}

/** What the live region says for each outcome. One sentence per state. */
function announcementFor(outcome: BeamOutcome): string {
  if (outcome.kind === "answer") {
    // A player BEAM inferred from a nickname or a typo is the single thing a
    // screen reader user most needs told, because the correction link is the
    // trust backstop for the whole resolver and it is otherwise invisible to
    // them. An exact full-name match needs no such warning.
    const inferred = outcome.matchedPlayers.filter((p) => p.tier !== "exact");
    if (inferred.length === 0) return outcome.answer.speech;
    const names = inferred.map((p) => p.name).join(" and ");
    return `${outcome.answer.speech} Matched ${names} from what you typed. If that is wrong, this answer has a correct-the-name button.`;
  }
  if (outcome.kind === "clarify") {
    // Focus moves into the clarification, and a focus change flushes the
    // speech queue, so announcing the full prompt here would be cut off and
    // then repeated by the fieldset legend. Keep this short and let the
    // legend plus the focused option carry the detail.
    return "BEAM needs to know which one you meant.";
  }
  // A dead end has up to three exits, and the message alone announces none of
  // them. Someone who cannot see the card has to be told the buttons exist.
  const exits: string[] = [];
  if (outcome.links.length > 0) {
    const noun =
      outcome.links.length === 1 ? "tool that can" : "tools that can";
    exits.push(`${outcome.links.length} ${noun}`);
  }
  if (outcome.suggestions.length > 0) {
    exits.push(
      `${outcome.suggestions.length} example questions you can activate`,
    );
  }
  exits.push("a Help BEAM learn this button");
  return `${outcome.message} Below this, there are ${exits.join(", ")}.`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
