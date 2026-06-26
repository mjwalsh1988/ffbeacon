"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Scale, Trash2, RotateCcw, Loader2 } from "lucide-react";
import { AssetAutocomplete, type SearchResult } from "./asset-autocomplete";
import { AssetAvatar } from "./asset-avatar";
import { LeagueFormatSelector } from "./league-format-selector";
import { TradeResult, type ResultAssetMetaBySide } from "./trade-result";
import { runSignalCheck } from "./actions";
import type { BuilderView } from "@/lib/signal-check/builder-view";
import type { AnalysisInput, SideKey } from "@/lib/signal-check/types";

export interface FormatOption {
  slug: string;
  display: string;
  leagueType: string;
  allowsPicks: boolean;
}

interface SelectedAsset {
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

function fromResult(r: SearchResult): SelectedAsset {
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
  defaultFormatSlug,
  minLength,
}: {
  formats: FormatOption[];
  defaultFormatSlug: string;
  minLength: number;
}) {
  const [formatSlug, setFormatSlug] = useState(
    formats.some((f) => f.slug === defaultFormatSlug) ? defaultFormatSlug : (formats[0]?.slug ?? ""),
  );
  const [sides, setSides] = useState<Record<SideKey, SelectedAsset[]>>({ a: [], b: [] });
  const [result, setResult] = useState<BuilderView | null>(null);
  const [resultMeta, setResultMeta] = useState<ResultAssetMetaBySide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>("");
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  const activeFormat = useMemo(
    () => formats.find((f) => f.slug === formatSlug),
    [formats, formatSlug],
  );
  const allowsPicks = activeFormat?.allowsPicks ?? false;
  const assetCount = sides.a.length + sides.b.length;
  const canRun = sides.a.length > 0 && sides.b.length > 0;

  function resetResult() {
    setResult(null);
    setResultMeta(null);
    setShareUrl(null);
  }

  function changeFormat(next: string) {
    const nextFormat = formats.find((f) => f.slug === next);
    setFormatSlug(next);
    resetResult();
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
        setNotice(`Removed ${removed} draft pick${removed === 1 ? "" : "s"} not valid in a redraft format.`);
      }
    }
  }

  function addAsset(side: SideKey, r: SearchResult) {
    const asset = fromResult(r);
    resetResult();
    setSides((prev) => {
      if (prev[side].some((a) => a.key === asset.key)) {
        setNotice(`${asset.name} is already on that side.`);
        return prev;
      }
      setNotice(`${asset.name} added to Side ${side.toUpperCase()}.`);
      return { ...prev, [side]: [...prev[side], asset] };
    });
  }

  function removeAsset(side: SideKey, key: string) {
    resetResult();
    setSides((prev) => {
      const removed = prev[side].find((a) => a.key === key);
      if (removed) setNotice(`${removed.name} removed from Side ${side.toUpperCase()}.`);
      return { ...prev, [side]: prev[side].filter((a) => a.key !== key) };
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
    <div className="space-y-8">
      {/* Live region for add/remove/format announcements. */}
      <p aria-live="polite" className="sr-only">
        {notice}
      </p>

      {/* Step 1: format */}
      <LeagueFormatSelector formats={formats} value={formatSlug} onChange={changeFormat} />

      {/* Step 2: build the trade */}
      <section aria-labelledby="build-step-heading">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-beacon text-xs font-bold text-black"
          >
            2
          </span>
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
          {(["a", "b"] as SideKey[]).map((side) => (
            <section
              key={side}
              aria-labelledby={`side-${side}-heading`}
              className="rounded-card border border-line bg-surface/40 p-4 sm:p-5"
            >
              <div className="flex items-center justify-between">
                <h3 id={`side-${side}-heading`} className="text-lg font-semibold text-ink">
                  Side {side.toUpperCase()}
                </h3>
                <span className="rounded-full border border-line bg-base px-2 py-0.5 text-xs text-ink-subtle">
                  {sides[side].length} {sides[side].length === 1 ? "asset" : "assets"}
                </span>
              </div>
              <div className="mt-3">
                <AssetAutocomplete
                  sideLabel={`Side ${side.toUpperCase()}`}
                  formatSlug={formatSlug}
                  minLength={minLength}
                  onSelect={(r) => addAsset(side, r)}
                />
              </div>

              <ul role="list" aria-label={`Assets on Side ${side.toUpperCase()}`} className="mt-4 space-y-2">
                {sides[side].length === 0 ? (
                  <li className="flex items-center gap-2 rounded-card border border-dashed border-line px-3 py-4 text-sm text-ink-subtle">
                    {allowsPicks
                      ? "Add players or draft picks to this side."
                      : "Add players to this side."}
                  </li>
                ) : (
                  sides[side].map((a) => (
                    <li
                      key={a.key}
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
                        onClick={() => removeAsset(side, a.key)}
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
          ))}
        </div>
      </section>

      {/* Run bar */}
      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface/40 p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">
          {canRun
            ? "Ready to check. We weigh both sides with FF Beacon Values for your format."
            : "Add at least one asset to each side to run the check."}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => analyze(false)}
            disabled={isPending || !canRun}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
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
              className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
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
