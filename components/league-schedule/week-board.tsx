import { Panel } from "@/components/dashboard-panel";
import type { ScheduleWeekView } from "@/lib/league-schedule/types";
import { MatchupRow } from "./matchup-row";

/**
 * One week of the schedule, as cards.
 *
 * Server component. It renders what it is handed and derives nothing beyond the
 * one sentence in the panel helper.
 *
 * THE HELPER IS THE WEEK IN ONE LINE
 *   A reader arriving on a board of six cards should not have to count them to
 *   learn whether the week has been played. The helper says so before the first
 *   card: all final, none played, or the split between the two. Everything else
 *   about the week is on the cards themselves.
 *
 * AN EMPTY WEEK IS A SENTENCE, NOT AN EMPTY LIST
 *   A list with nothing in it reads as a page that failed to load. When there
 *   are no matchups the panel says what that means instead, which is the same
 *   rule the lineup check and the empty states follow.
 *
 * WHY NO CARD HERE GETS THE ELEVATED TREATMENT
 *   MatchupRow can raise the live week's card, and that is the right emphasis
 *   on any surface mixing weeks. This board is one week, so on the live week
 *   every card would qualify, and six raised cards is the same as none: there
 *   is nothing left for them to stand out against. The board carries the glow
 *   instead, which keeps exactly one primary surface on the screen and still
 *   says which week is live. The word is in the panel helper either way, so the
 *   emphasis is never the only thing carrying it.
 */

/** "All 6 games are final". The state of the week, condensed to one line. */
function describeWeek(week: ScheduleWeekView): string {
  const total = week.matchups.length;
  // Says what a card does before the reader has to guess. Every card carries
  // its own "View both starting lineups" line, and the helper is where somebody
  // scanning the panel heading finds out first.
  const open = " Tap any matchup for both lineups.";
  const playoffs = week.isPlayoffWeek ? " Playoff week." : "";
  // The glow on the panel is the only other thing saying which week is live,
  // and a glow is a colour. The sentence carries it too, always.
  const live = week.isCurrent ? " Live week." : "";
  const tail = `${open}${playoffs}${live}`;

  if (total === 0) return `No games scheduled.${playoffs}${live}`;

  const finals = week.matchups.filter((m) => m.isFinal).length;
  const games = `${total} ${total === 1 ? "game" : "games"}`;

  if (finals === total) return `All ${games} final.${tail}`;
  if (finals === 0) return `${games}, none played yet.${tail}`;
  return `${finals} of ${games} final.${tail}`;
}

export function WeekBoard({
  week,
  sleeperLeagueId,
  searchedUsername,
}: {
  week: ScheduleWeekView;
  sleeperLeagueId: string;
  searchedUsername: string | null;
}) {
  return (
    <Panel
      id={`schedule-week-${week.week}`}
      eyebrow="The week"
      title={`Week ${week.week}`}
      helper={describeWeek(week)}
      glow={week.isCurrent}
    >
      {week.matchups.length === 0 ? (
        <p className="text-sm leading-relaxed text-ink-muted">
          Sleeper has published no games for week {week.week} in this league. Every other
          week on this schedule is unaffected, so this is a gap in the slate rather than a
          problem with the board.
        </p>
      ) : (
        <ul role="list" className="grid gap-4">
          {week.matchups.map((matchup) => (
            <li
              key={`${matchup.matchupId ?? "unpaired"}-${matchup.home.sleeperRosterId}`}
            >
              <MatchupRow
                matchup={matchup}
                sleeperLeagueId={sleeperLeagueId}
                searchedUsername={searchedUsername}
                // Flat, always. See the note at the top of this file: the board
                // owns the emphasis on a single-week surface.
                // The real week state, so the card gets its cyan state edge.
                isCurrent={week.isCurrent}
                // ...but not the raised treatment: every card in this list is
                // from the same week, so raising all six would raise none.
                emphasise={false}
                headingLevel={3}
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
