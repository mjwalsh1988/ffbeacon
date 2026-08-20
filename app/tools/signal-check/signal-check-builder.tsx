"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { Scale, Trash2, RotateCcw, Loader2 } from "lucide-react";
import { AssetAutocomplete, type SearchResult } from "./asset-autocomplete";
import { AssetAvatar } from "./asset-avatar";
import { LeagueFormatSelector } from "./league-format-selector";
import { TradeResult, type ResultAssetMetaBySide } from "./trade-result";
import { runSignalCheck } from "./actions";
import type { BuilderView } from "@/lib/signal-check/builder-view";
import type { AnalysisInput, SideKey } from "@/lib/signal-check/types";

/**
 * Per-side colour. Side A is purple and Side B is cyan, matching the value
 * balance bars in the result, so the side you built on the left is the side you
 * read on the left. Colour is never the only cue: each panel keeps its "Side A"
 * / "Side B" heading and a letter badge.
 */
const SIDE_ACCENT: Record<SideKey, {
  border: string;
  edge: string;
  tint: string;
  badge: string;
  dashed: string;
}> = {
  a: {
    border: "border-brand-purple/40",
    edge: "border-l-brand-purple",
    tint: "bg-brand-purple/[0.07]",
    badge: "border-brand-purple/50 bg-brand-purple/20 text-brand-purple",
    dashed: "border-brand-purple/30",
  },
  b: {
    border: "border-brand-cyan/40",
    edge: "border-l-brand-cyan",
    tint: "bg-brand-cyan/[0.07]",
    badge: "border-brand-cyan/50 bg-brand-cyan/20 text-brand-cyan",
    dashed: "border-brand-cyan/30",
  },
};

export interface FormatOption {
  slug: string;
  display: string;
  leagueType: string;
  allowsPicks: boolean;
}

interface SelectedAsset {
  // Stable per-instance id, used for the React list key and removal. Picks may
  // appear multiple times in one trade, so the asset identity (`key`) is not
  // unique across instances; `id` always is.
  id: string;
  // Asset identity (player id, or pick descriptor). Used to dedup players.
  key: string;
  kind: "player" | "pick";
  name: string;
  detail: string | null;
  playerId?: string;
  sleeperId?: string | null;
  position?: string | null;
  team?: string | null;
  season?: number;
  round?: number;
  pickPosition?: "early" | "mid" | "late";
}

function fromResult(r: SearchResult): Omit<SelectedAsset, "id"> {
  if (r.kind === "player") {
    return {
      key: `player:${r.playerId}`,
      kind: "player",
      name: r.name,
      detail: [r.position, r.team].filter(Boolean).join(", ") || null,
      playerId: r.playerId,
      sleeperId: r.sleeperId,
      position: r.position,
      team: r.team,
    };
  }
  return {
    key: `pick:${r.season}:${r.round}:${r.pickPosition ?? "unknown"}`,
    kind: "pick",
    name: r.label,
    detail: "Draft pick",
    season: r.season,
    round: r.round,
    pickPosition: r.pickPosition ?? undefined,
  };
}

function toInput(a: SelectedAsset): AnalysisInput["sides"]["a"][number] {
  if (a.kind === "player") return { kind: "player", playerId: a.playerId! };
  return a.pickPosition
    ? { kind: "pick", season: a.season!, round: a.round!, pickPosition: a.pickPosition }
    : { kind: "pick", season: a.season!, round: a.round! };
}

/** Build the per-side headshot metadata for the result, aligned to submit order. */
function toAssetMeta(sides: Record<SideKey, SelectedAsset[]>): ResultAssetMetaBySide {
  const mapSide = (list: SelectedAsset[]) =>
    list.map((a) => ({
      kind: a.kind,
      sleeperId: a.sleeperId ?? null,
      round: a.round ?? null,
    }));
  return { a: mapSide(sides.a), b: mapSide(sides.b) };
}

