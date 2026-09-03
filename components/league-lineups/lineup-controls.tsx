"use client";

/**
 * Which team, and which week.
 *
 * CLIENT, because both controls change the URL. The page stays a server
 * component and re-renders from the new search params; this bar owns nothing
 * but the announcement it makes after a change.
 *
 * DELIBERATELY SIMPLER THAN components/league-schedule/schedule-controls.tsx,
 * which also has a mode switch and a team search box. This page has two
 * dimensions rather than three, and a twelve-team select does not need a filter
 * above it. The pieces that ARE the same are the same: native selects rather
 * than a custom listbox (a select already has typeahead, a platform picker on
 * touch and correct announcements in every screen reader), state carried in the
 * option TEXT rather than in a tint, and a sticky one-row bar at the deep
 * view's own top offset.
 *
 * WHY THE ANNOUNCEMENT STARTS EMPTY
 *   A live region populated on first paint gets announced on arrival, on top of
 *   the page title and the heading, which buries all three. It fills in only
 *   inside a change handler, so it says one thing at the moment one thing
 *   happened.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { HAIRLINE_STYLE, recordLabel, withUsername } from "@/components/league-schedule/format";
import type { LineupTeamOption } from "@/lib/league-lineups/types";
import type { LineupWeekOption } from "@/lib/league-lineups/weeks";

const CONTROL =
  "min-h-11 w-full rounded-card border border-line bg-base px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

const STEPPER =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-40";

const FIRST_NOTE_ID = "lineup-week-first-note";
const LAST_NOTE_ID = "lineup-week-last-note";

/** "Week 8 (this week)". Every piece of state that matters lives in the text. */
function weekOptionLabel(option: LineupWeekOption): string {
  if (option.isCurrent) return `Week ${option.week} (this week)`;
  if (option.isFinal) return `Week ${option.week} (final)`;
  return `Week ${option.week}`;
}

export function LineupControls({
  sleeperLeagueId,
  searchedUsername,
  week,
  weeks,
  rosterId,
  teams,
}: {
  sleeperLeagueId: string;
  searchedUsername: string | null;
  week: number;
  weeks: LineupWeekOption[];
  rosterId: number;
  teams: LineupTeamOption[];
}) {
  const router = useRouter();
  const [announcement, setAnnouncement] = useState("");

  const go = (next: { week?: number; roster?: number }) => {
    const params = new URLSearchParams();
    params.set("roster", String(next.roster ?? rosterId));
    params.set("week", String(next.week ?? week));
    router.push(
      withUsername(`/leagues/${sleeperLeagueId}/lineups?${params.toString()}`, searchedUsername),
    );
  };

  const weekIndex = weeks.findIndex((w) => w.week === week);
  const atFirst = weekIndex <= 0;
  const atLast = weekIndex === -1 || weekIndex >= weeks.length - 1;
  const prevWeek = atFirst ? null : weeks[weekIndex - 1].week;
  const nextWeek = atLast ? null : weeks[weekIndex + 1].week;

  const goWeek = (target: number) => {
    go({ week: target });
    setAnnouncement(`Week ${target}.`);
  };

  const goTeam = (target: number) => {
    go({ roster: target });
    const team = teams.find((t) => t.sleeperRosterId === target);
    setAnnouncement(`Showing ${team ? team.teamName : "the selected team"}, week ${week}.`);
  };

  return (
    <div className="sticky top-[5.5rem] z-20 overflow-hidden rounded-modal border border-line bg-surface/80 backdrop-blur supports-[backdrop-filter]:bg-surface/60">
      {/* pointer-events-none, like every other copy of this hairline on the
          site. It is absolutely positioned across the full width of the bar,
          so without it a pointer (and a screen reader following one) lands on
          a decorative gradient instead of the control underneath. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={HAIRLINE_STYLE}
      />

      {/* One row from sm up, two on a phone, and nothing is dropped at either
          width. The labels are sr-only because each option already reads
          "Week 8 (this week)" and "Team name (6-2)", so a visible label above
          the control would repeat what the control says. */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
        <div className="min-w-0 flex-1 basis-full sm:basis-0">
          <label htmlFor="lineup-team-select" className="sr-only">
            Team
          </label>
          <select
            id="lineup-team-select"
            value={rosterId}
            onChange={(event) => goTeam(Number(event.target.value))}
            className={CONTROL}
          >
            {teams.map((team) => (
              <option key={team.sleeperRosterId} value={team.sleeperRosterId}>
                {team.teamName} ({recordLabel(team.record)})
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <button
            type="button"
            className={STEPPER}
            disabled={atFirst}
            aria-describedby={prevWeek === null ? FIRST_NOTE_ID : undefined}
            onClick={() => {
              if (prevWeek === null) return;
              goWeek(prevWeek);
            }}
            aria-label={
              prevWeek === null
                ? `Previous week, unavailable. Week ${week} is the first week of this season.`
                : `Previous week, week ${prevWeek}.`
            }
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </button>

          <label htmlFor="lineup-week-select" className="sr-only">
            Week
          </label>
          <select
            id="lineup-week-select"
            value={week}
            onChange={(event) => goWeek(Number(event.target.value))}
            className={`${CONTROL} min-w-0 flex-1 sm:w-56 sm:flex-none`}
          >
            {weeks.map((option) => (
              <option key={option.week} value={option.week}>
                {weekOptionLabel(option)}
              </option>
            ))}
          </select>

          <button
            type="button"
            className={STEPPER}
            disabled={atLast}
            aria-describedby={nextWeek === null ? LAST_NOTE_ID : undefined}
            onClick={() => {
              if (nextWeek === null) return;
              goWeek(nextWeek);
            }}
            aria-label={
              nextWeek === null
                ? `Next week, unavailable. Week ${week} is the last week of this season.`
                : `Next week, week ${nextWeek}.`
            }
          >
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        {/* WHY A STEPPER IS GREYED OUT, and why this is VISIBLE and CONDITIONAL.
            Both properties are load bearing and the first version of this file
            got both wrong.

            Visible, because `disabled` takes a button out of the tab order, so
            the `aria-describedby` on it can never be reached by anyone tabbing
            the bar; a sighted reader was left with nothing but a faded chevron.
            Conditional, because rendering both notes unconditionally meant a
            screen reader read straight through the control bar and heard "Week
            8 is the first week of this season. Week 8 is the last week of this
            season", which is two false and mutually contradictory sentences on
            every ordinary week.

            Same shape and same reasoning as
            components/league-schedule/schedule-controls.tsx. */}
        {prevWeek === null && (
          <p id={FIRST_NOTE_ID} className="text-[11px] leading-tight text-ink-muted">
            Week {week} is the first week of this season.
          </p>
        )}
        {nextWeek === null && (
          <p id={LAST_NOTE_ID} className="text-[11px] leading-tight text-ink-muted">
            Week {week} is the last week of this season.
          </p>
        )}
      </div>

      {/* What just changed, said once. `role="status"` rather than a bare
          aria-live, for the implicit aria-atomic and the better support on a
          node whose whole text is replaced. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
