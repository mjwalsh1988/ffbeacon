/**
 * The BEAM glyph: the mascot's face, drawn in one colour.
 *
 * It carries the two shapes the FF Beacon logo is built from, the peak and the
 * arc, as the crown and the headphone pods, so it sits beside the wordmark
 * without looking borrowed. Line art in currentColor rather than a shrunken copy
 * of the mascot artwork, because the header button is 20 CSS px and a full-colour
 * render at that size is a smudge. The artwork itself appears inside the panel,
 * where there is room for it (components/beam/beam-panel.tsx).
 *
 * Decorative by default (aria-hidden): everywhere it appears today it sits next
 * to a text label or inside a control that already has an accessible name. Pass
 * `title` only where it is the sole content of a control.
 */
export function BeamMark({
  className = "h-5 w-5",
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable={false}
    >
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Crown: the beacon peak. */}
        <path
          d="M12 2.9 15.2 8.6H8.8L12 2.9Z"
          fill="currentColor"
          stroke="none"
        />
        {/* Head. */}
        <rect x="5.2" y="8.6" width="13.6" height="11" rx="4.8" />
        {/* Headphone pods. */}
        <rect x="2.4" y="11.6" width="2.8" height="5" rx="1.4" />
        <rect x="18.8" y="11.6" width="2.8" height="5" rx="1.4" />
        {/* Eyes, closed and happy, and the smile. */}
        <path d="M8.7 14.2q1.35-1.5 2.7 0" />
        <path d="M12.6 14.2q1.35-1.5 2.7 0" />
        <path d="M10.2 16.9q1.8 1.5 3.6 0" />
      </g>
    </svg>
  );
}

/**
 * The mascot artwork, cropped to the head. Used as the avatar next to each
 * answer and in the panel header.
 *
 * A plain <img>, matching components/beacon-mark.tsx: the file is a 20 kB WebP
 * served straight from /public, so routing it through the image optimizer would
 * add a request without saving bytes. Decorative by default, because it always
 * sits next to the name "BEAM".
 */
export function BeamAvatar({
  size = 32,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/img/beam-avatar.webp"
      alt=""
      width={size}
      height={size}
      decoding="async"
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-full bg-brand-purple/15 ${className}`}
    />
  );
}
