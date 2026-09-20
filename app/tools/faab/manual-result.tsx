"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Info, Loader2, Sparkles } from "lucide-react";
import { fetchMarketCell, fetchPlayerOutlook } from "./actions";
import { BidResult } from "./bid-result";
import { analyticsBid, liveMessage, type BidView } from "./bid-view";
import { biddersFor, choppedPlatform, type ManualSetupState } from "./manual-setup";
import type { FaabPlayer } from "./player-combobox";
import { computeManualMarginal } from "@/lib/faab/manual";
import { buildLadder, upgradeStrengthOf } from "@/lib/faab/ladder";
import { buildMarket } from "@/lib/faab/market";
import { buildReasons } from "@/lib/faab/reasons";
import { combinedMultiplier } from "@/lib/faab/signals";
// From lib/chopped/price.ts, not lib/faab/league-chopped.ts: that one pulls
// the survival simulation into the browser to read four numbers.
import { priceByAliveFraction } from "@/lib/chopped/price";
import { choppedPhase, standardPhase } from "@/lib/faab/priors-build";
import { priorCdf, type PriorCell } from "@/lib/faab/priors-math";
import { trackEvent } from "@/lib/analytics";
import type { PlayerOutlook } from "@/lib/faab/outlook";
import type { FaabResult, FaabSettings, GoalKey } from "@/lib/faab/types";

/**
 * The answer without a league connected.
 *
 * League mode asks the exact question because it has your roster. This asks
 * the closest one we can actually answer: what does he add over the best
 * player you could already start in a league this size, and what have leagues
 * like yours actually paid for that?
 *
 * TWO SERVER CALLS, BOTH CACHED HERE, AND NEITHER ON THE CONTROLS' CRITICAL
 * PATH. One reads the player's rest-of-season outlook, once per player. The
 * other reads ONE market cell for the reader's situation, once per distinct
 * situation: the whole set is about two thousand rows and the browser needs
 * exactly one of them. Everything else, the replacement level, the ladder,
 * the whole win curve, recomputes in the browser from the pure maths in
 * lib/faab/priors-math.ts, so dragging the budget or flipping the bid style
 * is instant and the goal toggle never touches the network.
 *
 * When there is nothing to project (offseason, an unlisted player) it falls
 * back to the original rank-and-value calculator rather than showing nothing.
 */
