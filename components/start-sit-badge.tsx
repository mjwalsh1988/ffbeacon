import { CircleCheck, CircleMinus } from "lucide-react";

/**
 * The START or SIT tag on a Who Should I Start card.
 *
 * Built on the components/team-status-badge.tsx pattern: an icon, a filled
 * pill, and the word itself, never colour alone. It sits right after the
 * player's name on each card, so a screen reader hears the answer before any
 * of the numbers that explain it.
 *
 * START is signal.success (the same green the rest of the product uses for a
 * good outcome) plus a check. SIT is ink.muted, the same tone the site uses
 * for "not the headline figure", plus a minus, since sitting a player is a
 * subtraction from the lineup rather than a warning about him.
 *
 * The rank ("Start 1 of 2") and the sit reason ("Sit (Bye week)") are part of
 * the visible word, not a separate aria-label: the pill has no aria-label at
 * all, so its accessible name is exactly the text a sighted reader sees.
 */

export type StartSitCall = "start" | "sit";

const SIZE = {
  sm: { pill: "gap-1 px-2 py-0.5 text-[10px]", icon: "h-3 w-3" },
  md: { pill: "gap-1.5 px-2.5 py-1 text-[11px]", icon: "h-3.5 w-3.5" },
} as const;

export function StartSitBadge({
  call,
  rank,
  total,
  reason,
  size = "md",
  className = "",
}: {
  call: StartSitCall;
  /** This player's place among the starters, e.g. rank=1 total=2 reads
   *  "Start 1 of 2". Ignored on a SIT badge. */
  rank?: number;
  total?: number;
  /** A short reason shown on a SIT badge, e.g. "Bye week". Ignored on a
   *  START badge. */
  reason?: string;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const dims = SIZE[size];
  const isStart = call === "start";
  const Icon = isStart ? CircleCheck : CircleMinus;
  const label = isStart
    ? rank != null && total != null
      ? `Start ${rank} of ${total}`
      : "Start"
    : reason
      ? `Sit (${reason})`
      : "Sit";
  const tone = isStart
    ? "border-signal-success/60 bg-signal-success/15 text-signal-success shadow-[0_0_18px_-7px_rgba(16,185,129,0.9)]"
    : "border-line-accent/50 bg-surface/60 text-ink-muted";

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border font-bold tracking-tight ${tone} ${dims.pill} ${className}`}
    >
      <Icon aria-hidden="true" className={`${dims.icon} shrink-0`} />
      {label}
    </span>
  );
}
