import Link from "next/link";
import { ChevronRight, Trophy, Users } from "lucide-react";
import { ownerLine } from "@/lib/team-label";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import type { ScheduleMatchup, ScheduleMatchupSide } from "@/lib/league-schedule/types";
import { WinProbBar } from "./win-prob-bar";
import {
  BENCH_CHIP_THRESHOLD,
  CHIP,
  ELEVATED_BORDER,
  ELEVATED_WASH,
  FLAT_BORDER,
  HAIRLINE_STYLE,
  fmtPoints,
  recordLabel,
  stateEdgeClass,
  withUsername,
} from "./format";

/**
 * One matchup, as the week board shows it.
 *
 * Server component. It takes a built ScheduleMatchup and renders it; it fetches
 * nothing and decides nothing about which week is on screen.
 *
 * WHY THE LINK IS THE HEADING AND NOT THE WHOLE CARD
 *   The card is clickable edge to edge, which is the right target on a phone.
 *   Building that by wrapping the entire card in an anchor would give the link
 *   an accessible name forty words long: two team names, two handles, two
 *   records, two ranks, two scores and a probability, read out every time the
 *   reader lands on it and again in any list of links. So the anchor is the
 *   heading, and it grows an `after` overlay that covers the card. The click
 *   target is the whole surface, the link is called "Team A vs Team B", and
 *   every figure underneath stays ordinary readable text.
 *
 * WHY A RESULT AND A PROJECTION NEVER LOOK ALIKE
 *   A final week shows what was scored and says "Won" next to the side that won
 *   it, with a filled marker beside the word rather than instead of it. An
 *   unplayed week shows the projected total from Power Pulse, carries a
 *   "Projected" chip so it cannot be misread as a result, and writes BOTH win
 *   probabilities into the sentence under the bar. The bar itself is
 *   aria-hidden, because a bar is a picture of a number that is already there.
 */

export function MatchupRow({
  matchup,
  sleeperLeagueId,
  searchedUsername,
  isCurrent,
  emphasise,
  headingLevel = 3,
}: {
  matchup: ScheduleMatchup;
  sleeperLeagueId: string;
  searchedUsername: string | null;
  /** The live NFL week gets the one elevated surface on the board. */
  /** The live week. Drives the cyan state edge, always. */
  isCurrent: boolean;
  /**
   * Whether to also give this card the raised treatment.
   *
   * Separate from `isCurrent` because a week board renders six cards from the
   * SAME week: if the live week raised all of them, none of them would stand
   * out, so the board leaves this off and lets the panel glow say it once. The
   * state edge is not the same decision, and it stays on every card, which is
   * the whole reason these are two props rather than one.
   *
   * Defaults to `isCurrent`, so a caller mixing weeks in one list gets the
   * behaviour it expects with no extra prop.
   */
  emphasise?: boolean;
  headingLevel?: 3 | 4;
}) {
  const Heading = (`h${headingLevel}` as const) as "h3" | "h4";
  const { home, away, isFinal, week } = matchup;

  const href = withUsername(
    `/leagues/${sleeperLeagueId}/schedules/${week}/${home.sleeperRosterId}`,
    searchedUsername,
  );

  const raised = emphasise ?? isCurrent;

  const homeProb = matchup.homeWinProb;

  return (
    <article
      className={`group relative overflow-hidden rounded-modal border bg-surface/50 p-3 transition-colors sm:p-4 ${
        raised ? ELEVATED_BORDER : FLAT_BORDER
      } ${stateEdgeClass({ isFinal, isCurrent })} ${
        away !== null ? "hover:border-brand-cyan/60 hover:bg-surface/80" : ""
      }`}
      style={raised ? ELEVATED_WASH : undefined}
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px" style={HAIRLINE_STYLE} />

      <div className="flex flex-wrap items-center gap-2">
        {raised && (
          <span className="rounded-full border border-brand-cyan/50 bg-brand-cyan/10 px-2.5 py-1 text-xs font-bold text-brand-cyan">
            This week
          </span>
        )}
        <span className={CHIP}>{isFinal ? "Final" : "Projected"}</span>
      </div>

      <Heading className="mt-2 text-base font-bold tracking-tight text-ink">
        {away === null ? (
          <span>
            {home.teamName}
            <span className="sr-only">, week {week}, no opponent</span>
          </span>
        ) : (
          <Link
            href={href}
            className="rounded-sm after:absolute after:inset-0 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <span className="sr-only">Week {week}: </span>
            {home.teamName} <span className="text-ink-muted">vs</span> {away.teamName}
          </Link>
        )}
      </Heading>

      <ul role="list" className="mt-3 space-y-2">
        <li>
          <SideRow side={home} isFinal={isFinal} />
        </li>
        {away !== null && (
          <li>
            <SideRow side={away} isFinal={isFinal} />
          </li>
        )}
      </ul>

      {away === null ? (
        <p className="mt-3 text-sm text-ink-muted">
          No opponent this week. This league has an odd number of teams, so one roster sits
          out each week.
        </p>
      ) : (
        !isFinal &&
        homeProb !== null && (
          <div className="mt-3 rounded-card border border-line bg-base/40 px-3 py-2.5">
            <WinProbBar
              homeName={home.teamName}
              awayName={away.teamName}
              homeProb={homeProb}
              size="compact"
            />
          </div>
        )
      )}

      {/* THE POINT OF THE CARD IS THAT IT OPENS SOMETHING, and the first version
          did not say so. The whole card was a link through a stretched anchor on
          the heading, which works and is invisible: nothing on the surface told a
          reader that their starting lineup was one press away. This row is that
          sentence, with the chevron sliding on hover so the affordance is
          obvious before the cursor arrives. It is aria-hidden because the real
          link is the heading above and announcing a second one would put two
          identical destinations in the reader's list. */}
      {away !== null && (
        <p
          aria-hidden="true"
          className="mt-3 flex items-center gap-1.5 border-t border-line/70 pt-2.5 text-xs font-semibold text-brand-cyan"
        >
          <Users className="h-3.5 w-3.5" />
          {isFinal ? "View both lineups and what sat on the bench" : "View both starting lineups"}
          <ChevronRight className="h-3.5 w-3.5 transition-transform motion-safe:group-hover:translate-x-0.5" />
        </p>
      )}
    </article>
  );
}