export function SignalCheckBuilder({
  formats,
  minLength,
  initialFormatSlug = "",
  initialFormatFromHeader = false,
  toolbarLeading,
}: {
  formats: FormatOption[];
  minLength: number;
  /** Format the builder opens on, resolved by the page from the reader's own
   * header preference (falling back to the first format Signal Check can
   * price). Empty string means no preselection. */
  initialFormatSlug?: string;
  /** True when `initialFormatSlug` came from the reader's header choice rather
   * than from the fallback, which is the only case worth explaining. */
  initialFormatFromHeader?: boolean;
  /** Rendered to the left of the format chip in the toolbar row above the
   * trade. The page puts the Sleeper import button here. */
  toolbarLeading?: ReactNode;
}) {
  // Format drives every value, so it is never guessed. It starts on whatever
  // the page resolved from the reader's own header preference.
  const [formatSlug, setFormatSlug] = useState(initialFormatSlug);
  // Tracks whether the current selection is still the preselected one, so the
  // selector can explain where it came from. Cleared the moment the reader
  // picks for themselves, since the explanation stops being true.
  const [preselected, setPreselected] = useState(initialFormatFromHeader);
  // The format list stays collapsed behind the chip unless there is nothing
  // selected yet, in which case the choice is the first thing to make.
  const [formatOpen, setFormatOpen] = useState(initialFormatSlug === "");
  const [sides, setSides] = useState<Record<SideKey, SelectedAsset[]>>({ a: [], b: [] });
  const [result, setResult] = useState<BuilderView | null>(null);
  const [resultMeta, setResultMeta] = useState<ResultAssetMetaBySide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>("");
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  // Monotonic counter for unique per-instance asset ids (React keys + removal).
  const instanceCounter = useRef(0);

  const activeFormat = useMemo(
    () => formats.find((f) => f.slug === formatSlug),
    [formats, formatSlug],
  );
  const allowsPicks = activeFormat?.allowsPicks ?? false;
  const hasFormat = formatSlug !== "";
  const assetCount = sides.a.length + sides.b.length;
  const canRun = hasFormat && sides.a.length > 0 && sides.b.length > 0;

  function resetResult() {
    setResult(null);
    setResultMeta(null);
    setShareUrl(null);
  }

  function changeFormat(next: string) {
    const nextFormat = formats.find((f) => f.slug === next);
    setFormatSlug(next);
    setPreselected(false);
    resetResult();
    // The list collapses back behind the chip on selection, so say what the
    // chip now reads rather than leaving the change silent.
    if (nextFormat) setNotice(`Format set to ${nextFormat.display}.`);
    // Picks are dynasty-only: drop any picks when moving to a redraft format.
    if (nextFormat && !nextFormat.allowsPicks) {
      let removed = 0;
      setSides((prev) => {
        const filter = (list: SelectedAsset[]) => {
          const kept = list.filter((a) => a.kind !== "pick");
          removed += list.length - kept.length;
          return kept;
        };
        return { a: filter(prev.a), b: filter(prev.b) };
      });
      if (removed > 0) {
        setNotice(
          `Format set to ${nextFormat.display}. Removed ${removed} draft pick${removed === 1 ? "" : "s"} not valid in a redraft format.`,
        );
      }
    }
  }

  function addAsset(side: SideKey, r: SearchResult) {
    const base = fromResult(r);
    const id = `inst-${instanceCounter.current++}`;
    resetResult();
    setSides((prev) => {
      // Players can appear only once across the entire trade. Draft picks have
      // no cap: the same pick descriptor may be added to either side as many
      // times as the user wants.
      if (base.kind === "player" && [...prev.a, ...prev.b].some((a) => a.key === base.key)) {
        setNotice(`${base.name} is already in this trade.`);
        return prev;
      }
      setNotice(`${base.name} added to Side ${side.toUpperCase()}.`);
      return { ...prev, [side]: [...prev[side], { ...base, id }] };
    });
  }

  function removeAsset(side: SideKey, id: string) {
    resetResult();
    setSides((prev) => {
      const removed = prev[side].find((a) => a.id === id);
      if (removed) setNotice(`${removed.name} removed from Side ${side.toUpperCase()}.`);
      return { ...prev, [side]: prev[side].filter((a) => a.id !== id) };
    });
  }

  function clearAll() {
    resetResult();
    setSides({ a: [], b: [] });
    setError(null);
    setNotice("Trade cleared.");
  }

  function buildInput(): AnalysisInput {
    return {
      formatSlug,
      sides: { a: sides.a.map(toInput), b: sides.b.map(toInput) },
    };
  }

  function analyze(save: boolean) {
    setError(null);
    const snapshot = toAssetMeta(sides);
    startTransition(async () => {
      const res = await runSignalCheck(buildInput(), save ? { save: true, makePublic: true } : undefined);
      if (res.ok) {
        setResult(res.view);
        setResultMeta(snapshot);
        if (save) {
          setShareUrl(res.shareUrl);
          // Focus is handled inside TradeResult: it moves to the share input
          // when the link appears, so don't yank it back to the result top.
        } else {
          // Move focus to the result for screen-reader users.
          requestAnimationFrame(() => resultRef.current?.focus());
        }
      } else {
        setError(res.error);
        resetResult();
      }
    });
  }

  async function copyShare() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable; the input is selectable as a fallback */
    }
  }

  return (
    <div className="space-y-6">
      {/* Live region for add/remove/format announcements. */}
      <p aria-live="polite" className="sr-only">
        {notice}
      </p>

      {/* Toolbar: Sleeper import (supplied by the page) and the format chip.
          Both are small on purpose so the trade itself is the first thing on
          screen under the hero. */}
      <LeagueFormatSelector
        formats={formats}
        value={formatSlug}
        onChange={changeFormat}
        preselected={preselected}
        open={formatOpen}
        onOpenChange={setFormatOpen}
        leading={toolbarLeading}
      />

      {/* Build the trade */}
      <section aria-labelledby="build-step-heading">
        <div className="flex items-center gap-2">
          <h2 id="build-step-heading" className="text-base font-semibold text-ink">
            Build the trade
          </h2>
          {assetCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-card px-3 py-1 text-xs font-medium text-ink-muted transition-colors hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
              Clear all
            </button>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(["a", "b"] as SideKey[]).map((side) => {
            const accent = SIDE_ACCENT[side];
            return (
              <section
                key={side}
                aria-labelledby={`side-${side}-heading`}
                className={`rounded-card border border-l-4 p-4 sm:p-5 ${accent.border} ${accent.edge} ${accent.tint}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3
                    id={`side-${side}-heading`}
                    className="flex items-center gap-2 text-lg font-semibold text-ink"
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-card border text-sm font-bold ${accent.badge}`}
                    >
                      {side.toUpperCase()}
                    </span>
                    Side {side.toUpperCase()}
                  </h3>
                  <span
                    className={`shrink-0 rounded-full border bg-base px-2 py-0.5 text-xs text-ink-subtle ${accent.border}`}
                  >
                    {sides[side].length} {sides[side].length === 1 ? "asset" : "assets"}
                  </span>
                </div>
                <div className="mt-3">
                  <AssetAutocomplete
                    sideLabel={`Side ${side.toUpperCase()}`}
                    formatSlug={formatSlug}
                    allowsPicks={allowsPicks}
                    minLength={minLength}
                    onSelect={(r) => addAsset(side, r)}
                  />
                </div>
  
                <ul role="list" aria-label={`Assets on Side ${side.toUpperCase()}`} className="mt-4 space-y-2">
                  {sides[side].length === 0 ? (
                    <li
                      className={`flex items-center gap-2 rounded-card border border-dashed px-3 py-4 text-sm text-ink-subtle ${accent.dashed}`}
                    >
                      {allowsPicks
                        ? "Add players or draft picks to this side."
                        : "Add players to this side."}
                    </li>
                  ) : (
                    sides[side].map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center gap-3 rounded-card border border-line bg-base px-3 py-2"
                      >
                        <AssetAvatar
                          kind={a.kind}
                          sleeperId={a.sleeperId ?? null}
                          round={a.round ?? null}
                          name={a.name}
                          size={44}
                          decorative
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{a.name}</span>
                          {a.detail && (
                            <span className="block truncate text-xs text-ink-subtle">{a.detail}</span>
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeAsset(side, a.id)}
                          aria-label={`Remove ${a.name} from Side ${side.toUpperCase()}`}
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted transition-colors hover:border-signal-danger/60 hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                        >
                          <Trash2 aria-hidden="true" className="h-4 w-4" />
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      </section>

      {/* Run bar. The hint stays first in the DOM so it is read before the
          button on mobile, where it sits above it; `sm:flex-row-reverse` puts
          the buttons on the left on desktop and the hint on the right. The
          hint is also the button's description, so it is announced with the
          button either way and the swap costs a screen-reader user nothing. */}
      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface/40 p-4 sm:flex-row-reverse sm:items-center sm:justify-between">
        <p id="run-bar-hint" className="text-sm text-ink-muted sm:text-right">
          {canRun
            ? "Ready to check. We weigh both sides with FF Beacon Values for your format."
            : !hasFormat
              ? "Set your league format with the Format button above to run the check."
              : "Add at least one asset to each side to run the check."}
        </p>
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          <button
            type="button"
            onClick={() => analyze(false)}
            disabled={isPending || !canRun}
            aria-describedby="run-bar-hint"
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
          >
            {isPending ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Scale aria-hidden="true" className="h-4 w-4" />
            )}
            {isPending ? "Checking..." : "Run Signal Check"}
          </button>
          {result && !shareUrl && (
            <button
              type="button"
              onClick={() => analyze(true)}
              disabled={isPending}
              className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
            >
              Create share link
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-card border border-signal-danger/40 bg-signal-danger/10 p-4 text-sm text-signal-danger">
          {error}
        </p>
      )}

      {/* Concise result announcement. The full result subtree below is NOT a
          live region (it would announce hero + margin + both sides + every
          explainer at once); instead we move focus there and announce a short
          summary here. */}
      <p aria-live="polite" className="sr-only">
        {isPending
          ? "Checking the trade."
          : result
            ? `Result ready. ${result.verdictLabel} Value ${result.isNeutral ? "spread" : "margin"} ${result.marginPct} percent.`
            : ""}
      </p>

      {/* Result region: empty -> loading -> result */}
      <div
        ref={resultRef}
        tabIndex={-1}
        role="region"
        aria-label="Signal Check result"
        className="scroll-mt-24 outline-none"
      >
        {isPending ? (
          <ResultLoading />
        ) : result ? (
          <TradeResult
            view={result}
            shareUrl={shareUrl}
            copied={copied}
            onCopy={copyShare}
            assetMeta={resultMeta ?? undefined}
          />
        ) : !error ? (
          <ResultEmpty canRun={canRun} />
        ) : null}
      </div>
    </div>
  );
}

function ResultEmpty({ canRun }: { canRun: boolean }) {
  return (
    <div className="rounded-modal border border-dashed border-line bg-surface/30 p-8 text-center">
      <span
        aria-hidden="true"
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-line bg-base text-brand-cyan"
      >
        <Scale className="h-5 w-5" />
      </span>
      <p className="mt-4 text-base font-semibold text-ink">
        {canRun ? "You're all set. Run the check." : "Your verdict shows up here"}
      </p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
        {canRun
          ? "Press Run Signal Check to see who wins, by how much, and why."
          : "Pick your format, add players to both sides, then run the check to get the Beacon Verdict."}
      </p>
    </div>
  );
}

function ResultLoading() {
  return (
    <div className="rounded-modal border border-line bg-surface p-6" aria-busy="true">
      <p className="flex items-center gap-2 text-sm font-medium text-brand-cyan">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        Weighing both sides with FF Beacon Values...
      </p>
      <div aria-hidden="true" className="mt-5 space-y-4">
        <div className="h-8 w-2/3 animate-pulse rounded-card bg-line/60" />
        <div className="space-y-2.5">
          <div className="h-3.5 w-full animate-pulse rounded-full bg-line/60" />
          <div className="h-3.5 w-5/6 animate-pulse rounded-full bg-line/50" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="h-24 animate-pulse rounded-card bg-line/40" />
          <div className="h-24 animate-pulse rounded-card bg-line/40" />
        </div>
      </div>
    </div>
  );
}
