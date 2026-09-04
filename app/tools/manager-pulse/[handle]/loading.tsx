import { ManagerReportSkeleton } from "./report-skeleton";

/**
 * Next.js route-level loading UI: shown automatically on the way in, while the
 * server component below awaits `getManagerFootprint`. The page itself is
 * built to paint fast (the shell and section frames are static; only section
 * content suspends), so this is mostly what a reader sees on the very first
 * navigation, before the shell has painted at all.
 */
export default function Loading() {
  return <ManagerReportSkeleton />;
}
