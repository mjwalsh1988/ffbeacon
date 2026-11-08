"use client";

/**
 * The Hurry-Up clock badge (plan 18A.7). The seconds are a visible text node,
 * never aria-hidden and never inside a live region, so the every-second change
 * is silent and the figure is still readable on demand; the timer live region
 * (plan 8.3) is a sibling owned by countdown.tsx. Around the figure a
 * decorative ring depletes once a second; cyan above 10 seconds, amber from
 * 10, red from 5, and the number takes the same color. Under reduced motion
 * the ring stays full and only the colors change.
 */

import { useReducedMotion } from "@/lib/long-shot/use-reduced-motion";

const R = 32;
const CIRC = 2 * Math.PI * R;

export function clockColor(seconds: number): string {
  if (seconds <= 5) return "#EF4444";
  if (seconds <= 10) return "#F59E0B";
  return "#22D3EE";
}

export function ClockBadge({ seconds, limit }: { seconds: number; limit: number }) {
  const reduced = useReducedMotion();
  const color = clockColor(seconds);
  const share = limit > 0 ? Math.max(0, Math.min(1, seconds / limit)) : 0;
  const offset = reduced ? 0 : CIRC * (1 - share);
  return (
    <div className="relative flex h-[72px] w-[72px] shrink-0 items-center justify-center">
      <svg
        viewBox="0 0 72 72"
        className="pointer-events-none absolute inset-0 h-full w-full -rotate-90"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="36" cy="36" r={R} fill="none" stroke="#1F1F33" strokeWidth="4" />
        <circle
          cx="36"
          cy="36"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={offset}
          style={{ transition: reduced ? "stroke 180ms" : "stroke-dashoffset 1s linear, stroke 180ms" }}
        />
      </svg>
      <span
        className="relative text-4xl font-black leading-none tracking-tight tabular-nums"
        style={{ color }}
      >
        {seconds}
        <span className="sr-only"> seconds left</span>
      </span>
    </div>
  );
}
