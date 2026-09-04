/**
 * The large accent number that leads each Manager Pulse section.
 *
 * `value` arrives pre-formatted (a plain string), because the caller already
 * knows which of `format.ts`'s functions applies to its own figure. A `null`
 * value renders as a real absence with a stated reason, never as "0" and
 * never as a blank cell.
 *
 * THE NUMBER IS ONE TEXT NODE. When there is a real value, it is the only
 * thing in the figure. When there is not, the visible dash and the reason a
 * screen reader needs sit in the SAME element, the reason inside an `sr-only`
 * span. Drawing the number twice, a visible span plus a hidden twin, reads
 * correctly line by line and goes silent the moment a pointer reader lands on
 * it: a screen reader following a pointer finds the element under the cursor
 * and stops there, so a hidden accessible twin next to a visible one never
 * gets read. `components/league-lineups/season-charts.tsx` documents the same
 * failure for the lineup efficiency figure; this tile follows the same fix.
 */

export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  sampleSize,
  emptyReason = "Not enough data",
}: {
  label: string;
  /** Already formatted (e.g. via format.ts). Null renders the empty state. */
  value: string | null;
  /** A short qualifier under the number. */
  sub?: string;
  tone?: "neutral" | "good" | "warn";
  /** A short, already-formatted sample note, e.g. "over 14 trades". */
  sampleSize?: string;
  /** Read by a screen reader only, alongside the visible dash, when value is null. */
  emptyReason?: string;
}) {
  const toneClass =
    tone === "good"
      ? "text-brand-cyan"
      : tone === "warn"
        ? "text-signal-warning"
        : "text-ink";

  return (
    <div className="rounded-card border border-line bg-base/40 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </p>
      <p
        className={`mt-1 font-mono text-3xl font-extrabold tabular-nums sm:text-4xl ${
          value === null ? "text-ink-subtle" : toneClass
        }`}
      >
        {value === null ? (
          <>
            {"--"}
            <span className="sr-only"> {emptyReason}</span>
          </>
        ) : (
          value
        )}
      </p>
      {sub && <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{sub}</p>}
      {sampleSize && (
        <p className="mt-1 text-[11px] text-ink-subtle">{sampleSize}</p>
      )}
    </div>
  );
}
