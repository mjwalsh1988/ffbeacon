/**
 * This week's wire, on the FAAB calculator page.
 *
 * Five players from the live week's waiver board, each as a profile card: the
 * headshot ringed in his position's color, his team's logo, the bid range the
 * board prices him at as the largest figure on the card, three measured
 * figures, and the one sentence saying why he is on it. The first card is the
 * board's top claim and is drawn larger, with the bid panel beside the profile;
 * the rest sit in a grid under it. The point is a page that changes every
 * Tuesday in its server-rendered HTML, without touching the title or the
 * description that already rank (see the comment above META_TITLE in
 * page.tsx). Plan of record: docs/completed/seo-audit/gsc-growth-plan-2026-10-15.md,
 * section 4.1.
 *
 * NO MODEL OF ITS OWN. The format, source and settings come from
 * `resolveWaiverContext`, the same resolution the waiver week pages use, and
 * the rows are `loadWaiverBoardCached`'s, in the board's own order. The bid,
 * the tier pill, the meter and the gradient the figure is drawn in are the
 * waiver page's own (`components/waiver-wire/player-card.tsx`), so the two
 * pages cannot print the same claim differently.
 *
 * NEVER AN EMPTY PANEL. Outside the season, outside weeks 1 to 18, on a board
 * that reports why it is empty, or with fewer than three rows, this renders
 * nothing. A failed read renders nothing too: the calculator above it must
 * never depend on this block.
 *
 * NOTHING VISIBLE IS aria-hidden except decoration: the headshot and the logo
 * (the name and the team are printed beside them), the icons, the glow and the
 * bid meter (its numbers are printed above it). Every figure is one text node
 * with only the missing words appended as sr-only inside the same element.
 *
 * ONE LINK, THE WHOLE CARD. The name is the only link and it is stretched over
 * the card, so the tap target is the card rather than one line of text.
 */

import Link from "next/link";
import { ArrowRight, Flame, Target, TrendingUp, Users, type LucideIcon } from "lucide-react";
import { createCachedReadClient } from "@/lib/supabase/server";
import { resolveSeasonClock } from "@/lib/start-sit/clock";
import { loadWaiverBoardCached } from "@/lib/waiver-wire/load";
import { resolveWaiverContext, type WaiverContext } from "@/lib/waiver-wire/context";
import { weekPath } from "@/lib/waiver-wire/weeks";
import type { BoardPosition, BoardRow } from "@/lib/waiver-wire/types";
import type { FaabSettings } from "@/lib/faab/types";
import { OFFENSE_POSITIONS, positionNounMap } from "@/lib/site";
import { nflTeamName } from "@/lib/nfl-teams";
import { PlayerHeadshot } from "@/components/player-headshot";
import { NflTeamLogo } from "@/components/nfl-team-logo";
import {
  BIDDERS_TEXT,
  BID_TEXT_CLASS,
  BID_TEXT_STYLE,
  BidFigure,
  BidMeter,
  POSITION_HEX,
  TierPill,
  bidSpoken,
} from "@/components/waiver-wire/player-card";

const SHOWN = 5;
const MIN_ROWS = 3;
const COUNT_WORDS: Record<number, string> = { 3: "three", 4: "four", 5: "five" };

/**
 * Grid columns, sized to how many cards follow the featured one so the grid
 * never ends on a half-empty row. The featured card spans every column. One
 * flat list on purpose: "item 2 of 5" and the badge's "2" then agree, where a
 * nested list for the rest would have put the second card at "item 1 of 4".
 * Literal class strings, because Tailwind only generates the classes it can
 * read.
 */
const GRID_COLS: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

const POSITION_WORD: Record<BoardPosition, string> = positionNounMap(OFFENSE_POSITIONS, {
  short: ["DEF"],
});

const CARD_SURFACE =
  "radial-gradient(120% 140% at 0% 0%, #1B1B33 0%, #12121F 45%, #0B0B14 100%)";