/**
 * One side of the card.
 *
 * Everything the desktop layout shows is on the phone too: avatar, team, owner,
 * record, Power Pulse rank, the bench warning, and the number. The row is a
 * flex line with the figure pinned right, so the compaction happens in the
 * middle column by wrapping rather than by dropping anything.
 */
function SideRow({
  side,
  isFinal,
}: {
  side: ScheduleMatchupSide;
  isFinal: boolean;
}) {
  const leavingPoints =
    side.pointsLeftOnBench !== null && side.pointsLeftOnBench >= BENCH_CHIP_THRESHOLD
      ? side.pointsLeftOnBench
      : null;

  return (
    <div className="flex items-start gap-2.5 rounded-card border border-line bg-base/40 px-2.5 py-2 sm:px-3">
      <SleeperAvatar avatarId={side.ownerAvatarId} title={side.teamName} size={32} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{side.teamName}</p>
        {ownerLine(side.teamName, side.ownerHandle) && (
          <p className="truncate text-[11px] text-ink-subtle">
            {ownerLine(side.teamName, side.ownerHandle)}
          </p>
        )}
        <p className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className={CHIP}>
            <span className="sr-only">Record </span>
            {recordLabel(side.record)}
          </span>
          {side.pulseRank !== null && (
            <span className={CHIP}>Pulse #{side.pulseRank}</span>
          )}
          {leavingPoints !== null && (
            <span className={CHIP}>
              {fmtPoints(leavingPoints)}
              {/* "pts" for the eye, "points" for the ear: a screen reader
                  spells the abbreviation out letter by letter. */}
              <span aria-hidden="true"> pts</span>
              <span className="sr-only"> points</span> on the bench
            </span>
          )}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <ScoreFigure side={side} isFinal={isFinal} />
        {isFinal && side.won && (
          <p className="mt-1 flex items-center justify-end gap-1 text-[11px] font-bold text-signal-success">
            <Trophy aria-hidden="true" className="h-3.5 w-3.5" />
            Won
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The number on the right.
 *
 * A final week has an actual score and no projection; an unplayed week has the
 * reverse. Neither ever falls back to 0.0, because a zero on a fantasy
 * scoreboard reads as a real result and would be believed.
 */
function ScoreFigure({ side, isFinal }: { side: ScheduleMatchupSide; isFinal: boolean }) {
  const value = isFinal ? side.actual : side.projectedOptimal;
  if (value === null) {
    return (
      <p className="text-xs text-ink-subtle">
        {isFinal ? "Score not available" : "No projection"}
      </p>
    );
  }
  return (
    <p className="font-mono text-lg font-extrabold tabular-nums text-ink">
      <span className="sr-only">{isFinal ? "Scored " : "Projected "}</span>
      {fmtPoints(value)}
      <span className="sr-only"> points</span>
    </p>
  );
}
