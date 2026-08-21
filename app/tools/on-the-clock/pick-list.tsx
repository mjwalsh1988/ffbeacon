"use client";

/**
 * Chronological pick list: a full a11y peer of the visual board, rendered as a
 * semantic <table> in pick order. Unmapped picks still render from cached name
 * fields (no value chip).
 *
 * Carries a "Value vs ADP" column: the same good-value / reach signal as the
 * board icons, but written out in plain English ("Great value: taken 14 picks
 * after ADP", "Reach: taken 11 picks before ADP", "Near ADP") with the raw ADP
 * beneath it so the WHY is readable per pick.
 *
 * The leading pick/round number column is kept as narrow as possible
 * (whitespace-nowrap, shrink-to-fit) so the player name sits right next to it
 * instead of being pushed far across the row.
 */

import type { ShapedDraftCache, ShapedPick } from "@/lib/on-the-clock/types";
import {
  classifyPickValue,
  describePickValue,
  pickValueDelta,
} from "@/lib/on-the-clock/adp";
import { normalizePositionColor, POSITION_ROW } from "@/lib/on-the-clock/position-colors";
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
  adpBySleeperId = {},
  adpThreshold = 6,
}: {
  picks: ShapedPick[];
  users: ShapedDraftCache["users"];
  draft: ShapedDraftCache["draft"];
  /** roster_id -> owner username (Sleeper display_name). */
  teamNameByRosterId: Record<number, string>;
  connectedUserId: string;
  /** Sleeper player id -> ADP, for the value-vs-ADP column. */
  adpBySleeperId?: Record<string, number>;
  /** Neutral band (picks) before a pick is called good value / reach. */
  adpThreshold?: number;
}) {
  if (picks.length === 0) {
    return (
      <EmptyCard
        title="No picks yet."
        body="Picks appear here as the draft happens."
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
      {/* On mobile the table keeps its natural width (min 100%) and the wrapper
          scrolls horizontally, so columns stay readable instead of squishing.
          On desktop it fills the container as before. */}
      {/* border-separate + a small vertical gap turns each row into its own bordered
          band, so rows are clearly separated. Horizontal spacing stays 0 so the cells
          in a row read as one continuous block. */}
      <table className="w-max min-w-full border-separate border-spacing-x-0 border-spacing-y-1.5 text-sm sm:w-full">
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
            <th scope="col" className="px-3 py-2 text-left font-semibold">
              Value vs ADP
            </th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((p) => {
            const pickInRound = teams ? ((p.pickNo - 1) % teams) + 1 : p.pickNo;
            const yours = p.pickedBy === connectedUserId;
            const adp =
              !p.isKeeper && p.sleeperPlayerId
                ? (adpBySleeperId[p.sleeperPlayerId] ?? null)
                : null;
            const delta = pickValueDelta(p.pickNo, adp);
            const verdict = classifyPickValue(delta, adpThreshold);
            const verdictText = p.isKeeper
              ? "Keeper"
              : adp === null
                ? "No ADP data"
                : describePickValue(delta, verdict);
            const verdictClass =
              verdict === "value"
                ? "font-medium text-emerald-300"
                : verdict === "reach"
                  ? "font-medium text-amber-300"
                  : "text-ink-muted";
            // Faint position hue behind the row so the list matches the board's
            // color coding. Ownership stays signalled by the purple bar on the
            // pick cell below (not a row fill), so the two never conflict.
            const posKey = normalizePositionColor(p.position);
            const rowTint = posKey ? POSITION_ROW[posKey] : "";
            return (
              <tr key={p.pickNo}>
                <th
                  scope="row"
                  className={`w-px whitespace-nowrap rounded-l-md border-y border-l border-line-accent px-3 py-2 text-right align-middle font-normal ${rowTint} ${
                    yours ? "shadow-[inset_3px_0_0_0_#A855F7]" : ""
                  }`}
                >
                  <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                    {p.pickNo}
                  </span>
                  <span className="ml-1.5 font-mono text-[10px] tabular-nums text-ink-subtle">
                    R{p.round}.{pickInRound}
                  </span>
                </th>
                <td className={`border-y border-line-accent px-3 py-2 ${rowTint}`}>
                  <span className="font-semibold text-ink">{fullName(p)}</span>
                  <span className="ml-2 text-xs text-ink-muted">
                    {p.position ?? ""}
                    {p.team ? `, ${p.team}` : ""}
                  </span>
                  {!p.playerId && (
                    <span className="ml-2 text-[10px] text-ink-subtle">(not in our database)</span>
                  )}
                </td>
                <td className={`border-y border-line-accent px-3 py-2 text-ink-muted ${rowTint}`}>
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
                <td
                  className={`rounded-r-md border-y border-r border-line-accent px-3 py-2 text-xs ${rowTint}`}
                >
                  <span className={`block ${verdictClass}`}>{verdictText}</span>
                  {adp !== null && (
                    <span className="block text-[10px] text-ink-subtle">
                      ADP {adp.toFixed(1)}
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
