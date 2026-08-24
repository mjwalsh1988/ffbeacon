/**
 * The Market tab: what everyone else thinks, and what it has cost.
 *
 * Three reads, in order of how actionable they are.
 *
 *   1. Draft price against our ranking. Sleeper's ADP is where the field is
 *      actually taking him; our overall rank is where we think he belongs. The
 *      gap between the two, expressed in rounds, is the closest thing to a free
 *      edge we can hand anybody. Stated with the assumption (twelve teams) on
 *      the page so the reader can discount it rather than trust it blindly.
 *   2. Value history, both players on one chart. The profile has the single
 *      player version; a comparison tool wants the overlay.
 *   3. Real trades. Not a model, not a calculator: the actual deals in synced
 *      leagues where somebody moved this player and what came back.
 *
 * The trade list is deliberately the last thing on the tab. It is evidence, and
 * evidence belongs after the claim it supports.
 */

import Link from "next/link";
import { ArrowLeftRight, LineChart } from "lucide-react";
import type { BreakdownMarket, BreakdownPlayer } from "@/lib/beacon-breakdown";
import type { PlayerTrade } from "@/lib/player-trades";
import { formatEasternDate, formatEasternShortDate } from "@/lib/datetime";
import {
  ChartEmpty,
  ChartFigure,
  DataTable,
  SERIES_A,
  SERIES_B,
  SeriesLegend,
  Td,
  Th,
  linePath,
  makeScale,
} from "./chart-kit";

type Side = {
  player: BreakdownPlayer;
  market: BreakdownMarket | null;
  trades: PlayerTrade[];
};

const W = 640;
const H = 190;
const PAD = { t: 12, r: 12, b: 24, l: 44 };
const INNER_W = W - PAD.l - PAD.r;
const INNER_H = H - PAD.t - PAD.b;

/** The league size the rounds-late read assumes. Stated in the UI. */
const TEAMS_PER_ROUND = 12;

function shortDate(iso: string): string {
  return formatEasternShortDate(iso);
}

export function MarketTab({
  a,
  b,
  sourceDisplay,
  formatDisplay,
}: {
  a: Side;
  b: Side;
  sourceDisplay: string | null;
  formatDisplay: string;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="flex items-center gap-1.5 text-lg font-semibold tracking-tight text-ink sm:text-xl">
          <LineChart aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
          What the market says
        </h3>
        <p className="mt-1 text-sm text-ink-muted">
          Draft price, value history, and the trades people actually made.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <MarketCard side={a} accent="purple" />
        <MarketCard side={b} accent="cyan" />
      </div>

      <ValueOverlayChart
        a={a}
        b={b}
        sourceDisplay={sourceDisplay}
        formatDisplay={formatDisplay}
      />

      <TradeEvidence a={a} b={b} />
    </div>
  );
}

function roundsRead(roundsLate: number | null, name: string): string | null {
  if (roundsLate == null) return null;
  const rounded = Math.abs(roundsLate);
  if (rounded < 0.5) return `${name} is going about where we rank him.`;
  const rounds = rounded.toFixed(1);
  return roundsLate > 0
    ? `${name} is going roughly ${rounds} round${rounded >= 1.5 ? "s" : ""} later than our ranking says he should. That is a buying window.`
    : `${name} is going roughly ${rounds} round${rounded >= 1.5 ? "s" : ""} earlier than our ranking says he should. You are paying up.`;
}

