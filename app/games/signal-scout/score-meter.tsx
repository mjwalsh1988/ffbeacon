"use client";

/**
 * Score meter: a visual readout of remaining signal strength (plan sections
 * 4, 13, 21, 26). Mirrors the aria-hidden bar + sr-only summary sentence
 * pattern from app/tools/signal-check/trade-margin-graph.tsx. The caller
 * (signal-scout-client.tsx) still owns all game state; the only state here is
 * the docking below.
 *
 * On mobile the meter docks to the bottom of the viewport so a player always
 * sees how much signal they have left without scrolling back to it. It undocks
 * once the reader reaches the meter's own place in the page, and stays there
 * from then on, so it never floats over the leaderboard or the footer, which is
 * past the game and nothing to do with the round. Scrolling back up re-docks it.
 * On sm and up it is the inline card it has always been, since the round fits
 * on screen there.
 *
 * This is what `position: sticky; bottom: 0` describes, but sticky cannot be
 * used here on two counts: the round card is overflow-hidden, which silently
 * kills sticky, and a sticky element is confined to its containing block, so it
 * could not span the viewport edge to edge the way the dock does. Hence the
 * scroll-driven fixed/static swap below.
 *
 * The component only renders during an active round, so the dock's lifetime is
 * the round's lifetime.
 */

import { useEffect, useRef, useState } from "react";
import { Flame } from "lucide-react";

/**
 * Published on <html> while the meter is docked, carrying its measured height.
 * Two things consume it:
 *   - app/globals.css pads the body, so the page's last content and the site
 *     footer can still be scrolled clear of the fixed bar.
 *   - components/discord-cta.tsx lifts the floating invite above the bar
 *     instead of sitting on top of the score readout.
 * Removed as soon as the meter undocks (and on unmount), because an undocked
 * meter covers nothing and neither consumer should reserve space for it.
 */
const DOCK_HEIGHT_VAR = "--ffb-dock-h";

/** Docking is mobile-only. Mirrors the Tailwind sm breakpoint. */
const DOCK_MEDIA_QUERY = "(max-width: 639px)";

/** The meter at rest: the card this has always been, on every breakpoint. */
const INLINE_CLASS = "rounded-card border border-line bg-base/40 p-4";

/**
 * The meter docked to the viewport bottom. z-20 is deliberate. It has to sit
 * above the page content it overlays, but below the guess combobox's suggestion
 * list (z-30), which is the round's primary control and must never be covered,
 * and below the leaderboard sheet (z-50).
 */
const DOCKED_CLASS =
  "fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur";

export interface ScoreMeterProps {
  score: number;
  startingScore: number;
  burned: boolean;
}

