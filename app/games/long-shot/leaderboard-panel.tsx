"use client";

/**
 * The boards (plan 13 and 18A.10), copied structurally from Signal Scout's
 * panel with the Signal profile link added. Page 1 of the daily board is
 * server-rendered; other boards and pages are fetched on demand. The daily
 * board's first page opens with the podium and continues from rank 4 as rows;
 * all-time and streak use rows alone. The reader's own rank is a strip under
 * the list. Board switching is aria-pressed toggles, the Signal Scout pattern.
 */

import { useEffect, useId, useState } from "react";
import { BoardRowItem } from "@/components/long-shot/board-row";
import { Podium } from "@/components/long-shot/podium";
import { fetchLeaderboard } from "@/lib/long-shot/client";
import type { Board, LeaderboardView } from "@/lib/long-shot/leaderboards";

const BOARDS: Array<{ key: Board; label: string; unit: string; secondary: string | null }> = [
  { key: "daily", label: "Today", unit: "points", secondary: null },
  { key: "all_time", label: "All time", unit: "points", secondary: "Days played" },
  { key: "streak", label: "Streak", unit: "day streak", secondary: "Best streak" },
];

export function LeaderboardPanel({
  initialView,
  refresh = false,
}: {
  initialView: LeaderboardView | null;
  /** Fetch page 1 of the daily board on mount (after a completion moved it). */
  refresh?: boolean;
}) {
  const [view, setView] = useState<LeaderboardView | null>(initialView);
  const [board, setBoard] = useState<Board>(initialView?.board ?? "daily");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const headingId = useId();

  async function load(nextBoard: Board, page: number) {
    setBusy(true);
    setError(null);
    const res = await fetchLeaderboard(nextBoard, page);
    setBusy(false);
    if (!res.ok) {
      setError(
        res.code === "leaderboards_disabled"
          ? "Boards are paused."
          : res.code === "rate_limited"
            ? "Too many requests. Try again in a moment."
            : "The boards could not load. Try again.",
      );
      return;
    }
    setBoard(nextBoard);
    setView(res.data);
    const label = BOARDS.find((b) => b.key === nextBoard)?.label ?? "";
    setStatus(`${label} board, page ${res.data.page} of ${res.data.totalPages}.`);
  }

  useEffect(() => {
    if (refresh) void load("daily", 1);
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meta = BOARDS.find((b) => b.key === board)!;
  const rows = view?.board === board ? view.rows : [];
  const showPodium = board === "daily" && view?.page === 1 && rows.length > 0;
  const listRows = showPodium ? rows.slice(3) : rows;

  return (
    <section aria-labelledby={headingId} className="rounded-[20px] border border-line bg-surface p-5 sm:p-6">
      <h2 id={headingId} className="text-lg font-bold text-ink">
        Boards
      </h2>
      <div role="group" aria-label="Choose a board" className="mt-3 flex flex-wrap gap-2">
        {BOARDS.map((b) => (
          <button
            key={b.key}
            type="button"
            aria-pressed={board === b.key}
            disabled={busy}
            onClick={() => load(b.key, 1)}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
              board === b.key ? "border-brand-cyan bg-brand-cyan/10 text-ink" : "border-line text-ink-muted hover:text-ink"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      {error && <p className="mt-3 text-sm text-signal-danger">{error}</p>}

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">
          {view?.yourRank && view.board === board
            ? // The reader has a rank but the rows are empty: they are kept off
              // the board (said under their rank), or the shared board is a
              // minute behind.
              view.viewerHidden
              ? "Nobody else is on this board yet."
              : "Nobody else is on this board yet. The shared board refreshes within a minute."
            : board === "daily"
              ? "Nobody has finished today's Hurry-Up yet. Be the first on the board."
              : "No one is on this board yet."}
        </p>
      ) : (
        <div className="mt-4">
          {showPodium && <Podium rows={rows} />}
          {listRows.length > 0 && (
            <ol className={showPodium ? "mt-4" : ""} aria-label={`${meta.label} board, ranks`}>
              {listRows.map((row) => (
                <BoardRowItem key={row.rank} row={row} figureUnit={meta.unit} secondaryLabel={meta.secondary} />
              ))}
            </ol>
          )}
        </div>
      )}

      {view?.yourRank && view.board === board && (
        <div className="mt-4 rounded-card border border-brand-cyan/40 bg-brand-cyan/5">
          <p className="px-3 pt-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-cyan">Your rank</p>
          <ol aria-label="Your rank">
            <BoardRowItem row={view.yourRank} figureUnit={meta.unit} secondaryLabel={meta.secondary} />
          </ol>
          {view.viewerHidden && (
            <p className="px-3 pb-3 text-xs text-ink-muted">
              Your account is kept off the public boards, so this is where you would stand; nobody else sees this
              row.
            </p>
          )}
        </div>
      )}

      {view && view.board === board && view.totalPages > 1 && (
        <nav aria-label={`${meta.label} board pages`} className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={busy || view.page <= 1}
            onClick={() => load(board, view.page - 1)}
            className="inline-flex min-h-11 items-center rounded-card border border-line px-4 text-sm font-semibold text-ink disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
          >
            Previous page
          </button>
          <span className="text-sm text-ink-muted">
            Page {view.page} of {view.totalPages}
          </span>
          <button
            type="button"
            disabled={busy || view.page >= view.totalPages}
            onClick={() => load(board, view.page + 1)}
            className="inline-flex min-h-11 items-center rounded-card border border-line px-4 text-sm font-semibold text-ink disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
          >
            Next page
          </button>
        </nav>
      )}
    </section>
  );
}
