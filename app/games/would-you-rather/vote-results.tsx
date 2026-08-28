"use client";

/**
 * Where everybody else landed.
 *
 * THE ANIMATION IS A TRANSITION ON A NUMBER, NOT A SHOW. Both bars grow from
 * nothing to their real share once, over three quarters of a second, and the
 * percentages count up alongside them. That is enough to make the reveal feel
 * like an answer arriving rather than a page repainting, and short enough that
 * nobody waits for it.
 *
 * IT IS ALSO ENTIRELY OPTIONAL. Under `prefers-reduced-motion` the bars and the
 * numbers are painted at their final values on the first frame, with no
 * transition and no timer running at all. The reveal is identical in content
 * either way, because the animation carries nothing the text does not say.
 *
 * NOTHING HERE IS COLOUR ONLY. Each bar is labelled with its team, its
 * percentage and its raw count, the reader's own pick carries the word "your
 * pick" rather than only a border, and the whole graph is preceded by a
 * one-sentence summary that a screen reader announces as a single fact instead
 * of walking two unlabelled rectangles.
 */

import { useEffect, useRef, useState } from "react";
import { Check, Users } from "lucide-react";
import type { WyrSide, WyrTally } from "@/lib/would-you-rather/types";
import { SIDE_LABEL } from "./trade-board";

/** How long the bars take to reach their share. */
const GROW_MS = 750;

/**
 * True when the reader has asked the operating system for less movement.
 *
 * READ SYNCHRONOUSLY, IN A LAZY INITIALISER. Reading it in an effect instead
 * cost one commit, and that commit painted the bars full and the numbers final
 * before the effect flipped the flag and sent both back to zero to animate up.
 * A backwards jump is a worse vestibular event than the forward animation it
 * was meant to be guarding. This component only ever mounts after a vote, so
 * there is no server render to hydrate against and no reason to defer the read.
 *
 * Falls back to `true` where matchMedia does not exist, which is the safe way
 * round: no animation.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return true;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * Counts from zero to `target` over `GROW_MS`, or lands on it immediately.
 *
 * Starts at the target rather than at zero, so the very first server-rendered
 * or motion-reduced frame already shows the real number and nothing ever
 * flashes a wrong percentage.
 */
function useCountUp(target: number, animate: boolean): number {
  const [value, setValue] = useState(target);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!animate) {
      setValue(target);
      return;
    }
    const started = performance.now();
    setValue(0);
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / GROW_MS);
      // Same ease-out curve as the bar's CSS transition, so the number and the
      // bar it sits beside arrive together.
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [target, animate]);

  return value;
}

export function VoteResults({
  tally,
  yourSide,
  crowdVsModel,
}: {
  tally: WyrTally;
  yourSide: WyrSide;
  /** One sentence on the crowd against the model. Null before there is a crowd. */
  crowdVsModel: string | null;
}) {
  const reduced = usePrefersReducedMotion();
  const animate = !reduced;
  const [grown, setGrown] = useState(false);

  useEffect(() => {
    if (!animate) {
      setGrown(true);
      return;
    }
    setGrown(false);
    // Two frames: one to paint the bars at zero width, one to change it, so the
    // transition has a start state to run from. A single frame occasionally
    // batches into the same paint and the bars simply appear.
    const outer = requestAnimationFrame(() => {
      const inner = requestAnimationFrame(() => setGrown(true));
      frames.push(inner);
    });
    const frames: number[] = [outer];
    return () => frames.forEach((f) => cancelAnimationFrame(f));
  }, [animate, tally.a, tally.b]);

  const pctA = useCountUp(tally.pctA, animate);
  const pctB = useCountUp(tally.pctB, animate);

  const totalLabel = `${tally.total.toLocaleString()} vote${tally.total === 1 ? "" : "s"}`;
  const discordTotal = tally.discordA + tally.discordB;

  const summary =
    tally.total === 0
      ? "No votes have been recorded on this trade yet."
      : `${SIDE_LABEL.a} has ${tally.pctA}% of ${totalLabel} (${tally.a.toLocaleString()}), and ${SIDE_LABEL.b} has ${tally.pctB}% (${tally.b.toLocaleString()}). You picked ${SIDE_LABEL[yourSide]}.`;

  return (
    <div>
      {/* The graph as one sentence, before the graph. A reader moving linearly
          gets the whole result in one announcement instead of walking two bars. */}
      <p className="sr-only">{summary}</p>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Users aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
          How the room voted
        </p>
        <p className="text-xs text-ink-subtle">
          {totalLabel}
          {discordTotal > 0
            ? `, including ${discordTotal.toLocaleString()} from the Discord poll`
            : ""}
        </p>
      </div>

      <div aria-hidden="true" className="mt-3 space-y-3">
        {(["a", "b"] as WyrSide[]).map((side) => {
          const pct = side === "a" ? tally.pctA : tally.pctB;
          const shown = side === "a" ? pctA : pctB;
          const count = side === "a" ? tally.a : tally.b;
          const mine = side === yourSide;
          return (
            <div key={side}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  {SIDE_LABEL[side]}
                  {mine && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-cyan/15 px-2 py-0.5 text-[11px] font-semibold text-brand-cyan">
                      <Check className="h-3 w-3" />
                      your pick
                    </span>
                  )}
                </p>
                <p className="font-mono text-sm font-semibold tabular-nums text-ink">
                  {shown}%
                  <span className="ml-1.5 font-sans text-xs font-normal text-ink-subtle">
                    {count.toLocaleString()}
                  </span>
                </p>
              </div>
              <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-base">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${grown ? pct : 0}%`,
                    transition: animate
                      ? `width ${GROW_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`
                      : undefined,
                    backgroundImage: mine
                      ? "linear-gradient(90deg, #A855F7 0%, #22D3EE 100%)"
                      : undefined,
                    // #4A4A70 rather than the line-accent #2A2A47, which
                    // measured 1.46:1 against the track and left the losing bar
                    // effectively invisible. This clears the 3:1 WCAG asks of a
                    // graphical object while staying plainly secondary to the
                    // beacon gradient on the reader's own pick.
                    backgroundColor: mine ? undefined : "#4A4A70",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {crowdVsModel && (
        <p className="mt-4 rounded-card border border-line bg-base/40 px-3.5 py-3 text-sm leading-relaxed text-ink-muted">
          {crowdVsModel}
        </p>
      )}
    </div>
  );
}
