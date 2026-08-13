"use client";

/**
 * Available players: a real semantic <table> with search, position filter, column
 * sorting (aria-sort on the active column, sort buttons inside <th>), and
 * pagination via "Show more" (NOT virtualized, per owner decision 10).
 *
 * Carries a Sleeper ADP column beside the FF Beacon value so users can compare
 * the market against the Beacon board at a glance. The ADP cell shows the raw
 * ADP with a plain-English comparison line under it. Nothing is conveyed by
 * color alone.
 *
 * That line comes from describeAvailableVsMarket below, which prefers the
 * nightly Beacon Steals read (beacon_pick, already on the market's own pick
 * scale) and falls back to the older overall-rank comparison only when the board
 * has no row for the player. The two are not interchangeable: overall_rank is a
 * cross-position VALUE rank and ADP is a SCARCITY price, and comparing them
 * directly flagged six quarterbacks in the top twelve when it was measured
 * against production. See lib/draft-value/engine.ts.
 *
 * Accessibility: <caption>, scope headers, aria-sort, aria-pressed filter chips,
 * a polite live region announcing the visible count and sort changes, 44px targets.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Star } from "lucide-react";
import type { DraftPosition, RankedPlayer } from "./fixtures";
import { describeBeaconVsAdp } from "@/lib/on-the-clock/adp";
import { ValueTooltip, VALUE_TONE, type ValueTone } from "@/components/info-tooltip";
import { PlayerHeadshot } from "@/components/player-headshot";
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

/**
 * The line under a player's ADP, comparing our opinion to the market.
 *
 * Prefers the Beacon Steals read (beacon_pick, computed nightly) and falls back
 * to the original overall-rank comparison when the board has no row for this
 * player, which happens for a format with no ADP market, for kickers and
 * defenses, and before the first nightly build.
 *
 * WHY THE PREFERENCE MATTERS. describeBeaconVsAdp compares overall_rank, a
 * CROSS-POSITION VALUE rank, to a scarcity-priced ADP. Those units disagree
 * about every quarterback in every single-QB league, which put six quarterbacks
 * in the top twelve when the same comparison was measured against production.
 * beacon_pick is already on the market's own pick scale, so the same sentence
 * means what it says. See lib/draft-value/engine.ts.
 */
export function describeAvailableVsMarket(
  player: RankedPlayer,
  thresholdPicks: number,
): { gap: number | null; label: string; lean: "beacon-higher" | "market-higher" | "even" | "none" } {
  const adp = player.adp ?? null;
  const beaconPick = player.beaconPick ?? null;

  if (typeof adp === "number" && typeof beaconPick === "number") {
    const gap = adp - beaconPick;
    const t = Math.max(1, thresholdPicks);
    const picks = (n: number) => {
      const v = Math.round(Math.abs(n));
      return `${v} ${v === 1 ? "pick" : "picks"}`;
    };
    if (gap >= t) {
      return {
        gap,
        label: `Lasts ${picks(gap)} past where our board takes him (${Math.round(beaconPick)}).`,
        lean: "beacon-higher",
      };
    }
    if (gap <= -t) {
      return {
        gap,
        label: `Goes ${picks(gap)} before where our board takes him (${Math.round(beaconPick)}).`,
        lean: "market-higher",
      };
    }
    return { gap, label: `Near where our board takes him (${Math.round(beaconPick)}).`, lean: "even" };
  }

  return describeBeaconVsAdp(player.overallRank, adp, thresholdPicks);
}

/**
 * The compact chip for the ADP column, e.g. "(+28)".
 *
 * The full sentence lives in the tooltip. It used to render inline under the
 * number and it squeezed the whole table, which is the entire reason this is a
 * chip now. The sign stays in the text so the direction never depends on color.
 */
function signedPicks(gap: number): string {
  const n = Math.round(gap);
  return n > 0 ? `(+${n})` : n < 0 ? `(${n})` : "(0)";
}

/** Green when he lasts past our pick, red when the room takes him early. */
function adpTone(lean: "beacon-higher" | "market-higher" | "even" | "none"): ValueTone {
  if (lean === "beacon-higher") return "good";
  if (lean === "market-higher") return "bad";
  return "neutral";
}

/**
 * Beat rate reads high-is-good, but the honest bands are not 50/50: across the
 * league a player beats his own weekly projection roughly a third of the time,
 * so 45% is genuinely strong and 25% is genuinely poor.
 */
