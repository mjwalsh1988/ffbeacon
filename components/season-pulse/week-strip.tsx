/**
 * Links to every week that has a page, and the way between the Season Pulse
 * pages themselves.
 *
 * WeekStrip is a named nav of plain links. The week being viewed carries
 * aria-current="page" and the live week says so in words, because "Week 4"
 * with a cyan border and "Week 3" with a grey one is a colour-only distinction
 * otherwise.
 *
 * PulsePages is the small set of sibling pages, drawn as tiles in the rail.
 *
 * Server components.
 */

import Link from "next/link";
import type { Route } from "next";
import { BarChart3, CloudSun, Radio, Trophy, type LucideIcon } from "lucide-react";
import { LinkTile } from "@/components/link-tile";
import { publishedWeeks, weekPath } from "@/lib/season-pulse/weeks";

export function WeekStrip({ currentWeek, activeWeek }: { currentWeek: number; activeWeek?: number }) {
  const weeks = publishedWeeks(currentWeek).reverse();
  if (weeks.length === 0) return null;
  return (
    <nav aria-label="Weeks of the season">
      <ul role="list" className="flex flex-wrap gap-1.5">
        {weeks.map((week) => {
          const active = week === activeWeek;
          const live = week === currentWeek;
          return (
            <li key={week}>
              <Link
                href={weekPath(week) as Route}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-3.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                  active
                    ? "border-brand-cyan bg-brand-cyan/15 text-brand-cyan underline decoration-2 underline-offset-4"
                    : "border-line bg-surface/70 text-ink-muted hover:border-line-accent hover:text-ink"
                }`}
              >
                Week {week}
                {live && <span className="ml-1 font-normal opacity-80">, live</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

type PageKey = "hub" | "leaders" | "stats" | "weather";

const PAGES: { key: PageKey; href: string; icon: LucideIcon; title: string; body: string; accent?: "purple" }[] = [
  {
    key: "hub",
    href: "/season",
    icon: Radio,
    title: "Season Pulse",
    body: "The whole season on one page.",
  },
  {
    key: "leaders",
    href: "/season/leaders",
    icon: Trophy,
    title: "Fantasy leaders and ranks",
    body: "Every player's rank at his position, searchable.",
    accent: "purple",
  },
  {
    key: "stats",
    href: "/season/stats",
    icon: BarChart3,
    title: "NFL stat leaders",
    body: "Passing, rushing, receiving, usage and team records.",
  },
  {
    key: "weather",
    href: "/season/weather",
    icon: CloudSun,
    title: "NFL weather this week",
    body: "Every game's forecast and what it means for a lineup.",
    accent: "purple",
  },
];

/** The other Season Pulse pages, as tiles. The page being viewed is left out. */
export function PulsePages({ current }: { current: PageKey | "week" }) {
  return (
    <div className="grid gap-2">
      {PAGES.filter((p) => p.key !== current).map((p) => (
        <LinkTile key={p.key} href={p.href} icon={p.icon} title={p.title} body={p.body} accent={p.accent} />
      ))}
    </div>
  );
}
