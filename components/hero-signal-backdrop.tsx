/**
 * Decorative animated backdrop for the homepage hero.
 *
 * Pure server component (no client JS): the motion is driven entirely by CSS
 * classes defined in globals.css (`hero-wave`, `hero-signal-line`,
 * `hero-pulse-dot`, `hero-pulse-halo`), all of which collapse to a static frame
 * under prefers-reduced-motion.
 *
 * Everything here is decorative and marked aria-hidden, so it never reaches the
 * accessibility tree. The hero's real content carries its own labels.
 *
 * Layers:
 *   - A rising "signal" line chart, top-right, that draws itself on first paint
 *     and ends in a soft pulsing beacon dot. Evokes "your value is trending up".
 *   - Two drifting signal-wave bands along the bottom, purple and cyan, one
 *     slower and dimmer for parallax depth. Each SVG is periodic with matching
 *     halves so a -50% translate loops seamlessly.
 */

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
