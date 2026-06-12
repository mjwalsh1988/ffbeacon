/**
 * Status pill for a cron run. Presentational and server-safe (no client hooks).
 * Color is reinforced by the text label and an aria-label so status is never
 * conveyed by color alone.
 */

type Variant = {
  label: string;
  className: string;
};

const VARIANTS: Record<string, Variant> = {
  success: {
    label: "Success",
    className: "border-signal-success/40 bg-signal-success/10 text-signal-success",
  },
  error: {
    label: "Error",
    className: "border-signal-danger/40 bg-signal-danger/10 text-signal-danger",
  },
  running: {
    label: "Running",
    className: "border-signal-warning/40 bg-signal-warning/10 text-signal-warning",
  },
  skipped: {
    label: "Skipped",
    className: "border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan",
  },
  none: {
    label: "No runs yet",
    className: "border-line bg-surface text-ink-muted",
  },
};

export function CronStatusBadge({ status }: { status: string }) {
  const variant = VARIANTS[status] ?? VARIANTS.none;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${variant.className}`}
      aria-label={`Status: ${variant.label}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {variant.label}
    </span>
  );
}
