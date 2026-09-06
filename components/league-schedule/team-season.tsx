import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronRight,
  Flame,
  Gauge,
  Leaf,
  Minus,
  Percent,
  Swords,
  Trophy,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
 *   happens by rearranging rather than by shrinking: below sm the week shows
 *   three columns (week, opponent, difficulty) and the win chance moves to a
 *   full-width row directly underneath, where the meter has room to be read.
 *
 * WHAT THE PHONE LAYOUT DOES NOT SHOW
 *   The Result or projection column. Five columns of figures at 360px was the
 *   thing that made this table unreadable on a phone, and the two scores are the
 *   part a reader can get in one tap: every row links to the matchup page, which
 *   carries both totals and both starting lineups. This is a deliberate
 *   exception to the rule that a hidden column has to resurface somewhere in the
 *   same layout, taken because the alternative was a fifth line of text in a
 *   cell that already had four.
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

/**
 * The vertical rule between two columns.
 *
 * Eighteen rows of five figures with nothing between the columns reads as a
 * drift of loose numbers rather than a table: the eye has no edge to follow
 * down, so a figure in column three and the week it belongs to stop looking
 * connected. A hairline on the right of every cell except the last gives each
 * column a side. It is drawn on the cells rather than on a `col` element
 * because `border` on `<col>` is ignored under border-collapse in most engines.
 */
const COL_RULE = "border-r border-line/60";

/**
 * Every body cell: padding, and the hover wash.
 *
 * The hover used to sit on the `tr`. In the separate border model a row's
 * background paints behind its cells and ignores any radius, so with the week
 * cell rounded it would have shown a square corner behind a curved border on
 * every hover. Painting the wash on the cells instead lets each one clip its
 * own background, which is what makes the rounded corner hold.
 *
 * The wash itself is a white overlay at 4.5% rather than a named surface
 * colour. It lifts whatever is underneath by the same small amount wherever the
 * table is used, so it cannot land as "no visible change" on one background and
 * a hard block on another, which is what picking a fixed colour risks.
 *
 * The gap BETWEEN rows is border-spacing on the table, not padding here.
 *
 * `md:pl-6` is the desktop-only indent: real air on the left of each column so a
 * figure sits inside its column rather than against the rule separating it from
 * the one before. It stays off below md, where the table is already fighting for
 * horizontal room and every pixel of padding comes out of the text.
 *
 * The bottom padding is written mobile-first (`pb-2.5 sm:pb-4`) rather than as a
 * `max-sm:` override. Below sm this row is followed by its own win chance row
 * and a hairline between the two, so it closes tighter than it does on desktop
 * where the same padding is the last thing before the gap to the next week.
 * Writing it as an override would leave two `pb-*` utilities racing on source
 * order.
 */
const CELL_PAD =
  "px-2.5 pt-4 pb-2.5 transition-colors group-hover/row:bg-ink/[0.045] sm:pb-4 md:pl-6";

/**
 * The rule under one row.
 *
 * The table runs in the SEPARATE border model (`border-separate` plus
 * `border-spacing-y-1.5` on the element) so that the space between two weeks is
 * real spacing rather than more padding inside the cells. That is the only way
 * to put a gap between table rows: `margin` does nothing on a `tr`, and under
 * the collapsed model a thick transparent border on the cells would collapse
 * against the divider and swallow it.
 *
 * The trade is that borders set on a `tr` are not painted in the separate
 * model, so the divider cannot live on the row and sits on each cell instead.
 */
const ROW_RULE = "border-b border-line-accent";

/**
 * The same rule, on the cells of a week's MAIN row.
 *
 * From sm up it is the closing edge of the week. Below sm it is not: the win
 * chance row renders underneath and carries the rule instead, so the two rows
 * read as one week rather than as two.
 */
const BODY_ROW_RULE = "sm:border-b sm:border-line-accent";

/**
 * The header band stays tight. It is one line of labels, not a row of data.
 *
 * The `md:pl-6` matches CELL_PAD exactly. The indent has to be on both or a
 * heading stops sitting over its own column.
 */
