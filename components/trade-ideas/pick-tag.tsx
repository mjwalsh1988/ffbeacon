import { describePick, type PickLike } from "@/lib/trade-ideas/pick-label";

/**
 * A draft pick, rendered as its three facts: which pick, where in the round, and
 * whose it was.
 *
 * READING ORDER IS THE POINT
 *   "2027 R1" in the strongest weight, the pool as a coloured pill, and the
 *   original owner in subtle text after it. A manager scanning a list of eight
 *   picks is looking for the round first and the owner second, and the pill is
 *   what lets them find the early ones without reading a word.
 *
 * WHY THE POOL IS A PILL AND THE OWNER IS NOT
 *   The pool has three values and they rank. A pill can carry that in colour, so
 *   the difference between an early pick and a late one is visible before it is
 *   read. The owner is an open set of names, where a pill would be twelve
 *   different chips that all look equally important and none of which mean
 *   anything at a glance.
 *
 * COLOUR IS NEVER THE ONLY SIGNAL
 *   The pill says its own word, so "Early" is legible with no colour perception
 *   at all. The colours follow the same convention the rest of League Pulse uses
 *   for a ranking: cyan at the valuable end, purple at the other.
 *
 * ONE ACCESSIBLE STRING, NOT FOUR
 *   The whole thing is one `aria-label` built by describePick, and the visible
 *   parts are `aria-hidden`. Left to itself a screen reader would read "2027 R1,
 *   Early, via at dynastyDan" as three unrelated fragments, and "R1" as a letter
 *   and a number. The label says "2027 first round pick, projected early in the
 *   round, via @dynastyDan", which is the sentence a sighted reader assembles
 *   from the same pixels.
 */

const POOL_TONE: Record<string, string> = {
  Early: "border-brand-cyan/60 bg-brand-cyan/15 text-brand-cyan",
  Mid: "border-ink-subtle/50 bg-ink-subtle/15 text-ink",
  Late: "border-brand-purple/60 bg-brand-purple/15 text-brand-purple",
};

export function PickTag({
  pick,
  estimated,
  className = "",
}: {
  pick: PickLike;
  /** True when the pool came from a projected finish rather than a real order. */
  estimated: boolean;
  className?: string;
}) {
  const parts = describePick(pick, estimated);
  return (
    <span
      aria-label={parts.plainLabel}
      className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}
    >
      <span aria-hidden="true" className="text-sm font-bold text-ink">
        {parts.round}
      </span>
      {parts.pool && (
        <span
          aria-hidden="true"
          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${
            POOL_TONE[parts.pool] ?? POOL_TONE.Mid
          }`}
        >
          {parts.pool}
        </span>
      )}
      <span aria-hidden="true" className="text-xs text-ink-subtle">
        ({parts.via})
      </span>
    </span>
  );
}
