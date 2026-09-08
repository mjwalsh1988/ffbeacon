import { PulseLoader } from "@/components/PulseLoader";
import { ScrollToTop } from "@/components/scroll-to-top";

/**
 * Loading boundary for /tools and everything under it.
 *
 * Same branded card as app/leagues/loading.tsx (PERF-T034, docs/performance/
 * site-speed-audit-and-plan.md 4.20): a full-viewport centered card is the
 * one thing streamed on a slow navigation, so it should look and behave the
 * same everywhere on the site rather than reintroduce a different loader per
 * section.
 *
 * Scoping check before adding this file: a loading.tsx wraps its whole
 * subtree in a Suspense boundary, and the HTTP status goes out with the
 * first flush (see the long comment in app/leagues/loading.tsx for why that
 * matters). The one descendant that calls notFound() under /tools is
 * app/tools/signal-check/v/[shareId]/page.tsx, for a share link id that does
 * not resolve. Share links are not in any sitemap and are not content we ask
 * Google to index, so a stale or mistyped share link answering 200 while it
 * renders the not-found body is a narrow, contained cost, the same shape as
 * the accepted trade-off already documented for /leagues. Every other page
 * under /tools is a fixed tool page with no dynamic segment.
 *
 * The section name sits inside the same live region as "Loading...", so the
 * whole thing is one status update rather than two: a reader hears "Tools,
 * Loading" once and nothing else.
 *
 * It is deliberately NOT an <h1>. It is styled as a tiny uppercase eyebrow,
 * and marking an eyebrow as the page's only level-1 heading gives a reader
 * navigating by headings a landing point that no sighted reader would call a
 * heading, for the second or two the skeleton exists. app/leagues/loading.tsx,
 * the pattern this follows, has no heading either. The real page's own h1
 * arrives with the content.
 */
export default function Loading() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4 pb-[20dvh]">
      <ScrollToTop />
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-5 rounded-modal border border-line bg-surface-elevated px-10 py-12 shadow-2xl shadow-black/40"
      >
        <PulseLoader size={96} decorative />
        <div className="flex flex-col items-center gap-1.5 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            Tools
          </p>
          <p className="text-sm font-medium tracking-wide text-ink-muted">
            Loading...
          </p>
        </div>
      </div>
    </div>
  );
}
