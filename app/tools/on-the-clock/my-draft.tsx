"use client";

/**
 * My Draft: the connected user's picks plus a roster-shape summary (counts by
 * position). MOCKED for Phase 4. Phase 5 detects the user's roster from the synced
 * Sleeper data; Phase 7 (Team Need) consumes the same roster shape.
 */

import type { ShapedPick } from "@/lib/on-the-clock/types";
import {
  normalizePositionColor,
  POSITION_BADGE,
  POSITION_BADGE_FALLBACK,
} from "@/lib/on-the-clock/position-colors";
import { EmptyCard } from "./states";

const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

function fullName(pick: ShapedPick): string {
  return `${pick.firstName ?? ""} ${pick.lastName ?? ""}`.trim() || "Unknown player";
}

/**
 * A pick belongs in "Your draft" only when the connected user CURRENTLY owns it.
 * Sleeper's roster_id on a made pick is the roster that actually selected the
 * player, so it already reflects pick trades: a pick the user traded away points
 * at its new owner, and a pick traded TO the user points at the user's roster.
 * We prefer roster ownership; pickedBy is the same idea keyed by user id. The
 * draft-seat match is a last resort and is NOT trade-aware (the seat keeps the
 * original owner even after the pick is traded), so it is used only when neither
 * ownership signal is available.
 */
function isMyPick(
  pick: ShapedPick,
  rosterId: number | null,
  userId: string,
  slot: number,
): boolean {
  if (rosterId != null && pick.rosterId != null) return pick.rosterId === rosterId;
  if (userId && pick.pickedBy) return pick.pickedBy === userId;
  return slot > 0 && pick.draftSlot === slot;
}

export function MyDraft({
  picks,
  connectedUserId,
  connectedUserSlot,
  connectedUserRosterId,
}: {
  picks: ShapedPick[];
  connectedUserId: string;
  connectedUserSlot: number;
  /** Connected user's roster id (trade-aware ownership). null when undetected. */
  connectedUserRosterId: number | null;
}) {
  const mine = picks
    .filter((p) => isMyPick(p, connectedUserRosterId, connectedUserId, connectedUserSlot))
    .sort((a, b) => a.pickNo - b.pickNo);

  const counts: Record<string, number> = {};
  for (const p of mine) {
    const pos = p.position ?? "?";
    counts[pos] = (counts[pos] ?? 0) + 1;
  }

  if (mine.length === 0) {
    return (
      <EmptyCard
        title="You have not made a pick yet."
        body="Once you draft a player, your roster shape and picks show up here. We will tailor Team Need to what you still need."
      />
    );
  }

  // Group the picks by position so the user can see how much of each position they
  // hold at a glance. Positions appear in the canonical QB/RB/WR/TE/K/DEF order, with
  // any unexpected positions appended after. `mine` is already sorted by pick number,
  // so each position group stays in pick order.
  const byPosition = new Map<string, ShapedPick[]>();
  for (const p of mine) {
    const pos = p.position ?? "?";
    const arr = byPosition.get(pos) ?? [];
    arr.push(p);
    byPosition.set(pos, arr);
  }
  const orderedPositions = [
    ...POSITION_ORDER.filter((pos) => byPosition.has(pos)),
    ...[...byPosition.keys()].filter((pos) => !(POSITION_ORDER as readonly string[]).includes(pos)),
  ];

  return (
    <div>
      <h3 className="text-base font-semibold text-ink">Your roster shape</h3>
      <ul role="list" className="mt-2 flex flex-wrap gap-2">
        {POSITION_ORDER.map((pos) => (
          <li
            key={pos}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-1 text-xs font-medium"
          >
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-[0.12em] ${POSITION_BADGE[pos]}`}
            >
              {pos}
            </span>
            <span className="font-semibold text-ink">{counts[pos] ?? 0}</span>
          </li>
        ))}
      </ul>

      <h3 className="mt-5 text-base font-semibold text-ink">
        Your picks ({mine.length})
      </h3>
      <div className="mt-2 space-y-3">
        {orderedPositions.map((pos) => {
          const items = byPosition.get(pos) ?? [];
          const posKey = normalizePositionColor(pos);
          const badgeCls = posKey ? POSITION_BADGE[posKey] : POSITION_BADGE_FALLBACK;
          return (
            <div key={pos}>
              <h4 className="flex items-center gap-1.5 text-xs font-semibold text-ink-subtle">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${badgeCls}`}
                >
                  {pos}
                </span>
                <span className="font-medium text-ink-muted">({items.length})</span>
              </h4>
              <ul
                role="list"
                className="mt-1 divide-y divide-line/60 rounded-card border border-line"
              >
                {items.map((p) => {
                  // Name, then team and position as subtle inline text, all on one line
                  // (the sidebar is narrow, so the whole left side truncates together);
                  // pick number pinned to the far right.
                  const meta = [p.team, p.position].filter(Boolean).join(" · ");
                  return (
                    <li
                      key={p.pickNo}
                      className="flex items-baseline justify-between gap-3 px-3 py-2"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-semibold text-ink">{fullName(p)}</span>
                        {meta && <span className="ml-2 text-xs text-ink-muted">{meta}</span>}
                      </span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-ink-subtle">
                        #{p.pickNo}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
