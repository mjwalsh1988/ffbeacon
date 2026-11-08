"use client";

/**
 * The mode picker (plan 5.2 and 18A.6): two tickets in a labeled group,
 * Hurry-Up first and primary. The Hurry-Up ticket names its time limit in
 * words before the clock is ever met (owner decision 9); Film Room is the
 * untimed way to play every prompt.
 */

import { Clapperboard, Zap } from "lucide-react";
import { useId } from "react";

export function ModePicker({
  timerSeconds,
  filmRoomEnabled,
  puzzleReady,
  busy,
  onPick,
  hideHurryUp = false,
}: {
  timerSeconds: number;
  filmRoomEnabled: boolean;
  puzzleReady: boolean;
  busy: boolean;
  onPick: (mode: "hurry_up" | "film_room") => void;
  /** True once today's Hurry-Up is over; the picker then offers Film Room alone. */
  hideHurryUp?: boolean;
}) {
  const huDesc = useId();
  const frDesc = useId();
  const ticket =
    "group flex min-h-[120px] w-full flex-col items-start gap-2 rounded-[20px] border-2 bg-base/60 p-5 text-left transition duration-[180ms] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-70 motion-safe:hover:-translate-y-0.5 motion-safe:focus-visible:-translate-y-0.5";
  return (
    <div>
      <div role="group" aria-label="Choose a mode" className="grid gap-4 sm:grid-cols-2">
        {!hideHurryUp && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onPick("hurry_up")}
            aria-describedby={huDesc}
            className={`${ticket} border-brand-cyan focus-visible:outline-brand-cyan hover:shadow-[0_0_32px_-8px_rgba(34,211,238,0.7)] focus-visible:shadow-[0_0_32px_-8px_rgba(34,211,238,0.7)]`}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <Zap aria-hidden="true" className="h-7 w-7 text-brand-cyan" />
              <span className="rounded-full border border-brand-cyan/50 px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-brand-cyan">
                Default
              </span>
            </span>
            <span className="text-2xl font-black text-ink">Hurry-Up</span>
            <span id={huDesc} className="text-sm text-ink-muted">
              {timerSeconds} seconds a prompt. Counts for streaks and the boards.
            </span>
          </button>
        )}
        {filmRoomEnabled && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onPick("film_room")}
            aria-describedby={frDesc}
            className={`${ticket} border-brand-purple focus-visible:outline-brand-purple hover:shadow-[0_0_32px_-8px_rgba(168,85,247,0.7)]`}
          >
            <Clapperboard aria-hidden="true" className="h-7 w-7 text-brand-purple" />
            <span className="text-2xl font-black text-ink">Film Room</span>
            <span id={frDesc} className="text-sm text-ink-muted">
              No clock. Practice only; nothing is recorded.
            </span>
          </button>
        )}
      </div>
      {filmRoomEnabled && !hideHurryUp && (
        <p className="mt-4 text-sm text-ink-muted">
          Film Room opens for today&apos;s puzzle once your Hurry-Up is done. Until then it plays a past day.
        </p>
      )}
      {!puzzleReady && !hideHurryUp && (
        <p className="mt-2 text-sm text-ink-muted">
          Today&apos;s puzzle is being built. Press Hurry-Up or Film Room and it will be ready in a moment.
        </p>
      )}
    </div>
  );
}
