/**
 * The loading sheet: the known words, and rules where the rows will land. One
 * status sentence for a screen reader; the blocks themselves are decoration.
 */

export function OrderSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="overflow-hidden rounded-modal border border-line-accent bg-surface/60">
      <p role="status" className="px-5 pt-7 text-sm text-ink-muted sm:px-8">
        {label}
      </p>
      <div aria-hidden="true" className="px-5 pb-8 pt-4 motion-safe:animate-pulse sm:px-8">
        <div className="h-8 w-56 max-w-full rounded bg-ink/[0.08]" />
        <div className="mt-3 h-4 w-80 max-w-full rounded bg-ink/[0.06]" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="mt-6 border-t border-line pt-6">
            <div className="h-4 w-32 rounded bg-ink/[0.08]" />
            <div className="mt-3 h-4 w-full rounded bg-ink/[0.05]" />
            <div className="mt-2 h-4 w-3/4 rounded bg-ink/[0.05]" />
          </div>
        ))}
      </div>
    </div>
  );
}
