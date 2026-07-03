/**
 * The side-by-side breakdown table. Each category is a labeled row with Player
 * A on the left, the category in the middle, and Player B on the right; the
 * winning side is tinted and carries an "Edge" badge. On mobile the row stacks:
 * the category heads a card and the two players sit in a 2-up grid beneath it,
 * so no data is ever hidden. Server component.
 */

import { BeaconValue } from "@/components/beacon-value-icon";
import type { BreakdownPlayer, BreakdownRow } from "@/lib/beacon-breakdown";

export function BreakdownTable({
  a,
  b,
  rows,
}: {
  a: BreakdownPlayer;
  b: BreakdownPlayer;
  rows: BreakdownRow[];
}) {
  return (
    <div>
      {/* Sticky-feeling header naming the two columns (desktop only; on mobile
          each card repeats the player labels). */}
      <div
        className="hidden grid-cols-[1fr_11rem_1fr] gap-3 border-b border-line pb-2 sm:grid"
        aria-hidden="true"
      >
        <p className="text-center text-sm font-semibold text-brand-purple">{a.name}</p>
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          Category
        </p>
        <p className="text-center text-sm font-semibold text-brand-cyan">{b.name}</p>
      </div>

      <div className="divide-y divide-line/60">
        {rows.map((row) => (
          <RowView key={row.key} row={row} a={a} b={b} />
        ))}
      </div>
    </div>
  );
}

function RowView({
  row,
  a,
  b,
}: {
  row: BreakdownRow;
  a: BreakdownPlayer;
  b: BreakdownPlayer;
}) {
  return (
    <div
      role="group"
      aria-label={row.label}
      className="py-3 sm:grid sm:grid-cols-[1fr_11rem_1fr] sm:items-stretch sm:gap-3"
    >
      {/* Category. Mobile: top of card. Desktop: centered middle column. */}
      <div className="mb-2 text-center sm:order-2 sm:mb-0 sm:flex sm:flex-col sm:justify-center">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-cyan">
          {row.label}
        </p>
        <p className="mt-0.5 hidden text-[11px] leading-snug text-ink-subtle sm:block">
          {row.help}
        </p>
        {row.winner === "even" && (
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
            Even
          </p>
        )}
        {row.winner === "na" && (
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
            No data
          </p>
        )}
      </div>

      {/* Player cells. `sm:contents` dissolves this wrapper on desktop so the
          two cells drop into the parent 3-column grid around the category. */}
      <div className="grid grid-cols-2 gap-2 sm:contents">
        <Cell
          side="a"
          playerName={a.name}
          display={row.aDisplay}
          note={row.aNote}
          isWinner={row.winner === "a"}
          valueIsBeacon={row.valueIsBeacon}
          className="sm:order-1"
        />
        <Cell
          side="b"
          playerName={b.name}
          display={row.bDisplay}
          note={row.bNote}
          isWinner={row.winner === "b"}
          valueIsBeacon={row.valueIsBeacon}
          className="sm:order-3"
        />
      </div>
    </div>
  );
}

function Cell({
  side,
  playerName,
  display,
  note,
  isWinner,
  valueIsBeacon,
  className = "",
}: {
  side: "a" | "b";
  playerName: string;
  display: string;
  note?: string;
  isWinner: boolean;
  valueIsBeacon?: boolean;
  className?: string;
}) {
  const winnerClass = isWinner
    ? side === "a"
      ? "border-brand-purple/50 bg-brand-purple/10"
      : "border-brand-cyan/50 bg-brand-cyan/10"
    : "border-line/60 bg-base/40";
  const edgeTextClass = side === "a" ? "text-brand-purple" : "text-brand-cyan";

  const showBeacon = Boolean(valueIsBeacon) && display !== "-";

  return (
    <div
      className={`flex min-h-[3.25rem] flex-col justify-center rounded-card border px-3 py-2 text-center ${winnerClass} ${className}`}
    >
      {/* Screen-reader label so each value is attributed to its player. */}
      <span className="sr-only">
        {playerName}
        {isWinner ? ", edge" : ""}:{" "}
      </span>
      <p className="font-mono text-[15px] font-semibold tabular-nums text-ink sm:text-[1rem]">
        {showBeacon ? <BeaconValue show>{display}</BeaconValue> : display}
      </p>
      {note && <p className="mt-0.5 text-[11px] text-ink-subtle">{note}</p>}
      {isWinner && (
        <p className={`mt-1 inline-flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wide ${edgeTextClass}`}>
          <span aria-hidden="true">◆</span> Edge
        </p>
      )}
    </div>
  );
}
