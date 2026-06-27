"use client";

/**
 * Trade Analyzer (Phase 6C) - REAL draft-room value check.
 *
 * A pool-aware "value check" inside the On The Clock cockpit. The user builds Side
 * A and Side B from the real FF Beacon board; each side totals its value and the
 * result names which side leads in plain English. Two modes, driven by the pool:
 *   - Everyone -> Startup Trade Builder: available players + the user's upcoming
 *     startup picks (each projected to the player expected at that board slot) +
 *     future pick buckets.
 *   - Rookies only -> Rookie Draft Signal Check style: rookies, current rookie
 *     picks, and future rookie buckets, all projected from the rookie board.
 *
 * All values come from lib/on-the-clock/trade-analyzer.ts (pure). The catalog is
 * built by the client from the live board and passed in via `groups`. Placed items
 * snapshot their option, so a player drafted mid-build stays on the side with its
 * value (no surprise removal), and a board reload never mutates a placed asset.
 * NOTHING here calls Sleeper, Supabase, or any API.
 */

import { useId, useMemo, useState } from "react";
import { ArrowLeftRight, Plus, Scale, Sparkles, X, type LucideIcon } from "lucide-react";
import type { PlayerPool } from "@/lib/on-the-clock/types";
import {
  analyzeTradeSides,
  type TradeAnalysisResult,
  type TradeItemGroup,
  type TradeItemOption,
} from "@/lib/on-the-clock/trade-analyzer";
import { EmptyCard } from "./states";

type SideId = "a" | "b";

/** One placed asset on a side: a stable instance id + the chosen option snapshot. */
interface PlacedItem {
  instanceId: string;
  option: TradeItemOption;
}

const SIDE_LABEL: Record<SideId, string> = { a: "Side A", b: "Side B" };

function modeFor(pool: PlayerPool): { modeLabel: string; modeIcon: LucideIcon; addLabel: string; blurb: string } {
  if (pool === "rookies") {
    return {
      modeLabel: "Rookie Draft Signal Check",
      modeIcon: Sparkles,
      addLabel: "Add a rookie or pick",
      blurb:
        "Rookie players use their FF Beacon value; rookie picks are projected from the rookie board. Future picks are estimated. This is a value signal, not a recommendation.",
    };
  }
  return {
    modeLabel: "Startup Trade Builder",
    modeIcon: Scale,
    addLabel: "Add a draft pick",
    blurb:
      "Trade startup draft picks and future picks. A made pick is valued by the player taken, an upcoming pick is projected from the board, and future picks are estimated. This is a value check, not a demand.",
  };
}

export function TradeAnalyzer({
  pool,
  groups,
  boardReady,
}: {
  pool: PlayerPool;
  groups: TradeItemGroup[];
  boardReady: boolean;
}) {
  const { modeLabel, modeIcon: ModeIcon, addLabel, blurb } = modeFor(pool);

  const [sideA, setSideA] = useState<PlacedItem[]>([]);
  const [sideB, setSideB] = useState<PlacedItem[]>([]);
  const [seq, setSeq] = useState(0);

  const optionById = useMemo(() => {
    const map = new Map<string, TradeItemOption>();
    for (const g of groups) for (const o of g.options) map.set(o.id, o);
    return map;
  }, [groups]);

  const setter = (side: SideId) => (side === "a" ? setSideA : setSideB);

  // Ids of unique (non-repeatable) assets already placed on either side. Exact draft
  // slots can only appear once across the whole trade; generic future-pick buckets
  // are repeatable and never enter this set.
  const usedIds = useMemo(() => {
    const s = new Set<string>();
    for (const i of [...sideA, ...sideB]) if (!i.option.repeatable) s.add(i.option.id);
    return s;
  }, [sideA, sideB]);

  const addItem = (side: SideId, optionId: string) => {
    const option = optionById.get(optionId);
    if (!option) return;
    // Block re-adding a unique asset that is already in the trade (either side).
    if (!option.repeatable && usedIds.has(optionId)) return;
    const instanceId = `${side}-${optionId}-${seq}`;
    setSeq((n) => n + 1);
    setter(side)((prev) => [...prev, { instanceId, option }]);
  };

  const removeItem = (side: SideId, instanceId: string) => {
    setter(side)((prev) => prev.filter((i) => i.instanceId !== instanceId));
  };

  const reset = () => {
    setSideA([]);
    setSideB([]);
  };

  const result = analyzeTradeSides(
    sideA.map((i) => i.option),
    sideB.map((i) => i.option),
  );
  const totalA = result.totalA;
  const totalB = result.totalB;

  return (
    <section aria-labelledby="otc-trade-title" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="otc-trade-title"
            className="flex items-center gap-2 text-xl font-bold tracking-tight text-ink sm:text-2xl"
          >
            <ArrowLeftRight aria-hidden="true" className="h-5 w-5 text-brand-cyan" />
            Trade Analyzer
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Check the value of a draft-room trade before you make it.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-purple/40 bg-brand-purple/10 px-3 py-1 text-xs font-semibold text-brand-purple">
          <ModeIcon aria-hidden="true" className="h-3.5 w-3.5" />
          {modeLabel}
        </span>
      </div>

      {!boardReady || groups.length === 0 ? (
        <EmptyCard
          title="Trade values are not available yet."
          body="The Trade Analyzer needs the FF Beacon board for this league's format. Once the board loads, you can build and compare both sides here."
        />
      ) : (
        <>
          <div
            role="note"
            className="rounded-card border border-line bg-surface/40 px-3 py-2 text-xs leading-relaxed text-ink-muted"
          >
            {blurb}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <TradeSide
              side="a"
              items={sideA}
              total={totalA}
              groups={groups}
              usedIds={usedIds}
              addLabel={addLabel}
              onAdd={addItem}
              onRemove={removeItem}
            />
            <TradeSide
              side="b"
              items={sideB}
              total={totalB}
              groups={groups}
              usedIds={usedIds}
              addLabel={addLabel}
              onAdd={addItem}
              onRemove={removeItem}
            />
          </div>

          <ResultPanel result={result} modeLabel={modeLabel} />

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
        </>
      )}
    </section>
  );
}