const HEAD_PAD = "px-2.5 py-3 md:pl-6";

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
  linkUsername,
  playoffWeekStart,
  summary,
}: {
  team: ScheduleTeam;
  rows: SeasonRow[];
  sleeperLeagueId: string;
  linkUsername: string | null;
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
          Icon={Gauge}
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
          Icon={Trophy}
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
          Icon={Flame}
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
          Icon={Leaf}
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
        {/* The row gap is OFF below sm, and that is what lets the coloured state
            edge run unbroken down a week: on a phone a week is two rows, and
            six pixels of border-spacing between them would put a visible break
            in the middle of that edge. With the gap at zero the two cells touch
            and the edge reads as one bar. Weeks are still separated on a phone,
            by the rule under the win chance row plus the padding either side of
            it. From sm up a week is one row again and the gap comes back. */}
        <table className="w-full border-separate border-spacing-x-0 border-spacing-y-0 text-sm sm:border-spacing-y-1.5">
          <caption className="sr-only">
            {team.teamName} week by week. Columns: week, opponent with record and Power
            Pulse rank, result or projection, win chance, and difficulty. On a narrow
            screen the win chance moves to its own row under each week and the result
            column is left to the matchup page each row links to. Hard, even and easy
            compare each opponent projected total against the median opponent on this
            team schedule.
          </caption>
          {/* The header is a band with a rule under it, and each label carries
              an icon. The icons are decorative and every one of them sits beside
              the word it illustrates, so nothing here depends on recognising a
              glyph. */}
          <thead className="bg-surface-elevated/70 text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <HeadCell Icon={CalendarDays} label="Week" />
              <HeadCell Icon={Users} label="Opponent" />
              {/* Both fold into the opponent cell below sm, never dropped. */}
              <HeadCell Icon={Swords} label="Result or projection" smUp />
              <HeadCell Icon={Percent} label="Win chance" smUp />
              <HeadCell Icon={Gauge} label="Difficulty" last />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <SeasonTableRow
                key={row.week}
                row={row}
                team={team}
                baseline={baseline}
                sleeperLeagueId={sleeperLeagueId}
                linkUsername={linkUsername}
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

/** One column heading: an icon, the word, and the rule down its right side. */
function HeadCell({
  Icon,
  label,
  smUp = false,
  last = false,
}: {
  Icon: LucideIcon;
  label: string;
  /** True on the column that is display:none below sm. */
  smUp?: boolean;
  /** The last column carries no rule, or the table grows an outer edge. */
  last?: boolean;
}) {
  return (
    <th
      scope="col"
      className={`${HEAD_PAD} ${ROW_RULE} ${last ? "" : COL_RULE} ${
        smUp ? "hidden sm:table-cell" : ""
      }`}
    >
      <span className="flex items-center gap-1.5">
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-brand-cyan" />
        {label}
      </span>
    </th>
  );
}

function StatTile({
  label,
  value,
  sub,
  Icon,
}: {
  label: string;
  value: string;
  sub: string;
  Icon: LucideIcon;
}) {
  return (
    <div className="rounded-card border border-line bg-base/50 px-3 py-2.5">
      <dt className={`${EYEBROW} flex items-center gap-1.5`}>
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        {label}
      </dt>
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
  linkUsername,
  dividerBefore,
  playoffWeekStart,
}: {
  row: SeasonRow;
  team: ScheduleTeam;
  baseline: number | null;
  sleeperLeagueId: string;
  linkUsername: string | null;
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
    linkUsername,
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
            className="px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-brand-purple"
          >
            <span className="flex items-center gap-1.5">
              <Trophy aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              Playoffs begin week {playoffWeekStart}
            </span>
          </th>
        </tr>
      )}
      {/* The state edge, on the week cell rather than the row, because a border
          on a <tr> is not painted under border-collapse in every engine. Same
          three colours as the week cards, so the two views read the same way:
          purple still to play, cyan the live week, grey settled. The word is
          right underneath it, so the colour is reinforcement. */}
      <tr className="group/row align-top">
        <th
          scope="row"
          // The coloured state edge turns the corner into the row instead of
          // ending in two square points. Small on purpose: any more and the cell
          // reads as a separate card rather than the start of a row.
          //
          // Only the TOP corner below sm. Down there the win chance row sits
          // directly underneath and carries the bottom corner, so the two make
          // one rounded left edge for the week. From sm up the week is a single
          // row and takes both corners itself.
          className={`relative ${CELL_PAD} ${BODY_ROW_RULE} ${COL_RULE} rounded-tl-md text-left font-medium text-ink sm:rounded-bl-md ${stateEdgeClass(
            {
              isFinal: row.isFinal,
              isCurrent: row.isCurrent,
            },
          )}`}
        >
          {opponent !== null && <CellOverlayLink href={href} />}
          {/* THE AFFORDANCE LIVES HERE, not in the opponent cell.
              It used to be a third line reading "Lineups" under the opponent's
              record, which pushed that one cell to three lines while every other
              cell in the row was two, so nothing lined up. The chevron beside
              the week says the same thing in the space already taken. It is
              aria-hidden and it is not the link: the named anchor in the
              opponent cell is, and its own name already says "open the
              matchup". A bye has no matchup to open, so it gets no chevron. */}
          <span className="flex items-center gap-1 whitespace-nowrap">
            Week {row.week}
            {opponent !== null && (
              <ChevronRight
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 text-brand-cyan opacity-70 transition-all motion-safe:group-hover/row:translate-x-0.5 group-hover/row:opacity-100"
              />
            )}
          </span>
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
        <td className={`relative ${CELL_PAD} ${BODY_ROW_RULE} ${COL_RULE}`}>
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
            </>
          )}
        </td>

        <td
          className={`relative hidden ${CELL_PAD} ${BODY_ROW_RULE} ${COL_RULE} sm:table-cell`}
        >
          {opponent !== null && <CellOverlayLink href={href} />}
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
          <OutcomeLabel outcome={outcome} />
        </td>

        <td
          className={`relative hidden ${CELL_PAD} ${BODY_ROW_RULE} ${COL_RULE} sm:table-cell`}
        >
          {opponent !== null && <CellOverlayLink href={href} />}
          <WinChance isFinal={row.isFinal} winProb={winProb} />
        </td>

        {/* align-middle rather than the row's align-top: this cell holds one
            pill and nothing else, and pinned to the top of a three-line row it
            floated above its own numbers. */}
        <td className={`relative ${CELL_PAD} ${BODY_ROW_RULE} align-middle`}>
          {opponent !== null && <CellOverlayLink href={href} />}
          <DifficultyChip
            difficulty={difficulty}
            points={opponent?.projectedOptimal ?? null}
          />
        </td>
      </tr>

      {/* WIN CHANCE, ON ITS OWN LINE BELOW sm.
          Its column is display:none on a phone, and a fourth column would not
          fit at 360px anyway, so it gets a full-width row of its own directly
          under the week it belongs to.

          THREE THINGS TIE IT TO THAT WEEK, and it needs all three, because a
          full-width row under a table row is otherwise just the next thing down.
          It carries the SAME coloured state edge as the week cell above, and
          with the row gap off below sm the two touch, so the edge runs unbroken
          down the pair. It takes the bottom-left corner the week cell gives up.
          And it owns the rule that closes the week, which the main row's cells
          drop below sm, so the divider lands after the meter rather than
          between the two halves of one week.

          The hairline across the top is the lighter COL_RULE grey, not the
          week-closing accent, so it reads as a fold inside the week rather than
          as a second week starting. Two weights, two meanings.

          colSpan is 5, the full width of the table. The two hidden columns are
          display:none rather than absent from the markup, so they still count. */}
      <tr className="sm:hidden">
        <td
          colSpan={5}
          className={`relative rounded-bl-md border-t border-line/60 ${ROW_RULE} px-2.5 pb-4 pt-2.5 ${stateEdgeClass(
            {
              isFinal: row.isFinal,
              isCurrent: row.isCurrent,
            },
          )}`}
        >
          {opponent !== null && <CellOverlayLink href={href} />}
          <WinChance isFinal={row.isFinal} winProb={winProb} inline />
        </td>
      </tr>

      {/* THE GAP BETWEEN TWO WEEKS, below sm. An empty row, and it has to be.
          On desktop this gap is `border-spacing-y-1.5` on the table, but that
          property applies to EVERY gap equally, and below sm a week is two rows,
          so any value big enough to separate two weeks also put the same break
          between a week and its own win chance meter and cut the coloured state
          edge in half. Hence border-spacing-y-0 below sm, and the gap drawn
          where it is actually wanted: after the meter, never inside a week.

          Padding cannot do this job either. It lands INSIDE the cell, above the
          rule that closes the week, so more of it just makes the meter row taller
          rather than moving the next week further away.

          aria-hidden because it is spacing and carries nothing. */}
      <tr aria-hidden="true" className="sm:hidden">
        <td colSpan={5} className="h-4" />
      </tr>
    </>
  );
}

