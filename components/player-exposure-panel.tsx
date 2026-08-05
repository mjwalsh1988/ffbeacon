"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { SidePanel } from "@/components/side-panel";
import {
  FILTER_THRESHOLD,
  PanelFilterField,
} from "@/components/panel-filter-field";
import { ordinal } from "@/lib/league-team-status";
import { searchExposureRows, type PlayerExposure } from "@/lib/player-exposure";

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
  sleeperUsername,
}: {
  open: boolean;
  onClose: () => void;
  exposure: PlayerExposure;
  /** Forwarded on the league links so a deep view lands on this roster. */
  sleeperUsername: string | null;
}) {
  const { rows, totalLeagues, unsyncedLeagues } = exposure;
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  // Read through the same condition that renders the box, so a table that drops
  // below the threshold while something is typed cannot end up filtered by a
  // control that is no longer on screen.
  const showFilter = rows.length > FILTER_THRESHOLD;
  // The panel stays mounted while closed so it can animate, so without this the
  // whole table would be re-filtered on every render of the page behind it.
  const matches = useMemo(
    () => searchExposureRows(rows, showFilter ? query : ""),
    [rows, query, showFilter],
  );

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

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

          {showFilter && (
            <PanelFilterField
              label="Filter players and leagues"
              placeholder="Filter by player or league..."
              value={query}
              onChange={setQuery}
              hint="Matches a player's name, position, or team, and the names of the leagues that player is in."
              status={
                query
                  ? `${matches.length} of ${rows.length} players match. Ranks stay as they are in the full list.`
                  : `${rows.length} players, most-owned first.`
              }
            />
          )}

          {/* A synced league with an empty roster gets here with no rows and no
              query, which is a different thing from a query that found nothing
              and must not borrow its wording. */}
          {rows.length === 0 ? (
            <p className="rounded-card border border-dashed border-line bg-base/40 px-4 py-5 text-sm text-ink-muted">
              Your rosters in these leagues are empty, so there is nothing to
              count yet.
            </p>
          ) : matches.length === 0 ? (
            <p className="rounded-card border border-dashed border-line bg-base/40 px-4 py-5 text-sm text-ink-muted">
              Nothing matches &quot;{query}&quot;. Try a surname, a position, or
              part of a league name.
            </p>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">
                Players you own, most-owned first. Each row gives its rank, the
                player, how many of your synced leagues you own him in, and that
                as a share. Expand a row to list those leagues.
              </caption>
              <thead className="sticky top-0 z-10 bg-surface-elevated text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                <tr>
                  <th scope="col" className="w-9 py-2 text-center">
                    <span aria-hidden="true">#</span>
                    <span className="sr-only">Exposure rank</span>
                  </th>
                  <th scope="col" className="py-2 pr-3 text-left">
                    Player
                  </th>
                  <th
                    scope="col"
                    className="hidden w-20 px-2 py-2 text-center sm:table-cell"
                  >
                    Leagues
                  </th>
                  <th
                    scope="col"
                    className="w-32 py-2 pl-2 text-right sm:w-[38%]"
                  >
                    Share
                  </th>
                </tr>
              </thead>
              {/* No divide-y on the tbody: it would draw a rule between a player
                  and his own expanded league list, which reads as a separator
                  between two unrelated rows. The rule goes on the player rows
                  themselves instead, and the expansion carries none. */}
              <tbody>
                {matches.map(({ row, matchedPlayer, matchedLeagues }) => {
                  const isOpen = expanded.has(row.sleeperPlayerId);
                  const regionId = `exposure-leagues-${row.sleeperPlayerId}`;
                  // Only worth saying when the player himself did not match:
                  // otherwise it explains a row nobody was confused by.
                  const leagueHint =
                    query && !matchedPlayer && matchedLeagues > 0
                      ? `${matchedLeagues} matching ${matchedLeagues === 1 ? "league" : "leagues"}`
                      : null;

                  return (
                    <Fragment key={row.sleeperPlayerId}>
                      <tr
                        // Pointer convenience over a real button, not instead of
                        // one: the chevron at the end of the row is the keyboard
                        // and screen-reader path, and this only saves a mouse the
                        // trip to it. Skipped mid-selection so dragging across a
                        // name to copy it does not also open the row.
                        onClick={() => {
                          if (window.getSelection()?.toString()) return;
                          toggle(row.sleeperPlayerId);
                        }}
                        className="cursor-pointer border-t border-line/70 align-middle transition-colors first:border-t-0 hover:bg-base/50"
                      >
                        <td className="py-2.5 text-center">
                          <span className="font-mono text-xs font-semibold tabular-nums text-ink-muted">
                            <span aria-hidden="true">
                              {row.tied ? `T${row.rank}` : row.rank}
                            </span>
                            <span className="sr-only">
                              {row.tied
                                ? `Tied for ${ordinal(row.rank)}`
                                : ordinal(row.rank)}
                            </span>
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="min-w-0">
                            {row.slug ? (
                              <Link
                                href={`/players/${row.slug}`}
                                // Otherwise following the profile link would
                                // also expand the row it is leaving.
                                onClick={(event) => event.stopPropagation()}
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
                              {[row.position, row.team]
                                .filter(Boolean)
                                .join(", ") || "Position unknown"}
                              {/* The count column is display:none below sm, so
                                  this is the only place the count exists there,
                                  and the only place it is announced there. */}
                              <span className="sm:hidden">
                                , {row.leagueCount} of {totalLeagues} leagues
                              </span>
                              {leagueHint && <>, {leagueHint}</>}
                            </span>
                          </div>
                        </td>
                        <td className="hidden px-2 py-2.5 text-center font-mono text-xs tabular-nums text-ink-muted sm:table-cell">
                          {row.leagueCount} of {totalLeagues}
                        </td>
                        <td className="py-2.5 pl-2">
                          <div className="flex items-center justify-end gap-2">
                            <span
                              aria-hidden="true"
                              className="hidden h-1.5 min-w-[2rem] flex-1 overflow-hidden rounded-full bg-line sm:block"
                            >
                              <span
                                className="block h-full rounded-full bg-beacon"
                                style={{
                                  width: `${Math.max(row.sharePct, 2)}%`,
                                }}
                              />
                            </span>
                            <span className="w-10 shrink-0 text-right font-mono text-xs font-semibold tabular-nums text-ink">
                              {row.sharePct}%
                            </span>
                            <button
                              type="button"
                              // The row's own handler would fire again on the way
                              // up and undo this press.
                              onClick={(event) => {
                                event.stopPropagation();
                                toggle(row.sleeperPlayerId);
                              }}
                              aria-expanded={isOpen}
                              aria-controls={regionId}
                              aria-label={`Leagues you own ${row.name} in`}
                              className="-mr-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-card text-ink-muted transition-colors hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                            >
                              <ChevronDown
                                aria-hidden="true"
                                className={`h-4 w-4 transition-transform motion-reduce:transition-none ${
                                  isOpen ? "rotate-180" : ""
                                }`}
                              />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan={4} className="pb-3 pl-9 pr-2 pt-0">
                            <div
                              id={regionId}
                              className="rounded-card border border-line bg-base/50 px-3 py-2.5"
                            >
                              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                                Owned in {row.leagueCount} of {totalLeagues}{" "}
                                {totalLeagues === 1 ? "league" : "leagues"}
                              </p>
                              <ul role="list" className="mt-1.5 space-y-0.5">
                                {row.leagues.map((league) => (
                                  <li key={league.sleeperLeagueId}>
                                    <Link
                                      href={leagueHref(league, sleeperUsername)}
                                      className="block truncate rounded-sm py-1 text-xs font-medium text-ink-muted hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                                    >
                                      {league.name}
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </SidePanel>
  );
}

/** Same shape the projections panel uses, so both open the deep view identically. */
function leagueHref(
  league: { sleeperLeagueId: string; name: string },
  sleeperUsername: string | null,
): string {
  const params = new URLSearchParams();
  if (sleeperUsername) params.set("username", sleeperUsername);
  params.set("name", league.name);
  return `/leagues/${league.sleeperLeagueId}?${params.toString()}`;
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
