/**
 * Starting lineup (plan 9.5): one row per startable slot in the league's own
 * order, from Sleeper's positional starters, an empty slot reading "Empty".
 * Under every value a thin bar drawn to the roster's top starter, so the
 * table also reads as a chart of where this lineup's value sits.
 *
 * The row header is the slot, and its accessible name is the spelled-out slot
 * only (CLAUDE.md, Lineups): the abbreviation is aria-hidden and its spelled
 * form is sr-only inside the same th, so table navigation echoes "Superflex"
 * and nothing more onto every cell of the row.
 *
 * Below sm every piece of data stays in three columns: the slot (SF for
 * superflex, the one label too wide for a phone), the player with team,
 * position and any call note under the name, and one cell stacking value,
 * position rank and the call. The separate columns return from sm up.
 */

import { PositionChip } from "@/components/position-chip";
import type { BlueprintView } from "@/lib/league-blueprint/types";
import { CallTag, NoMarketValue } from "./call-tag";
import { fmtValue, posRank } from "./bits";
import { Bar, SheetSection } from "./sheet";

const TH = "px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-ink-subtle";

export function LineupTable({ view, number }: { view: BlueprintView; number: string }) {
  const starters = view.lineup.map((s) => (s.playerId ? view.players[s.playerId] : null));
  const top = starters.reduce((m, p) => Math.max(m, p?.value ?? 0), 0);
  const priced = starters.filter((p) => p && p.value !== null).length;
  return (
    <SheetSection
      id="bp-lineup"
      number={number}
      title="Starting lineup"
      helper={`This week's starters as set on Sleeper. ${priced} of ${view.lineup.length} slots hold a priced player; the bar under each value is drawn to the top starter.`}
      bodyClassName="-mx-5 sm:mx-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Starting lineup for {view.header.teamName}: slot, player, value, position rank and call
          </caption>
          <thead className="border-b border-line">
            <tr>
              <th scope="col" className={TH}>Slot</th>
              <th scope="col" className={TH}>Player</th>
              <th scope="col" className={`${TH} hidden text-right sm:table-cell`}>Value</th>
              <th scope="col" className={`${TH} hidden text-right sm:table-cell`}>Pos rank</th>
              <th scope="col" className={`${TH} text-right sm:hidden`}>Value, rank, call</th>
              <th scope="col" className={`${TH} hidden sm:table-cell`}>Call</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70 border-b border-line">
            {view.lineup.map((slot, i) => {
              const p = slot.playerId ? view.players[slot.playerId] : null;
              const call = p ? view.calls[p.id] : undefined;
              const rank = p ? posRank(p) : null;
              const fraction = p?.value != null && top > 0 ? p.value / top : 0;
              return (
                <tr key={`${slot.slot}-${i}`}>
                  <th scope="row" className="w-10 py-2.5 pl-3 pr-1 text-left align-middle sm:w-14 sm:px-3">
                    <span aria-hidden="true" className="font-mono text-xs font-bold text-ink-subtle">
                      <span className="sm:hidden">{slot.slotLabel === "SUPERFLEX" ? "SF" : slot.slotLabel}</span>
                      <span className="hidden sm:inline">{slot.slotLabel}</span>
                    </span>
                    <span className="sr-only">{slot.slotDescription}</span>
                  </th>
                  <td className="min-w-0 px-2 py-2.5 align-middle sm:px-3">
                    {p ? (
                      <div className="min-w-0">
                        <p className="break-words font-semibold text-ink">{p.name}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-subtle">
                          <PositionChip position={p.position} />
                          <span>{p.team ?? "Free agent"}</span>
                        </p>
                        {call?.note && <p className="mt-1 text-[11px] leading-snug text-ink-muted sm:hidden">{call.note}</p>}
                      </div>
                    ) : (
                      <span className="text-ink-subtle">Empty</span>
                    )}
                  </td>
                  <td className="hidden w-40 px-3 py-2.5 text-right align-middle sm:table-cell">
                    {p ? (
                      p.value === null ? (
                        <NoMarketValue />
                      ) : (
                        <>
                          <span className="block whitespace-nowrap font-mono font-extrabold tabular-nums text-ink">
                            {fmtValue(p.value)}
                            <span className="sr-only"> value</span>
                          </span>
                          <Bar fraction={fraction} className="mt-1.5" />
                        </>
                      )
                    ) : (
                      <span className="text-ink-subtle">None</span>
                    )}
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2.5 text-right align-middle font-mono text-xs tabular-nums text-ink-muted sm:table-cell">
                    {rank ?? "None"}
                  </td>
                  <td className="w-28 py-2.5 pl-1 pr-3 text-right align-middle sm:hidden">
                    {p ? (
                      p.value === null ? (
                        <NoMarketValue />
                      ) : (
                        <>
                          <span className="block whitespace-nowrap font-mono text-sm font-extrabold tabular-nums text-ink">
                            {fmtValue(p.value)}
                            <span className="sr-only"> value</span>
                          </span>
                          <Bar fraction={fraction} className="mt-1" />
                          <span className="mt-1 block whitespace-nowrap font-mono text-[11px] tabular-nums text-ink-subtle">
                            <span className="sr-only">position rank </span>
                            {rank ?? "unranked"}
                          </span>
                        </>
                      )
                    ) : (
                      <span className="font-mono text-xs text-ink-subtle">None</span>
                    )}
                    {call && (
                      <span className="mt-1 block">
                        <CallTag call={call} />
                      </span>
                    )}
                  </td>
                  <td className="hidden px-3 py-2.5 align-middle sm:table-cell">
                    {call ? <CallTag call={call} /> : p ? <NoMarketValue /> : null}
                    {call?.note && <p className="mt-1 max-w-[16rem] text-[11px] leading-snug text-ink-muted">{call.note}</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SheetSection>
  );
}
