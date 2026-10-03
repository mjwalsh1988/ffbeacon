"use client";

/**
 * The season leaders board: positional ranks, found by tab or by name.
 *
 * WHAT A READER COMES HERE TO DO. Either scan a position ("who are the top
 * running backs this year") or find one player ("where does he rank"). The
 * tabs answer the first and the search box answers the second, and the search
 * deliberately ignores the tab: a reader typing a name wants that player
 * wherever he plays, and the badge on his row is the answer.
 *
 * TWO VIEWS OF THE SAME ROWS. "Season" is totals, per game, games and last
 * week. "Week by week" is every week's points with the positional finish under
 * each, coloured by how good the finish was, plus how many of those weeks were
 * inside the starting range. Position, sort and search carry across both.
 *
 * ACCESSIBILITY CONTRACT
 *   - Every control is a real button with aria-pressed, in a named group.
 *   - The search field has a visible label, and what the list now shows is
 *     announced through one polite live region: on a filter, a sort, a search
 *     or "show more". The text settles for half a second before it changes, so
 *     typing a name is announced once, when the typing stops, and not once a
 *     keystroke.
 *   - "Show more" moves focus to the first row it revealed. Without that the
 *     last press removes the focused button and focus falls to the page body.
 *   - A selected button carries a check mark as well as its colour.
 *   - Both views are real tables with a caption, column headers and the
 *     player's name as the row header. The row header holds the name and team
 *     only, because a screen reader repeats it for every cell in the row.
 *   - The weekly bars under a name are a graphic and are aria-hidden. Their
 *     numbers are the Week by week view, one button away.
 *   - Colour in the weekly grid repeats the finish printed in the cell. No cell
 *     depends on it.
 *   - No column is dropped on a phone. Games and last week move under the
 *     points and the per-game figure; the weekly grid scrolls sideways inside
 *     its own focusable region with the player column pinned.
 *
 * `?pos=` in the address bar follows the tab through history.replaceState, so
 * a shared link opens on the same position without a navigation.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, Check, Search } from "lucide-react";
import { OFFENSE_POSITIONS, positionNoun } from "@/lib/site";
import { STARTER_RANGE } from "@/lib/season-pulse/board";
import type { BoardPlayer, SeasonPosition } from "@/lib/season-pulse/types";
import { PlayerAvatar, PlayerName, PositionBadge, TeamTag, points } from "./bits";

/** The board's row: a BoardPlayer without the stat totals this view never draws. */
export type BoardRow = Pick<
  BoardPlayer,
  | "id"
  | "slug"
  | "name"
  | "position"
  | "team"
  | "sleeperId"
  | "weeks"
  | "weekRanks"
  | "total"
  | "games"
  | "perGame"
  | "rank"
  | "perGameRank"
  | "starterWeeks"
  | "best"
  | "worst"
>;

export type BoardTab = SeasonPosition | "ALL";
type View = "season" | "weeks";
type Sort = "total" | "perGame" | "last" | "starts";

/** The overall tab ranks skill positions together. A kicker's 30 points is not a receiver's 30. */
const OVERALL_POSITIONS: readonly SeasonPosition[] = ["QB", "RB", "WR", "TE"];

const TABS: { key: BoardTab; label: string; spoken: string }[] = [
  { key: "ALL", label: "Overall", spoken: "Overall" },
  ...OFFENSE_POSITIONS.map((p) => ({ key: p as BoardTab, label: p, spoken: positionNoun(p, "plural") })),
];

const SORTS: { key: Sort; label: string }[] = [
  { key: "total", label: "Total points" },
  { key: "perGame", label: "Per game" },
  { key: "last", label: "Last week" },
  { key: "starts", label: "Starter weeks" },
];

const CONTROL =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-3.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";
const CONTROL_ON = "border-brand-cyan/60 bg-brand-cyan/15 text-brand-cyan";
const CONTROL_OFF = "border-line bg-surface/70 text-ink-muted hover:border-line-accent hover:text-ink";

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

/** How strongly a weekly finish is tinted. The finish itself is printed in the cell. */
function finishTint(position: SeasonPosition, rank: number | null): string {
  if (rank === null) return "";
  const range = STARTER_RANGE[position];
  if (rank <= 3) return "bg-signal-success/40";
  if (rank <= range / 2) return "bg-signal-success/25";
  if (rank <= range) return "bg-signal-success/[0.13]";
  if (rank <= range * 1.5) return "bg-ink/[0.05]";
  return "";
}

