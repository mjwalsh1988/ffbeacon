"use client";

import Link from "next/link";
import { SidePanel } from "@/components/side-panel";
import type { PlayerExposure } from "@/lib/player-exposure";

/**
 * Every player this manager owns, ordered by how much of their season rides on
 * him.
 *
 * The number no single league can show you. Nine of twelve teams starting the
 * same running back is a fact about the manager, not about any one roster, and
 * it only becomes visible when the rosters are counted together.
 *
 * READS THE SYNCED LEAGUES AND NOTHING ELSE. Opening this panel triggers no
 * sync. A league that has never been pulsed is not in the denominator and is
 * reported separately at the top, so a share is never quietly computed against
 * rooms we have no roster for.
 *
 * The bar is aria-hidden on purpose: the percentage and the count sit beside it
 * as real text, so announcing the bar as well would read every row twice.
 */
export function PlayerExposurePanel({
  open,
  onClose,
  exposure,
}: {
  open: boolean;
  onClose: () => void;
  exposure: PlayerExposure;
}) {
  const { rows, totalLeagues, unsyncedLeagues } = exposure;

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      size="lg"
      title="Player exposure"
      subtitle={
        totalLeagues > 0
          ? `${rows.length} ${rows.length === 1 ? "player" : "players"} across ${totalLeagues} synced ${totalLeagues === 1 ? "league" : "leagues"}`
          : "No synced leagues yet"
      }
    >
      {totalLeagues === 0 ? (
        <EmptyState />
      ) : (
        <>
          {unsyncedLeagues > 0 && (
            <p className="mb-4 rounded-card border border-line bg-base/50 px-3 py-2 text-xs leading-relaxed text-ink-muted">
              {unsyncedLeagues} of your {totalLeagues + unsyncedLeagues} leagues
              are not synced yet, so they are not counted here. Sync them and
              they join these numbers automatically.
            </p>
          )}

          <table className="w-full text-sm">
            <caption className="sr-only">
              Players you own, most-owned first. Each row gives the player, how
              many of your synced leagues you own him in, and that as a share.
            </caption>
            <thead className="sticky top-0 z-10 bg-surface-elevated text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              <tr>
                <th scope="col" className="py-2 pr-3 text-left">
                  Player
                </th>
                <th scope="col" className="w-20 px-2 py-2 text-center">
                  Leagues
                </th>
                <th scope="col" className="w-[38%] py-2 pl-2 text-right">
                  Share
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {rows.map((row) => (
                <tr key={row.sleeperPlayerId} className="align-middle">
                  <td className="py-2.5 pr-3">
                    {/* Which leagues, on hover. Not in the accessible name:
                        this table runs to hundreds of rows and appending eight
                        league names to each one would bury the number the row
                        exists to report. */}
                    <div className="min-w-0" title={row.leagueNames.join(", ")}>
                      {row.slug ? (
                        <Link
                          href={`/players/${row.slug}`}
                          className="block truncate font-semibold text-ink hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                        >
                          {row.name}
                        </Link>
                      ) : (
                        <span className="block truncate font-semibold text-ink">
                          {row.name}
                        </span>
                      )}
                      <span className="mt-0.5 block truncate text-[11px] text-ink-subtle">
                        {[row.position, row.team].filter(Boolean).join(", ") ||
                          "Position unknown"}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-center font-mono text-xs tabular-nums text-ink-muted">
                    {row.leagueCount} of {totalLeagues}
                  </td>
                  <td className="py-2.5 pl-2">
                    <div className="flex items-center justify-end gap-2">
                      <span
                        aria-hidden="true"
                        className="h-1.5 min-w-[2rem] flex-1 overflow-hidden rounded-full bg-line"
                      >
                        <span
                          className="block h-full rounded-full bg-beacon"
                          style={{ width: `${Math.max(row.sharePct, 2)}%` }}
                        />
                      </span>
                      <span className="w-10 shrink-0 text-right font-mono text-xs font-semibold tabular-nums text-ink">
                        {row.sharePct}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </SidePanel>
  );
}

function EmptyState() {
  return (
    <div className="rounded-card border border-dashed border-line bg-base/40 p-5">
      <p className="text-sm font-semibold text-ink">Nothing to count yet.</p>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
        Exposure is built from the rosters we have already synced. Press Sync
        all, or open a league, and your players show up here. Nothing on this
        page starts a sync on its own.
      </p>
    </div>
  );
}
