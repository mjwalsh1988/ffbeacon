import { PulseLoader } from "@/components/PulseLoader";

/**
 * Route-level loading boundary for /games/signal-scout. Next.js renders this
 * instantly on navigation while the server page resolves the game settings,
 * session, and any resumable round, then streams the real page in.
 *
 * Wraps in the same <main id="main"> landmark the real page and the sibling
 * error boundary use, so the root layout's "Skip to main content" link has a
 * valid target even mid-load. The wrapping div is the single live region
 * (role="status" + aria-live="polite"), announced once; PulseLoader is
 * decorative so it does not duplicate the announcement.
 *
 * SEO-T980: the paragraph below is real, visible text naming the destination
 * ("Loading Signal Scout."), not only a decorative mark, so a crawler or a
 * slow reader gets words instead of empty shapes.
 */
export default function Loading() {
  return (
    <main id="main">
      <div className="flex min-h-[60vh] items-center justify-center px-4 sm:px-6 lg:px-8">
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col items-center gap-4"
        >
          <PulseLoader size={96} decorative />
          <p className="text-sm font-medium tracking-wide text-ink-muted">
            Loading Signal Scout.
          </p>
        </div>
      </div>
    </main>
  );
}
