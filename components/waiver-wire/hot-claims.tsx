/**
 * The most-claimed players in the latest waiver runs, and what they cost.
 *
 * WHY IT IS ON THE PAGE. The board lists who is still available; this lists
 * what the room actually spent money on, which is the evidence under every
 * price on the board. It is also the one waiver list nobody else can publish:
 * not a columnist's opinion of who to add, but a count of who WAS added, in
 * how many real leagues, at what share of budget.
 *
 * DRAWN AS A LEADERBOARD. The top three get podium cards with the median
 * price as a large figure; the rest are a compact ranked grid. Every figure is
 * from `waiver_claim_market()` (migration 0331): anonymous counts and
 * quantiles, no league or manager attached.
 *
 * THE BARS ARE DECORATION, THE TEXT IS THE DATA. Each entry states the
 * leagues, the median, the middle half and the bidder count in words. The bar
 * draws the same middle half on a 0 to 100 percent scale with the median as a
 * tick, and is aria-hidden because it adds nothing a screen reader has not
 * already heard.
 *
 * ONE LINK PER PLAYER, STRETCHED over the entry so the tap target is the
 * whole card or row.
 *
 * Presentational server component.
 */

import Link from "next/link";
import { Flame, Medal } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { positionNoun } from "@/lib/site";
import { claimWeeksText } from "@/lib/waiver-wire/weeks";
import type { BoardPosition, HotClaim } from "@/lib/waiver-wire/types";
import { POSITION_HEX } from "./player-card";

function whole(n: number): string {
  return String(Math.round(n));
}

const PODIUM_TONE = ["#FBBF24", "#CBD5E1", "#F59E0B"] as const;

function RangeBar({ p25, p50, p75 }: { p25: number; p50: number; p75: number }) {
  const left = Math.max(0, Math.min(100, p25));
  const width = Math.max(1.5, Math.min(100, p75) - left);
  return (
    <span aria-hidden="true" className="relative mt-2 block h-2 w-full rounded-full bg-ink/10">
      <span
        className="absolute inset-y-0 rounded-full"
        style={{
          left: `${left}%`,
          width: `${width}%`,
          backgroundImage: "linear-gradient(90deg, #22D3EE 0%, #A855F7 100%)",
          boxShadow: "0 0 10px rgba(168,85,247,0.4)",
        }}
      />
      <span
        className="absolute -top-0.5 h-3 w-0.5 rounded-full bg-ink"
        style={{ left: `calc(${Math.max(0, Math.min(100, p50))}% - 1px)` }}
      />
    </span>
  );
}

function hueFor(position: string): string {
  return POSITION_HEX[position as BoardPosition] ?? "#94A3B8";
}

function Detail({ claim }: { claim: HotClaim }) {
  const m = claim.market;
  return (
    <>
      Claimed in {m.leagues} {m.leagues === 1 ? "league" : "leagues"}, middle half {whole(m.p25)} to{" "}
      {whole(m.p75)}%, {m.avgBidders.toFixed(1)} teams bidding on average.{" "}
      {claim.onBoard
        ? "Still on this week's board."
        : claim.rosterPct != null
          ? `Now rostered in ${whole(claim.rosterPct)}% of leagues.`
          : ""}
    </>
  );
}

function NameLink({ claim, rank }: { claim: HotClaim; rank: number | null }) {
  return (
    <>
      {rank != null && <span className="sr-only">Number {rank}: </span>}
      <Link
        href={`/players/${claim.slug}`}
        className="underline-offset-2 after:absolute after:inset-0 after:z-[1] after:rounded-2xl after:content-[''] hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        {claim.name}
      </Link>
    </>
  );
}

