/**
 * The real shape of a Manager Pulse report, painted before any data has come
 * back, rather than a spinner. Used two places: `loading.tsx` (the whole page,
 * on first navigation) and, per section, as the `<Suspense>` fallback inside
 * `[handle]/page.tsx` for whichever slice of the report has not resolved yet.
 *
 * Every block is `aria-hidden="true"`; the ONE thing a screen reader hears is
 * the polite status line, so a reader is told once that the report is loading
 * rather than sat through eight identical "loading" announcements as each
 * block mounts. The shimmer only runs under `motion-safe`, so a reader who has
 * asked for reduced motion gets a static block instead.
 */

const SHIMMER = "motion-safe:animate-pulse rounded-card bg-surface/60";

export function ManagerReportSkeleton() {
  return (
    <div className="px-4 pt-6 sm:px-6 lg:px-8">
      <p role="status" aria-live="polite" className="sr-only">
        Loading the manager report.
      </p>
      {/* THE SAME TWO COLUMNS THE REPORT LANDS IN. A skeleton that paints one
          full-width column and then swaps in a page with a 340px rail moves
          every section sideways at the moment the content arrives, which is
          the shift a skeleton exists to prevent. */}
      <div aria-hidden="true" className="space-y-6">
        <MastheadSkeleton />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <SectionSkeleton key={i} rows={i === 0 ? 2 : 3} />
            ))}
          </div>
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <RailCardSkeleton key={i} rows={i === 0 ? 6 : 3} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The avatar, the handle, the lens switch, and the five figure tiles. */
function MastheadSkeleton() {
  return (
    <div className="rounded-modal border border-line bg-surface-elevated/40 px-4 py-5 sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className={`h-16 w-16 rounded-full ${SHIMMER}`} />
          <div>
            <div className={`h-3 w-24 ${SHIMMER}`} />
            <div className={`mt-2 h-8 w-52 ${SHIMMER}`} />
            <div className={`mt-2 h-3 w-72 ${SHIMMER}`} />
          </div>
        </div>
        <div className={`h-11 w-64 ${SHIMMER}`} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={`h-14 w-full ${SHIMMER}`} />
        ))}
      </div>
    </div>
  );
}

/** One collapsible rail card: a summary row and a few figure rows. */
function RailCardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-modal border border-line bg-surface/40">
      <div className="border-b border-line px-4 py-3">
        <div className={`h-4 w-32 ${SHIMMER}`} />
      </div>
      <div className="space-y-2 px-4 py-3.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={`h-5 w-full ${SHIMMER}`} />
        ))}
      </div>
    </div>
  );
}

/**
 * One report section's placeholder: the accent-number-and-subtitle shape the
 * real sections use (docs/manager-pulse-plan.md 7.5), so the page does not
 * visibly resize when the real card swaps in.
 */
export function SectionSkeleton({
  label,
  rows = 3,
}: {
  /** Rendered nowhere visible; the section's own heading carries the real
   *  label once it loads. Kept as a prop so a caller can vary row count without
   *  passing anything a screen reader would hear twice. */
  label?: string;
  rows?: number;
}) {
  return (
    <div
      aria-hidden="true"
      data-skeleton-for={label}
      className="overflow-hidden rounded-modal border border-line bg-surface/40 p-5 sm:p-6"
    >
      <div className={`h-3 w-32 ${SHIMMER}`} />
      <div className={`mt-3 h-10 w-40 ${SHIMMER}`} />
      <div className={`mt-2 h-4 w-56 ${SHIMMER}`} />
      <div className="mt-5 space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={`h-8 w-full ${SHIMMER}`} />
        ))}
      </div>
    </div>
  );
}
