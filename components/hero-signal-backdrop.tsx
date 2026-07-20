/**
 * Decorative animated backdrop for the homepage hero.
 *
 * Pure server component (no client JS): the motion is driven entirely by CSS
 * classes defined in globals.css. Every animation here moves ONLY `transform`
 * and `opacity`, both GPU-composited, so no layer repaints per frame (that was
 * the jank in the earlier radar, which animated an SVG radius). Everything
 * collapses to a clean static frame under prefers-reduced-motion.
 *
 * Everything here is decorative and marked aria-hidden, so it never reaches the
 * accessibility tree. The hero's real content carries its own labels.
 *
 * The motif is "signal cutting through noise": a living gradient field with
 * blips and streaks traveling across it, resolving into a rising trend line.
 *
 * Layers (back to front):
 *   - Three drifting gradient-mesh blobs, each wandering on its own organic path
 *     and breathing, for the living Stripe-style gradient motion.
 *   - A soft rotating beacon light off the lower-left corner (a conic gradient
 *     spun by transform), the smooth successor to the old radar rings.
 *   - A faint signal-grid texture, masked so it fades toward the edges, plus a
 *     couple of small dot-grid clusters echoing the banner's dotted accents.
 *   - A rising "signal" line chart, top-right, that draws itself on first paint
 *     and ends in a soft pulsing beacon dot. Evokes "your value is trending up".
 *   - Thin signal streaks that travel across the field (noise into signal).
 *   - Particles wandering on organic 2-D paths, each twinkling.
 *   - Two drifting signal-wave bands along the bottom, purple and cyan, one
 *     slower and dimmer for parallax depth. Each SVG is periodic with matching
 *     halves so a -50% translate loops seamlessly.
 */

// Wandering particle motes. Deterministic positions/timings so server markup and
// any client reconciliation stay identical (no Math.random). Each is assigned one
// of four organic 2-D drift paths (see .hero-drift-* in globals.css) plus its own
// delay so the field never looks synchronized. Kept to the left and center so
// they never fight the Discord card in the right column.
const PARTICLES: {
  left: string;
  top: string;
  size: number;
  color: string;
  drift: "a" | "b" | "c" | "d";
  delay: string;
}[] = [
  { left: "14%", top: "28%", size: 5, color: "#67E8F9", drift: "a", delay: "0s" },
  { left: "26%", top: "58%", size: 4, color: "#C084FC", drift: "c", delay: "1.5s" },
  { left: "42%", top: "20%", size: 6, color: "#22D3EE", drift: "b", delay: "0.7s" },
  { left: "36%", top: "44%", size: 4, color: "#A855F7", drift: "d", delay: "2.2s" },
  { left: "9%", top: "48%", size: 4, color: "#67E8F9", drift: "b", delay: "1.1s" },
  { left: "50%", top: "62%", size: 5, color: "#C084FC", drift: "a", delay: "0.4s" },
  { left: "20%", top: "16%", size: 4, color: "#22D3EE", drift: "d", delay: "2.8s" },
  { left: "31%", top: "37%", size: 3, color: "#A855F7", drift: "c", delay: "3.4s" },
  { left: "6%", top: "66%", size: 4, color: "#67E8F9", drift: "a", delay: "1.9s" },
  { left: "46%", top: "33%", size: 3, color: "#22D3EE", drift: "b", delay: "0.9s" },
];

// Thin signal streaks that travel across the field, evoking a signal cutting
// through the noise. A wrapper holds the static tilt; the inner element does the
// pure translateX sweep (see .hero-streak). Deterministic timing.
const STREAKS: {
  top: string;
  width: string;
  color: string;
  tilt: string;
  delay: string;
  duration: string;
}[] = [
  { top: "23%", width: "180px", color: "rgba(34, 211, 238, 0.55)", tilt: "-8deg", delay: "0s", duration: "11s" },
  { top: "51%", width: "150px", color: "rgba(168, 85, 247, 0.5)", tilt: "6deg", delay: "4.5s", duration: "14s" },
  { top: "69%", width: "200px", color: "rgba(103, 232, 249, 0.5)", tilt: "-4deg", delay: "8s", duration: "9.5s" },
  { top: "37%", width: "120px", color: "rgba(192, 132, 252, 0.45)", tilt: "10deg", delay: "2.5s", duration: "16s" },
];

// Small dotted clusters echoing the Discord banner's dot accents. Rendered via a
// tiled radial-gradient so there is no per-dot markup.
const DOT_CLUSTERS: { className: string; color: string; delay: string }[] = [
  { className: "left-[52%] top-[16%] h-24 w-24", color: "rgba(34, 211, 238, 0.8)", delay: "0s" },
  { className: "left-[3%] bottom-[30%] h-20 w-20", color: "rgba(168, 85, 247, 0.75)", delay: "2.5s" },
];

