import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { loadSignalScoutSettings } from "@/lib/signal-scout/settings";
import {
  boardSchema,
  MAX_PAGE,
  loadLeaderboardView,
  type Board,
  type LeaderboardView,
} from "@/lib/signal-scout/leaderboards";
import { LeaderboardTabs } from "./leaderboard-tabs";
import { LeaderboardTable, YourRankStrip } from "./leaderboard-table";
import { LeaderboardPager } from "./leaderboard-pager";
import { RetryCard } from "./retry-card";

export const metadata: Metadata = {
  title: "Signal Scout Leaderboards",
  description:
    "See who is decoding player clues fastest in Signal Scout: today's top scouts, all-time signal points, and the longest signal streaks.",
};

export const dynamic = "force-dynamic";

const BOARD_ORDER: Board[] = ["daily", "all_time", "streak"];

const EMPTY_COPY: Record<Board, string> = {
  daily: "No scouts on the board yet today. Be the first to decode a signal.",
  all_time: "No scouts on the board yet.",
  streak: "No scouts on the board yet.",
};

/**
 * Signal Scout leaderboards page (plan section 8). Reads board + page from
 * the URL, applies the same gates the API route applies (leaderboard master
 * flag, per-board flag, require_login), then calls the shared
 * loadLeaderboardView() from lib/signal-scout/leaderboards.ts.
 *
 * SIGN-IN GATE CHOICE: when require_login is on and there is no session, the
 * tab bar is still rendered (not hidden) so a signed-out visitor can see
 * there are three boards worth signing in for; every tab lands back on the
 * same sign-in card since the gate runs before any board's content loads,
 * regardless of which board the link points at.
 */
export default async function SignalScoutLeaderboardsPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string; page?: string }>;
}) {
  const { board: boardParam, page: pageParam } = await searchParams;

  const admin = createAdminClient();
  const settings = await loadSignalScoutSettings(admin);
  const { leaderboards } = settings;

  const perBoardEnabled: Record<Board, boolean> = {
    daily: leaderboards.daily_enabled,
    all_time: leaderboards.all_time_enabled,
    streak: leaderboards.streak_enabled,
  };
  const enabledBoards = BOARD_ORDER.filter((b) => perBoardEnabled[b]);

  if (!leaderboards.leaderboard_enabled || enabledBoards.length === 0) {
    return (
      <main id="main">
        <Hero />
        <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
          <OfflineCard />
        </div>
      </main>
    );
  }

  const boardParsed = boardSchema.safeParse(boardParam ?? "daily");
  let board: Board = boardParsed.success ? boardParsed.data : "daily";
  if (!perBoardEnabled[board]) {
    board = enabledBoards[0]!;
  }

  const rawPage = Number(pageParam ?? "1");
  let page = Number.isFinite(rawPage) ? Math.min(Math.max(Math.trunc(rawPage), 1), MAX_PAGE) : 1;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (leaderboards.require_login && !user) {
    return (
      <main id="main">
        <Hero />
        <LeaderboardTabs activeBoard={board} enabledBoards={enabledBoards} />
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
          <div className="mx-auto max-w-2xl">
            <SignInCard />
          </div>
        </div>
      </main>
    );
  }

  const meId = user?.id ?? null;

  let view: LeaderboardView | null = null;
  try {
    view = await loadLeaderboardView(admin, board, page, meId, leaderboards.hide_admin_users);
  } catch (err) {
    console.error("[signal-scout]", err);
    return (
      <main id="main">
        <Hero />
        <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
          <RetryCard />
        </div>
      </main>
    );
  }

  // A page requested beyond the available data (e.g. a stale bookmark)
  // clamps down to the last real page and reloads once.
  if (page > view.totalPages) {
    page = view.totalPages;
    try {
      view = await loadLeaderboardView(admin, board, page, meId, leaderboards.hide_admin_users);
    } catch (err) {
      console.error("[signal-scout]", err);
      return (
        <main id="main">
          <Hero />
          <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
            <RetryCard />
          </div>
        </main>
      );
    }
  }

  return (
    <main id="main">
      <Hero />
      <LeaderboardTabs activeBoard={board} enabledBoards={enabledBoards} />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {view.yourRank && <YourRankStrip board={board} row={view.yourRank} />}
        {user && !view.yourRank && (
          <p className="mb-4 text-sm text-ink-muted">
            You are not on this board yet. Complete a round to get on it.
          </p>
        )}
        {view.rows.length === 0 ? (
          <EmptyCard board={board} />
        ) : (
          <LeaderboardTable board={board} page={page} rows={view.rows} />
        )}
        <LeaderboardPager board={board} currentPage={page} totalPages={view.totalPages} />
      </div>
    </main>
  );
}

function Hero() {
  return (
    <header className="relative overflow-hidden border-b border-line">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 h-[280px] w-[720px] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(168, 85, 247, 0.16) 0%, rgba(34, 211, 238, 0.08) 45%, transparent 75%)",
        }}
      />
      <div className="relative mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          Games, Signal Scout
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          <span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
          >
            Leaderboards
          </span>
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-muted sm:text-base">
          See who is decoding player clues fastest: today's top scouts, all-time signal points,
          and the longest signal streaks.
        </p>
        <Link
          href="/games/signal-scout"
          className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-cyan underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Back to Signal Scout
        </Link>
      </div>
    </header>
  );
}

function OfflineCard() {
  return (
    <div role="status" className="rounded-modal border border-line bg-surface/50 p-6 text-center sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">Signal Scout</p>
      <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink">Leaderboards are offline.</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        Check back soon, or go play a round while you wait.
      </p>
      <Link
        href="/games/signal-scout"
        className="mt-5 inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        Back to Signal Scout
      </Link>
    </div>
  );
}

function SignInCard() {
  return (
    <div className="rounded-modal border border-line bg-surface/60 p-6 text-center sm:p-8">
      <h2 className="text-xl font-semibold tracking-tight text-ink">
        Sign in to view the leaderboards
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
        A free account saves your streaks and gets you on the boards. Sign in or create one to
        see where you rank.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Create a free account
        </Link>
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}

function EmptyCard({ board }: { board: Board }) {
  return (
    <div role="status" className="rounded-modal border border-line bg-surface/50 p-6 text-center sm:p-8">
      <p className="text-sm leading-relaxed text-ink-muted">{EMPTY_COPY[board]}</p>
    </div>
  );
}