function MarketCard({ side, accent }: { side: Side; accent: "purple" | "cyan" }) {
  const { player, market } = side;
  const border = accent === "purple" ? "border-brand-purple/40" : "border-brand-cyan/40";
  const text = accent === "purple" ? "text-brand-purple" : "text-brand-cyan";
  const read = roundsRead(market?.adpRoundsLate ?? null, player.name);

  return (
    <section
      aria-label={`${player.name} market read`}
      className={`rounded-card border ${border} bg-base/40 p-4`}
    >
      <p className={`text-sm font-semibold ${text}`}>{player.name}</p>

      <dl className="mt-3 grid grid-cols-2 gap-2">
        <Stat
          label="Draft ADP"
          value={market?.adp != null ? market.adp.toFixed(1) : "-"}
          hint={market?.adpBasis ?? undefined}
        />
        <Stat
          label="Our rank"
          value={player.overallRank != null ? `#${player.overallRank}` : "-"}
          hint={
            player.rankChange30d != null && player.rankChange30d !== 0
              ? `${player.rankChange30d > 0 ? "up" : "down"} ${Math.abs(player.rankChange30d)} in 30d`
              : undefined
          }
        />
        <Stat
          label="30-day range"
          value={
            market?.low30d != null && market?.high30d != null
              ? `${market.low30d.toLocaleString()} to ${market.high30d.toLocaleString()}`
              : "-"
          }
          small
        />
        <Stat
          label="90-day change"
          value={
            market?.change90dPct != null
              ? `${market.change90dPct > 0 ? "+" : ""}${market.change90dPct.toFixed(1)}%`
              : "-"
          }
          tone={
            market?.change90dPct == null
              ? undefined
              : market.change90dPct >= 0
                ? "good"
                : "bad"
          }
        />
      </dl>

      {market?.volatility30d != null && (
        <p className="mt-2 text-xs text-ink-subtle">
          Value volatility over 30 days: {market.volatility30d.toFixed(1)}.
        </p>
      )}

      {read && <p className="mt-2 text-sm leading-relaxed text-ink-muted">{read}</p>}

      {market?.adpRoundsLate != null && (
        <p className="mt-1 text-[11px] text-ink-subtle">
          Rounds assume {TEAMS_PER_ROUND} teams.
        </p>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
  small,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "bad";
  small?: boolean;
}) {
  const toneClass =
    tone === "good" ? "text-signal-success" : tone === "bad" ? "text-signal-danger" : "text-ink";
  return (
    <div className="rounded-card border border-line/60 bg-surface/40 px-2.5 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
        {label}
      </dt>
      <dd
        className={`mt-0.5 font-mono font-bold tabular-nums ${small ? "text-xs" : "text-base"} ${toneClass}`}
      >
        {value}
      </dd>
      {hint && <p className="mt-0.5 text-[10px] text-ink-subtle">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Value history overlay                                               */
/* ------------------------------------------------------------------ */

function ValueOverlayChart({
  a,
  b,
  sourceDisplay,
  formatDisplay,
}: {
  a: Side;
  b: Side;
  sourceDisplay: string | null;
  formatDisplay: string;
}) {
  const seriesA = a.market?.series ?? [];
  const seriesB = b.market?.series ?? [];

  if (seriesA.length < 2 && seriesB.length < 2) {
    return (
      <ChartEmpty>
        Not enough value history yet to chart for {formatDisplay}
        {sourceDisplay ? ` on ${sourceDisplay}` : ""}. It builds up as daily values are captured.
      </ChartEmpty>
    );
  }

  const all = [...seriesA, ...seriesB];
  const times = all.map((p) => new Date(p.t).getTime()).filter((t) => Number.isFinite(t));
  const values = all.map((p) => p.value);
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  let minV = Math.min(...values);
  let maxV = Math.max(...values);
  if (minV === maxV) {
    minV = Math.max(0, minV - 1);
    maxV = maxV + 1;
  }
  // A little headroom so a line never rides the frame.
  const padV = (maxV - minV) * 0.08;
  minV = Math.max(0, minV - padV);
  maxV = maxV + padV;

  const xs = makeScale(minT, maxT, PAD.l, PAD.l + INNER_W);
  const ys = makeScale(minV, maxV, PAD.t + INNER_H, PAD.t);

  const toPts = (series: { t: string; value: number }[]) =>
    series
      .map((p) => ({ x: xs(new Date(p.t).getTime()), y: ys(p.value) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  const ptsA = toPts(seriesA);
  const ptsB = toPts(seriesB);

  const lastA = seriesA[seriesA.length - 1]?.value ?? null;
  const lastB = seriesB[seriesB.length - 1]?.value ?? null;
  const firstA = seriesA[0]?.value ?? null;
  const firstB = seriesB[0]?.value ?? null;

  const describe = (
    name: string,
    first: number | null,
    last: number | null,
  ): string | null => {
    if (first == null || last == null) return null;
    const delta = last - first;
    const dir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    return `${name} went from ${first.toLocaleString()} to ${last.toLocaleString()}, ${dir} ${Math.abs(delta).toLocaleString()}`;
  };

  const summary = [describe(a.player.name, firstA, lastA), describe(b.player.name, firstB, lastB)]
    .filter(Boolean)
    .join(". ");

  // The two series are sampled on the same nightly cadence, so pairing them by
  // date gives a readable table without interpolating anything.
  const byDate = new Map<string, { a?: number; b?: number }>();
  for (const p of seriesA) {
    const key = p.t.slice(0, 10);
    byDate.set(key, { ...(byDate.get(key) ?? {}), a: p.value });
  }
  for (const p of seriesB) {
    const key = p.t.slice(0, 10);
    byDate.set(key, { ...(byDate.get(key) ?? {}), b: p.value });
  }
  const tableRows = [...byDate.entries()].sort((x, y) => (x[0] < y[0] ? 1 : -1));

  return (
    <ChartFigure
      title="Value over the last 90 days"
      description={`${formatDisplay}${sourceDisplay ? `, ${sourceDisplay}` : ""}. Both players on one axis, so the shapes are directly comparable.`}
      summary={summary || "Value history for both players over the last 90 days."}
      table={
        <DataTable
          caption={`Daily value for ${a.player.name} and ${b.player.name}`}
          head={
            <>
              <Th>Date</Th>
              <Th numeric>{a.player.name}</Th>
              <Th numeric>{b.player.name}</Th>
            </>
          }
        >
          {tableRows.map(([date, v]) => (
            <tr key={date}>
              <Td>{formatEasternDate(`${date}T12:00:00.000Z`)}</Td>
              <Td numeric>{v.a != null ? v.a.toLocaleString() : "-"}</Td>
              <Td numeric>{v.b != null ? v.b.toLocaleString() : "-"}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <SeriesLegend aName={a.player.name} bName={b.player.name} />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const v = minV + (maxV - minV) * f;
          return (
            <g key={f}>
              <line
                x1={PAD.l}
                x2={PAD.l + INNER_W}
                y1={ys(v)}
                y2={ys(v)}
                stroke="#1F1F33"
                strokeWidth="1"
              />
              <text x={PAD.l - 6} y={ys(v) + 3} textAnchor="end" fill="#6B6B7D" fontSize="9">
                {Math.round(v).toLocaleString()}
              </text>
            </g>
          );
        })}

        {ptsA.length >= 2 && (
          <path d={linePath(ptsA)} fill="none" stroke={SERIES_A} strokeWidth="2" />
        )}
        {ptsB.length >= 2 && (
          <path
            d={linePath(ptsB)}
            fill="none"
            stroke={SERIES_B}
            strokeWidth="2"
            strokeDasharray="5 4"
          />
        )}

        {Number.isFinite(minT) && (
          <text x={PAD.l} y={H - 6} fill="#6B6B7D" fontSize="9">
            {shortDate(new Date(minT).toISOString())}
          </text>
        )}
        {Number.isFinite(maxT) && (
          <text x={PAD.l + INNER_W} y={H - 6} textAnchor="end" fill="#6B6B7D" fontSize="9">
            {shortDate(new Date(maxT).toISOString())}
          </text>
        )}
      </svg>
    </ChartFigure>
  );
}

/* ------------------------------------------------------------------ */
/* Real trades                                                         */
/* ------------------------------------------------------------------ */

function TradeEvidence({ a, b }: { a: Side; b: Side }) {
  const sides = [a, b].filter((s) => s.trades.length > 0);
  if (sides.length === 0) {
    return (
      <section aria-labelledby="trade-evidence-heading">
        <h4
          id="trade-evidence-heading"
          className="flex items-center gap-1.5 text-sm font-semibold text-ink"
        >
          <ArrowLeftRight aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
          Real trades
        </h4>
        <p className="mt-2 rounded-card border border-dashed border-line bg-base/40 px-4 py-4 text-sm text-ink-muted">
          Neither player has turned up in a trade in any league we have synced. This fills in as
          more leagues run through League Pulse.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="trade-evidence-heading" className="space-y-3">
      <div>
        <h4
          id="trade-evidence-heading"
          className="flex items-center gap-1.5 text-sm font-semibold text-ink"
        >
          <ArrowLeftRight aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
          Real trades
        </h4>
        <p className="mt-1 text-xs text-ink-muted">
          Actual deals from leagues synced through League Pulse. What people paid, not what a
          calculator says they should have.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {sides.map((s) => (
          <div key={s.player.slug}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              {s.player.name}
            </p>
            <ul role="list" className="mt-2 space-y-2">
              {s.trades.slice(0, 3).map((trade) => (
                <TradeRow key={trade.transactionId} trade={trade} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function TradeRow({ trade }: { trade: PlayerTrade }) {
  const when = trade.createdAtSleeper ? formatEasternDate(trade.createdAtSleeper) : null;

  return (
    <li className="rounded-card border border-line bg-base/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        {/* The format, not the league. This is a public page about a player,
            so the room it happened in is nobody's business. */}
        <p className="text-xs font-medium text-ink">
          {trade.formatDisplay ?? "Unmatched format"}
        </p>
        {when && <p className="text-[11px] text-ink-subtle">{when}</p>}
      </div>

      <ul role="list" className="mt-2 space-y-1.5">
        {trade.sides.map((side) => (
          <li key={side.rosterId} className="text-xs leading-relaxed">
            <span className="font-semibold text-ink">{side.sideLabel}</span>
            <span className="text-ink-subtle"> received </span>
            <span className="text-ink-muted">
              {[
                ...side.players.map((p) =>
                  p.slug ? (
                    <Link
                      key={p.sleeperPlayerId}
                      href={`/players/${p.slug}`}
                      className="underline decoration-line underline-offset-2 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                    >
                      {p.name}
                    </Link>
                  ) : (
                    <span key={p.sleeperPlayerId}>{p.name}</span>
                  ),
                ),
                ...side.picks.map((pick) => <span key={pick.label}>{pick.label}</span>),
              ].reduce<React.ReactNode[]>(
                (acc, node, i) => (i === 0 ? [node] : [...acc, ", ", node]),
                [],
              )}
              {side.players.length === 0 && side.picks.length === 0 && "nothing"}
            </span>
          </li>
        ))}
      </ul>

      {trade.sleeperLeagueId && (
        <Link
          href={`/leagues/${trade.sleeperLeagueId}/transactions`}
          className="mt-2 inline-flex min-h-11 items-center text-[11px] font-medium text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          See this league&apos;s full transaction feed
        </Link>
      )}
    </li>
  );
}
