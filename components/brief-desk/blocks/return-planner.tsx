"use client";

/**
 * return_planner: the reader picks a week range (their playoff weeks) and
 * the list shows who in the injury timeline is expected back inside it.
 *
 * Two native <select> controls with visible labels; the default range from
 * the block's options is rendered on the server so the list is there without
 * JavaScript. The summary sentence is the live region (role="status"), and the
 * list of players sits outside it, matching format-toggle.tsx: a week change
 * rewrites every row, and announcing the whole result on each change reads a
 * list the reader is about to read for themselves. Players with no timeline are
 * listed separately and never counted as "back".
 *
 * Client component. Takes plain data only.
 */

import { useId, useState } from "react";
import Link from "next/link";
import type { TimelineRow } from "./injury-timeline";
import { BLOCK_LINK_CLASS } from "./block-shell";

const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);

const SELECT_CLASS =
  "min-h-11 rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

function playerCell(r: TimelineRow) {
  return r.slug ? (
    <Link href={`/players/${r.slug}`} className={BLOCK_LINK_CLASS}>
      {r.name}
    </Link>
  ) : (
    r.name
  );
}

export function ReturnPlanner({
  rows,
  defaultWeeks,
}: {
  rows: TimelineRow[];
  defaultWeeks: [number, number];
}) {
  const id = useId();
  const [from, setFrom] = useState(defaultWeeks[0]);
  const [to, setTo] = useState(defaultWeeks[1]);
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);

  const back = rows
    .filter((r) => r.returnWeek !== null && r.returnWeek >= lo && r.returnWeek <= hi)
    .sort((a, b) => (a.returnWeek as number) - (b.returnWeek as number) || a.name.localeCompare(b.name));
  const later = rows.filter((r) => r.returnWeek !== null && r.returnWeek > hi);
  const undated = rows.filter((r) => r.returnWeek === null);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface/60 p-3">
        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          From week
          <select id={`${id}-from`} value={from} onChange={(e) => setFrom(Number(e.target.value))} className={SELECT_CLASS}>
            {WEEKS.map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
          To week
          <select id={`${id}-to`} value={to} onChange={(e) => setTo(Number(e.target.value))} className={SELECT_CLASS}>
            {WEEKS.map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3">
        <p role="status" className="text-sm text-ink">
          {back.length === 0
            ? `Nobody in this period's injury reports is expected back between week ${lo} and week ${hi}.`
            : `${back.length} ${back.length === 1 ? "player is" : "players are"} expected back between week ${lo} and week ${hi}.`}
        </p>
        {back.length > 0 && (
          <ul role="list" className="mt-2 space-y-1 text-sm text-ink-muted">
            {back.map((r, i) => (
              <li key={`${r.slug ?? r.name}-${i}`}>
                {playerCell(r)}
                {r.team ? ` (${[r.position, r.team].filter(Boolean).join(", ")})` : ""}: week {r.returnWeek}
                {r.timeline ? `, reported as "${r.timeline}"` : ""}
              </li>
            ))}
          </ul>
        )}
        {later.length > 0 && (
          <p className="mt-2 text-xs text-ink-subtle">
            {later.length} {later.length === 1 ? "player is" : "players are"} expected after week {hi}:{" "}
            {later.map((r) => `${r.name} (week ${r.returnWeek})`).join(", ")}.
          </p>
        )}
        {undated.length > 0 && (
          <p className="mt-2 text-xs text-ink-subtle">
            No timeline was given for {undated.map((r) => r.name).join(", ")}, so {undated.length === 1 ? "that player is" : "they are"} not counted here.
          </p>
        )}
      </div>
    </div>
  );
}
