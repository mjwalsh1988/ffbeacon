"use client";

/**
 * The Signal Check verdict, revealed.
 *
 * THE SAME GRADE, NOT A GAME VERSION OF IT. Everything here comes out of the
 * `BuilderView` the Signal Check pipeline produced for this trade: the verdict
 * sentence, the value margin, the trade shape, the confidence, the per-asset
 * prices and the plain-language read. It is what a reader would get typing the
 * same trade into /tools/signal-check in the same format, which is the whole
 * point of showing it after the vote rather than a softened version of it.
 *
 * THE SIDES ARE NAMED Team A AND Team B, and there is no link back to the
 * league. The trade is real and its league is named, but the two managers stay
 * anonymous, so nothing on this card leads anywhere that would name them.
 *
 * Raw point totals are shown only when Signal Check itself is configured to
 * show them. When they are hidden the per-side share is recovered from the
 * margin, so the bar still means something without publishing the scale.
 */

import { Scale, ScrollText, Sparkles, Trophy } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { ValueAdjustmentRow } from "@/components/value-adjustment-row";
import type { BuilderView } from "@/lib/signal-check/builder-view";
import type { WyrAsset, WyrSide } from "@/lib/would-you-rather/types";
import { SIDE_LABEL } from "./trade-board";

const ORDINALS: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th" };

