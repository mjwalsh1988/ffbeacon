"use client";

/**
 * The Awards tab for the On The Clock draft room.
 *
 * Bright, distinct trophy cards (one icon and accent per award) showing the
 * team or teams that currently hold each award, with the owner's Sleeper
 * avatar. An unearned award reads "Up for grabs". Everything re-resolves on
 * every resync, so holders change as the picks and trades roll in.
 *
 * The power-rankings table that used to live under these cards moved to its own
 * Draft Pulse tab (draft-pulse-board.tsx), where a value ranking sits next to a
 * points ranking and the gap between them can be read directly. A ranking table
 * was never really an award.
 *
 * Pure presentation: the awards arrive already computed as props
 * (lib/on-the-clock/awards.ts). NOTHING here calls Sleeper, Supabase, or any API.
 */

import {
  Activity,
  Flame,
  Gem,
  HeartPulse,
  MicOff,
  RefreshCw,
  Sprout,
  Star,
  Sun,
  Target,
  TrendingDown,
  Trophy,
  Zap,
  type LucideIcon,
  Gift,
  Scale,
  Mountain,
  CalendarX,
  Shuffle,
  PackageOpen,
  Swords,
  TrendingUp,
} from "lucide-react";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import type {
  Award,
  AwardClaimant,
  AwardId,
  RetiredAwardId,
} from "@/lib/on-the-clock/awards";
import { EmptyCard, ErrorCard, LoadingCard, NotStartedCard } from "./states";

/** Per-award visual identity: icon + accent classes (FF Beacon dark brand). */
type AwardTheme = {
  icon: LucideIcon;
  accentText: string;
  accentBorder: string;
  accentBg: string;
  glow: string;
};

/**
 * Keyed by every LIVE award plus every retired one, because a frozen snapshot
 * still carries the awards that existed when it was written and a missing key
 * would render a card with no icon rather than a card that reads as historical.
 */
