"use client";

/**
 * Weekly game log with a season picker. A labeled select switches the season;
 * the chosen season's weeks render earliest to latest (week 1 through 18), which
 * is the opposite of the newest-first order the rows arrive in. All shaping
 * helpers come from the server/client-safe stat-shaping module, so this client
 * component pulls in no server-only code.
 */

import { useState } from "react";
import {
  statColumns,
  StatScroll,
  lineFromGame,
  type GameRow,
} from "@/components/player-profile/stat-shaping";

export function WeeklyStats({
  position,
  rowsBySeason,
  seasons,
}: {
  position: string;
  rowsBySeason: Record<number, GameRow[]>;
  seasons: number[];
}) {
  const [season, setSeason] = useState<number>(seasons[0]);
  const cols = statColumns(position);
  const rows = (rowsBySeason[season] ?? []).slice().sort((a, b) => a.week - b.week);

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="weekly-season" className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          Season
        </label>
        <select
          id="weekly-season"
          value={season}
          onChange={(e) => setSeason(Number(e.target.value))}
          className="rounded-card border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {seasons.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <StatScroll caption={`${season} weekly stat lines`}>
        <table className="w-full min-w-[680px] text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wider text-ink-subtle">
            <tr className="border-b border-line">
              <th scope="col" className="px-3 py-2 font-semibold">
                Wk
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Opp
              </th>
              {cols.map((c) => (
                <th key={c.label} scope="col" className="px-3 py-2 text-right font-semibold">
                  {c.label}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Snap%
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                PPR
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => {
              const line = lineFromGame(r);
              const snap = r.snap_pct != null ? `${Math.round(r.snap_pct * 100)}%` : "-";
              return (
                <tr key={`${r.season}-${r.week}`} className="hover:bg-surface">
                  <th
                    scope="row"
                    className="whitespace-nowrap px-3 py-2 text-left font-mono font-medium text-ink"
                  >
                    {r.week}
                  </th>
                  <td className="px-3 py-2 text-ink-muted">{r.opponent ?? "-"}</td>
                  {cols.map((c) => (
                    <td
                      key={c.label}
                      className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted"
                    >
                      {c.get(line)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted">{snap}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-ink">
                    {line.pts_ppr.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </StatScroll>
    </div>
  );
}
