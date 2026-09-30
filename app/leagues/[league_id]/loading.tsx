import { PulseLoader } from "@/components/PulseLoader";
import { ScrollToTop } from "@/components/scroll-to-top";
import { AnnounceOnMount } from "@/components/announce-on-mount";

/**
 * Loading boundary for /leagues/[league_id] and everything under it.
 *
 * This used to live at app/loading.tsx, where it covered every route on the site,
 * and then at app/leagues/loading.tsx. Both had a side effect worth spelling out,
 * because it is easy to reintroduce.
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
 * The rule that follows: a check that decides whether a page exists must run
 * OUTSIDE every loading boundary above it. A layout renders outside the
 * loading.tsx of its own segment, so the pattern is a layout.tsx that does the
 * existence check and a loading.tsx beside it. Here that is ./layout.tsx, which
 * answers a malformed id, and a league Sleeper says does not exist, with a real
 * 404 before this loader is sent. The same shape is used for the format boards
 * (app/rankings/(board)/[format]) and the Brief archives (app/brief/(feed)).
 *
 * What still answers 200 under this boundary: a check that needs the league
 * synced first (a roster id that is not in the league, a matchup week out of
 * range on the schedule routes). Those run in their pages because they depend on
 * the sync this loader exists to cover. League URLs are per-user and excluded
 * from sitemap.xml, and every such page is noindex through the not-found render.
 *
 * League navigation is the one slow case on the site: the deep view runs
 * lib/league-pulse.ts pulseLeague, which can call the Sleeper API before anything
 * renders, and the instant branded loader on "Open league" is a documented product
 * requirement (see CLAUDE.md, League Pulse). Do NOT solve any of the above by moving
 * this file back up.
 *
 * Presentation matches the previous root boundary so league navigation looks the same
 * as before: a full-viewport centered card (100dvh, `pb-[20dvh]` biasing the card's
 * center to roughly 40% from the top, which reads better than dead center). The card
 * is the single live region, role="status" + aria-live="polite" with a real
 * sentence naming the destination, so a screen reader announces it once; the
 * PulseLoader inside is decorative because the card owns the announcement.
 * <ScrollToTop /> resets the window on mount so a navigation made while scrolled down
 * lands with the loader in view. All colors come from brand tokens; no hex is
 * hardcoded.
 *
 * SEO-T980: the label below reads "Loading your Sleeper league." instead of a bare
 * "Loading...", so a crawler or a slow reader that sees this boundary gets real text
 * naming the destination rather than empty shapes. It stays inside the existing
 * role="status" region rather than adding a second one.
 *
 * The wrapper is <main id="main"> because this boundary REPLACES the page, and
 * the page is what normally supplies the landmark the root layout's skip link
 * points at. Without it, "Skip to content" went nowhere while a league loaded.
 *
 * A live region that mounts already holding its sentence is often not
 * announced, because nothing in it changed. AnnounceOnMount swaps the text node
 * for an identical one just after hydration, which is a change, and keeps the
 * sentence in the server HTML. There is deliberately no aria-busy on <main>:
 * busy tells a screen reader to hold announcements from inside it, which would
 * silence the one thing this boundary exists to say.
 */
export default function Loading() {
  return (
    <main
      id="main"
      className="flex min-h-[100dvh] items-center justify-center px-4 pb-[20dvh]"
    >
      <ScrollToTop />
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-5 rounded-modal border border-line bg-surface-elevated px-10 py-12 shadow-2xl shadow-black/40"
      >
        <PulseLoader size={96} decorative />
        <p className="text-sm font-medium tracking-wide text-ink-muted">
          <AnnounceOnMount>Loading your Sleeper league.</AnnounceOnMount>
        </p>
      </div>
    </main>
  );
}
