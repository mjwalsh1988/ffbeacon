"use client";

/**
 * Available players: a real semantic <table> with search, position filter, column
 * sorting (aria-sort on the active column, sort buttons inside <th>), and
 * pagination via "Show more" (NOT virtualized, per owner decision 10).
 *
 * Carries a Sleeper ADP column beside the FF Beacon value so users can compare
 * the market against the Beacon board at a glance. The ADP cell shows the raw
 * ADP with a plain-English comparison line ("Sleeper ADP is 12 picks later.
 * Beacon says value.") from lib/on-the-clock/adp.ts describeBeaconVsAdp, so
 * "Beacon recommends this player now even though the market waits" is readable
 * in one cell. Nothing is conveyed by color alone.
 *
 * Accessibility: <caption>, scope headers, aria-sort, aria-pressed filter chips,
 * a polite live region announcing the visible count and sort changes, 44px targets.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Star } from "lucide-react";
import type { DraftPosition, RankedPlayer } from "./fixtures";
import { describeBeaconVsAdp } from "@/lib/on-the-clock/adp";
import type { BuildMode } from "@/lib/on-the-clock/types";

/**
 * "recommended" is the engine's own ordering: the same blended score that chose
 * the Team Need card, so the list a drafter reads always agrees with the
 * recommendation above it. It is the default whenever the engine has an opinion.
 */
type SortKey = "recommended" | "value" | "overallRank" | "positionRank" | "adp" | "projected";
type SortDir = "asc" | "desc";

const POSITIONS: Array<DraftPosition | "ALL"> = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];
const PAGE_SIZE = 10;

/** How long the spoken summary waits for typing to settle. */
const ANNOUNCE_DELAY_MS = 500;

function ariaSortFor(active: boolean, dir: SortDir): "ascending" | "descending" | "none" {
  if (!active) return "none";
  return dir === "asc" ? "ascending" : "descending";
}

function sortValue(
  p: RankedPlayer,
  key: SortKey,
  orderScore: Record<string, number>,
): number {
  if (key === "adp") {
    // Missing ADP sinks to the bottom in either direction.
    return typeof p.adp === "number" ? p.adp : Number.MAX_SAFE_INTEGER;
  }
  if (key === "recommended") return orderScore[p.playerId] ?? Number.NEGATIVE_INFINITY;
  if (key === "projected") {
    // Absent is not zero: an unprojected player sorts to the bottom of a
    // projection sort rather than being claimed to score nothing.
    return typeof p.projPointsPerWeek === "number" ? p.projPointsPerWeek : Number.NEGATIVE_INFINITY;
  }
  return p[key];
}

const MODE_BLURB: Record<BuildMode, string> = {
  compete: "Ordered for a contender: what adds the most to your starting lineup this season.",
  balanced: "Ordered by the blend of FF Beacon value and what your lineup needs.",
  rebuild: "Ordered for a rebuild: long-term value, youth, and upside.",
};

/**
 * Memoized. The internal useMemo re-sorts about 600 players, and it only ever
 * hits when `players` and `orderScore` come in by a stable reference, which the
 * room now guarantees.
 */
export const AvailableList = memo(AvailableListInner);

