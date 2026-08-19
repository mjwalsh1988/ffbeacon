"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Lava lamp backdrop for the site's heroes.
 *
 * THE MERGE IS REAL. Every wax element sits inside one container carrying
 * `filter: url(#hero-lava-goo)`, defined below: blur the whole group, then run
 * the blurred alpha through a steep contrast ramp so anything past roughly 46%
 * alpha snaps solid and anything under it disappears. Two clumps drifting
 * together stay separate until their blur halos overlap enough to cross that
 * threshold, at which point a thin bridge appears between them, thickens as they
 * close, and pinches off as they part. The filter computes that per pixel, which
 * is where the surface tension comes from. `feComposite ... atop` then paints
 * the original clumps back inside the merged silhouette so each keeps its own
 * gradient and reads molten rather than flat, and a final 3px blur melts the
 * join.
 *
 * THREE MOTIONS, ALL DECOUPLED. Each clump is two nested elements so the
 * transforms never fight:
 *
 *   1. Travel (outer). A wandering closed loop that reverses direction several
 *      times per cycle, 26s to 56s, running forward or reversed.
 *   2. Shape (inner). `border-radius`, non-uniform scale, and rotation on a much
 *      faster 6.5s to 12.5s clock, swinging roughly 0.78 to 1.28 per axis, so a
 *      clump squashes wide, stretches tall, and rolls over several times per
 *      trip.
 *   3. Color drift (tint plate). Some clumps carry a plate that cross-fades
 *      toward brand cyan #22D3EE, brand purple #A855F7, or a blend of the two,
 *      then back to the clump's own color, on its own long cycle.
 *
 * DIFFERENT ON EVERY REFRESH. The page passes a fresh `seed` per request (it is
 * `force-dynamic`), and every clump's lane, size, path, direction, speed, phase,
 * deformation pattern, color, and tint are derived from it through a mulberry32
 * PRNG. Deriving rather than calling `Math.random()` during render is what keeps
 * the server HTML and the client's first render byte-identical, so there is no
 * hydration mismatch and no re-shuffle flash after mount.
 *
 * COLOR. Clumps are drawn from the same family as the field rather than sitting
 * above it as bright objects: a dense body color that could pass for background
 * (#6D28D9, #5B21B6, #4C1D95, #0E7490, #155E75) with a small hot spot in the
 * first third of the radius and a darker rim. That is what makes them read as
 * lava in the same liquid, and why the wax layer can sit at 88% opacity without
 * becoming loud. Palette throughout is the site palette: brand purple #A855F7
 * and brand cyan #22D3EE with the deeper violets and teals used across the hero
 * family.
 *
 * Everything here is decorative and marked aria-hidden, so it never reaches the
 * accessibility tree. The hero's real content carries its own labels.
 *
 * CONTRAST. Every hero that uses this declares a `copy` zone saying where its
 * text sits. Any clump whose travel could carry it behind that zone is
 * restricted to the muted bodies and to purple tints, so the bright cyan cores
 * only ever appear where there is nothing to read, and the scrim is shaped to
 * the same zone. The margin matters: a clump seeded well clear of the text can
 * still wander 12% of the width back into it, and checking only its seeded
 * position would miss that. The brightest frame behind text lands near 5.4:1
 * against #F4F4F8 at worst, comfortably past AA. A shorter scrim across the top
 * does the same for the nav, which sits transparent over this at the top of
 * every page.
 *
 * COST. The goo filter is the expensive part: four full-region passes that have
 * to run again on every frame the wax moves. Three things keep that in bounds.
 *
 *   - The field stops when nobody is looking at it. An IntersectionObserver
 *     pauses every animation once the hero scrolls out of range, and the tab's
 *     visibility does the same. A paused field paints once and then costs
 *     nothing, which matters because this hero sits at the top of every page and
 *     readers spend most of their time below it.
 *   - Wide viewports use a tighter filter region. The region is a percentage of
 *     the element, so a 20% margin that is right at phone widths becomes 380
 *     unused pixels a side at 1920, all of it blurred and then thrown away by
 *     the hero's own `overflow: hidden`. Past 1280px the region drops to 12%,
 *     which still clears the 78px the 26px blur actually reaches.
 *   - Machines that cannot keep up drop to a single blur pass. See the probe
 *     below.
 *
 * Under prefers-reduced-motion every CSS animation stops, leaving a still,
 * fully branded molten frame.
 */

/* ---------- seeded randomness ---------- */

/** mulberry32. Small, fast, and good enough for scattering decorative shapes. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rand: () => number, min: number, max: number) =>
  min + rand() * (max - min);

const pick = <T,>(rand: () => number, list: readonly T[]): T =>
  list[Math.floor(rand() * list.length)];

/* ---------- palette ---------- */

/**
 * Bodies whose brightest pixel still clears AA behind text. Purples plus the
 * one teal dim enough to qualify: #0E7490 at the wax layer's opacity measures
 * 5.4:1 against #F4F4F8 before any scrim, where a #22D3EE core measures 2:1.
 * That single number is why the palette is split at all.
 */
const MUTED_BODIES = [
  "radial-gradient(circle at 34% 28%, #8B5CF6 0%, #6D28D9 30%, #4C1D95 72%, rgba(58, 22, 112, 0.94) 100%)",
  "radial-gradient(circle at 32% 26%, #7C3AED 0%, #5B21B6 32%, #3B1466 74%, rgba(46, 16, 101, 0.94) 100%)",
  "radial-gradient(circle at 34% 28%, #6D28D9 0%, #4C1D95 34%, #2E1065 76%, rgba(36, 12, 80, 0.94) 100%)",
  "radial-gradient(circle at 32% 26%, #7C3AED 0%, #4C1D95 34%, #155E75 80%, rgba(19, 78, 99, 0.94) 100%)",
  "radial-gradient(circle at 34% 26%, #0E7490 0%, #155E75 34%, #134E63 78%, rgba(19, 78, 99, 0.94) 100%)",
] as const;

/** Everything, including the bright cores. Only for clumps that never reach
 *  the page's text. */
const OPEN_BODIES = [
  ...MUTED_BODIES,
  "radial-gradient(circle at 30% 24%, #A855F7 0%, #6D28D9 30%, #4C1D95 74%, rgba(58, 22, 112, 0.94) 100%)",
  "radial-gradient(circle at 36% 28%, #22D3EE 0%, #0E7490 30%, #155E75 74%, rgba(19, 78, 99, 0.94) 100%)",
  "radial-gradient(circle at 36% 26%, #22D3EE 0%, #0891B2 32%, #134E63 76%, rgba(19, 78, 99, 0.94) 100%)",
  "radial-gradient(circle at 34% 26%, #0E7490 0%, #155E75 34%, #4C1D95 84%, rgba(58, 22, 112, 0.94) 100%)",
] as const;

/** Tint plates. Brand cyan, brand purple, and a blend of the two. */
const TINT_PURPLE =
  "radial-gradient(circle at 34% 28%, #A855F7 0%, #7C3AED 40%, #4C1D95 82%, rgba(58, 22, 112, 0.94) 100%)";
const TINT_CYAN =
  "radial-gradient(circle at 34% 28%, #22D3EE 0%, #0E7490 40%, #155E75 82%, rgba(19, 78, 99, 0.94) 100%)";
const TINT_BLEND =
  "radial-gradient(circle at 34% 28%, #A855F7 0%, #7C3AED 34%, #0E7490 78%, rgba(19, 78, 99, 0.94) 100%)";

const PATHS = ["a", "b", "c", "d"] as const;
const DIRECTIONS = ["normal", "reverse"] as const;

/** Eight lanes across the width, jittered, so clumps spread without clustering. */
const LANES = [6, 19, 31, 43, 55, 67, 79, 90] as const;

/**
 * Where a page's hero text sits, as a fraction of the field's width. Pages
 * declare this so the field can protect their copy without every hero having to
 * be measured by hand:
 *
 *   - `left`   Headline and body pinned left. A `max-w-3xl` heading inside a
 *              `max-w-7xl` container reaches about 0.59 at common widths, so
 *              the zone runs to 0.62.
 *   - `center` Narrower `max-w-5xl` containers, where the text block sits
 *              inboard of both edges.
 *   - `wide`   Content spans the full width. Nothing is treated as clear.
 *
 * `scrim` is the veil painted over the field for that zone, and `bodies` is how
 * far a clump's wander has to stay outside the zone before it may use a bright
 * core. The margin covers the fact that a clump travels: seeded at 0.70 with a
 * 21rem span it can drift back to roughly 0.58, which is still behind a
 * left-aligned headline.
 */
export type HeroCopyZone = "left" | "center" | "wide";

const COPY_MARGIN = 0.12;

const ZONES: Record<HeroCopyZone, { start: number; end: number; scrim: string }> = {
  left: {
    start: 0,
    end: 0.62,
    scrim:
      "linear-gradient(to right, rgba(20, 8, 38, 0.50) 0%, rgba(20, 8, 38, 0.38) 30%, rgba(20, 8, 38, 0.16) 56%, transparent 74%)",
  },
  center: {
    start: 0.12,
    end: 0.72,
    scrim:
      "linear-gradient(to right, transparent 0%, rgba(20, 8, 38, 0.26) 10%, rgba(20, 8, 38, 0.46) 40%, rgba(20, 8, 38, 0.38) 68%, transparent 88%)",
  },
  wide: {
    start: 0,
    end: 1,
    scrim: "linear-gradient(to bottom, rgba(20, 8, 38, 0.30) 0%, rgba(20, 8, 38, 0.30) 100%)",
  },
};

/** How many clumps may carry a color-drift plate. Never all of them. */
const MAX_TINTED = 4;

type Clump = {
  left: number;
  /** Vertical anchor as a percentage from `anchor`. */
  offset: number;
  anchor: "top" | "bottom";
  height: number;
  width: number;
  background: string;
  path: (typeof PATHS)[number];
  morph: (typeof PATHS)[number];
  spanX: number;
  spanY: number;
  duration: number;
  delay: number;
  direction: (typeof DIRECTIONS)[number];
  morphDuration: number;
  morphDelay: number;
  morphDirection: (typeof DIRECTIONS)[number];
  tint: { background: string; peak: number; duration: number; delay: number } | null;
};

function buildClumps(seed: number, zone: HeroCopyZone): Clump[] {
  const rand = makeRandom(seed);
  const { start, end } = ZONES[zone];
  let tinted = 0;

  return LANES.map((lane, i) => {
    const left = lane + between(rand, -4, 4);
    const anchor: "top" | "bottom" = i % 2 === 0 ? "top" : "bottom";
    const offset = between(rand, 3, 30);
    const height = between(rand, 9.5, 16);
    // Does this clump's travel ever put it behind the page's text?
    const cx = left / 100;
    const nearCopy = cx + COPY_MARGIN >= start && cx - COPY_MARGIN <= end;

    // A tint is a coin flip until the cap is reached. Cyan and the blend stay
    // clear of the copy; purple over a purple body barely moves the luminance,
    // so it is safe anywhere.
    let tint: Clump["tint"] = null;
    if (tinted < MAX_TINTED && rand() < 0.5) {
      tinted += 1;
      tint = {
        background: nearCopy
          ? TINT_PURPLE
          : pick(rand, [TINT_PURPLE, TINT_CYAN, TINT_BLEND]),
        peak: between(rand, 0.55, 0.85),
        duration: between(rand, 24, 58),
        delay: -between(rand, 0, 60),
      };
    }

    return {
      left,
      offset,
      anchor,
      height,
      width: height * between(rand, 0.86, 1.06),
      background: pick(rand, nearCopy ? MUTED_BODIES : OPEN_BODIES),
      path: pick(rand, PATHS),
      morph: pick(rand, PATHS),
      spanX: between(rand, 11, 21),
      spanY: between(rand, 13, 25),
      duration: between(rand, 26, 56),
      delay: -between(rand, 0, 60),
      direction: pick(rand, DIRECTIONS),
      morphDuration: between(rand, 6.5, 12.5),
      morphDelay: -between(rand, 0, 14),
      morphDirection: pick(rand, DIRECTIONS),
      tint,
    };
  });
}

/* ---------- adaptive quality ---------- */

/**
 * Some machines cannot run a four-pass filter over a full-width layer at
 * anything like a usable frame rate, and when that happens the cost does not
 * stay in the hero: the main thread is busy enough that menus and typing lag
 * behind the reader. So the field measures itself and steps down if it has to.
 *
 * The probe waits until hydration and the first data paint are well past, then
 * samples the gap between real frames and takes the median. Median rather than
 * mean because one 400ms stall from somewhere else on the page should not
 * condemn a machine that is otherwise fine. Past 32ms the browser is holding
 * under about 31fps with the field on screen, at which point the merge is
 * already stuttering and is buying nothing for what it costs.
 *
 * A downgraded field trades the metaball merge for one blur pass: the clumps
 * keep their colors, motion, and soft edges but stop bridging into each other.
 * The verdict is cached for the session so the next page starts light instead
 * of measuring its way through the same jank again.
 */
const LITE_STORAGE_KEY = "ffb-hero-lite";
const PROBE_DELAY_MS = 2000;
const PROBE_SAMPLES = 90;
const PROBE_MEDIAN_LIMIT_MS = 32;

function readLiteVerdict(): boolean | null {
  try {
    const stored = window.sessionStorage.getItem(LITE_STORAGE_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // Private modes and locked-down profiles throw on sessionStorage. Measure
    // again rather than giving up on the downgrade entirely.
  }
  return null;
}

function writeLiteVerdict(lite: boolean): void {
  try {
    window.sessionStorage.setItem(LITE_STORAGE_KEY, lite ? "1" : "0");
  } catch {
    // Same as above. The verdict still applies to this page.
  }
}

export function HeroLavaLamp({
  seed,
  copy = "left",
}: {
  seed: number;
  copy?: HeroCopyZone;
}) {
  const clumps = useMemo(() => buildClumps(seed, copy), [seed, copy]);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Both default to the running state so the server HTML and the client's first
  // render agree. Anything else would either mismatch on hydration or blink.
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const [lite, setLite] = useState(false);
  const idle = !onScreen || !tabVisible;

  /* Stop the field when nobody can see it. This is the single biggest saving
     here: the hero sits at the top of every page, so on any page with content
     the reader spends most of their time with it scrolled away, and a paused
     field paints once and then costs nothing at all. The margin resumes it just
     before it scrolls back in, so it is never caught frozen. */
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setOnScreen(entry.isIntersecting);
      },
      { rootMargin: "240px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onVisibility = () => setTabVisible(!document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  /* Frame-pacing probe. Only runs while the field is actually on screen and
     animating, otherwise it would measure a page with the hero paused, decide
     the machine is fine, and cache that for the whole session. */
  useEffect(() => {
    if (idle || lite) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const cached = readLiteVerdict();
    if (cached !== null) {
      if (cached) setLite(true);
      return;
    }

    let frame = 0;
    let previous = 0;
    const gaps: number[] = [];

    const sample = (now: number) => {
      if (previous !== 0) gaps.push(now - previous);
      previous = now;

      if (gaps.length < PROBE_SAMPLES) {
        frame = requestAnimationFrame(sample);
        return;
      }

      const sorted = [...gaps].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const slow = median > PROBE_MEDIAN_LIMIT_MS;
      writeLiteVerdict(slow);
      if (slow) setLite(true);
    };

    const start = window.setTimeout(() => {
      frame = requestAnimationFrame(sample);
    }, PROBE_DELAY_MS);

    return () => {
      window.clearTimeout(start);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [idle, lite]);

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className={`lava-field pointer-events-none absolute inset-0 overflow-hidden${
        idle ? " lava-idle" : ""
      }${lite ? " lava-lite" : ""}`}
    >
      {/* The goo filter. `colorInterpolationFilters="sRGB"` is not optional: the
          default linearRGB washes the brand colors out badly. The zero-size
          absolutely positioned host is the pattern Safari needs to keep the
          filter live.

          Two copies of the same graph, differing only in region. The region is
          expressed as a percentage of the element, so one setting cannot suit
          both a 375px phone and a 1920px desktop: 20% is 75px on the phone,
          which the 26px blur needs, and 384px on the desktop, almost all of it
          blurred and then discarded by the hero's `overflow: hidden`. The CSS
          picks the tighter one past 1280px, where 12% still clears 78px. */}
      <svg
        width="0"
        height="0"
        focusable="false"
        aria-hidden="true"
        style={{ position: "absolute" }}
      >
        <defs>
          <filter
            id="hero-lava-goo"
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation="26" result="blurred" />
            {/* Alpha contrast ramp: out = 24a - 11, so a < 0.46 falls away and
                anything above snaps solid. This is the metaball threshold, and
                the whole reason bridges form and pinch. */}
            <feColorMatrix
              in="blurred"
              type="matrix"
              values="1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      0 0 0 24 -11"
              result="goo"
            />
            {/* Put the original clumps back inside the merged silhouette so each
                keeps its gradient and looks molten rather than flat. */}
            <feComposite in="SourceGraphic" in2="goo" operator="atop" result="molten" />
            <feGaussianBlur in="molten" stdDeviation="3" />
          </filter>

          <filter
            id="hero-lava-goo-wide"
            x="-6%"
            y="-20%"
            width="112%"
            height="140%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation="26" result="blurred" />
            <feColorMatrix
              in="blurred"
              type="matrix"
              values="1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      0 0 0 24 -11"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" result="molten" />
            <feGaussianBlur in="molten" stdDeviation="3" />
          </filter>
        </defs>
      </svg>

      {/* Base of the color field: purple through to a teal-leaning deep blue. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(155deg, #2A1348 0%, #35127A 34%, #241350 62%, #133048 100%)",
        }}
      />

      {/* Drifting washes. Bright and deep purples with teal mixed through, so
          the field keeps shifting instead of sitting flat behind the clumps. */}
      {WASHES.map((wash, i) => (
        <div
          key={i}
          className={`lava-wash lava-wash-${wash.drift} ${wash.className}`}
          style={{
            background: wash.background,
            animationDuration: wash.duration,
            animationDelay: wash.delay,
          }}
        />
      ))}

      {/* The wax. Everything in here merges. */}
      <div className="lava-wax-layer absolute inset-0">
        {/* Shallow pool across the base, so clumps have a mass to sink into and
            separate from near the bottom of the frame. */}
        <div
          className="lava-wax lava-pool -bottom-[9rem] -left-[10%] h-[16rem] w-[120%]"
          style={{
            background:
              "linear-gradient(to top, #3B1466 0%, #5B21B6 58%, #6D28D9 100%)",
            transformOrigin: "50% 100%",
            animationDuration: "24s",
          }}
        />

        {clumps.map((clump, i) => (
          <div
            key={i}
            className={`lava-wax lava-wander-${clump.path}`}
            style={{
              left: `${clump.left.toFixed(2)}%`,
              [clump.anchor]: `${clump.offset.toFixed(2)}%`,
              height: `${clump.height.toFixed(2)}rem`,
              width: `${clump.width.toFixed(2)}rem`,
              animationDuration: `${clump.duration.toFixed(2)}s`,
              animationDelay: `${clump.delay.toFixed(2)}s`,
              animationDirection: clump.direction,
              ["--lava-span-x" as string]: `${clump.spanX.toFixed(2)}rem`,
              ["--lava-span-y" as string]: `${clump.spanY.toFixed(2)}rem`,
            }}
          >
            <div
              className={`lava-morph lava-morph-${clump.morph}`}
              style={{
                background: clump.background,
                animationDuration: `${clump.morphDuration.toFixed(2)}s`,
                animationDelay: `${clump.morphDelay.toFixed(2)}s`,
                animationDirection: clump.morphDirection,
              }}
            >
              {clump.tint && (
                <div
                  className="lava-tint"
                  style={{
                    background: clump.tint.background,
                    animationDuration: `${clump.tint.duration.toFixed(2)}s`,
                    animationDelay: `${clump.tint.delay.toFixed(2)}s`,
                    ["--lava-tint-peak" as string]: clump.tint.peak.toFixed(3),
                  }}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* The scrim that used to sit under the transparent header is gone. The
          header is an opaque bar now, and the field no longer runs behind it,
          so darkening the top of the hero only made the hero darker. */}

      {/* Copy scrim, shaped to wherever this page's hero text sits. Tinted deep
          purple rather than black so it reads as part of the field. */}
      <div
        className="absolute inset-0"
        style={{ background: ZONES[copy].scrim }}
      />

      {/* Soft floor, so the field settles into the section below instead of
          stopping at a hard line. */}
      <div
        className="absolute inset-x-0 bottom-0 h-24"
        style={{
          background:
            "linear-gradient(to bottom, transparent 0%, rgba(9, 6, 20, 0.62) 100%)",
        }}
      />
    </div>
  );
}

/* ---------- the color field ---------- */

type Wash = {
  className: string;
  background: string;
  drift: "a" | "b" | "c";
  duration: string;
  delay: string;
};

/** Bright purple, deep purple, and teal, all in motion. Fixed rather than
 *  seeded: the field is the constant the clumps are randomized against. */
const WASHES: Wash[] = [
  {
    className: "-left-[15%] -top-[20%] h-[46rem] w-[52rem]",
    background:
      "radial-gradient(ellipse at center, rgba(124, 58, 237, 0.66) 0%, rgba(124, 58, 237, 0.26) 45%, transparent 72%)",
    drift: "a",
    duration: "62s",
    delay: "-11s",
  },
  {
    className: "left-[22%] -bottom-[26%] h-[42rem] w-[48rem]",
    background:
      "radial-gradient(ellipse at center, rgba(168, 85, 247, 0.40) 0%, rgba(168, 85, 247, 0.16) 48%, transparent 74%)",
    drift: "c",
    duration: "71s",
    delay: "-24s",
  },
  {
    className: "left-[8%] top-[18%] h-[38rem] w-[40rem]",
    background:
      "radial-gradient(ellipse at center, rgba(30, 10, 60, 0.78) 0%, rgba(30, 10, 60, 0.34) 46%, transparent 74%)",
    drift: "b",
    duration: "68s",
    delay: "-41s",
  },
  {
    className: "right-[6%] top-[6%] h-[44rem] w-[50rem]",
    background:
      "radial-gradient(ellipse at center, rgba(14, 116, 144, 0.62) 0%, rgba(21, 94, 117, 0.24) 46%, transparent 74%)",
    drift: "b",
    duration: "51s",
    delay: "-19s",
  },
  {
    className: "-right-[12%] -bottom-[18%] h-[40rem] w-[44rem]",
    background:
      "radial-gradient(ellipse at center, rgba(34, 211, 238, 0.28) 0%, rgba(14, 116, 144, 0.16) 48%, transparent 74%)",
    drift: "a",
    duration: "76s",
    delay: "-53s",
  },
  {
    className: "left-[52%] -top-[24%] h-[36rem] w-[42rem]",
    background:
      "radial-gradient(ellipse at center, rgba(46, 16, 101, 0.72) 0%, rgba(46, 16, 101, 0.30) 48%, transparent 76%)",
    drift: "c",
    duration: "44s",
    delay: "-30s",
  },
];