function TradeSide({
  side,
  items,
  total,
  groups,
  usedIds,
  addLabel,
  onAdd,
  onRemove,
}: {
  side: SideId;
  items: PlacedItem[];
  total: number;
  groups: TradeItemGroup[];
  /** Ids of unique assets already placed anywhere in the trade. */
  usedIds: Set<string>;
  addLabel: string;
  onAdd: (side: SideId, optionId: string) => void;
  onRemove: (side: SideId, instanceId: string) => void;
}) {
  const selectId = useId();
  const [pending, setPending] = useState("");
  const label = SIDE_LABEL[side];

  // Hide already-placed unique assets from the picker; repeatable buckets stay.
  const availableGroups = groups
    .map((g) => ({
      ...g,
      options: g.options.filter((o) => o.repeatable || !usedIds.has(o.id)),
    }))
    .filter((g) => g.options.length > 0);

  // If the pending selection just got placed/hidden, fall back to the placeholder.
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
          "radial-gradient(ellipse at 50% -10%, rgba(34, 211, 238, 0.12) 0%, transparent 60%), linear-gradient(180deg, rgba(34, 211, 238, 0.04) 0%, transparent 40%)",
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #22D3EE 50%, transparent 100%)",
        }}
      />
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={`${selectId}-heading`} className="text-sm font-bold uppercase tracking-wide text-ink">
          {label}
        </h3>
        <p className="text-right">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
            Total value
          </span>
          <span className="font-mono text-2xl font-bold tabular-nums text-brand-cyan sm:text-3xl">
            {total.toLocaleString()}
          </span>
        </p>
      </div>

      {/* Add control. The native select gives type-ahead search and full keyboard
          + screen-reader support with zero custom widget risk. */}
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={selectId} className="block text-xs font-medium text-ink-muted">
            {addLabel} to {label}
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

      {/* Item chips */}
      {items.length === 0 ? (
        <p className="mt-4 rounded-card border border-dashed border-line bg-base/40 px-3 py-4 text-center text-sm text-ink-muted">
          No assets yet. Add players or picks to build {label}.
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
                  {i.option.label}
                  {i.option.estimated && (
                    <span className="ml-1.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                      est.
                    </span>
                  )}
                </span>
                {i.option.detail && (
                  <span className="block truncate text-xs text-ink-muted">{i.option.detail}</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-sm font-bold tabular-nums text-brand-purple">
                  {i.option.value.toLocaleString()}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(side, i.instanceId)}
                  aria-label={`Remove ${i.option.label} from ${label}`}
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

function ResultPanel({ result, modeLabel }: { result: TradeAnalysisResult; modeLabel: string }) {
  const aLeads = result.lean === "a-lean" || result.lean === "a-strong";
  const bLeads = result.lean === "b-lean" || result.lean === "b-strong";
  const accent =
    result.lean === "fair"
      ? "text-brand-cyan"
      : result.lean === "empty"
        ? "text-ink-muted"
        : "text-brand-purple";

  return (
    <div
      className="relative overflow-hidden rounded-modal border border-brand-purple/40 bg-surface/60 p-5"
      style={{
        boxShadow: "0 0 130px -38px rgba(168, 85, 247, 0.7)",
        backgroundImage:
          "radial-gradient(ellipse at 50% -15%, rgba(168, 85, 247, 0.26) 0%, transparent 60%), radial-gradient(ellipse at 0% 110%, rgba(168, 85, 247, 0.14) 0%, transparent 55%), radial-gradient(ellipse at 100% 110%, rgba(34, 211, 238, 0.12) 0%, transparent 55%)",
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-0.5"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
        {modeLabel} result
      </p>

      {/* Big side-by-side totals (color is never the only signal: the "(leads)"
          text and the headline below carry the lean). */}
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <div
          className={`rounded-card border bg-base/50 px-3 py-2.5 ${
            aLeads ? "border-brand-purple/50" : "border-line"
          }`}
        >
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
            Side A {aLeads ? "(leads)" : ""}
          </dt>
          <dd className="mt-0.5 font-mono text-2xl font-bold tabular-nums text-ink">
            {result.totalA.toLocaleString()}
          </dd>
        </div>
        <div
          className={`rounded-card border bg-base/50 px-3 py-2.5 ${
            bLeads ? "border-brand-purple/50" : "border-line"
          }`}
        >
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
            Side B {bLeads ? "(leads)" : ""}
          </dt>
          <dd className="mt-0.5 font-mono text-2xl font-bold tabular-nums text-ink">
            {result.totalB.toLocaleString()}
          </dd>
        </div>
      </dl>

      {/* Screen-reader-friendly result: a single polite live region carrying the
          full headline + explanation, announced whenever the trade changes. */}
      <div aria-live="polite" aria-atomic="true" className="mt-4">
        <p className={`text-lg font-bold tracking-tight ${accent}`}>{result.headline}</p>
        <p className="mt-1 text-sm leading-relaxed text-ink">{result.detail}</p>
      </div>
    </div>
  );
}
