import type { ReconciledFormat } from "@/lib/source";

/**
 * The post-arrival format swap banner.
 *
 * Rendered when `reconcileFormatWithSource` kept the reader's source and moved
 * the FORMAT to one that source covers. The same words and markup as the
 * rankings board's banner, so the swap reads identically on every surface. The
 * swap is a read-time correction and is never persisted, so nothing here
 * writes a cookie or a preference.
 */
export function FormatFallbackBanner({
  fallback,
  className = "mb-4",
}: {
  fallback: ReconciledFormat["fallback"];
  className?: string;
}) {
  if (!fallback) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className={`${className} rounded-card border border-dashed border-line bg-surface px-4 py-2 text-sm text-ink-muted`}
    >
      <span className="font-medium text-ink">Switched to {fallback.toName}</span> because{" "}
      {fallback.sourceName} doesn{"'"}t provide values for {fallback.fromName}.
    </p>
  );
}
