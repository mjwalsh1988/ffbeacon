"use client";

import { useEffect, useMemo, useRef } from "react";

/**
 * Lava lamp backdrop for the homepage hero.
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
 * FOUR MOTIONS, ALL DECOUPLED. Each clump is three nested elements so the
 * transforms never fight:
 *
 *   1. Travel (outer). A wandering closed loop that reverses direction several
 *      times per cycle, 26s to 56s, running forward or reversed.
 *   2. Shockwave push (middle). Idle until a pulse sweeps past; see below.
 *   3. Shape (inner). `border-radius`, non-uniform scale, and rotation on a much
 *      faster 6.5s to 12.5s clock, swinging roughly 0.78 to 1.28 per axis, so a
 *      clump squashes wide, stretches tall, and rolls over several times per
 *      trip.
 *   4. Color drift (tint plate). Some clumps carry a plate that cross-fades
 *      toward brand cyan #22D3EE, brand purple #A855F7, or a blend of the two,
 *      then back to the clump's own color, on its own long cycle.
 *
 * DIFFERENT ON EVERY REFRESH. The page passes a fresh `seed` per request (it is
 * `force-dynamic`), and every clump's lane, size, path, direction, speed, phase,
 * deformation pattern, color, and tint are derived from it through a mulberry32
 * PRNG. Deriving rather than calling `Math.random()` during render is what keeps
 * the server HTML and the client's first render byte-identical, so there is no
 * hydration mismatch and no re-shuffle flash after mount. The only `Math.random`
 * calls happen inside the pulse loop, which runs after mount and so cannot
 * desync anything.
 *
 * THE PULSE. Every 5s to 15s a wide, soft wave enters from one corner and
 * travels diagonally across the field. As it arrives, each clump gets a push
 * along the wave's direction plus a squash and rebound, delayed by how far along
 * the wave's path that clump sits, so the disturbance travels with the wave
 * rather than hitting everything at once. Direction (all four corner pairs,
 * jittered), strength, sweep time, and per-clump push are randomized per pulse.
 * Afterwards each clump settles back into its own wander with nothing latched,
 * because the disturbance animations use `fill: "none"`.
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
 * Under prefers-reduced-motion every CSS animation stops and the pulse loop
 * never starts, leaving a still, fully branded molten frame.
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
  /** Normalized center, for projecting onto a pulse's direction. */
  cx: number;
  cy: number;
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
      cx,
      cy: anchor === "top" ? offset / 100 : 1 - offset / 100,
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

/* ---------- the pulse ---------- */

/** Rotations for the four corner-to-corner diagonals, in screen space. */
const PULSE_ANGLES = [35, 145, 215, 325] as const;

const PULSE_MIN_GAP_MS = 5000;
const PULSE_MAX_GAP_MS = 15000;

/**
 * Where a clump sits along a wave's direction, as 0 (first touched) to 1 (last).
 * The projection is normalized against the range the unit square spans for that
 * direction, so the delays always cover the whole sweep whichever way it runs.
 */
function projection(cx: number, cy: number, dx: number, dy: number): number {
  const min = Math.min(0, dx) + Math.min(0, dy);
  const max = Math.max(0, dx) + Math.max(0, dy);
  const span = max - min;
  if (span === 0) return 0.5;
  return (cx * dx + cy * dy - min) / span;
}