/**
 * Build a horizontally periodic sine path whose left half is identical to its
 * right half, so the wave loops seamlessly when translated by -50%. Returns the
 * open stroke path and a closed area path (filled down to `bottom`).
 */
function buildWave(opts: {
  width: number;
  midY: number;
  amplitude: number;
  period: number;
  phase: number;
  bottom: number;
  step: number;
}): { line: string; area: string } {
  const { width, midY, amplitude, period, phase, bottom, step } = opts;
  const points: string[] = [];
  for (let x = 0; x <= width; x += step) {
    const y = midY + amplitude * Math.sin((2 * Math.PI * x) / period + phase);
    points.push(`${x} ${y.toFixed(2)}`);
  }
  const line = points.map((p, i) => (i === 0 ? `M ${p}` : `L ${p}`)).join(" ");
  const area = `${line} L ${width} ${bottom} L 0 ${bottom} Z`;
  return { line, area };
}

// Rising line chart points (viewBox 0 0 600 200). Deterministic (no randomness)
// so server markup and any client reconciliation stay identical.
const RISE_POINTS: [number, number][] = [
  [0, 176],
  [56, 168],
  [104, 150],
  [150, 158],
  [206, 130],
  [262, 120],
  [300, 128],
  [356, 94],
  [410, 80],
  [452, 90],
  [508, 52],
  [556, 36],
  [600, 22],
];

