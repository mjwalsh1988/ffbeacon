"use client";

/**
 * The lineup itself: every startable slot grouped by position, then the bench,
 * injured reserve and the taxi squad.
 *
 * CLIENT, and for the same reason components/league-schedule/matchup-table.tsx
 * is: every player row is a button that opens the detail dialog, so a handler
 * crosses the boundary whatever happens. Splitting a server shell off would buy
 * nothing, because the rows are almost all of the markup and hold no data the
 * server has to fetch.
 *
 * WHY A TABLE
 *   Six numbers per player, compared down a column: that is a table, and a
 *   table is the only structure that lets a screen reader make the same
 *   comparison a sighted reader makes by scanning. Each row's slot is the row
 *   header, so a row reads as "RB, Bijan Robinson, projected 18.4" rather than
 *   as four unlabelled numbers.
 *
 * HOW IT SURVIVES A PHONE, WITH NOTHING HIDDEN
 *   The Mobile-First rule in CLAUDE.md is absolute: every piece of data on
 *   desktop must be reachable on a phone. So the extra columns are not
 *   `hidden sm:table-cell` and abandoned. Below the small breakpoint the
 *   player cell carries the SAME facts as a wrapped line of chips underneath
 *   the name (matchup, game environment, beat rate, Positional WAR), and the
 *   columns that would hold them are dropped only because their content has
 *   already been rendered a row above. From sm up the chips are hidden and the
 *   columns appear. Neither reader loses anything, and the full detail dialog
 *   is one tap away at every width.
 *
 * NOTHING VISIBLE IS HIDDEN FROM THE ACCESSIBILITY TREE, AND THIS IS THE RULE
 * THE FILE WAS REWRITTEN AROUND.
 *   The first version drew every figure twice: an `aria-hidden` span holding
 *   the digits for the eye, and an `sr-only` span holding a sentence for the
 *   ear. It reads correctly line by line, and it breaks the moment somebody
 *   points at a number. A screen reader following the mouse announces the
 *   object under the pointer; when that object is aria-hidden the reader falls
 *   back to whatever ancestor is still exposed, which was either silence or the
 *   whole row read out again. Both feel like "this metric is not announced".
 *
 *   So every figure on this board is now a REAL text node with its units and
 *   its meaning appended beside it as visually hidden words INSIDE THE SAME
 *   ELEMENT. "24.5" plus "points expected from his offense" is one chip, and
 *   pointing at it says exactly that and nothing else. `aria-hidden` survives
 *   only on things that genuinely carry no information: icons, the decorative
 *   hairline, and the slot abbreviations whose spelled-out form is sitting
 *   right beside them in the same cell.
 *
 *   The second half of the same fix: the metric chips are no longer INSIDE the
 *   player button. A button collapses its contents into one accessible name, so
 *   a beat rate inside it could only ever be announced as part of a
 *   twelve-clause sentence about the whole player. They are siblings of the
 *   button now, in the same cell, which is what makes each one reachable on its
 *   own.
 *
 * A NULL IS NEVER A ZERO. "No projection" is what an IDP slot, a bye and an
 * unrecognised player all get. A 0.0 there would read as a real forecast of
 * nothing, would sum into a total, and would be believed.
 *
 * THE HEADLINE FIGURE FOLLOWS THE WEEK. Before the games it is the projection,
 * because that is the only number there is. From kickoff onward it is what the
 * player actually scored, with the projection kept beside it in small type and
 * the difference between them signed, because "18.4, projected 11.2, plus 7.2"
 * is the whole story of a Sunday and a page that dropped either half would be
 * telling one of two halves. lib/league-lineups/status.ts decides which week is
 * which, and it decides it from whether anybody has scored rather than from the
 * calendar.
 */