function AvailableListInner({
  players,
  adpThreshold = 6,
  adpAvailable = true,
  orderScore = {},
  mode = "balanced",
  projectionsAvailable = false,
  watchlist,
  onToggleWatch,
}: {
  players: RankedPlayer[];
  /** Neutral band (picks) for the Beacon-vs-ADP comparison copy. */
  adpThreshold?: number;
  /** False when no ADP snapshot exists yet (column shows a quiet dash). */
  adpAvailable?: boolean;
  /** The recommendation engine's own ordering score, keyed by player id. */
  orderScore?: Record<string, number>;
  /** Which build mode produced that ordering, for the explanation line. */
  mode?: BuildMode;
  /** True once the projection columns carry data. */
  projectionsAvailable?: boolean;
  /** Player ids the user has starred. Undefined hides the column entirely. */
  watchlist?: Set<string>;
  onToggleWatch?: (playerId: string) => void;
}) {
  const hasOrdering = Object.keys(orderScore).length > 0;
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState<DraftPosition | "ALL">("ALL");
  const [sortKey, setSortKey] = useState<SortKey>(hasOrdering ? "recommended" : "value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = players.filter((p) => {
      if (position !== "ALL" && p.position !== position) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
    rows.sort((a, b) => {
      const av = sortValue(a, sortKey, orderScore);
      const bv = sortValue(b, sortKey, orderScore);
      if (av === bv) return a.overallRank - b.overallRank;
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return rows;
  }, [players, search, position, sortKey, sortDir, orderScore]);

  const shown = filtered.slice(0, visible);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Value, projections, and the engine ordering default high-to-low; ranks
      // and ADP default low-to-high.
      setSortDir(key === "value" || key === "projected" || key === "recommended" ? "desc" : "asc");
    }
    setVisible(PAGE_SIZE);
    noteInteraction();
  };

  const sortLabel =
    sortKey === "recommended"
      ? "our recommendation"
      : sortKey === "value"
        ? "value"
        : sortKey === "overallRank"
          ? "overall rank"
          : sortKey === "positionRank"
            ? "position rank"
            : sortKey === "projected"
              ? "projected points"
              : "Sleeper ADP";

  const summary =
    `Showing ${Math.min(visible, filtered.length)} of ${filtered.length} available players, ` +
    `sorted by ${sortLabel} ${sortDir === "asc" ? "ascending" : "descending"}.` +
    (shown.length > 0 ? ` Top of the list is ${shown[0].name}, ${shown[0].position}.` : "");

  // Announce the settled sentence, and only for something the USER did.
  //
  // Two separate problems, one mechanism. Typing "Jefferson" queued nine
  // announcements over the character echo, so the announced string is debounced
  // and a burst of typing collapses into one. And in a live draft every
  // incoming pick changes the count, so an ungated region read the whole
  // sentence aloud every few seconds, unprompted, over whatever the drafter was
  // actually reading. The radar is where "the board changed" belongs.
  //
  // `interactions` only increments on a search, a filter, a sort, or a show-more,
  // so a pick landing changes the visible text and says nothing.
  const [interactions, setInteractions] = useState(0);
  const noteInteraction = () => setInteractions((n) => n + 1);
  const [announced, setAnnounced] = useState("");
  const summaryRef = useRef(summary);
  summaryRef.current = summary;
  useEffect(() => {
    if (interactions === 0) return;
    const timer = setTimeout(() => setAnnounced(summaryRef.current), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [interactions, search, position, sortKey, sortDir, visible]);

  // The padding belongs to the BUTTON, not the cell, or the target is only as
  // tall as the text. min-h-11 is the project's 44px floor.
  const headerBtn =
    "inline-flex min-h-11 w-full items-center gap-1 px-3 py-2 text-left font-semibold text-ink hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="otc-avail-search" className="sr-only">
            Search available players
          </label>
          <input
            id="otc-avail-search"
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisible(PAGE_SIZE);
              noteInteraction();
            }}
            placeholder="Search players..."
            className="w-full rounded-card border border-line bg-base px-3 py-2 text-sm placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
          />
        </div>
        <div role="group" aria-label="Filter by position" className="flex flex-wrap gap-1.5">
          {POSITIONS.map((p) => {
            const active = position === p;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setPosition(p);
                  setVisible(PAGE_SIZE);
                  noteInteraction();
                }}
                className={`min-h-11 rounded-card border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                  active
                    ? "border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan"
                    : "border-line bg-base text-ink-muted hover:text-ink"
                }`}
              >
                {p === "ALL" ? "All" : p}
              </button>
            );
          })}
        </div>
      </div>

      {/* The count and sort state. Visible text updates on every keystroke; the
          SPOKEN copy in the live region below is debounced, because typing
          "Jefferson" used to queue nine announcements that interrupted the
          character echo and made the field unusable by ear. */}
      <p aria-hidden="true" className="mt-3 text-xs text-ink-muted">
        {summary}
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {announced}
      </p>
      {hasOrdering && sortKey === "recommended" && (
        <p className="mt-1 text-xs text-ink-subtle">{MODE_BLURB[mode]}</p>
      )}

      <div
        tabIndex={0}
        role="region"
        aria-label="Available players table, scrollable"
        className="mt-2 overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-cyan"
      >
        {/* On mobile the table keeps its natural width (min 100%) and the wrapper
            scrolls horizontally, so columns stay readable instead of squishing.
            On desktop it fills the container as before. */}
        <table className="w-max min-w-full border-collapse text-sm sm:w-full">
          <caption className="sr-only">
            Available players, sortable by value, overall rank, position rank, and Sleeper ADP.
            The ADP column compares each player&apos;s market draft position against their FF
            Beacon rank.
          </caption>
          <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
            <tr>
              {watchlist && (
                <th scope="col" className="px-2 py-2 text-left font-semibold">
                  Watch
                </th>
              )}
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Player
              </th>
              {hasOrdering && (
                <th
                  scope="col"
                  aria-sort={ariaSortFor(sortKey === "recommended", sortDir)}
                  className="px-3 py-2 text-left"
                >
                  <button type="button" className={headerBtn} onClick={() => toggleSort("recommended")}>
                    Our order
                  </button>
                </th>
              )}
              <th scope="col" aria-sort={ariaSortFor(sortKey === "positionRank", sortDir)} className="px-3 py-2 text-left">
                <button type="button" className={headerBtn} onClick={() => toggleSort("positionRank")}>
                  Pos rank
                </button>
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                Tier
              </th>
              <th scope="col" aria-sort={ariaSortFor(sortKey === "adp", sortDir)} className="px-3 py-2 text-left">
                <button type="button" className={headerBtn} onClick={() => toggleSort("adp")}>
                  Sleeper ADP
                </button>
              </th>
              {projectionsAvailable && (
                <th
                  scope="col"
                  aria-sort={ariaSortFor(sortKey === "projected", sortDir)}
                  className="px-3 py-2 text-right"
                >
                  <button
                    type="button"
                    className={`${headerBtn} justify-end`}
                    onClick={() => toggleSort("projected")}
                  >
                    Proj / wk
                  </button>
                </th>
              )}
              <th scope="col" aria-sort={ariaSortFor(sortKey === "value", sortDir)} className="px-3 py-2 text-right">
                <button type="button" className={`${headerBtn} justify-end`} onClick={() => toggleSort("value")}>
                  Value
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td
                  colSpan={5 + (watchlist ? 1 : 0) + (hasOrdering ? 1 : 0) + (projectionsAvailable ? 1 : 0)}
                  className="px-3 py-6 text-center text-ink-muted"
                >
                  No players match your search and filters.
                </td>
              </tr>
            ) : (
              shown.map((p) => {
                const comparison = describeBeaconVsAdp(p.overallRank, p.adp ?? null, adpThreshold);
                return (
                  <tr key={p.playerId} className="border-t border-line/60">
                    {watchlist && (
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          aria-pressed={watchlist.has(p.playerId)}
                          onClick={() => onToggleWatch?.(p.playerId)}
                          aria-label={
                            watchlist.has(p.playerId)
                              ? `Remove ${p.name} from your watchlist`
                              : `Add ${p.name} to your watchlist`
                          }
                          className="inline-flex h-11 w-11 items-center justify-center rounded-card text-ink-subtle hover:text-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                        >
                          <Star
                            aria-hidden="true"
                            className={`h-4 w-4 ${watchlist.has(p.playerId) ? "fill-amber-300 text-amber-300" : ""}`}
                          />
                        </button>
                      </td>
                    )}
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <span className="font-semibold text-ink">{p.name}</span>
                      <span className="ml-2 text-xs text-ink-muted">
                        {p.position}
                        {p.team ? `, ${p.team}` : ""}
                        {p.isRookie ? ", Rookie" : ""}
                      </span>
                    </th>
                    {hasOrdering && (
                      <td className="px-3 py-2 font-mono text-xs tabular-nums text-brand-cyan">
                        {orderScore[p.playerId] === undefined ? (
                          <span className="text-ink-subtle">
                            <span aria-hidden="true">-</span>
                            <span className="sr-only">Not scored for this build</span>
                          </span>
                        ) : (
                          orderScore[p.playerId].toFixed(0)
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 text-ink-muted">
                      {p.position}
                      {p.positionRank}
                    </td>
                    <td className="px-3 py-2 text-ink-muted">Tier {p.tier}</td>
                    <td className="px-3 py-2">
                      {typeof p.adp === "number" ? (
                        <span className="block">
                          <span className="font-mono tabular-nums text-ink">{p.adp.toFixed(1)}</span>
                          <span
                            className={`block text-[11px] ${
                              comparison.lean === "beacon-higher"
                                ? "font-medium text-brand-cyan"
                                : comparison.lean === "market-higher"
                                  ? "text-amber-300"
                                  : "text-ink-subtle"
                            }`}
                          >
                            {comparison.label}
                          </span>
                        </span>
                      ) : (
                        // aria-label on a generic span is unreliable across AT;
                        // pair the visual dash with real screen-reader-only text.
                        <span className="text-ink-subtle">
                          <span aria-hidden="true">-</span>
                          <span className="sr-only">
                            {adpAvailable
                              ? "No ADP data for this player"
                              : "ADP data not available yet"}
                          </span>
                        </span>
                      )}
                    </td>
                    {projectionsAvailable && (
                      <td className="px-3 py-2 text-right">
                        {typeof p.projPointsPerWeek === "number" ? (
                          <span className="block">
                            <span className="font-mono tabular-nums text-ink">
                              {p.projPointsPerWeek.toFixed(1)}
                            </span>
                            {typeof p.beatRate === "number" && (
                              <span className="block text-[11px] text-ink-subtle">
                                beats {Math.round(p.beatRate * 100)}% of weeks
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-ink-subtle">
                            <span aria-hidden="true">-</span>
                            <span className="sr-only">No projection for this player</span>
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
                      {p.value.toLocaleString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {visible < filtered.length && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => {
              setVisible((v) => v + PAGE_SIZE);
              noteInteraction();
            }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Show more ({filtered.length - visible} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
