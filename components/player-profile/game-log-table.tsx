"use client";

/**
 * The weekly game log table, on its own so two tabs can render it.
 *
 * The Statistics tab wraps it in a season picker, an accuracy chart and a
 * per-stat breakdown. The Overview tab renders it alone under the depth chart
 * for the current season. Those are different framings of the SAME table, and
 * a second copy would have drifted the first time either was touched.
 *
 * THREE KINDS OF ROW, and the rules are in lib/player-profile/game-log.ts:
 * a played week with real numbers, a BYE rendered dimmed and inset with the
 * week number intact, and an upcoming week of dashes that gains a marker on
 * the day its game is played.
 *
 * MOBILE. `StatScroll` is the shared horizontally scrolling frame every stat
 * table on the profile uses: focusable, named, and with the table at its own
 * min-width inside so columns never crush. Nothing is hidden at any breakpoint,
 * which is the mobile-first rule: the same columns are reachable on a phone by
 * scrolling the frame rather than being dropped.
 */

import {
  statColumns,
  StatScroll,
  lineFromGame,
  fmtStatDelta,
  deltaTone,
  type StatLine,
  type StatCol,
  type WeeklyGameRow,
  type PendingWeekRow,
} from "@/components/player-profile/stat-shaping";
import { weekRowState } from "@/lib/game-day";

/** Green for a good outcome, red for a bad one, muted when the delta rounds to
 *  zero (on projection) so a displayed "0" is never colored as a beat or miss. */
const TONE_CLASS = {
  good: "text-signal-success",
  bad: "text-signal-danger",
  neutral: "text-ink-subtle",
} as const;

/** Per-column beat/miss deltas rendered as a small colored sub-line under a
 *  stat's actual value. A column can map to more than one stat (QB Cmp/Att), so
 *  the deltas are shown side by side, separated by a slash. Only stats that
 *  carried a real projection that week (projected > 0) appear. */
