/**
 * One player on the waiver board, as a card in a grid.
 *
 * BUILT TO BE SCANNED, THEN READ. A reader moving down a grid of cards wants
 * three things from each before they decide to stop: who he is, what he costs,
 * and the one fact that makes him interesting. So the card leads with exactly
 * those, in that order and at those sizes: the name beside a headshot ringed
 * in his position's colour, the bid as the largest figure on the card in the
 * beacon gradient, and one or two highlight chips
 * (`lib/waiver-wire/highlights.ts`). The four measured figures sit under them
 * as icon tiles, and the full reason sentence is one tap away behind "Why him"
 * at every width. Nothing is dropped: every figure the old card printed is
 * still here, and the sentence is a disclosure rather than a deletion
 * (CLAUDE.md, Mobile-First Layout Rule).
 *
 * TWO ABREAST ON A PHONE. Built for the roughly 150-pixel column a 360-pixel
 * phone gives it first, then allowed to breathe.
 *
 * THE BID IS A PERCENTAGE OF THE SEASON BUDGET, NEVER DOLLARS (see `BoardBid`).
 * `BidInDollars` adds the reader's own dollars beneath it when they have typed a
 * budget; it never replaces the percentage.
 *
 * NOTHING VISIBLE IS aria-hidden except decoration: the headshot and logo (the
 * name is beside them), icons, the glow, the bid meter and the availability bar
 * (their numbers are printed beside them), and the signed touch change, whose
 * words are in the sr-only text of the same figure. Nothing is said twice.
 *
 * ONE LINK, THE WHOLE CARD. The name is the only link and it is stretched over
 * the card, so the tap target is the card rather than a 19-pixel line of text.
 * The "Why him" disclosure sits above that layer and stays its own control.
 */

import { OFFENSE_POSITIONS, positionNounMap } from "@/lib/site";
import Link from "next/link";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  Coins,
  Flame,
  Gavel,
  Gift,
  Minus,
  Sparkles,
  Target,
  TrendingUp,
  Unlock,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { NflTeamLogo } from "@/components/nfl-team-logo";
import type {
  BidderKey,
  BoardBid,
  BoardPosition,
  BoardRow,
  ClaimMarket,
} from "@/lib/waiver-wire/types";
import { cardHighlights, type HighlightKind } from "@/lib/waiver-wire/highlights";
import { claimWeeksText } from "@/lib/waiver-wire/weeks";
import { BidInDollars } from "./budget-context";

/**
 * The four positions that touch the ball. A kicker has no targets and a team
 * defense has no carries, so their usage tile shows what they SCORED last week.
 */
const TOUCH_POSITIONS: readonly BoardPosition[] = ["QB", "RB", "WR", "TE"];

const POSITION_WORD: Record<BoardPosition, string> = positionNounMap(OFFENSE_POSITIONS, {
  short: ["DEF"],
});

/**
 * The position palette as raw colours, for the ring and the glow. The same
 * values as `position.*` in tailwind.config.ts. Position hue labels the
 * position; brand purple and cyan stay reserved for the claim itself.
 */
export const POSITION_HEX: Record<BoardPosition, string> = {
  QB: "#F87171",
  RB: "#34D399",
  WR: "#60A5FA",
  TE: "#FBBF24",
  K: "#F472B6",
  DEF: "#94A3B8",
};