import { useCallback, useId, useMemo, useState } from "react";
import { Armchair, HeartPulse, Repeat2, ShieldAlert } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import {
  PlayerDetailDialog,
  Row as DetailRow,
} from "@/components/league-schedule/player-detail-dialog";
import {
  CHIP,
  fmtPoints,
  fmtSigned,
  opponentLabel,
  opponentWords,
  ordinal,
} from "@/components/league-schedule/format";
import { describeEnvironment, describeSpread } from "@/lib/nfl-game-environment";
import { shortSlotLabel } from "@/lib/league-schedule/slots";
import {
  baselineSigma,
  countSwapCandidates,
  type LineupBaseline,
} from "@/lib/league-lineups/simulate";
import type {
  LineupGroup,
  LineupOpponent,
  LineupOptimization,
  LineupPlayer,
} from "@/lib/league-lineups/types";
import type { WeekStatus } from "@/lib/league-lineups/status";
import { SlotSwapDialog, type SwapTarget } from "./slot-swap-dialog";
import {
  ENVIRONMENT_TIER_CLASS,
  ENVIRONMENT_TIER_SHORT,
  ENVIRONMENT_TIER_SUFFIX,
  beatRateChip,
  beatRateQualifier,
  matchupTone,
  matchupWords,
  positionalWarPlace,
  positionalWarRankPhrase,
  warFigure,
} from "./format";

type BenchSection = {
  key: "bench" | "reserve" | "taxi";
  label: string;
  hint: string;
  icon: React.ReactNode;
  players: LineupPlayer[];
};

