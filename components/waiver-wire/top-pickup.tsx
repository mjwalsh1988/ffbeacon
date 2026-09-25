/**
 * The one player the board leads with.
 *
 * THE HEADING SAYS "BEST AVAILABLE", NOT "THE ADD". Replacement level for a
 * skill position in a twelve-team league is better than nearly everything that
 * reaches waivers, so the best name on a given Tuesday is frequently one whose
 * edge over a startable player is still negative. "The add of week 3" over a
 * player projected below the last startable receiver is a small lie; "the best
 * available add" is the same card and true every week.
 *
 * WHY THE PAGE NEEDS A FOCAL POINT. Without it the board opens on a grid of
 * twenty-four equally-weighted cards, which is a lot of uniform surface for an
 * eye to land on and nothing for it to land on FIRST. A reader arriving on
 * "waiver wire week 4" has one question before any other: who is the add. This
 * answers it in one card, at a size that says so, and everything below it is
 * then browsing rather than searching.
 *
 * WHICH PLAYER. `topPickup` in `lib/waiver-wire/reasons.ts`, which is the best
 * of the four positions people actually make claims for rather than the top of
 * the flat score. The reasoning is in that function's own header: across
 * positions the score still leans toward streamers, and a page whose headline
 * add is a defense is a page nobody reads twice.
 *
 * NOTHING HERE IS A SECOND SOURCE OF TRUTH. Every figure is the same field the
 * compact card renders, from the same row. The hero is bigger, not different.
 *
 * NOTHING VISIBLE IS aria-hidden, same contract as the card beside it. The
 * headshot is decorative because the name is adjacent text, the gradient frame
 * and the hairline are decoration, and every abbreviated figure carries its
 * missing words as `sr-only` inside the element that holds the number.
 *
 * Presentational server component.
 */

import Link from "next/link";
import { ArrowRight, Flame, TrendingUp } from "lucide-react";
import { POSITION_BADGE } from "@/lib/on-the-clock/position-colors";
import { PlayerHeadshot } from "@/components/player-headshot";
import { NflTeamLogo } from "@/components/nfl-team-logo";
import type { BoardPosition, BoardRow } from "@/lib/waiver-wire/types";
import { OFFENSE_POSITIONS, positionNounMap } from "@/lib/site";

const POSITION_WORD: Record<BoardPosition, string> = positionNounMap(OFFENSE_POSITIONS, {
  short: ["DEF"],
});

