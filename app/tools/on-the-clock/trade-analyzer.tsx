"use client";

/**
 * Trade Builder: build a draft-room trade, then grade it.
 *
 * TWO WAYS TO BUILD, ONE RESOLVER
 * A dropdown listing every asset, and the draft board itself with every cell
 * clickable. Both produce the same DraftAssetRef and both go through
 * lib/on-the-clock/trade-assets.ts resolveDraftAsset, so they cannot drift apart
 * as one gets a fix the other does not. The board is the interesting one: a
 * drafter thinks in slots ("I want their 2.03"), not in a list of labels.
 *
 * TWO RESULTS, IN THE ORDER THEY ARRIVE
 * The value strip totals both sides off the board the moment an asset lands, so
 * numbers move at the speed of clicking. The Signal Check verdict lands
 * underneath after a round trip, and it is the real answer: the same pipeline
 * /tools/signal-check runs, with calibration, the value adjustment, thresholds,
 * confidence, and the written explanation.
 *
 * Nothing here calls Sleeper. The analysis goes through a server action that
 * re-derives the format from the cached league and prices asset references
 * itself; the client never sends a value or a format.
 */

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ArrowLeftRight, LayoutGrid, List, Plus, Scale, Sparkles, X, type LucideIcon } from "lucide-react";
import type { PlayerPool, ShapedDraftCache } from "@/lib/on-the-clock/types";
import type { CurrentDraftPick } from "@/lib/on-the-clock/pick-ownership";
import {
  analyzeTradeSides,
  type TradeAnalysisResult,
  type TradeItemGroup,
  type TradeItemOption,
} from "@/lib/on-the-clock/trade-analyzer";
import {
  resolveDraftAsset,
  toSignalCheckAssets,
  type DraftAssetRef,
  type ResolveContext,
  type ResolvedAsset,
} from "@/lib/on-the-clock/trade-assets";
import type { BuilderView } from "@/lib/signal-check/builder-view";
import { analyzeDraftTrade } from "./actions";
import { AddAssetDialog } from "./add-asset-dialog";
import { DraftBoard } from "./draft-board";
import { SignalCheckReport } from "./signal-check-report";
import { EmptyCard } from "./states";

type SideId = "a" | "b";

interface PlacedItem {
  instanceId: string;
  asset: ResolvedAsset;
}

function modeFor(pool: PlayerPool): {
  modeLabel: string;
  modeIcon: LucideIcon;
  addLabel: string;
  blurb: string;
} {
  if (pool === "rookies") {
    return {
      modeLabel: "Rookie draft",
      modeIcon: Sparkles,
      addLabel: "Add a rookie or pick",
      blurb:
        "Rookie players carry their FF Beacon value. A rookie pick that has not been made is priced as the player Sleeper ADP says would go there. Future-year picks use FF Beacon pick values.",
    };
  }
  return {
    modeLabel: "Startup draft",
    modeIcon: Scale,
    addLabel: "Add a draft pick",
    blurb:
      "A made pick is worth the player who was taken. A pick that has not been made yet is priced as the player Sleeper ADP says would go there. Future-year picks use FF Beacon pick values, because a class nobody has scouted has no ADP to simulate.",
  };
}