function beatRateTone(beatRate: number): ValueTone {
  if (beatRate >= 0.45) return "good";
  if (beatRate <= 0.28) return "bad";
  return "neutral";
}

/** The sentence behind the beat-rate chip. */
function describeBeatRate(beatRate: number, weeks: number | null | undefined): string {
  const pct = Math.round(beatRate * 100);
  const sample =
    typeof weeks === "number" && weeks > 0
      ? ` Measured over ${weeks} graded ${weeks === 1 ? "week" : "weeks"}.`
      : "";
  return `Beats his own weekly projection ${pct}% of the time, so the number to his left is one he clears about ${pct} weeks in 100.${sample}`;
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
                <th scope="col" className="w-px px-1 py-2 text-left font-semibold">
                  <span className="sr-only">Watchlist</span>
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
                    <span aria-hidden="true">Order</span>
                    <span className="sr-only">Our recommended order</span>
                  </button>
                </th>
              )}
              <th scope="col" aria-sort={ariaSortFor(sortKey === "positionRank", sortDir)} className="px-3 py-2 text-left">
                <button type="button" className={headerBtn} onClick={() => toggleSort("positionRank")}>
                  <span aria-hidden="true">Pos</span>
                  <span className="sr-only">Position rank</span>
                </button>
              </th>
              <th scope="col" className="px-2 py-2 text-left font-semibold">
                Tier
              </th>
              <th scope="col" aria-sort={ariaSortFor(sortKey === "adp", sortDir)} className="px-3 py-2 text-left">
                <button type="button" className={headerBtn} onClick={() => toggleSort("adp")}>
                  <span aria-hidden="true">ADP</span>
                  <span className="sr-only">Sleeper ADP</span>
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
                    <span aria-hidden="true">Proj</span>
                    <span className="sr-only">Projected points per week</span>
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
                const comparison = describeAvailableVsMarket(p, adpThreshold);
                return (
                  <tr key={p.playerId} className="border-t border-line/60">
                    {watchlist && (
                      <td className="w-px px-1 py-2">
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
                      {/* Photo, then name over position and team on a second
                          line. Stacking the meta under the name keeps this
                          column narrow instead of forcing one long row. The
                          photo is decorative: the name sits right beside it. */}
                      <span className="flex items-center gap-2">
                        <span className="shrink-0">
                          <PlayerHeadshot sleeperId={p.sleeperId} name="" size={32} />
                        </span>
                        <span className="min-w-0">
                          <span className="block font-semibold leading-tight text-ink">
                            {p.name}
                          </span>
                          <span className="block text-xs leading-tight text-ink-muted">
                            {p.position}
                            {p.team ? `, ${p.team}` : ""}
                            {p.isRookie ? ", Rookie" : ""}
                          </span>
                        </span>
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
                    {/* "T1" visually to save a column's worth of width; the
                        full word is kept for screen readers so the cell does
                        not read as a bare letter and number. */}
                    <td className="px-3 py-2 text-ink-muted">
                      <span aria-hidden="true">T{p.tier}</span>
                      <span className="sr-only">Tier {p.tier}</span>
                    </td>
                    <td className="px-3 py-2">
                      {typeof p.adp === "number" ? (
                        <span className="block">
                          <span className="block font-mono leading-tight tabular-nums text-ink">
                            {p.adp.toFixed(1)}
                          </span>
                          {comparison.gap !== null ? (
                            <span className="block leading-tight">
                              <ValueTooltip
                                short={signedPicks(comparison.gap)}
                                content={comparison.label}
                                className={VALUE_TONE[adpTone(comparison.lean)]}
                                align="start"
                                compact
                              />
                            </span>
                          ) : null}
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
                            <span className="block font-mono leading-tight tabular-nums text-ink">
                              {p.projPointsPerWeek.toFixed(1)}
                            </span>
                            {typeof p.beatRate === "number" && (
                              <span className="block leading-tight">
                                <ValueTooltip
                                  short={`(${Math.round(p.beatRate * 100)}%)`}
                                  content={describeBeatRate(p.beatRate, p.accuracyWeeks)}
                                  className={VALUE_TONE[beatRateTone(p.beatRate)]}
                                  align="end"
                                  compact
                                />
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
