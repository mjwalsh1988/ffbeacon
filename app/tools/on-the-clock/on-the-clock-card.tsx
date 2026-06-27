"use client";

/**
 * "ON THE CLOCK" pick card. Sits above the Who-to-pick content and shows, in big
 * broadcast-style type, exactly which pick is currently on the clock in
 * round.pick form (e.g. 02.04). This makes it obvious that the recommendations
 * below are for THAT pick, and nudges the user to Sync if picks have already
 * happened in their live draft.
 *
 * MOCKED for Phase 4: the pick numbers come from fixtures. Purely presentational;
 * the pulse is decorative and reduced-motion-safe.
 */

import { Clock } from "lucide-react";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function OnTheClockCard({
  round,
  pickInRound,
  overallPickNo,
  teamLabel,
  isYourTurn,
}: {
  round: number;
  pickInRound: number;
  overallPickNo: number;
  teamLabel: string;
  isYourTurn: boolean;
}) {
  const pickLabel = `${pad(round)}.${pad(pickInRound)}`;
  return (
    <section
      aria-label="On the clock"
      className="relative overflow-hidden rounded-modal border border-brand-cyan/40 bg-surface/60 p-4 sm:p-5"
      style={{
        boxShadow: "0 0 80px -48px rgba(34, 211, 238, 0.6)",
        backgroundImage:
          "radial-gradient(ellipse at 0% 0%, rgba(34, 211, 238, 0.12) 0%, transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(168, 85, 247, 0.12) 0%, transparent 55%)",
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #22D3EE 30%, #A855F7 70%, transparent 100%)",
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-brand-cyan/50 bg-base text-brand-cyan"
          >
            <Clock className="h-5 w-5" />
          </span>
          <div>
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-cyan">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full bg-brand-cyan animate-pulse motion-reduce:animate-none"
              />
              On the clock
            </p>
            <p className="mt-0.5 flex items-baseline gap-2">
              <span
                className="bg-clip-text font-mono text-4xl font-bold tabular-nums text-transparent sm:text-5xl"
                style={{ backgroundImage: "linear-gradient(135deg, #22D3EE 0%, #A855F7 100%)" }}
              >
                {pickLabel}
              </span>
              <span className="text-sm text-ink-muted">overall #{overallPickNo}</span>
            </p>
            <p className="mt-0.5 text-sm text-ink">
              {isYourTurn ? (
                <span className="font-semibold text-brand-cyan">Your pick. You are up.</span>
              ) : (
                <span className="text-ink-muted">{teamLabel} is on the clock</span>
              )}
            </p>
          </div>
        </div>

        <div className="max-w-[16rem] text-right text-xs text-ink-muted">
          <p>The picks below are tailored to this exact slot.</p>
          <p className="mt-1">
            Already drafted in your league? <span className="font-semibold text-ink">Sync draft</span>{" "}
            to move the clock forward.
          </p>
        </div>
      </div>
    </section>
  );
}
