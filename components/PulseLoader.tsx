import styles from "./PulseLoader.module.css";

type PulseLoaderProps = {
  /**
   * Square size of the mark in CSS pixels. Defaults to 96 for inline use;
   * route-load boundaries pass a larger value via the loading.tsx wrapper.
   */
  size?: number;
  /**
   * When true, the loader centers itself in a tall content-area block so it
   * reads as a page-level state. When false (default) it renders inline at
   * its intrinsic size for use inside cards, buttons, sections, etc.
   */
  fullScreen?: boolean;
  /** Accessible label announced to screen readers. Defaults to "Loading". */
  label?: string;
  /**
   * When true, the mark is treated as purely decorative: the wrapper is
   * aria-hidden and emits no status role or screen-reader label. Use this when
   * an ancestor already provides the live region and visible text (e.g. the
   * root loading card), so the loading state is announced exactly once.
   */
  decorative?: boolean;
  /** Extra classes for the outer wrapper (positioning, margins, etc.). */
  className?: string;
};

/**
 * PulseLoader: FF Beacon's branded loading mark.
 *
 * Echoes the logo, an upward navigation chevron, with three concentric
 * "pulse wave" arcs above it that fade and scale in one by one, like a
 * beacon emanating a signal. Pure SVG + CSS keyframes (no animation libs).
 *
 * Brand color comes straight from the design tokens: the SVG gradient
 * stops read `colors.brand.purple` and `colors.brand.cyan` from the Tailwind
 * theme inside PulseLoader.module.css (no hex is hardcoded here).
 *
 * Honors prefers-reduced-motion by dropping the animation and showing the
 * arcs at graded static opacities instead.
 *
 * This is a server component (no client JS), so it can be used directly in
 * loading.tsx boundaries and anywhere else.
 */
export function PulseLoader({
  size = 96,
  fullScreen = false,
  label = "Loading",
  decorative = false,
  className,
}: PulseLoaderProps) {
  const wrapperClass = [fullScreen ? styles.fullScreen : styles.inline, className]
    .filter(Boolean)
    .join(" ");

  // When decorative, an ancestor owns the live region + visible label, so the
  // mark hides from assistive tech to avoid a duplicate announcement.
  const semantics = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "status", "aria-live": "polite" } as const);

  return (
    <div className={wrapperClass} {...semantics}>
      <svg
        className={styles.icon}
        style={{ width: size, height: size }}
        viewBox="0 0 64 64"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="pulse-loader-beacon" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" className={styles.stopFrom} />
            <stop offset="100%" className={styles.stopTo} />
          </linearGradient>
        </defs>

        {/* Pulse-wave arcs above the chevron. arc1 is innermost (fires first),
            arc3 outermost (fires last), so the signal reads as emanating. */}
        <g
          fill="none"
          stroke="url(#pulse-loader-beacon)"
          strokeWidth="4"
          strokeLinecap="round"
        >
          <path className={`${styles.arc} ${styles.arc1}`} d="M24 26 Q32 18.5 40 26" />
          <path className={`${styles.arc} ${styles.arc2}`} d="M19 23 Q32 11.5 45 23" />
          <path className={`${styles.arc} ${styles.arc3}`} d="M14 20 Q32 5 50 20" />
        </g>

        {/* Upward navigation chevron, the anchor of the mark. */}
        <path
          className={styles.chevron}
          d="M21 41 L32 30 L43 41"
          fill="none"
          stroke="url(#pulse-loader-beacon)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {!decorative && <span className="sr-only">{label}</span>}
    </div>
  );
}
