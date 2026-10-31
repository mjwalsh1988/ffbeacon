/**
 * A state word in a pill. The word is always there; the dot and the color never
 * carry meaning alone.
 */

import type { Chip, Tone } from "@/lib/commerce/transitions";

const TONE_CLASSES: Record<Tone, string> = {
  positive: "border-signal-positive/40 bg-signal-positive/10 text-signal-positive",
  warning: "border-signal-warning/40 bg-signal-warning/10 text-signal-warning",
  danger: "border-signal-danger/40 bg-signal-danger/10 text-signal-danger",
  cyan: "border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan",
  purple: "border-brand-purple/40 bg-brand-purple/10 text-brand-purple-light",
  muted: "border-line bg-base/50 text-ink-muted",
};

export function StatusChip({ chip }: { chip: Chip }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASSES[chip.tone]}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {chip.word}
    </span>
  );
}
