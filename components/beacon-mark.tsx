export function BeaconMark({
  className = "",
  showSubtitle = false,
}: {
  className?: string;
  showSubtitle?: boolean;
}) {
  return (
    <span className={`inline-flex flex-col leading-none ${className}`}>
      <span
        className="bg-beacon bg-clip-text text-transparent font-semibold"
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
  );
}
