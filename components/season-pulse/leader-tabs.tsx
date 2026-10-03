"use client";

/**
 * A set of leader lists behind one row of buttons: pick a category, read its
 * top players. Used for usage leaders (targets, target share, carries, snap
 * share) and for NFL stat leaders (passing, rushing, receiving, touchdowns).
 *
 * The buttons are a single-select group with aria-pressed. The list is an
 * ordered list, so "3 of 10" is announced by the list itself, and the heading
 * above it names the category in force and is the live region, so a change is
 * announced once, as the new category's name.
 *
 * The bar behind each row is the figure's share of the leader's figure. It is
 * decoration: the number is printed on the row.
 */

import { useState } from "react";
import { Check } from "lucide-react";
import type { LeaderGroup } from "@/lib/season-pulse/leader-groups";
import { PlayerAvatar, PlayerName, PositionBadge, TeamTag } from "./bits";

const CONTROL =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-3.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

export function LeaderTabs({
  groups,
  groupLabel,
  headingLevel = 3,
}: {
  groups: LeaderGroup[];
  /** Names the button group, e.g. "Usage category". */
  groupLabel: string;
  headingLevel?: 3 | 4;
}) {
  const [active, setActive] = useState(groups[0]?.key ?? "");
  const group = groups.find((g) => g.key === active) ?? groups[0];
  if (!group) return null;
  const Heading = (`h${headingLevel}` as const) as "h3" | "h4";
  const top = Math.max(1, ...group.rows.map((r) => r.amount));

  return (
    <div>
      <div role="group" aria-label={groupLabel} className="flex flex-wrap gap-1.5">
        {groups.map((g) => (
          <button
            key={g.key}
            type="button"
            aria-pressed={g.key === group.key}
            onClick={() => setActive(g.key)}
            className={`${CONTROL} ${
              g.key === group.key
                ? "border-brand-cyan/60 bg-brand-cyan/15 text-brand-cyan"
                : "border-line bg-surface/70 text-ink-muted hover:border-line-accent hover:text-ink"
            }`}
          >
            {g.key === group.key && <Check aria-hidden="true" className="mr-1 h-3.5 w-3.5" />}
            {g.label}
          </button>
        ))}
      </div>

      <div aria-live="polite" className="mt-4">
        <Heading className="text-sm font-semibold text-ink">{group.label} leaders</Heading>
        {group.note && <p className="mt-0.5 text-xs text-ink-muted">{group.note}</p>}
      </div>

      {group.rows.length === 0 ? (
        <p className="mt-3 rounded-card border border-dashed border-line bg-base/40 px-4 py-6 text-sm text-ink-muted">
          Nothing recorded in this category yet.
        </p>
      ) : (
        <ol role="list" className="mt-2 grid gap-x-6 md:grid-cols-2">
          {group.rows.map((r, i) => (
            <li key={r.id} className="relative flex items-center gap-3 border-b border-line/60 py-2">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-1 left-0 rounded-md bg-brand-cyan/[0.07]"
                style={{ width: `${Math.max(3, (r.amount / top) * 100)}%` }}
              />
              <span className="relative w-6 shrink-0 text-right font-mono text-xs tabular-nums text-ink-subtle">
                {i + 1}
                <span className="sr-only">.</span>
              </span>
              <span className="relative">
                <PlayerAvatar position={r.position} sleeperId={r.sleeperId} team={r.team} size={32} />
              </span>
              <span className="relative min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2">
                  <PlayerName slug={r.slug} name={r.name} />
                  <PositionBadge position={r.position} size="sm" />
                </span>
                <span className="-mt-1.5 block text-xs">
                  <TeamTag team={r.team} size={14} />
                </span>
              </span>
              <span className="relative shrink-0 text-right">
                <span className="block font-mono text-base font-bold tabular-nums text-ink">
                  {r.value}
                  <span className="sr-only"> {group.unit}</span>
                </span>
                {r.detail && <span className="block text-[11px] text-ink-subtle">{r.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
