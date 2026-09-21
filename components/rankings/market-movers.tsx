/**
 * Who the market bought and who it sold, over a week and over a month.
 *
 * The board has carried a 7-day column since it shipped, but a reader has to
 * sort 500 rows by it to find out who moved, and the 30-day figures were
 * fetched and thrown away. This is the panel every rankings site has and this
 * one did not.
 *
 * BOTH WINDOWS, SIDE BY SIDE, ON PURPOSE. A week is usually one piece of news
 * and reverses as often as not; a month is a direction. A player who is down
 * on the week and up on the month is the buy the week alone would have talked
 * a reader out of, so hiding either window behind a toggle would hide exactly
 * the disagreement worth seeing. Both render at every width: on a phone the
 * four lists stack, and no list is dropped.
 *
 * Presentational server component. Everything comes from
 * `lib/rankings/insights.ts topMovers`, which reads the rows the table is
 * already rendering, so there is no extra query and no way for this panel to
 * contradict the board under it.
 */

import Link from "next/link";
import { ArrowDown, ArrowUp, TrendingUp } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import type { Mover, Movers } from "@/lib/rankings/insights";

function MoverList({
  movers,
  direction,
  headingId,
  heading,
}: {
  movers: Mover[];
  direction: "up" | "down";
  headingId: string;
  heading: string;
}) {
  const up = direction === "up";
  const tone = up ? "text-signal-positive" : "text-signal-warning";
  const Icon = up ? ArrowUp : ArrowDown;

  return (
    <div className="min-w-0">
      <h4
        id={headingId}
        className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle"
      >
        <Icon aria-hidden="true" className={`h-3.5 w-3.5 ${tone}`} />
        {heading}
      </h4>
      {movers.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">
          Nothing moved {up ? "up" : "down"} enough to list.
        </p>
      ) : (
        <ol aria-labelledby={headingId} role="list" className="mt-2 space-y-1">
          {movers.map((mover) => (
            <li key={mover.slug}>
              <Link
                href={`/players/${mover.slug}`}
                className="group flex min-h-11 items-center gap-2.5 rounded-card px-2 py-1.5 transition-colors hover:bg-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <PlayerHeadshot
                  sleeperId={mover.sleeper_id}
                  position={mover.position}
                  name={mover.name}
                  size={28}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink group-hover:text-brand-cyan">
                    {mover.name}
                  </span>
                  <span className="block text-[11px] leading-tight text-ink-subtle">
                    {mover.position}
                    {mover.team ? `, ${mover.team}` : ""}
                    {mover.rankChange !== null && mover.rankChange !== 0
                      ? `, ${mover.rankChange > 0 ? "up" : "down"} ${Math.abs(mover.rankChange)} ${Math.abs(mover.rankChange) === 1 ? "place" : "places"}`
                      : ""}
                  </span>
                </span>
                <span
                  className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${tone}`}
                >
                  {mover.pct > 0 ? "+" : ""}
                  {mover.pct.toFixed(1)}%
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function WindowColumn({
  movers,
  windowLabel,
  idPrefix,
  note,
}: {
  movers: Movers;
  windowLabel: string;
  idPrefix: string;
  note: string;
}) {
  return (
    <section
      aria-labelledby={`${idPrefix}-heading`}
      className="min-w-0 rounded-card border border-line bg-base/40 p-4"
    >
      <h3
        id={`${idPrefix}-heading`}
        className="text-sm font-semibold tracking-tight text-ink"
      >
        {windowLabel}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{note}</p>
      <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-1 lg:gap-4">
        <MoverList
          movers={movers.risers}
          direction="up"
          headingId={`${idPrefix}-risers`}
          heading="Bought"
        />
        <MoverList
          movers={movers.fallers}
          direction="down"
          headingId={`${idPrefix}-fallers`}
          heading="Sold"
        />
      </div>
    </section>
  );
}

export function MarketMovers({
  week,
  month,
  cadence,
}: {
  week: Movers;
  month: Movers;
  cadence: "daily" | "weekly" | undefined;
}) {
  // Nothing to say with no readable history either way. Rendering two empty
  // columns would imply a flat market rather than a short one.
  if (week.considered === 0 && month.considered === 0) return null;

  const weekly = cadence === "weekly";

  return (
    <section
      aria-labelledby="market-movers-heading"
      className="mb-6 overflow-hidden rounded-card border border-line bg-surface p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="market-movers-heading"
          className="flex items-center gap-2 text-base font-semibold tracking-tight text-ink"
        >
          <TrendingUp aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
          Market movers
        </h2>
        <p className="text-xs text-ink-muted">
          The deepest part of the board is left out, where a four-point week
          reads as twelve percent.
        </p>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {week.considered > 0 && (
          <WindowColumn
            movers={week}
            idPrefix="movers-week"
            windowLabel="Last 7 days"
            note={
              weekly
                ? "One publishing cycle. Usually a single piece of news."
                : "Usually a single piece of news, and it reverses about as often as it holds."
            }
          />
        )}
        {month.considered > 0 && (
          <WindowColumn
            movers={month}
            idPrefix="movers-month"
            windowLabel="Last 30 days"
            note="The direction rather than the headline. This is the window to trust when you are deciding whether to buy."
          />
        )}
      </div>
    </section>
  );
}