export function ManualResult({
  player,
  formatSlug,
  formatName,
  setup,
  budgetValid,
  settings,
  fallbackResult,
}: {
  player: FaabPlayer | null;
  formatSlug: string;
  formatName: string;
  setup: ManualSetupState;
  budgetValid: boolean;
  settings: FaabSettings;
  /** The original rank-and-value answer, used when nothing is projected. */
  fallbackResult: FaabResult | null;
}) {
  const [outlook, setOutlook] = useState<PlayerOutlook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [goal, setGoal] = useState<GoalKey>(settings.goal.defaultGoal);
  const [announcement, setAnnouncement] = useState<string | null>(null);

  const [cell, setCell] = useState<PriorCell | null>(null);
  const [cellFallback, setCellFallback] = useState<string | null>(null);
  // Why there is no win chance, when there is none. The action writes a
  // perfectly good sentence for a refused claim or an unbuilt market, and
  // throwing it away left the chance and the chart simply missing with
  // nothing said about it.
  const [cellError, setCellError] = useState<string | null>(null);
  const cacheRef = useRef(new Map<string, { cell: PriorCell; fellBackTo: string | null }>());

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
      trackEvent("tool_use", { tool: "faab" });
      setOutlook(result.outlook);
    });
  }, [playerId, formatSlug]);

  const isChopped = setup.leagueType === "chopped";
  const platform = choppedPlatform(setup.platform);
  const aliveFraction = isChopped
    ? Math.min(1, Math.max(0, setup.aliveCount / Math.max(1, setup.startCount)))
    : 1;

  // Replacement level moves with a second starting quarterback, so superflex
  // is applied to the admin's own shape rather than to a separate table.
  const replacementSettings = useMemo(() => {
    if (!setup.superflex) return settings.manualReplacement;
    return {
      ...settings.manualReplacement,
      startersPerTeam: {
        ...settings.manualReplacement.startersPerTeam,
        QB: settings.manualReplacement.superflexQbPerTeam,
      },
    };
  }, [setup.superflex, settings.manualReplacement]);

  const manual = useMemo(() => {
    if (!outlook) return null;
    return computeManualMarginal({
      position: outlook.position,
      projectedPointsPerWeek: outlook.projectedPointsPerWeek,
      positionCurve: outlook.positionCurve,
      teams: setup.teams,
      offensiveStarters: setup.starters,
      weeksRemaining: outlook.weeksRemaining,
      weeks: outlook.weeks,
      settings: replacementSettings,
    });
  }, [outlook, setup.teams, setup.starters, replacementSettings]);

  const upgradeStrength = useMemo(
    () => upgradeStrengthOf(manual?.marginal ?? null, settings.marginal),
    [manual, settings.marginal],
  );

  const bidders = biddersFor(
    setup.competition,
    upgradeStrength,
    isChopped ? { aliveFraction } : null,
  );

  // Which market cell describes this reader's situation. The key is the whole
  // request, so flipping a control back to where it was costs nothing.
  const cellKey = outlook
    ? [
        isChopped ? "chopped" : setup.leagueType,
        setup.superflex ? "sf" : "1qb",
        outlook.position,
        (isChopped ? choppedPhase(aliveFraction) : standardPhase(outlook.currentWeek)) ??
          "any",
        bidders,
      ].join("|")
    : null;

  useEffect(() => {
    if (!cellKey || !outlook) return;
    const cached = cacheRef.current.get(cellKey);
    if (cached) {
      setCell(cached.cell);
      setCellFallback(cached.fellBackTo);
      return;
    }
    let current = true;
    const [kind, sf, position, phase, biddersKey] = cellKey.split("|");
    void (async () => {
      const result = await fetchMarketCell({
        leagueKind: kind,
        superflex: sf === "sf",
        position,
        phase: phase === "any" ? null : phase,
        bidders: biddersKey,
      });
      if (!current) return;
      if (!result.ok) {
        setCell(null);
        setCellFallback(null);
        setCellError(result.error);
        return;
      }
      setCellError(null);
      cacheRef.current.set(cellKey, {
        cell: result.cell,
        fellBackTo: result.fellBackTo,
      });
      setCell(result.cell);
      setCellFallback(result.fellBackTo);
    })();
    return () => {
      current = false;
    };
  }, [cellKey, outlook]);

  const view = useMemo<BidView | null>(() => {
    if (!player || !outlook || !manual?.marginal || !budgetValid) return null;

    const totalBudget = Math.max(1, Math.round(setup.leagueBudget));
    const remaining = Math.max(0, Math.round(setup.remainingBudget));
    const styleMultiplier = Math.max(
      0.01,
      settings.priors.styleMultipliers[setup.style] ?? 1,
    );

    const winChanceAt = cell
      ? (dollars: number) =>
          priorCdf(cell, ((dollars / totalBudget) * 100) / styleMultiplier)
      : null;

    // Without a league there are no rival wallets and no bid history to read.
    // The one market force that still applies is the calendar, so that is the
    // only market signal in play here.
    const market = buildMarket({
      yourBudget: remaining,
      rivalBudgets: [],
      interestedRivals: null,
      rivalsChecked: null,
      comparable: null,
      currentWeek: outlook.currentWeek,
      lastRegularWeek: outlook.lastRegularWeek,
      // No league, so no published allowance to compare wallets against.
      leagueTotalBudget: null,
      aliveCount: isChopped ? setup.aliveCount : null,
      settings: settings.market,
    });

    // A chopped league is a different game, so its worth is built here rather
    // than from playoff odds it does not have: the size of the upgrade, what
    // a shrinking field does to prices, and how much danger the reader says
    // they are in this week.
    const worthPctOverride = isChopped
      ? clamp(
          upgradeStrength *
            settings.chopped.maxPctFromUpgrade *
            (settings.needMultipliers[setup.need] ?? 1) *
            combinedMultiplier(outlook.signals) *
            priceByAliveFraction(aliveFraction, settings.chopped) *
            settings.chopped.manualDangerMultipliers[setup.danger],
          0,
          100,
        )
      : null;

    const inDanger = isChopped && (setup.danger === "bottomTwo" || setup.danger === "nearCut");

    const built = buildLadder({
      marginal: manual.marginal,
      playerSignals: outlook.signals,
      marketSignals: market.signals,
      market: market.read,
      remainingBudget: remaining,
      totalBudget,
      minBid: isChopped ? platform.minBid : 0,
      needLevel: setup.need,
      mode: "manual",
      settings,
      confidence: outlook.confidence,
      goal,
      winChanceAt,
      worthPctOverride,
      choppedHeadline: inDanger ? "Survive this week" : null,
    });

    const reasons = buildReasons({
      interestedRivals: null,
      netPointsPerWeek: manual.marginal.netPointsPerWeek,
      calendarMultiplier: market.read.calendarMultiplier,
      currentWeek: outlook.currentWeek,
      aliveCount: isChopped ? setup.aliveCount : null,
    });

    const notices = [...outlook.notices, ...built.notices];
    if (cellError) notices.push(cellError);
    if (!cell) {
      notices.push(
        "We could not read a market price for this situation, so there is no chance-to-win figure here.",
      );
    }

    return {
      mode: "manual",
      leagueKind: isChopped ? "chopped" : "standard",
      title: player.name,
      subtitle: `${setup.teams}-team, start ${setup.starters}, ${formatName}${setup.superflex ? ", superflex" : ""}`,
      headline: built.headline,
      explanation: built.explanation,
      confidence: outlook.confidence,
      ladder: built.ladder,
      goalDefault: inDanger ? "sure" : settings.goal.defaultGoal,
      isDumpCandidate: built.isDumpCandidate,
      marginal: manual.marginal,
      signals: [...outlook.signals, ...market.signals],
      market: null,
      notices,
      replacement:
        manual.replacementRank !== null && manual.replacementPointsPerWeek !== null
          ? {
              rank: manual.replacementRank,
              pointsPerWeek: manual.replacementPointsPerWeek,
            }
          : null,
      reasons,
      rivals: [],
      rivalsNotInterested: 0,
      injuredStarters: [],
      positionalWar: null,
      chopped: null,
      heat: null,
      priorsFallback: cellFallback,
      remainingBudget: remaining,
      totalBudget,
      sleeperId: player.sleeper_id ?? null,
    };
  }, [
    player,
    outlook,
    manual,
    budgetValid,
    setup,
    settings,
    formatName,
    goal,
    cell,
    cellFallback,
    cellError,
    isChopped,
    aliveFraction,
    upgradeStrength,
    platform,
  ]);

  // The default goal is the calculator's opinion about this player, so it
  // reapplies when the player or the situation changes, and a reader's own
  // choice survives everything else.
  const goalDefault = view?.goalDefault ?? settings.goal.defaultGoal;
  useEffect(() => {
    setGoal(goalDefault);
    setAnnouncement(null);
  }, [goalDefault, playerId]);

  const changeGoal = useCallback((next: GoalKey) => {
    setAnnouncement(null);
    setGoal(next);
  }, []);

  // One event per ANSWER, not per render and not per goal switch: the
  // signature is the two priced bids for this player, so dragging a control
  // that does not move the number reports nothing. The toggle has its own
  // event, fired where the toggle lives.
  const reportedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!view) return;
    const signature = [
      playerId,
      view.leagueKind,
      view.ladder.bidsByGoal.value.dollars,
      view.ladder.bidsByGoal.sure.dollars,
    ].join("|");
    if (reportedRef.current === signature) return;
    reportedRef.current = signature;
    trackEvent("faab_result", {
      mode: "manual",
      league_kind: view.leagueKind,
      goal,
      ...analyticsBid(view.ladder, goal),
    });
  }, [view, goal, playerId]);

  const liveSummary = !player
    ? ""
    : !budgetValid
      ? "Enter your remaining FAAB budget to see a bid."
      : loading
        ? "Reading his rest-of-season outlook."
        : view
          ? liveMessage(view, goal)
          : fallbackResult
            ? `Recommended bid ${fallbackResult.lowBid} to ${fallbackResult.highBid} FAAB.`
            : "";

  return (
    <div className="space-y-3">
      <p className="sr-only" role="status" aria-live="polite">
        {announcement ?? liveSummary}
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
        <BidResult
          view={view}
          goal={goal}
          onGoalChange={changeGoal}
          onAnnounce={setAnnouncement}
        />
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

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
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
      <p
        role="status"
        className="rounded-modal border border-line bg-base/40 p-5 text-sm text-ink-muted"
      >
        {error ?? "We could not price this player right now."}
      </p>
    );
  }

  return (
    <div className="rounded-modal border border-brand-cyan/30 bg-brand-cyan/5 p-5">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-brand-cyan">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        Rough estimate, no projections available
      </p>
      <p
        className="mt-1 bg-clip-text font-mono text-3xl font-bold tabular-nums text-transparent forced-colors:text-ink sm:text-4xl"
        style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
      >
        {result.lowBid === result.highBid
          ? `${result.highBid} FAAB`
          : `${result.lowBid} to ${result.highBid} FAAB`}
      </p>
      <p className="mt-0.5 text-xs text-ink-subtle">
        {result.lowPct === result.highPct
          ? `${result.highPct}%`
          : `${result.lowPct}% to ${result.highPct}%`}{" "}
        of budget, {result.tierLabel.toLowerCase()}.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-ink">{result.explanation}</p>
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        {error
          ? error
          : "No weekly projections for him right now, so this is priced on ranking and market value, and there is no chance-to-win figure."}
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
          Set your league type, size, budget and need above, then search a name.
        </p>
      </div>
    </div>
  );
}
