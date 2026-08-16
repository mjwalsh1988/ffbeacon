/**
 * SignalCheckTradeCard: a league-feed trade rendered with its full Signal Check
 * grade. This is the same verdict, value margin, confidence, trade shape, and
 * plain-language read a user gets typing the trade into /tools/signal-check
 * directly (see lib/league-signal-check.ts), so trades on the transactions feed
 * are graded, not just listed.
 *
 * Trades are visually elevated above the plain transaction rows: a purple beacon
 * glow, a gradient wash, and the big gradient margin number make a graded trade
 * the standout element in the feed. Presentational server component; every
 * colored element is paired with text, and the value-balance bars carry an
 * sr-only prose summary so the graph is not color-only.
 */

import { Scale, Trophy, ScrollText, Sparkles } from "lucide-react";
import type { BuilderView } from "@/lib/signal-check/builder-view";
import type { SideKey } from "@/lib/signal-check/types";
import type { LeagueTradeAssetMeta } from "@/lib/league-signal-check";
import {
  BLENDED_PICKS_NOTE,
  ESTIMATED_PICKS_NOTE,
  MISSING_VALUES_NOTE,
} from "@/lib/signal-check/copy";
import { PlayerHeadshot } from "@/components/player-headshot";
import { ValueAdjustmentRow } from "@/components/value-adjustment-row";
import { CopyLinkButton } from "@/components/copy-link-button";
import { SITE_TIME_ZONE } from "@/lib/datetime";

const ORDINALS: Record<number, string> = {
  1: "1st",
  2: "2nd",
  3: "3rd",
  4: "4th",
  5: "5th",
};

