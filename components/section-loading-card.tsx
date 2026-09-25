import { PulseLoader } from "@/components/PulseLoader";

/**
 * The branded loading card, for a Suspense boundary INSIDE a page.
 *
 * Same card as app/leagues/loading.tsx and app/tools/loading.tsx, but used
 * where a route-level loading.tsx would be wrong (PERF-T034): a loading.tsx
 * flushes a 200 before the page runs, so a later notFound() becomes a soft
 * 404. Player pages and Signal profiles are indexed content and call
 * notFound() on routine input, so they decide found or not found FIRST and
 * only then stream the slow part behind this card. The status code is
 * already right by the time it shows.
 *
 * One role="status" region holding the section name and the sentence, so a
 * screen reader hears it once. Not a heading: the page's own h1 arrives with
 * the content.
 */
export function SectionLoadingCard({
  section,
  message,
}: {
  section: string;
  message: string;
}) {
  return (
    <div className="flex min-h-[70dvh] items-center justify-center px-4 pb-[10dvh]">
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-5 rounded-modal border border-line bg-surface-elevated px-10 py-12 shadow-2xl shadow-black/40"
      >
        <PulseLoader size={96} decorative />
        <div className="flex flex-col items-center gap-1.5 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            {section}
          </p>
          <p className="text-sm font-medium tracking-wide text-ink-muted">{message}</p>
        </div>
      </div>
    </div>
  );
}
