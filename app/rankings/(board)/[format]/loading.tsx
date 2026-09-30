import { PulseLoader } from "@/components/PulseLoader";
import { ScrollToTop } from "@/components/scroll-to-top";

/**
 * Loading boundary for the format boards (/rankings/[format]).
 *
 * It sits INSIDE the [format] segment, below ./layout.tsx, on purpose. A
 * loading.tsx wraps everything under it in a Suspense boundary, and the HTTP
 * status goes out with the first flush (see app/leagues/loading.tsx). This file
 * used to sit one level up at app/rankings/(board)/, above the only check that
 * decides whether a format exists, so a mistyped slug answered 200 with the
 * not-found body. The check now runs in ./layout.tsx, which renders before this
 * boundary, so an unknown slug is a real 404 and a real one still gets the
 * loader.
 *
 * The hub, app/rankings/page.tsx, sits outside the (board) group for the reason
 * docs/seo-audit/seo-audit-and-plan.md finding D04 gives: it redirects, and a
 * boundary above a redirect turns a 307 into a meta refresh inside a 200.
 *
 * Same branded card as app/leagues/loading.tsx (PERF-T034, docs/performance/
 * site-speed-audit-and-plan.md 4.20).
 *
 * The section name sits in the same live region as the sentence below it, so
 * the whole thing is one status update rather than two.
 *
 * SEO-T980: the second line names the destination ("Loading the fantasy
 * football rankings.") instead of a bare "Loading...", true for every
 * /rankings/[format] page. Real, visible text inside the existing
 * role="status" region, not a second live announcement.
 *
 * It is deliberately NOT an <h1>. It is styled as a tiny uppercase eyebrow, and
 * marking an eyebrow as the page's only level-1 heading gives a reader
 * navigating by headings a landing point no sighted reader would call a
 * heading, for the second or two the skeleton exists. The real page's own h1
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
            Rankings
          </p>
          <p className="text-sm font-medium tracking-wide text-ink-muted">
            Loading the fantasy football rankings.
          </p>
        </div>
      </div>
    </div>
  );
}
