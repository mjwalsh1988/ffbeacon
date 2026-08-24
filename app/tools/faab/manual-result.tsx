"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Info, Loader2, Sparkles } from "lucide-react";
import { fetchPlayerOutlook } from "./actions";
import { BidResult, type BidView } from "./bid-result";
import type { FaabPlayer } from "./player-combobox";
import { computeManualMarginal } from "@/lib/faab/manual";
import { buildLadder } from "@/lib/faab/ladder";
import { buildMarket } from "@/lib/faab/market";
import type { PlayerOutlook } from "@/lib/faab/outlook";
import type { FaabResult, FaabSettings, NeedLevel } from "@/lib/faab/types";

/**
 * The answer without a league connected.
 *
 * League mode asks the exact question because it has your roster. This asks the
 * closest one we can actually answer: what does he add over the best player you
 * could already start in a league this size? That is measurable from
 * projections alone, and it beats the old approach (rank on a curve) because it
 * uses what a player is projected to DO rather than what he is worth in trade.
 *
 * The expensive half is fetched once per player and cached here. League size,
 * starter count, budget, and need all recompute in the browser from the
 * position curve the server sent, so dragging those controls stays instant.
 *
 * When there is nothing to project (offseason, an unlisted player) it falls
 * back to the original rank-and-value calculator rather than showing nothing.
 */
export function ManualResult({
  player,
  formatSlug,
  formatName,
  teams,
  starters,
  budget,
  budgetValid,
  need,
  settings,
  fallbackResult,
}: {
  player: FaabPlayer | null;
  formatSlug: string;
  formatName: string;
  teams: number;
  starters: number;
  budget: number;
  budgetValid: boolean;
  need: NeedLevel;
  settings: FaabSettings;
  /** The original rank-and-value answer, used when nothing is projected. */
  fallbackResult: FaabResult | null;
}) {
  const [outlook, setOutlook] = useState<PlayerOutlook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  const playerId = player?.player_id ?? null;

  useEffect(() => {
    setOutlook(null);
    setError(null);
    if (!playerId) return;
    startLoading(async () => {
      const result = await fetchPlayerOutlook({ playerId, formatSlug });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOutlook(result.outlook);
    });
  }, [playerId, formatSlug]);

  const view = useMemo<BidView | null>(() => {
    if (!player || !outlook || !budgetValid) return null;

    const manual = computeManualMarginal({
      position: outlook.position,
      projectedPointsPerWeek: outlook.projectedPointsPerWeek,
      positionCurve: outlook.positionCurve,
      teams,
      offensiveStarters: starters,
      weeksRemaining: outlook.weeksRemaining,
      weeks: outlook.weeks,
      settings: settings.manualReplacement,
    });

    if (!manual.marginal) return null;

    // Without a league there are no rival wallets and no bid history to read.
    // The one market force that still applies is the calendar, so that is the
    // only market signal in play here.
    const market = buildMarket({
      yourBudget: budget,
      rivalBudgets: [],
      interestedRivals: null,
      rivalsChecked: null,
      comparable: null,
      currentWeek: outlook.currentWeek,
      lastRegularWeek: outlook.lastRegularWeek,
      // No league, so no published allowance to compare wallets against.
      leagueTotalBudget: null,
      settings: settings.market,
    });

    const ladder = buildLadder({
      marginal: manual.marginal,
      playerSignals: outlook.signals,
      marketSignals: market.signals,
      market: market.read,
      remainingBudget: budget,
      needLevel: need,
      settings,
      confidence: outlook.confidence,
    });

    return {
      mode: "manual",
      title: player.name,
      subtitle: `${teams}-team, start ${starters}, ${formatName}`,
      headline: ladder.headline,
      explanation: ladder.explanation,
      confidence: outlook.confidence,
      ladder: ladder.ladder,
      isDumpCandidate: ladder.isDumpCandidate,
      marginal: manual.marginal,
      signals: [...outlook.signals, ...market.signals],
      market: null,
      notices: [...outlook.notices, ...ladder.notices],
      replacement:
        manual.replacementRank !== null && manual.replacementPointsPerWeek !== null
          ? {
              rank: manual.replacementRank,
              pointsPerWeek: manual.replacementPointsPerWeek,
            }
          : null,
    };
  }, [
    player,
    outlook,
    budgetValid,
    budget,
    teams,
    starters,
    need,
    settings,
    formatName,
  ]);

  const liveSummary = !player
    ? ""
    : !budgetValid
      ? "Enter your remaining FAAB budget to see a bid."
      : loading
        ? "Reading his rest-of-season outlook."
        : view
          ? `${view.headline}. Bid ${view.ladder.likely} FAAB, walk away above ${view.ladder.walkAway}.`
          : fallbackResult
            ? `Recommended bid ${fallbackResult.lowBid} to ${fallbackResult.highBid} FAAB.`
            : "";

  return (
    <div className="space-y-3">
      <p className="sr-only" role="status" aria-live="polite">
        {liveSummary}
      </p>

      {!player ? (
        <EmptyState />
      ) : !budgetValid ? (
        <p className="rounded-modal border border-line bg-base/40 p-5 text-sm text-ink-muted">
          Enter your remaining FAAB budget to see a bid.
        </p>
      ) : loading ? (
        <p className="flex items-center gap-2 rounded-modal border border-line bg-base/40 p-5 text-sm text-ink-muted">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-brand-cyan" />
          Reading his rest-of-season outlook.
        </p>
      ) : view ? (
        <BidResult view={view} />
      ) : (
        <FallbackResult result={fallbackResult} error={error} />
      )}

      <p className="rounded-card border border-line bg-surface/40 px-4 py-3 text-sm leading-relaxed text-ink-muted">
        <Info aria-hidden="true" className="mr-1.5 inline h-4 w-4 align-[-3px] text-brand-cyan" />
        {settings.copy.economyNotice}
      </p>
    </div>
  );
}

