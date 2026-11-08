"use client";

/**
 * One prompt on screen (plan 5.3): the status line with the prompt number,
 * the mode and, in Hurry-Up, the clock; the small field strip as progress;
 * the prompt as an h2 (the focus target on load); the player picker; Answer,
 * and in Film Room Skip and End practice; the running base score.
 */

import { forwardRef, useState } from "react";
import { FieldStrip } from "@/components/long-shot/field-strip";
import type { SearchPlayerResult } from "@/components/player-guess-combobox";
import { addDays } from "@/lib/game-date";
import { longDayLabel } from "@/lib/long-shot/dates";
import { MODE_NAMES, type PromptDto } from "@/lib/long-shot/types";
import { Countdown } from "./countdown";
import { LongShotPlayerCombobox } from "./player-combobox";
import { stripRecords } from "./strip-records";

export const PromptCard = forwardRef<
  HTMLHeadingElement,
  {
    prompt: PromptDto;
    today: string;
    limitSeconds: number;
    busy: boolean;
    error: string | null;
    onAnswer: (player: SearchPlayerResult) => void;
    onTimeout: () => void;
    onSkip: () => void;
    onEnd: () => void;
  }
>(function PromptCard({ prompt, today, limitSeconds, busy, error, onAnswer, onTimeout, onSkip, onEnd }, headingRef) {
  const [chosen, setChosen] = useState<SearchPlayerResult | null>(null);
  const hurry = prompt.mode === "hurry_up";
  const pastDay = prompt.mode === "film_room" && prompt.gameDate !== today;
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ink-subtle">
            Prompt {prompt.position} of {prompt.promptCount}, {MODE_NAMES[prompt.mode]}
          </p>
          <div className="mt-3">
            <FieldStrip records={stripRecords(prompt.answers, prompt.promptCount)} total={prompt.basePoints} size="small" />
          </div>
        </div>
        {hurry && prompt.remainingMs !== null && (
          <Countdown
            key={`${prompt.attemptId}-${prompt.position}`}
            remainingMs={prompt.remainingMs}
            limitSeconds={prompt.timerSeconds ?? limitSeconds}
            position={prompt.position}
            promptCount={prompt.promptCount}
            onExpire={onTimeout}
          />
        )}
      </div>

      {pastDay && (
        <p className="mt-5 text-sm text-brand-purple-light">
          Film Room: {prompt.gameDate === addDays(today, -1) ? "yesterday's puzzle" : "a past puzzle"} ({longDayLabel(prompt.gameDate)}). Today&apos;s opens after your Hurry-Up.
        </p>
      )}

      <h2
        ref={headingRef}
        tabIndex={-1}
        className="mt-6 text-2xl font-semibold leading-snug tracking-tight text-ink focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-cyan sm:text-3xl"
      >
        {prompt.promptText}
      </h2>

      <div className="mt-6 border-t border-line pt-6">
        <LongShotPlayerCombobox disabled={busy} chosen={chosen} onChoose={setChosen} />
        {error && (
          <p className="mt-3 text-sm font-medium text-signal-danger">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            disabled={!chosen || busy}
            onClick={() => chosen && onAnswer(chosen)}
            className="inline-flex h-12 min-w-[44px] items-center justify-center rounded-card bg-brand-cyan px-6 text-base font-bold text-[#07070D] transition-colors hover:bg-brand-cyan-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-50"
          >
            Answer
          </button>
          {!hurry && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={onSkip}
                className="inline-flex h-12 items-center justify-center rounded-card border border-line px-5 text-sm font-semibold text-ink hover:border-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-purple disabled:opacity-50"
              >
                Skip
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onEnd}
                className="inline-flex h-12 items-center justify-center rounded-card border border-line px-5 text-sm font-semibold text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-purple disabled:opacity-50"
              >
                End practice
              </button>
            </>
          )}
        </div>
      </div>

      <p className="mt-6 border-t border-line pt-4 text-sm text-ink-muted">
        Score so far: <span className="font-mono font-bold tabular-nums text-ink">{prompt.basePoints}</span> points
      </p>
    </div>
  );
});
