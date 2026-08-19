"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import Link from "next/link";
import { Zap, Trophy, Flame, ChevronLeft, ChevronRight, AlertTriangle, type LucideIcon } from "lucide-react";
import { ImageWithFallback } from "@/components/image-with-fallback";
import type {
  Board,
  LeaderboardRow,
  DailyBoardRow,
  AllTimeBoardRow,
  StreakBoardRow,
} from "@/lib/signal-scout/leaderboards";
import type { LeaderboardViewDto } from "@/lib/signal-scout/client";

/**
 * The leaderboard boards themselves: board tabs, one board page of rows, the
 * caller's own rank, and the pager. Purely presentational. Every piece of
 * state (which board, which page, the loaded view, loading/error) is owned by
 * leaderboard-rail.tsx and passed down, because the rail renders this
 * component twice (the desktop sidebar and the mobile slide-up modal) and both
 * copies must show the same thing.
 *
 * ROWS, NOT A TABLE: this replaces the old routed leaderboards page, whose
 * boards were 5-6 column <table>s (rank, scout, points, rounds, accuracy, and
 * so on). None of that fits a ~20rem sidebar, and per the mobile-first rule in
 * CLAUDE.md the answer to "more data than fits" is a compact layout, never a
 * dropped column. So each scout is a two-line row: rank, avatar, name and the
 * headline stat on line one, every remaining stat spelled out on line two
 * ("3 rounds, 67% accuracy"). No column is hidden at any breakpoint, and the
 * DOM order makes each row read as one sentence: "Rank 1, Scout-4f2a, 142
 * points, 3 rounds, 67% accuracy".
 *
 * Ids are derived from useId() rather than hardcoded, so the sidebar copy and
 * the modal copy never collide.
 */

const TAB_META: { id: Board; short: string; full: string; icon: LucideIcon }[] = [
  { id: "daily", short: "Today", full: "Today's Top Scouts", icon: Zap },
  { id: "all_time", short: "All-Time", full: "All-Time Signal", icon: Trophy },
  { id: "streak", short: "Streak", full: "Longest Signal Streak", icon: Flame },
];

const EMPTY_COPY: Record<Board, string> = {
  daily: "No scouts on the board yet today. Be the first to decode a signal.",
  all_time: "No scouts on the board yet.",
  streak: "No scouts on the board yet.",
};