export function SignalCheckTradeCard({
  view,
  assetMeta,
  sleeperLeagueId,
  sleeperTransactionId,
  week,
  createdAtSleeper,
  status,
  sourceSlug = null,
}: {
  view: BuilderView;
  assetMeta: Record<SideKey, LeagueTradeAssetMeta[]>;
  sleeperLeagueId: string;
  sleeperTransactionId: string;
  week: number | null;
  createdAtSleeper: string | null;
  status: string | null;
  /** Resolved value source, pinned onto the share image so the picture is
   * priced the same way this card is. */
  sourceSlug?: string | null;
}) {
  const totalA = view.sides.find((s) => s.side === "a")?.total ?? null;
  const totalB = view.sides.find((s) => s.side === "b")?.total ?? null;
  const isComplete = (status ?? "").toLowerCase() === "complete";
  const tradeImageHref = `/api/og/trade/${sleeperTransactionId}${
    sourceSlug ? `?source=${encodeURIComponent(sourceSlug)}` : ""
  }`;

  return (
    <article
      aria-label="Trade graded by Signal Check"
      className="relative overflow-hidden rounded-modal border border-brand-purple/40 bg-surface/60"
      style={{
        boxShadow: "0 0 90px -50px rgba(168, 85, 247, 0.6)",
        backgroundImage:
          "radial-gradient(ellipse at 50% -20%, rgba(168, 85, 247, 0.16) 0%, transparent 60%), radial-gradient(ellipse at 100% 120%, rgba(34, 211, 238, 0.10) 0%, transparent 55%)",
      }}
    >
      {/* Top-edge beacon hairline, decorative. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-0.5"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />

      {/* Header: identity + timing + share. Eyebrow and date/share sit on one
          vertically-centered row; the week / status chips drop below. */}
      <div className="border-b border-line/60 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            <Scale aria-hidden="true" className="h-3.5 w-3.5" />
            Trade graded by Signal Check
          </p>
          <div className="flex items-center gap-2">
            {createdAtSleeper && (
              <time dateTime={createdAtSleeper} className="text-xs text-ink-subtle">
                {formatDateLabel(createdAtSleeper)}
              </time>
            )}
            <CopyLinkButton
              href={`/leagues/${sleeperLeagueId}/transactions#tx-${sleeperTransactionId}`}
              ariaLabel="Copy link to this trade"
              size="xs"
            />
            <CopyLinkButton
              href={tradeImageHref}
              prewarmHref={tradeImageHref}
              icon="image"
              noun="Image link"
              ariaLabel="Copy shareable image link for this trade"
              size="xs"
            />
          </div>
        </div>
        {(week != null || (!isComplete && status)) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {week != null && (
              <span className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted">
                {week === 0 ? "Preseason" : `Week ${week}`}
              </span>
            )}
            {!isComplete && status && (
              <span
                className="rounded-full border border-signal-warning/50 bg-signal-warning/10 px-2 py-0.5 text-xs text-signal-warning"
                aria-label={`Status: ${status}`}
              >
                {status}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="space-y-5 px-4 py-5 sm:px-5">
        {/* Verdict hero. */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
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

        {/* Value balance graph. */}
        <ValueBalance
          marginPct={view.marginPct}
          winnerSide={view.winnerSide}
          isNeutral={view.isNeutral}
          sideALabel={sideLabel(view, "a")}
          sideBLabel={sideLabel(view, "b")}
          totalA={totalA}
          totalB={totalB}
        />

        {/* Per-side breakdown. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {view.sides.map((s) => {
            const meta = assetMeta[s.side];
            const isWinner = view.winnerSide === s.side;
            return (
              <section
                key={s.side}
                aria-labelledby={`tx-${sleeperTransactionId}-side-${s.side}`}
                className={`rounded-card border p-4 ${
                  isWinner ? "border-brand-cyan/50 bg-brand-cyan/[0.05]" : "border-line bg-base/40"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h4
                    id={`tx-${sleeperTransactionId}-side-${s.side}`}
                    className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink"
                  >
                    <span className="truncate">{sideLabel(view, s.side)}</span>
                    {isWinner && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-cyan/15 px-2 py-0.5 text-[11px] font-medium text-brand-cyan">
                        <Trophy aria-hidden="true" className="h-3 w-3" />
                        Wins
                      </span>
                    )}
                  </h4>
                  {s.total !== null && (
                    <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-ink-muted">
                      {s.total.toLocaleString()}
                    </span>
                  )}
                </div>

                <p className="mt-2 text-[11px] uppercase tracking-wider text-ink-subtle">Receives</p>
                <ul role="list" className="mt-1.5 space-y-1.5">
                  {s.assets.map((a, i) => {
                    const m = meta?.[i];
                    const kind: "player" | "pick" =
                      m?.kind ??
                      (a.detail?.toLowerCase().startsWith("draft pick") ? "pick" : "player");
                    return (
                      <li key={i} className="flex items-center gap-2.5">
                        <AssetGlyph
                          kind={kind}
                          sleeperId={m?.sleeperId ?? null}
                          round={m?.round ?? null}
                          name={a.name}
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
                            <span className="block truncate text-xs text-ink-subtle">
                              {a.detail}
                            </span>
                          )}
                        </span>
                        {a.value !== null && (
                          <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-ink-muted">
                            {a.value.toLocaleString()}
                          </span>
                        )}
                      </li>
                    );
                  })}
                  {/*
                    The consolidation credit is part of the verdict above, so it
                    has to be visible here too. Without it a side with fewer
                    points still wins and nothing on the card says why, and the
                    header total (which includes the credit) does not add up to
                    the rows beneath it. Same line the calculator shows, sized to
                    this card's smaller glyphs.
                  */}
                  {view.adjustmentLabel && (
                    <ValueAdjustmentRow
                      label={view.adjustmentLabel}
                      points={s.adjustment}
                      pct={s.adjustmentPct}
                      size={32}
                    />
                  )}
                  {s.assets.length === 0 && (
                    <li className="text-xs italic text-ink-subtle">Nothing of value received.</li>
                  )}
                </ul>
              </section>
            );
          })}
        </div>

        {/* Plain-language read. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ExplainerCard icon={ScrollText} title="The read">
            {view.explanation}
          </ExplainerCard>
          <ExplainerCard icon={Sparkles} title="How close">
            {closenessTip(view)}
          </ExplainerCard>
        </div>

        {(view.hasMissingValues || view.hasBlendedPicks || view.hasEstimatedPicks) && (
          <p className="text-xs text-ink-subtle" role="note">
            {view.hasMissingValues ? `${MISSING_VALUES_NOTE} ` : ""}
            {view.hasEstimatedPicks ? `${ESTIMATED_PICKS_NOTE} ` : ""}
            {view.hasBlendedPicks ? BLENDED_PICKS_NOTE : ""}
          </p>
        )}
      </div>
    </article>
  );
}

function sideLabel(view: BuilderView, side: SideKey): string {
  const s = view.sides.find((x) => x.side === side);
  return s?.teamLabel || `Side ${side.toUpperCase()}`;
}

function closenessTip(view: BuilderView): string {
  if (view.isNeutral) {
    return "This one is close. When the values are this even, your team's needs usually matter more than the raw numbers.";
  }
  if (view.isBlowout) {
    return "This is a lopsided trade by value. One side is getting a lot more than the other.";
  }
  return "One side comes out ahead, but the gap is not huge. Team needs could still tip the scales.";
}

function AssetGlyph({
  kind,
  sleeperId,
  round,
  name,
}: {
  kind: "player" | "pick";
  sleeperId: string | null;
  round: number | null;
  name: string;
}) {
  if (kind === "player") {
    return (
      <span aria-hidden="true" className="inline-flex shrink-0">
        <PlayerHeadshot sleeperId={sleeperId} name="" size={32} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      title={name}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-brand-purple/40 bg-brand-purple/10 text-brand-cyan"
    >
      <span className="text-[10px] font-semibold leading-none tracking-tight">
        {round ? (ORDINALS[round] ?? `R${round}`) : "PICK"}
      </span>
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
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-base px-3 py-1 text-xs"
      aria-label={`Confidence: ${label}`}
    >
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
 * Value-balance bars. When raw totals are hidden (the Signal Check default), the
 * per-side share is recovered from the margin: winner holds (1 + m) / 2 of the
 * combined value. When totals are present we use them directly.
 */
function ValueBalance({
  marginPct,
  winnerSide,
  isNeutral,
  sideALabel,
  sideBLabel,
  totalA,
  totalB,
}: {
  marginPct: number;
  winnerSide: SideKey | null;
  isNeutral: boolean;
  sideALabel: string;
  sideBLabel: string;
  totalA: number | null;
  totalB: number | null;
}) {
  const haveTotals =
    typeof totalA === "number" && typeof totalB === "number" && totalA + totalB > 0;

  let shareA: number;
  let shareB: number;
  if (haveTotals) {
    const sum = (totalA as number) + (totalB as number);
    shareA = ((totalA as number) / sum) * 100;
    shareB = 100 - shareA;
  } else if (isNeutral || !winnerSide) {
    shareA = 50;
    shareB = 50;
  } else {
    const m = Math.min(Math.max(marginPct / 100, 0), 1);
    const winnerShare = ((1 + m) / 2) * 100;
    shareA = winnerSide === "a" ? winnerShare : 100 - winnerShare;
    shareB = 100 - shareA;
  }

  const rA = Math.round(shareA);
  const rB = Math.round(shareB);
  const maxShare = Math.max(shareA, shareB) || 1;
  const summary =
    isNeutral || !winnerSide
      ? `${sideALabel} holds about ${rA} percent of the trade value and ${sideBLabel} holds about ${rB} percent. The two sides are close to even.`
      : `${sideALabel} holds about ${rA} percent of the trade value and ${sideBLabel} holds about ${rB} percent. ${
          winnerSide === "a" ? sideALabel : sideBLabel
        } is favored.`;

  return (
    <div className="rounded-card border border-line bg-base/40 p-4 sm:p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">
        Value balance
      </p>
      <div aria-hidden="true" className="mt-3 space-y-3">
        <Bar
          label={sideALabel}
          fillPct={(shareA / maxShare) * 100}
          sharePct={rA}
          total={haveTotals ? (totalA as number) : null}
          accent="purple"
          favored={winnerSide === "a" && !isNeutral}
        />
        <Bar
          label={sideBLabel}
          fillPct={(shareB / maxShare) * 100}
          sharePct={rB}
          total={haveTotals ? (totalB as number) : null}
          accent="cyan"
          favored={winnerSide === "b" && !isNeutral}
        />
      </div>
      <p className="sr-only">{summary}</p>
    </div>
  );
}

function Bar({
  label,
  fillPct,
  sharePct,
  total,
  accent,
  favored,
}: {
  label: string;
  fillPct: number;
  sharePct: number;
  total: number | null;
  accent: "purple" | "cyan";
  favored: boolean;
}) {
  const gradient =
    accent === "purple"
      ? "linear-gradient(90deg, #7C3AED 0%, #A855F7 100%)"
      : "linear-gradient(90deg, #06B6D4 0%, #22D3EE 100%)";
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 truncate text-xs font-medium text-ink-muted sm:w-24">
        {label}
      </span>
      <span className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-line/60">
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${favored ? "" : "opacity-60"}`}
          style={{ width: `${Math.max(fillPct, 4)}%`, backgroundImage: gradient }}
        />
      </span>
      <span className="w-14 shrink-0 text-right text-xs font-semibold tabular-nums text-ink sm:w-16">
        {total !== null ? total.toLocaleString() : `${sharePct}%`}
      </span>
    </div>
  );
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: SITE_TIME_ZONE,
  });
}
