/**
 * FF Beacon brand mark shown immediately to the left of a value number when
 * the FF Beacon source is the one backing that value. Purpose: make our
 * proprietary values visually recognizable as ours wherever they appear, so a
 * reader instantly associates the icon with "these are FF Beacon's own values".
 *
 * The mark is decorative (alt="" / aria-hidden). The active source is already
 * announced by the source toggle and each page's "Data source" context, so
 * repeating "FF Beacon" before every number would only add noise for
 * screen-reader users.
 *
 * Sizing is in `em` so the mark tracks the surrounding text size and never
 * grows the line box: a 1em-tall mark sits inside the existing line height of
 * the text it accompanies, so row and cell heights are unchanged.
 */

/** The source_registry slug for FF Beacon's own (proprietary) values. */
export const BEACON_SOURCE_SLUG = "ffbeacon";

export function BeaconValueIcon({ className = "" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/img/ff-beacon-logo.png"
      alt=""
      aria-hidden="true"
      className={`inline-block h-[1em] w-[1em] shrink-0 select-none object-contain align-[-0.15em] ${className}`}
    />
  );
}

/**
 * Convenience wrapper: renders `children` unchanged, optionally prefixed with
 * the FF Beacon mark when `show` is true. Wrap a value number with this so the
 * mark and the number stay on one line and share vertical centering. The
 * inline-flex keeps the 1em mark from nudging the line height.
 */
export function BeaconValue({
  show,
  children,
  className = "",
}: {
  show: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  if (!show) return <>{children}</>;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <BeaconValueIcon />
      {children}
    </span>
  );
}
