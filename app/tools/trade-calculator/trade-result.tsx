"use client";

import { useEffect, useRef } from "react";
import { Check, Copy, Lightbulb, ScrollText, Sparkles, Trophy } from "lucide-react";
import type { BuilderView } from "@/lib/signal-check/builder-view";
import {
  BLENDED_PICKS_NOTE,
  ESTIMATED_PICKS_NOTE,
  MISSING_VALUES_NOTE,
} from "@/lib/signal-check/copy";
import type { SideKey } from "@/lib/signal-check/types";
import { AssetAvatar } from "./asset-avatar";
import { TradeMarginGraph } from "./trade-margin-graph";
import { ValueAdjustmentRow } from "@/components/value-adjustment-row";

/** Per-asset headshot metadata, aligned by index to view.sides[side].assets. */
export interface ResultAssetMeta {
  kind: "player" | "pick";
  sleeperId: string | null;
  round?: number | null;
}

export type ResultAssetMetaBySide = Record<SideKey, ResultAssetMeta[]>;

function sideLabel(view: BuilderView, side: SideKey): string {
  const s = view.sides.find((x) => x.side === side);
  return s?.teamLabel || `Side ${side.toUpperCase()}`;
}

/** Plain-English read on how close the trade is. */
function closenessTip(view: BuilderView): string {
  if (view.isNeutral) {
    return "This one is close. When the values are this even, your team's needs usually matter more than the raw numbers.";
  }
  if (view.isBlowout) {
    return "This is a lopsided trade by value. One side is getting a lot more than the other.";
  }
  return "One side comes out ahead, but the gap is not huge. Team needs could still tip the scales.";
}

/** Plain-English note about why this format changes the math. */
function formatTip(formatDisplay: string): string {
  const d = formatDisplay.toLowerCase();
  if (/super.?flex|sflex|2qb/.test(d)) {
    return "In Superflex leagues you can start an extra quarterback, so QBs carry more weight here.";
  }
  if (/tep|te premium|tight end premium/.test(d)) {
    return "This is a tight end premium format, so tight ends are worth more than usual.";
  }
  if (/dynasty|keeper/.test(d)) {
    return "In dynasty leagues, long-term value and draft picks matter, not just this season.";
  }
  return "This is a redraft format, so only this season counts. Proven win-now players carry the most value.";
}

