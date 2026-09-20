"use client";

import { useId } from "react";
import { ArrowDownRight, ArrowUpRight, Info, Minus } from "lucide-react";
import type { FaabSignal } from "@/lib/faab/types";

/**
 * Every reason the number moved, so a reader can disagree with it.
 *
 * The direction is a word before it is a colour or an arrow: the percentage
 * reads "12% to the bid" or "8% off the bid", so a reader who cannot see the
 * green arrow still knows which way it went.
 */
export function SignalList({ signals }: { signals: FaabSignal[] }) {
  const headingId = `${useId()}-signals`;
  if (signals.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-card border border-line bg-surface/40 p-4"
    >
      <h4
        id={headingId}
        className="flex items-center gap-2 text-sm font-semibold text-ink"
      >
        <Info aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
        What moved it
      </h4>
      <ul role="list" className="mt-3 space-y-3">
        {signals.map((signal) => {
          const Icon = toneIcon(signal.tone);
          const movePct = Math.round((signal.multiplier - 1) * 100);
          return (
            <li key={signal.id} className="flex items-start gap-2.5">
              <Icon
                aria-hidden="true"
                className={`mt-0.5 h-4 w-4 shrink-0 ${toneClass(signal.tone)}`}
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  {signal.label}
                  {movePct !== 0 && (
                    <span className={`ml-2 text-xs font-medium ${toneClass(signal.tone)}`}>
                      {movePct > 0
                        ? `${movePct}% to the bid`
                        : `${Math.abs(movePct)}% off the bid`}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-ink-muted">
                  {signal.detail}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function toneIcon(tone: FaabSignal["tone"]) {
  if (tone === "good") return ArrowUpRight;
  if (tone === "bad") return ArrowDownRight;
  return Minus;
}

function toneClass(tone: FaabSignal["tone"]): string {
  if (tone === "good") return "text-signal-success";
  if (tone === "bad") return "text-signal-danger";
  return "text-ink-subtle";
}
