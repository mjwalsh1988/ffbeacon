import { PulseLoader } from "@/components/PulseLoader";

/**
 * Route-level loading boundary for /games/would-you-rather.
 *
 * The server picks a trade and grades it before it can paint a board, so this
 * covers a real wait rather than a token one. Wrapped in the same
 * <main id="main"> landmark as the page and the sibling error boundary, so the
 * layout's skip link has a target mid-load. The wrapping div is the single
 * live region (role="status" + aria-live="polite"); PulseLoader is decorative
 * so the announcement fires once.
 *
 * SEO-T980: the paragraph below is real, visible text naming the destination
 * ("Finding a trade to vote on."), not only a decorative mark, so a crawler
 * or a slow reader gets words instead of empty shapes.
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
            Finding a trade to vote on.
          </p>
        </div>
      </div>
    </main>
  );
}
