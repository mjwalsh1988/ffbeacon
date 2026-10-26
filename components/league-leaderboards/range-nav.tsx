/**
 * Season, or one settled week. Plain links, so a range is a URL somebody can
 * paste into the league chat and it opens on the same view.
 *
 * One row that scrolls sideways on a phone. A playoff week carries a small
 * "P" for the eye and the word "playoffs" for the ear, inside the same link.
 */

import Link from "next/link";
import type { Route } from "next";
import { withUsername } from "@/components/league-schedule/format";

const PILL =
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-full border px-3.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

export function leaderboardsHref(
  sleeperLeagueId: string,
  week: number | null,
  linkUsername: string | null,
): string {
  return withUsername(
    `/leagues/${sleeperLeagueId}/leaderboards${week !== null ? `?week=${week}` : ""}`,
    linkUsername,
  );
}

export function RangeNav({
  sleeperLeagueId,
  weeks,
  current,
  playoffWeekStart,
  linkUsername,
}: {
  sleeperLeagueId: string;
  weeks: number[];
  current: number | null;
  playoffWeekStart: number | null;
  linkUsername: string | null;
}) {
  // The visible label is the start of the accessible name (WCAG 2.5.3), so a
  // speech user can say what they see. Only the playoff note is ear-only.
  const items: { week: number | null; label: string; playoff: boolean }[] = [
    { week: null, label: "Season", playoff: false },
    ...weeks.map((w) => ({
      week: w,
      label: `Week ${w}`,
      playoff: playoffWeekStart !== null && w >= playoffWeekStart,
    })),
  ];
  const anyPlayoff = items.some((item) => item.playoff);
  return (
    <nav aria-label="Leaderboard range">
      <ul role="list" className="beacon-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {items.map((item) => {
          const active = item.week === current;
          return (
            <li key={item.week ?? "season"}>
              <Link
                href={leaderboardsHref(sleeperLeagueId, item.week, linkUsername) as Route}
                aria-current={active ? "page" : undefined}
                className={`${PILL} ${
                  active
                    ? "border-brand-cyan/60 bg-brand-cyan/15 text-brand-cyan"
                    : "border-line bg-surface/70 text-ink-muted hover:border-line-accent hover:text-ink"
                }`}
              >
                {item.label}
                {item.playoff && (
                  <>
                    <span aria-hidden="true" className="rounded-full bg-brand-purple/25 px-1 text-[9px] font-bold text-brand-purple-light">
                      P
                    </span>
                    <span className="sr-only">, playoffs</span>
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {/* The key to the "P", for sighted readers; the ear hears "playoffs". */}
      {anyPlayoff && (
        <p aria-hidden="true" className="mt-1 text-[11px] text-ink-subtle">
          P marks a playoff week.
        </p>
      )}
    </nav>
  );
}
