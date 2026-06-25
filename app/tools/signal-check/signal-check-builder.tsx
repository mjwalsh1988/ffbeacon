"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { ArrowRight, Trash2, Scale, Copy, Check } from "lucide-react";
import { AssetAutocomplete, type SearchResult } from "./asset-autocomplete";
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

  function changeFormat(next: string) {
    const nextFormat = formats.find((f) => f.slug === next);
    setFormatSlug(next);
    setResult(null);
    setShareUrl(null);
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
    setResult(null);
    setShareUrl(null);
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
    setResult(null);
    setShareUrl(null);
    setSides((prev) => {
      const removed = prev[side].find((a) => a.key === key);
      if (removed) setNotice(`${removed.name} removed from Side ${side.toUpperCase()}.`);
      return { ...prev, [side]: prev[side].filter((a) => a.key !== key) };
    });
  }

  function buildInput(): AnalysisInput {
    return {
      formatSlug,
      sides: { a: sides.a.map(toInput), b: sides.b.map(toInput) },
    };
  }

  function analyze(save: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await runSignalCheck(buildInput(), save ? { save: true, makePublic: true } : undefined);
      if (res.ok) {
        setResult(res.view);
        if (save) setShareUrl(res.shareUrl);
        // Move focus to the result for screen-reader users.
        requestAnimationFrame(() => resultRef.current?.focus());
      } else {
        setError(res.error);
        setResult(null);
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

      {/* Format selector */}
      <div>
        <label htmlFor="sc-format" className="block text-sm font-medium text-ink">
          League format
        </label>
        <select
          id="sc-format"
          value={formatSlug}
          onChange={(e) => changeFormat(e.target.value)}
          className="mt-2 min-h-11 w-full max-w-sm rounded-card border border-line bg-base px-3 py-2 text-sm text-ink focus:border-brand-purple focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {formats.map((f) => (
            <option key={f.slug} value={f.slug}>
              {f.display}
              {f.allowsPicks ? "" : " (no draft picks)"}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink-subtle">
          Values come from FF Beacon for this format.{" "}
          {allowsPicks ? "Players and draft picks are tradeable." : "Redraft format: players only."}
        </p>
      </div>

      {/* Two sides */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {(["a", "b"] as SideKey[]).map((side) => (
          <section
            key={side}
            aria-labelledby={`side-${side}-heading`}
            className="rounded-card border border-line bg-surface/40 p-4 sm:p-5"
          >
            <h2 id={`side-${side}-heading`} className="text-lg font-semibold text-ink">
              Side {side.toUpperCase()}
            </h2>
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
                <li className="rounded-card border border-dashed border-line px-3 py-4 text-sm text-ink-subtle">
                  No assets yet.
                </li>
              ) : (
                sides[side].map((a) => (
                  <li
                    key={a.key}
                    className="flex items-center justify-between gap-3 rounded-card border border-line bg-base px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{a.name}</span>
                      {a.detail && <span className="block text-xs text-ink-subtle">{a.detail}</span>}
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

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => analyze(false)}
          disabled={isPending || assetCount === 0}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <Scale aria-hidden="true" className="h-4 w-4" />
          {isPending ? "Analyzing..." : "Run Signal Check"}
        </button>
        {result && (
          <button
            type="button"
            onClick={() => analyze(true)}
            disabled={isPending}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Create share link
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-card border border-signal-danger/40 bg-signal-danger/10 p-4 text-sm text-signal-danger">
          {error}
        </p>
      )}

      {/* Results */}
      <div ref={resultRef} tabIndex={-1} aria-live="polite" className="scroll-mt-24 outline-none">
        {result && <ResultPanel view={result} shareUrl={shareUrl} copied={copied} onCopy={copyShare} />}
      </div>
    </div>
  );
}

export function ResultPanel({
  view,
  shareUrl,
  copied,
  onCopy,
}: {
  view: BuilderView;
  shareUrl: string | null;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-modal border border-line bg-surface p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">{view.resultLabel}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{view.verdictLabel}</h2>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm">
        <div>
          <dt className="text-ink-subtle">Format</dt>
          <dd className="font-medium text-ink">{view.formatDisplay}</dd>
        </div>
        {view.tradeShapeLabel && (
          <div>
            <dt className="text-ink-subtle">Trade shape</dt>
            <dd className="font-medium text-ink">{view.tradeShapeLabel}</dd>
          </div>
        )}
        {view.confidenceLabel && (
          <div>
            <dt className="text-ink-subtle">Confidence</dt>
            <dd className="font-medium text-ink">{view.confidenceLabel}</dd>
          </div>
        )}
      </dl>

      <p className="mt-4 text-sm leading-relaxed text-ink-muted">{view.explanation}</p>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {view.sides.map((s) => (
          <div key={s.side} className="rounded-card border border-line bg-base/50 p-4">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-ink">
                Side {s.side.toUpperCase()}
                {view.winnerSide === s.side && (
                  <span className="ml-2 rounded-full bg-brand-cyan/15 px-2 py-0.5 text-xs font-medium text-brand-cyan">
                    Winner
                  </span>
                )}
              </h3>
              {s.total !== null && <span className="text-sm font-medium text-ink-muted">{s.total}</span>}
            </div>
            <ul role="list" className="mt-2 space-y-1">
              {s.assets.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-ink">
                    {a.name}
                    {a.noValue && <span className="ml-1 text-xs text-signal-danger">(no value)</span>}
                  </span>
                  {a.value !== null && <span className="text-xs text-ink-subtle">{a.value}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {view.hasMissingValues && (
        <p className="mt-4 text-xs text-ink-subtle">
          One or more assets had no FF Beacon value and were excluded from the totals.
        </p>
      )}

      {shareUrl && (
        <div className="mt-5 border-t border-line pt-4">
          <label htmlFor="sc-share-url" className="block text-sm font-medium text-ink">
            Shareable link
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="sc-share-url"
              type="text"
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="min-h-11 w-full rounded-card border border-line bg-base px-3 py-2 text-sm text-ink"
            />
            <button
              type="button"
              onClick={onCopy}
              aria-label="Copy share link"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {copied ? <Check aria-hidden="true" className="h-4 w-4 text-brand-cyan" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
            </button>
          </div>
          <p aria-live="polite" className="mt-1 text-xs text-ink-subtle">
            {copied ? "Link copied to clipboard." : ""}
          </p>
        </div>
      )}
    </div>
  );
}
