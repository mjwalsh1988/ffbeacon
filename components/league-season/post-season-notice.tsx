/**
 * What a forward-looking League Pulse page says once the season is over.
 *
 * Two of these pages answer a question that no longer exists. Trade Ideas
 * prices a deal by what it does to the rest of your season, and Lineups tells
 * you who to start this week. With no weeks left, both would run their models
 * against an empty slate and print a confident zero, which is the same defect
 * Power Pulse refuses to cache. They render this instead.
 *
 * WHAT IT IS NOT. It is not an error and it is not a loading state, and it
 * does not read like one. The season finished, which is the normal end of a
 * league rather than something going wrong, so the card names the champion if
 * there is one and hands the reader to the pages that still have something to
 * say: what the season's decisions were worth, how the schedule fell, and
 * every trade and claim that was made.
 *
 * Schedules and Decisions are deliberately NOT in this state. Both are
 * retrospectives already, and a finished season is when they are most worth
 * reading.
 *
 * Server component: presentation over data the caller resolved.
 */

import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import type { OutcomeTeam } from "@/lib/league-season/load";

export type PostSeasonLink = {
  href: string;
  label: string;
  hint: string;
};

export function PostSeasonNotice({
  title,
  explanation,
  champion,
  season,
  links,
}: {
  /** What this page would have done, as a heading. */
  title: string;
  /** One sentence on why it is not doing it. */
  explanation: string;
  champion: OutcomeTeam | null;
  season: number | null;
  links: PostSeasonLink[];
}) {
  return (
    <Panel
      eyebrow={season ? `${season} season complete` : "Season complete"}
      title={title}
    >
      <p className="text-sm leading-relaxed text-ink-muted">{explanation}</p>

      {champion && (
        <p className="mt-4 flex items-center gap-2 rounded-card border border-line bg-base/50 px-3 py-2.5 text-sm text-ink">
          {/* Decorative: the word "won" beside it is the meaning. */}
          <Trophy
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-brand-cyan"
          />
          <span className="min-w-0">
            <span className="font-semibold">{champion.name}</span>
            {champion.ownerLabel ? ` (${champion.ownerLabel})` : ""} won it.
          </span>
        </p>
      )}

      {links.length > 0 && (
        <>
          <h3 className="mt-5 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
            Still worth reading
          </h3>
          <ul className="mt-2 space-y-2">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-card border border-line bg-base/50 px-3 py-2.5 text-sm transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">
                      {link.label}
                    </span>
                    <span className="block text-xs text-ink-subtle">
                      {link.hint}
                    </span>
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-ink-subtle"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
