"use client";

import { forwardRef } from "react";
import Link from "next/link";
import { ArrowRight, MessageCirclePlus } from "lucide-react";
import type { BeamOutcome } from "@/lib/beam/types";

type Unsupported = Extract<BeamOutcome, { kind: "unsupported" }>;

/**
 * The dead end, and the way out of it.
 *
 * Three affordances, in the order they are useful:
 *   1. What went wrong, in a sentence specific to WHY. "We could not find that
 *      player" and "BEAM cannot see your league" are different problems.
 *   2. Where to go instead, when another FF Beacon tool answers this question.
 *   3. Questions BEAM does handle, generated from the live capability registry
 *      so a switched-off capability stops being advertised automatically.
 * Then the feedback button, which is the only way this dead end teaches us
 * anything.
 */
export const BeamUnsupported = forwardRef<
  HTMLButtonElement,
  {
    outcome: Unsupported;
    onSuggestion: (question: string) => void;
    onHelpBeamLearn: () => void;
    disabled: boolean;
  }
>(function BeamUnsupported({ outcome, onSuggestion, onHelpBeamLearn, disabled }, ctaRef) {
  return (
    <div className="rounded-card border border-line bg-surface/60 p-4 sm:p-5">
      <p className="text-base font-medium leading-relaxed text-ink">{outcome.message}</p>

      {outcome.links.length > 0 && (
        <ul role="list" className="mt-4 flex flex-wrap gap-2">
          {outcome.links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-card border border-brand-cyan/50 bg-brand-cyan/10 px-3 text-sm font-semibold text-ink transition-colors hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                {link.label}
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {outcome.suggestions.length > 0 && (
        <div className="mt-5">
          {/* h3, matching the feedback heading below it: both sit under the
              turn's own h2, and jumping straight to h4 skips a level. */}
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-cyan">
            Things BEAM can answer
          </h3>
          <ul role="list" className="mt-2 grid gap-2">
            {outcome.suggestions.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSuggestion(suggestion)}
                  aria-label={`Ask BEAM: ${suggestion}`}
                  className="flex min-h-[44px] w-full items-center rounded-card border border-line bg-base px-3 py-2 text-left text-sm text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 rounded-card border border-brand-purple/30 bg-gradient-to-br from-brand-purple/10 to-brand-cyan/10 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <MessageCirclePlus aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
          Should BEAM know this?
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          Tell us and we will teach it. Your question comes along automatically, so
          there is nothing to retype.
        </p>
        <button
          ref={ctaRef}
          type="button"
          onClick={onHelpBeamLearn}
          className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-card border border-brand-cyan bg-brand-cyan/10 px-4 text-sm font-semibold text-ink transition-colors hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <MessageCirclePlus aria-hidden="true" className="h-4 w-4" />
          Help BEAM learn this
        </button>
      </div>
    </div>
  );
});