const AWARD_THEME: Record<AwardId | RetiredAwardId, AwardTheme> = {
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
  "best-starting-lineup": {
    icon: Activity,
    accentText: "text-brand-cyan",
    accentBorder: "border-brand-cyan/50",
    accentBg: "bg-brand-cyan/10",
    glow: "shadow-[0_0_60px_-40px_rgba(34,211,238,0.9)]",
  },
  "long-game": {
    icon: Sprout,
    accentText: "text-emerald-300",
    accentBorder: "border-emerald-400/50",
    accentBg: "bg-emerald-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(52,211,153,0.9)]",
  },
  "most-reliable": {
    icon: Target,
    accentText: "text-sky-300",
    accentBorder: "border-sky-400/50",
    accentBg: "bg-sky-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(125,211,252,0.9)]",
  },
  "boom-bust": {
    icon: Zap,
    accentText: "text-orange-300",
    accentBorder: "border-orange-400/50",
    accentBg: "bg-orange-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(253,186,116,0.9)]",
  },
  "iron-man": {
    icon: HeartPulse,
    accentText: "text-teal-300",
    accentBorder: "border-teal-400/50",
    accentBg: "bg-teal-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(94,234,212,0.9)]",
  },
  "steal-of-draft": {
    icon: Gem,
    accentText: "text-brand-purple",
    accentBorder: "border-brand-purple/50",
    accentBg: "bg-brand-purple/10",
    glow: "shadow-[0_0_60px_-40px_rgba(168,85,247,0.9)]",
  },
  "reach-of-draft": {
    icon: TrendingDown,
    accentText: "text-amber-300",
    accentBorder: "border-amber-400/50",
    accentBg: "bg-amber-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(251,191,36,0.9)]",
  },
  "round-steals": {
    icon: Gift,
    accentText: "text-amber-300",
    accentBorder: "border-amber-400/50",
    accentBg: "bg-amber-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(251,191,36,0.9)]",
  },
  "most-balanced": {
    icon: Scale,
    accentText: "text-brand-cyan",
    accentBorder: "border-brand-cyan/50",
    accentBg: "bg-brand-cyan/10",
    glow: "shadow-[0_0_60px_-40px_rgba(34,211,238,0.9)]",
  },
  "most-top-heavy": {
    icon: Mountain,
    accentText: "text-orange-300",
    accentBorder: "border-orange-400/50",
    accentBg: "bg-orange-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(253,186,116,0.9)]",
  },
  "bye-week-nightmare": {
    icon: CalendarX,
    accentText: "text-rose-300",
    accentBorder: "border-rose-400/50",
    accentBg: "bg-rose-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(251,113,133,0.9)]",
  },
  "against-the-room": {
    icon: Shuffle,
    accentText: "text-violet-300",
    accentBorder: "border-violet-400/50",
    accentBg: "bg-violet-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(196,181,253,0.9)]",
  },
  "late-round-haul": {
    icon: PackageOpen,
    accentText: "text-emerald-300",
    accentBorder: "border-emerald-400/50",
    accentBg: "bg-emerald-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(52,211,153,0.9)]",
  },
  "toughest-schedule": {
    icon: Swords,
    accentText: "text-red-300",
    accentBorder: "border-red-400/50",
    accentBg: "bg-red-400/10",
    glow: "shadow-[0_0_60px_-40px_rgba(252,165,165,0.9)]",
  },
  "scarcity-read": {
    icon: TrendingUp,
    accentText: "text-brand-purple",
    accentBorder: "border-brand-purple/50",
    accentBg: "bg-brand-purple/10",
    glow: "shadow-[0_0_60px_-40px_rgba(168,85,247,0.9)]",
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

export function RankingsAwards({
  awards,
  boardReady,
  draftStarted,
  tradesLoading,
  tradesError,
  onRetryTrades,
}: {
  awards: Award[];
  boardReady: boolean;
  /** False before the first pick lands: nothing has been earned yet. */
  draftStarted: boolean;
  tradesLoading: boolean;
  tradesError: string | null;
  onRetryTrades: () => void;
}) {
  if (!boardReady) {
    return (
      <EmptyCard
        title="FF Beacon values are not available yet."
        body="Awards fill in once this format's FF Beacon rankings publish."
      />
    );
  }

  // A full grid of cards reading "Up for grabs" before anyone has picked looks
  // like a broken page rather than an empty one. Say what will happen instead.
  if (!draftStarted) {
    return (
      <NotStartedCard
        icon={Trophy}
        eyebrow="Draft awards"
        title="No hardware handed out yet"
        body="Awards go on what teams actually do, so nothing is claimed until the first pick."
        points={[
          `${awards.length} awards, recalculated on every sync.`,
          "Best and worst drafter, the steal, the reach, the first full lineup.",
          "Trade awards for the busiest and the best dealer in the room.",
        ]}
      />
    );
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="otc-awards-title" className="space-y-4">
        <div className="min-w-0">
          <h2
            className="text-xl font-bold tracking-tight text-ink sm:text-2xl"
            id="otc-awards-title"
          >
            Draft awards
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Live hardware for your league. Holders change on every sync as the
            picks and trades roll in.
          </p>
        </div>

        {tradesError ? (
          <div className="space-y-2">
            <ErrorCard
              message={`Trades could not load, so the trade awards are paused. ${tradesError}`}
            />
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Award card
// ---------------------------------------------------------------------------

/** Concise live-region summary of the awards state. */
function awardsStatus(
  awards: Award[],
  tradesLoading: boolean,
  tradesError: boolean,
): string {
  if (tradesError)
    return "Trades could not load, so the trade awards are paused.";
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
          <p
            className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${theme.accentText}`}
          >
            {award.category}
          </p>
          <h3
            id={labelId}
            className="text-base font-bold leading-tight tracking-tight text-ink"
          >
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
            {/* The pick awards name a moment rather than a season, so the
                player and the slot sit under the claimant. */}
            {award.pickHighlight && (
              <p className="rounded-card border border-line bg-base/40 px-2.5 py-1.5 text-xs text-ink">
                <span className="font-semibold">
                  {award.pickHighlight.playerName}
                </span>
                {award.pickHighlight.position
                  ? `, ${award.pickHighlight.position}`
                  : ""}{" "}
                at pick {award.pickHighlight.pickNo}
              </p>
            )}
            {extra > 0 && (
              <p className="text-xs text-ink-muted">
                and {extra} more {extra === 1 ? "team" : "teams"} tied
              </p>
            )}
          </div>
        )}
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          {award.description}
        </p>
      </div>
    </article>
  );
}

function ClaimantRow({ claimant }: { claimant: AwardClaimant }) {
  return (
    <li className="flex items-center gap-2.5">
      <span aria-hidden="true" className="shrink-0">
        <SleeperAvatar
          avatarId={claimant.avatar}
          title={claimant.ownerName}
          size={32}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="truncate text-sm font-bold text-ink">
            {claimant.ownerName}
          </span>
          {claimant.isYou && (
            <span className="shrink-0 rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-cyan">
              You
            </span>
          )}
        </span>
        {claimant.teamName && (
          <span className="block truncate text-xs text-ink-muted">
            {claimant.teamName}
          </span>
        )}
      </span>
    </li>
  );
}
