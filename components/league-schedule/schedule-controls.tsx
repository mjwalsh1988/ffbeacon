"use client";

/**
 * The Schedule page's control bar: which mode, and which week or team.
 *
 * CLIENT, because every control here changes the URL. The page itself stays a
 * server component and re-renders from the new search params; this bar owns
 * nothing but the pending filter text and the sentence it announces.
 *
 * WHY THE STATE IS IN THE OPTION TEXT
 *   A week can be final, live, or a playoff week, and the obvious build tints
 *   the option or the stepper to say so. A tinted <option> is not a thing a
 *   browser reliably renders and it is not a thing a screen reader says at all,
 *   so the state lives in the words: "Week 3 (final)", "Week 8 (this week)",
 *   "Week 15 (playoffs)". Everyone gets the same information from the same
 *   place, which is also why the previous and next buttons carry a full
 *   sentence in their label when they sit at an end of the season.
 *
 * WHY A FILTER NARROWING A REAL SELECT, NOT A COMBOBOX
 *   Same reasoning as components/player-picker.tsx, which this mirrors: a
 *   native select already has typeahead, a platform picker on touch, and
 *   correct announcements in every screen reader, and a custom listbox has to
 *   reimplement all of it. So the select stays a select and a search box sits
 *   above it, and the currently selected team is never filtered out, because a
 *   control that can hide its own value will eventually change it silently.
 *
 * The bar sticks under the masthead at top-[5.5rem], the same offset the deep
 * view rail uses. Below sm it wraps to two rows and both halves go full width;
 * nothing is dropped at any breakpoint.
 */

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Search, Users } from "lucide-react";
import { FILTER_THRESHOLD, PanelFilterField } from "@/components/panel-filter-field";
import type { ScheduleTeam } from "@/lib/league-schedule/types";
import { HAIRLINE_STYLE, recordLabel, withUsername } from "./format";

export type ScheduleWeekOption = {
  week: number;
  isFinal: boolean;
  isCurrent: boolean;
  isPlayoffWeek: boolean;
};

const CONTROL =
  "min-h-11 w-full rounded-card border border-line bg-base px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

// Fixed ids, matching the hardcoded select ids below. Only one control bar is
// ever on the page.
const FIRST_NOTE_ID = "schedule-week-first-note";
const LAST_NOTE_ID = "schedule-week-last-note";
const FILTER_PANEL_ID = "schedule-team-filter";

const STEPPER =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-40";