/**
 * The original rank-and-value answer, still here for the cases the projection
 * path cannot cover: the offseason, a player nobody publishes weekly numbers
 * for, or a failed lookup. Showing the older, simpler number beats showing none.
 */
function FallbackResult({
  result,
  error,
}: {
  result: FaabResult | null;
  error: string | null;
}) {
  if (!result) {
    return (
      <p role="status" className="rounded-modal border border-line bg-base/40 p-5 text-sm text-ink-muted">
        {error ?? "We could not price this player right now."}
      </p>
    );
  }

  return (
    <div className="rounded-modal border border-brand-cyan/30 bg-brand-cyan/5 p-5">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-brand-cyan">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        Recommended bid
      </p>
      <p
        className="mt-1 bg-clip-text font-mono text-3xl font-bold tabular-nums text-transparent forced-colors:text-ink sm:text-4xl"
        style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
      >
        {result.lowBid === result.highBid
          ? `${result.highBid} FAAB`
          : `${result.lowBid}-${result.highBid} FAAB`}
      </p>
      <p className="mt-0.5 text-xs text-ink-subtle">
        {result.lowPct === result.highPct
          ? `${result.highPct}%`
          : `${result.lowPct}%-${result.highPct}%`}{" "}
        of budget, {result.tierLabel.toLowerCase()}.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-ink">{result.explanation}</p>
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        {error
          ? error
          : "No weekly projections for him right now, so this is priced on ranking and market value."}
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex items-start gap-3 rounded-modal border border-line bg-base/40 p-5">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
      >
        <Sparkles className="h-4 w-4" />
      </span>
      <div>
        <p className="text-sm font-semibold text-ink">Pick a player to get a bid.</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">
          Set your league size, starters, budget, and need above, then search a name.
        </p>
      </div>
    </div>
  );
}
