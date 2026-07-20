/**
 * Reusable animated hero backdrop for the inner pages (rankings, tools, games,
 * about, guides, author, ...). It shares the GPU-only motion vocabulary defined
 * in globals.css: drifting gradient-mesh blobs (`hero-blob-*`), a soft rotating
 * beacon light (`hero-beacon-sweep`), particles wandering on organic 2-D paths
 * (`hero-particle` + `hero-drift-*`), and thin traveling signal streaks
 * (`hero-streak`), plus faint dotted clusters (`hero-dotgrid`).
 *
 * The homepage keeps the richer HeroSignalBackdrop (which adds the rising trend
 * line and the drifting waves); inner pages use this lighter "aurora" treatment
 * so they read as part of the same family without being identical.
 *
 * Everything here is decorative and marked aria-hidden, so it never reaches the
 * accessibility tree. Every animation moves ONLY transform/opacity (GPU
 * composited, nothing repaints per frame) and collapses to a clean static frame
 * under prefers-reduced-motion (handled in globals.css).
 *
 * The `variant` shifts where the visual weight sits so each hero differs:
 *   - "right"  : weighted to the right (use when the hero copy is left-aligned).
 *   - "left"   : weighted to the left.
 *   - "center" : symmetric (use for centered heroes).
 *   - "soft"   : fewer elements, no beacon sweep (compact / dense heroes).
 */

type HeroAmbienceVariant = "left" | "right" | "center" | "soft";

type Blob = { key: "a" | "b" | "c"; className: string; background: string };
type Particle = {
  left: string;
  top: string;
  size: number;
  color: string;
  drift: "a" | "b" | "c" | "d";
  delay: string;
};
type Streak = {
  top: string;
  width: string;
  color: string;
  tilt: string;
  delay: string;
  duration: string;
};

const BLOB_PURPLE =
  "radial-gradient(circle at center, rgba(168, 85, 247, 0.26) 0%, rgba(168, 85, 247, 0.08) 45%, transparent 72%)";
const BLOB_CYAN =
  "radial-gradient(circle at center, rgba(34, 211, 238, 0.22) 0%, rgba(34, 211, 238, 0.07) 45%, transparent 72%)";
const BLOB_VIOLET =
  "radial-gradient(circle at center, rgba(124, 58, 237, 0.20) 0%, rgba(34, 211, 238, 0.06) 48%, transparent 74%)";

// Blob arrangements per variant. Each blob is assigned one of the three organic
// drift keyframes (a/b/c) so their wander paths differ.
const BLOB_SETS: Record<HeroAmbienceVariant, Blob[]> = {
  right: [
    { key: "a", className: "-top-24 right-[16%] h-[30rem] w-[30rem]", background: BLOB_PURPLE },
    { key: "b", className: "top-[12%] right-[4%] h-[26rem] w-[26rem]", background: BLOB_CYAN },
    { key: "c", className: "-bottom-28 right-[22%] h-[34rem] w-[34rem]", background: BLOB_VIOLET },
  ],
  left: [
    { key: "a", className: "-top-24 left-[16%] h-[30rem] w-[30rem]", background: BLOB_PURPLE },
    { key: "b", className: "top-[12%] left-[4%] h-[26rem] w-[26rem]", background: BLOB_CYAN },
    { key: "c", className: "-bottom-28 left-[22%] h-[34rem] w-[34rem]", background: BLOB_VIOLET },
  ],
  center: [
    { key: "a", className: "-top-24 left-[28%] h-[28rem] w-[28rem]", background: BLOB_PURPLE },
    { key: "b", className: "top-[16%] right-[20%] h-[24rem] w-[24rem]", background: BLOB_CYAN },
    { key: "c", className: "-bottom-28 left-[36%] h-[32rem] w-[32rem]", background: BLOB_VIOLET },
  ],
  soft: [
    { key: "a", className: "-top-20 right-[18%] h-[26rem] w-[26rem]", background: BLOB_PURPLE },
    { key: "b", className: "-bottom-24 left-[8%] h-[28rem] w-[28rem]", background: BLOB_CYAN },
  ],
};

// Beacon sweep anchor per variant (null = no sweep). Never use translate
// utilities here: the sweep animates `transform: rotate`, so a translate class
// would fight the animation.
const SWEEP_CLASS: Record<HeroAmbienceVariant, string | null> = {
  right:
    "bottom-[-16rem] right-[-16rem] h-[40rem] w-[40rem] sm:bottom-[-14rem] sm:right-[-14rem] sm:h-[50rem] sm:w-[50rem]",
  left: "bottom-[-16rem] left-[-16rem] h-[40rem] w-[40rem] sm:bottom-[-14rem] sm:left-[-14rem] sm:h-[50rem] sm:w-[50rem]",
  center: "bottom-[-22rem] left-[24%] h-[44rem] w-[44rem] sm:h-[52rem] sm:w-[52rem]",
  soft: null,
};

