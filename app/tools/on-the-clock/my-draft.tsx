"use client";

/**
 * My Draft: the connected user's picks plus a roster-shape summary (counts by
 * position). MOCKED for Phase 4. Phase 5 detects the user's roster from the synced
 * Sleeper data; Phase 7 (Team Need) consumes the same roster shape.
 */

import type { ShapedDraftCache, ShapedPick } from "@/lib/on-the-clock/types";
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
  draft,
  connectedUserId,
  connectedUserSlot,
  connectedUserRosterId,
}: {
  picks: ShapedPick[];
  draft: ShapedDraftCache["draft"];
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

  return (
    <div>
      <h3 className="text-base font-semibold text-ink">Your roster shape</h3>
      <ul role="list" className="mt-2 flex flex-wrap gap-2">
        {POSITION_ORDER.map((pos) => (
          <li
            key={pos}
            className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink-muted"
          >
            <span className="text-ink-subtle">{pos}:</span>{" "}
            <span className="font-semibold text-ink">{counts[pos] ?? 0}</span>
          </li>
        ))}
      </ul>

      <h3 className="mt-5 text-base font-semibold text-ink">
        Your picks ({mine.length})
      </h3>
      <ul role="list" className="mt-2 divide-y divide-line/60 rounded-card border border-line">
        {mine.map((p) => (
          <li key={p.pickNo} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className="min-w-0">
              <span className="block truncate font-semibold text-ink">{fullName(p)}</span>
              <span className="text-xs text-ink-muted">
                {p.position ?? ""}
                {p.team ? ` · ${p.team}` : ""}
                {draft.draftType ? ` · ${draft.draftType}` : ""}
              </span>
            </span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-ink-subtle">
              #{p.pickNo}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
