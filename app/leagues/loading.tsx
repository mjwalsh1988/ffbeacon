import { PulseLoader } from "@/components/PulseLoader";
import { ScrollToTop } from "@/components/scroll-to-top";

/**
 * Loading boundary for /leagues and everything under it.
 *
 * This used to live at app/loading.tsx, where it covered every route on the site.
 * That had a side effect worth spelling out, because it is easy to reintroduce.
 *
 * A loading.tsx wraps its route's children in a Suspense boundary. Suspense lets
 * React flush the surrounding shell to the browser before the page component has
 * finished, and the HTTP status goes out with that first flush. So a page that
 * later calls notFound() cannot set 404 any more: the 200 has already been sent.
 * With the boundary at the root, EVERY invalid URL on the domain answered 200 while
 * rendering Next's "404 - This page could not be found" body. Google files those as
 * soft 404s and reads an unbounded space of them as a reason to trust the site less.
 * Verified both directions on a production build: with a root loading.tsx,
 * /foo-does-not-exist and /brief/bogus-slug answered 200; without it, both answer
 * 404 while real pages still answer 200.
 *
 * So the boundary now sits only where it earns its keep. League navigation is the
 * one slow case on the site: the deep view runs lib/league-pulse.ts pulseLeague,
 * which can call the Sleeper API before anything renders. Every other route measured
 * under 0.5s time-to-first-byte on a production build, fast enough that a loader
 * would flash rather than help.
 *
 * KNOWN TRADE-OFF, accepted deliberately: /leagues/[league_id] does call notFound()
 * for a league id that does not resolve (app/leagues/[league_id]/page.tsx), and this
 * boundary means that case answers 200 rather than 404. That is a narrow, contained
 * cost. League URLs are per-user, are excluded from sitemap.xml, and are not content
 * we ask Google to index, while the instant branded loader on "Open league" is a
 * documented product requirement (see CLAUDE.md, League Pulse). If that ever needs
 * to change, the fix is to render an explicit noindex "league not found" state on the
 * page instead of calling notFound(), which is already how that route handles a sync
 * failure. Do NOT solve it by moving this file back up to the app root.
 *
 * Presentation matches the previous root boundary so league navigation looks the same
 * as before: a full-viewport centered card (100dvh, `pb-[20dvh]` biasing the card's
 * center to roughly 40% from the top, which reads better than dead center). The card
 * is the single live region, role="status" + aria-live="polite" with a real
 * "Loading..." label, so a screen reader announces it once; the PulseLoader inside is
 * decorative because the card owns the announcement. <ScrollToTop /> resets the window
 * on mount so a navigation made while scrolled down lands with the loader in view.
 * All colors come from brand tokens; no hex is hardcoded.
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
        <p className="text-sm font-medium tracking-wide text-ink-muted">
          Loading...
        </p>
      </div>
    </div>
  );
}