export function TradeAnalyzer({
  pool,
  groups,
  boardReady,
  resolveContext,
  draftId,
  draftCache,
  currentPicks,
  teamNameByRosterId,
  myRosterId,
  connectedUserSlot,
  onTheClockPickNo,
  lastPickNo,
  adpBySleeperId,
  adpThreshold,
}: {
  pool: PlayerPool;
  groups: TradeItemGroup[];
  boardReady: boolean;
  /** Everything resolveDraftAsset needs. Null while the board is loading. */
  resolveContext: ResolveContext | null;
  draftId: string;
  draftCache: ShapedDraftCache;
  currentPicks: CurrentDraftPick[];
  teamNameByRosterId: Record<number, string>;
  myRosterId: number | null;
  connectedUserSlot: number;
  onTheClockPickNo: number;
  lastPickNo: number;
  adpBySleeperId: Record<string, number>;
  adpThreshold: number;
}) {
  const { modeLabel, modeIcon: ModeIcon, addLabel, blurb } = modeFor(pool);

  const [sideA, setSideA] = useState<PlacedItem[]>([]);
  const [sideB, setSideB] = useState<PlacedItem[]>([]);
  const [seq, setSeq] = useState(0);
  const [buildFrom, setBuildFrom] = useState<"list" | "board">("list");
  const [pendingAsset, setPendingAsset] = useState<ResolvedAsset | null>(null);
  const [returnFocusTo, setReturnFocusTo] = useState<number | null>(null);
  /** Why the last board cell press did nothing. Empty when it did something. */
  const [pickNotice, setPickNotice] = useState("");
  const announcePickNotice = useCallback((message: string) => {
    setPickNotice("");
    window.setTimeout(() => setPickNotice(message), 60);
  }, []);

  const [report, setReport] = useState<BuilderView | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const optionById = useMemo(() => {
    const map = new Map<string, TradeItemOption>();
    for (const g of groups) for (const o of g.options) map.set(o.id, o);
    return map;
  }, [groups]);

  const usedIds = useMemo(() => {
    const s = new Set<string>();
    for (const i of [...sideA, ...sideB]) if (!i.asset.repeatable) s.add(i.asset.id);
    return s;
  }, [sideA, sideB]);

  const setter = (side: SideId) => (side === "a" ? setSideA : setSideB);

  const place = useCallback(
    (side: SideId, asset: ResolvedAsset) => {
      if (!asset.repeatable && usedIds.has(asset.id)) return;
      const instanceId = `${side}-${asset.id}-${seq}`;
      setSeq((n) => n + 1);
      setter(side)((prev) => [...prev, { instanceId, asset }]);
      // Any change invalidates the verdict. Leaving a stale grade on screen next
      // to a changed trade is worse than showing none.
      setReport(null);
      setReportError(null);
    },
    [seq, usedIds],
  );

  const addFromOption = (side: SideId, optionId: string) => {
    const option = optionById.get(optionId);
    if (!option?.ref || !resolveContext) return;
    const asset = resolveDraftAsset(option.ref, resolveContext);
    if (asset) place(side, asset);
  };

  const removeItem = (side: SideId, instanceId: string) => {
    setter(side)((prev) => prev.filter((i) => i.instanceId !== instanceId));
    setReport(null);
    setReportError(null);
  };

  const reset = () => {
    setSideA([]);
    setSideB([]);
    setReport(null);
    setReportError(null);
  };

  /**
   * A board cell that cannot be added has to SAY so. Pressing Enter and getting
   * silence reads as a broken control, and the two reasons a press does nothing
   * (the pick is already on a side, or it cannot be priced) are both worth
   * knowing.
   */
  // useCallback, or DraftBoard's React.memo is dead here: an inline arrow is a
  // new prop on every render, so every keystroke in this builder re-rendered all
  // 400-odd board cells.
  const onSelectPick = useCallback((overall: number) => {
    if (!resolveContext) return;
    const slot = currentPicks.find((p) => p.overall === overall);
    const slotLabel = slot ? `${slot.round}.${String(slot.pickInRound).padStart(2, "0")}` : `pick ${overall}`;
    const asset = resolveDraftAsset({ kind: "current-pick", overall }, resolveContext);
    if (!asset) {
      // Cleared first, then set, so pressing the SAME dead cell twice speaks
      // twice. Writing an identical string changes no text node, and a live
      // region with no change announces nothing.
      announcePickNotice(
        `${slotLabel} cannot be priced from this board, so it cannot be traded.`,
      );
      return;
    }
    if (!asset.repeatable && usedIds.has(asset.id)) {
      announcePickNotice(`${asset.label} is already in this trade.`);
      return;
    }
    setPickNotice("");
    setReturnFocusTo(overall);
    setPendingAsset(asset);
  }, [resolveContext, currentPicks, usedIds, announcePickNotice]);

  // Overall pick numbers already placed, so every cell's label reflects its own
  // state instead of all of them reading "Add to trade".
  const usedPickNos = useMemo(() => {
    const s = new Set<number>();
    for (const i of [...sideA, ...sideB]) {
      if (i.asset.ref.kind === "current-pick") s.add(i.asset.ref.overall);
    }
    return s;
  }, [sideA, sideB]);

  const closeDialog = useCallback(() => {
    setPendingAsset(null);
  }, []);

  // Return focus to the cell that opened the dialog, so a keyboard user lands
  // back where they were rather than at the top of a 200-cell table.
  useEffect(() => {
    if (pendingAsset !== null || returnFocusTo === null) return;
    const target = document.querySelector<HTMLElement>(
      `[data-otc-pick-button="${returnFocusTo}"]`,
    );
    target?.focus();
    setReturnFocusTo(null);
  }, [pendingAsset, returnFocusTo]);

  const result = analyzeTradeSides(
    sideA.map((i) => toOption(i.asset)),
    sideB.map((i) => toOption(i.asset)),
  );

  const sideALabel =
    myRosterId !== null ? `your side (${teamNameByRosterId[myRosterId] ?? "you"})` : "Side A";
  const sideBLabel = "the other side";

  const simulatedLabels = [...sideA, ...sideB]
    .filter((i) => i.asset.simulated)
    .map((i) => i.asset.label);
  const droppedCount =
    toSignalCheckAssets(sideA.map((i) => i.asset)).dropped +
    toSignalCheckAssets(sideB.map((i) => i.asset)).dropped;

  const runSignalCheck = async () => {
    setReportLoading(true);
    setReportError(null);
    const a = toSignalCheckAssets(sideA.map((i) => i.asset)).assets;
    const b = toSignalCheckAssets(sideB.map((i) => i.asset)).assets;
    const res = await analyzeDraftTrade({ draftId, sides: { a, b } });
    if (res.ok) {
      setReport(res.view);
    } else {
      setReport(null);
      setReportError(res.error);
    }
    setReportLoading(false);
  };

  const canAnalyze = sideA.length > 0 && sideB.length > 0 && !reportLoading;

  // Written into a region that is already on the page. Inserting a live region
  // together with its text usually does not announce, which is why the verdict
  // used to arrive in silence after "Running this trade through Signal Check".
  const reportAnnouncement = reportLoading
    ? "Running this trade through Signal Check."
    : reportError
      ? reportError
      : report
        ? `${report.verdictLabel}. ${report.explanation}`
        : "";

  return (
    <section aria-labelledby="otc-trade-title" className="space-y-5">
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {reportAnnouncement}
      </p>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="otc-trade-title"
            className="flex items-center gap-2 text-xl font-bold tracking-tight text-ink sm:text-2xl"
          >
            <ArrowLeftRight aria-hidden="true" className="h-5 w-5 text-brand-cyan" />
            Trade Builder
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Build a draft-room trade, then run it through Signal Check.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-purple/40 bg-brand-purple/10 px-3 py-1 text-xs font-semibold text-brand-purple">
          <ModeIcon aria-hidden="true" className="h-3.5 w-3.5" />
          {modeLabel}
        </span>
      </div>

      {!boardReady || groups.length === 0 || !resolveContext ? (
        <EmptyCard
          title="Trade values are not available yet."
          body="The Trade Builder needs the FF Beacon board for this league's format. Once the board loads, you can build and compare both sides here."
        />
      ) : (
        <>
          <div
            role="note"
            className="rounded-card border border-line bg-surface/40 px-3 py-2 text-xs leading-relaxed text-ink-muted"
          >
            {blurb}
          </div>

          <div
            role="group"
            aria-label="How to add assets"
            className="inline-flex overflow-hidden rounded-card border border-line"
          >
            {(
              [
                { id: "list", label: "Choose from a list", icon: List },
                { id: "board", label: "Click the draft board", icon: LayoutGrid },
              ] as Array<{ id: "list" | "board"; label: string; icon: LucideIcon }>
            ).map(({ id, label, icon: Icon }) => {
              const active = buildFrom === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setBuildFrom(id)}
                  className={`inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-cyan ${
                    active ? "bg-beacon text-black" : "bg-base text-ink-muted hover:text-ink"
                  }`}
                >
                  <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                  {label}
                </button>
              );
            })}
          </div>

          {buildFrom === "board" && (
            <div className="rounded-modal border border-line bg-surface/30 p-3">
              <p className="mb-2 text-xs text-ink-muted">
                Every cell is a button. Choose a pick and we will ask which side of the trade it
                belongs on.
              </p>
              {/* Why a press did nothing. Mounted empty and written into, so the
                  message actually announces. */}
              <p role="status" aria-live="polite" className="mb-2 text-xs text-amber-300">
                {pickNotice}
              </p>
              <DraftBoard
                draft={draftCache.draft}
                picks={draftCache.picks}
                currentPicks={currentPicks}
                teamNameByRosterId={teamNameByRosterId}
                connectedUserSlot={connectedUserSlot}
                onTheClockPickNo={onTheClockPickNo}
                lastPickNo={lastPickNo}
                adpBySleeperId={adpBySleeperId}
                adpThreshold={adpThreshold}
                onSelectPick={onSelectPick}
                usedPickNos={usedPickNos}
              />
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <TradeSide
              side="a"
              heading={myRosterId !== null ? `Your side` : "Side A"}
              items={sideA}
              total={result.totalA}
              groups={groups}
              usedIds={usedIds}
              addLabel={addLabel}
              showPicker={buildFrom === "list"}
              onAdd={addFromOption}
              onRemove={removeItem}
            />
            <TradeSide
              side="b"
              heading="The other side"
              items={sideB}
              total={result.totalB}
              groups={groups}
              usedIds={usedIds}
              addLabel={addLabel}
              showPicker={buildFrom === "list"}
              onAdd={addFromOption}
              onRemove={removeItem}
            />
          </div>

          <QuickTotals result={result} />

          <div className="flex flex-wrap items-center gap-2">
            {/* aria-disabled, not disabled: a `disabled` button drops out of the
                tab order, so a keyboard user never reaches it and never hears
                why it will not fire. This one stays focusable and points at the
                sentence that explains it. */}
            <button
              type="button"
              onClick={() => {
                if (!canAnalyze) return;
                void runSignalCheck();
              }}
              aria-disabled={!canAnalyze}
              aria-describedby={!canAnalyze && !reportLoading ? "otc-trade-run-hint" : undefined}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-card border border-brand-purple/50 bg-brand-purple/15 px-4 py-2 text-sm font-semibold text-brand-purple transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                canAnalyze ? "hover:bg-brand-purple/25" : "cursor-not-allowed opacity-40"
              }`}
            >
              Run Signal Check
            </button>
            {(sideA.length > 0 || sideB.length > 0) && (
              <button
                type="button"
                onClick={reset}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface/60 px-3 py-1.5 text-sm font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
                Clear both sides
              </button>
            )}
            {!canAnalyze && !reportLoading && (
              <p id="otc-trade-run-hint" className="text-xs text-ink-subtle">
                Add at least one asset to each side.
              </p>
            )}
          </div>

          <SignalCheckReport
            view={report}
            loading={reportLoading}
            error={reportError}
            simulatedLabels={simulatedLabels}
            droppedCount={droppedCount}
          />

          <AddAssetDialog
            open={pendingAsset !== null}
            asset={pendingAsset}
            sideALabel={sideALabel}
            sideBLabel={sideBLabel}
            onPick={(side) => {
              if (pendingAsset) place(side, pendingAsset);
              closeDialog();
            }}
            onClose={closeDialog}
          />
        </>
      )}
    </section>
  );
}

/** The resolved asset seen as a catalog option, for the instant totals. */
function toOption(asset: ResolvedAsset): TradeItemOption {
  return {
    id: asset.id,
    label: asset.label,
    detail: asset.detail,
    value: asset.value,
    kind: asset.ref.kind === "future-pick" ? "future-pick" : "player",
    estimated: asset.simulated,
    repeatable: asset.repeatable,
  };
}

function TradeSide({
  side,
  heading,
  items,
  total,
  groups,
  usedIds,
  addLabel,
  showPicker,
  onAdd,
  onRemove,
}: {
  side: SideId;
  heading: string;
  items: PlacedItem[];
  total: number;
  groups: TradeItemGroup[];
  usedIds: Set<string>;
  addLabel: string;
  showPicker: boolean;
  onAdd: (side: SideId, optionId: string) => void;
  onRemove: (side: SideId, instanceId: string) => void;
}) {
  const selectId = useId();
  const [pending, setPending] = useState("");

  const availableGroups = groups
    .map((g) => ({
      ...g,
      // The catalog mints the SAME id resolveDraftAsset does, for every group,
      // so used-tracking lines up without a translation step.
      options: g.options.filter((o) => o.ref && (o.repeatable || !usedIds.has(o.id))),
    }))
    .filter((g) => g.options.length > 0);

  const pendingVisible = availableGroups.some((g) => g.options.some((o) => o.id === pending));
  const selectValue = pendingVisible ? pending : "";

  const submit = () => {
    if (!pending) return;
    onAdd(side, pending);
    setPending("");
  };

  return (
    <section
      aria-labelledby={`${selectId}-heading`}
      className="relative overflow-hidden rounded-modal border border-brand-cyan/25 bg-surface/50 p-4 sm:p-5"
      style={{
        boxShadow: "0 0 70px -50px rgba(34, 211, 238, 0.6)",
        backgroundImage:
          "radial-gradient(ellipse at 50% -10%, rgba(34, 211, 238, 0.12) 0%, transparent 60%)",
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage: "linear-gradient(90deg, transparent 0%, #22D3EE 50%, transparent 100%)",
        }}
      />
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={`${selectId}-heading`} className="text-sm font-bold uppercase tracking-wide text-ink">
          {heading}
        </h3>
        <p className="text-right">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
            Board value
          </span>
          <span className="font-mono text-2xl font-bold tabular-nums text-brand-cyan sm:text-3xl">
            {total.toLocaleString()}
          </span>
        </p>
      </div>

      {showPicker && (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={selectId} className="block text-xs font-medium text-ink-muted">
              {addLabel} to {heading}
            </label>
            <select
              id={selectId}
              value={selectValue}
              onChange={(e) => setPending(e.target.value)}
              className="mt-1 w-full min-h-11 rounded-card border border-line bg-base px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <option value="">Choose an asset...</option>
              {availableGroups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label} ({o.value.toLocaleString()}
                      {o.estimated ? ", est." : ""})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={!pending}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-brand-cyan/50 bg-brand-cyan/10 px-3 py-2 text-sm font-semibold text-brand-cyan transition-colors hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="mt-4 rounded-card border border-dashed border-line bg-base/40 px-3 py-4 text-center text-sm text-ink-muted">
          Nothing here yet. Add players or picks to build {heading}.
        </p>
      ) : (
        <ul role="list" className="mt-4 space-y-2">
          {items.map((i) => (
            <li
              key={i.instanceId}
              className="flex items-center justify-between gap-3 rounded-card border border-line bg-base/50 px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-ink">
                  {i.asset.label}
                  {i.asset.simulated && (
                    <span className="ml-1.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                      est.
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-ink-muted">{i.asset.detail}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-sm font-bold tabular-nums text-brand-purple">
                  {i.asset.value.toLocaleString()}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(side, i.instanceId)}
                  aria-label={`Remove ${i.asset.label} from ${heading}`}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-card text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The instant strip. Board totals only, and it says so: the verdict underneath
 * is the graded answer and these two numbers are not it.
 */
function QuickTotals({ result }: { result: TradeAnalysisResult }) {
  return (
    <div className="rounded-modal border border-line bg-surface/40 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-subtle">
        Quick value check
      </p>
      <div aria-live="polite" aria-atomic="true" className="mt-1.5">
        <p className="text-sm font-semibold text-ink">{result.headline}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{result.detail}</p>
      </div>
    </div>
  );
}