/**
 * Makes one more cell of a week open that week's matchup.
 *
 * WHY THIS IS NOT ONE STRETCHED LINK OVER THE ROW
 *   The named link in the opponent cell covers its own cell with
 *   `after:absolute after:inset-0`, and that is as far as it can reach: the
 *   nearest positioned ancestor is the `td`. Stretching it across the row means
 *   making the `tr` the containing block, and if any engine declines to honour
 *   `position: relative` on a table row the overlay does not shrink, it escapes
 *   to the next positioned ancestor, which here is the whole Panel. Every row
 *   would then cover the entire panel and the last one in the markup would win
 *   every click. A failure mode that bad is not worth the tidier markup.
 *
 *   So each remaining cell gets its own overlay instead. Cells are reliable
 *   containing blocks in every engine, and the result is the behaviour a reader
 *   expects: anywhere in the week opens the week.
 *
 * WHY THE EXTRA ANCHORS ARE HIDDEN
 *   They are duplicates of a link that already exists, so announcing four more
 *   copies of the same destination would make the row read as five links to one
 *   place, and tabbing through eighteen weeks would take ninety stops instead of
 *   eighteen. `aria-hidden` takes them out of the accessibility tree and
 *   `tabIndex={-1}` takes them out of the tab order, which leaves exactly one
 *   real link per week: the named one in the opponent cell, which is the one
 *   that carries the accessible name and the focus ring. These are for the
 *   mouse and the thumb.
 */
function CellOverlayLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      aria-hidden="true"
      tabIndex={-1}
      className="absolute inset-0"
    />
  );
}

/**
 * The win chance figure and its meter, in both layouts.
 *
 * One component so the desktop column and the phone row cannot drift into
 * quoting the same probability two different ways.
 *
 * The number carries the answer and the meter reinforces it. A 6px two-tone bar
 * on its own could not be read: at that height an 80/20 split and a 60/40 split
 * look about the same, so the reader was doing arithmetic off the caption. The
 * percentage is the large thing, tinted by which side of even it falls on, with
 * a track underneath that fills from the left against a dashed centre mark.
 *
 * `inline` is the phone row: the label sits beside the number instead of above
 * the column, because a full-width row has no heading of its own to inherit.
 */
function WinChance({
  isFinal,
  winProb,
  inline = false,
}: {
  isFinal: boolean;
  winProb: number | null;
  inline?: boolean;
}) {
  if (isFinal) {
    return <span className="text-[11px] text-ink-subtle">Game is final</span>;
  }
  if (winProb === null) {
    return (
      <span className="text-[11px] text-ink-subtle">
        {inline ? "Win chance not available" : "Not available"}
      </span>
    );
  }

  const tone = winProb >= 0.5 ? "text-signal-success" : "text-brand-purple";
  const fill = winProb >= 0.5 ? "bg-signal-success" : "bg-brand-purple";

  return (
    <>
      <span
        aria-hidden="true"
        className={inline ? "flex items-baseline gap-1.5" : "block"}
      >
        <span className={`font-mono text-base font-bold tabular-nums ${tone}`}>
          {pctLabel(winProb)}
        </span>
        {inline && (
          <span className="text-[11px] font-medium text-ink-muted">to win</span>
        )}
      </span>
      <span className="sr-only">{pctWords(winProb)} to win</span>
      <span
        aria-hidden="true"
        className="relative mt-1 block h-2 w-full overflow-hidden rounded-full border border-line bg-base"
      >
        <span
          className={`block h-full ${fill}`}
          style={{ width: `${Math.max(3, Math.round(winProb * 100))}%` }}
        />
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 border-l border-dashed border-ink/50" />
      </span>
    </>
  );
}

/**
 * Won, Lost, Tied, Bye, or Projected.
 *
 * The word is the label and it is always there. The icon and the tint only
 * repeat it, so the column survives greyscale and a screen reader that sees
 * neither. A win is the one outcome that gets a colour, because it is the one a
 * reader is scanning the column for.
 */
function OutcomeLabel({ outcome }: { outcome: string | null }) {
  const word = outcome ?? "Projected";
  const Icon: LucideIcon | null =
    word === "Won"
      ? Trophy
      : word === "Lost"
        ? ArrowDown
        : word === "Tied"
          ? Minus
          : word === "Bye"
            ? CalendarDays
            : null;
  const tone = word === "Won" ? "text-signal-success" : "text-ink-subtle";

  return (
    <span
      className={`mt-1 flex items-center gap-1 text-[11px] font-semibold ${tone}`}
    >
      {Icon && <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />}
      {word}
    </span>
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
 *
 * WHY THE PROJECTED FIGURE IS NOT DRAWN
 *   The chip used to carry "121.4 projected" on a second line under it, which
 *   pushed the pill off centre in its own cell and repeated a number that is
 *   already the right-hand half of the Result or projection column on every
 *   unplayed week. It is still announced, as part of the chip's own text, so a
 *   screen reader user keeps the baseline the word is measured against on a
 *   settled week, where the visible columns show actual scores instead.
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
      ? "border-signal-warning/50 bg-signal-warning/10 text-signal-warning"
      : difficulty === "easy"
        ? "border-signal-success/50 bg-signal-success/10 text-signal-success"
        : "border-line bg-surface text-ink-muted";

  if (difficulty === "unknown") {
    return <span className="text-[11px] text-ink-subtle">Not available</span>;
  }

  return (
    <span className={`${CHIP} ${tone}`}>
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {DIFFICULTY_WORD[difficulty]}
      {points !== null && (
        <span className="sr-only">
          , this opponent projects {fmtPoints(points)} points
        </span>
      )}
    </span>
  );
}
