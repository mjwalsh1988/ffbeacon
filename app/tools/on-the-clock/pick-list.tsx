"use client";

/**
 * Chronological pick list: a full a11y peer of the visual board, rendered as a
 * semantic <table> in pick order. MOCKED for Phase 4 from the fixture picks.
 * Unmapped picks still render from cached name fields (no value chip).
 *
 * The leading pick/round number column is kept as narrow as possible
 * (whitespace-nowrap, shrink-to-fit) so the player name sits right next to it
 * instead of being pushed far across the row.
 */

import type { ShapedDraftCache, ShapedPick } from "@/lib/on-the-clock/types";
import { EmptyCard } from "./states";

function fullName(pick: ShapedPick): string {
  const name = `${pick.firstName ?? ""} ${pick.lastName ?? ""}`.trim();
  return name || "Unknown player";
}

export function PickList({
  picks,
  users,
  draft,
  teamNameByRosterId,
  connectedUserId,
}: {
  picks: ShapedPick[];
  users: ShapedDraftCache["users"];
  draft: ShapedDraftCache["draft"];
  /** roster_id -> owner username (Sleeper display_name). */
  teamNameByRosterId: Record<number, string>;
  connectedUserId: string;
}) {
  if (picks.length === 0) {
    return (
      <EmptyCard
        title="No picks yet."
        body="Picks will appear here as the draft happens. Press Sync draft to pull the latest."
      />
    );
  }

  const teams = draft.settings.teams ?? 0;
  const ordered = [...picks].sort((a, b) => a.pickNo - b.pickNo);
  // Owner username of the roster that actually holds the pick (the NEW owner for a
  // traded pick, since rosterId/pickedBy reflect the team that drafted). Resolve by
  // roster first (authoritative), then the picking user, then a seat fallback.
  const teamName = (pick: ShapedPick) =>
    (pick.rosterId != null ? teamNameByRosterId[pick.rosterId] : undefined) ??
    users.find((u) => u.userId === pick.pickedBy)?.displayName ??
    (pick.draftSlot ? `Team ${pick.draftSlot}` : "Unknown team");

  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">All draft picks in order.</caption>
        <thead className="bg-surface/60 text-xs uppercase tracking-wide text-ink-subtle">
          <tr>
            <th scope="col" className="w-px whitespace-nowrap px-3 py-2 text-right font-semibold">
              Pick
            </th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">
              Player
            </th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">
              Team
            </th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((p) => {
            const pickInRound = teams ? ((p.pickNo - 1) % teams) + 1 : p.pickNo;
            const yours = p.pickedBy === connectedUserId;
            return (
              <tr key={p.pickNo} className="border-t border-line/60">
                <th
                  scope="row"
                  className="w-px whitespace-nowrap px-3 py-2 text-right align-middle font-normal"
                >
                  <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                    {p.pickNo}
                  </span>
                  <span className="ml-1.5 font-mono text-[10px] tabular-nums text-ink-subtle">
                    R{p.round}.{pickInRound}
                  </span>
                </th>
                <td className="px-3 py-2">
                  <span className="font-semibold text-ink">{fullName(p)}</span>
                  <span className="ml-2 text-xs text-ink-muted">
                    {p.position ?? ""}
                    {p.team ? ` · ${p.team}` : ""}
                  </span>
                  {!p.playerId && (
                    <span className="ml-2 text-[10px] text-ink-subtle">(not in our database)</span>
                  )}
                </td>
                <td className="px-3 py-2 text-ink-muted">
                  {teamName(p)}
                  {yours && (
                    <span className="ml-1 text-xs font-semibold text-brand-cyan">(You)</span>
                  )}
                  {p.isKeeper && (
                    <span className="ml-1 rounded-full border border-line px-1.5 py-0.5 text-[10px] text-ink-subtle">
                      Keeper
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
