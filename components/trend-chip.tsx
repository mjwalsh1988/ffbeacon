type TrendChipProps = {
  direction: "up" | "down" | "stable" | null;
  delta: number | null;
  deltaPct: number | null;
  windowLabel: string;
  /** Source publish cadence. 'weekly' adds an "updated weekly" note so a coarser
   *  weekly trend is not misread as daily-fresh movement. */
  cadence?: "daily" | "weekly";
};

const ARROW_BY_DIRECTION = {
  up: "▲",
  down: "▼",
  stable: "→",
} as const;

const TONE_CLASS_BY_DIRECTION = {
  up: "text-signal-positive",
  down: "text-signal-warning",
  stable: "text-ink-muted",
} as const;

function describe(direction: TrendChipProps["direction"]): string {
  switch (direction) {
    case "up":
      return "rising";
    case "down":
      return "falling";
    case "stable":
      return "stable";
    default:
      return "no trend";
  }
}

export function TrendChip({ direction, delta, deltaPct, windowLabel, cadence }: TrendChipProps) {
  if (direction === null || delta === null) return null;
  const tone = TONE_CLASS_BY_DIRECTION[direction];
  const arrow = ARROW_BY_DIRECTION[direction];
  const deltaText = delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString();
  const pctText =
    deltaPct === null ? null : `${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)}%`;
  // The figure is the visible text itself; only the words the eye gets from the
  // arrow and the color are added for a screen reader, inside the same element.
  // An aria-label on a <p> is not reliably announced, and a hidden figure goes
  // silent when a reader points at it.
  return (
    <p
      className={`mt-2 flex items-center gap-1 text-xs font-medium ${tone}`}
      title={cadence === "weekly" ? "Updated weekly" : undefined}
    >
      <span aria-hidden="true">{arrow}</span>
      <span>
        <span className="sr-only">Value trend {describe(direction)}: </span>
        {deltaText}
        {pctText ? ` (${pctText})` : ""} {windowLabel}
        {cadence === "weekly" && <span className="sr-only">, updated weekly</span>}
      </span>
    </p>
  );
}
