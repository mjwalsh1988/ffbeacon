import { PulseLoader } from "@/components/PulseLoader";
import { ScrollToTop } from "@/components/scroll-to-top";

/**
 * Loading boundary for /rankings and everything under it.
 *
 * Same branded card as app/leagues/loading.tsx (PERF-T034, docs/performance/
 * site-speed-audit-and-plan.md 4.20).
 *
 * Scoping check before adding this file: the only descendant that calls
 * notFound() under /rankings is app/rankings/[format]/page.tsx, for a format
 * slug that is not one of the active format_configs rows. Every slug this
 * route can actually be reached by, from the format directory on /rankings,
 * the header format switcher, and generateStaticParams, is drawn from that
 * same fixed, small, known list, so a real 404 here only happens from a
 * hand-typed bad slug, never from a link Google has indexed. That is a
 * different risk profile from a page whose 404s come from ordinary crawl
 * traffic, so the soft-404 trade-off documented in app/leagues/loading.tsx
 * is negligible here.
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
            Rankings
          </p>
          <p className="text-sm font-medium tracking-wide text-ink-muted">
            Loading...
          </p>
        </div>
      </div>
    </div>
  );
}
