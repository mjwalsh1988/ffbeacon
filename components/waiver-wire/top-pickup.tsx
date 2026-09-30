/**
 * The one player the board leads with.
 *
 * THE HEADING SAYS "BEST AVAILABLE", NOT "THE ADD". Replacement level for a
 * skill position in a twelve-team league is better than nearly everything that
 * reaches waivers, so the best name on a given Tuesday is frequently one whose
 * edge over a startable player is still negative. "The best available add" is
 * the same card and true every week.
 *
 * WHY THE PAGE NEEDS A FOCAL POINT. A reader arriving on "waiver wire week 4"
 * has one question before any other: who is the add. This answers it in one
 * card, at a size that says so, and the board below is then browsing rather
 * than searching. It is drawn as the page's showpiece: the position-coloured
 * portrait on the left, the bid as the largest number on the page in the
 * beacon gradient on the right, and the measured figures as icon tiles.
 *
 * WHICH PLAYER. `topPickup` in `lib/waiver-wire/reasons.ts`.
 *
 * NOTHING HERE IS A SECOND SOURCE OF TRUTH. Every figure is the same field the
 * compact card renders, from the same row. The hero is bigger, not different.
 *
 * NOTHING VISIBLE IS aria-hidden except decoration, same contract as the card.
 *
 * Presentational server component.
 */

import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Crown,
  Gavel,
  Target,
  TrendingUp,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { NflTeamLogo } from "@/components/nfl-team-logo";
import type { BoardPosition, BoardRow } from "@/lib/waiver-wire/types";
import { OFFENSE_POSITIONS, positionNounMap } from "@/lib/site";
import {
  BIDDERS_TEXT,
  BID_TEXT_CLASS,
  BID_TEXT_STYLE,
  BidFigure,
  BidMeter,
  POSITION_HEX,
  TierPill,
  bidSpoken,
} from "./player-card";
import { BidInDollars } from "./budget-context";

const POSITION_WORD: Record<BoardPosition, string> = positionNounMap(OFFENSE_POSITIONS, {
  short: ["DEF"],
});

