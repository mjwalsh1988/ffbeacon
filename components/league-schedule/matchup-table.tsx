"use client";

/**
 * The lineup comparison: both starting lineups, slot against slot.
 *
 * CLIENT, and deliberately so. Every player cell is a button that opens the
 * detail dialog, which means a handler crosses this boundary whatever happens.
 * The alternative was splitting the table into a server shell and a client cell,
 * which buys nothing: the table holds no data the server has to fetch and the
 * cells are most of the markup. It takes a built MatchupView and renders it.
 *
 * WHY A TABLE, AND WHY THE SLOT IS THE ROW HEADER
 *   The layout is making a comparison, one slot at a time, and a table is the
 *   only structure that lets a screen reader make the same comparison. With the
 *   slot in the middle column, a row reads as "QB, Josh Allen projected 22.4,
 *   Patrick Mahomes projected 21.8", which is the sentence the sighted layout
 *   is drawing. Two stacked lists would ask the reader to hold twelve names in
 *   their head to compare anything, which is not a comparison, it is a memory
 *   test.
 *
 * WHY EVERY DATA CELL NAMES ITS HEADERS
 *   scope="row" is not enough here, and the reason is easy to miss: the header
 *   assignment algorithm walks FORWARD from the header cell, so a th in column
 *   two is assigned to the away cell on its right and to nothing on its left.
 *   The home column would be headerless. That is survivable in the body, where
 *   each player cell carries a self-contained aria-label, and it is not
 *   survivable in the footer, where the home column's four figures would
 *   announce as "118.2, 121.4, 125.7, +7.3" with no way to tell Final from
 *   Projected from Best lineup from Difference. So the column headers and each
 *   middle cell carry ids and both data cells list them in `headers`, which
 *   says the association outright instead of leaving it to the column order.
 *   The colSpan group rows stay on scope="colgroup", which is the WAI pattern
 *   for a multi-level header and needs no ids.
 *
 * WHY THE TABLE SURVIVES A PHONE
 *   Three columns fit at 360px because the centre column is fixed at 56px and
 *   each player cell is a two line stack: name on the first line, position,
 *   opponent and points on the second. The headshot drops from 32px to 24px and
 *   nothing else changes. No column is hidden, no data moves to a separate
 *   sheet, and the whole table sits in an overflow-x-auto container so an
 *   unusually long team name can never push the page sideways.
 *
 * WHY A NULL PROJECTION IS NEVER A ZERO
 *   "No projection" is what an IDP slot, a bye, and an unrecognised player all
 *   get. A 0.0 in that cell would read as a real forecast of nothing, would sum
 *   into a total, and would be believed. The totals in the footer say in words
 *   how many slots they leave out for the same reason.
 */

import { useCallback, useId, useState } from "react";
import { PlayerHeadshot } from "@/components/player-headshot";
import type {
  MatchupSide,
  MatchupSlotEntry,
  MatchupView,
  SchedulePlayer,
  SlotGroup,
} from "@/lib/league-schedule/types";
import { CHIP, fmtPoints, listWords, opponentLabel, opponentWords } from "./format";
import { PlayerDetailDialog } from "./player-detail-dialog";

/**
 * Display order for the position blocks.
 *
 * A mirror of SLOT_GROUP_ORDER in lib/league-schedule/slots.ts. It is repeated
 * here rather than imported so this component depends on the type contract
 * alone. The Record below is what keeps the two honest: adding a group to the
 * SlotGroup union fails this file to compile until the label exists.
 */
const GROUP_LABEL: Record<SlotGroup, string> = {
  QB: "Quarterbacks",
  RB: "Running backs",
  WR: "Wide receivers",
  TE: "Tight ends",
  FLEX: "Flex",
  SUPERFLEX: "Superflex",
  IDP: "Defensive players",
  K: "Kickers",
  DEF: "Team defense",
};

const GROUP_ORDER: readonly SlotGroup[] = [
  "QB",
  "RB",
  "WR",
  "TE",
  "FLEX",
  "SUPERFLEX",
  "IDP",
  "K",
  "DEF",
];

type PairedRow = {
  key: string;
  home: MatchupSlotEntry;
  away: MatchupSlotEntry | null;
};

/**
 * Pair the two lineups slot by slot.
 *
 * Both sides come from the same league roster_positions, so index n on one side
 * is the same slot as index n on the other. Pairing on index rather than on the
 * slot token is what keeps RB1 opposite RB1 instead of collapsing both running
 * back slots onto one row. A side that comes back short (a roster Sleeper
 * answered oddly for) simply has null on those rows rather than shifting every
 * row below it.
 */