export function HeroLavaLamp({
  seed,
  copy = "left",
}: {
  seed: number;
  copy?: HeroCopyZone;
}) {
  const clumps = useMemo(() => buildClumps(seed, copy), [seed, copy]);
  const pulseRefs = useRef<Array<HTMLDivElement | null>>([]);
  const waveRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof Element.prototype.animate !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    let timer: number | undefined;

    const fire = () => {
      const wave = waveRef.current;
      if (!wave) return;

      // Direction, strength, and sweep time are all fresh each pulse.
      const angle =
        PULSE_ANGLES[Math.floor(Math.random() * PULSE_ANGLES.length)] +
        (Math.random() * 24 - 12);
      const radians = (angle * Math.PI) / 180;
      const dx = Math.cos(radians);
      const dy = Math.sin(radians);
      const strength = 0.55 + Math.random() * 0.75;
      const sweep = 2600 + Math.random() * 1600;

      const at = (distance: string) =>
        `translate(-50%, -50%) rotate(${angle}deg) translateX(${distance})`;

      wave.animate(
        [
          { transform: at("-340%"), opacity: 0 },
          { transform: at("-130%"), opacity: 0.5 * strength, offset: 0.24 },
          { transform: at("130%"), opacity: 0.5 * strength, offset: 0.76 },
          { transform: at("340%"), opacity: 0 },
        ],
        { duration: sweep, easing: "linear", fill: "none" },
      );

      clumps.forEach((clump, i) => {
        const el = pulseRefs.current[i];
        if (!el) return;

        const push = (12 + Math.random() * 16) * strength;
        const squash = (0.1 + Math.random() * 0.1) * strength;

        el.animate(
          [
            { transform: "translate(0px, 0px) scale(1, 1)" },
            {
              transform: `translate(${dx * push}px, ${dy * push}px) scale(${(1 + squash).toFixed(3)}, ${(1 - squash * 0.8).toFixed(3)})`,
              offset: 0.34,
            },
            {
              transform: `translate(${(-dx * push * 0.32).toFixed(2)}px, ${(-dy * push * 0.32).toFixed(2)}px) scale(${(1 - squash * 0.55).toFixed(3)}, ${(1 + squash * 0.65).toFixed(3)})`,
              offset: 0.68,
            },
            { transform: "translate(0px, 0px) scale(1, 1)" },
          ],
          {
            duration: 1500,
            // The wave reaches each clump at its own moment, so the ripple
            // crosses the field instead of firing everywhere together.
            delay: projection(clump.cx, clump.cy, dx, dy) * sweep,
            easing: "cubic-bezier(0.33, 0, 0.2, 1)",
            fill: "none",
          },
        );
      });
    };

    const schedule = () => {
      const gap =
        PULSE_MIN_GAP_MS + Math.random() * (PULSE_MAX_GAP_MS - PULSE_MIN_GAP_MS);
      timer = window.setTimeout(() => {
        if (document.visibilityState === "visible") fire();
        schedule();
      }, gap);
    };

    schedule();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [clumps]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* The goo filter. `colorInterpolationFilters="sRGB"` is not optional: the
          default linearRGB washes the brand colors out badly. The zero-size
          absolutely positioned host is the pattern Safari needs to keep the
          filter live. */}
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
      <div
        className="absolute inset-0"
        style={{ filter: "url(#hero-lava-goo)", opacity: 0.88 }}
      >
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
              className="lava-pulse-layer"
              ref={(node) => {
                pulseRefs.current[i] = node;
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
          </div>
        ))}
      </div>

      {/* The shockwave. A wide, soft swell rather than a line: 46% of the field
          across, heavily blurred, screen-blended, and invisible at rest. The
          Web Animations API drives it, so each sweep gets its own angle,
          strength, and speed. */}
      <div
        ref={waveRef}
        className="absolute left-1/2 top-1/2 h-[320%] w-[46%]"
        style={{
          opacity: 0,
          transform: "translate(-50%, -50%)",
          background:
            "linear-gradient(90deg, transparent 0%, rgba(34, 211, 238, 0.07) 26%, rgba(34, 211, 238, 0.15) 42%, rgba(168, 85, 247, 0.19) 50%, rgba(34, 211, 238, 0.15) 58%, rgba(34, 211, 238, 0.07) 74%, transparent 100%)",
          filter: "blur(26px)",
          mixBlendMode: "screen",
        }}
      />

      {/* Nav scrim. The header sits transparent over the top of this at the top
          of the page, so its links need a settled surface underneath. */}
      <div
        className="absolute inset-x-0 top-0 h-28"
        style={{
          background:
            "linear-gradient(to bottom, rgba(15, 6, 30, 0.70) 0%, rgba(15, 6, 30, 0.32) 55%, transparent 100%)",
        }}
      />

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