export function LineupBoard({
  groups,
  bench,
  reserve,
  taxi,
  week,
  status,
  isFinal,
  optimization,
  opponent,
  environmentAverage,
  environmentUnavailable,
  positionalWarUnavailable,
  unprojectableSlotCount,
  unprojectedSlotCount,
}: {
  groups: LineupGroup[];
  bench: LineupPlayer[];
  reserve: LineupPlayer[];
  taxi: LineupPlayer[];
  week: number;
  /**
   * What state the week is in. Decides whether the headline figure on every row
   * is a result or a projection, and whether the what-if is offered at all.
   */
  status: WeekStatus;
  /** True once the week has SETTLED, which is the grading basis. */
  isFinal: boolean;
  /** The set and best totals the what-if measures a change against. */
  optimization: LineupOptimization;
  /** This week's opponent, for the what-if's win probability. */
  opponent: LineupOpponent | null;
  environmentAverage: number | null;
  environmentUnavailable: boolean;
  positionalWarUnavailable: boolean;
  unprojectableSlotCount: number;
  unprojectedSlotCount: number;
}) {
  const [openPlayer, setOpenPlayer] = useState<LineupPlayer | null>(null);
  const [swapTarget, setSwapTarget] = useState<SwapTarget | null>(null);
  // Stable identity, so a parent re-render cannot look to the dialog like a
  // different dialog and send focus back to the row behind it mid-read.
  const close = useCallback(() => setOpenPlayer(null), []);
  const closeSwap = useCallback(() => setSwapTarget(null), []);

  const tableId = useId();
  const nameColId = `${tableId}-name`;
  const projColId = `${tableId}-proj`;
  const matchupColId = `${tableId}-matchup`;
  const gameColId = `${tableId}-game`;
  const beatColId = `${tableId}-beat`;
  const warColId = `${tableId}-war`;

  /**
   * What a swap is measured against.
   *
   * Straight off the optimiser's own two totals, so the what-if and the summary
   * card above it can never disagree about where the lineup starts. The spread
   * is recomputed here rather than carried, because it is a sum over the very
   * players in `groups` and deriving it anywhere else would be a second place
   * for the two to drift.
   */
  const baseline: LineupBaseline = useMemo(
    () => ({
      setTotal: optimization.setTotal,
      optimalTotal: optimization.optimalTotal,
      sigma: baselineSigma(groups),
      opponent:
        opponent && opponent.projected !== null
          ? { mean: opponent.projected, sigma: opponent.sigma ?? 0 }
          : null,
    }),
    [groups, opponent, optimization.optimalTotal, optimization.setTotal],
  );

  /**
   * Whether the what-if is offered at all.
   *
   * A SETTLED WEEK IS NOT SIMULATED. The lineup cannot be changed and the
   * result is already known, so "what if you had started him" is a question
   * about a decision that has finished happening. The Manager Ledger answers
   * that one, graded on what players actually did rather than on projections
   * that were wrong enough to make the manager bench him in the first place.
   *
   * A lineup with nothing projected is not simulated either: there is no
   * baseline to move.
   *
   * `showsAdvice` is the one test, and it is the same one the waiver panel
   * uses, so the two halves of the page can never disagree about whether a week
   * is still actionable. It is false for a settled week, a week in progress,
   * and a past week Sleeper never marked final: that last one is not final and
   * is still unplayable, and Power Pulse's `weekly` only carries weeks from the
   * live one forward, so it would have offered a full what-if with the win
   * probability silently missing from it.
   */
  const canSimulate = status.showsAdvice && optimization.setTotal !== null;

  /**
   * How many bench players could hold each slot token, worked out ONCE.
   *
   * A dozen rows each filtering the whole bench on every render is wasted work,
   * and it was also the wrong shape: the answer depends on the slot TOKEN, not
   * on the row, so a league running three WR slots asked the identical question
   * three times.
   *
   * It decides whether the slot even gets a button. A slot with nothing on the
   * bench that could hold it has no what-if to offer, and a button that opens a
   * panel saying "nobody" is worse than no button at all.
   */
  const swapOptionsByToken = useMemo(() => {
    const counts = new Map<string, number>();
    if (!canSimulate) return counts;
    for (const group of groups) {
      for (const entry of group.entries) {
        if (!entry.slot.projectable) continue;
        if (counts.has(entry.slot.token)) continue;
        counts.set(entry.slot.token, countSwapCandidates(bench, entry.slot.token));
      }
    }
    return counts;
  }, [bench, canSimulate, groups]);

  const benchSections: BenchSection[] = ([
    {
      key: "bench",
      label: "Bench",
      hint: "Available to start.",
      icon: <Armchair aria-hidden="true" className="h-3.5 w-3.5" />,
      players: bench,
    },
    {
      key: "reserve",
      label: "Injured reserve",
      hint: "Cannot start without a roster move.",
      icon: <HeartPulse aria-hidden="true" className="h-3.5 w-3.5" />,
      players: reserve,
    },
    {
      key: "taxi",
      label: "Taxi squad",
      hint: "Cannot start without a roster move.",
      icon: <ShieldAlert aria-hidden="true" className="h-3.5 w-3.5" />,
      players: taxi,
    },
  ] as BenchSection[]).filter((s) => s.players.length > 0);

  return (
    <>
      {canSimulate && (
        <p className="mb-2 flex items-start gap-2 px-1 text-[11px] leading-relaxed text-ink-muted">
          <Repeat2 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-cyan" />
          <span>
            The slot button beside each starter opens a what-if: swap him for anyone on your
            bench and see what it does to your points, your chance of winning and the gap to
            your best lineup.
          </span>
        </p>
      )}

      {/* FOCUSABLE, because it scrolls. A div with `overflow-x-auto` and no
          tabIndex cannot be scrolled from the keyboard, and this table is wider
          than a phone at every breakpoint that shows the extra columns. */}
      <div
        tabIndex={0}
        role="region"
        aria-label={`Week ${week} roster table. Scroll horizontally to see every column.`}
        className="overflow-x-auto rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <table className="w-full text-sm">
          <caption className="sr-only">
            Your week {week} roster, {status.label}. Each row is one player with the slot
            he is in, his{" "}
            {status.showsResults ? "score and the projection it is measured against" : "projected points"},
            his matchup, the scoring expected in his NFL game, how often he beats his
            projection, and his Positional WAR. Open any row for the full breakdown
            {canSimulate ? ", or the slot button beside him to try a change" : ""}.
          </caption>

          <thead className="bg-surface text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <th scope="col" className="w-14 px-1 py-2 text-center">
                Slot
              </th>
              <th id={nameColId} scope="col" className="px-2 py-2 text-left">
                Player
              </th>
              <th id={projColId} scope="col" className="px-2 py-2 text-right">
                {status.showsResults ? "Scored" : "Proj"}
              </th>
              {/* The four columns whose contents move into the player cell on a
                  phone. See the header: this is not hidden data, it is the same
                  data rendered once per breakpoint. */}
              <th id={matchupColId} scope="col" className="hidden px-2 py-2 text-left sm:table-cell">
                Matchup
              </th>
              <th id={gameColId} scope="col" className="hidden px-2 py-2 text-left md:table-cell">
                Game
              </th>
              <th id={beatColId} scope="col" className="hidden px-2 py-2 text-right lg:table-cell">
                Beats proj
              </th>
              <th id={warColId} scope="col" className="hidden px-2 py-2 text-right lg:table-cell">
                Positional WAR
              </th>
            </tr>
          </thead>

          {groups.map((group) => (
            /* ONE POSITION BLOCK, DRAWN AS A BLOCK.
               The heavy top rule and the banded heading row are what separate
               the quarterbacks from the running backs at a glance. A one pixel
               divider between every row, which is what this was, makes the
               group heading just another row and leaves a twenty row table
               reading as one undifferentiated list. */
            <tbody
              key={group.group}
              className="divide-y divide-line border-t-[3px] border-t-line-accent"
            >
              <tr className="bg-surface/70">
                <th
                  scope="colgroup"
                  colSpan={7}
                  className="px-2 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-brand-cyan"
                >
                  {group.label}
                  <span className="ml-2 font-normal normal-case tracking-normal text-ink-subtle">
                    {group.entries.length}{" "}
                    {group.entries.length === 1 ? "slot" : "slots"}
                  </span>
                  {group.projected !== null && (
                    <span className="ml-2 font-mono text-[11px] font-semibold normal-case tracking-normal text-ink-muted">
                      {fmtPoints(group.projected)}
                      <span className="sr-only"> projected points from this group</span>
                    </span>
                  )}
                </th>
              </tr>
              {group.entries.map((entry) => (
                <PlayerRow
                  key={`${entry.slot.token}-${entry.slot.order}`}
                  slotLabel={entry.slot.label}
                  slotDescription={entry.slot.description}
                  player={entry.player}
                  status={status}
                  isFinal={isFinal}
                  onOpen={setOpenPlayer}
                  onSwap={
                    (swapOptionsByToken.get(entry.slot.token) ?? 0) > 0
                      ? () =>
                          setSwapTarget({
                            token: entry.slot.token,
                            label: entry.slot.label,
                            description: entry.slot.description,
                            player: entry.player,
                          })
                      : null
                  }
                  ids={{ nameColId, projColId, matchupColId, gameColId, beatColId, warColId }}
                  rowId={`${tableId}-${entry.slot.token}-${entry.slot.order}`}
                />
              ))}
            </tbody>
          ))}

          {benchSections.map((section) => (
            <tbody
              key={section.key}
              className="divide-y divide-line border-t-[3px] border-t-line-accent"
            >
              <tr className="bg-surface/70">
                <th
                  scope="colgroup"
                  colSpan={7}
                  className="px-2 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-ink-muted"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {section.icon}
                    {section.label}
                    <span className="font-normal normal-case tracking-normal text-ink-subtle">
                      {section.players.length}{" "}
                      {section.players.length === 1 ? "player" : "players"}. {section.hint}
                    </span>
                  </span>
                </th>
              </tr>
              {section.players.map((player) => (
                <PlayerRow
                  key={player.sleeperId}
                  slotLabel={section.key === "bench" ? "BN" : section.key === "reserve" ? "IR" : "TX"}
                  slotDescription={section.label.toLowerCase()}
                  player={player}
                  status={status}
                  isFinal={isFinal}
                  onOpen={setOpenPlayer}
                  onSwap={null}
                  ids={{ nameColId, projColId, matchupColId, gameColId, beatColId, warColId }}
                  rowId={`${tableId}-${section.key}-${player.sleeperId}`}
                  muted
                />
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {/* THE FOOTNOTES, and every one of them is about a number that is NOT on
          the page rather than one that is. A reader who cannot see why a total
          looks low deserves the reason without having to work it out. */}
      <ul className="mt-3 space-y-1 px-1 text-[11px] leading-relaxed text-ink-muted">
        {unprojectableSlotCount > 0 && (
          <li>
            Totals leave out {unprojectableSlotCount} defensive{" "}
            {unprojectableSlotCount === 1 ? "slot" : "slots"}. Sleeper publishes no
            projections for those positions.
          </li>
        )}
        {unprojectedSlotCount > 0 && (
          <li>
            {unprojectedSlotCount} filled {unprojectedSlotCount === 1 ? "slot has" : "slots have"}{" "}
            no published projection, so {unprojectedSlotCount === 1 ? "it is" : "they are"} left
            out of the totals too.
          </li>
        )}
        {environmentUnavailable && (
          <li>
            No betting lines are published for this week yet, so there is no expected score
            for anyone&apos;s NFL game.
          </li>
        )}
        {positionalWarUnavailable && (
          <li>
            Positional WAR has not been built for this league yet. Open the Positional WAR
            page once and it fills in.
          </li>
        )}
        {status.showsResults && (
          <li>
            {status.phase === "final"
              ? `Week ${week} has been played, so there is nothing left to try.`
              : "Scores update as games finish, and the best lineup is graded once the week settles."}{" "}
            Each row shows what the player scored with the projection it was measured
            against underneath.
          </li>
        )}
      </ul>

      <PlayerDetailDialog
        player={openPlayer}
        week={week}
        isFinal={isFinal}
        onClose={close}
        extras={openPlayer ? <LineupExtras player={openPlayer} average={environmentAverage} /> : null}
      />

      <SlotSwapDialog
        target={swapTarget}
        bench={bench}
        baseline={baseline}
        week={week}
        opponentName={opponent?.teamName ?? null}
        onClose={closeSwap}
      />
    </>
  );
}

/**
 * The two rows the Schedule section's dialog does not know about.
 *
 * Appended into the same description list rather than shipped as a second
 * dialog. See the header comment on components/league-schedule/player-detail-dialog.tsx.
 */
function LineupExtras({
  player,
  average,
}: {
  player: LineupPlayer;
  average: number | null;
}) {
  const spread = describeSpread(player.environment?.spread ?? null);
  const rank =
    player.environment?.impliedRank !== null && player.environment?.impliedRank !== undefined
      ? ` That is the ${ordinal(player.environment.impliedRank)} highest of ${player.environment.rankedTeams} teams playing this week.`
      : "";

  return (
    <>
      {/* The term already says "Positional WAR", so the value does not. It
          used to, and the row read "Positional WAR: 0.42 Positional WAR, 3 of
          24 at QB", which is the label announced twice for one fact. */}
      <DetailRow
        term="Positional WAR"
        value={
          player.positionalWar === null
            ? "Not built for this league yet"
            : `${player.positionalWar.toFixed(2)}, ranked ${positionalWarRankPhrase(
                player.positionalWarRank,
                player.positionalWarPoolSize,
                player.position,
              )}.`
        }
      />
      <DetailRow
        term="His NFL game"
        value={`${describeEnvironment(player.environment, average)}${rank}${spread ? ` ${spread}.` : ""}`}
      />
      <DetailRow
        term="Where he is on your roster"
        value={
          player.startingSlotLabel
            ? `Starting at ${player.startingSlotLabel}.`
            : player.rosterSlot === "reserve"
              ? "On injured reserve."
              : player.rosterSlot === "taxi"
                ? "On the taxi squad."
                : "On your bench."
        }
      />
    </>
  );
}

function PlayerRow({
  slotLabel,
  slotDescription,
  player,
  status,
  isFinal,
  onOpen,
  onSwap,
  ids,
  rowId,
  muted = false,
}: {
  slotLabel: string;
  slotDescription: string;
  player: LineupPlayer | null;
  status: WeekStatus;
  isFinal: boolean;
  onOpen: (player: LineupPlayer) => void;
  /** Null when this slot cannot be simulated: a bench row, an IDP slot, a settled week. */
  onSwap: (() => void) | null;
  ids: {
    nameColId: string;
    projColId: string;
    matchupColId: string;
    gameColId: string;
    beatColId: string;
    warColId: string;
  };
  rowId: string;
  muted?: boolean;
}) {
  /**
   * The slot cell, which is also the row header.
   *
   * TWO NAMES, ONE CELL, AND THEY ARE NOT THE SAME NAME.
   *
   * A th with scope row takes its name from its subtree, and a descendant
   * button contributes its own accessible name rather than its text, so a
   * chatty button label is echoed onto all six data cells in the row during
   * table navigation. `aria-label` on the th is author-supplied and wins over
   * name-from-content, so the row header stays exactly the one word the
   * non-interactive version announced while the button says more.
   *
   * The button's own name STARTS WITH THE VISIBLE TOKEN, which is WCAG 2.5.3
   * Label in Name (Level A) and was the first version's real bug rather than a
   * nicety: the visible label is "QB" or "SF", the name was "quarterback, try a
   * different player", and neither token appeared in its own name, so speech
   * input had nothing to match on any slot in any league.
   *
   * An aria-describedby was the other attempt and it does not work here. The
   * element it points at has to live somewhere, and inside the th it lands back
   * in the row header's own text, which is the thing being kept short.
   */
  const slotCell = (
    <th
      id={rowId}
      scope="row"
      aria-label={slotDescription}
      className="w-14 px-1 py-2 text-center align-middle text-[11px] font-bold uppercase tracking-wide text-ink-muted"
    >
      {onSwap ? (
        <button
          type="button"
          onClick={onSwap}
          aria-haspopup="dialog"
          aria-label={`${shortSlotLabel(slotLabel)}, ${slotDescription}, try a different player`}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-card border border-brand-cyan/50 bg-base/70 px-1 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-cyan transition-colors hover:border-brand-cyan hover:bg-brand-cyan/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <span aria-hidden="true">{shortSlotLabel(slotLabel)}</span>
        </button>
      ) : (
        <>
          <span aria-hidden="true">{shortSlotLabel(slotLabel)}</span>
          <span className="sr-only">{slotDescription}</span>
        </>
      )}
    </th>
  );

  if (!player) {
    return (
      <tr>
        {slotCell}
        <td
          headers={`${ids.nameColId} ${rowId}`}
          colSpan={6}
          className="px-2 py-3 text-xs text-ink-subtle"
        >
          Empty. Nobody is in this slot.
        </td>
      </tr>
    );
  }

  // THE HEADLINE, and the number under it. On a week with results the score is
  // the fact and the projection is the footnote; before the games there is only
  // the projection.
  const showResult = status.showsResults;
  const points = showResult ? player.actual : player.projected;
  const shadow =
    showResult && player.actual !== null && player.projected !== null ? player.projected : null;
  const swing = shadow === null || player.actual === null ? null : player.actual - shadow;
  const matchup = matchupWords(player.opponentMultiplier);
  const beat = beatRateChip(player.beatRate);
  const war = warFigure(player.positionalWar);
  const tier = player.environmentTier;
  const implied = player.environment?.impliedTotal ?? null;

  return (
    <tr className={muted ? "bg-base/20" : ""}>
      {slotCell}

      <td headers={`${ids.nameColId} ${rowId}`} className="px-1 py-2 sm:px-2">
        {/* THE BUTTON HOLDS THE IDENTITY AND NOTHING ELSE. Everything a reader
            might want to point at individually lives outside it, below. */}
        <button
          type="button"
          onClick={() => onOpen(player)}
          aria-haspopup="dialog"
          aria-label={spokenPlayer(player, showResult)}
          className="flex min-h-11 w-full items-start gap-2 rounded-card px-1 py-1 text-left transition-colors hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <span className="shrink-0">
            <PlayerHeadshot sleeperId={player.sleeperId} name="" size={28} />
          </span>
          <span aria-hidden="true" className="block min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-ink sm:text-sm">
              {player.name}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-ink-muted">
              {player.position}
              {player.team ? `, ${player.team}` : ""}{" "}
              {opponentLabel(player.nflOpponent, player.nflIsHome)}
            </span>
          </span>
        </button>

        {player.injuryStatus && (
          <p className={`mt-1 ${CHIP} border-signal-warning/50 text-signal-warning`}>
            {player.injuryStatus}
            <span className="sr-only"> injury designation</span>
          </p>
        )}

        {/* THE NARROW-SCREEN COPY OF THE FOUR COLUMNS.
            EACH CHIP HIDES AT THE BREAKPOINT ITS OWN COLUMN APPEARS AT, and
            that is the whole point of the four separate utilities. Gating the
            wrapper at `sm` instead left a real hole: the columns arrive at sm,
            md, lg and lg, so between 640px and 1023px the game total, the beat
            rate and the Positional WAR were on screen nowhere. That is tablet
            portrait and most split-screen laptop widths.

            These are SIBLINGS of the button rather than children of it, so each
            one is its own object in the accessibility tree and can be read on
            its own. Inside the button they could only ever have been announced
            as part of one long sentence about the player. */}
        <span className="mt-1.5 flex flex-wrap gap-1 lg:hidden">
          {matchup && (
            <span
              className={`${CHIP} ${matchupTone(player.opponentMultiplier)} !py-0.5 !text-[10px] sm:hidden`}
            >
              {matchup}
              <span className="sr-only"> against this week&apos;s opponent</span>
            </span>
          )}
          {tier && implied !== null && (
            <span
              className={`${CHIP} ${ENVIRONMENT_TIER_CLASS[tier]} !py-0.5 !text-[10px] md:hidden`}
            >
              {implied.toFixed(1)}
              <span className="sr-only"> points expected from his offense,</span>{" "}
              {ENVIRONMENT_TIER_SHORT[tier]}
              <span className="sr-only">{ENVIRONMENT_TIER_SUFFIX[tier]}</span>
            </span>
          )}
          {beat && (
            <span className={`${CHIP} !py-0.5 !text-[10px]`}>
              {beat}
              <span className="sr-only"> rate, {beatRateQualifier(player.beatRate)}</span>
            </span>
          )}
          {war && (
            <span className={`${CHIP} !py-0.5 !text-[10px]`}>
              {war}{" "}
              <span aria-hidden="true">Positional WAR</span>
              {/* The same rank the lg column carries, so the phone is not shown
                  a thinner version of the fact. */}
              <span className="sr-only">
                {positionalWarPlace(
                  player.positionalWarRank,
                  player.positionalWarPoolSize,
                  player.position,
                )}
              </span>
            </span>
          )}
        </span>
      </td>

      <td
        headers={`${ids.projColId} ${rowId}`}
        className="px-1 py-2 text-right align-middle sm:px-2"
      >
        {/* THE COLUMN THIS PAGE IS NAMED FOR HAS TO BE READABLE DOWN THE
            COLUMN, and it has to answer when a reader points at it. One text
            node with the unit appended, not two spans where the visible one is
            hidden from the reader and the spoken one is off-screen. */}
        <span
          className={`block font-mono font-bold tabular-nums ${
            points === null ? "text-[10px] text-ink-subtle" : "text-base text-ink sm:text-lg"
          }`}
        >
          {points === null ? (
            showResult ? (
              <>
                No score<span className="sr-only"> recorded</span>
              </>
            ) : (
              <>
                No proj<span className="sr-only">ection published</span>
              </>
            )
          ) : (
            <>
              {fmtPoints(points)}
              <span className="sr-only"> points {showResult ? "scored" : "projected"}</span>
            </>
          )}
        </span>
        {/* THE PROJECTION, KEPT BUT DEMOTED. Small, muted, and carrying the
            signed difference, because the interesting thing about a result is
            how far off the forecast was. The sign is the point, so it is never
            dropped, and the colour is reinforcement on top of a figure that
            already carries it. */}
        {shadow !== null && swing !== null && (
          <span className="mt-0.5 block font-mono text-[10px] tabular-nums leading-tight text-ink-subtle">
            {fmtPoints(shadow)}
            <span aria-hidden="true"> proj</span>
            <span className="sr-only"> projected,</span>{" "}
            <span
              className={
                swing > 0.05
                  ? "text-brand-cyan"
                  : swing < -0.05
                    ? "text-signal-warning"
                    : "text-ink-subtle"
              }
            >
              {fmtSigned(swing)}
              <span className="sr-only">
                {" "}
                {swing > 0.05 ? "over" : swing < -0.05 ? "under" : "level with"} his projection
              </span>
            </span>
          </span>
        )}
      </td>

      <td
        headers={`${ids.matchupColId} ${rowId}`}
        className="hidden px-2 py-2 align-middle sm:table-cell"
      >
        {matchup ? (
          <span className={`${CHIP} ${matchupTone(player.opponentMultiplier)}`}>{matchup}</span>
        ) : (
          <span className="text-[11px] text-ink-subtle">Not available</span>
        )}
      </td>

      <td
        headers={`${ids.gameColId} ${rowId}`}
        className="hidden px-2 py-2 align-middle md:table-cell"
      >
        {/* THE BAND IS A WORD, NOT A TINT. The number alone plus a colour left
            the high/average/low reading available to a sighted reader only
            through hue, which is exactly what the colour rule forbids. The
            short form fits the column; the full sentence rides beside it. */}
        {tier && implied !== null ? (
          <span className={`${CHIP} ${ENVIRONMENT_TIER_CLASS[tier]}`}>
            {implied.toFixed(1)}
            <span className="sr-only"> points expected from his offense,</span>{" "}
            {ENVIRONMENT_TIER_SHORT[tier]}
            <span className="sr-only">{ENVIRONMENT_TIER_SUFFIX[tier]}</span>
          </span>
        ) : (
          <span className="text-[11px] text-ink-subtle">Not available</span>
        )}
      </td>

      <td
        headers={`${ids.beatColId} ${rowId}`}
        className="hidden px-2 py-2 text-right align-middle font-mono text-xs tabular-nums text-ink-muted lg:table-cell"
      >
        {beat ? (
          <span>
            {beat}
            <span className="sr-only"> rate, {beatRateQualifier(player.beatRate)}</span>
          </span>
        ) : (
          <span className="font-sans text-[11px] text-ink-subtle">Not enough weeks</span>
        )}
      </td>

      <td
        headers={`${ids.warColId} ${rowId}`}
        className="hidden px-2 py-2 text-right align-middle font-mono text-xs tabular-nums text-ink-muted lg:table-cell"
      >
        {war ? (
          <span>
            {war}
            <span className="sr-only">
              {" "}
              {positionalWarPlace(
                player.positionalWarRank,
                player.positionalWarPoolSize,
                player.position,
              )}
            </span>
          </span>
        ) : (
          <span className="font-sans text-[11px] text-ink-subtle">Not built</span>
        )}
      </td>
    </tr>
  );
}

/**
 * The accessible name for a player row's detail button.
 *
 * DELIBERATELY SHORTER THAN IT USED TO BE. It once carried the matchup, the
 * game environment, the beat rate and the Positional WAR as well, because those
 * chips were inside the button and a button flattens its contents into one
 * name. They are outside it now and readable individually, so repeating them
 * here would mean hearing every figure twice: once in a twelve-clause sentence
 * and once where it is actually drawn. What is left is identity, the headline
 * number, and what the button does.
 */
function spokenPlayer(player: LineupPlayer, showResult: boolean): string {
  const parts: string[] = [player.name, player.position];
  if (player.team) parts.push(player.team);
  parts.push(opponentWords(player.nflOpponent, player.nflIsHome));

  if (showResult) {
    // THE SCORE ONLY. The projection and the signed difference live one cell
    // away and are announced there, so repeating them here reads every figure
    // in the row twice. The score stays because a reader tabbing between
    // buttons never reaches the cell.
    parts.push(player.actual === null ? "no score recorded" : `scored ${fmtPoints(player.actual)}`);
  } else {
    parts.push(
      player.projected === null
        ? "no projection published"
        : `projected ${fmtPoints(player.projected)} points`,
    );
  }

  // The injury designation is NOT repeated here. It used to be inside this
  // button, where the name was the only way to say it; it is a chip beside the
  // button now, so appending it would announce it twice on every injured row.
  return `${parts.join(", ")}. Open details.`;
}
