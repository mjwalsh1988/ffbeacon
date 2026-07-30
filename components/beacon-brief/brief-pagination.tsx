import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Build the href for a given page. Page 1 drops the ?page param so the base
 * URL stays canonical. */
function pageHref(basePath: string, page: number): string {
  return page <= 1 ? basePath : `${basePath}?page=${page}`;
}

/** Every page is linked directly at or below this count, no gaps. */
const SHOW_ALL_UP_TO = 7;

/**
 * Which page numbers to render, with gaps collapsed.
 *
 * Always includes page 1, the last page, and a window around the current page, so a
 * crawler reaching any page finds a direct link to the first, the last, and the
 * neighbours. Returns "gap" markers where numbers were skipped.
 *
 * Two rules keep the output sensible on a small archive, both of which the tests pin
 * down because the first draft got both wrong:
 *   - At 7 pages or fewer every page is listed. A 5-page archive showing "1 2 ... 5"
 *     hides pages 3 and 4 for no reason.
 *   - A gap standing in for exactly one page becomes that page. "..." that conceals a
 *     single number costs a hop and saves nothing.
 *
 * The window is the same at every breakpoint. Dropping numbers on small screens would
 * leave a mobile reader with fewer routes through the archive than a desktop one, which
 * the mobile-first rule rules out.
 */
export function paginationItems(
  currentPage: number,
  totalPages: number,
  window = 1,
): Array<number | "gap"> {
  if (totalPages <= SHOW_ALL_UP_TO) {
    return Array.from({ length: Math.max(totalPages, 1) }, (_, i) => i + 1);
  }

  const pages = new Set<number>([1, totalPages]);
  for (let p = currentPage - window; p <= currentPage + window; p++) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<number | "gap"> = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous) {
      const hidden = p - previous - 1;
      if (hidden === 1) out.push(previous + 1);
      else if (hidden > 1) out.push("gap");
    }
    out.push(p);
    previous = p;
  }
  return out;
}

/**
 * Pagination for the Beacon Brief feed: prev/next plus numbered page links.
 *
 * The numbers are the point. With prev/next alone the oldest article in the library
 * sat 13 sequential hops from /brief, deep enough that Google treated most of the
 * archive as sitemap-only and left it unindexed. Numbered links plus the larger page
 * size (BRIEF_PAGE_SIZE) put every article within about two clicks.
 *
 * Everything is a real <a>, so the whole archive is reachable with JavaScript off and
 * every page is a crawlable, shareable URL. rel="prev"/"next" stay as sequence hints
 * and aria-current marks the active page for assistive tech.
 */
export function BriefPagination({
  basePath,
  currentPage,
  totalPages,
}: {
  basePath: string;
  currentPage: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;

  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;
  const items = paginationItems(currentPage, totalPages);

  const arrow =
    "inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-3 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:px-4";
  const arrowDisabled =
    "inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface/40 px-3 text-sm font-semibold text-ink-subtle opacity-60 sm:px-4";
  const numberBase =
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-card border px-3 text-sm font-semibold tabular-nums transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";
  const numberIdle =
    "border-line bg-surface text-ink-muted hover:border-brand-cyan/60 hover:text-brand-cyan";
  const numberActive =
    "border-brand-purple/60 bg-brand-purple/15 text-ink shadow-[0_0_24px_-12px_rgba(168,85,247,0.65)]";

  return (
    <nav
      aria-label="Article pages"
      className="mt-8 border-t border-line pt-6"
    >
      <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-between">
        {hasPrev ? (
          <Link
            href={pageHref(basePath, currentPage - 1)}
            rel="prev"
            className={arrow}
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            Previous
          </Link>
        ) : (
          <span className={arrowDisabled} aria-hidden="true">
            <ChevronLeft className="h-4 w-4" />
            Previous
          </span>
        )}

        <ol
          role="list"
          className="order-last flex w-full flex-wrap items-center justify-center gap-2 sm:order-none sm:w-auto"
        >
          {items.map((item, i) =>
            item === "gap" ? (
              <li
                key={`gap-${i}`}
                aria-hidden="true"
                className="px-1 text-sm text-ink-subtle"
              >
                ...
              </li>
            ) : (
              <li key={item}>
                <Link
                  href={pageHref(basePath, item)}
                  aria-label={`Page ${item} of ${totalPages}`}
                  aria-current={item === currentPage ? "page" : undefined}
                  className={`${numberBase} ${item === currentPage ? numberActive : numberIdle}`}
                >
                  {item}
                </Link>
              </li>
            ),
          )}
        </ol>

        {hasNext ? (
          <Link
            href={pageHref(basePath, currentPage + 1)}
            rel="next"
            className={arrow}
          >
            Next
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        ) : (
          <span className={arrowDisabled} aria-hidden="true">
            Next
            <ChevronRight className="h-4 w-4" />
          </span>
        )}
      </div>
    </nav>
  );
}
