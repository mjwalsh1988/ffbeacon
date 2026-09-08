import { PulseLoader } from "@/components/PulseLoader";
import { ScrollToTop } from "@/components/scroll-to-top";

/**
 * Loading boundary for /brief and everything under it.
 *
 * Same branded card as app/leagues/loading.tsx (PERF-T034, docs/performance/
 * site-speed-audit-and-plan.md 4.20).
 *
 * Scoping check before adding this file, since a loading.tsx flushes the
 * response with a 200 status before a descendant page's own notFound() can
 * run (see the long comment in app/leagues/loading.tsx). Four descendants
 * call notFound():
 * - app/brief/[slug]/page.tsx is statically rendered (generateStaticParams,
 *   revalidate 300, no force-dynamic), so this boundary does not change its
 *   behavior at all: a static page has no per-request Suspense flush to
 *   soften. Harmless, as called out in the audit's Part 5 table.
 * - app/brief/category/[slug]/page.tsx and app/brief/team/[abbr]/page.tsx
 *   are dynamic and in the sitemap, but every slug they can be reached by is
 *   drawn from the small, fixed set of real categories and team
 *   abbreviations that sitemap actually lists, so a genuine 404 only comes
 *   from a hand-typed bad slug, not from indexed traffic.
 * - app/brief/player/[slug]/page.tsx sets robots noindex, so its notFound()
 *   softening to a 200 has no search-visibility cost.
 * None of the four carries the risk that ruled out /players and /[handle]
 * below (see this repo's session notes for PERF-T034): a high-volume,
 * indexed, free-text-addressable content type where 404s are routine.
 *
 * The section name sits in the same live region as "Loading...", so the whole
 * thing is one status update rather than two.
 *
 * It is deliberately NOT an <h1>. It is styled as a tiny uppercase eyebrow, and
 * marking an eyebrow as the page's only level-1 heading gives a reader
 * navigating by headings a landing point no sighted reader would call a
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
            Beacon Brief
          </p>
          <p className="text-sm font-medium tracking-wide text-ink-muted">
            Loading...
          </p>
        </div>
      </div>
    </div>
  );
}
