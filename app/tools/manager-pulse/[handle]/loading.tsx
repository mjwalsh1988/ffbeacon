import { ManagerReportSkeleton } from "./report-skeleton";

/**
 * Next.js route-level loading UI: shown automatically on the way in, while the
 * server component below awaits `getManagerFootprint`. The page itself is
 * built to paint fast (the shell and section frames are static; only section
 * content suspends), so this is mostly what a reader sees on the very first
 * navigation, before the shell has painted at all.
 *
 * SEO-T980: ManagerReportSkeleton already owns this boundary's one
 * role="status" live region (its sr-only "Loading the manager report." line
 * in report-skeleton.tsx), so the sentence below is plain, non-live, visible
 * text rather than a second announcement. It gives a crawler or a slow
 * reader real words instead of only shimmering shapes.
 */
export default function Loading() {
  return (
    <>
      <p className="px-4 pt-4 text-sm font-medium tracking-wide text-ink-muted sm:px-6 lg:px-8">
        Loading this Sleeper manager's history report.
      </p>
      <ManagerReportSkeleton />
    </>
  );
}