function DeltaLine({
  col,
  actual,
  proj,
}: {
  col: StatCol;
  actual: StatLine;
  proj: StatLine | null;
}) {
  if (!proj || !col.deltas) return null;
  const parts = col.deltas.flatMap((m) => {
    const pv = proj[m.key];
    if (!(pv > 0)) return [];
    return [{ m, delta: actual[m.key] - pv }];
  });
  if (parts.length === 0) return null;
  // For a single-stat column the column header already names the stat, so the
  // aria-label stays terse; multi-stat columns (QB Cmp/Att) name each one.
  const multi = parts.length > 1;
  return (
    <span className="mt-0.5 flex items-center justify-end gap-1 font-mono text-[10px] tabular-nums">
      {parts.map(({ m, delta }, i) => {
        const tone = deltaTone(delta, m.digits, m.lowerIsBetter);
        return (
          <span key={m.key} className="flex items-center gap-1">
            {i > 0 && (
              <span aria-hidden="true" className="text-ink-subtle">
                /
              </span>
            )}
            <span
              className={TONE_CLASS[tone]}
              aria-label={`${multi ? `${m.label} ` : ""}${fmtStatDelta(delta, m.digits)} versus projection`}
            >
              {fmtStatDelta(delta, m.digits)}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * The marker on a row whose game is being played today.
 *
 * TWO PULSING DOTS AND A WORD, and the word is the part that matters. The dots
 * are `aria-hidden` decoration; "Today" is real text, so a reader who cannot
 * see the animation still learns why that row is empty. Colour is not carrying
 * it either.
 *
 * `motion-safe:` on the animation rather than `motion-reduce:animate-none`, so
 * the default for a reader who has asked for less motion is no animation at
 * all rather than an animation that is then switched off. The dot still
 * renders; it simply does not move.
 *
 * It says "Today" rather than "Live" on purpose. We do not poll a live feed:
 * what we actually know is that the game is on today's Eastern date and no
 * stat line has landed. "Live" would claim the ball is in the air, which this
 * page cannot see, and would still be on screen at midnight.
 */
function LiveMarker() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-brand-cyan">
      <span aria-hidden="true" className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-brand-cyan opacity-75 motion-safe:animate-ping" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-cyan" />
      </span>
      Today
      <span className="sr-only">, this game is being played today and no stats have come in yet</span>
    </span>
  );
}

export function GameLogTable({
  position,
  season,
  rows,
  pending,
  scoringLabel,
  compare = false,
  nowIso,
  caption,
}: {
  position: string;
  season: number;
  /** Played weeks, ascending. */
  rows: WeeklyGameRow[];
  /** Byes and weeks still to come, ascending. */
  pending: PendingWeekRow[];
  scoringLabel: string;
  /** Show the per-stat beat/miss sub-line. Off on the overview, which has no toggle. */
  compare?: boolean;
  /** Server render time, so "is the game today" is not read off the client clock. */
  nowIso?: string;
  caption?: string;
}) {
  const cols = statColumns(position);
  /**
   * THE CLOCK COMES FROM THE SERVER. `nowIso` is stamped during the render
   * rather than read here. This is a client component inside a server render,
   * so reading the browser clock would make the first paint disagree with the
   * HTML and React would patch it: a reader whose machine clock is a day out
   * would see a marker appear after hydration on a game that finished
   * yesterday. The fallback is only for a caller that passes nothing.
   */
  const now = nowIso ? new Date(nowIso) : new Date();

  return (
    <StatScroll caption={caption ?? `${season} weekly stat lines`}>
        <table className="w-full min-w-[760px] text-sm">
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
                {scoringLabel}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Proj
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                +/-
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => {
              const line = lineFromGame(r);
              const snap = r.snap_pct != null ? `${Math.round(r.snap_pct * 100)}%` : "-";
              const delta = r.proj_active != null ? r.pts_active - r.proj_active : null;
              return (
                <tr key={`${r.season}-${r.week}`} className="align-top hover:bg-surface">
                  <th
                    scope="row"
                    className="whitespace-nowrap px-3 py-2 text-left font-mono font-medium text-ink"
                  >
                    {r.week}
                  </th>
                  <td className="px-3 py-2 text-ink-muted">{r.opponent ?? "-"}</td>
                  {cols.map((c) => (
                    <td key={c.label} className="px-3 py-2 text-right">
                      <span className="block font-mono tabular-nums text-ink-muted">
                        {c.get(line)}
                      </span>
                      {compare && <DeltaLine col={c} actual={line} proj={r.proj_line} />}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-muted">
                    {snap}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-ink">
                    {r.pts_active.toFixed(1)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-subtle">
                    {r.proj_active != null ? r.proj_active.toFixed(1) : "-"}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${
                      delta == null
                        ? "text-ink-subtle"
                        : delta >= 0
                          ? "text-signal-success"
                          : "text-signal-danger"
                    }`}
                  >
                    {delta == null ? "-" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`}
                  </td>
                </tr>
              );
            })}

            {/* The rest of the season. A row per week with no stat line yet:
                the opponent, dashes for every figure, and a live marker when
                the game is being played today. A missing week is not a bye and
                should not read as one, which is what an absent row did. */}
            {pending.map((p) => {
              const state = weekRowState({
                hasStats: false,
                kickoffAt: p.kickoffAt,
                now,
              });
              const live = !p.isBye && state === "in-progress";
              return (
                <tr
                  key={`pending-${season}-${p.week}`}
                  className={`align-top ${
                    p.isBye
                      // A BYE IS DARKENED AND INSET, not hidden. The week
                      // number stays, so the column still counts 1 to 18 with
                      // no gap for a reader to interpret, and the row reads as
                      // a recess in the table rather than a missing line. Two
                      // signals, and only one of them is visual: the words BYE
                      // WEEK carry it on their own.
                      ? "bg-black/55 shadow-[inset_0_3px_10px_-2px_rgba(0,0,0,0.9),inset_0_-3px_10px_-2px_rgba(0,0,0,0.9)]"
                      : live
                        ? "bg-brand-cyan/[0.04]"
                        : ""
                  }`}
                >
                  <th
                    scope="row"
                    className={`whitespace-nowrap px-3 py-2 text-left font-mono font-medium ${
                      p.isBye ? "text-ink-subtle/70" : "text-ink-subtle"
                    }`}
                  >
                    {p.week}
                  </th>
                  <td className="px-3 py-2 text-ink-subtle">
                    {p.isBye ? (
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-subtle/70">
                        Bye week
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        {p.opponent ?? "-"}
                        {live && <LiveMarker />}
                        {!live && <span className="sr-only">, not played yet</span>}
                      </span>
                    )}
                  </td>
                  {/* One dash per column. `colSpan` would be shorter and would
                      break the column alignment a reader navigating the table
                      by cell depends on, and on a bye it would swallow the
                      whole row into one cell. */}
                  {cols.map((c) => (
                    <td
                      key={c.label}
                      className={`px-3 py-2 text-right font-mono tabular-nums ${
                        p.isBye ? "text-ink-subtle/50" : "text-ink-subtle"
                      }`}
                    >
                      -
                    </td>
                  ))}
                  {[0, 1, 2, 3].map((i) => (
                    <td
                      key={`tail-${i}`}
                      className={`px-3 py-2 text-right font-mono tabular-nums ${
                        p.isBye ? "text-ink-subtle/50" : "text-ink-subtle"
                      }`}
                    >
                      -
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </StatScroll>
  );
}
