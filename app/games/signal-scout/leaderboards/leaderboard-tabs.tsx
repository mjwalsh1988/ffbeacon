import Link from "next/link";
import { Zap, Trophy, Flame, type LucideIcon } from "lucide-react";
import type { Board } from "@/lib/signal-scout/leaderboards";

const TAB_META: { id: Board; label: string; icon: LucideIcon }[] = [
  { id: "daily", label: "Today's Top Scouts", icon: Zap },
  { id: "all_time", label: "All-Time Signal", icon: Trophy },
  { id: "streak", label: "Longest Signal Streak", icon: Flame },
];

/** board=daily may omit the query param (bare canonical path). */
function hrefFor(boardId: Board): string {
  return boardId === "daily"
    ? "/games/signal-scout/leaderboards"
    : `/games/signal-scout/leaderboards?board=${boardId}`;
}

/**
 * Routed board switcher for /games/signal-scout/leaderboards, matching
 * components/league-tabs.tsx exactly in structure and styling (cockpit bar
 * with beacon hairline). These are navigation LINKS to the same route with a
 * different ?board= value, not in-place tabs, so the pattern is <nav> +
 * <Link aria-current="page">, not a tablist. Switching boards resets to page
 * 1 (the href never carries ?page). Only boards enabled in Signal Scout
 * settings render a tab.
 */
export function LeaderboardTabs({
  activeBoard,
  enabledBoards,
}: {
  activeBoard: Board;
  enabledBoards: Board[];
}) {
  const tabs = TAB_META.filter((t) => enabledBoards.includes(t.id));
  if (tabs.length === 0) return null;

  return (
    <nav aria-label="Leaderboard boards" className="border-b border-line">
      <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 lg:px-8">
        <div
          className="relative overflow-hidden rounded-modal border border-line-accent bg-surface/70 p-1.5 shadow-[0_0_70px_-50px_rgba(168,85,247,0.7)] sm:p-2"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.08) 0%, transparent 60%)",
          }}
        >
          {/* Top-edge beacon hairline, decorative (matches the cockpit panels). */}
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px"
            style={{
              backgroundImage:
                "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
            }}
          />
          <ul className="flex flex-wrap gap-1.5">
            {tabs.map((t) => {
              const isActive = t.id === activeBoard;
              const Icon = t.icon;
              return (
                <li key={t.id}>
                  <Link
                    href={hrefFor(t.id)}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-1.5 rounded-card border px-3.5 py-1.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                      isActive
                        ? "border-brand-cyan/70 bg-brand-cyan/15 text-brand-cyan shadow-[0_0_22px_-8px_rgba(34,211,238,0.85)]"
                        : "border-transparent bg-base/50 text-ink-muted hover:bg-surface hover:text-ink"
                    }`}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4" />
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </nav>
  );
}