function one(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function whole(n: number): string {
  return String(Math.round(n));
}

/** A readout inside the hero: icon and label, the figure, context under it. */
function HeroStat({
  icon: Icon,
  label,
  value,
  srSuffix,
  detail,
  accent = "ink",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  srSuffix?: string;
  detail?: string;
  accent?: "ink" | "cyan" | "purple";
}) {
  const tone =
    accent === "cyan" ? "text-brand-cyan" : accent === "purple" ? "text-brand-purple" : "text-ink";
  return (
    <div className="min-w-0 rounded-2xl border border-line/80 bg-base/60 px-3 py-2.5 backdrop-blur-sm">
      <dt className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 leading-tight">{label}</span>
      </dt>
      <dd className={`mt-1 font-mono text-xl font-bold tabular-nums sm:text-2xl ${tone}`}>
        {value}
        {srSuffix && <span className="sr-only"> {srSuffix}</span>}
        {detail && (
          <span className="mt-0.5 block font-sans text-[11px] font-normal leading-tight text-ink-subtle">
            {detail}
          </span>
        )}
      </dd>
    </div>
  );
}

export function TopPickup({
  row,
  week,
  isPast,
}: {
  row: BoardRow;
  week: number;
  isPast: boolean;
}) {
  const { opportunity: o, projection, rosterRate, bid, market } = row;
  const hue = POSITION_HEX[row.position];

  return (
    <section
      aria-labelledby="top-pickup-heading"
      className="relative rounded-3xl p-px"
      style={{ backgroundImage: `linear-gradient(135deg, ${hue} 0%, #A855F7 45%, #22D3EE 100%)` }}
    >
      <div
        className="relative overflow-hidden rounded-[calc(1.5rem-1px)] p-4 sm:p-6"
        style={{
          background: "radial-gradient(120% 140% at 0% 0%, #1B1B33 0%, #12121F 45%, #0B0B14 100%)",
        }}
      >
        {/* Decorative light. pointer-events-none so a screen reader following
            the mouse never lands on an unnamed element. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full opacity-30 blur-3xl"
          style={{ background: hue }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 right-0 h-64 w-64 rounded-full opacity-20 blur-3xl"
          style={{ background: "#22D3EE" }}
        />
        <Trophy
          aria-hidden="true"
          className="pointer-events-none absolute -right-6 -top-6 h-40 w-40 text-ink/[0.03]"
        />

        <div className="relative flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-cyan/50 bg-brand-cyan/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-cyan">
            <Crown aria-hidden="true" className="h-3 w-3" />
            Top pickup
          </span>
          <h2
            id="top-pickup-heading"
            className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted"
          >
            The best available add in week {week}
          </h2>
        </div>

        <div className="relative mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-start">
          <div className="flex min-w-0 items-start gap-4">
            <span aria-hidden="true" className="relative shrink-0">
              <span
                className="block rounded-full p-[3px] shadow-[0_0_40px_-8px_var(--hue)]"
                style={{
                  backgroundImage: `linear-gradient(140deg, ${hue} 0%, #A855F7 100%)`,
                  ["--hue" as string]: hue,
                }}
              >
                <span className="block overflow-hidden rounded-full bg-base">
                  <PlayerHeadshot sleeperId={row.sleeperId} name="" size={84} />
                </span>
              </span>
            </span>

            <div className="min-w-0 flex-1">
              <h3 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                <Link
                  href={`/players/${row.slug}`}
                  className="underline-offset-4 hover:text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  {row.name}
                </Link>
              </h3>
              <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
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
                {row.team && (
                  <span className="inline-flex items-center gap-1.5">
                    <NflTeamLogo team={row.team} size={16} />
                    {row.team}
                  </span>
                )}
              </p>
              <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-ink-muted sm:text-[15px]">
                {row.reason}
              </p>
            </div>
          </div>

          {bid && (
            <div className="relative rounded-2xl border border-brand-cyan/30 bg-base/70 p-4 shadow-[0_20px_60px_-30px_rgba(34,211,238,0.6)] backdrop-blur-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-cyan">
                  Suggested bid
                </p>
                <TierPill bid={bid} />
              </div>
              <p className={`${BID_TEXT_CLASS} mt-2 text-5xl leading-none`} style={BID_TEXT_STYLE}>
                <BidFigure bid={bid} />
                <span className="sr-only"> {bidSpoken(bid, market)}</span>
              </p>
              <BidMeter bid={bid} market={market} className="mt-3" />
              <p className="mt-2 text-xs leading-snug text-ink-subtle">
                of your season budget. {BIDDERS_TEXT[bid.bidders]}.
              </p>
              <BidInDollars
                lowPct={bid.lowPct}
                highPct={bid.highPct}
                className="mt-1 block font-mono text-sm font-semibold tabular-nums text-brand-cyan"
              />
            </div>
          )}
        </div>

        <dl className="relative mt-5 grid grid-cols-2 gap-2 max-sm:[&>div:last-child]:col-span-2 sm:grid-cols-3 lg:grid-cols-5">
          <HeroStat
            icon={Users}
            label="Rostered"
            value={rosterRate?.pct == null ? "No data" : `${whole(rosterRate.pct)}%`}
            srSuffix={rosterRate?.pct == null ? "for how widely he is rostered" : undefined}
            detail={rosterRate ? `${rosterRate.rostered} of ${rosterRate.total} leagues` : undefined}
            accent={rosterRate?.pct != null && rosterRate.pct < 25 ? "cyan" : "ink"}
          />
          <HeroStat
            icon={Target}
            label={isPast ? "Projected" : "This week"}
            value={projection ? one(projection.points) : "None"}
            srSuffix={projection ? "points" : "published"}
            detail={projection?.opponent ? `vs ${projection.opponent}` : "No opponent yet"}
          />
          <HeroStat
            icon={TrendingUp}
            label="Over starter"
            value={
              row.pointsAboveReplacement == null
                ? "Unknown"
                : `${row.pointsAboveReplacement > 0 ? "+" : ""}${one(row.pointsAboveReplacement)}`
            }
            srSuffix={
              row.pointsAboveReplacement == null
                ? "without a projection to compare"
                : `points against the last startable ${POSITION_WORD[row.position]}`
            }
            detail={`vs the last startable ${row.position}`}
            accent={
              row.pointsAboveReplacement != null && row.pointsAboveReplacement > 0 ? "cyan" : "ink"
            }
          />
          <HeroStat
            icon={Activity}
            label="Usage"
            value={
              o.lastTouches == null
                ? o.lastPoints == null
                  ? "None"
                  : one(o.lastPoints)
                : whole(o.lastTouches)
            }
            srSuffix={
              o.lastTouches == null
                ? o.lastPoints == null
                  ? "recorded this season"
                  : `points scored in week ${o.lastWeek}`
                : `touches in week ${o.lastWeek}`
            }
            detail={
              o.touchDelta != null
                ? `${o.touchDelta > 0 ? "+" : ""}${one(o.touchDelta)} on his average`
                : o.lastWeek == null
                  ? "No games played"
                  : `Week ${o.lastWeek}`
            }
            accent={o.touchDelta != null && o.touchDelta > 1 ? "purple" : "ink"}
          />
          <HeroStat
            icon={Gavel}
            label="Claimed"
            value={market ? `${market.leagues}` : "None"}
            srSuffix={market ? undefined : "of the synced leagues"}
            detail={
              market
                ? market.auctions >= 2
                  ? `leagues, median ${whole(market.p50)}% of budget`
                  : "league, too few claims to price"
                : "in the latest waiver runs"
            }
            accent={market ? "purple" : "ink"}
          />
        </dl>

        <div className="relative mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Link
            href="/tools/faab"
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-beacon px-5 py-2.5 text-sm font-semibold text-[#07070D] shadow-[0_10px_30px_-12px_rgba(168,85,247,0.8)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
          >
            <TrendingUp aria-hidden="true" className="h-4 w-4" />
            Price this claim for your league
          </Link>
          <Link
            href={`/players/${row.slug}`}
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-base/40 px-5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/50 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
          >
            Full profile
            <span className="sr-only"> for {row.name}</span>
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
