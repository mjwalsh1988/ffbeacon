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
 * The board also SHOWS the trade. Every pick already on a side wears a ring and
 * a footer naming that side, and pressing it takes it back out, so a deal being
 * assembled off a 400-cell board can be read and edited without scrolling down
 * to the side lists to find out what is in it. Both views read placedPickSides,
 * which is derived from the two side arrays, so a pick removed from either view
 * disappears from the other in the same render, and the dropdown that had been
 * suppressing it as "already used" offers it again.
 *
 * ONE VERDICT
 * Each side shows its running board total, so the numbers move at the speed of
 * clicking. The only graded answer is Signal Check's, which lands underneath
 * after a round trip: the same pipeline /tools/signal-check runs, with
 * calibration, the value adjustment, thresholds, confidence, and the written
 * explanation. There used to be a second verdict here, a plain totals
 * comparison printed above the button, and it regularly disagreed with the one
 * below it. Two answers to one question is worse than a slower single answer,
 * so it is gone.
 *
 * Nothing here calls Sleeper. The analysis goes through a server action that
 * re-derives the format from the cached league and prices asset references
 * itself; the client never sends a value or a format.
 */

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ArrowLeftRight, LayoutGrid, List, Plus, Scale, Sparkles, X, type LucideIcon } from "lucide-react";
import type { PlayerPool, ShapedDraftCache } from "@/lib/on-the-clock/types";
import type { CurrentDraftPick } from "@/lib/on-the-clock/pick-ownership";
import type { TradeItemGroup, TradeItemOption } from "@/lib/on-the-clock/trade-analyzer";
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
import { DraftBoard, type PlacedPickMark } from "./draft-board";
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
        "An unmade pick is priced as the player Sleeper ADP says goes there. Future-year picks use FF Beacon pick values.",
    };
  }
  return {
    modeLabel: "Startup draft",
    modeIcon: Scale,
    addLabel: "Add a draft pick",
    blurb:
      "A made pick is worth the player taken. An unmade one is priced by Sleeper ADP. Future-year picks use FF Beacon pick values, since an unscouted class has none.",
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
  /**
   * What the last board cell press did, or why it did nothing. The tone matters
   * now that a press can succeed: "removed from the trade" printed in the amber
   * this line uses for refusals reads as something having gone wrong.
   */
  const [pickNotice, setPickNotice] = useState<{ text: string; tone: "done" | "refused" }>({
    text: "",
    tone: "refused",
  });
  const clearPickNotice = useCallback(() => {
    setPickNotice({ text: "", tone: "refused" });
  }, []);
  const announcePickNotice = useCallback(
    (text: string, tone: "done" | "refused" = "refused") => {
      // Cleared first, then set, so the SAME message twice in a row speaks
      // twice. Writing an identical string changes no text node, and a live
      // region with no change announces nothing.
      setPickNotice({ text: "", tone });
      window.setTimeout(() => setPickNotice({ text, tone }), 60);
    },
    [],
  );

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

  // useCallback because the board's press handler depends on it, and that
  // handler is a prop on a memoized 400-cell table. No deps: `setter` only ever
  // returns setSideA or setSideB, and a state setter is stable for the life of
  // the component.
  const removeItem = useCallback((side: SideId, instanceId: string) => {
    setter(side)((prev) => prev.filter((i) => i.instanceId !== instanceId));
    setReport(null);
    setReportError(null);
  }, []);

  const reset = () => {
    setSideA([]);
    setSideB([]);
    setReport(null);
    setReportError(null);
  };

  const headingA = myRosterId !== null ? "Your side" : "Side A";
  const headingB = "The other side";

  /**
   * Every board pick currently in the trade, keyed by its overall pick number,
   * carrying the side it sits on and the instance to pull when it comes back
   * off. Derived from the same two arrays the side lists render, so the board
   * and the builder cannot disagree: removing from either one is removing from
   * this, and both re-render off it.
   *
   * `sideLabel` is deliberately shorter than the side headings ("Other side",
   * not "The other side"), because it has to fit a 7.5rem cell footer.
   */
  const placedPickSides = useMemo(() => {
    const map = new Map<number, PlacedPickMark & { instanceId: string; label: string }>();
    const sides: Array<[SideId, PlacedItem[], string]> = [
      ["a", sideA, headingA],
      ["b", sideB, "Other side"],
    ];
    for (const [side, items, sideLabel] of sides) {
      for (const i of items) {
        if (i.asset.ref.kind !== "current-pick") continue;
        map.set(i.asset.ref.overall, {
          side,
          sideLabel,
          instanceId: i.instanceId,
          label: i.asset.label,
        });
      }
    }
    return map;
  }, [sideA, sideB, headingA]);

  /**
   * One press per board cell, doing whichever of the two things that cell is
   * for: adding the pick, or taking a pick already in the trade back out. A
   * press that does NOTHING has to say why, because silence off a button reads
   * as a broken control.
   *
   * Removal lives on the cell itself rather than in a small button drawn inside
   * it. A cell is already a button and buttons do not nest, and a control that
   * fit alongside the pick in a 7.5rem cell would be far under the 44px tap
   * target this board holds everywhere else.
   */
  // useCallback, or DraftBoard's React.memo is dead here: an inline arrow is a
  // new prop on every render, so every keystroke in this builder re-rendered all
  // 400-odd board cells.
  const onSelectPick = useCallback((overall: number) => {
    if (!resolveContext) return;
    const placed = placedPickSides.get(overall);
    if (placed) {
      removeItem(placed.side, placed.instanceId);
      announcePickNotice(`${placed.label} removed from the trade.`, "done");
      return;
    }
    const slot = currentPicks.find((p) => p.overall === overall);
    const slotLabel = slot ? `${slot.round}.${String(slot.pickInRound).padStart(2, "0")}` : `pick ${overall}`;
    const asset = resolveDraftAsset({ kind: "current-pick", overall }, resolveContext);
    if (!asset) {
      announcePickNotice(
        `${slotLabel} cannot be priced from this board, so it cannot be traded.`,
      );
      return;
    }
    // A repeatable asset (a generic future bucket) never comes from the board,
    // so anything left that is already used is a pick placed under a different
    // id than the board mints, which the placed map above would have caught.
    if (!asset.repeatable && usedIds.has(asset.id)) {
      announcePickNotice(`${asset.label} is already in this trade.`);
      return;
    }
    clearPickNotice();
    setReturnFocusTo(overall);
    setPendingAsset(asset);
  }, [
    resolveContext,
    currentPicks,
    usedIds,
    announcePickNotice,
    clearPickNotice,
    placedPickSides,
    removeItem,
  ]);

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

  // Running board totals only. Deliberately not a verdict: the graded answer is
  // Signal Check's, and a second opinion sitting next to it just confused people.
  const totalA = sideA.reduce((sum, i) => sum + i.asset.value, 0);
  const totalB = sideB.reduce((sum, i) => sum + i.asset.value, 0);

  const sideALabel =
    myRosterId !== null ? `your side (${teamNameByRosterId[myRosterId] ?? "you"})` : "Side A";
  const sideBLabel = "the other side";

  // The strip that used to sit under the two sides carried the only live region
  // for the running totals, so deleting it would have left a screen-reader user
  // adding assets in silence. The announcement stays; the verdict it used to
  // print does not.
  const totalsAnnouncement =
    sideA.length > 0 || sideB.length > 0
      ? `Board value: ${headingA} ${totalA.toLocaleString()}, the other side ${totalB.toLocaleString()}.`
      : "";

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
          body="The Trade Builder needs this format's FF Beacon board. Both sides price up once it loads."
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
                Every cell is a button. Choose a pick and we will ask which side it belongs on. Picks
                already in the trade are ringed in white and footed with their side; press one again
                to take it out.
              </p>
              {/* What the last press did, or why it did nothing. Mounted empty
                  and written into, so the message actually announces. */}
              <p
                role="status"
                aria-live="polite"
                className={`mb-2 text-xs ${
                  pickNotice.tone === "done" ? "text-brand-cyan" : "text-amber-300"
                }`}
              >
                {pickNotice.text}
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
                placedPickSides={placedPickSides}
              />
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <TradeSide
              side="a"
              heading={headingA}
              items={sideA}
              total={totalA}
              groups={groups}
              usedIds={usedIds}
              addLabel={addLabel}
              showPicker={buildFrom === "list"}
              onAdd={addFromOption}
              onRemove={removeItem}
            />
            <TradeSide
              side="b"
              heading={headingB}
              items={sideB}
              total={totalB}
              groups={groups}
              usedIds={usedIds}
              addLabel={addLabel}
              showPicker={buildFrom === "list"}
              onAdd={addFromOption}
              onRemove={removeItem}
            />
          </div>

          <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {totalsAnnouncement}
          </p>

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
