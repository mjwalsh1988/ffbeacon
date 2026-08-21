import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronRight, Minus } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import type {
  HeadToHeadCount,
  ScheduleMatchup,
  ScheduleStretch,
  ScheduleTeam,
} from "@/lib/league-schedule/types";
import {
  CHIP,
  EYEBROW,
  fmtPoints,
  listWords,
  ordinal,
  pctLabel,
  pctWords,
  recordLabel,
  stateEdgeClass,
  sidesFor,
  winProbFor,
  withUsername,
} from "./format";

/**
 * One team, all eighteen weeks.
 *
 * Server component. Everything it shows arrives as props except the difficulty
 * column, which is derived here and explained below.
 *
 * WHY THIS IS A TABLE AND STAYS ONE ON A PHONE
 *   Eighteen rows of five related figures is a table, and turning it into cards
 *   below sm would cost the reader the column headers that make each number
 *   mean something. So the table survives at every width and the compaction
 *   happens inside the cells: the opponent is two lines rather than one, and
 *   the win probability column folds into the result cell under sm instead of
 *   disappearing. Nothing is hidden anywhere.
 *
 * WHERE THE DIFFICULTY WORD COMES FROM
 *   Hard, even and easy compare each opponent projection against the MEDIAN
 *   opponent on this team's own schedule, not against the league. That is a
 *   deliberately narrow claim, and it is the one the props can actually
 *   support: the caller hands over one team's rows, so a league-wide baseline
 *   would have to be invented. The caption says which comparison is being made,
 *   because "hard" with no stated baseline is a number nobody can check.
 */

const HARD_EDGE = 1.05;
const EASY_EDGE = 0.95;

/** One week on one team's slate. Exported so the page can build the array. */
export type SeasonRow = {
  week: number;
  isFinal: boolean;
  isCurrent: boolean;
  isPlayoffWeek: boolean;
  matchup: ScheduleMatchup | null;
};

type Difficulty = "hard" | "even" | "easy" | "unknown";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function classifyDifficulty(points: number | null, baseline: number | null): Difficulty {
  if (points === null || baseline === null || baseline <= 0) return "unknown";
  const ratio = points / baseline;
  if (ratio >= HARD_EDGE) return "hard";
  if (ratio <= EASY_EDGE) return "easy";
  return "even";
}

const DIFFICULTY_WORD: Record<Difficulty, string> = {
  hard: "Hard",
  even: "Even",
  easy: "Easy",
  unknown: "Not available",
};

/** "Weeks 5 to 7". A stretch is a range, so it is written as one. */
function stretchLabel(stretch: ScheduleStretch): string {
  return stretch.startWeek === stretch.endWeek
    ? `Week ${stretch.startWeek}`
    : `Weeks ${stretch.startWeek} to ${stretch.endWeek}`;
}