const riseLine = RISE_POINTS.map(
  ([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`),
).join(" ");

// Approximate path length so the draw-in dashoffset fully covers the stroke.
const riseLen = Math.ceil(
  RISE_POINTS.reduce((sum, [x, y], i) => {
    if (i === 0) return sum;
    const [px, py] = RISE_POINTS[i - 1];
    return sum + Math.hypot(x - px, y - py);
  }, 0),
);

const [riseTipX, riseTipY] = RISE_POINTS[RISE_POINTS.length - 1];

export function HeroSignalBackdrop() {
  const waveWidth = 1440;
  const waveBottom = 320;
  // Two full sine periods per half (period divides waveWidth / 2) => the left
  // half of the viewBox matches the right half, giving a seamless -50% loop.
  const front = buildWave({
    width: waveWidth,
    midY: 210,
    amplitude: 26,
    period: 360,
    phase: 0,
    bottom: waveBottom,
    step: 12,
  });
  const back = buildWave({
    width: waveWidth,
    midY: 250,
    amplitude: 20,
    period: 360,
    phase: Math.PI / 1.5,
    bottom: waveBottom,
    step: 12,
  });

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* Ambient beacon glow, upper-left, anchoring the headline. */}
      <div
        className="absolute -left-24 -top-32 h-[520px] w-[720px]"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(168, 85, 247, 0.20) 0%, rgba(34, 211, 238, 0.08) 45%, transparent 72%)",
        }}
      />

      {/* Drifting gradient-mesh blobs. Each wanders on its own organic path and
          breathes, giving the field the living motion of a Stripe hero. Motion is
          transform-only (GPU-composited), so there is nothing to repaint. */}
      <div
        className="hero-blob-a absolute -top-24 left-[22%] h-[30rem] w-[30rem] rounded-full"
        style={{
          background:
            "radial-gradient(circle at center, rgba(168, 85, 247, 0.28) 0%, rgba(168, 85, 247, 0.09) 45%, transparent 72%)",
        }}
      />
      <div
        className="hero-blob-b absolute top-[16%] left-[47%] h-[26rem] w-[26rem] rounded-full"
        style={{
          background:
            "radial-gradient(circle at center, rgba(34, 211, 238, 0.24) 0%, rgba(34, 211, 238, 0.08) 45%, transparent 72%)",
        }}
      />
      <div
        className="hero-blob-c absolute -bottom-28 left-[6%] h-[34rem] w-[34rem] rounded-full"
        style={{
          background:
            "radial-gradient(circle at center, rgba(124, 58, 237, 0.22) 0%, rgba(34, 211, 238, 0.06) 48%, transparent 74%)",
        }}
      />

      {/* Soft rotating beacon light, anchored off the lower-left corner. A single
          conic gradient rotated by transform (cheap, GPU-composited), so it sweeps
          smoothly with nothing to repaint. Replaces the old radar rings. */}
      <div
        className="hero-beacon-sweep absolute bottom-[-18rem] left-[-18rem] h-[40rem] w-[40rem] rounded-full sm:bottom-[-16rem] sm:left-[-16rem] sm:h-[52rem] sm:w-[52rem]"
        style={{
          background:
            "conic-gradient(from 0deg, transparent 0deg, rgba(34, 211, 238, 0.10) 18deg, rgba(168, 85, 247, 0.05) 40deg, transparent 72deg)",
          maskImage:
            "radial-gradient(circle at center, #000 0%, #000 55%, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(circle at center, #000 0%, #000 55%, transparent 78%)",
        }}
      />

      {/* Faint signal-grid texture, masked so it fades toward the edges. */}
      <div
        className="absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(168, 85, 247, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(34, 211, 238, 0.045) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse 90% 75% at 60% 40%, #000 30%, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 90% 75% at 60% 40%, #000 30%, transparent 78%)",
        }}
      />

      {/* Dotted accent clusters, echoing the Discord banner. Tiled radial dots,
          gently pulsing. Hidden on the smallest screens to avoid clutter. */}
      {DOT_CLUSTERS.map((cluster, i) => (
        <div
          key={i}
          className={`hero-dotgrid absolute hidden sm:block ${cluster.className}`}
          style={{
            backgroundImage: `radial-gradient(${cluster.color} 1.3px, transparent 1.6px)`,
            backgroundSize: "13px 13px",
            maskImage: "radial-gradient(circle at center, #000 20%, transparent 72%)",
            WebkitMaskImage:
              "radial-gradient(circle at center, #000 20%, transparent 72%)",
            animationDelay: cluster.delay,
          }}
        />
      ))}

      {/* Rising "line goes up" signal chart, top-right. */}
      <div className="absolute -top-6 right-0 hidden h-64 w-[46%] max-w-2xl md:block lg:w-[42%]">
        <svg
          viewBox="0 0 600 200"
          preserveAspectRatio="none"
          className="h-full w-full"
        >
          <defs>
            <linearGradient id="hero-rise-stroke" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#A855F7" />
              <stop offset="100%" stopColor="#22D3EE" />
            </linearGradient>
            <linearGradient id="hero-rise-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(34, 211, 238, 0.16)" />
              <stop offset="100%" stopColor="rgba(34, 211, 238, 0)" />
            </linearGradient>
          </defs>
          <path
            d={`${riseLine} L 600 200 L 0 200 Z`}
            fill="url(#hero-rise-fill)"
            opacity={0.7}
          />
          <path
            d={riseLine}
            fill="none"
            stroke="url(#hero-rise-stroke)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="hero-signal-line"
            style={{ ["--hero-line-len" as string]: String(riseLen) }}
          />
          {/* Pulsing beacon at the tip of the rising line. */}
          <circle
            cx={riseTipX}
            cy={riseTipY}
            fill="none"
            stroke="#22D3EE"
            strokeWidth={1.5}
            className="hero-pulse-halo"
          />
          <circle cx={riseTipX} cy={riseTipY} fill="#67E8F9" className="hero-pulse-dot" />
        </svg>
      </div>

      {/* Signal streaks traveling across the field. Outer wrapper carries the
          static tilt; inner element does the pure translateX sweep. */}
      {STREAKS.map((s, i) => (
        <span
          key={`streak-${i}`}
          className="absolute left-0 block"
          style={{ top: s.top, transform: `rotate(${s.tilt})` }}
        >
          <span
            className="hero-streak block h-px rounded-full"
            style={{
              width: s.width,
              background: `linear-gradient(90deg, transparent, ${s.color}, transparent)`,
              animationDelay: s.delay,
              animationDuration: s.duration,
            }}
          />
        </span>
      ))}

      {/* Signal particles wandering on organic 2-D paths, each twinkling. */}
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className={`hero-particle hero-drift-${p.drift} absolute rounded-full`}
          style={{
            left: p.left,
            top: p.top,
            height: `${p.size}px`,
            width: `${p.size}px`,
            backgroundColor: p.color,
            boxShadow: `0 0 12px ${p.color}, 0 0 4px ${p.color}`,
            animationDelay: p.delay,
          }}
        />
      ))}

      {/* Drifting signal-wave bands along the bottom. */}
      <div className="absolute inset-x-0 bottom-0 h-40 sm:h-56">
        <svg
          viewBox={`0 0 ${waveWidth} ${waveBottom}`}
          preserveAspectRatio="none"
          className="hero-wave hero-wave--slow absolute inset-y-0 left-0 h-full w-[200%]"
        >
          <path d={back.area} fill="rgba(124, 58, 237, 0.06)" />
          <path
            d={back.line}
            fill="none"
            stroke="rgba(124, 58, 237, 0.35)"
            strokeWidth={2}
          />
        </svg>
        <svg
          viewBox={`0 0 ${waveWidth} ${waveBottom}`}
          preserveAspectRatio="none"
          className="hero-wave absolute inset-y-0 left-0 h-full w-[200%]"
        >
          <path d={front.area} fill="rgba(34, 211, 238, 0.05)" />
          <path
            d={front.line}
            fill="none"
            stroke="rgba(34, 211, 238, 0.45)"
            strokeWidth={2}
          />
        </svg>
      </div>
    </div>
  );
}
