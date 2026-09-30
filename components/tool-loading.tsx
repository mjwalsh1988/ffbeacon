import { PulseLoader } from "@/components/PulseLoader";
import { ScrollToTop } from "@/components/scroll-to-top";

/**
 * The branded loading card for a tool page. Each tool folder's loading.tsx
 * re-exports this.
 *
 * It used to be ONE app/tools/loading.tsx covering every route under /tools.
 * A loading.tsx wraps everything below it in a Suspense boundary, and the HTTP
 * status goes out with the first flush (see app/leagues/loading.tsx), so the
 * one descendant whose existence is decided in its page,
 * app/tools/trade-calculator/v/[shareId], answered 200 for a share link that
 * does not exist. Every missing page must be a real 404, so the boundary moved
 * down into each tool that has no such check. The trade calculator folder has
 * none, because a boundary there would cover the share route too; its page
 * streams without the card, and the /tools index is quick enough not to need
 * one.
 *
 * Same branded card as app/leagues/loading.tsx (PERF-T034, docs/performance/
 * site-speed-audit-and-plan.md 4.20).
 *
 * The section name sits inside the same live region as the sentence below it,
 * so the whole thing is one status update rather than two: a reader hears
 * "Tools, Loading this fantasy football tool." once and nothing else.
 *
 * SEO-T980: the second line names the destination ("Loading this fantasy
 * football tool.") instead of a bare "Loading...". Real, visible text inside
 * the existing role="status" region, not a second live announcement.
 *
 * It is deliberately NOT an <h1>. It is styled as a tiny uppercase eyebrow,
 * and marking an eyebrow as the page's only level-1 heading gives a reader
 * navigating by headings a landing point that no sighted reader would call a
 * heading, for the second or two the skeleton exists. The real page's own h1
 * arrives with the content.
 */
export default function ToolLoading() {
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
            Loading this fantasy football tool.
          </p>
        </div>
      </div>
    </div>
  );
}