export function TradeResult({
  view,
  shareUrl,
  copied,
  onCopy,
  assetMeta,
}: {
  view: BuilderView;
  shareUrl: string | null;
  copied: boolean;
  onCopy: () => void;
  assetMeta?: ResultAssetMetaBySide;
}) {
  const totalA = view.sides.find((s) => s.side === "a")?.total ?? null;
  const totalB = view.sides.find((s) => s.side === "b")?.total ?? null;

  // When a share link is created, the input is far below the result, so move
  // focus to it (which scrolls it into view and pre-selects it for copying).
  const shareInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (shareUrl) {
      shareInputRef.current?.focus();
      shareInputRef.current?.select();
    }
  }, [shareUrl]);

  return (
    <div className="space-y-5">
      <ResultHero view={view} />

      <TradeMarginGraph
        marginPct={view.marginPct}
        winnerSide={view.winnerSide}
        isNeutral={view.isNeutral}
        sideALabel={sideLabel(view, "a")}
        sideBLabel={sideLabel(view, "b")}
        totalA={totalA}
        totalB={totalB}
      />

      {/* Per-side breakdown */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {view.sides.map((s) => {
          const meta = assetMeta?.[s.side];
          const isWinner = view.winnerSide === s.side;
          return (
            <div
              key={s.side}
              className={`rounded-card border p-4 ${
                isWinner ? "border-brand-cyan/50 bg-brand-cyan/[0.04]" : "border-line bg-base/50"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                  {sideLabel(view, s.side)}
                  {isWinner && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-cyan/15 px-2 py-0.5 text-xs font-medium text-brand-cyan">
                      <Trophy aria-hidden="true" className="h-3 w-3" />
                      Winner
                    </span>
                  )}
                </h3>
                {s.total !== null && (
                  <span className="text-sm font-semibold tabular-nums text-ink-muted">
                    {s.total.toLocaleString()}
                  </span>
                )}
              </div>

              <ul role="list" className="mt-3 space-y-2">
                {s.assets.map((a, i) => {
                  const m = meta?.[i];
                  const kind: "player" | "pick" =
                    m?.kind ??
                    (a.detail?.toLowerCase().startsWith("draft pick") ? "pick" : "player");
                  return (
                    <li key={i} className="flex items-center gap-2.5">
                      <AssetAvatar
                        kind={kind}
                        sleeperId={m?.sleeperId ?? null}
                        round={m?.round ?? null}
                        name={a.name}
                        size={36}
                        decorative
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {a.name}
                          {a.noValue && (
                            <span className="ml-1 text-xs font-normal text-signal-danger">
                              (no value)
                            </span>
                          )}
                        </span>
                        {a.detail && (
                          <span className="block truncate text-xs text-ink-subtle">{a.detail}</span>
                        )}
                      </span>
                      {a.value !== null && (
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-ink-muted">
                          {a.value.toLocaleString()}
                        </span>
                      )}
                    </li>
                  );
                })}
                {view.adjustmentLabel && (
                  <ValueAdjustmentRow
                    label={view.adjustmentLabel}
                    points={s.adjustment}
                    pct={s.adjustmentPct}
                  />
                )}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Plain-English explainers */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ExplainerCard icon={ScrollText} title="What this means">
          {view.explanation}
        </ExplainerCard>
        <ExplainerCard icon={Lightbulb} title="How close is it">
          {closenessTip(view)}
        </ExplainerCard>
        <ExplainerCard icon={Sparkles} title="Why format matters">
          {formatTip(view.formatDisplay)}
        </ExplainerCard>
        {(view.hasMissingValues || view.hasBlendedPicks || view.hasEstimatedPicks) && (
          <ExplainerCard icon={Lightbulb} title="Good to know">
            {view.hasMissingValues ? `${MISSING_VALUES_NOTE} ` : ""}
            {view.hasEstimatedPicks ? `${ESTIMATED_PICKS_NOTE} ` : ""}
            {view.hasBlendedPicks ? BLENDED_PICKS_NOTE : ""}
          </ExplainerCard>
        )}
      </div>

      {/* Share */}
      {shareUrl && (
        <div className="rounded-card border border-line bg-surface/40 p-4">
          <label htmlFor="sc-share-url" className="block text-sm font-medium text-ink">
            Share this verdict
          </label>
          <p className="mt-0.5 text-xs text-ink-subtle">
            Send this link to your league. It shows only the trade summary, nothing private.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              ref={shareInputRef}
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
              {copied ? (
                <Check aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
              ) : (
                <Copy aria-hidden="true" className="h-4 w-4" />
              )}
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

function ResultHero({ view }: { view: BuilderView }) {
  return (
    <div className="relative overflow-hidden rounded-modal border border-line bg-surface p-5 sm:p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(168,85,247,0.18) 0%, rgba(34,211,238,0.08) 50%, transparent 75%)",
        }}
      />
      <div className="relative">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          {view.resultLabel}
        </p>

        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="max-w-xl text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-3xl">
            {view.verdictLabel}
          </h2>

          <div className="shrink-0 sm:text-right">
            <p
              className="bg-clip-text text-4xl font-bold tabular-nums text-transparent sm:text-5xl"
              style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
            >
              {view.marginPct}%
            </p>
            <p className="text-xs text-ink-subtle">
              {view.isNeutral ? "value spread" : "value margin"}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Chip label="Format" value={view.formatDisplay} />
          {view.tradeShapeLabel && <Chip label="Trade shape" value={view.tradeShapeLabel} />}
          {view.confidenceLabel && view.confidenceLevel && (
            <ConfidenceChip label={view.confidenceLabel} level={view.confidenceLevel} />
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-base px-3 py-1 text-xs">
      <span className="text-ink-subtle">{label}:</span>
      <span className="font-medium text-ink">{value}</span>
    </span>
  );
}

function ConfidenceChip({ label, level }: { label: string; level: string }) {
  const filled = level === "high" ? 3 : level === "medium" ? 2 : 1;
  const color =
    level === "high"
      ? "bg-signal-success"
      : level === "medium"
        ? "bg-brand-cyan"
        : "bg-signal-warning";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-base px-3 py-1 text-xs"
      aria-label={`Confidence: ${label}`}
    >
      <span className="text-ink-subtle">Confidence:</span>
      <span className="font-medium text-ink">{label}</span>
      <span aria-hidden="true" className="flex items-center gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-2.5 w-1 rounded-full ${i < filled ? color : "bg-line"}`}
          />
        ))}
      </span>
    </span>
  );
}

function ExplainerCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Lightbulb;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-line bg-surface/40 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Icon aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
        {title}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{children}</p>
    </div>
  );
}
