import { PulseLoader } from "@/components/PulseLoader";
import { ScrollToTop } from "@/components/scroll-to-top";

/**
 * The branded loading card for the Brief feed and its archives. The loading.tsx
 * files under app/brief/(feed) re-export this.
 *
 * It used to be ONE app/brief/(feed)/loading.tsx above the feed and every
 * category, team, tag and player archive. A loading.tsx wraps everything below
 * it in a Suspense boundary, and the HTTP status goes out with the first flush
 * (see app/leagues/loading.tsx), so an archive for a category, team or player
 * that does not exist answered 200 with the not-found body. Every missing page
 * must be a real 404. Each archive now checks existence in its own layout.tsx,
 * which renders before the loading.tsx beside it, and the feed itself sits in
 * the (index) group so its boundary covers nothing else.
 *
 * The article route, app/brief/[slug], sits outside all of this on purpose
 * (docs/seo-audit/seo-audit-and-plan.md, finding A03).
 *
 * Same branded card as app/leagues/loading.tsx (PERF-T034, docs/performance/
 * site-speed-audit-and-plan.md 4.20). The section name sits in the same live
 * region as the sentence below it, so the whole thing is one status update
 * rather than two. SEO-T980: the second line names the destination instead of
 * a bare "Loading...". It is deliberately NOT an <h1>; the real page's own h1
 * arrives with the content.
 */
export default function BriefFeedLoading() {
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
            Loading the latest fantasy football news.
          </p>
        </div>
      </div>
    </div>
  );
}
