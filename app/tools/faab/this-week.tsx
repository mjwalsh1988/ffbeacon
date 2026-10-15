/**
 * This week's wire, on the FAAB calculator page.
 *
 * Five players from the live week's waiver board, each with the bid range the
 * board prices him at and the one sentence saying why he is on it. The point
 * is a page that changes every Tuesday in its server-rendered HTML, without
 * touching the title or the description that already rank (see the comment
 * above META_TITLE in page.tsx). Plan of record:
 * docs/seo-audit/gsc-growth-plan-2026-10-15.md, section 4.1.
 *
 * NO MODEL OF ITS OWN. The format, source and settings come from
 * `resolveWaiverContext`, the same resolution the waiver week pages use, and
 * the rows are `loadWaiverBoardCached`'s, in the board's own order. The bid is
 * printed with the waiver page's own `BidFigure`, so the two pages cannot
 * print the same claim differently.
 *
 * NEVER AN EMPTY PANEL. Outside the season, outside weeks 1 to 18, on a board
 * that reports why it is empty, or with fewer than three rows, this renders
 * nothing. A failed read renders nothing too: the calculator above it must
 * never depend on this block.
 */

import Link from "next/link";
import { createCachedReadClient } from "@/lib/supabase/server";
import { resolveSeasonClock } from "@/lib/start-sit/clock";
import { loadWaiverBoardCached } from "@/lib/waiver-wire/load";
import { resolveWaiverContext, type WaiverContext } from "@/lib/waiver-wire/context";
import { weekPath } from "@/lib/waiver-wire/weeks";
import type { FaabSettings } from "@/lib/faab/types";
import { positionHeading } from "@/lib/site";
import { nflTeamName } from "@/lib/nfl-teams";
import { BidFigure } from "@/components/waiver-wire/player-card";

const SHOWN = 5;
const MIN_ROWS = 3;
const COUNT_WORDS: Record<number, string> = { 3: "three", 4: "four", 5: "five" };

const LINK_CLASS =
  "font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80";

/**
 * The block for the reader in front of the page: resolves their format and
 * source exactly as a waiver week page does, then draws the board. Resolving
 * here, inside the Suspense boundary, keeps even those reads off the
 * calculator's critical path.
 */
export async function ThisWeekWireForReader({
  params,
}: {
  params: { format?: string; source?: string };
}) {
  let context: WaiverContext;
  try {
    context = await resolveWaiverContext(params);
  } catch (error) {
    console.error("[faab] this week's wire context failed", error);
    return null;
  }
  return (
    <ThisWeekWire
      format={context.format}
      sourceSlug={context.sourceSlug}
      sourceName={context.sourceName}
      settings={context.settings}
    />
  );
}

export async function ThisWeekWire({
  format,
  sourceSlug,
  sourceName,
  settings,
}: {
  format: WaiverContext["format"];
  sourceSlug: string | null;
  sourceName: string;
  settings: FaabSettings;
}) {
  if (!format || !sourceSlug) return null;

  let board;
  let week: number;
  try {
    const clock = await resolveSeasonClock(createCachedReadClient());
    if (clock.season == null || clock.currentWeek < 1 || clock.currentWeek > 18) return null;
    week = clock.currentWeek;
    board = await loadWaiverBoardCached({ week, format, sourceSlug, sourceName, settings });
  } catch (error) {
    console.error("[faab] this week's wire failed", error);
    return null;
  }
  if (board.emptyReason !== null || board.rows.length < MIN_ROWS) return null;

  const rows = board.rows.slice(0, SHOWN);
  const headingId = "faab-this-week-heading";

  return (
    <section aria-labelledby={headingId} className="mt-12">
      <h2
        id={headingId}
        className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
      >
        Week {week} waiver wire: the {COUNT_WORDS[rows.length]} claims most worth pricing
      </h2>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-muted">
        Priced for {board.assumptions.formatName} leagues with {board.assumptions.sourceName}{" "}
        values, as a share of the season budget.
      </p>
      <ol role="list" className="mt-5 space-y-3">
        {rows.map((row, index) => (
          <li key={row.playerId} className="rounded-card border border-line bg-surface/40 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-ink">
                {/* The order is the board's, so it is printed, not left to
                    list markers Tailwind removes. */}
                <span className="mr-2 font-mono text-sm tabular-nums text-ink-subtle">
                  {index + 1}.
                </span>
                <Link
                  href={`/players/${row.slug}`}
                  className="inline-flex min-h-11 items-center font-semibold text-ink underline-offset-2 hover:text-brand-cyan hover:underline"
                >
                  {row.name}
                </Link>{" "}
                <span className="text-sm text-ink-muted">
                  {positionHeading(row.position, "singular")},{" "}
                  {row.team ? (nflTeamName(row.team) ?? row.team) : "free agent"}
                </span>
              </p>
              <p className="text-sm text-ink-muted">
                {row.bid ? (
                  <>
                    Bid{" "}
                    <span className="font-mono font-semibold tabular-nums text-ink">
                      <BidFigure bid={row.bid} />
                    </span>{" "}
                    of the budget
                  </>
                ) : (
                  "No bid estimate yet"
                )}
              </p>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">{row.reason}</p>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-sm leading-relaxed text-ink-muted">
        Every other name, with the same bid ranges, is on{" "}
        <Link href={weekPath(week)} className={LINK_CLASS}>
          the full week {week} waiver wire
        </Link>
        .
      </p>
    </section>
  );
}