export function TeamSeason({
  team,
  rows,
  sleeperLeagueId,
  searchedUsername,
  playoffWeekStart,
  summary,
}: {
  team: ScheduleTeam;
  rows: SeasonRow[];
  sleeperLeagueId: string;
  searchedUsername: string | null;
  playoffWeekStart: number;
  summary: {
    remainingSosRank: number | null;
    remainingSosPoints: number | null;
    projectedWins: number | null;
    hardest: ScheduleStretch | null;
    easiest: ScheduleStretch | null;
    h2h: HeadToHeadCount[];
  };
}) {
  const opponentPoints = rows
    .map((row) =>
      row.matchup ? sidesFor(row.matchup, team.sleeperRosterId).opponent : null,
    )
    .map((side) => side?.projectedOptimal ?? null)
    .filter((value): value is number => value !== null);
  const baseline = median(opponentPoints);

  // The divider goes before the first row that is in the playoffs, so a league
  // whose slate stops short of its own playoff start simply never draws it.
  const firstPlayoffWeek = rows.find((row) => row.week >= playoffWeekStart)?.week ?? null;

  const repeats = summary.h2h.filter((entry) => entry.meetings.length > 1);

  return (
    <Panel
      id="schedule-team-season"
      eyebrow="The season"
      title={`${team.teamName}, week by week`}
      helper={`${recordLabel(team.record)} so far, with ${rows.length} weeks on the slate.`}
    >
      <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Remaining schedule"
          value={
            summary.remainingSosRank === null
              ? "Not available"
              : ordinal(summary.remainingSosRank)
          }
          sub={
            summary.remainingSosPoints === null
              ? "No Power Pulse row for this league yet, so there is nothing to rank."
              : `Opponents project ${fmtPoints(summary.remainingSosPoints)} points a week. Rank 1 is the hardest schedule left.`
          }
        />
        <StatTile
          label="Projected wins"
          value={
            summary.projectedWins === null
              ? "Not available"
              : fmtPoints(summary.projectedWins)
          }
          sub={
            summary.projectedWins === null
              ? "Projected wins come from Power Pulse, which has not scored this league yet."
              : "Across the full season, wins already banked included."
          }
        />
        <StatTile
          label="Hardest stretch"
          value={
            summary.hardest === null ? "Not available" : stretchLabel(summary.hardest)
          }
          sub={
            summary.hardest === null
              ? "Not enough projected opponents to pick a run out."
              : `Opponents average ${fmtPoints(summary.hardest.opponentPoints)} points across the run.`
          }
        />
        <StatTile
          label="Easiest stretch"
          value={
            summary.easiest === null ? "Not available" : stretchLabel(summary.easiest)
          }
          sub={
            summary.easiest === null
              ? "Not enough projected opponents to pick a run out."
              : `Opponents average ${fmtPoints(summary.easiest.opponentPoints)} points across the run.`
          }
        />
      </dl>

      <p className="mt-3 text-xs leading-relaxed text-ink-muted">
        {repeats.length === 0
          ? "This team plays every opponent once."
          : `Plays twice or more: ${repeats
              .map(
                (entry) =>
                  `${entry.opponentName} in ${listWords(entry.meetings.map((w) => `week ${w}`))}`,
              )
              .join("; ")}.`}
      </p>

      {/* The table can never push the page sideways, whatever a team name does
          to the opponent column. */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            {team.teamName} week by week. Columns: week, opponent with record and Power
            Pulse rank, result or projection, win probability, and difficulty. Hard, even
            and easy compare each opponent projected total against the median opponent on
            this team schedule.
          </caption>
          <thead className="bg-surface text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <th scope="col" className="px-2 py-3">
                Week
              </th>
              <th scope="col" className="px-2 py-3">
                Opponent
              </th>
              <th scope="col" className="px-2 py-3">
                Result or projection
              </th>
              {/* Folded into the cell to its left below sm, never dropped. */}
              <th scope="col" className="hidden px-2 py-3 sm:table-cell">
                Win probability
              </th>
              <th scope="col" className="px-2 py-3">
                Difficulty
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <SeasonTableRow
                key={row.week}
                row={row}
                team={team}
                baseline={baseline}
                sleeperLeagueId={sleeperLeagueId}
                searchedUsername={searchedUsername}
                dividerBefore={firstPlayoffWeek !== null && row.week === firstPlayoffWeek}
                playoffWeekStart={playoffWeekStart}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-card border border-line bg-base/50 px-3 py-2.5">
      <dt className={EYEBROW}>{label}</dt>
      <dd className="mt-1">
        <span className="block font-mono text-xl font-extrabold tabular-nums text-ink">
          {value}
        </span>
        <span className="mt-1 block text-[11px] leading-relaxed text-ink-muted">
          {sub}
        </span>
      </dd>
    </div>
  );
}

function SeasonTableRow({
  row,
  team,
  baseline,
  sleeperLeagueId,
  searchedUsername,
  dividerBefore,
  playoffWeekStart,
}: {
  row: SeasonRow;
  team: ScheduleTeam;
  baseline: number | null;
  sleeperLeagueId: string;
  searchedUsername: string | null;
  dividerBefore: boolean;
  playoffWeekStart: number;
}) {
  const pair = row.matchup ? sidesFor(row.matchup, team.sleeperRosterId) : null;
  const self = pair?.self ?? null;
  const opponent = pair?.opponent ?? null;
  const winProb = row.matchup ? winProbFor(row.matchup, team.sleeperRosterId) : null;
  const difficulty = classifyDifficulty(opponent?.projectedOptimal ?? null, baseline);

  // The bye is checked FIRST, and it has to be.
  //
  // `won` is false for three different things: a loss, a tie, and a roster with
  // no opponent that week. An odd-team league gives one manager a bye, and the
  // ladder below has no branch for it, so a week nobody played came out as
  // "Tied". Absence of an opponent is unambiguous in the data
  // (`ScheduleMatchup.away` is nullable and `sidesFor` returns null for the
  // opponent), so the answer is to ask that question before the other two.
  const outcome = !row.isFinal
    ? null
    : opponent === null
      ? "Bye"
      : self?.won
        ? "Won"
        : opponent.won
          ? "Lost"
          : "Tied";

  const selfFigure = row.isFinal
    ? (self?.actual ?? null)
    : (self?.projectedOptimal ?? null);
  const oppFigure = row.isFinal
    ? (opponent?.actual ?? null)
    : (opponent?.projectedOptimal ?? null);

  const href = withUsername(
    `/leagues/${sleeperLeagueId}/schedules/${row.week}/${team.sleeperRosterId}`,
    searchedUsername,
  );

  return (
    <>
      {dividerBefore && (
        <tr className="bg-surface">
          {/* A real structural header for the block below it, not a styled
              spacer row. colSpan covers the win probability column too, which
              is display:none below sm rather than absent from the table. */}
          <th
            scope="colgroup"
            colSpan={5}
            className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-brand-purple"
          >
            Playoffs begin week {playoffWeekStart}
          </th>
        </tr>
      )}
      {/* The state edge, on the week cell rather than the row, because a border
          on a <tr> is not painted under border-collapse in every engine. Same
          three colours as the week cards, so the two views read the same way:
          purple still to play, cyan the live week, grey settled. The word is
          right underneath it, so the colour is reinforcement. */}
      <tr className="group/row align-top transition-colors hover:bg-surface">
        <th
          scope="row"
          className={`py-2.5 pl-2 pr-2 text-left font-medium text-ink ${stateEdgeClass({
            isFinal: row.isFinal,
            isCurrent: row.isCurrent,
          })}`}
        >
          <span className="block whitespace-nowrap">Week {row.week}</span>
          <span className="mt-0.5 block text-[11px] font-normal text-ink-subtle">
            {row.isCurrent
              ? "This week"
              : row.isFinal
                ? "Final"
                : row.isPlayoffWeek
                  ? "Playoffs"
                  : "Upcoming"}
          </span>
        </th>

        {/* Positioned so the opponent link can stretch over the whole cell.
            The link text is one line of about 20px, which is under the 44px
            floor on a phone; the overlay makes the target the full two-line
            cell without padding the row out or lengthening the link name. */}
        <td className="relative px-2 py-2.5">
          {opponent === null ? (
            <>
              <span className="block text-ink">No opponent</span>
              <span className="mt-0.5 block text-[11px] text-ink-subtle">
                This roster sits out the week
              </span>
            </>
          ) : (
            <>
              <Link
                href={href}
                className="block font-medium text-ink after:absolute after:inset-0 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <span className="sr-only">
                  Week {row.week}, open the matchup against{" "}
                </span>
                {opponent.teamName}
              </Link>
              <span className="mt-0.5 block text-[11px] text-ink-subtle">
                {recordLabel(opponent.record)}
                {opponent.pulseRank !== null && `, Pulse #${opponent.pulseRank}`}
              </span>
              {/* Says the row opens something. The stretched link above already
                  makes the whole cell clickable, and nothing on the surface
                  admitted it, so a reader had no reason to try. aria-hidden
                  because the link's own name already says "open the matchup". */}
              <span
                aria-hidden="true"
                className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-brand-cyan opacity-80 transition-opacity group-hover/row:opacity-100"
              >
                Lineups
                <ChevronRight className="h-3 w-3" />
              </span>
            </>
          )}
        </td>

        <td className="px-2 py-2.5">
          {selfFigure === null && oppFigure === null ? (
            <span className="text-ink-subtle">Not available</span>
          ) : (
            /* One side missing and the other present. The missing half says so
               in words, the same words the cell above uses when both are gone:
               "N/A" is pronounced three different ways by three screen readers
               and none of them is a sentence. */
            <span className="block font-mono text-sm font-bold tabular-nums text-ink">
              <SideFigure value={selfFigure} />
              <span className="mx-1 text-ink-subtle">to</span>
              <SideFigure value={oppFigure} />
            </span>
          )}
          <span className="mt-0.5 block text-[11px] text-ink-subtle">
            {outcome ?? "Projected"}
          </span>
          {/* The win probability column, folded in below sm. Same value, same
              words, so the phone layout is compact rather than reduced. */}
          <span className="mt-0.5 block text-[11px] text-ink-muted sm:hidden">
            {row.isFinal
              ? "Win probability: game is final"
              : winProb === null
                ? "Win probability: not available"
                : `Win probability ${pctWords(winProb)}`}
          </span>
        </td>

        <td className="hidden px-2 py-2.5 sm:table-cell">
          {row.isFinal ? (
            <span className="text-[11px] text-ink-subtle">Game is final</span>
          ) : winProb === null ? (
            <span className="text-[11px] text-ink-subtle">Not available</span>
          ) : (
            <>
              {/* The number carries the answer and the meter reinforces it.
                  A 6px two-tone bar on its own could not be read: at that height
                  an 80/20 split and a 60/40 split look about the same, so the
                  reader was doing arithmetic off the caption. The percentage is
                  now the large thing, tinted by which side of even it falls on,
                  with a track underneath that fills from the left against a
                  dashed centre mark. */}
              <span
                aria-hidden="true"
                className={`block font-mono text-base font-bold tabular-nums ${
                  winProb >= 0.5 ? "text-signal-success" : "text-brand-purple"
                }`}
              >
                {pctLabel(winProb)}
              </span>
              <span className="sr-only">{pctWords(winProb)} to win</span>
              <span
                aria-hidden="true"
                className="relative mt-1 block h-2 w-full overflow-hidden rounded-full border border-line bg-base"
              >
                <span
                  className={`block h-full ${
                    winProb >= 0.5 ? "bg-signal-success" : "bg-brand-purple"
                  }`}
                  style={{ width: `${Math.max(3, Math.round(winProb * 100))}%` }}
                />
                <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 border-l border-dashed border-ink/50" />
              </span>
            </>
          )}
        </td>

        <td className="px-2 py-2.5">
          <DifficultyChip
            difficulty={difficulty}
            points={opponent?.projectedOptimal ?? null}
          />
        </td>
      </tr>
    </>
  );
}

/**
 * One half of the "112.4 to 108.9" pair.
 *
 * Drops out of the mono treatment when there is nothing to show, because at
 * that point it is a sentence rather than a measurement.
 */
function SideFigure({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="font-sans text-[11px] font-normal text-ink-subtle">
        Not available
      </span>
    );
  }
  return <>{fmtPoints(value)}</>;
}

/**
 * Hard, even or easy.
 *
 * The word is the label and the arrow only repeats it, so the column survives
 * greyscale, colour blindness, and a screen reader that never sees either.
 */
function DifficultyChip({
  difficulty,
  points,
}: {
  difficulty: Difficulty;
  points: number | null;
}) {
  const Icon =
    difficulty === "hard" ? ArrowUp : difficulty === "easy" ? ArrowDown : Minus;
  const tone =
    difficulty === "hard"
      ? "border-signal-warning/50 text-signal-warning"
      : difficulty === "easy"
        ? "border-signal-success/50 text-signal-success"
        : "border-line text-ink-muted";

  if (difficulty === "unknown") {
    return <span className="text-[11px] text-ink-subtle">Not available</span>;
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span className={`${CHIP} ${tone}`}>
        <Icon aria-hidden="true" className="h-3.5 w-3.5" />
        {DIFFICULTY_WORD[difficulty]}
      </span>
      {points !== null && (
        <span className="text-[11px] text-ink-subtle">{fmtPoints(points)} projected</span>
      )}
    </span>
  );
}