function one(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function whole(n: number): string {
  return String(Math.round(n));
}

/** How many teams the price assumes, in words. */
export const BIDDERS_TEXT: Record<BidderKey, string> = {
  "1": "Likely just you",
  "2": "About 2 teams bidding",
  "3": "About 3 teams bidding",
  "4p": "4 or more teams bidding",
};

/** The tier as a coloured pill with its own icon. Colour is paired with the words. */
export const TIER_STYLE: Record<BoardBid["tier"], { icon: LucideIcon; className: string }> = {
  priority: {
    icon: Flame,
    className: "border-brand-purple/50 bg-brand-purple/15 text-brand-purple-light",
  },
  real: { icon: Zap, className: "border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan" },
  cheap: { icon: Coins, className: "border-line-accent bg-ink/[0.05] text-ink-muted" },
  free: { icon: Gift, className: "border-line bg-ink/[0.03] text-ink-subtle" },
};

export function TierPill({ bid, className = "" }: { bid: BoardBid; className?: string }) {
  const style = TIER_STYLE[bid.tier];
  const Icon = style.icon;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${style.className} ${className}`}
    >
      <Icon aria-hidden="true" className="h-3 w-3" />
      {bid.tierLabel}
    </span>
  );
}

/**
 * "12-25%" for the eye, "12 to 25%" for the ear, in one element. The hyphen is
 * hidden and a spoken "to" sits beside it, because a screen reader can read a
 * bare hyphen between two numbers as "minus".
 */
export function BidFigure({ bid }: { bid: BoardBid }) {
  if (bid.lowPct === bid.highPct) return <>{bid.highPct}%</>;
  return (
    <>
      {bid.lowPct}
      <span aria-hidden="true">-</span>
      <span className="sr-only"> to </span>
      {bid.highPct}%
    </>
  );
}

/**
 * What the figure means, for the sr-only half of it. Only the words a sighted
 * reader gets from the layout: the tier and the bidder count are visible text
 * on the same card, so they are not repeated here.
 */
export function bidSpoken(bid: BoardBid, market: ClaimMarket | null): string {
  const source =
    bid.basis === "market" || !market
      ? "priced from the measured market for players like him"
      : "priced mostly from what he has cost in real claims";
  return `of your season budget. The lower figure wins about 6 times in 10, the higher about 9 in 10, ${source}.`;
}

/** The gradient text every headline bid is drawn in. */
export const BID_TEXT_CLASS =
  "bg-clip-text font-mono font-bold tabular-nums text-transparent forced-colors:text-ink";
export const BID_TEXT_STYLE = {
  backgroundImage: "linear-gradient(120deg, #F4F4F8 0%, #22D3EE 45%, #A855F7 100%)",
} as const;

/**
 * The bid as a filled track on a 0 to 100 percent scale: the band between the
 * value bid and the make-sure bid, plus a tick where his own median claim
 * landed when we hold one. Decorative, because every number it draws is
 * printed beside it.
 */
export function BidMeter({
  bid,
  market,
  className = "",
}: {
  bid: BoardBid;
  market: ClaimMarket | null;
  className?: string;
}) {
  const left = Math.min(100, Math.max(0, bid.lowPct));
  const width = Math.max(2, Math.min(100, bid.highPct) - left);
  const median = market && market.auctions >= 2 ? Math.min(100, Math.max(0, market.p50)) : null;
  return (
    <span aria-hidden="true" className={`relative block h-1.5 w-full rounded-full bg-ink/10 ${className}`}>
      <span
        className="absolute inset-y-0 rounded-full"
        style={{
          left: `${left}%`,
          width: `${width}%`,
          backgroundImage: "linear-gradient(90deg, #22D3EE 0%, #A855F7 100%)",
          boxShadow: "0 0 10px rgba(34,211,238,0.45)",
        }}
      />
      {median != null && (
        <span
          className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-ink"
          style={{ left: `calc(${median}% - 1px)` }}
        />
      )}
    </span>
  );
}

const HIGHLIGHT_STYLE: Record<HighlightKind, { icon: LucideIcon; className: string }> = {
  role: { icon: TrendingUp, className: "bg-signal-success/10 text-signal-success" },
  claimed: { icon: Flame, className: "bg-brand-purple/15 text-brand-purple-light" },
  available: { icon: Unlock, className: "bg-brand-cyan/10 text-brand-cyan" },
  upgrade: { icon: Sparkles, className: "bg-brand-cyan/10 text-brand-cyan" },
  snaps: { icon: Activity, className: "bg-ink/[0.06] text-ink-muted" },
  crowded: { icon: Users, className: "bg-brand-purple/15 text-brand-purple-light" },
};

/**
 * One measured figure as a small tile: an icon, the label, the value. The
 * label is the `dt`, so a screen reader hears "Rostered, 48 percent of the 765
 * leagues we track" from one tile.
 */
function StatTile({
  icon: Icon,
  label,
  children,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-2 rounded-xl border border-line/70 bg-base/60 px-2 py-1.5 [@container(min-width:11.5rem)]:block sm:px-2.5 sm:py-2">
      <dt className="flex shrink-0 items-center gap-1 pt-0.5 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-ink-subtle [@container(min-width:11.5rem)]:pt-0 sm:text-[10px]">
        <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
        <span>{label}</span>
      </dt>
      <dd className="min-w-0 text-right font-mono text-[15px] font-bold leading-tight tabular-nums text-ink [@container(min-width:11.5rem)]:mt-0.5 [@container(min-width:11.5rem)]:text-left sm:text-base">
        {children}
        {sub && (
          <span className="mt-0.5 block break-words font-sans text-[10px] font-normal leading-tight text-ink-subtle sm:text-[10.5px]">
            {sub}
          </span>
        )}
      </dd>
    </div>
  );
}

export function WaiverPlayerCard({
  row,
  index,
  isPast,
  claimWeeks,
}: {
  row: BoardRow;
  /** 1-based position within its group, for the rank badge. */
  index: number;
  /** True when the board's week has been played, which changes every tense. */
  isPast: boolean;
  /** The waiver weeks the claim figures cover, or null when we hold none. */
  claimWeeks: { from: number; to: number } | null;
}) {
  const { opportunity: o, projection, rosterRate, bid, market } = row;
  const touches = TOUCH_POSITIONS.includes(row.position);
  const weeksText = claimWeeks ? claimWeeksText(claimWeeks) : null;
  const hue = POSITION_HEX[row.position];
  const highlights = cardHighlights(row);

  return (
    <li className="min-w-0">
      <article
        aria-labelledby={`wire-${row.playerId}`}
        className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl [container-type:inline-size] border border-line bg-surface/70 p-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-line-accent hover:shadow-[0_12px_40px_-20px_rgba(168,85,247,0.55)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-3.5"
      >
        {/* Position-coloured glow in the corner. Decoration only, and
            pointer-events-none so a pointer over it still finds the card. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full opacity-25 blur-2xl transition-opacity group-hover:opacity-40"
          style={{ background: hue }}
        />

        <div className="flex items-start gap-2 sm:gap-3">
          <span aria-hidden="true" className="relative shrink-0">
            <span
              className="block rounded-full p-[2px]"
              style={{ backgroundImage: `linear-gradient(140deg, ${hue} 0%, ${hue}33 100%)` }}
            >
              <span className="block overflow-hidden rounded-full bg-base">
                <PlayerHeadshot sleeperId={row.sleeperId} name="" size={40} />
              </span>
            </span>
            <span
              className="absolute -left-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-base px-1 font-mono text-[9.5px] font-bold text-[#07070D]"
              style={{ background: hue }}
            >
              {index}
            </span>
          </span>

          <div className="min-w-0 flex-1">
            <h4
              id={`wire-${row.playerId}`}
              className="break-words text-[13.5px] font-semibold leading-snug text-ink sm:text-[15px]"
            >
              <span className="sr-only">
                Number {index} at {POSITION_WORD[row.position]}:{" "}
              </span>
              <Link
                href={`/players/${row.slug}`}
                className="underline-offset-2 after:absolute after:inset-0 after:z-[1] after:rounded-2xl after:content-[''] hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                {row.name}
              </Link>
            </h4>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-medium text-ink-muted sm:text-xs">
              <span className="font-bold" style={{ color: hue }}>
                {row.position}
                {row.positionRank}
                <span className="sr-only">
                  , ranked {row.positionRank} at {POSITION_WORD[row.position]} in this format
                </span>
              </span>
              {row.team && (
                <span className="inline-flex items-center gap-1">
                  <NflTeamLogo team={row.team} size={13} />
                  <span>{row.team}</span>
                </span>
              )}
            </p>
          </div>
        </div>

        {/* The bid: the largest figure on the card. */}
        <div className="relative mt-3">
          {bid ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <p
                  className={`${BID_TEXT_CLASS} text-[26px] leading-none sm:text-[30px]`}
                  style={BID_TEXT_STYLE}
                >
                  <BidFigure bid={bid} />
                  <span className="sr-only"> {bidSpoken(bid, market)}</span>
                </p>
                <TierPill bid={bid} />
              </div>
              <BidMeter bid={bid} market={market} className="mt-2" />
              <p className="mt-1.5 text-[10.5px] leading-snug text-ink-subtle sm:text-[11px]">
                of budget, {BIDDERS_TEXT[bid.bidders].toLowerCase()}
              </p>
              <BidInDollars
                lowPct={bid.lowPct}
                highPct={bid.highPct}
                className="mt-0.5 block font-mono text-xs font-semibold tabular-nums text-brand-cyan"
              />
            </>
          ) : (
            <p className="rounded-xl border border-dashed border-line bg-base/40 px-2.5 py-2 text-xs leading-snug text-ink-muted">
              No market read yet, so no bid.
            </p>
          )}
        </div>

        {highlights.length > 0 && (
          <ul role="list" aria-label="Highlights" className="relative mt-2.5 flex flex-wrap gap-1">
            {highlights.map((h) => {
              const style = HIGHLIGHT_STYLE[h.kind];
              const Icon = style.icon;
              return (
                <li
                  key={h.kind}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold leading-tight sm:text-[11px] ${style.className}`}
                >
                  <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
                  {h.text}
                </li>
              );
            })}
          </ul>
        )}

        {/* Label-and-value rows while the card is narrow (a 360-pixel phone
            gives it about 150), where a two-by-two grid would cut the labels
            short; tiles once the card itself is wider. A container query, so
            it follows the card rather than the screen. */}
        <dl className="relative mt-2.5 grid grid-cols-1 gap-1 [@container(min-width:11.5rem)]:grid-cols-2 [@container(min-width:11.5rem)]:gap-1.5">
          <StatTile
            icon={Users}
            label="Rostered"
            sub={
              rosterRate?.pct != null ? (
                <span
                  aria-hidden="true"
                  className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-ink/10"
                >
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.max(3, Math.min(100, rosterRate.pct))}%`,
                      background: rosterRate.pct < 25 ? "#22D3EE" : "#8A8A9C",
                    }}
                  />
                </span>
              ) : undefined
            }
          >
            <span className={rosterRate?.pct != null && rosterRate.pct < 25 ? "text-brand-cyan" : ""}>
              {rosterRate?.pct == null ? "No data" : `${whole(rosterRate.pct)}%`}
            </span>
            <span className="sr-only">
              {rosterRate?.pct == null
                ? " for how widely he is rostered"
                : ` of the ${rosterRate.total} leagues we track`}
            </span>
          </StatTile>

          <StatTile
            icon={Target}
            label={isPast ? "Projected" : "This week"}
            sub={projection?.opponent ? `vs ${projection.opponent}` : "No opponent"}
          >
            {projection ? one(projection.points) : "None"}
            <span className="sr-only">{projection ? " points" : " published for this week"}</span>
          </StatTile>

          {touches ? (
            <StatTile
              icon={Activity}
              label="Touches"
              sub={o.lastWeek == null ? "No games" : `Week ${o.lastWeek}`}
            >
              {o.lastTouches == null ? (
                <>
                  None
                  <span className="sr-only"> recorded this season</span>
                </>
              ) : (
                <span className="inline-flex flex-wrap items-center justify-end gap-0.5 [@container(min-width:11.5rem)]:justify-start">
                  {o.touchDelta != null &&
                    (o.touchDelta > 0.5 ? (
                      <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 text-signal-success" />
                    ) : o.touchDelta < -0.5 ? (
                      <ArrowDownRight aria-hidden="true" className="h-3.5 w-3.5 text-signal-danger" />
                    ) : (
                      <Minus aria-hidden="true" className="h-3.5 w-3.5 text-ink-subtle" />
                    ))}
                  <span>
                    {whole(o.lastTouches)}
                    <span className="sr-only">
                      {" "}
                      touches in week {o.lastWeek}
                      {o.touchDelta != null
                        ? `, ${o.touchDelta > 0.5 ? "up" : o.touchDelta < -0.5 ? "down" : "about level"} on his ${one(o.priorTouches ?? 0)} average`
                        : ""}
                    </span>
                  </span>
                  {o.touchDelta != null && Math.abs(o.touchDelta) > 0.5 && (
                    <span
                      aria-hidden="true"
                      className={`ml-0.5 text-[10.5px] font-semibold ${
                        o.touchDelta > 0 ? "text-signal-success" : "text-signal-danger"
                      }`}
                    >
                      {o.touchDelta > 0 ? "+" : ""}
                      {one(o.touchDelta)}
                    </span>
                  )}
                </span>
              )}
            </StatTile>
          ) : (
            <StatTile
              icon={Activity}
              label="Last week"
              sub={o.lastWeek == null ? "No games" : `Week ${o.lastWeek}`}
            >
              {o.lastPoints == null ? "Did not play" : one(o.lastPoints)}
              <span className="sr-only">
                {o.lastPoints == null
                  ? " in a week we hold a line for"
                  : ` points scored in week ${o.lastWeek}`}
              </span>
            </StatTile>
          )}

          <StatTile
            icon={Gavel}
            label="Claimed"
            sub={
              market
                ? market.auctions >= 2
                  ? `leagues, median ${whole(market.p50)}%`
                  : "league, too few to price"
                : weeksText
                  ? `in ${weeksText}`
                  : "No claim data yet"
            }
          >
            <span className={market && market.leagues >= 10 ? "text-brand-purple" : ""}>
              {market ? market.leagues : "None"}
            </span>
          </StatTile>
        </dl>

        <details className="group/why relative z-10 mt-2.5 sm:mt-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl border border-line/70 bg-base/40 px-2.5 text-xs font-semibold text-brand-cyan transition-colors hover:border-brand-cyan/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan [&::-webkit-details-marker]:hidden">
            Why him
            <ChevronDown
              aria-hidden="true"
              className="h-3.5 w-3.5 transition-transform group-open/why:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-ink-muted sm:text-[13px]">{row.reason}</p>
        </details>
      </article>
    </li>
  );
}
