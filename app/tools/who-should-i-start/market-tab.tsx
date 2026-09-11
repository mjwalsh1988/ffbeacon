/**
 * The Market tab: what everyone else thinks, and what it has cost.
 *
 * Three reads, in order of how actionable they are.
 *
 *   1. Draft price against our ranking. Sleeper's ADP is where the field is
 *      actually taking the player; our overall rank is where we think the player belongs. The
 *      gap between the two, expressed in rounds, is the closest thing to a free
 *      edge we can hand anybody. Stated with the assumption (twelve teams) on
 *      the page so the reader can discount it rather than trust it blindly.
 *   2. Value history, every player on one chart. The profile has the single
 *      player version; a comparison tool wants the overlay.
 *   3. Real trades. Not a model, not a calculator: the actual deals in synced
 *      leagues where somebody moved this player and what came back.
 *
 * The trade list is deliberately the last thing on the tab. It is evidence, and
 * evidence belongs after the claim it supports.
 *
 * Generalised from a fixed pair to two-to-eight players (MIN/MAX_START_SIT_
 * PLAYERS). Two things changed shape because of that:
 *
 *   - The value overlay draws one line per side, styled from POSITION_SERIES
 *     IN ARRAY ORDER (not by football position: the palette is only being
 *     borrowed for its distinguishability, a side at index 2 is not
 *     necessarily a WR). The order is fixed and matches the card row, so a
 *     reader can carry a color from a card straight into the chart.
 *   - The real-trades list, which used to print inline, is now one native
 *     <details>/<summary> per player so eight players' worth of trade
 *     evidence does not turn the tab into a wall of text by default.
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
  PLAYER_SERIES,
  Td,
  Th,
  linePath,
  makeScale,
  markerPath,
  type SeriesStyle,
} from "@/components/chart-kit";

/** One player's slice of the market tab: the card, the overlay series, and the
 * trade evidence. */
