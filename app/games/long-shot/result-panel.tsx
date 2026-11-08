"use client";

/**
 * The result reveal (plan 5.3 and 18A.8). Replaces the picker in place. A
 * <section> whose visible h2 "Result for prompt {n}" is the focus target. The
 * headshot in a tier-colored frame, the points counting up beside the tier
 * chip, the full field strip with the new marker landing, the room line, the
 * room bars, and Next (the next prompt's clock starts only when it is pressed).
 */

import { forwardRef, useEffect, useState } from "react";
import { FieldStrip } from "@/components/long-shot/field-strip";
import { RoomBars } from "@/components/long-shot/room-bars";
import { TierChip } from "@/components/long-shot/tier-chip";
import { NflTeamLogo } from "@/components/nfl-team-logo";
import { PlayerHeadshot } from "@/components/player-headshot";
import { MISS_STYLE, TIER_STYLE } from "@/lib/long-shot/tier-style";
import type { AnswerSummaryDto, PromptDto, ResultDto } from "@/lib/long-shot/types";
import { useReducedMotion } from "@/lib/long-shot/use-reduced-motion";
import { resultSentence, roomLine } from "./result-text";
import { stripRecords } from "./strip-records";

function useCountUp(target: number): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced || target === 0) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 500);
      setValue(Math.round(target * k));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);
  return value;
}

export function answeredSummary(prompt: PromptDto, result: ResultDto): AnswerSummaryDto[] {
  return [
    ...prompt.answers,
    {
      position: result.position,
      state: result.state,
      tier: result.tier,
      points: result.points,
      playerName: result.playerName,
      playerSlug: result.playerSlug,
      sleeperId: result.sleeperId,
      teamCode: result.teamCode,
      loneSignal: false,
    },
  ];
}

export const ResultPanel = forwardRef<
  HTMLHeadingElement,
  { prompt: PromptDto; result: ResultDto; busy: boolean; onNext: () => void }
>(function ResultPanel({ prompt, result, busy, onNext }, headingRef) {
  const shown = useCountUp(result.points);
  const style = result.tier ? TIER_STYLE[result.tier] : null;
  const answers = answeredSummary(prompt, result);
  const last = result.next.kind === "completed";
  const own =
    result.correct && result.tier && result.playerName
      ? {
          playerName: result.playerName,
          slug: result.playerSlug,
          sleeperId: result.sleeperId,
          teamCode: result.teamCode,
          tier: result.tier,
          count: result.roomCount,
        }
      : null;

  return (
    <section aria-labelledby={`ls-result-${result.position}`}>
      <h2
        id={`ls-result-${result.position}`}
        ref={headingRef}
        tabIndex={-1}
        className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ink-subtle focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-cyan"
      >
        Result for prompt {result.position}
      </h2>

      <div className="mt-5 flex items-center gap-4">
        {result.playerName ? (
          <span className="shrink-0 rounded-lg p-[3px]" style={{ background: style ? style.hex : MISS_STYLE.hex }}>
            <PlayerHeadshot sleeperId={result.sleeperId} name="" size={72} className="block" />
          </span>
        ) : (
          <span className="h-[78px] w-[78px] shrink-0 rounded-lg border-2 border-dashed border-line-accent" />
        )}
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold text-ink">
            {result.playerName ?? (result.state === "timed_out" ? "Time ran out" : "Skipped")}
          </p>
          {result.teamCode && (
            <p className="mt-1 flex items-center gap-2 text-sm text-ink-muted">
              <NflTeamLogo team={result.teamCode} size={18} />
              {result.teamCode}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-4">
        <p
          className={`text-6xl font-black leading-none tracking-tight tabular-nums sm:text-7xl ${style ? style.text : "text-ink-subtle"}`}
          style={result.tier === "long_shot" ? { filter: "drop-shadow(0 0 16px rgba(34,211,238,0.6))" } : undefined}
        >
          {shown}
          <span className="sr-only"> points</span>
        </p>
        <div className="pb-2">
          <TierChip tier={result.tier} />
        </div>
      </div>
      <p className="mt-3 text-base text-ink">{resultSentence(result)}</p>

      <div className="mt-6">
        <FieldStrip
          records={stripRecords(answers, prompt.promptCount)}
          total={result.basePoints}
          flight={result.tier ? { position: result.position, tier: result.tier, team: result.team } : null}
        />
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-subtle">The room</h3>
        <p className="mt-2 text-sm text-ink">{roomLine(result, prompt.mode)}</p>
        {result.mostGiven.length > 0 && <p className="mt-3 text-sm text-ink-muted">Most given so far:</p>}
        <div className="mt-2">
          <RoomBars mostGiven={result.mostGiven} total={result.roomTotal} own={own} ownPlayerSlug={result.playerSlug} />
        </div>
      </div>

      <div className="mt-6 flex sm:justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={onNext}
          className="inline-flex h-12 w-full items-center justify-center rounded-card bg-brand-cyan px-6 text-base font-bold text-[#07070D] transition-colors hover:bg-brand-cyan-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60 sm:w-auto"
        >
          {last ? "See your day" : "Next"}
        </button>
      </div>
    </section>
  );
});
