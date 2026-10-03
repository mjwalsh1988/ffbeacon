/**
 * Team records and scoring, from the finals of the games played so far.
 *
 * A real table at every width: six short columns fit a phone, with the team
 * shown as its logo and code there and its full name from sm up. The record is
 * said as "3 and 1" to a screen reader rather than "3 dash 1".
 *
 * Finals are derived from the two team-defense stat lines of each game
 * (lib/brief-desk/week-results.ts), which is why a game whose box score has
 * not synced yet is simply not counted, and the note under the table says so.
 *
 * Server component.
 */

import { NflTeamLogo } from "@/components/nfl-team-logo";
import type { TeamRecord } from "@/lib/season-pulse/types";

function recordText(r: TeamRecord): string {
  return r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
}

function recordSpoken(r: TeamRecord): string {
  const base = `${r.wins} ${r.wins === 1 ? "win" : "wins"}, ${r.losses} ${r.losses === 1 ? "loss" : "losses"}`;
  return r.ties > 0 ? `${base}, ${r.ties} ${r.ties === 1 ? "tie" : "ties"}` : base;
}

const perGame = (total: number, games: number) => (games > 0 ? (total / games).toFixed(1) : "n/a");

export function TeamRecordsTable({ records, limit }: { records: TeamRecord[]; limit?: number }) {
  const rows = limit ? records.slice(0, limit) : records;
  if (rows.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line bg-base/40 px-4 py-6 text-sm text-ink-muted">
        No finals are in yet this season.
      </p>
    );
  }
  return (
    <div>
      <div
        role="region"
        aria-label="Team records table"
        tabIndex={0}
        className="beacon-scroll overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            Team records and points scored and allowed per game this season, best record first.
          </caption>
          <thead>
            <tr className="border-b border-line bg-surface-elevated/50 text-[10px] uppercase tracking-[0.12em] text-ink-subtle">
              <th scope="col" className="px-2 py-2.5 font-semibold sm:px-3">
                Team
              </th>
              <th scope="col" className="px-2 py-2.5 text-right font-semibold sm:px-3">
                Record
              </th>
              <th scope="col" className="px-2 py-2.5 text-right font-semibold sm:px-3">
                Scored<span className="sr-only"> per game</span>
              </th>
              <th scope="col" className="px-2 py-2.5 text-right font-semibold sm:px-3">
                Allowed<span className="sr-only"> per game</span>
              </th>
              <th scope="col" className="px-2 py-2.5 text-right font-semibold sm:px-3">
                Margin<span className="sr-only"> per game</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {rows.map((r) => {
              const margin = r.games > 0 ? (r.pointsFor - r.pointsAgainst) / r.games : 0;
              return (
                <tr key={r.code}>
                  <th scope="row" className="px-2 py-2 text-left font-normal sm:px-3">
                    <span className="flex items-center gap-2">
                      <NflTeamLogo team={r.code} size={22} />
                      <span className="text-sm font-medium text-ink sm:hidden">
                        {r.code}
                        <span className="sr-only">{`, ${r.name}`}</span>
                      </span>
                      <span className="hidden text-sm font-medium text-ink sm:inline">{r.name}</span>
                    </span>
                  </th>
                  <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums text-ink sm:px-3">
                    {recordText(r)}
                    <span className="sr-only">{`, ${recordSpoken(r)}`}</span>
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-muted sm:px-3">
                    {perGame(r.pointsFor, r.games)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-muted sm:px-3">
                    {perGame(r.pointsAgainst, r.games)}
                  </td>
                  <td
                    className={`px-2 py-2 text-right font-mono tabular-nums sm:px-3 ${
                      margin > 0 ? "text-signal-success" : margin < 0 ? "text-[#F87171]" : "text-ink-muted"
                    }`}
                  >
                    {margin > 0 ? "+" : ""}
                    {margin.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
        Scores are worked out from each game&apos;s two team-defense stat lines, so a game appears once its box score
        has synced, usually the morning after.
      </p>
    </div>
  );
}
