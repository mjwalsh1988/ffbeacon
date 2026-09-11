import { PulseLoader } from "@/components/PulseLoader";
import { ScrollToTop } from "@/components/scroll-to-top";

/**
 * Loading boundary for the Brief's LISTING pages only: /brief and the category,
 * team, tag and player archives, which all live in this (feed) route group. A
 * route group adds nothing to a URL, so every address is unchanged.
 *
 * Same branded card as app/leagues/loading.tsx (PERF-T034, docs/performance/
 * site-speed-audit-and-plan.md 4.20).
 *
 * The article route, app/brief/[slug], sits OUTSIDE this group on purpose
 * (docs/seo-audit/seo-audit-and-plan.md, finding A03). A loading.tsx flushes
 * the response with a 200 status before a descendant page's own notFound() can
 * run (see the long comment in app/leagues/loading.tsx). This file used to sit
 * at app/brief/ and cover articles too, on the belief that articles render
 * statically, so no per-request flush could soften their 404. They do not: the
 * shared site header reads cookies, which makes every route dynamic, and a
 * removed or mistyped article answered 200 with a "not found" body (measured on
 * production 2026-09-11). Articles are archived routinely, so that was a soft
 * 404 Google kept recrawling. Outside this boundary, a missing article is a
 * real 404 again.
 *
 * The listing descendants that call notFound() are fine under it:
 * - category/[slug] and team/[abbr] are reached only through the small, fixed
 *   set of real categories and team abbreviations the sitemap lists, so a
 *   genuine 404 there comes only from a hand-typed bad slug, not from indexed
 *   traffic.
 * - tag/[tag] is indexable only once it holds enough indexable articles, and
 *   player/[slug] is always noindex, so a notFound() softened to a 200 there
 *   costs no search visibility.
 * None of them carries the risk that ruled out /players and /[handle] (the
 * PERF-T034 entry in progress.md): a high-volume, indexed,
 * free-text-addressable content type where 404s are routine. Brief articles
 * were exactly that, which is why they left.
 *
 * The section name sits in the same live region as the sentence below it, so
 * the whole thing is one status update rather than two.
 *
 * SEO-T980: the second line names the destination ("Loading the latest
 * fantasy football news.") instead of a bare "Loading...", true for /brief
 * and every category, team, tag and player archive in this group. Real, visible
 * text inside the existing role="status" region, not a second live
 * announcement.
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
            Loading the latest fantasy football news.
          </p>
        </div>
      </div>
    </div>
  );
}
