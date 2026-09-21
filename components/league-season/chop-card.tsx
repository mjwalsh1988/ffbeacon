/**
 * Who went out, in a chopped league.
 *
 * The biggest thing that happened in a guillotine league this week is that
 * somebody stopped being in it, and until now the overview reported that the
 * same way it reports a waiver claim. It leads the column instead.
 *
 * THE AXE IS DECORATIVE and marked as such. The heading and the sentence
 * beside it carry every word of the meaning, so a reader who never sees the
 * icon loses nothing. It is the one flourish on the card for the same reason
 * the trophy is the one flourish on the champion's: a league that plays this
 * format came for the drama, and a line of grey text does not deliver it.
 *
 * Renders nothing before the first chop. An empty "nobody has been chopped"
 * card would take the top of the page every week of the preseason to say that
 * nothing has happened.
 *
 * Server component: presentation over data the caller resolved.
 */

import { Axe } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import type { OutcomeTeam } from "@/lib/league-season/load";

export function ChopCard({
  chop,
  thisWeek,
  aliveCount,
  choppedCount,
}: {
  chop: OutcomeTeam & { week: number };
  /** True when this chop settled in the week just gone. */
  thisWeek: boolean;
  aliveCount: number;
  choppedCount: number;
}) {
  // The week is named either way. "This week" is how it is introduced when it
  // is news; an older chop is introduced as the last one, because a reader
  // opening the page in week 9 must not read a week 2 elimination as Sunday's.
  const eyebrow = thisWeek ? "This week" : "Last chop";
  const title = thisWeek ? "Chopped this week" : `Chopped in week ${chop.week}`;

  return (
    <Panel eyebrow={eyebrow} title={title} bodyClassName="px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3 sm:gap-4">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-card border border-brand-purple/50 bg-brand-purple/10 text-brand-purple sm:h-14 sm:w-14"
        >
          <Axe className="h-6 w-6 sm:h-7 sm:w-7" />
        </span>
        {/* Decorative: the name is rendered as visible text beside it. */}
        <SleeperAvatar
          avatarId={chop.avatarId}
          initial={chop.name.charAt(0)}
          title=""
          size={48}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold tracking-tight text-ink sm:text-xl">
            {chop.name}
          </p>
          {chop.ownerLabel && (
            <p className="truncate text-sm text-ink-subtle">{chop.ownerLabel}</p>
          )}
          {/* "Eliminated", not "lowest score". Nothing here reads a score: the
              week comes from Sleeper's `eliminated` setting, which is how the
              chop is recorded rather than why it happened. That is the same
              thing in a normal guillotine week and is not after a commissioner
              override, and this card names a real person. */}
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            Eliminated in week {chop.week}
            {chop.pointsFor !== null
              ? `, out on ${chop.pointsFor.toFixed(1)} points for the season`
              : ""}
            .
          </p>
        </div>
      </div>

      <p className="mt-3 border-t border-line pt-3 text-xs text-ink-muted">
        {aliveCount} {aliveCount === 1 ? "team" : "teams"} still in,{" "}
        {choppedCount} out.
      </p>
    </Panel>
  );
}
