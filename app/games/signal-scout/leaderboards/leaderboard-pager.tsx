import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Board } from "@/lib/signal-scout/leaderboards";

/**
 * Build the href for a given (board, page) pair. components/admin/pager.tsx's
 * pageHref drops every query param except its own, which cannot be reused
 * here since the board param must survive pagination. Page 1 with the
 * default "daily" board yields the bare canonical path.
 */
function pageHref(board: Board, page: number): string {
  const params = new URLSearchParams();
  if (board !== "daily") params.set("board", board);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/games/signal-scout/leaderboards?${qs}` : "/games/signal-scout/leaderboards";
}

/**
 * Prev / next pagination for the leaderboards page, modeled on
 * components/admin/pager.tsx (real Links, rel="prev"/"next", "Page X of Y",
 * disabled spans aria-hidden, min-h-11 targets), with board-aware hrefs.
 */
export function LeaderboardPager({
  board,
  currentPage,
  totalPages,
}: {
  board: Board;
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
      aria-label="Leaderboard pages"
      className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-6"
    >
      {hasPrev ? (
        <Link href={pageHref(board, currentPage - 1)} rel="prev" className={btn}>
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
        Page <span className="font-semibold text-ink">{currentPage}</span> of {totalPages}
      </p>

      {hasNext ? (
        <Link href={pageHref(board, currentPage + 1)} rel="next" className={btn}>
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