function pairSlots(home: MatchupSide, away: MatchupSide | null): PairedRow[] {
  return home.slots.map((entry, index) => ({
    key: `${entry.slot.token}-${entry.slot.order}-${index}`,
    home: entry,
    away: away ? (away.slots[index] ?? null) : null,
  }));
}

/**
 * The tint on the winning half of a row.
 *
 * Deliberately faint. Twelve rows of it down a table is a lot of surface, and
 * anything stronger turns the comparison into a striped block where the eye
 * lands on the colour rather than on the numbers. It is a scanning aid and
 * nothing else: both figures are already in the row, both cells carry a full
 * accessible name, and the tint is applied to a `td` with no role of its own, so
 * nothing announces it and nothing is lost without it.
 */
const WINNING_HALF = "bg-brand-cyan/[0.055]";

/**
 * Which half of a paired row is ahead, or neither.
 *
 * Graded on the same basis as the week: what was actually scored once the week
 * is final, projections before then. A null on either side means there is no
 * comparison to make, and a tie is not a win, so both come back null and no
 * tint is drawn. Nothing here invents a zero to compare against.
 */
function slotLeader(row: PairedRow, isFinal: boolean): "home" | "away" | null {
  const value = (entry: MatchupSlotEntry | null): number | null => {
    const player = entry?.player;
    if (!player) return null;
    return isFinal ? player.actual : player.projected;
  };
  const home = value(row.home);
  const away = value(row.away);
  if (home === null || away === null) return null;
  if (home === away) return null;
  return home > away ? "home" : "away";
}

function groupRows(rows: PairedRow[]): { group: SlotGroup; rows: PairedRow[] }[] {
  const buckets = new Map<SlotGroup, PairedRow[]>();
  for (const row of rows) {
    const list = buckets.get(row.home.slot.group) ?? [];
    list.push(row);
    buckets.set(row.home.slot.group, list);
  }
  return GROUP_ORDER.filter((group) => buckets.has(group)).map((group) => ({
    group,
    // Inside a block the league's own slot order decides, so RB1 stays above
    // RB2 in a league that lists them that way.
    rows: (buckets.get(group) ?? []).sort(
      (a, b) => a.home.slot.order - b.home.slot.order,
    ),
  }));
}

/**
 * Filled slots with no published projection, counted per team.
 *
 * One figure for both sides would have to be the larger of the two, and it
 * would then be reported against the team that has fewer: a side missing two
 * projections would be told it is missing three. The two numbers are right
 * here, so the sentence names each team and its own count. Null when both
 * sides are complete, so the caller drops the row rather than printing a zero.
 */
function unprojectedFilledNote(
  home: MatchupSide,
  away: MatchupSide | null,
): string | null {
  const parts: string[] = [];
  for (const side of away === null ? [home] : [home, away]) {
    const count = side.unprojectedSlots;
    if (count <= 0) continue;
    parts.push(
      `${side.teamName} has ${count} filled ${count === 1 ? "slot" : "slots"} with no published projection`,
    );
  }
  if (parts.length === 0) return null;
  return `${listWords(parts)}. Slots with no projection are left out of the totals too.`;
}

