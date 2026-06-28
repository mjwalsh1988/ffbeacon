"use client";

/**
 * Rankings & Awards tab for the On The Clock draft room.
 *
 * Two sections, both live (they re-resolve on every resync):
 *   1. Startup draft awards: six bright, distinct trophy cards (one icon + accent
 *      per award) showing the team(s) that currently hold each award, with the
 *      owner's Sleeper avatar. An unearned award reads "Up for grabs".
 *   2. Power rankings: a condensed table of every team ordered by total FF Beacon
 *      value (rank, owner + team name, value), the connected team highlighted.
 *
 * Pure presentation: the awards and rollups arrive already computed as props
 * (lib/on-the-clock/awards.ts + lib/on-the-clock/rosters.ts). NOTHING here calls
 * Sleeper, Supabase, or any API.
 */

import {
  Flame,
  Gem,
  Sun,
  MicOff,
  Star,
  TrendingDown,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import type { Award, AwardClaimant, AwardId } from "@/lib/on-the-clock/awards";
import type { TeamRollup } from "@/lib/on-the-clock/rosters";
import { EmptyCard, ErrorCard, LoadingCard } from "./states";

/** Per-award visual identity: icon + accent classes (FF Beacon dark brand). */
const AWARD_THEME: Record<
  AwardId,
  { icon: LucideIcon; accentText: string; accentBorder: string; accentBg: string; glow: string }
> = {
  "most-active-trader": {
    icon: Flame,
    accentText: "text-amber-300",
    accentBorder: "border-amber-400/50",
    accentBg: "bg-amber-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(251,191,36,0.9)]",
  },
  "most-successful-trader": {
    icon: Gem,
    accentText: "text-emerald-300",
    accentBorder: "border-emerald-400/50",
    accentBg: "bg-emerald-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(52,211,153,0.9)]",
  },
  "first-starting-roster": {
    icon: Sun,
    accentText: "text-brand-cyan",
    accentBorder: "border-brand-cyan/50",
    accentBg: "bg-brand-cyan/10",
    glow: "shadow-[0_0_60px_-40px_rgba(34,211,238,0.9)]",
  },
  "most-boring": {
    icon: MicOff,
    accentText: "text-zinc-300",
    accentBorder: "border-zinc-400/40",
    accentBg: "bg-zinc-400/10",
    glow: "shadow-[0_0_60px_-44px_rgba(161,161,170,0.8)]",
  },
  "best-drafter": {
    icon: Star,
    accentText: "text-brand-purple",
    accentBorder: "border-brand-purple/50",
    accentBg: "bg-brand-purple/10",
    glow: "shadow-[0_0_60px_-40px_rgba(168,85,247,0.9)]",
  },
  "worst-drafter": {
    icon: TrendingDown,
    accentText: "text-rose-300",
    accentBorder: "border-rose-400/50",
    accentBg: "bg-rose-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(251,113,133,0.9)]",
  },
};

/** Awards that depend on the league's trades, used to show a loading-aware note. */
const TRADE_AWARDS = new Set<AwardId>([
  "most-active-trader",
  "most-successful-trader",
  "most-boring",
]);

/** How many winner rows to show before collapsing the rest into "+N more". */
const MAX_CLAIMANTS_SHOWN = 3;

function fmt(v: number): string {
  return Math.round(v).toLocaleString();
}

export function RankingsAwards({
  awards,
  teams,
  myRosterId,
  boardReady,
  tradesLoading,
  tradesError,
  onRetryTrades,
}: {
  awards: Award[];
  teams: TeamRollup[];
  myRosterId: number | null;
  boardReady: boolean;
  tradesLoading: boolean;
  tradesError: string | null;
  onRetryTrades: () => void;
}) {
  if (!boardReady) {
    return (
      <EmptyCard
        title="FF Beacon values are not available yet."
        body="Rankings & Awards ranks teams and grades the draft by FF Beacon value. Once this format's FF Beacon rankings are published, the awards and the power rankings table fill in here."
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* ---- Section 1: Awards ---- */}
      <section aria-labelledby="otc-awards-title" className="space-y-4">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl" id="otc-awards-title">
            Startup draft awards
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Live hardware for your league. Every award recalculates on each sync, so the holders
            change as the draft and the trades roll in.
          </p>
        </div>

        {tradesError ? (
          <div className="space-y-2">
            <ErrorCard message={`Trades could not load, so the trade awards are paused. ${tradesError}`} />
            <button
              type="button"
              onClick={onRetryTrades}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-3 py-2 text-sm font-semibold text-ink hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
              Retry trades
            </button>
          </div>
        ) : tradesLoading ? (
          <LoadingCard label="Loading trades for the trade awards..." />
        ) : null}

        {/* Polite summary so screen-reader users hear when the awards resolve or
            re-resolve on a resync (the cards themselves re-render silently). */}
        <p className="sr-only" role="status" aria-live="polite">
          {awardsStatus(awards, tradesLoading, tradesError != null)}
        </p>

        <ul role="list" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {awards.map((award) => (
            <li key={award.id}>
              <AwardCard
                award={award}
                tradesLoading={tradesLoading && TRADE_AWARDS.has(award.id)}
                tradesError={tradesError != null && TRADE_AWARDS.has(award.id)}
              />
            </li>
          ))}
        </ul>
      </section>

      {/* ---- Section 2: Power rankings ---- */}
      <section aria-labelledby="otc-power-title" className="space-y-4">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl" id="otc-power-title">
            Power rankings
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Every team ordered by total FF Beacon value (drafted players plus their future picks).
          </p>
        </div>
        {teams.length === 0 ? (
          <EmptyCard
            title="No teams to rank yet."
            body="Teams appear here as soon as the draft has rosters. Press Sync draft to pull the latest."
          />
        ) : (
          <PowerRankingsTable teams={teams} myRosterId={myRosterId} />
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Award card
// ---------------------------------------------------------------------------

/** Concise live-region summary of the awards state. */
function awardsStatus(awards: Award[], tradesLoading: boolean, tradesError: boolean): string {
  if (tradesError) return "Trades could not load, so the trade awards are paused.";
  if (tradesLoading) return "Loading trades to grade the trade awards.";
  const earned = awards.filter((a) => !a.pending).length;
  return `${earned} of ${awards.length} awards claimed so far.`;
}

function AwardCard({
  award,
  tradesLoading,
  tradesError,
}: {
  award: Award;
  tradesLoading: boolean;
  tradesError: boolean;
}) {
  const theme = AWARD_THEME[award.id];
  const Icon = theme.icon;
  const labelId = `award-${award.id}-label`;
  const isPending = award.pending;
  const shown = award.claimants.slice(0, MAX_CLAIMANTS_SHOWN);
  const extra = award.claimants.length - shown.length;

  return (
    <article
      aria-labelledby={labelId}
      className={`relative flex h-full flex-col overflow-hidden rounded-modal border bg-surface/60 ${
        isPending ? "border-line" : theme.accentBorder
      } ${isPending ? "" : theme.glow}`}
    >
      {/* Themed top hairline (decorative). */}
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 top-0 h-px ${isPending ? "bg-line" : theme.accentBg}`}
      />

      <div className="flex items-start gap-3 p-4 sm:p-5">
        <span
          aria-hidden="true"
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-card border ${theme.accentBorder} ${theme.accentBg} ${theme.accentText}`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${theme.accentText}`}>
            {award.category}
          </p>
          <h3 id={labelId} className="text-base font-bold leading-tight tracking-tight text-ink">
            {award.title}
          </h3>
        </div>
      </div>

      <div className="mt-auto px-4 pb-4 sm:px-5 sm:pb-5">
        {isPending ? (
          <div className="rounded-card border border-dashed border-line bg-base/40 px-3 py-3">
            <p className="text-sm font-semibold text-ink">Up for grabs</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
              {tradesError
                ? "Trades could not load. Retry above to grade this award."
                : tradesLoading
                  ? "Loading trades..."
                  : award.pendingLabel}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {award.metricLabel && (
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold tabular-nums ${theme.accentBorder} ${theme.accentBg} ${theme.accentText}`}
              >
                {award.metricLabel}
              </span>
            )}
            <ul role="list" className="space-y-1.5">
              {shown.map((c) => (
                <ClaimantRow key={c.rosterId} claimant={c} />
              ))}
            </ul>
            {extra > 0 && (
              <p className="text-xs text-ink-muted">
                and {extra} more {extra === 1 ? "team" : "teams"} tied
              </p>
            )}
          </div>
        )}
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">{award.description}</p>
      </div>
    </article>
  );
}

