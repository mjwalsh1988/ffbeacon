import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Build the href for a given page. Page 1 drops the query param so the base
 * URL stays canonical. An optional hash re-anchors the scroll position to the
 * section itself instead of the page top, useful when the paginated section
 * sits partway down a long dashboard page. */
function pageHref(basePath: string, paramName: string, page: number, hash?: string): string {
  const base = page <= 1 ? basePath : `${basePath}?${paramName}=${page}`;
  return hash ? `${base}#${hash}` : base;
}

/**
 * Prev / next pagination for admin dashboard sections. Same pattern as
 * BriefPagination (real Links, rel="prev"/"next", aria-current on the page
 * count), but the query param name is configurable so multiple independently
 * paginated sections can live on one page without colliding (e.g. a Users
 * table using `usersPage` alongside some other section using its own param).
 */
export function Pager({
  basePath,
  paramName,
  currentPage,
  totalPages,
  label,
  hash,
}: {
  basePath: string;
  paramName: string;
  currentPage: number;
  totalPages: number;
  label: string;
  /** Section id to scroll back to on navigation instead of the page top. */
  hash?: string;
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
      aria-label={label}
      className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-6"
    >
      {hasPrev ? (
        <Link
          href={pageHref(basePath, paramName, currentPage - 1, hash)}
          rel="prev"
          className={btn}
        >
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
        <Link
          href={pageHref(basePath, paramName, currentPage + 1, hash)}
          rel="next"
          className={btn}
        >
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
