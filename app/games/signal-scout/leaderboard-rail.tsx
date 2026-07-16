"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { PanelLeft, X } from "lucide-react";
import { SlideUpDialog } from "@/components/slide-up-dialog";
import { fetchLeaderboard, type LeaderboardViewDto } from "@/lib/signal-scout/client";
import type { Board } from "@/lib/signal-scout/leaderboards";
import { LeaderboardPanel, boardLabel } from "./leaderboard-panel";

/**
 * Two-column shell for the Signal Scout game page: the game itself plus the
 * secondary column, which holds the leaderboards (previously their own route
 * at /games/signal-scout/leaderboards, now a permanent redirect back here)
 * with the How It Works explainer beneath them. Desktop gets a sticky sidebar
 * on the left; mobile gets a full-width "View Leaderboards & Info" button that
 * opens the same two things in the house slide-up modal
 * (components/slide-up-dialog.tsx).
 *
 * DOM ORDER: the game column is rendered FIRST and the sidebar is placed into
 * the left column on `lg` via explicit grid placement, rather than the
 * simpler markup-order approach in components/beacon-brief/brief-shell.tsx.
 * This page's whole point is the game, so a keyboard or screen reader user
 * should reach "Start scouting" without tabbing through a board of scouts
 * first. The sidebar is an <aside> (a complementary landmark) either way, so
 * it stays easy to jump to, and content-then-complementary is a meaningful
 * sequence for 1.3.2.
 *
 * ONE STATE, TWO RENDERS: LeaderboardPanel is rendered twice, once in the
 * sidebar and once in the modal, mirroring how BriefShell renders its
 * `sidebar` node in both places. Unlike BriefShell's sidebar these boards are
 * stateful, so every piece of that state lives here and is passed down, which
 * keeps the two copies identical and means opening the modal on mobile shows
 * whatever board you last looked at. The panel derives its element ids from
 * useId(), so the two copies never collide. The sidebar copy is display:none
 * below `lg` and its avatars are loading="lazy", so the copy a mobile visitor
 * never sees costs no image requests.
 */
