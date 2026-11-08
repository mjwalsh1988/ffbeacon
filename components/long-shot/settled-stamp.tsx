/**
 * The Yesterday card's stamp (plan 18A.11): a rotated mono pill reading
 * "Settled" or "Not settled yet". Static, so reduced motion changes nothing.
 */

export function SettledStamp({ settled }: { settled: boolean }) {
  return (
    <span className="inline-block -rotate-6 rounded-full border border-brand-cyan px-3 py-1 font-mono text-xs font-bold uppercase tracking-[0.16em] text-brand-cyan">
      {settled ? "Settled" : "Not settled yet"}
    </span>
  );
}
