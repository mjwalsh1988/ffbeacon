/**
 * A buy, sell or hold call as text (plan 9.18). A span, not a button. The
 * visible word is the whole call ("Hard sell", "Build around"), so color never
 * carries the state alone; the note, when present, is text beside the tag.
 */

import { callLabel } from "@/lib/league-blueprint/calls";
import type { CallStrength, PlayerCall } from "@/lib/league-blueprint/types";

const BASE =
  "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em]";

const TONE: Record<PlayerCall["call"], string> = {
  sell: "bg-signal-warning/15 text-signal-warning",
  build: "bg-brand-purple/15 text-brand-purple-light",
  hold: "bg-ink/[0.07] text-ink-muted",
  cut: "bg-signal-danger/15 text-signal-danger",
};

export function CallTag({ call }: { call: PlayerCall }) {
  return <span className={`${BASE} ${TONE[call.call]}`}>{callLabel(call)}</span>;
}

/** A buy target's strength: "Hard buy" or "Soft buy". */
export function BuyTag({ strength }: { strength: CallStrength }) {
  return (
    <span className={`${BASE} bg-signal-positive/15 text-signal-positive`}>
      {strength === "hard" ? "Hard buy" : "Soft buy"}
    </span>
  );
}

/** A defender or specialist: no value, no call. */
export function NoMarketValue() {
  return <span className="text-[11px] font-medium text-ink-subtle">No market value</span>;
}