function WeekBars({ weeks, max }: { weeks: (number | null)[]; max: number }) {
  return (
    <span aria-hidden="true" className="mt-1 flex h-4 items-end gap-0.5">
      {weeks.map((value, i) => (
        <span
          key={i}
          className={`w-1.5 rounded-sm ${value === null ? "bg-ink/10" : "bg-beacon"}`}
          style={{ height: value === null ? 2 : `${Math.max(12, Math.min(100, (value / max) * 100))}%` }}
        />
      ))}
    </span>
  );
}

export function LeadersBoard({
  rows,
  rankedByPosition,
  throughWeek,
  lastCompletedWeek,
  scoringLabel,
  initialTab = "ALL",
  pageSize = 25,
  fullBoardHref,
  truncated = false,
}: {
  rows: BoardRow[];
  rankedByPosition: Record<SeasonPosition, number>;
  throughWeek: number;
  lastCompletedWeek: number;
  scoringLabel: string;
  initialTab?: BoardTab;
  pageSize?: number;
  /** Set on the hub, where the board carries the top of each position only. */
  fullBoardHref?: string;
  /** True when `rows` is not every ranked player. */
  truncated?: boolean;
}) {
  const [tab, setTab] = useState<BoardTab>(initialTab);
  const [view, setView] = useState<View>("season");
  const [sort, setSort] = useState<Sort>("total");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(pageSize);
  const searchId = useId();
  const tableRef = useRef<HTMLDivElement>(null);
  /** The row index to focus once the next page of rows has rendered. */
  const focusRow = useRef<number | null>(null);

  // A week still being played is in the grid, said to be incomplete.
  const liveWeek = throughWeek > lastCompletedWeek ? throughWeek : null;
  const lastIndex = lastCompletedWeek - 1;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (tab === "ALL") url.searchParams.delete("pos");
    else url.searchParams.set("pos", tab);
    window.history.replaceState(window.history.state, "", url);
  }, [tab]);

  const needle = fold(query);
  const searching = needle.length >= 2;

  const visible = useMemo(() => {
    const pool = searching
      ? rows.filter((r) => fold(r.name).includes(needle))
      : tab === "ALL"
        ? rows.filter((r) => OVERALL_POSITIONS.includes(r.position))
        : rows.filter((r) => r.position === tab);

    const lastOf = (r: BoardRow) => (lastIndex >= 0 ? r.weeks[lastIndex] : null);
    const sorted = [...pool].sort((a, b) => {
      if (sort === "perGame") {
        // Unqualified players (too few games) sit below everyone ranked.
        const aq = a.perGameRank !== null ? 1 : 0;
        const bq = b.perGameRank !== null ? 1 : 0;
        if (aq !== bq) return bq - aq;
        return (b.perGame ?? -Infinity) - (a.perGame ?? -Infinity) || b.total - a.total;
      }
      if (sort === "last") {
        return (lastOf(b) ?? -Infinity) - (lastOf(a) ?? -Infinity) || b.total - a.total;
      }
      if (sort === "starts") {
        return b.starterWeeks - a.starterWeeks || b.total - a.total;
      }
      return b.total - a.total || a.rank - b.rank || a.name.localeCompare(b.name);
    });
    return sorted;
  }, [rows, tab, sort, needle, searching, lastIndex]);

  const page = visible.slice(0, shown);
  const maxWeek = useMemo(() => {
    let max = 1;
    for (const r of page) for (const w of r.weeks) if (w !== null && w > max) max = w;
    return max;
  }, [page]);

  const tabNoun = tab === "ALL" ? "skill players" : positionNoun(tab, "plural");
  const sortLabel = SORTS.find((s) => s.key === sort)?.label.toLowerCase() ?? "total points";
  const status = searching
    ? visible.length === 0
      ? `No player matches "${query.trim()}"${truncated ? " among the players on this board" : ""}.`
      : `Showing ${page.length} of ${visible.length} ${visible.length === 1 ? "player" : "players"} matching "${query.trim()}".`
    : `Showing ${page.length} of ${visible.length} ${tabNoun}, sorted by ${sortLabel}.`;

  // What the live region says trails the list by half a second, so a name
  // being typed is announced once it stops changing.
  const [announced, setAnnounced] = useState(status);
  useEffect(() => {
    const timer = window.setTimeout(() => setAnnounced(status), 500);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (focusRow.current === null) return;
    const link = tableRef.current?.querySelector<HTMLElement>(`[data-row="${focusRow.current}"] a`);
    focusRow.current = null;
    link?.focus();
  }, [shown]);

  const weekNumbers = Array.from({ length: throughWeek }, (_, i) => i + 1);

  const pick = (next: BoardTab) => {
    setTab(next);
    setShown(pageSize);
  };

  return (
    <div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <label htmlFor={searchId} className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
            Find a player
          </label>
          <div className="relative mt-1.5 max-w-md">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
            />
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShown(pageSize);
              }}
              placeholder="Type a player name"
              autoComplete="off"
              className="min-h-11 w-full rounded-card border border-line bg-base/70 pl-9 pr-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              aria-describedby={`${searchId}-hint`}
            />
          </div>
          <p id={`${searchId}-hint`} className="mt-1 text-xs text-ink-subtle">
            Searches every position at once.
            {truncated ? " This board carries the top of each position; the full board has everyone." : ""}
          </p>
        </div>

        <div role="group" aria-label="View" className="flex flex-wrap gap-1.5">
          {(
            [
              { key: "season", label: "Season" },
              { key: "weeks", label: "Week by week" },
            ] as { key: View; label: string }[]
          ).map((v) => (
            <button
              key={v.key}
              type="button"
              aria-pressed={view === v.key}
              onClick={() => setView(v.key)}
              className={`${CONTROL} ${view === v.key ? CONTROL_ON : CONTROL_OFF}`}
            >
              {view === v.key && <Check aria-hidden="true" className="mr-1 h-3.5 w-3.5" />}
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label="Position" className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={!searching && tab === t.key}
              onClick={() => {
                setQuery("");
                pick(t.key);
              }}
              className={`${CONTROL} ${!searching && tab === t.key ? CONTROL_ON : CONTROL_OFF}`}
            >
              {!searching && tab === t.key && <Check aria-hidden="true" className="mr-1 h-3.5 w-3.5" />}
              {t.label}
              {t.key !== "ALL" && <span className="sr-only">{`, ${t.spoken}`}</span>}
            </button>
          ))}
        </div>

        <div role="group" aria-label="Sort by" className="flex flex-wrap gap-1.5">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={sort === s.key}
              onClick={() => setSort(s.key)}
              className={`${CONTROL} ${sort === s.key ? CONTROL_ON : CONTROL_OFF}`}
            >
              {sort === s.key && <Check aria-hidden="true" className="mr-1 h-3.5 w-3.5" />}
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <p role="status" aria-live="polite" className="mt-3 text-xs text-ink-muted">
        {announced}
      </p>

      {visible.length === 0 ? (
        <p className="mt-3 rounded-card border border-dashed border-line bg-base/40 px-4 py-6 text-sm text-ink-muted">
          {searching
            ? "Nobody on this board matches that name. Check the spelling, or try a last name on its own."
            : "Nobody has played at this position yet this season."}
        </p>
      ) : (
        <div
          ref={tableRef}
          role="region"
          aria-label={view === "season" ? "Season leaders table" : "Week by week table"}
          tabIndex={0}
          className="beacon-scroll mt-3 overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {view === "season" ? (
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">
                {searching
                  ? `Players matching ${query.trim()}, with each one's rank at his position. ${scoringLabel} scoring.`
                  : `Season leaders, ${tabNoun}, sorted by ${sortLabel}. ${scoringLabel} scoring. The rank is by total points at the position${
                      tab !== "ALL" ? `, out of ${rankedByPosition[tab]} ranked` : ""
                    }.`}
              </caption>
              <thead>
                <tr className="border-b border-line bg-surface-elevated/50 text-[10px] uppercase tracking-[0.12em] text-ink-subtle">
                  <th scope="col" className="px-2 py-2.5 font-semibold sm:px-3">
                    Rank
                  </th>
                  <th scope="col" className="px-2 py-2.5 font-semibold">
                    Player
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-right font-semibold sm:px-3">
                    Points
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-right font-semibold sm:px-3">
                    Per game
                  </th>
                  <th scope="col" className="hidden px-3 py-2.5 text-right font-semibold sm:table-cell">
                    Games
                  </th>
                  <th scope="col" className="hidden px-3 py-2.5 text-right font-semibold sm:table-cell">
                    Last week
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {page.map((r, index) => {
                  const last = lastIndex >= 0 ? r.weeks[lastIndex] : null;
                  return (
                    <tr key={r.id} data-row={index} className="transition-colors hover:bg-ink/[0.03]">
                      <td className="px-2 py-2 align-top sm:px-3">
                        <PositionBadge position={r.position} rank={r.rank} />
                      </td>
                      <th scope="row" className="px-2 py-1 text-left align-top font-normal">
                        <span className="flex items-start gap-2.5">
                          <span className="mt-1.5 hidden sm:block">
                            <PlayerAvatar position={r.position} sleeperId={r.sleeperId} team={r.team} size={32} />
                          </span>
                          <span className="min-w-0">
                            <PlayerName slug={r.slug} name={r.name} />
                            <span className="-mt-2 block text-xs">
                              <TeamTag team={r.team} size={14} />
                            </span>
                            <WeekBars weeks={r.weeks} max={maxWeek} />
                          </span>
                        </span>
                      </th>
                      <td className="px-2 py-2 text-right align-top sm:px-3">
                        <span className="font-mono text-base font-bold tabular-nums text-ink">{points(r.total)}</span>
                        {/* On a phone the Games column lives here. Only one of
                            the two is ever displayed, so it is read once. */}
                        <span className="block text-[11px] text-ink-subtle sm:hidden">
                          {r.games} {r.games === 1 ? "game" : "games"}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right align-top sm:px-3">
                        <span className="font-mono tabular-nums text-ink-muted">{points(r.perGame)}</span>
                        <span className="block text-[11px] text-ink-subtle sm:hidden">
                          {last === null ? "No game last week" : `Last ${points(last)}`}
                        </span>
                      </td>
                      <td className="hidden px-3 py-2 text-right align-top font-mono tabular-nums text-ink-muted sm:table-cell">
                        {r.games}
                      </td>
                      <td className="hidden px-3 py-2 text-right align-top font-mono tabular-nums text-ink-muted sm:table-cell">
                        {last === null ? <span className="font-sans text-xs text-ink-subtle">No game</span> : points(last)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">
                {`Week by week points for ${searching ? `players matching ${query.trim()}` : tabNoun}. Each cell is the points scored and the finish at the position that week. ${scoringLabel} scoring.${
                  liveWeek ? ` Week ${liveWeek} is still being played.` : ""
                }`}
              </caption>
              <thead>
                <tr className="border-b border-line bg-surface-elevated/50 text-[10px] uppercase tracking-[0.12em] text-ink-subtle">
                  <th scope="col" className="px-2 py-2.5 font-semibold sm:px-3">
                    Rank
                  </th>
                  <th scope="col" className="sticky left-0 z-10 bg-surface-elevated px-2 py-2.5 font-semibold">
                    Player
                  </th>
                  {weekNumbers.map((week) => (
                    <th key={week} scope="col" className="px-2 py-2.5 text-center font-semibold">
                      W{week}
                      <span className="sr-only">
                        {`, week ${week}`}
                        {week === liveWeek ? ", still being played" : ""}
                      </span>
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    Total
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    Best
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                    Worst
                  </th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">
                    Starter weeks
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {page.map((r, index) => (
                  <tr key={r.id} data-row={index}>
                    <td className="px-2 py-2 sm:px-3">
                      <PositionBadge position={r.position} rank={r.rank} />
                    </td>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 max-w-[9.5rem] bg-surface px-2 py-0.5 text-left font-normal sm:max-w-none"
                    >
                      <PlayerName slug={r.slug} name={r.name} />
                    </th>
                    {weekNumbers.map((week) => {
                      const value = r.weeks[week - 1];
                      const finish = r.weekRanks[week - 1];
                      return (
                        <td key={week} className="px-1 py-1 text-center">
                          {value === null ? (
                            <span className="text-[11px] text-ink-subtle">
                              {week === liveWeek ? "Not yet" : "DNP"}
                              <span className="sr-only">{week === liveWeek ? ", no game played yet" : ", did not play"}</span>
                            </span>
                          ) : (
                            <span className={`block rounded-md px-1.5 py-1 ${finishTint(r.position, finish)}`}>
                              <span className="block font-mono text-sm font-semibold tabular-nums text-ink">
                                {points(value)}
                              </span>
                              {finish !== null && (
                                <span className="block font-mono text-[10px] tabular-nums text-ink">
                                  {r.position}
                                  {finish}
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-ink">{points(r.total)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted">{points(r.best)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted">{points(r.worst)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-ink-muted">
                      {/* Out of FINISHED weeks: the live week has no finish yet. */}
                      {r.starterWeeks} of {r.weeks.slice(0, lastCompletedWeek).filter((w) => w !== null).length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {view === "weeks" && visible.length > 0 && (
        <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
          Under each score is the finish at the position that week. A darker cell is a better finish. A starter week is
          a finish inside the top 12 at quarterback, tight end, kicker and defense, or the top 24 at running back and
          wide receiver.{liveWeek ? ` Week ${liveWeek} is still being played, so it has points and no finishes yet.` : ""}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {visible.length > shown ? (
          <button
            type="button"
            onClick={() => {
              focusRow.current = shown;
              setShown((n) => n + pageSize);
            }}
            className={`${CONTROL} ${CONTROL_OFF} w-full sm:w-auto`}
          >
            Show {Math.min(pageSize, visible.length - shown)} more
          </button>
        ) : (
          <span />
        )}
        {fullBoardHref && (
          <Link
            href={fullBoardHref as Route}
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full border border-brand-cyan/50 bg-brand-cyan/10 px-4 text-sm font-semibold text-brand-cyan transition-colors hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
          >
            Open the full leaders board
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
