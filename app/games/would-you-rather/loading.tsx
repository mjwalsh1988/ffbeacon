import { PulseLoader } from "@/components/PulseLoader";

/**
 * Route-level loading boundary for /games/would-you-rather.
 *
 * The server picks a trade and grades it before it can paint a board, so this
 * covers a real wait rather than a token one. Wrapped in the same
 * <main id="main"> landmark as the page and the sibling error boundary, so the
 * layout's skip link has a target mid-load. PulseLoader owns the single live
 * region.
 */
export default function Loading() {
  return (
    <main id="main">
      <div className="flex min-h-[60vh] items-center justify-center px-4 sm:px-6 lg:px-8">
        <PulseLoader size={96} fullScreen label="Finding a trade to vote on" />
      </div>
    </main>
  );
}