export function boardLabel(board: Board): string {
  return TAB_META.find((t) => t.id === board)?.full ?? "Leaderboard";
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

interface RowSummary {
  /** The headline number for this board. */
  primary: string;
  /** Short visible unit ("pts"), hidden from screen readers. */
  unit: string;
  /** Spoken unit ("points"), hidden from sighted users. */
  unitSr: string;
  /** Every remaining stat, already spelled out as readable prose. */
  detail: string;
}

/**
 * Flatten a board row into the two lines the compact row renders. This is
 * where the old table's per-board columns live on: every column that board's
 * table had is either the primary stat or named in `detail`.
 */
function rowSummary(board: Board, row: LeaderboardRow): RowSummary {
  if (board === "daily") {
    const r = row as DailyBoardRow;
    return {
      primary: String(r.points),
      unit: "pts",
      unitSr: "points",
      detail: `${plural(r.rounds, "round", "rounds")}, ${
        r.accuracy === null ? "accuracy not available" : `${r.accuracy}% accuracy`
      }`,
    };
  }
  if (board === "all_time") {
    const r = row as AllTimeBoardRow;
    return {
      primary: String(r.totalPoints),
      unit: "pts",
      unitSr: "total points",
      detail: `${plural(r.wins, "win", "wins")}, ${
        r.winRate === null ? "win rate not available" : `${r.winRate}% win rate`
      }, best streak ${r.bestStreak}`,
    };
  }
  const r = row as StreakBoardRow;
  return {
    primary: String(r.bestStreak),
    unit: "best",
    unitSr: "best streak",
    detail: `Current streak ${r.currentStreak}, ${plural(r.totalPoints, "point", "points")}`,
  };
}

function RankBadge({ rank }: { rank: number }) {
  // Top 3 get a styled treatment but the plain number stays visible either way.
  // Fixed width keeps every row's avatar and name on the same left edge no
  // matter how many digits the rank has.
  const isTop3 = rank <= 3;
  return (
    <span
      className={
        isTop3
          ? "mt-0.5 inline-flex w-7 shrink-0 items-center justify-center rounded-full border border-brand-cyan/50 bg-brand-cyan/10 py-0.5 text-xs font-bold text-brand-cyan"
          : "mt-0.5 inline-flex w-7 shrink-0 items-center justify-center py-0.5 text-xs text-ink-muted"
      }
    >
      <span className="sr-only">Rank </span>
      {rank}
    </span>
  );
}

/** Shared innards of a scout row, used by both the board list and the your-rank card. */
function RowContent({ board, row }: { board: Board; row: LeaderboardRow }) {
  const { primary, unit, unitSr, detail } = rowSummary(board, row);
  return (
    <>
      <RankBadge rank={row.rank} />
      {/* alt="" is intentional: the display name renders as adjacent visible
          text right after the avatar, so the image is decorative. */}
      <ImageWithFallback src={row.avatarUrl} alt="" size={26} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={`min-w-0 flex-1 truncate text-sm ${row.isYou ? "font-semibold text-ink" : "text-ink"}`}
          >
            {row.scout}
          </span>
          {row.isYou && (
            <span className="inline-flex shrink-0 items-center rounded-full border border-brand-cyan/60 bg-brand-cyan/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand-cyan">
              You
            </span>
          )}
          <span className="shrink-0 text-sm font-semibold text-ink">
            {primary}
            <span aria-hidden="true" className="ml-1 font-normal text-ink-muted">
              {unit}
            </span>
            <span className="sr-only"> {unitSr}</span>
          </span>
        </div>
        {/* Never truncated: this line is the only place the non-headline stats
            appear, so it wraps rather than hiding a value. */}
        <p className="mt-0.5 text-[11px] leading-snug text-ink-subtle">{detail}</p>
      </div>
    </>
  );
}

export function LeaderboardPanel({
  variant,
  boards,
  activeBoard,
  onSelectBoard,
  view,
  loading,
  error,
  teaser,
  onRetry,
  onPageChange,
}: {
  /** "rail" draws its own card chrome and heading; "sheet" is bare, because
   * the slide-up modal supplies both. */
  variant: "rail" | "sheet";
  boards: Board[];
  activeBoard: Board;
  onSelectBoard: (board: Board) => void;
  /** Null while the very first load is in flight, or after a failure. */
  view: LeaderboardViewDto | null;
  loading: boolean;
  error: string | null;
  /** leaderboards.require_login is on and nobody is signed in: show the
   * sign-in card instead of rows. The rail never fetches in this state, and
   * the server never sends row data for it either. */
  teaser: boolean;
  onRetry: () => void;
  onPageChange: (page: number) => void;
}) {
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = TAB_META.filter((t) => boards.includes(t.id));
  const panelId = `${baseId}-panel`;
  // With a single enabled board there is nothing to switch between, so no
  // tablist renders. The board then has to stop calling itself a tabpanel
  // too: a lone role="tabpanel" outside a tablist is a broken relationship,
  // and its aria-labelledby would point at a tab id that does not exist.
  const tabbed = tabs.length > 1;

  // Automatic-activation tabs, matching app/tools/beacon-breakdown/breakdown-tabs.tsx:
  // arrow keys move focus and switch board in one step, Home/End jump to the ends.
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    onSelectBoard(tabs[next]!.id);
    tabRefs.current[next]?.focus();
  };

  // The rail copy is xl and up, where a pointer is the input and CLAUDE.md's
  // 44px floor (which is about the compact mobile layout) does not apply. It
  // gets 36px tall tabs and a tighter frame so three boards cost less of a
  // 340px column. The sheet copy is the one a thumb uses, so it keeps 44px.
  const compactTabs = variant === "rail";
  const tabListClass = compactTabs
    ? "grid grid-cols-3 gap-0.5 rounded-card border border-line-accent bg-base/50 p-0.5"
    : "grid grid-cols-3 gap-1 rounded-card border border-line-accent bg-base/50 p-1";
  const tabHeightClass = compactTabs ? "min-h-9" : "min-h-11";

  const body = (
    <>
      {tabbed && (
        <div role="tablist" aria-label="Leaderboard boards" className={tabListClass}>
          {tabs.map((tab, index) => {
            const selected = tab.id === activeBoard;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[index] = el;
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={panelId}
                aria-label={tab.full}
                tabIndex={selected ? 0 : -1}
                onClick={() => onSelectBoard(tab.id)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
                className={`flex ${tabHeightClass} items-center justify-center gap-1.5 rounded-card border px-1 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                  selected
                    ? "border-brand-cyan/70 bg-brand-cyan/15 text-brand-cyan shadow-[0_0_22px_-8px_rgba(34,211,238,0.85)]"
                    : "border-transparent text-ink-muted hover:bg-surface hover:text-ink"
                }`}
              >
                <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                {tab.short}
              </button>
            );
          })}
        </div>
      )}

      <div
        // Only a real tabpanel gets the role, the labelling, and the tabIndex
        // that APG asks for. With one board it is just a div holding a list.
        {...(tabbed
          ? {
              role: "tabpanel" as const,
              id: panelId,
              "aria-labelledby": `${baseId}-tab-${activeBoard}`,
              tabIndex: 0,
            }
          : {})}
        className={
          tabbed
            ? "mt-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            : ""
        }
      >
        {teaser ? (
          <SignInCard />
        ) : error ? (
          <div className="rounded-card border border-signal-danger/40 bg-signal-danger/10 p-3">
            <div role="alert" className="flex items-start gap-2 text-sm text-signal-danger">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex min-h-11 items-center rounded-card border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Try again
            </button>
          </div>
        ) : (
          // aria-busy + a dim rather than a spinner: the previous board stays
          // readable while the next one loads, so the panel never collapses to
          // an empty box mid-switch.
          <div
            aria-busy={loading}
            className={loading ? "opacity-50 transition-opacity duration-150 motion-reduce:transition-none" : ""}
          >
            {view?.yourRank && (
              <div
                role="group"
                aria-label="Your rank"
                className="mb-3 rounded-card border border-brand-cyan/50 bg-brand-cyan/5 px-2 py-2 shadow-[0_0_30px_-18px_rgba(34,211,238,0.9)]"
              >
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
                  Your rank
                </p>
                <div className="flex items-start gap-2.5">
                  <RowContent board={activeBoard} row={view.yourRank} />
                </div>
              </div>
            )}

            {view && view.rows.length === 0 ? (
              <p role="status" className="px-1 py-3 text-sm leading-relaxed text-ink-muted">
                {EMPTY_COPY[activeBoard]}
              </p>
            ) : (
              <ol className="space-y-0.5">
                {(view?.rows ?? []).map((row) => (
                  <li
                    key={row.rank}
                    className={`flex items-start gap-2.5 rounded-card px-2 py-1.5 ${
                      row.isYou ? "bg-brand-cyan/5" : ""
                    }`}
                  >
                    <RowContent board={activeBoard} row={row} />
                  </li>
                ))}
              </ol>
            )}

            {view && view.totalPages > 1 && (
              <Pager
                page={view.page}
                totalPages={view.totalPages}
                loading={loading}
                onPageChange={onPageChange}
              />
            )}
          </div>
        )}
      </div>
    </>
  );

  if (variant === "sheet") return body;

  return (
    <section
      aria-labelledby={`${baseId}-heading`}
      className="relative overflow-hidden rounded-modal border border-brand-purple/25 bg-surface/30 p-4"
      style={{
        backgroundImage:
          "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.08) 0%, transparent 60%)",
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      <div className="mb-3 flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-brand-cyan/40 bg-base text-brand-cyan"
        >
          <Trophy className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            Signal Scout
          </p>
          <h2 id={`${baseId}-heading`} className="text-base font-semibold tracking-tight text-ink">
            Leaderboards
          </h2>
        </div>
      </div>
      {body}
    </section>
  );
}

function Pager({
  page,
  totalPages,
  loading,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  const btn =
    "inline-flex min-h-11 items-center gap-1 rounded-card border border-line bg-surface px-2.5 text-xs font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:border-line disabled:bg-surface/40 disabled:text-ink-subtle disabled:opacity-60 disabled:hover:text-ink-subtle";

  return (
    <nav
      aria-label="Leaderboard pages"
      className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3"
    >
      <button
        type="button"
        disabled={page <= 1 || loading}
        onClick={() => onPageChange(page - 1)}
        className={btn}
      >
        <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
        Prev
      </button>
      <p className="text-[11px] text-ink-muted">
        Page <span className="font-semibold text-ink">{page}</span> of {totalPages}
      </p>
      <button
        type="button"
        disabled={page >= totalPages || loading}
        onClick={() => onPageChange(page + 1)}
        className={btn}
      >
        Next
        <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </nav>
  );
}

/**
 * Shown when leaderboards.require_login is on and nobody is signed in. The
 * board tabs stay visible above this (a signed-out visitor should be able to
 * see there are three boards worth signing in for), but no row data is ever
 * fetched or sent for this state.
 */
function SignInCard() {
  return (
    <div className="rounded-card border border-line bg-base/40 p-4 text-center">
      <h3 className="text-sm font-semibold tracking-tight text-ink">
        Sign in to view the leaderboards
      </h3>
      <p className="mx-auto mt-1.5 text-xs leading-relaxed text-ink-muted">
        A free account saves your streaks and gets you on the boards.
      </p>
      <Link
        href="/login"
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        Create a free account
      </Link>
    </div>
  );
}
