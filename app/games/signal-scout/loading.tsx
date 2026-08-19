import { PulseLoader } from "@/components/PulseLoader";

/**
 * Route-level loading boundary for /games/signal-scout. Next.js renders this
 * instantly on navigation while the server page resolves the game settings,
 * session, and any resumable round, then streams the real page in.
 *
 * Wraps in the same <main id="main"> landmark the real page and the sibling
 * error boundary use, so the root layout's "Skip to main content" link has a
 * valid target even mid-load. PulseLoader owns the single live region
 * (role="status") via its default (non-decorative) mode, announced once via
 * the label prop.
 */
export default function Loading() {
  return (
    <main id="main">
      <div className="flex min-h-[60vh] items-center justify-center px-4 sm:px-6 lg:px-8">
        <PulseLoader size={96} fullScreen label="Loading Signal Scout" />
      </div>
    </main>
  );
}
