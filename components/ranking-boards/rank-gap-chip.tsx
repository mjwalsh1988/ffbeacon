import { gapShortText, ordinal, type RankGap } from "@/lib/ranking-boards/compare";

/**
 * The "vs FF Beacon" (or "vs community") figure on a board row: "4 higher"
 * with an up arrow, "2 lower" with a down one, "Same", or the words for a
 * player the ranking does not cover.
 *
 * Every visible word is one real text node, and only the MISSING words are
 * appended sr-only inside the same element ("4" + " spots" + " higher" + " than
 * FF Beacon, who has him 18th"). Nothing is drawn twice, so a screen reader
 * following the pointer lands on text rather than on a hidden twin. The arrow
 * is the only aria-hidden part.
 *
 * Deliberately not components/trend-chip.tsx: that chip describes a VALUE
 * trend over a time window, and its accessible name says so.
 */
export function RankGapChip({
  gap,
  subject,
  className = "",
}: {
  gap: RankGap;
  subject: string;
  className?: string;
}) {
  if (gap.kind !== "gap") {
    return (
      <span className={`inline-flex items-center text-xs text-ink-subtle ${className}`}>
        {gapShortText(gap, subject)}
      </span>
    );
  }
  const tone =
    gap.direction === "higher"
      ? "text-signal-positive"
      : gap.direction === "lower"
        ? "text-signal-warning"
        : "text-ink-muted";
  const arrow = gap.direction === "higher" ? "▲" : gap.direction === "lower" ? "▼" : "=";
  const theirs = ordinal(gap.theirRank);
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-xs font-semibold tabular-nums ${tone} ${className}`}
    >
      <span aria-hidden="true">{arrow}</span>
      {gap.direction === "same" ? (
        <span>
          Same<span className="sr-only"> spot as {subject}, {theirs}</span>
        </span>
      ) : (
        <span>
          {gap.spots}
          <span className="sr-only"> spot{gap.spots === 1 ? "" : "s"}</span> {gap.direction}
          <span className="sr-only">
            {" "}
            than {subject}, who has him {theirs}
          </span>
        </span>
      )}
    </span>
  );
}
