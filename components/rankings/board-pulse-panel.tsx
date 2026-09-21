/**
 * The state of the board in four figures, above the table.
 *
 * A 500-row table answers "where does this player rank" and nothing else. A
 * reader arriving cold cannot see whether the market moved over the last
 * month, which way, or where the board's one real cliff is, and all three are
 * in the rows already. This strip says them.
 *
 * The window is 30 days because that is what the table's movement columns
 * are. A week above a month would be two periods on one screen with nothing
 * saying they differ.
 *
 * Every figure is derived, not fetched: `lib/rankings/insights.ts boardPulse`
 * reads the same rows the table renders. Nothing here can disagree with the
 * table, because it is the table's own data counted up.
 *
 * Presentational server component. The counts are a `<dl>` so a screen reader
 * gets term and definition rather than four loose numbers, and each figure's
 * unit is in its own text rather than implied by a neighbouring label.
 */

import Link from "next/link";
import { ArrowDown, ArrowUp, Minus, MoveDown } from "lucide-react";
import type { BoardPulse } from "@/lib/rankings/insights";

function Tile({
  label,
  children,
  detail,
}: {
  label: string;
  children: React.ReactNode;
  detail?: string;
}) {
  return (
    <div className="rounded-card border border-line bg-base/50 px-3.5 py-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold leading-snug text-ink">
        {children}
        {detail && (
          <span className="mt-0.5 block text-xs font-normal leading-relaxed text-ink-muted">
            {detail}
          </span>
        )}
      </dd>
    </div>
  );
}

export function BoardPulsePanel({ pulse }: { pulse: BoardPulse }) {
  // With no readable window there is nothing honest to put here. An empty
  // strip of zeroes would read as "nothing moved", which is a claim about the
  // market rather than about our history.
  if (pulse.withWindow === 0 && !pulse.cliff) return null;

  return (
    <dl className="mb-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {pulse.withWindow > 0 && (
        <>
          <Tile
            label="Gained value, 30d"
            detail={`of ${pulse.withWindow.toLocaleString()} with a full 30 days`}
          >
            <span className="inline-flex items-center gap-1.5 text-signal-positive">
              <ArrowUp aria-hidden="true" className="h-4 w-4" />
              <span className="font-mono tabular-nums">
                {pulse.rising.toLocaleString()}
              </span>
              <span className="sr-only">players</span>
            </span>
          </Tile>
          <Tile
            label="Lost value, 30d"
            detail={`${pulse.holding.toLocaleString()} held roughly steady`}
          >
            <span className="inline-flex items-center gap-1.5 text-signal-warning">
              <ArrowDown aria-hidden="true" className="h-4 w-4" />
              <span className="font-mono tabular-nums">
                {pulse.falling.toLocaleString()}
              </span>
              <span className="sr-only">players</span>
            </span>
          </Tile>
        </>
      )}

      {pulse.biggestRiser ? (
        <Tile
          label="Biggest climber, 30d"
          detail={`${pulse.biggestRiser.position}${pulse.biggestRiser.team ? `, ${pulse.biggestRiser.team}` : ""}`}
        >
          <Link
            href={`/players/${pulse.biggestRiser.slug}`}
            className="hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            {pulse.biggestRiser.name}
          </Link>{" "}
          <span className="font-mono text-xs tabular-nums text-signal-positive">
            +{pulse.biggestRiser.pct.toFixed(1)}%
          </span>
        </Tile>
      ) : (
        pulse.withWindow > 0 && (
          <Tile
            label="Biggest climber, 30d"
            detail="No player gained value over the last 30 days"
          >
            <span className="inline-flex items-center gap-1.5 text-ink-muted">
              <Minus aria-hidden="true" className="h-4 w-4" />
              None
            </span>
          </Tile>
        )
      )}

      {pulse.cliff && (
        <Tile
          label="Steepest cliff"
          detail={`Tier ${pulse.cliff.tier} down to tier ${pulse.cliff.tier + 1}`}
        >
          <span className="inline-flex items-center gap-1.5">
            <MoveDown aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
            <span>{pulse.cliff.position}</span>
            <span className="font-mono text-xs tabular-nums text-ink-muted">
              -{Math.round(pulse.cliff.drop).toLocaleString()}
            </span>
          </span>
        </Tile>
      )}
    </dl>
  );
}