export function MatchupTable({
  view,
  onOpenPlayer,
}: {
  view: MatchupView;
  /**
   * Optional. Supply it to own the detail dialog in the parent (useful when a
   * page wants the dialog outside the scroll container). Left off, this
   * component opens its own PlayerDetailDialog, so a caller that just wants the
   * table working has nothing to wire up.
   */
  onOpenPlayer?: (player: SchedulePlayer) => void;
}) {
  const [openPlayer, setOpenPlayer] = useState<SchedulePlayer | null>(null);
  const handleOpen = (player: SchedulePlayer) => {
    if (onOpenPlayer) onOpenPlayer(player);
    else setOpenPlayer(player);
  };
  // Stable identity, so re-rendering this table cannot look to the dialog like
  // a different dialog and send focus back to the cell behind it mid-read.
  const closeDetail = useCallback(() => setOpenPlayer(null), []);

  // Prefix for the header ids, so two tables on one page cannot collide.
  const tableId = useId();
  const homeColId = `${tableId}-home`;
  const awayColId = `${tableId}-away`;

  const { home, away, isFinal, week } = view;
  const rows = groupRows(pairSlots(home, away));
  const colCount = away ? 3 : 2;

  // Slots the league runs that Sleeper publishes no projections for. Counted
  // from the slot definitions rather than from the filled players, because an
  // empty IDP slot is still a slot the totals cannot include.
  const unprojectableSlots = home.slots.filter((entry) => !entry.slot.projectable).length;
  const unprojectedNote = unprojectedFilledNote(home, away);

  return (
    <>
      {away === null && (
        <p className="mb-3 text-sm leading-relaxed text-ink-muted">
          {home.teamName} has no opponent in week {week}. This league has an odd number of
          teams, so one roster sits out each week. The lineup below is the one that is
          set, and it scores nothing against nobody.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">
            {away === null
              ? `Week ${week} starting lineup, ${home.teamName}, with no opponent this week.`
              : `Week ${week} starting lineups, ${home.teamName} against ${away.teamName}.`}
          </caption>

          <thead className="bg-surface text-xs font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <th id={homeColId} scope="col" className="px-2 py-3 text-left">
                {home.teamName}
              </th>
              <th scope="col" className="w-14 px-1 py-3 text-center">
                Slot
              </th>
              {away !== null && (
                <th id={awayColId} scope="col" className="px-2 py-3 text-right">
                  {away.teamName}
                </th>
              )}
            </tr>
          </thead>

          {rows.map(({ group, rows: groupRowsList }) => (
            <tbody key={group} className="divide-y divide-line border-t border-line">
              <tr className="bg-base/60">
                <th
                  scope="colgroup"
                  colSpan={colCount}
                  className="px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-[0.16em] text-brand-cyan"
                >
                  {GROUP_LABEL[group]}
                </th>
              </tr>
              {groupRowsList.map((row) => {
                const slotId = `${tableId}-${row.key}`;
                const lead = slotLeader(row, isFinal);
                return (
                  <tr key={row.key} className="align-top">
                    <td
                      headers={`${homeColId} ${slotId}`}
                      className={`px-1 py-2 sm:px-2 ${lead === "home" ? WINNING_HALF : ""}`}
                    >
                      <PlayerCell
                        entry={row.home}
                        isFinal={isFinal}
                        align="start"
                        onOpen={handleOpen}
                      />
                    </td>
                    <th
                      id={slotId}
                      scope="row"
                      className="w-14 px-1 py-2 text-center align-middle text-[11px] font-bold uppercase tracking-wide text-ink-muted"
                    >
                      {row.home.slot.label}
                      {/* "W/T" read aloud is noise, so the spelled-out form rides
                          along and the abbreviation stays for the eye. */}
                      <span className="sr-only">, {row.home.slot.description}</span>
                    </th>
                    {away !== null && (
                      <td
                        headers={`${awayColId} ${slotId}`}
                        className={`px-1 py-2 sm:px-2 ${lead === "away" ? WINNING_HALF : ""}`}
                      >
                        <PlayerCell
                          entry={row.away}
                          isFinal={isFinal}
                          align="end"
                          onOpen={handleOpen}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          ))}

          {/* THE TOTALS ARE THE ANSWER, so the footer is a box rather than four
              more rows. A tinted surface, a thick top rule, and a heavy divide
              above the two supporting figures: the headline total is what a
              reader came down here for, and Best lineup and Difference are the
              working behind it. They used to render at the same weight, which
              made the block read as four equally important numbers and left the
              eye to find the one that mattered. */}
          <tfoot className="border-t-2 border-line-accent bg-surface-elevated/60">
            {isFinal && (
              <TotalRow
                label="Final"
                rowId={`${tableId}-final`}
                homeColId={homeColId}
                awayColId={awayColId}
                homeValue={home.actualTotal}
                awayValue={away?.actualTotal ?? null}
                hasAway={away !== null}
                emphasis
              />
            )}
            <TotalRow
              label="Projected"
              rowId={`${tableId}-projected`}
              homeColId={homeColId}
              awayColId={awayColId}
              homeValue={home.projectedTotal}
              awayValue={away?.projectedTotal ?? null}
              hasAway={away !== null}
              emphasis={!isFinal}
              // On a final week the projection is the footnote, not the
              // headline, so it drops to the supporting tier with the other two.
              secondary={isFinal}
            />
            <TotalRow
              label="Best lineup"
              rowId={`${tableId}-optimal`}
              homeColId={homeColId}
              awayColId={awayColId}
              homeValue={home.optimalTotal}
              awayValue={away?.optimalTotal ?? null}
              hasAway={away !== null}
              secondary
            />
            <TotalRow
              label="Difference"
              rowId={`${tableId}-difference`}
              homeColId={homeColId}
              awayColId={awayColId}
              homeValue={home.pointsLeftOnBench}
              awayValue={away?.pointsLeftOnBench ?? null}
              hasAway={away !== null}
              signed
              secondary
            />
            {view.hasUnprojectableSlots && unprojectableSlots > 0 && (
              <tr>
                <td
                  colSpan={colCount}
                  className="px-2 py-2 text-[11px] leading-relaxed text-ink-muted"
                >
                  Totals exclude {unprojectableSlots} IDP{" "}
                  {unprojectableSlots === 1 ? "slot" : "slots"}, which Sleeper does not
                  publish projections for.
                </td>
              </tr>
            )}
            {unprojectedNote !== null && (
              <tr>
                <td
                  colSpan={colCount}
                  className="px-2 pb-2 text-[11px] leading-relaxed text-ink-muted"
                >
                  {unprojectedNote}
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      {/* Only mounted when this component owns the dialog. A parent that passed
          onOpenPlayer renders its own and this stays closed forever. */}
      {!onOpenPlayer && (
        <PlayerDetailDialog
          player={openPlayer}
          week={week}
          isFinal={isFinal}
          onClose={closeDetail}
        />
      )}
    </>
  );
}

/**
 * One side of one slot.
 *
 * The whole cell is the button, so the tap target is the row height rather than
 * the name, and min-h-11 holds the floor at 44px on the shortest possible cell.
 * The accessible name is built to stand alone, because a reader can arrive here
 * from a list of buttons with none of the surrounding table for context.
 */
function PlayerCell({
  entry,
  isFinal,
  align,
  onOpen,
}: {
  entry: MatchupSlotEntry | null;
  isFinal: boolean;
  align: "start" | "end";
  onOpen: (player: SchedulePlayer) => void;
}) {
  if (!entry) {
    return <span className="block text-[11px] text-ink-subtle">No slot</span>;
  }
  const player = entry.player;
  if (!player) {
    return (
      <span
        className={`block min-h-11 py-1.5 text-xs text-ink-subtle ${
          align === "end" ? "text-right" : ""
        }`}
      >
        Empty
      </span>
    );
  }

  const points = isFinal ? player.actual : player.projected;
  const opponent = opponentLabel(player.nflOpponent, player.nflIsHome);

  return (
    <button
      type="button"
      onClick={() => onOpen(player)}
      aria-haspopup="dialog"
      aria-label={spokenPlayer(player, isFinal)}
      className={`flex min-h-11 w-full items-start gap-2 rounded-card px-1 py-1.5 text-left transition-colors hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
        align === "end" ? "flex-row-reverse text-right" : ""
      }`}
    >
      {/* PORTRAIT ABOVE THE NAME ON A PHONE, beside it from sm up.
          At 360px the headshot, the name and the meta line were fighting over
          about 140px of cell, so the name truncated to two or three characters
          and the meta line wrapped to three rows. Stacking the portrait buys the
          full cell width back for the text, which is what lets the position,
          team and opponent sit on one line as one string. The away side stacks
          right-aligned and reverses at sm, so the portrait stays on the outside
          edge and the numbers stay on the inside one. */}
      <span
        className={`flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:gap-2 ${
          align === "end" ? "items-end sm:flex-row-reverse" : "items-start"
        }`}
      >
        {/* Two renders rather than one responsive element: the size is an inline
            width and height on the image, which a Tailwind class cannot
            override. Both are decorative, since the name is the text beside
            them. */}
        <span className="shrink-0 sm:hidden">
          <PlayerHeadshot sleeperId={player.sleeperId} name="" size={28} />
        </span>
        <span className="hidden shrink-0 sm:block">
          <PlayerHeadshot sleeperId={player.sleeperId} name="" size={32} />
        </span>

        <span aria-hidden="true" className="block min-w-0 max-w-full flex-1">
          <span className="block truncate text-xs font-semibold text-ink sm:text-sm">
            {player.name}
          </span>
          {/* One string, not three spans in a wrapping row. Position, team and
              opponent belong together and the parentheses around the opponent
              are what keep "WR, BUF (@ HOU)" readable as one fact. */}
          <span className="mt-0.5 block truncate text-[11px] text-ink-muted">
            {player.position}
            {player.team ? `, ${player.team}` : ""} {opponent}
          </span>
          {isFinal && player.projected !== null && (
            <span className="mt-0.5 block truncate text-[11px] text-ink-subtle">
              {fmtPoints(player.projected)} proj
            </span>
          )}
          {player.injuryStatus && (
            <span className={`mt-1 ${CHIP} border-signal-warning/50 text-signal-warning`}>
              {player.injuryStatus}
            </span>
          )}
        </span>
      </span>

      {/* THE SCORE, PUSHED TO THE INNER EDGE.
          This is the number the reader is actually comparing, so it is the
          largest thing in the cell and it sits as close to the slot label as the
          layout allows. That falls out of the flex direction for free: the home
          cell runs left to right and this is its last child, the away cell is
          row-reverse and this is still its last child, so on both sides the
          number lands against the middle column. Two names and two scores in a
          row now read as one comparison rather than four separate readings, and
          scrolling the table compares like against like down a single axis. */}
      <span
        aria-hidden="true"
        className={`shrink-0 self-center font-mono font-bold tabular-nums ${
          points === null ? "text-[10px] text-ink-subtle" : "text-lg text-ink sm:text-xl"
        }`}
      >
        {points === null
          ? // A played week with no number is missing a RESULT, not a forecast,
            // and "no projection" would send a reader looking for the wrong thing.
            isFinal
            ? "No score"
            : "No proj"
          : fmtPoints(points)}
      </span>
    </button>
  );
}

/**
 * The accessible name for a player cell.
 *
 * Position and team stay as the codes we hold; inventing "Buffalo Bills" from
 * "BUF" would mean shipping a mapping table nobody maintains. A final week says
 * what was scored first and the projection second, because on a played week the
 * result is the fact and the projection is the footnote.
 */
function spokenPlayer(player: SchedulePlayer, isFinal: boolean): string {
  const parts: string[] = [player.name, player.position];
  if (player.team) parts.push(player.team);
  parts.push(opponentWords(player.nflOpponent, player.nflIsHome));

  if (isFinal) {
    parts.push(
      player.actual === null
        ? "no score recorded"
        : `scored ${fmtPoints(player.actual)} points`,
    );
    if (player.projected !== null) {
      parts.push(`projected ${fmtPoints(player.projected)}`);
    }
  } else {
    parts.push(
      player.projected === null
        ? "no projection published"
        : `projected ${fmtPoints(player.projected)} points`,
    );
  }

  if (player.injuryStatus) parts.push(player.injuryStatus);
  return `${parts.join(", ")}. Open details.`;
}

/**
 * One footer figure for both sides.
 *
 * The label sits in the middle column as the row header, matching the slot
 * column above it, so the footer reads with the same left, middle, right rhythm
 * as the body instead of restarting the table.
 *
 * Both figures name the label id and their own column id in `headers`. Without
 * it the home figure inherits nothing, and the four footer rows read to a
 * screen reader in table navigation as four bare numbers: the one place on this
 * page where a cell has no words of its own to fall back on.
 */
function TotalRow({
  label,
  rowId,
  homeColId,
  awayColId,
  homeValue,
  awayValue,
  hasAway,
  emphasis = false,
  secondary = false,
  signed = false,
}: {
  label: string;
  /** Id for this row's label cell, unique within the document. */
  rowId: string;
  homeColId: string;
  awayColId: string;
  homeValue: number | null;
  awayValue: number | null;
  hasAway: boolean;
  /** The headline total. Exactly one row in the footer gets this. */
  emphasis?: boolean;
  /**
   * A supporting figure. Quieter type, and the first one carries the rule that
   * separates the working from the headline above it.
   */
  secondary?: boolean;
  signed?: boolean;
}) {
  const figure = emphasis
    ? "text-xl font-extrabold text-ink sm:text-2xl"
    : "text-xs font-semibold text-ink-subtle";
  const rowTone = emphasis
    ? "bg-brand-cyan/[0.06]"
    : secondary
      ? "border-t border-line/60"
      : "";

  const render = (value: number | null, align: "left" | "right") => (
    <td
      headers={`${align === "right" ? awayColId : homeColId} ${rowId}`}
      className={`px-2 ${emphasis ? "py-2.5" : "py-1.5"} font-mono tabular-nums ${
        align === "right" ? "text-right" : "text-left"
      } ${figure}`}
    >
      {value === null ? (
        <span className="font-sans text-[11px] font-normal text-ink-subtle">
          Not available
        </span>
      ) : (
        `${signed && value > 0 ? "+" : ""}${fmtPoints(value)}`
      )}
    </td>
  );

  return (
    <tr className={rowTone}>
      {render(homeValue, "left")}
      <th
        id={rowId}
        scope="row"
        className={`w-14 px-1 text-center font-bold uppercase tracking-wide ${
          emphasis
            ? "py-2.5 text-[11px] text-brand-cyan"
            : "py-1.5 text-[10px] text-ink-subtle"
        }`}
      >
        {label}
      </th>
      {hasAway && render(awayValue, "right")}
    </tr>
  );
}