export function VerdictPanel({
  view,
  yourSide,
  assetsBySide,
  notes,
}: {
  view: BuilderView;
  yourSide: WyrSide;
  /** The board's own assets, for the headshots. Aligned by index to view.sides. */
  assetsBySide: Record<WyrSide, WyrAsset[]>;
  notes: string[];
}) {
  const gotItRight = !view.isNeutral && view.winnerSide === yourSide;

  return (
    <div className="space-y-5">
      {/* Did the reader agree with the model? Said in words first, because it
          is the first thing anyone wants after a vote, and because a colour on
          the card would not say it at all. */}
      <p
        className={`rounded-card border px-3.5 py-3 text-sm font-medium leading-relaxed ${
          view.isNeutral
            ? "border-line bg-base/40 text-ink-muted"
            : gotItRight
              ? "border-signal-success/40 bg-signal-success/10 text-ink"
              : "border-signal-warning/40 bg-signal-warning/10 text-ink"
        }`}
      >
        {view.isNeutral
          ? `Signal Check calls this one close enough to be a coin flip, at ${view.marginPct}% apart. You picked ${SIDE_LABEL[yourSide]}.`
          : gotItRight
            ? `You and Signal Check agree. ${SIDE_LABEL[view.winnerSide === "a" ? "a" : "b"]} comes out ahead on value.`
            : `Signal Check sees it the other way. You picked ${SIDE_LABEL[yourSide]}; the values favour ${SIDE_LABEL[view.winnerSide === "a" ? "a" : "b"]}.`}
      </p>

      {/* Verdict hero. */}
      <div>
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          <Scale aria-hidden="true" className="h-3.5 w-3.5" />
          {view.resultLabel}
        </p>
        <div className="mt-1.5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h3 className="max-w-xl text-xl font-semibold leading-tight tracking-tight text-ink sm:text-2xl">
            {view.verdictLabel}
          </h3>
          <div className="shrink-0 sm:text-right">
            <p
              className="bg-clip-text font-mono text-3xl font-bold tabular-nums text-transparent sm:text-4xl"
              style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
            >
              {view.marginPct}%
            </p>
            <p className="text-[11px] text-ink-subtle">
              {view.isNeutral ? "value spread" : "value margin"}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Chip label="Format" value={view.formatDisplay} />
          {view.tradeShapeLabel && <Chip label="Trade shape" value={view.tradeShapeLabel} />}
          {view.confidenceLabel && view.confidenceLevel && (
            <ConfidenceChip label={view.confidenceLabel} level={view.confidenceLevel} />
          )}
        </div>
      </div>

      <ValueBalance view={view} />

      {/* Per-side prices. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {view.sides.map((side) => {
          const key = side.side as WyrSide;
          const isWinner = view.winnerSide === key;
          const assets = assetsBySide[key] ?? [];
          return (
            <section
              key={key}
              aria-labelledby={`wyr-verdict-side-${key}`}
              className={`rounded-card border p-4 ${
                isWinner ? "border-brand-cyan/50 bg-brand-cyan/[0.05]" : "border-line bg-base/40"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h4
                  id={`wyr-verdict-side-${key}`}
                  className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink"
                >
                  <span className="truncate">{side.teamLabel || SIDE_LABEL[key]}</span>
                  {isWinner && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-cyan/15 px-2 py-0.5 text-[11px] font-medium text-brand-cyan">
                      <Trophy aria-hidden="true" className="h-3 w-3" />
                      Wins
                    </span>
                  )}
                </h4>
                {side.total !== null && (
                  <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-ink-muted">
                    {side.total.toLocaleString()}
                  </span>
                )}
              </div>

              <p className="mt-2 text-[11px] uppercase tracking-wider text-ink-subtle">
                Receives
              </p>
              <ul role="list" className="mt-1.5 space-y-1.5">
                {side.assets.map((asset, index) => {
                  const board = assets[index];
                  return (
                    <li key={`${key}-${index}`} className="flex items-center gap-2.5">
                      <AssetGlyph asset={board ?? null} name={asset.name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {asset.name}
                          {asset.noValue && (
                            <span className="ml-1 text-xs font-normal text-signal-danger">
                              (no value)
                            </span>
                          )}
                        </span>
                        {asset.detail && (
                          <span className="block truncate text-xs text-ink-subtle">
                            {asset.detail}
                          </span>
                        )}
                      </span>
                      {asset.value !== null && (
                        <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-ink-muted">
                          {asset.value.toLocaleString()}
                        </span>
                      )}
                    </li>
                  );
                })}
                {/* The consolidation credit is inside the verdict above, so it
                    has to be visible here or the rows do not add up to the
                    total printed beside them. */}
                {view.adjustmentLabel && (
                  <ValueAdjustmentRow
                    label={view.adjustmentLabel}
                    points={side.adjustment}
                    pct={side.adjustmentPct}
                    size={32}
                  />
                )}
                {side.assets.length === 0 && (
                  <li className="text-xs italic text-ink-subtle">Nothing of value received.</li>
                )}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ExplainerCard icon={ScrollText} title="The read">
          {view.explanation}
        </ExplainerCard>
        <ExplainerCard icon={Sparkles} title="How close">
          {closenessTip(view)}
        </ExplainerCard>
      </div>

      {notes.length > 0 && (
        <ul role="list" className="space-y-1.5">
          {notes.map((note) => (
            <li key={note} className="text-xs leading-relaxed text-ink-subtle">
              {note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function closenessTip(view: BuilderView): string {
  if (view.isNeutral) {
    return "This one is close. When the values are this even, the team's own needs usually matter more than the raw numbers.";
  }
  if (view.isBlowout) {
    return "This is a lopsided trade by value. One side is getting a lot more than the other.";
  }
  return "One side comes out ahead, but the gap is not huge. Team needs could still tip it.";
}

function AssetGlyph({ asset, name }: { asset: WyrAsset | null; name: string }) {
  if (asset?.kind === "pick" || (!asset && name.match(/\d{4}\s/))) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-brand-purple/40 bg-brand-purple/10 text-brand-cyan"
      >
        <span className="text-[10px] font-semibold leading-none tracking-tight">
          {asset?.round ? (ORDINALS[asset.round] ?? `R${asset.round}`) : "PICK"}
        </span>
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="inline-flex shrink-0">
      <PlayerHeadshot sleeperId={asset?.sleeperId ?? null} name="" size={32} />
    </span>
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
    // No aria-label: ARIA does not guarantee a name on a generic element is
    // exposed, and where it is, the children can be pruned in its favour. The
    // visible children already say "Confidence: Medium confidence".
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-base px-3 py-1 text-xs">
      <span className="text-ink-subtle">Confidence:</span>
      <span className="font-medium text-ink">{label}</span>
      <span aria-hidden="true" className="flex items-center gap-0.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-2.5 w-1 rounded-full ${i < filled ? color : "bg-line"}`} />
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
  icon: typeof ScrollText;
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

/**
 * The value split as one bar.
 *
 * When raw totals are hidden (Signal Check's own default), the share is
 * recovered from the margin: the winning side holds (1 + m) / 2 of the combined
 * value. When totals are present they are used directly, because they are the
 * more precise answer.
 */
function ValueBalance({ view }: { view: BuilderView }) {
  const totalA = view.sides.find((s) => s.side === "a")?.total ?? null;
  const totalB = view.sides.find((s) => s.side === "b")?.total ?? null;

  let shareA: number;
  if (totalA !== null && totalB !== null && totalA + totalB > 0) {
    shareA = (totalA / (totalA + totalB)) * 100;
  } else if (view.winnerSide === null) {
    // A NEUTRAL VERDICT HAS NO WINNING SIDE, and marginPct is still non-zero.
    // The old fallback tested `winnerSide === "a"`, so null fell to the else
    // branch and the bar showed Team B ahead every time, which was backwards
    // half the time and asserted a split the verdict explicitly declines to
    // make. Even is the only honest picture when raw totals are hidden.
    shareA = 50;
  } else {
    const m = view.marginPct / 100;
    const winnerShare = ((1 + m) / 2) * 100;
    shareA = view.winnerSide === "a" ? winnerShare : 100 - winnerShare;
  }
  const roundedA = Math.round(shareA);
  const roundedB = 100 - roundedA;

  return (
    <div>
      <p className="sr-only">
        {view.winnerSide === null && totalA === null
          ? `By value this trade is close to even, at ${view.marginPct} percent apart.`
          : `By value, ${SIDE_LABEL.a} holds about ${roundedA} percent of this trade and ${SIDE_LABEL.b} about ${roundedB} percent.`}
      </p>
      <div aria-hidden="true">
        <div className="flex items-baseline justify-between gap-2 text-xs text-ink-subtle">
          <span>{SIDE_LABEL.a}</span>
          <span>{SIDE_LABEL.b}</span>
        </div>
        <div className="mt-1.5 flex h-3 overflow-hidden rounded-full bg-base">
          <div
            style={{ width: `${roundedA}%`, backgroundColor: "#A855F7" }}
            className="h-full"
          />
          <div
            style={{ width: `${roundedB}%`, backgroundColor: "#22D3EE" }}
            className="h-full"
          />
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-2 font-mono text-xs tabular-nums text-ink-muted">
          <span>{roundedA}%</span>
          <span>{roundedB}%</span>
        </div>
      </div>
    </div>
  );
}
