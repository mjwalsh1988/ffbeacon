/**
 * Streaming fallback for the profile tabs (#3 performance). Rendered by the
 * page-level <Suspense> boundary so the hero and tab bar paint immediately while
 * the active tab's data loads and streams in. Announced to assistive tech as a
 * busy status region rather than a silent blank area.
 */

export function TabLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div
        role="status"
        aria-live="polite"
        className="rounded-modal border border-line bg-surface/40 p-6"
      >
        <span className="sr-only">Loading player data</span>
        <div aria-hidden="true" className="space-y-4">
          <div className="h-6 w-40 animate-pulse rounded bg-line/60" />
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="h-24 animate-pulse rounded-card bg-line/40" />
            <div className="h-24 animate-pulse rounded-card bg-line/40" />
            <div className="h-24 animate-pulse rounded-card bg-line/40" />
          </div>
          <div className="h-40 animate-pulse rounded-card bg-line/30" />
        </div>
      </div>
    </div>
  );
}