// Full particle field, spread across the width. "soft" uses the first six.
const PARTICLES: Particle[] = [
  { left: "10%", top: "30%", size: 5, color: "#67E8F9", drift: "a", delay: "0s" },
  { left: "22%", top: "58%", size: 4, color: "#C084FC", drift: "c", delay: "1.5s" },
  { left: "34%", top: "22%", size: 6, color: "#22D3EE", drift: "b", delay: "0.7s" },
  { left: "44%", top: "48%", size: 4, color: "#A855F7", drift: "d", delay: "2.2s" },
  { left: "56%", top: "32%", size: 4, color: "#67E8F9", drift: "b", delay: "1.1s" },
  { left: "66%", top: "60%", size: 5, color: "#C084FC", drift: "a", delay: "0.4s" },
  { left: "77%", top: "24%", size: 4, color: "#22D3EE", drift: "d", delay: "2.8s" },
  { left: "85%", top: "46%", size: 3, color: "#A855F7", drift: "c", delay: "3.4s" },
  { left: "14%", top: "70%", size: 4, color: "#67E8F9", drift: "a", delay: "1.9s" },
  { left: "50%", top: "68%", size: 3, color: "#22D3EE", drift: "b", delay: "0.9s" },
];

// Traveling signal streaks. "soft" uses the first two.
const STREAKS: Streak[] = [
  { top: "24%", width: "180px", color: "rgba(34, 211, 238, 0.5)", tilt: "-8deg", delay: "0s", duration: "12s" },
  { top: "62%", width: "150px", color: "rgba(168, 85, 247, 0.45)", tilt: "6deg", delay: "4.5s", duration: "15s" },
  { top: "44%", width: "200px", color: "rgba(103, 232, 249, 0.45)", tilt: "-4deg", delay: "8s", duration: "10s" },
];

export function HeroAmbience({
  variant = "right",
}: {
  variant?: HeroAmbienceVariant;
}) {
  const blobs = BLOB_SETS[variant];
  const sweep = SWEEP_CLASS[variant];
  const particles = variant === "soft" ? PARTICLES.slice(0, 6) : PARTICLES;
  const streaks = variant === "soft" ? STREAKS.slice(0, 2) : STREAKS;
  const showDots = variant !== "soft";

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* Drifting gradient-mesh blobs. */}
      {blobs.map((blob) => (
        <div
          key={blob.key}
          className={`hero-blob-${blob.key} absolute rounded-full ${blob.className}`}
          style={{ background: blob.background }}
        />
      ))}

      {/* Soft rotating beacon light (skipped on the "soft" variant). */}
      {sweep && (
        <div
          className={`hero-beacon-sweep absolute rounded-full ${sweep}`}
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, rgba(34, 211, 238, 0.10) 18deg, rgba(168, 85, 247, 0.05) 40deg, transparent 72deg)",
            maskImage:
              "radial-gradient(circle at center, #000 0%, #000 55%, transparent 78%)",
            WebkitMaskImage:
              "radial-gradient(circle at center, #000 0%, #000 55%, transparent 78%)",
          }}
        />
      )}

      {/* Faint dotted accent clusters, echoing the Discord banner. */}
      {showDots && (
        <>
          <div
            className="hero-dotgrid absolute right-[6%] top-[18%] hidden h-24 w-24 sm:block"
            style={{
              backgroundImage:
                "radial-gradient(rgba(34, 211, 238, 0.8) 1.3px, transparent 1.6px)",
              backgroundSize: "13px 13px",
              maskImage: "radial-gradient(circle at center, #000 20%, transparent 72%)",
              WebkitMaskImage:
                "radial-gradient(circle at center, #000 20%, transparent 72%)",
            }}
          />
          <div
            className="hero-dotgrid absolute left-[4%] bottom-[22%] hidden h-20 w-20 sm:block"
            style={{
              backgroundImage:
                "radial-gradient(rgba(168, 85, 247, 0.75) 1.3px, transparent 1.6px)",
              backgroundSize: "13px 13px",
              maskImage: "radial-gradient(circle at center, #000 20%, transparent 72%)",
              WebkitMaskImage:
                "radial-gradient(circle at center, #000 20%, transparent 72%)",
              animationDelay: "2.5s",
            }}
          />
        </>
      )}

      {/* Traveling signal streaks. Wrapper carries the static tilt; the inner
          element does the pure translateX sweep. */}
      {streaks.map((s, i) => (
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

      {/* Particles wandering on organic 2-D paths, each twinkling. */}
      {particles.map((p, i) => (
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
    </div>
  );
}
