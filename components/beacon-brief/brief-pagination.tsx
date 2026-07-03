import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Build the href for a given page. Page 1 drops the ?page param so the base
 * URL stays canonical. */
function pageHref(basePath: string, page: number): string {
  return page <= 1 ? basePath : `${basePath}?page=${page}`;
}

/**
 * Prev / next pagination for the Beacon Brief feed. Rendered as real links so
 * pages are crawlable and shareable, with rel="prev"/"next" hints for search
 * engines and an aria-current marker on the active page.
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

  const btn =
    "inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";
  const disabled =
    "inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface/40 px-4 text-sm font-semibold text-ink-subtle opacity-60";

  return (
    <nav
      aria-label="Article pages"
      className="mt-8 flex items-center justify-between gap-3 border-t border-line pt-6"
    >
      {hasPrev ? (
        <Link href={pageHref(basePath, currentPage - 1)} rel="prev" className={btn}>
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          Previous
        </Link>
      ) : (
        <span className={disabled} aria-hidden="true">
          <ChevronLeft className="h-4 w-4" />
          Previous
        </span>
      )}

      <p className="text-sm text-ink-muted" aria-current="page">
        Page <span className="font-semibold text-ink">{currentPage}</span> of{" "}
        {totalPages}
      </p>

      {hasNext ? (
        <Link href={pageHref(basePath, currentPage + 1)} rel="next" className={btn}>
          Next
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      ) : (
        <span className={disabled} aria-hidden="true">
          Next
          <ChevronRight className="h-4 w-4" />
        </span>
      )}
    </nav>
  );
}