function ClaimantRow({ claimant }: { claimant: AwardClaimant }) {
  return (
    <li className="flex items-center gap-2.5">
      <span aria-hidden="true" className="shrink-0">
        <SleeperAvatar avatarId={claimant.avatar} title={claimant.ownerName} size={32} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="truncate text-sm font-bold text-ink">{claimant.ownerName}</span>
          {claimant.isYou && (
            <span className="shrink-0 rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-cyan">
              You
            </span>
          )}
        </span>
        {claimant.teamName && (
          <span className="block truncate text-xs text-ink-muted">{claimant.teamName}</span>
        )}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Power rankings table
// ---------------------------------------------------------------------------

function PowerRankingsTable({
  teams,
  myRosterId,
}: {
  teams: TeamRollup[];
  myRosterId: number | null;
}) {
  return (
    <div className="overflow-hidden rounded-modal border border-line bg-surface/40">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          Power rankings: every team ordered by total FF Beacon value, highest first.
        </caption>
        <thead>
          <tr className="border-b border-line text-[10px] uppercase tracking-[0.14em] text-ink-muted">
            <th scope="col" className="w-px whitespace-nowrap px-3 py-2.5 text-center font-semibold">
              Rank
            </th>
            <th scope="col" className="px-2 py-2.5 font-semibold">
              Team
            </th>
            <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">
              Value
            </th>
          </tr>
        </thead>
        <tbody>
          {teams.map((team) => {
            const isYou = myRosterId != null && team.rosterId === myRosterId;
            return (
              <tr
                key={team.rosterId}
                className={`border-b border-line/60 last:border-0 ${
                  isYou ? "bg-brand-purple/10" : ""
                }`}
              >
                <td className="w-px whitespace-nowrap px-3 py-2.5 text-center align-middle">
                  <span
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full font-mono text-sm font-bold tabular-nums ${
                      isYou
                        ? "bg-brand-purple/20 text-brand-purple"
                        : "bg-base text-ink-muted"
                    }`}
                  >
                    {team.rank}
                  </span>
                </td>
                <th scope="row" className="px-2 py-2.5 text-left align-middle font-normal">
                  <span className="flex flex-col justify-center">
                    <span className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="truncate text-sm font-semibold text-ink">
                        {team.ownerName}
                      </span>
                      {isYou && (
                        <span className="shrink-0 rounded-full border border-brand-purple/50 bg-brand-purple/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-purple">
                          You
                        </span>
                      )}
                    </span>
                    {team.teamName && (
                      <span className="truncate text-xs text-ink-muted">{team.teamName}</span>
                    )}
                  </span>
                </th>
                <td className="whitespace-nowrap px-3 py-2.5 text-right align-middle font-mono text-sm font-bold tabular-nums text-ink">
                  {fmt(team.totalValue)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
