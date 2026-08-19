/**
 * Streaming fallback for the profile sections (#3 performance). Rendered by the
 * page-level <Suspense> boundary so the masthead paints immediately while the
 * active section's data loads and streams in. Announced to assistive tech as a
 * busy status region rather than a silent blank area.
 */

import { PageBody } from "@/components/app-shell/page-body";

export function TabLoading() {
  return (
    <PageBody>
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
    </PageBody>
  );
}