/** Lowercase, unaccented, punctuation free, so a filter matches what was meant. */
function normalize(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFD")
      // The combining marks NFD just split off, escaped rather than written out
      // so this file stays plain ASCII. Stripped before the general cleanup,
      // which would otherwise turn each mark into a space and cut a name in half.
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** "Week 8 (this week)". Every piece of state that matters, in the text. */
function weekOptionLabel(option: ScheduleWeekOption): string {
  const notes: string[] = [];
  if (option.isPlayoffWeek) notes.push("playoffs");
  if (option.isCurrent) notes.push("this week");
  else if (option.isFinal) notes.push("final");
  return notes.length > 0
    ? `Week ${option.week} (${notes.join(", ")})`
    : `Week ${option.week}`;
}

export function ScheduleControls({
  sleeperLeagueId,
  linkUsername,
  view,
  week,
  rosterId,
  weeks,
  teams,
}: {
  sleeperLeagueId: string;
  linkUsername: string | null;
  view: "week" | "team";
  week: number;
  /** Null in week mode, and in team mode before a team has been chosen. */
  rosterId: number | null;
  weeks: ScheduleWeekOption[];
  teams: ScheduleTeam[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  /**
   * Empty until the reader changes something.
   *
   * A live region populated on first paint gets announced on arrival, on top of
   * the page title and the heading, which buries all three. It fills in only
   * inside a change handler, so it says one thing at the moment one thing
   * happened.
   */
  const [announcement, setAnnouncement] = useState("");
  /** The filter starts closed so the pinned bar is one row tall. */
  const [filterOpen, setFilterOpen] = useState(false);

  const weekIndex = weeks.findIndex((w) => w.week === week);
  const atFirst = weekIndex <= 0;
  const atLast = weekIndex === -1 || weekIndex >= weeks.length - 1;

  /**
   * How many games a week holds.
   *
   * The week list carries state, not contents, so the count comes from the
   * roster count: an even league pairs off exactly, an odd one leaves a roster
   * out, which is the case ceil covers. It is used only in the spoken
   * confirmation, where the count is what tells a reader the board under them
   * actually changed.
   */
  const matchupCount = Math.ceil(teams.length / 2);
  const matchupWords = `${matchupCount} ${matchupCount === 1 ? "matchup" : "matchups"}`;

  const go = (next: { view: "week" | "team"; week?: number; roster?: number | null }) => {
    const params = new URLSearchParams({ view: next.view });
    if (next.view === "week") {
      params.set("week", String(next.week ?? week));
    } else if (next.roster !== null && next.roster !== undefined) {
      params.set("roster", String(next.roster));
    }
    router.push(
      withUsername(
        `/leagues/${sleeperLeagueId}/schedules?${params.toString()}`,
        linkUsername,
      ),
    );
  };

  const goWeek = (nextWeek: number) => {
    go({ view: "week", week: nextWeek });
    setAnnouncement(`Week ${nextWeek}, ${matchupWords}.`);
  };

  const goTeam = (nextRoster: number) => {
    go({ view: "team", roster: nextRoster });
    const team = teams.find((t) => t.sleeperRosterId === nextRoster);
    setAnnouncement(
      `Showing ${team ? team.teamName : "the selected team"}, ${weeks.length} weeks.`,
    );
  };

  const selectedTeam = teams.find((t) => t.sleeperRosterId === rosterId) ?? null;
  const showFilter = teams.length > FILTER_THRESHOLD;

  const terms = useMemo(() => normalize(query).split(" ").filter(Boolean), [query]);
  const matches = useMemo(() => {
    if (terms.length === 0) return teams;
    return teams.filter((team) => {
      const hay = normalize(`${team.teamName} ${team.ownerHandle ?? ""}`);
      return terms.every((term) => hay.includes(term));
    });
  }, [teams, terms]);

  // The current pick rides along whether or not it matches. Narrowing the list
  // must never quietly discard the team the reader is looking at.
  const shownTeams = useMemo(() => {
    if (
      !selectedTeam ||
      matches.some((t) => t.sleeperRosterId === selectedTeam.sleeperRosterId)
    ) {
      return matches;
    }
    return [selectedTeam, ...matches];
  }, [matches, selectedTeam]);

  const filterStatus = (() => {
    if (terms.length === 0) {
      return `${teams.length} ${teams.length === 1 ? "team" : "teams"} in the list.`;
    }
    if (matches.length === 0) {
      return selectedTeam
        ? "No teams match. Only the team you are viewing is left in the list."
        : "No teams match.";
    }
    const kept =
      shownTeams.length > matches.length ? ", plus the team you are viewing" : "";
    return matches.length === 1
      ? `1 of ${teams.length} teams matches${kept}.`
      : `${matches.length} of ${teams.length} teams match${kept}.`;
  })();

  const prevWeek = atFirst ? null : weeks[weekIndex - 1].week;
  const nextWeek = atLast ? null : weeks[weekIndex + 1].week;

  return (
    <div className="sticky top-[5.5rem] z-20 overflow-hidden rounded-modal border border-line bg-surface/80 backdrop-blur supports-[backdrop-filter]:bg-surface/60">
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={HAIRLINE_STYLE}
      />

      {/* ONE ROW ON DESKTOP, and that is the whole point of this layout.
          The first version stacked a label above every control and let the
          filter and the end-of-season notes push it to three or four lines. A
          bar that sticks to the top of the viewport spends that height on every
          screen of every scroll, and this page is a long scroll by design.
          Every label is now sr-only: the options already read "Week 8 (this
          week)" and "Team name (6-2)", so a visible "Week" above the control was
          repeating what the control says. Screen readers still get the label. */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
        <div
          role="group"
          aria-label="Schedules view"
          className="flex shrink-0 gap-1.5"
        >
          <ViewButton
            active={view === "week"}
            onClick={() => {
              go({ view: "week", week });
              setAnnouncement(`Week ${week}, ${matchupWords}.`);
            }}
            icon={<CalendarDays aria-hidden="true" className="h-4 w-4" />}
            label="By week"
          />
          <ViewButton
            active={view === "team"}
            onClick={() => {
              const target = rosterId ?? teams[0]?.sleeperRosterId ?? null;
              if (target === null) return;
              goTeam(target);
            }}
            icon={<Users aria-hidden="true" className="h-4 w-4" />}
            label="By team"
          />
        </div>

        {view === "week" ? (
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

            <label htmlFor="schedule-week-select" className="sr-only">
              Week
            </label>
            <select
              id="schedule-week-select"
              value={week}
              onChange={(event) => goWeek(Number(event.target.value))}
              className={`${CONTROL} min-w-0 flex-1 sm:w-64 sm:flex-none`}
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
        ) : (
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
            {showFilter && (
              <button
                type="button"
                onClick={() => setFilterOpen((open) => !open)}
                aria-expanded={filterOpen}
                aria-controls={FILTER_PANEL_ID}
                className={`${STEPPER} ${
                  filterOpen || query ? "border-brand-cyan/60 text-brand-cyan" : ""
                }`}
                aria-label={
                  filterOpen ? "Hide the team filter" : "Filter the team list by name"
                }
              >
                <Search aria-hidden="true" className="h-4 w-4" />
              </button>
            )}
            <label htmlFor="schedule-team-select" className="sr-only">
              Team
            </label>
            <select
              id="schedule-team-select"
              value={rosterId ?? ""}
              onChange={(event) => goTeam(Number(event.target.value))}
              className={`${CONTROL} min-w-0 flex-1 sm:w-80 sm:flex-none`}
            >
              {rosterId === null && <option value="">Choose a team</option>}
              {shownTeams.map((team) => (
                <option key={team.sleeperRosterId} value={team.sleeperRosterId}>
                  {`${team.teamName} (${recordLabel(team.record)})`}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Why a stepper is greyed out. The sentence is in the button's
            aria-label too, but a disabled button is out of the tab order, so
            nobody tabbing the controls lands on it to hear it, and sighted
            readers get nothing but a faded chevron. Inline in the same wrapping
            row, so it costs no height on a screen wide enough to hold it. */}
        {view === "week" && prevWeek === null && (
          <p id={FIRST_NOTE_ID} className="text-[11px] leading-tight text-ink-muted">
            Week {week} is the first week of this season.
          </p>
        )}
        {view === "week" && nextWeek === null && (
          <p id={LAST_NOTE_ID} className="text-[11px] leading-tight text-ink-muted">
            Week {week} is the last week of this season.
          </p>
        )}
      </div>

      {/* The filter is behind a toggle rather than always open, because it is
          three elements tall (label, input, status) and this bar is pinned to
          the viewport. The native select already has typeahead, so the filter is
          the second way in rather than the only one. */}
      {view === "team" && showFilter && filterOpen && (
        <div id={FILTER_PANEL_ID} className="border-t border-line px-3 py-2 sm:px-4">
          <PanelFilterField
            label="Filter teams"
            placeholder="Filter by team or manager"
            value={query}
            onChange={setQuery}
            status={filterStatus}
            hint="Narrows the list above. The team you are viewing always stays in it."
          />
        </div>
      )}

      {/* What just changed, said once. role="status" rather than a bare
          aria-live, for the implicit aria-atomic and the better support on a
          node whose whole text is replaced. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-card border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
        active
          ? "border-brand-purple/70 bg-brand-purple/15 text-ink"
          : "border-line bg-surface/60 text-ink-muted hover:border-brand-cyan/50 hover:text-ink"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