export function HotClaims({
  claims,
  window,
  headingId = "hot-claims-heading",
}: {
  claims: HotClaim[];
  window: { from: number; to: number } | null;
  headingId?: string;
}) {
  if (claims.length === 0 || !window) return null;
  const weeks = claimWeeksText(window);
  const podium = claims.slice(0, 3);
  const rest = claims.slice(3);

  return (
    <section
      aria-labelledby={headingId}
      className="relative overflow-hidden rounded-3xl border border-line bg-surface/40 p-4 sm:p-6"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #F59E0B 30%, #A855F7 70%, transparent 100%)",
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full opacity-15 blur-3xl"
        style={{ background: "#F59E0B" }}
      />

      <div className="relative flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-purple">
            <Flame aria-hidden="true" className="h-3.5 w-3.5" />
            Real claims, {weeks}
          </p>
          <h2 id={headingId} className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            The most-claimed players on waivers
          </h2>
        </div>
        <p className="max-w-sm text-xs leading-relaxed text-ink-muted sm:text-right">
          Counted across the Sleeper leagues synced to FF Beacon. Bars show the middle half of
          winning bids from 0 to 100% of budget; the tick is the median.
        </p>
      </div>

      <ol role="list" className="relative mt-5 grid gap-3 sm:grid-cols-3">
        {podium.map((claim, i) => {
          const hue = hueFor(claim.position);
          return (
            <li
              key={claim.playerId}
              className="relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-base/60 p-4 transition-colors hover:border-line-accent"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-25 blur-2xl"
                style={{ background: hue }}
              />
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="relative shrink-0">
                  <span
                    className="block rounded-full p-[2px]"
                    style={{ backgroundImage: `linear-gradient(140deg, ${hue} 0%, ${hue}33 100%)` }}
                  >
                    <span className="block overflow-hidden rounded-full bg-base">
                      <PlayerHeadshot sleeperId={claim.sleeperId} name="" size={48} />
                    </span>
                  </span>
                  <span
                    className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-base"
                    style={{ background: PODIUM_TONE[i] }}
                  >
                    <Medal className="h-3.5 w-3.5 text-[#07070D]" />
                  </span>
                </span>
                <div className="min-w-0">
                  <p className="break-words text-[15px] font-semibold leading-snug text-ink">
                    <NameLink claim={claim} rank={i + 1} />
                  </p>
                  <p className="mt-0.5 text-xs font-bold" style={{ color: hue }}>
                    {claim.position}
                    <span className="sr-only">, {positionNoun(claim.position)}</span>
                    {claim.team ? <span className="font-medium text-ink-subtle"> {claim.team}</span> : null}
                  </p>
                </div>
              </div>
              <p className="relative mt-4 flex items-baseline gap-2">
                <span
                  className="bg-clip-text font-mono text-4xl font-bold tabular-nums text-transparent forced-colors:text-ink"
                  style={{ backgroundImage: "linear-gradient(120deg, #F4F4F8 0%, #FBBF24 50%, #A855F7 100%)" }}
                >
                  {whole(claim.market.p50)}%
                </span>
                <span className="text-xs font-medium text-ink-subtle">median winning bid</span>
              </p>
              <RangeBar p25={claim.market.p25} p50={claim.market.p50} p75={claim.market.p75} />
              <p className="relative mt-2 text-[11.5px] leading-relaxed text-ink-muted">
                <Detail claim={claim} />
              </p>
            </li>
          );
        })}
      </ol>

      {rest.length > 0 && (
        <ol
          role="list"
          start={4}
          className="relative mt-3 grid gap-2 sm:grid-cols-2"
        >
          {rest.map((claim, i) => {
            const hue = hueFor(claim.position);
            return (
              <li
                key={claim.playerId}
                className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-2xl border border-line/70 bg-base/40 px-3 py-2.5 transition-colors hover:border-line-accent"
              >
                <span className="flex items-center gap-2">
                  <span className="w-5 text-right font-mono text-xs font-bold text-ink-subtle">
                    {i + 4}
                    <span className="sr-only">.</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="block rounded-full p-[1.5px]"
                    style={{ background: hue }}
                  >
                    <span className="block overflow-hidden rounded-full bg-base">
                      <PlayerHeadshot sleeperId={claim.sleeperId} name="" size={32} />
                    </span>
                  </span>
                </span>
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="min-w-0 break-words text-sm font-semibold text-ink">
                      <NameLink claim={claim} rank={null} />
                      <span className="ml-1.5 text-[11px] font-bold" style={{ color: hue }}>
                        {claim.position}
                        <span className="sr-only">, {positionNoun(claim.position)}</span>
                      </span>
                    </p>
                    <p className="shrink-0 font-mono text-sm font-bold tabular-nums text-ink">
                      {whole(claim.market.p50)}%
                      <span className="sr-only"> median winning bid</span>
                    </p>
                  </div>
                  <RangeBar p25={claim.market.p25} p50={claim.market.p50} p75={claim.market.p75} />
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ink-subtle">
                    <Detail claim={claim} />
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