export type MarketSide = {
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

/**
 * A fixed, distinguishable style per side index: PLAYER_SERIES from
 * components/chart-kit.tsx, the same eight-entry, dataviz-validated palette
 * the Projections tab uses, indexed by a side's position in the array rather
 * than its football position. Modulo rather than a hard bound, so a chart
 * never crashes over a styling shortfall even though loadBreakdown already
 * caps a board at eight players.
 */
function styleForIndex(i: number): SeriesStyle {
  return PLAYER_SERIES[i % PLAYER_SERIES.length];
}

function shortDate(iso: string): string {
  return formatEasternShortDate(iso);
}

export function MarketTab({
  sides,
  sourceDisplay,
  formatDisplay,
}: {
  sides: MarketSide[];
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {sides.map((side, i) => (
          <MarketCard key={side.player.slug} side={side} style={styleForIndex(i)} />
        ))}
      </div>

      <ValueOverlayChart sides={sides} sourceDisplay={sourceDisplay} formatDisplay={formatDisplay} />

      <TradeEvidence sides={sides} />
    </div>
  );
}

function roundsRead(roundsLate: number | null, name: string): string | null {
  if (roundsLate == null) return null;
  const rounded = Math.abs(roundsLate);
  if (rounded < 0.5) return `${name} is going about where we rank that player.`;
  const rounds = rounded.toFixed(1);
  return roundsLate > 0
    ? `${name} is going roughly ${rounds} round${rounded >= 1.5 ? "s" : ""} later than our ranking suggests. That is a buying window.`
    : `${name} is going roughly ${rounds} round${rounded >= 1.5 ? "s" : ""} earlier than our ranking suggests. You are paying up.`;
}

function MarketCard({ side, style }: { side: MarketSide; style: SeriesStyle }) {
  const { player, market } = side;
  const read = roundsRead(market?.adpRoundsLate ?? null, player.name);

  return (
    <section
      aria-label={`${player.name} market read`}
      className="rounded-card border bg-base/40 p-4"
      style={{ borderColor: `${style.color}66` }}
    >
      <p className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: style.color }}>
        <svg aria-hidden="true" width="18" height="8" viewBox="0 0 18 8" className="shrink-0">
          <line
            x1="0"
            y1="4"
            x2="18"
            y2="4"
            stroke={style.color}
            strokeWidth="2"
            strokeDasharray={style.dash ?? undefined}
          />
          <path d={markerPath(style.marker, 9, 4, 3)} fill={style.color} />
        </svg>
        {player.name}
      </p>

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

/** The legend above the overlay chart: a swatch plus the player's real name
 * for every side, none of it hidden behind color alone. */
function OverlayLegend({ sides }: { sides: MarketSide[] }) {
  return (
    <ul role="list" className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium">
      {sides.map((side, i) => {
        const style = styleForIndex(i);
        return (
          <li key={side.player.slug} className="flex items-center gap-1.5" style={{ color: style.color }}>
            <svg aria-hidden="true" width="18" height="8" viewBox="0 0 18 8" className="pointer-events-none">
              <line
                x1="0"
                y1="4"
                x2="18"
                y2="4"
                stroke={style.color}
                strokeWidth="2"
                strokeDasharray={style.dash ?? undefined}
              />
              <path d={markerPath(style.marker, 9, 4, 3)} fill={style.color} />
            </svg>
            {side.player.name}
          </li>
        );
      })}
    </ul>
  );
}

function ValueOverlayChart({
  sides,
  sourceDisplay,
  formatDisplay,
}: {
  sides: MarketSide[];
  sourceDisplay: string | null;
  formatDisplay: string;
}) {
  const seriesBySide = sides.map((s) => s.market?.series ?? []);

  if (seriesBySide.every((series) => series.length < 2)) {
    return (
      <ChartEmpty>
        Not enough value history yet to chart for {formatDisplay}
        {sourceDisplay ? ` on ${sourceDisplay}` : ""}. It builds up as daily values are captured.
      </ChartEmpty>
    );
  }

  const all = seriesBySide.flat();
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

  const ptsBySide = seriesBySide.map(toPts);

  const describe = (name: string, series: { value: number }[]): string | null => {
    if (series.length === 0) return null;
    const first = series[0]?.value ?? null;
    const last = series[series.length - 1]?.value ?? null;
    if (first == null || last == null) return null;
    const delta = last - first;
    const dir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    return `${name} went from ${first.toLocaleString()} to ${last.toLocaleString()}, ${dir} ${Math.abs(delta).toLocaleString()}`;
  };

  const summary = sides
    .map((side, i) => describe(side.player.name, seriesBySide[i]))
    .filter(Boolean)
    .join(". ");

  // Every side is sampled on the same nightly cadence, so pairing them by date
  // gives a readable table without interpolating anything.
  const byDate = new Map<string, Map<number, number>>();
  seriesBySide.forEach((series, i) => {
    for (const p of series) {
      const key = p.t.slice(0, 10);
      const row = byDate.get(key) ?? new Map<number, number>();
      row.set(i, p.value);
      byDate.set(key, row);
    }
  });
  const tableRows = [...byDate.entries()].sort((x, y) => (x[0] < y[0] ? 1 : -1));

  return (
    <ChartFigure
      title="Value over the last 90 days"
      description={`${formatDisplay}${sourceDisplay ? `, ${sourceDisplay}` : ""}. Every player on one axis, so the shapes are directly comparable.`}
      summary={summary || "Value history for every player over the last 90 days."}
      table={
        <DataTable
          caption={`Daily value for ${sides.map((s) => s.player.name).join(", ")}`}
          head={
            <>
              <Th>Date</Th>
              {sides.map((side) => (
                <Th key={side.player.slug} numeric>
                  {side.player.name}
                </Th>
              ))}
            </>
          }
        >
          {tableRows.map(([date, row]) => (
            <tr key={date}>
              <Td>{formatEasternDate(`${date}T12:00:00.000Z`)}</Td>
              {sides.map((side, i) => (
                <Td key={side.player.slug} numeric>
                  {row.has(i) ? row.get(i)!.toLocaleString() : "-"}
                </Td>
              ))}
            </tr>
          ))}
        </DataTable>
      }
    >
      <OverlayLegend sides={sides} />
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

        {ptsBySide.map((pts, i) => {
          const style = styleForIndex(i);
          const last = pts[pts.length - 1];
          return (
            <g key={sides[i].player.slug}>
              {pts.length >= 2 && (
                <path
                  d={linePath(pts)}
                  fill="none"
                  stroke={style.color}
                  strokeWidth="2"
                  strokeDasharray={style.dash ?? undefined}
                />
              )}
              {/* Marked once, at today's value: the endpoint is the actionable
                  number, and marking every daily point on eight overlaid lines
                  would bury the lines it is meant to help distinguish. */}
              {last && <path d={markerPath(style.marker, last.x, last.y, 3.5)} fill={style.color} />}
            </g>
          );
        })}

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

function TradeEvidence({ sides }: { sides: MarketSide[] }) {
  const withTrades = sides.filter((s) => s.trades.length > 0);
  if (withTrades.length === 0) {
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
          None of these players have turned up in a trade in any league we have synced. This fills
          in as more leagues run through League Pulse.
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

      <div className="grid gap-3 sm:grid-cols-2">
        {withTrades.map((s) => {
          const shown = s.trades.slice(0, 3);
          return (
            <details
              key={s.player.slug}
              className="rounded-card border border-line bg-base/40 p-3"
            >
              <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
                <span>{s.player.name}</span>
                <span className="text-xs font-normal text-ink-subtle">
                  {shown.length} trade{shown.length === 1 ? "" : "s"}
                </span>
              </summary>
              <ul role="list" className="mt-2 space-y-2">
                {shown.map((trade) => (
                  <TradeRow key={trade.transactionId} trade={trade} />
                ))}
              </ul>
            </details>
          );
        })}
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
