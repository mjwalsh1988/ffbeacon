/**
 * The accent number that leads each Manager Pulse section.
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
 *
 * TWO SIZES, AND THE LEAD FIGURE OF A SECTION TAKES THE BIG ONE. Every tile
 * being the same weight made a section read as a wall of equally important
 * numbers, which is another way of saying none of them was important. `hero`
 * doubles the figure and paints it in the brand gradient, and a section uses
 * it exactly once: for the number that answers the question the section
 * exists for.
 */

export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  size = "default",
  sampleSize,
  emptyReason = "Not enough data",
}: {
  label: string;
  /** Already formatted (e.g. via format.ts). Null renders the empty state. */
  value: string | null;
  /** A short qualifier under the number. */
  sub?: string;
  tone?: "neutral" | "good" | "warn";
  /** "hero" is the one figure a section leads with. At most one per section. */
  size?: "default" | "hero";
  /** A short, already-formatted sample note, e.g. "over 14 trades". */
  sampleSize?: string;
  /** Read by a screen reader only, alongside the visible dash, when value is null. */
  emptyReason?: string;
}) {
  const hero = size === "hero";

  const toneClass =
    tone === "good"
      ? "text-brand-cyan"
      : tone === "warn"
        ? "text-signal-warning"
        : "text-ink";

  return (
    <div
      className={`rounded-card border px-4 py-3 ${
        hero
          ? "border-brand-cyan/40 bg-gradient-to-br from-brand-purple/[0.12] via-transparent to-brand-cyan/[0.10]"
          : "border-line bg-base/40"
      }`}
    >
      <p
        className={`font-semibold uppercase tracking-wide ${
          hero ? "text-[11px] text-brand-cyan" : "text-[10px] text-ink-subtle"
        }`}
      >
        {label}
      </p>
      <p
        className={`mt-1 font-mono font-extrabold tabular-nums ${
          hero ? "text-4xl leading-none sm:text-5xl" : "text-3xl sm:text-4xl"
        } ${value === null ? "text-ink-subtle" : hero ? "text-brand-cyan" : toneClass}`}
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
      {sub && <p className="mt-1 text-xs leading-relaxed text-ink-muted">{sub}</p>}
      {sampleSize && (
        <p className="mt-1 text-[11px] text-ink-subtle">{sampleSize}</p>
      )}
    </div>
  );
}