function one(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function whole(n: number): string {
  return String(Math.round(n));
}

/** A big readout inside the hero. Label above, figure below, context under it. */
function HeroStat({
  label,
  value,
  srSuffix,
  detail,
  accent = "ink",
}: {
  label: string;
  value: string;
  srSuffix?: string;
  detail?: string;
  accent?: "ink" | "cyan" | "purple";
}) {
  const tone =
    accent === "cyan"
      ? "text-brand-cyan"
      : accent === "purple"
        ? "text-brand-purple"
        : "text-ink";
  return (
    <div className="min-w-0 rounded-card border border-line bg-base/50 px-3 py-2.5">
      <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
        {label}
      </dt>
      <dd className={`mt-1 font-mono text-xl font-bold tabular-nums ${tone}`}>
        {value}
        {srSuffix && <span className="sr-only"> {srSuffix}</span>}
      </dd>
      {detail && <p className="mt-0.5 text-[11px] leading-tight text-ink-subtle">{detail}</p>}
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
  const { opportunity: o, projection, rosterRate, bid } = row;

  return (
    <section
      aria-labelledby="top-pickup-heading"
      className="rounded-modal p-px"
      style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 55%, #A855F7 100%)" }}
    >
      <div
        className="relative overflow-hidden rounded-modal p-4 sm:p-5"
        style={{
          background:
            "radial-gradient(120% 140% at 0% 0%, #1B1B33 0%, #12121F 45%, #0F0F1A 100%)",
        }}
      >
        {/* Decorative glow behind the headshot. pointer-events-none so a screen
            reader following the mouse never lands on an unnamed element. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(168,85,247,0.22), transparent 70%)" }}
        />

        <div className="relative flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-cyan/50 bg-brand-cyan/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-cyan">
            <Flame aria-hidden="true" className="h-3 w-3" />
            Top pickup
          </span>
          <h2
            id="top-pickup-heading"
            className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle"
          >
            The best available add in week {week}
          </h2>
        </div>

        <div className="relative mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
          <span aria-hidden="true" className="shrink-0">
            <PlayerHeadshot sleeperId={row.sleeperId} name="" size={76} />
          </span>

          <div className="min-w-0 flex-1">
            <h3 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
              <Link
                href={`/players/${row.slug}`}
                className="underline-offset-4 hover:text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                {row.name}
              </Link>
            </h3>
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              <span
                className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold ${POSITION_BADGE[row.position]}`}
              >
                {row.position}
              </span>
              <span className="sr-only">{POSITION_WORD[row.position]}</span>
              {row.team && (
                <span className="inline-flex items-center gap-1.5">
                  <NflTeamLogo team={row.team} size={16} />
                  {row.team}
                </span>
              )}
              <span className="text-ink-subtle">
                {row.position}
                {row.positionRank}
                <span className="sr-only"> in this format</span>
              </span>
            </p>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-muted">
              {row.reason}
            </p>
          </div>

          {bid && !bid.isDumpCandidate && (
            <div className="shrink-0 rounded-card border border-brand-cyan/40 bg-brand-cyan/[0.07] px-4 py-3 text-center sm:min-w-[9rem]">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-cyan">
                Suggested bid
              </p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-ink">
                ${bid.lowPct}
                <span className="text-ink-subtle">-</span>
                {bid.highPct}
                <span className="sr-only">
                  {" "}
                  of a $100 budget, which is {bid.lowPct} to {bid.highPct} percent of whatever
                  you have left
                </span>
              </p>
              <p className="mt-0.5 text-[11px] text-ink-subtle">
                {bid.tierLabel}
                <span className="sr-only">, in a 12-team standard league</span>
              </p>
            </div>
          )}
        </div>

        <dl className="relative mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <HeroStat
            label="Rostered"
            value={rosterRate?.pct == null ? "No data" : `${whole(rosterRate.pct)}%`}
            srSuffix={
              rosterRate?.pct == null
                ? "for how widely he is rostered"
                : `of the ${rosterRate.total} leagues we track`
            }
            detail={
              rosterRate ? `${rosterRate.rostered} of ${rosterRate.total} leagues` : undefined
            }
            accent={rosterRate?.pct != null && rosterRate.pct < 25 ? "cyan" : "ink"}
          />
          <HeroStat
            label={isPast ? "Projected" : "This week"}
            value={projection ? one(projection.points) : "None"}
            srSuffix={projection ? "points" : "projection published"}
            detail={projection?.opponent ? `vs ${projection.opponent}` : "No opponent yet"}
          />
          <HeroStat
            label="Over replacement"
            value={
              row.pointsAboveReplacement == null
                ? "Unknown"
                : `${row.pointsAboveReplacement > 0 ? "+" : ""}${one(row.pointsAboveReplacement)}`
            }
            srSuffix={
              row.pointsAboveReplacement == null
                ? "without a projection to compare"
                : `points a week against the last startable ${POSITION_WORD[row.position]}`
            }
            detail={`vs the last startable ${row.position}`}
            accent={
              row.pointsAboveReplacement != null && row.pointsAboveReplacement > 0
                ? "cyan"
                : "ink"
            }
          />
          <HeroStat
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
        </dl>

        <div className="relative mt-4 flex flex-wrap items-center gap-3">
          <Link
            href="/tools/faab"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-base transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <TrendingUp aria-hidden="true" className="h-4 w-4" />
            Price this claim for your league
          </Link>
          <Link
            href={`/players/${row.slug}`}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            {row.name}
            <span className="sr-only">, full player profile</span>
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
