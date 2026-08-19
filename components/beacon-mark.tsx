export function BeaconMark({
  className = "",
  showSubtitle = false,
  logoSize = 36,
}: {
  className?: string;
  showSubtitle?: boolean;
  /** Pixel size of the square mark on the left. */
  logoSize?: number;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/img/ff-beacon-mark-96.png"
        alt=""
        width={logoSize}
        height={logoSize}
        style={{ width: logoSize, height: logoSize }}
        className="flex-shrink-0"
      />
      <span className="inline-flex flex-col leading-none">
        <span
          className="bg-clip-text font-semibold text-transparent"
          // Subtle: mostly white with the faintest lavender drift on the
          // right edge. Inline gradient because this is a one-off brand
          // treatment that doesn't warrant a Tailwind utility.
          style={{
            backgroundImage:
              "linear-gradient(90deg, #FFFFFF 0%, #FFFFFF 55%, #EDE6FF 85%, #DDD0FF 100%)",
          }}
          aria-hidden="true"
        >
          FF Beacon
        </span>
        {showSubtitle && (
          <span className="mt-1 text-xs font-normal text-ink-muted">
            Your signal through the fantasy noise.
          </span>
        )}
        <span className="sr-only">FF Beacon home</span>
      </span>
    </span>
  );
}