function one(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function whole(n: number): string {
  return String(Math.round(n));
}

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
  const [lead, ...rest] = rows;
  const headingId = "faab-this-week-heading";

  return (
    <section aria-labelledby={headingId} className="mt-12">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-purple/50 bg-brand-purple/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-purple-light">
          <Flame aria-hidden="true" className="h-3 w-3" />
          Waiver wire
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
          Refreshed every waiver week
        </span>
      </div>
      <h2
        id={headingId}
        className="mt-3 text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
      >
        Week {week} waiver wire: the {COUNT_WORDS[rows.length]} claims most worth pricing
      </h2>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-muted">
        Priced for {board.assumptions.formatName} leagues with {board.assumptions.sourceName}{" "}
        values, as a share of the season budget. The order is the board&apos;s own.
      </p>

      <ol role="list" className={`mt-6 grid gap-3 sm:gap-4 ${GRID_COLS[rest.length] ?? ""}`}>
        <WireCard row={lead} index={1} featured />
        {rest.map((row, i) => (
          <WireCard key={row.playerId} row={row} index={i + 2} featured={false} />
        ))}
      </ol>

      <p className="mt-5">
        <Link
          href={weekPath(week)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/50 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Every name on the full week {week} waiver wire
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </p>
    </section>
  );
}

/**
 * One measured figure: the label is the dt, the figure the dd. A tile on the
 * featured card, where there is room for three abreast; a label-and-value row
 * on a compact card, whose column is about 230 pixels at four across and
 * cannot fit three tiles without wrapping every word of the detail.
 */
function Stat({
  icon: Icon,
  label,
  value,
  srSuffix,
  detail,
  accent = false,
  row = false,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  srSuffix?: string;
  detail?: string;
  accent?: boolean;
  row?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded-xl border border-line/70 bg-base/60 backdrop-blur-sm ${
        row ? "flex items-start justify-between gap-2 px-2.5 py-1.5" : "px-2.5 py-2"
      }`}
    >
      <dt
        className={`flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-subtle ${
          row ? "pt-0.5" : ""
        }`}
      >
        <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
        <span className="min-w-0 leading-tight">{label}</span>
      </dt>
      <dd
        className={`min-w-0 font-mono font-bold leading-tight tabular-nums ${
          accent ? "text-brand-cyan" : "text-ink"
        } ${row ? "text-right text-[15px]" : "mt-0.5 text-base sm:text-lg"}`}
      >
        {value}
        {srSuffix && <span className="sr-only"> {srSuffix}</span>}
        {detail && (
          <span className="mt-0.5 block font-sans text-[10.5px] font-normal leading-tight text-ink-subtle">
            {detail}
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * The budget panel: what to spend, as the largest figure on the card. The
 * percentage is the headline because a public page cannot see the reader's
 * budget; the calculator above converts it for their league.
 */
function BudgetPanel({ row, featured }: { row: BoardRow; featured: boolean }) {
  const { bid, market } = row;
  if (!bid) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-base/40 px-4 py-3 text-sm leading-snug text-ink-muted">
        No market read yet, so no bid estimate.
      </div>
    );
  }
  const claimed = market && market.auctions >= 2;
  return (
    <div className="relative rounded-2xl border border-brand-cyan/30 bg-base/70 p-3.5 shadow-[0_20px_60px_-30px_rgba(34,211,238,0.6)] backdrop-blur-sm sm:p-4">
      {/* flex-wrap, so a narrow card drops the pill under the label rather
          than breaking "Suggested bid" across two lines. */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.16em] text-brand-cyan">
          Suggested bid
        </p>
        <TierPill bid={bid} />
      </div>
      <p
        className={`${BID_TEXT_CLASS} mt-2 leading-none ${
          featured ? "text-5xl sm:text-6xl" : "text-4xl"
        }`}
        style={BID_TEXT_STYLE}
      >
        <BidFigure bid={bid} />
        <span className="sr-only"> {bidSpoken(bid, market)}</span>
      </p>
      <BidMeter bid={bid} market={market} className="mt-3" />
      <p className="mt-2 text-xs leading-snug text-ink-subtle">
        of your season budget. {BIDDERS_TEXT[bid.bidders]}.
      </p>
      {claimed && (
        <p className="mt-1 text-xs leading-snug text-ink-subtle">
          Claimed in {market.leagues} {market.leagues === 1 ? "league" : "leagues"}, median{" "}
          {whole(market.p50)}% of budget.
        </p>
      )}
    </div>
  );
}

function WireCard({
  row,
  index,
  featured,
}: {
  row: BoardRow;
  /** 1-based position on the board, for the badge and the spoken order. */
  index: number;
  featured: boolean;
}) {
  const hue = POSITION_HEX[row.position];
  const headingId = `faab-wire-${row.playerId}`;
  const teamName = row.team ? (nflTeamName(row.team) ?? row.team) : null;
  const { projection, rosterRate } = row;
  const par = row.pointsAboveReplacement;
  const photo = featured ? 88 : 56;

  return (
    <li className={featured ? "col-span-full min-w-0" : "min-w-0"}>
      <article
        aria-labelledby={headingId}
        className="group relative h-full rounded-3xl p-px transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        style={{
          backgroundImage: `linear-gradient(135deg, ${hue} 0%, rgba(168,85,247,0.55) 50%, rgba(34,211,238,0.55) 100%)`,
        }}
      >
        <div
          className="relative h-full overflow-hidden rounded-[calc(1.5rem-1px)] p-4 sm:p-5"
          style={{ background: CARD_SURFACE }}
        >
          {/* Position-colored light in the corner. Decoration only, and
              pointer-events-none so a pointer over it still finds the card. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-25 blur-3xl transition-opacity group-hover:opacity-40"
            style={{ background: hue }}
          />

          {/* DOM order is name, bid, figures, reason on every card. The
              featured card moves the bid panel into a right-hand column from
              lg up with grid placement, so the spoken order never changes. */}
          <div
            className={
              featured
                ? "relative grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-x-6"
                : "relative flex h-full flex-col gap-3.5"
            }
          >
            <div className="flex min-w-0 items-start gap-3 sm:gap-4">
              <span className="relative shrink-0">
                {/* The photo is decorative: the name is the heading beside it. */}
                <span
                  aria-hidden="true"
                  className="block rounded-xl p-[3px] shadow-[0_0_32px_-8px_var(--hue)]"
                  style={{
                    backgroundImage: `linear-gradient(140deg, ${hue} 0%, #A855F7 100%)`,
                    ["--hue" as string]: hue,
                  }}
                >
                  <span className="block overflow-hidden rounded-[9px] bg-base">
                    <PlayerHeadshot sleeperId={row.sleeperId} name="" size={photo} />
                  </span>
                </span>
                {/* The rank badge is real text, once, with its missing words
                    inside the same element: a pointer landing on it hears
                    "Number 2 on the board" rather than silence. */}
                <span
                  className="absolute -left-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-[#12121F] px-1.5 font-mono text-[11px] font-bold text-[#07070D]"
                  style={{ background: hue }}
                >
                  <span className="sr-only">Number </span>
                  {index}
                  <span className="sr-only"> on the board</span>
                </span>
              </span>

              <div className="min-w-0 flex-1">
                <h3
                  id={headingId}
                  className={`break-words font-bold tracking-tight text-ink ${
                    featured ? "text-2xl sm:text-3xl" : "text-lg"
                  }`}
                >
                  <Link
                    href={`/players/${row.slug}`}
                    className="underline-offset-4 after:absolute after:inset-0 after:z-[1] after:rounded-[calc(1.5rem-1px)] after:content-[''] hover:text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  >
                    {row.name}
                  </Link>
                </h3>
                <p
                  className={`mt-1.5 flex text-ink-muted ${
                    featured
                      ? "flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                      : "flex-col items-start gap-1 text-xs"
                  }`}
                >
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold"
                    style={{ background: `${hue}26`, color: hue }}
                  >
                    {row.position}
                    {row.positionRank}
                    <span className="sr-only">
                      , ranked {row.positionRank} at {POSITION_WORD[row.position]} in this format
                    </span>
                  </span>
                  {teamName ? (
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <NflTeamLogo team={row.team} size={featured ? 22 : 18} />
                      <span className="min-w-0 break-words">{teamName}</span>
                    </span>
                  ) : (
                    <span>Free agent</span>
                  )}
                </p>
              </div>
            </div>

            <div className={featured ? "lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-start" : ""}>
              <BudgetPanel row={row} featured={featured} />
            </div>

            {/* The featured tiles go three abreast from 420 pixels; a 360
                pixel phone gives each about 95, where the detail line wraps
                to three lines, so they stack there instead. */}
            <dl
              className={
                featured
                  ? "grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-3 sm:gap-2"
                  : "grid grid-cols-1 gap-1.5"
              }
            >
              <Stat
                row={!featured}
                icon={Target}
                label="This week"
                value={projection ? one(projection.points) : "None"}
                srSuffix={projection ? "projected points" : "published"}
                detail={projection?.opponent ? `vs ${projection.opponent}` : "No opponent yet"}
              />
              <Stat
                row={!featured}
                icon={Users}
                label="Rostered"
                value={rosterRate?.pct == null ? "No data" : `${whole(rosterRate.pct)}%`}
                srSuffix={rosterRate?.pct == null ? "for how widely he is rostered" : undefined}
                detail={rosterRate ? `of ${rosterRate.total} leagues` : undefined}
                accent={rosterRate?.pct != null && rosterRate.pct < 25}
              />
              <Stat
                row={!featured}
                icon={TrendingUp}
                label="Over starter"
                value={
                  par == null ? (
                    "Unknown"
                  ) : par > 0 ? (
                    <>
                      {/* The sign is hidden and spoken, the BidFigure pattern:
                          a bare "+" is dropped by a screen reader at its
                          default symbol level. */}
                      <span aria-hidden="true">+</span>
                      <span className="sr-only">plus </span>
                      {one(par)}
                    </>
                  ) : (
                    one(par)
                  )
                }
                srSuffix={par == null ? "without a projection to compare" : "points"}
                detail={`vs the last startable ${POSITION_WORD[row.position]}`}
                accent={par != null && par > 0}
              />
            </dl>

            <p
              className={`leading-relaxed text-ink-muted ${
                featured ? "max-w-3xl text-[14px] sm:text-[15px]" : "mt-auto text-xs sm:text-[13px]"
              }`}
            >
              {row.reason}
            </p>
          </div>
        </div>
      </article>
    </li>
  );
}
