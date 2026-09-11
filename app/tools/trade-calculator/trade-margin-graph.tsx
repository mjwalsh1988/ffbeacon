import type { SideKey } from "@/lib/signal-check/types";

/**
 * Pure, presentational value-balance visual (no hooks, no "use client") so it
 * can render in the client builder AND the server-rendered share page.
 *
 * It works even when raw point totals are hidden (the default): the per-side
 * share of total value is recoverable from the margin alone. If margin = m and
 * side X wins, then X holds (1 + m) / 2 of the combined value and the other
 * side holds (1 - m) / 2. When raw totals are available we use them directly
 * for exactness.
 */
interface TradeMarginGraphProps {
  marginPct: number;
  winnerSide: SideKey | null;
  isNeutral?: boolean;
  sideALabel: string;
  sideBLabel: string;
  totalA?: number | null;
  totalB?: number | null;
}

export function TradeMarginGraph({
  marginPct,
  winnerSide,
  isNeutral = false,
  sideALabel,
  sideBLabel,
  totalA = null,
  totalB = null,
}: TradeMarginGraphProps) {
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
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-subtle">
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
      <span className="w-14 shrink-0 truncate text-xs font-medium text-ink-muted sm:w-20">
        {label}
      </span>
      <span className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-line/60">
        <span
          className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ${
            favored ? "" : "opacity-60"
          }`}
          style={{ width: `${Math.max(fillPct, 4)}%`, backgroundImage: gradient }}
        />
      </span>
      <span className="w-14 shrink-0 text-right text-xs font-semibold tabular-nums text-ink sm:w-16">
        {total !== null ? total.toLocaleString() : `${sharePct}%`}
      </span>
    </div>
  );
}