export function LeaderboardRail({
  boards,
  initialBoard,
  initialView,
  requireLogin,
  viewerSignedIn,
  howItWorksRail,
  howItWorksSheet,
  children,
}: {
  /** Boards enabled in admin settings, in display order. */
  boards: Board[];
  initialBoard: Board;
  /** Page 1 of initialBoard, server-rendered. Null when the viewer is gated
   * (see `teaser`) or when the server-side load failed. */
  initialView: LeaderboardViewDto | null;
  requireLogin: boolean;
  viewerSignedIn: boolean;
  /** The How It Works explainer, which sits under the boards in both the
   * sidebar and the modal. Two separate nodes rather than one reused node
   * because both copies are in the DOM at once while the modal is open, and
   * they must not share a heading id. They are server components, so they
   * arrive as rendered nodes; this client component cannot build them itself. */
  howItWorksRail: ReactNode;
  howItWorksSheet: ReactNode;
  /** The game itself, server-rendered and passed through untouched. */
  children: ReactNode;
}) {
  const teaser = requireLogin && !viewerSignedIn;

  const [open, setOpen] = useState(false);
  const [board, setBoard] = useState<Board>(initialBoard);
  // The board and page currently SELECTED, which is not the same as the board
  // and page currently LOADED (view). They diverge whenever a switch is in
  // flight or has failed, and a retry has to re-request what was selected,
  // not whatever stale view is still on screen.
  const [page, setPage] = useState(1);
  const [view, setView] = useState<LeaderboardViewDto | null>(initialView);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    // A null view with nothing gating it means the server-side load threw.
    // Say so up front rather than rendering a permanently empty board.
    !initialView && !teaser ? "Could not load the leaderboards." : null,
  );
  const [announcement, setAnnouncement] = useState("");

  // Every (board, page) already fetched, so going back to a board you have
  // seen costs nothing and cannot be rate limited.
  const cacheRef = useRef<Map<string, LeaderboardViewDto>>(
    new Map(initialView ? [[`${initialBoard}:1`, initialView]] : []),
  );
  // Rising id that identifies the newest request, so a slow response for a
  // board the visitor has already clicked away from never lands.
  const requestIdRef = useRef(0);

  const select = useCallback(
    async (nextBoard: Board, nextPage: number) => {
      setBoard(nextBoard);
      setPage(nextPage);
      setError(null);

      // Gated visitors see the sign-in card on every board; there is nothing
      // to fetch, and the server deliberately sent no rows.
      if (teaser) {
        setView(null);
        return;
      }

      const key = `${nextBoard}:${nextPage}`;
      const requestId = ++requestIdRef.current;

      const cached = cacheRef.current.get(key);
      if (cached) {
        setView(cached);
        setLoading(false);
        setAnnouncement(describe(nextBoard, cached));
        return;
      }

      setLoading(true);
      let result = await fetchLeaderboard(nextBoard, nextPage);

      // The route allows one call per second per visitor (see
      // LEADERBOARDS_WINDOW_SECONDS in the route). Clicking two boards inside
      // that second is normal behavior, not abuse, so absorb the 429 with one
      // retry instead of showing "Too fast" for an ordinary click.
      if (!result.ok && result.code === "rate_limited") {
        await new Promise((resolve) => setTimeout(resolve, 1100));
        if (requestIdRef.current !== requestId) return;
        result = await fetchLeaderboard(nextBoard, nextPage);
      }

      if (requestIdRef.current !== requestId) return;

      if (!result.ok) {
        setLoading(false);
        // No announcement here on purpose: the panel renders the failure in a
        // role="alert", so putting the same text in the polite region too
        // would read it out twice.
        setError(result.message);
        return;
      }

      cacheRef.current.set(key, result.data);
      setView(result.data);
      setLoading(false);
      setAnnouncement(describe(nextBoard, result.data));
    },
    [teaser],
  );

  // Switching board always lands on page 1, matching the routed tabs this
  // replaced (their hrefs never carried ?page).
  const handleSelectBoard = useCallback(
    (next: Board) => {
      if (next === board) return;
      void select(next, 1);
    },
    [board, select],
  );

  const handlePageChange = useCallback(
    (nextPage: number) => {
      void select(board, nextPage);
    },
    [board, select],
  );

  const handleRetry = useCallback(() => {
    // Retries what was SELECTED, not view.page: a failed board switch leaves
    // the previous board's view on state, and re-requesting its page number
    // against the new board would ask for the wrong page.
    // Never serve the cache to a retry either; the point is to hit the network.
    cacheRef.current.delete(`${board}:${page}`);
    void select(board, page);
  }, [board, page, select]);

  const panelProps = {
    boards,
    activeBoard: board,
    onSelectBoard: handleSelectBoard,
    view,
    loading,
    error,
    teaser,
    onRetry: handleRetry,
    onPageChange: handlePageChange,
  };

  return (
    <div className="lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      {/* Rendered once, outside both panel copies, so a board switch is
          announced a single time no matter which copy is on screen. */}
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>

      <div className="min-w-0 lg:col-start-2 lg:row-start-1">
        <div className="mb-6 lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-card border border-brand-purple/30 bg-surface/60 px-4 py-3 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <PanelLeft aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
            View Leaderboards &amp; Info
          </button>
        </div>

        {children}
      </div>

      <aside
        aria-label="Signal Scout leaderboards and info"
        className="hidden lg:col-start-1 lg:row-start-1 lg:block"
      >
        <div className="beacon-scroll sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-8 pr-1">
          <LeaderboardPanel variant="rail" {...panelProps} />
          <div className="mt-6">{howItWorksRail}</div>
        </div>
      </aside>

      <SlideUpDialog
        open={open}
        onClose={() => setOpen(false)}
        label="Signal Scout leaderboards and info"
      >
        <div className="flex h-full flex-col">
          {/* Close is the first focusable element so screen reader users can
              dismiss without tabbing through the whole board. */}
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
                Signal Scout
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-ink">
                Leaderboards &amp; Info
              </h2>
            </div>
            {/* 44px rather than the h-9 (36px) the other sheets use: this one
                only ever renders on mobile, where CLAUDE.md's 44px floor
                applies to every interactive element. */}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close leaderboards"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          <div className="px-5 py-4">
            <LeaderboardPanel variant="sheet" {...panelProps} />
            <div className="mt-6">{howItWorksSheet}</div>
          </div>
        </div>
      </SlideUpDialog>
    </div>
  );
}

/** Polite announcement for a freshly shown board page. */
function describe(board: Board, view: LeaderboardViewDto): string {
  const label = boardLabel(board);
  if (view.rows.length === 0) return `${label}, no scouts on the board yet.`;
  const scope =
    view.totalPages > 1 ? `page ${view.page} of ${view.totalPages}` : `${view.rows.length} scouts`;
  return `${label}, ${scope}.`;
}