export function ScoreMeter({ score, startingScore, burned }: ScoreMeterProps) {
  // The slot holds the meter's place in the page. While the meter is docked it
  // is out of flow, so the slot keeps its exact height: that way the meter
  // lands back into the space it already reserved, with nothing shifting.
  const slotRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);

  // Both start in the "no docking" position so the server render and the first
  // client paint agree. The effects correct them immediately, and on mobile the
  // meter's resting place is below the fold anyway, so nothing is seen to move.
  const [isNarrow, setIsNarrow] = useState(false);
  const [slotBelowFold, setSlotBelowFold] = useState(true);
  const [naturalHeight, setNaturalHeight] = useState<number | null>(null);

  const docked = isNarrow && slotBelowFold;

  useEffect(() => {
    const query = window.matchMedia(DOCK_MEDIA_QUERY);
    const sync = () => setIsNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Dock only while the meter's own place in the page is still below the fold.
  // Reading the slot (never the meter) is what makes this stable: the slot
  // holds the same box whether the meter is docked or not, so the test cannot
  // oscillate against its own result. Scrolling clean past the slot leaves the
  // bottom above the fold, which reads as "not below" and correctly keeps the
  // meter parked rather than re-docking it.
  useEffect(() => {
    if (!isNarrow) return;
    const slot = slotRef.current;
    if (!slot) return;

    let frame = 0;
    const evaluate = () => {
      frame = 0;
      setSlotBelowFold(
        slot.getBoundingClientRect().bottom > window.innerHeight,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(evaluate);
    };

    evaluate();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [isNarrow]);

  // The height the meter occupies at rest, measured while it is at rest, and
  // held so the slot can reserve exactly that much once the meter lifts out of
  // flow. Measuring the docked bar instead would be wrong: it carries different
  // padding and the safe-area inset, so the meter would not land where the
  // reader was told to expect it.
  useEffect(() => {
    if (docked) return;
    const node = meterRef.current;
    if (!node) return;
    const measure = () => setNaturalHeight(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [docked]);

  // Measured rather than hardcoded: the docked bar's height moves with font
  // scaling, the safe-area inset, and the burned-out state's wider label.
  useEffect(() => {
    const node = meterRef.current;
    if (!docked || !node) return;
    const root = document.documentElement;
    const publish = () => {
      root.style.setProperty(DOCK_HEIGHT_VAR, `${node.offsetHeight}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty(DOCK_HEIGHT_VAR);
    };
  }, [docked]);

  const rawPct = startingScore > 0 ? (score / startingScore) * 100 : 0;
  const clampedPct = Math.min(Math.max(rawPct, 0), 100);
  // Zero must look empty (no floor); any score above zero gets a floor so a
  // sliver of fill stays visible, matching the house pattern in
  // trade-margin-graph.tsx.
  const fillPct = burned ? 0 : clampedPct === 0 ? 0 : Math.max(clampedPct, 4);

  // The travelling-current animation runs only while there is signal left to
  // carry it. A burned-out or zeroed meter has no fill to draw it in anyway,
  // and a dead signal should read as dead rather than still humming.
  // See the .scout-current block in app/globals.css.
  const live = !burned && fillPct > 0;

  const summary = burned
    ? "Score zero. The signal has burned out; this round can no longer score."
    : `Score ${score} of ${startingScore} points remaining. The signal burns out at zero.`;

  return (
    // The mt-6 lives on the slot rather than the meter so the gap above stays
    // put when the meter lifts out of flow.
    <div
      ref={slotRef}
      className="mt-6"
      style={
        docked && naturalHeight != null ? { height: naturalHeight } : undefined
      }
    >
      <div ref={meterRef} className={docked ? DOCKED_CLASS : INLINE_CLASS}>
        <div className="flex items-center justify-between gap-2">
          <p
            className={`text-xs font-semibold uppercase tracking-[0.16em] ${
              burned ? "text-signal-danger" : "text-ink-subtle"
            }`}
          >
            {burned ? "Signal strength, burned out" : "Signal strength"}
          </p>
          <span className="font-mono text-xs font-semibold tabular-nums text-ink">
            {score.toLocaleString("en-US")} /{" "}
            {startingScore.toLocaleString("en-US")}
          </span>
        </div>

        <div
          aria-hidden="true"
          className={`relative mt-3 h-3.5 w-full overflow-hidden rounded-full bg-line/60 ${
            burned ? "border border-signal-danger/40" : ""
          }`}
        >
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 z-10 w-0.5 bg-signal-danger"
          />
          {/* overflow-hidden so the current layers clip to the fill's own pill
            shape instead of squaring off its leading edge. */}
          <span
            className={`absolute inset-y-0 left-0 overflow-hidden rounded-full transition-[width] duration-500 motion-reduce:transition-none ${
              live ? "scout-current" : ""
            }`}
            style={{
              width: `${fillPct}%`,
              backgroundImage:
                "linear-gradient(90deg, #7C3AED 0%, #A855F7 45%, #22D3EE 100%)",
            }}
          />
        </div>

        <div
          aria-hidden="true"
          className="mt-1.5 flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-1 text-[10px] text-signal-danger">
            <Flame aria-hidden="true" className="h-3 w-3 shrink-0" />
            0, burn point
          </span>
          <span className="text-[10px] text-ink-subtle">
            {startingScore.toLocaleString("en-US")}
          </span>
        </div>

        <p className="sr-only">{summary}</p>
      </div>
    </div>
  );
}
